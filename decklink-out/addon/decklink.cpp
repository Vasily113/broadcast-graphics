// decklink.cpp
// Electron N-API addon: renders 1080i50 Fill+Key to Blackmagic DeckLink 8K Pro.
//
// The DeckLink 8K Pro exposes as TWO independent DeckLink devices:
//   Device 0  →  SDI 1 (Fill) + SDI 2 (Key)
//   Device 1  →  SDI 3 (Fill) + SDI 4 (Key)
// Both are opened and driven in parallel with the same frame content.
//
// Architecture (pull model, per device):
//   Open()              – enumerates up to k_MaxDevices DeckLink devices,
//                         creates SDK-managed frame pools, prerolls, starts
//                         scheduled playback on each.
//   scheduleFrame(buf)  – copies the Electron BGRA paint bitmap into a shared
//                         staging buffer (thread-safe).
//   ScheduledFrameCompleted() (driver thread, one per device) –
//                         converts BGRA→ARGB from staging into the returned
//                         frame, then reschedules it on its own device.
//   Close()             – tears down all devices safely.

// DeckLinkAPI_manual.h already pulls in windows.h (WIN32_LEAN_AND_MEAN / NOMINMAX)
#include "DeckLinkAPI_manual.h"

#include <napi.h>
#include <objbase.h>

#include <atomic>
#include <cstdint>
#include <cstring>
#include <mutex>
#include <string>
#include <vector>

// ---------------------------------------------------------------------------
// Timing constants for 1080i50
//   TimeScale = 25 000 ticks/s  FrameDuration = 1 000 ticks  (= 1/25 s)
// ---------------------------------------------------------------------------
static constexpr BMDTimeScale k_TimeScale     = 25000;
static constexpr BMDTimeValue k_FrameDuration = 1000;
static constexpr int          k_PrerollFrames = 3;
static constexpr int          k_ClockMargin   = 6;
static constexpr int          k_MaxDevices    = 2;   // 8K Pro = 2 sub-devices

// ---------------------------------------------------------------------------
// Per-device state
// ---------------------------------------------------------------------------
struct PerDevice {
    IDeckLinkOutput*            output = nullptr;
    IDeckLinkKeyer*             keyer  = nullptr;
    IDeckLinkMutableVideoFrame* pool[k_PrerollFrames] = {};
    std::atomic<BMDTimeValue>   nextFrameTime{0};
};

// ---------------------------------------------------------------------------
// Global state
// ---------------------------------------------------------------------------
struct State {
    PerDevice            devices[k_MaxDevices];
    int                  deviceCount = 0;

    std::atomic<bool>    running{false};

    // Shared staging buffer: latest BGRA paint from Electron
    std::vector<uint8_t> stagingBGRA;
    std::mutex           stagingMtx;

    std::mutex           mtx;    // guards open / close
};
static State g_state;

// ---------------------------------------------------------------------------
// OutputCallback  — one instance per device, runs on the DeckLink driver thread
// ---------------------------------------------------------------------------
class OutputCallback final : public IDeckLinkVideoOutputCallback {
public:
    explicit OutputCallback(PerDevice* dev) : m_dev(dev), m_ref(1) {}

    // IUnknown
    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID iid, void** ppv) override {
        if (!ppv) return E_POINTER;
        if (iid == IID_IUnknown ||
            iid == __uuidof(IDeckLinkVideoOutputCallback)) {
            *ppv = static_cast<IDeckLinkVideoOutputCallback*>(this);
            AddRef(); return S_OK;
        }
        *ppv = nullptr; return E_NOINTERFACE;
    }
    ULONG STDMETHODCALLTYPE AddRef()  override { return ++m_ref; }
    ULONG STDMETHODCALLTYPE Release() override {
        ULONG r = --m_ref;
        if (r == 0) delete this;
        return r;
    }

    HRESULT STDMETHODCALLTYPE ScheduledPlaybackHasStopped() override { return S_OK; }

    HRESULT STDMETHODCALLTYPE ScheduledFrameCompleted(
        IDeckLinkVideoFrame*           completedFrame,
        BMDOutputFrameCompletionResult result) override
    {
        if (!g_state.running.load(std::memory_order_acquire)) return S_OK;
        if (result == bmdOutputFrameFlushed)                   return S_OK;

        // ---- Write latest frame pixels into the returned SDK buffer ----
        IDeckLinkVideoBuffer* buf = nullptr;
        if (SUCCEEDED(completedFrame->QueryInterface(
                __uuidof(IDeckLinkVideoBuffer),
                reinterpret_cast<void**>(&buf))) && buf)
        {
            buf->StartAccess(bmdBufferAccessWrite);
            void* pixels = nullptr;
            if (SUCCEEDED(buf->GetBytes(&pixels)) && pixels) {
                std::lock_guard<std::mutex> lk(g_state.stagingMtx);
                if (g_state.stagingBGRA.size() == 1920u * 1080u * 4u) {
                    // BGRA (Electron) → ARGB (DeckLink bmdFormat8BitARGB)
                    const uint8_t* bgra = g_state.stagingBGRA.data();
                    uint8_t*       argb = static_cast<uint8_t*>(pixels);
                    const size_t   n    = 1920u * 1080u;
                    for (size_t i = 0; i < n; ++i) {
                        argb[0] = bgra[3]; // A
                        argb[1] = bgra[2]; // R
                        argb[2] = bgra[1]; // G
                        argb[3] = bgra[0]; // B
                        bgra += 4; argb += 4;
                    }
                }
                // Note: stagingFresh is not used — both devices always consume
                // the latest available frame from the shared staging buffer.
            }
            buf->EndAccess(bmdBufferAccessWrite);
            buf->Release();
        }

        // ---- Reschedule this frame at the next display slot ----
        if (!g_state.running.load(std::memory_order_acquire)) return S_OK;

        BMDTimeValue slot = m_dev->nextFrameTime.fetch_add(1, std::memory_order_relaxed);
        m_dev->output->ScheduleVideoFrame(
            completedFrame,
            slot * k_FrameDuration,
            k_FrameDuration,
            k_TimeScale);

        return S_OK;
    }

private:
    PerDevice*         m_dev;
    std::atomic<ULONG> m_ref;
};

static OutputCallback* g_callbacks[k_MaxDevices] = {};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
static std::string hrStr(HRESULT hr) {
    char buf[24];
    sprintf_s(buf, sizeof(buf), "0x%08X", static_cast<unsigned>(hr));
    return buf;
}

// Release one PerDevice cleanly (safe to call from error paths or Close).
static void releaseDevice(int idx) {
    PerDevice& dev = g_state.devices[idx];
    if (!dev.output) return;

    dev.output->StopScheduledPlayback(0, nullptr, 0);
    dev.output->DisableVideoOutput();
    dev.output->SetScheduledFrameCompletionCallback(nullptr);

    if (g_callbacks[idx]) { g_callbacks[idx]->Release(); g_callbacks[idx] = nullptr; }

    if (dev.keyer) {
        dev.keyer->Disable();
        dev.keyer->Release(); dev.keyer = nullptr;
    }

    for (int i = 0; i < k_PrerollFrames; ++i) {
        if (dev.pool[i]) { dev.pool[i]->Release(); dev.pool[i] = nullptr; }
    }

    dev.output->Release(); dev.output = nullptr;
}

// ---------------------------------------------------------------------------
// JS: open()
// ---------------------------------------------------------------------------
static Napi::Value Open(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    std::lock_guard<std::mutex> lock(g_state.mtx);

    if (g_state.running.load()) {
        Napi::Error::New(env, "DeckLink already open").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    // ---- Enumerate devices ----
    IDeckLinkIterator* iter = nullptr;
    HRESULT hr = CoCreateInstance(
        CLSID_CDeckLinkIterator, nullptr, CLSCTX_ALL,
        __uuidof(IDeckLinkIterator), reinterpret_cast<void**>(&iter));
    if (FAILED(hr)) {
        Napi::Error::New(env, "CoCreateInstance(CDeckLinkIterator) failed: " + hrStr(hr))
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    // ---- Check / switch device profile on the first enumerated device ----
    // The DeckLink 8K Pro must be in "2 Sub-Devices Full Duplex" profile
    // for both SDI pairs (1+2 and 3+4) to support independent Fill+Key output.
    {
        IDeckLink* first = nullptr;
        if (iter->Next(&first) == S_OK) {

            // Read current profile
            IDeckLinkProfileAttributes* attrs = nullptr;
            LONGLONG curProfile = 0, numSub = 0, subIdx = 0;
            BOOL hasMonitor = FALSE, supExtKey = FALSE;
            if (SUCCEEDED(first->QueryInterface(__uuidof(IDeckLinkProfileAttributes),
                    reinterpret_cast<void**>(&attrs))) && attrs) {
                attrs->GetInt (BMDDeckLinkProfileID_Attr,         &curProfile);
                attrs->GetInt (BMDDeckLinkNumberOfSubDevices,     &numSub);
                attrs->GetInt (BMDDeckLinkSubDeviceIndex,         &subIdx);
                attrs->GetFlag(BMDDeckLinkHasMonitorOut,          &hasMonitor);
                attrs->GetFlag(BMDDeckLinkSupportsExternalKeying, &supExtKey);
                attrs->Release();
            }
            fprintf(stderr,
                "[DeckLink] Profile check: current=0x%08X  subDevices=%lld  "
                "subIdx=%lld  monitorOut=%s  externalKey=%s\n",
                (unsigned)curProfile, numSub, subIdx,
                hasMonitor ? "yes" : "no",
                supExtKey  ? "yes" : "no");

            // If not already "2 Sub-Devices Full Duplex", attempt to switch
            if (curProfile != (LONGLONG)bmdProfileTwoSubDevicesFullDuplex) {
                fprintf(stderr,
                    "[DeckLink] Profile is not '2dfd' — switching to "
                    "TwoSubDevicesFullDuplex (0x%08X)...\n",
                    (unsigned)bmdProfileTwoSubDevicesFullDuplex);

                IDeckLinkProfileManager* mgr = nullptr;
                bool switched = false;
                if (SUCCEEDED(first->QueryInterface(__uuidof(IDeckLinkProfileManager),
                        reinterpret_cast<void**>(&mgr))) && mgr) {
                    IDeckLinkProfile* target = nullptr;
                    if (SUCCEEDED(mgr->GetProfile(bmdProfileTwoSubDevicesFullDuplex,
                            &target)) && target) {
                        BOOL isActive = FALSE;
                        target->IsActive(&isActive);
                        if (!isActive) {
                            HRESULT hrSet = target->SetActive();
                            if (SUCCEEDED(hrSet)) {
                                switched = true;
                                fprintf(stderr,
                                    "[DeckLink] Profile switch requested — "
                                    "please restart the DeckLink output app.\n");
                            } else {
                                fprintf(stderr,
                                    "[DeckLink] Profile switch failed: %s\n",
                                    hrStr(hrSet).c_str());
                            }
                        }
                        target->Release();
                    }
                    mgr->Release();
                }
                first->Release();
                iter->Release();
                if (switched) {
                    Napi::Error::New(env,
                        "DeckLink profile changed to '2 Sub-Devices Full Duplex'. "
                        "Please restart this application for the change to take effect.")
                        .ThrowAsJavaScriptException();
                } else {
                    Napi::Error::New(env,
                        "DeckLink profile is not '2 Sub-Devices Full Duplex' (0x32646664). "
                        "Open Blackmagic Desktop Video Setup, select the DeckLink 8K Pro, "
                        "and switch the profile to '2 Sub-Devices Full Duplex', "
                        "then restart this app.")
                        .ThrowAsJavaScriptException();
                }
                return env.Undefined();
            }

            // Re-insert the first device back by re-creating the iterator
            first->Release();
        }
        iter->Release();

        // Re-enumerate from scratch (iterator is exhausted / reset needed)
        hr = CoCreateInstance(CLSID_CDeckLinkIterator, nullptr, CLSCTX_ALL,
            __uuidof(IDeckLinkIterator), reinterpret_cast<void**>(&iter));
        if (FAILED(hr)) {
            Napi::Error::New(env, "CoCreateInstance(re-enumerate) failed: " + hrStr(hr))
                .ThrowAsJavaScriptException();
            return env.Undefined();
        }
    }

    g_state.deviceCount = 0;
    IDeckLink* dl = nullptr;

    while (g_state.deviceCount < k_MaxDevices && iter->Next(&dl) == S_OK) {
        const int idx = g_state.deviceCount;
        PerDevice& dev = g_state.devices[idx];

        // Log device name
        BSTR name = nullptr;
        if (SUCCEEDED(dl->GetDisplayName(&name)) && name) {
            char narrow[256] = {};
            WideCharToMultiByte(CP_UTF8, 0, name, -1, narrow, sizeof(narrow), nullptr, nullptr);
            SysFreeString(name);
            fprintf(stderr, "[DeckLink] Device %d: %s\n", idx, narrow);
        }

        // Get IDeckLinkOutput
        hr = dl->QueryInterface(__uuidof(IDeckLinkOutput),
                                reinterpret_cast<void**>(&dev.output));
        if (FAILED(hr)) {
            fprintf(stderr, "[DeckLink] Device %d: QueryInterface(IDeckLinkOutput) failed %s — skipped\n",
                    idx, hrStr(hr).c_str());
            dl->Release(); dl = nullptr;
            continue;
        }

        // Keyer (optional)
        dl->QueryInterface(__uuidof(IDeckLinkKeyer),
                           reinterpret_cast<void**>(&dev.keyer));
        dl->Release(); dl = nullptr;

        // Enable video output — 1080i50
        hr = dev.output->EnableVideoOutput(bmdModeHD1080i50, bmdVideoOutputFlagDefault);
        if (FAILED(hr)) {
            fprintf(stderr, "[DeckLink] Device %d: EnableVideoOutput failed %s — skipped\n",
                    idx, hrStr(hr).c_str());
            dev.output->Release(); dev.output = nullptr;
            if (dev.keyer) { dev.keyer->Release(); dev.keyer = nullptr; }
            continue;
        }

        // External key: SDI odd = Fill, SDI even = Key
        if (dev.keyer) {
            dev.keyer->Enable(TRUE);  // TRUE = external key
            dev.keyer->SetLevel(255); // full key level
        } else {
            fprintf(stderr, "[DeckLink] Device %d: no keyer interface — Fill only\n", idx);
        }

        // Allocate SDK-managed frame pool
        bool poolOk = true;
        for (int i = 0; i < k_PrerollFrames; ++i) {
            hr = dev.output->CreateVideoFrame(
                1920, 1080, 1920 * 4,
                bmdFormat8BitARGB,
                bmdFrameFlagDefault,
                &dev.pool[i]);
            if (FAILED(hr) || !dev.pool[i]) {
                fprintf(stderr, "[DeckLink] Device %d: CreateVideoFrame[%d] failed %s\n",
                        idx, i, hrStr(hr).c_str());
                poolOk = false; break;
            }
            // Zero-fill (black + transparent preroll)
            IDeckLinkVideoBuffer* vbuf = nullptr;
            if (SUCCEEDED(dev.pool[i]->QueryInterface(
                    __uuidof(IDeckLinkVideoBuffer), reinterpret_cast<void**>(&vbuf))) && vbuf) {
                vbuf->StartAccess(bmdBufferAccessWrite);
                void* px = nullptr;
                if (SUCCEEDED(vbuf->GetBytes(&px)) && px)
                    memset(px, 0, 1920 * 1080 * 4);
                vbuf->EndAccess(bmdBufferAccessWrite);
                vbuf->Release();
            }
        }
        if (!poolOk) {
            for (int i = 0; i < k_PrerollFrames; ++i)
                if (dev.pool[i]) { dev.pool[i]->Release(); dev.pool[i] = nullptr; }
            if (dev.keyer)  { dev.keyer->Release();  dev.keyer  = nullptr; }
            dev.output->DisableVideoOutput();
            dev.output->Release(); dev.output = nullptr;
            continue;
        }

        // Register callback
        g_callbacks[idx] = new OutputCallback(&dev);
        dev.output->SetScheduledFrameCompletionCallback(g_callbacks[idx]);

        // Query hardware clock for preroll start time
        BMDTimeValue hwTime = 0, timeInFrame = 0, ticksPerFrame = 0;
        if (FAILED(dev.output->GetHardwareReferenceClock(
                k_TimeScale, &hwTime, &timeInFrame, &ticksPerFrame)))
            hwTime = static_cast<BMDTimeValue>(k_ClockMargin + k_PrerollFrames) * k_FrameDuration;

        BMDTimeValue prerollBase =
            (hwTime / k_FrameDuration + static_cast<BMDTimeValue>(k_ClockMargin)) * k_FrameDuration;

        // Schedule preroll frames
        bool schedOk = true;
        for (int i = 0; i < k_PrerollFrames; ++i) {
            BMDTimeValue t = prerollBase + static_cast<BMDTimeValue>(i) * k_FrameDuration;
            hr = dev.output->ScheduleVideoFrame(dev.pool[i], t, k_FrameDuration, k_TimeScale);
            if (FAILED(hr)) {
                fprintf(stderr, "[DeckLink] Device %d: ScheduleVideoFrame preroll[%d] failed %s\n",
                        idx, i, hrStr(hr).c_str());
                schedOk = false; break;
            }
        }
        if (!schedOk) { releaseDevice(idx); continue; }

        dev.nextFrameTime.store(
            prerollBase / k_FrameDuration + static_cast<BMDTimeValue>(k_PrerollFrames),
            std::memory_order_release);

        // Start playback
        hr = dev.output->StartScheduledPlayback(prerollBase, k_TimeScale, 1.0);
        if (FAILED(hr)) {
            fprintf(stderr, "[DeckLink] Device %d: StartScheduledPlayback failed %s\n",
                    idx, hrStr(hr).c_str());
            releaseDevice(idx); continue;
        }

        fprintf(stderr, "[DeckLink] Device %d: 1080i50 Fill+Key started\n", idx);
        g_state.deviceCount++;
    }
    iter->Release();

    if (g_state.deviceCount == 0) {
        Napi::Error::New(env, "No DeckLink device could be opened for 1080i50 output")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    fprintf(stderr, "[DeckLink] %d device(s) active\n", g_state.deviceCount);
    g_state.running.store(true, std::memory_order_release);
    return env.Undefined();
}

// ---------------------------------------------------------------------------
// JS: close()
// ---------------------------------------------------------------------------
static Napi::Value Close(const Napi::CallbackInfo& info) {
    std::lock_guard<std::mutex> lock(g_state.mtx);
    if (!g_state.running.load(std::memory_order_acquire)) return info.Env().Undefined();

    g_state.running.store(false, std::memory_order_release);

    for (int d = 0; d < g_state.deviceCount; ++d)
        releaseDevice(d);

    g_state.deviceCount = 0;

    {
        std::lock_guard<std::mutex> sl(g_state.stagingMtx);
        g_state.stagingBGRA.clear();
    }

    fprintf(stderr, "[DeckLink] All devices closed\n");
    return info.Env().Undefined();
}

// ---------------------------------------------------------------------------
// JS: scheduleFrame(Buffer)
//   Called from Electron's offscreen paint event at 25 fps.
//   Copies the raw BGRA bitmap into the shared staging buffer.
// ---------------------------------------------------------------------------
static Napi::Value ScheduleFrame(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsBuffer()) {
        Napi::TypeError::New(env, "scheduleFrame expects a Buffer")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }
    if (!g_state.running.load(std::memory_order_acquire)) return env.Undefined();

    auto         buf  = info[0].As<Napi::Buffer<uint8_t>>();
    const size_t len  = buf.ByteLength();
    if (len != 1920u * 1080u * 4u) return env.Undefined();

    std::lock_guard<std::mutex> lk(g_state.stagingMtx);
    if (g_state.stagingBGRA.size() != len)
        g_state.stagingBGRA.resize(len);
    std::memcpy(g_state.stagingBGRA.data(), buf.Data(), len);

    return env.Undefined();
}

// ---------------------------------------------------------------------------
// Module initialisation
// ---------------------------------------------------------------------------
Napi::Object Init(Napi::Env env, Napi::Object exports) {
    CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    exports.Set("open",          Napi::Function::New(env, Open));
    exports.Set("close",         Napi::Function::New(env, Close));
    exports.Set("scheduleFrame", Napi::Function::New(env, ScheduleFrame));
    return exports;
}

NODE_API_MODULE(decklink, Init)
