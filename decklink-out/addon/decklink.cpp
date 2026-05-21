// decklink.cpp
// Electron N-API addon: renders video to Blackmagic DeckLink output.
//
// JS API:
//   open(deviceIndex?, displayModeId?, keyerMode?)
//     deviceIndex  – 0-based DeckLink sub-device index (default 0)
//     displayModeId – string key from k_Modes table, e.g. "HD1080i50" (default)
//     keyerMode    – "external" | "internal" | "fill_only" (default "external")
//
//   scheduleFrame(Buffer)  – called each paint, BGRA → ARGB conversion
//   close()                – tear down cleanly

#include "DeckLinkAPI_manual.h"

#include <napi.h>
#include <objbase.h>

#include <algorithm>
#include <atomic>
#include <cstdint>
#include <cstring>
#include <mutex>
#include <string>
#include <vector>

// ---------------------------------------------------------------------------
// Supported display modes table
// ---------------------------------------------------------------------------
struct ModeInfo {
    const char*    id;           // JS-facing string
    BMDDisplayMode bmdMode;
    int            width;
    int            height;
    BMDTimeScale   timeScale;
    BMDTimeValue   frameDuration;
    const char*    label;        // human-readable for logs
};

static const ModeInfo k_Modes[] = {
    // id               bmdMode        w      h     timeScale  frameDur   label
    { "HD1080i50",   bmdModeHD1080i50,   1920, 1080,  25000,  1000, "1080i 50"     },
    { "HD1080i5994", bmdModeHD1080i5994, 1920, 1080,  30000,  1001, "1080i 59.94"  },
    { "HD1080i6000", bmdModeHD1080i6000, 1920, 1080,  30000,  1000, "1080i 60"     },
    { "HD1080p2398", bmdModeHD1080p2398, 1920, 1080,  24000,  1001, "1080p 23.98"  },
    { "HD1080p24",   bmdModeHD1080p24,   1920, 1080,  24000,  1000, "1080p 24"     },
    { "HD1080p25",   bmdModeHD1080p25,   1920, 1080,  25000,  1000, "1080p 25"     },
    { "HD1080p2997", bmdModeHD1080p2997, 1920, 1080,  30000,  1001, "1080p 29.97"  },
    { "HD1080p30",   bmdModeHD1080p30,   1920, 1080,  30000,  1000, "1080p 30"     },
    { "HD1080p50",   bmdModeHD1080p50,   1920, 1080,  50000,  1000, "1080p 50"     },
    { "HD1080p5994", bmdModeHD1080p5994, 1920, 1080,  60000,  1001, "1080p 59.94"  },
    { "HD1080p6000", bmdModeHD1080p6000, 1920, 1080,  60000,  1000, "1080p 60"     },
    { "HD720p50",    bmdModeHD720p50,    1280,  720,  50000,  1000, "720p 50"      },
    { "HD720p5994",  bmdModeHD720p5994,  1280,  720,  60000,  1001, "720p 59.94"   },
    { "HD720p60",    bmdModeHD720p60,    1280,  720,  60000,  1000, "720p 60"      },
};
static constexpr int k_NumModes = static_cast<int>(sizeof(k_Modes) / sizeof(k_Modes[0]));

static const ModeInfo* findMode(const std::string& id) {
    for (int i = 0; i < k_NumModes; ++i)
        if (id == k_Modes[i].id) return &k_Modes[i];
    return nullptr; // not found
}

// ---------------------------------------------------------------------------
// Keyer mode
// ---------------------------------------------------------------------------
enum class KeyerMode { External, Internal, FillOnly };

static KeyerMode parseKeyerMode(const std::string& s) {
    if (s == "internal")  return KeyerMode::Internal;
    if (s == "fill_only") return KeyerMode::FillOnly;
    return KeyerMode::External; // default
}

// ---------------------------------------------------------------------------
// Preroll / clock constants (device-independent)
// ---------------------------------------------------------------------------
static constexpr int k_PrerollFrames = 3;
static constexpr int k_ClockMargin   = 6;
static constexpr int k_MaxDevices    = 1; // one device per process

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

    // Active mode geometry & timing (set in Open, read in scheduleFrame / callback)
    int            activeWidth         = 1920;
    int            activeHeight        = 1080;
    BMDTimeScale   activeTimeScale     = 25000;
    BMDTimeValue   activeFrameDuration = 1000;

    // Staging buffer: latest frame pre-converted BGRA→ARGB.
    std::vector<uint8_t> stagingARGB;
    std::mutex           stagingMtx;

    std::mutex           mtx; // guards open / close
};
static State g_state;

// ---------------------------------------------------------------------------
// OutputCallback — runs on the DeckLink driver thread
// ---------------------------------------------------------------------------
class OutputCallback final : public IDeckLinkVideoOutputCallback {
public:
    explicit OutputCallback(PerDevice* dev) : m_dev(dev), m_ref(1) {}

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

        const size_t frameBytes =
            static_cast<size_t>(g_state.activeWidth) *
            static_cast<size_t>(g_state.activeHeight) * 4u;

        IDeckLinkVideoBuffer* buf = nullptr;
        if (SUCCEEDED(completedFrame->QueryInterface(
                __uuidof(IDeckLinkVideoBuffer),
                reinterpret_cast<void**>(&buf))) && buf)
        {
            buf->StartAccess(bmdBufferAccessWrite);
            void* pixels = nullptr;
            if (SUCCEEDED(buf->GetBytes(&pixels)) && pixels) {
                std::lock_guard<std::mutex> lk(g_state.stagingMtx);
                if (g_state.stagingARGB.size() == frameBytes)
                    std::memcpy(pixels, g_state.stagingARGB.data(), frameBytes);
            }
            buf->EndAccess(bmdBufferAccessWrite);
            buf->Release();
        }

        if (!g_state.running.load(std::memory_order_acquire)) return S_OK;

        BMDTimeValue slot = m_dev->nextFrameTime.fetch_add(1, std::memory_order_relaxed);
        m_dev->output->ScheduleVideoFrame(
            completedFrame,
            slot * g_state.activeFrameDuration,
            g_state.activeFrameDuration,
            g_state.activeTimeScale);

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

    for (int i = 0; i < k_PrerollFrames; ++i)
        if (dev.pool[i]) { dev.pool[i]->Release(); dev.pool[i] = nullptr; }

    dev.output->Release(); dev.output = nullptr;
}

// ---------------------------------------------------------------------------
// JS: open(deviceIndex?, displayModeId?, keyerMode?)
// ---------------------------------------------------------------------------
static Napi::Value Open(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    std::lock_guard<std::mutex> lock(g_state.mtx);

    if (g_state.running.load()) {
        Napi::Error::New(env, "DeckLink already open").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    // ---- Parse arguments ----
    int targetDeviceIdx = 0;
    if (info.Length() >= 1 && info[0].IsNumber())
        targetDeviceIdx = std::max(0, info[0].As<Napi::Number>().Int32Value());

    std::string displayModeId = "HD1080i50";
    if (info.Length() >= 2 && info[1].IsString())
        displayModeId = info[1].As<Napi::String>().Utf8Value();

    std::string keyerModeStr = "external";
    if (info.Length() >= 3 && info[2].IsString())
        keyerModeStr = info[2].As<Napi::String>().Utf8Value();

    // ---- Resolve display mode ----
    const ModeInfo* mode = findMode(displayModeId);
    if (!mode) {
        Napi::Error::New(env, "Unknown display mode: " + displayModeId)
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    KeyerMode keyerMode = parseKeyerMode(keyerModeStr);

    fprintf(stderr,
        "[DeckLink] open() — sub-device=%d  mode=%s (%s)  keyer=%s\n",
        targetDeviceIdx, mode->id, mode->label, keyerModeStr.c_str());

    // Store active geometry so scheduleFrame and the callback can use it
    g_state.activeWidth         = mode->width;
    g_state.activeHeight        = mode->height;
    g_state.activeTimeScale     = mode->timeScale;
    g_state.activeFrameDuration = mode->frameDuration;

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
    {
        IDeckLink* first = nullptr;
        if (iter->Next(&first) == S_OK) {
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

            if (curProfile != (LONGLONG)bmdProfileTwoSubDevicesFullDuplex) {
                fprintf(stderr,
                    "[DeckLink] Profile is not '2dfd' (current=0x%08X) — switching to "
                    "2 Sub-Devices Full Duplex...\n", (unsigned)curProfile);

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
                            if (SUCCEEDED(hrSet)) switched = true;
                        }
                        target->Release();
                    }
                    mgr->Release();
                }
                first->Release();
                iter->Release();
                if (switched) {
                    Napi::Error::New(env,
                        "DeckLink profile changed to '2 Sub-Devices Full Duplex' (2dfd). "
                        "Please restart this application.")
                        .ThrowAsJavaScriptException();
                } else {
                    Napi::Error::New(env,
                        "DeckLink profile is not '2 Sub-Devices Full Duplex' (2dfd). "
                        "Open Blackmagic Desktop Video Setup and switch the profile.")
                        .ThrowAsJavaScriptException();
                }
                return env.Undefined();
            }

            first->Release();
        }
        iter->Release();

        hr = CoCreateInstance(CLSID_CDeckLinkIterator, nullptr, CLSCTX_ALL,
            __uuidof(IDeckLinkIterator), reinterpret_cast<void**>(&iter));
        if (FAILED(hr)) {
            Napi::Error::New(env, "CoCreateInstance(re-enumerate) failed: " + hrStr(hr))
                .ThrowAsJavaScriptException();
            return env.Undefined();
        }
    }

    // ---- Enumerate output-capable devices, open the targetDeviceIdx-th one ----
    // In '2dfd' mode the iterator yields [out0, in0, out1, in1]; input sub-devices
    // do not support any output mode, so DoesSupportVideoMode filters them out
    // transparently.  targetDeviceIdx therefore counts only output-capable devices.
    g_state.deviceCount = 0;
    IDeckLink* dl = nullptr;
    int outputIdx = 0;  // count of output-capable devices seen so far

    while (iter->Next(&dl) == S_OK) {
        // ---- Quick output-capability check ----
        IDeckLinkOutput* testOut = nullptr;
        if (FAILED(dl->QueryInterface(__uuidof(IDeckLinkOutput),
                reinterpret_cast<void**>(&testOut))) || !testOut) {
            dl->Release(); dl = nullptr;
            continue;  // no output interface at all
        }

        BMDDisplayMode actualMode = 0;
        BOOL supported = FALSE;
        testOut->DoesSupportVideoMode(
            bmdVideoConnectionUnspecified,
            mode->bmdMode,
            bmdFormat8BitARGB,
            bmdNoVideoOutputConversion,
            bmdSupportedVideoModeDefault,
            &actualMode,
            &supported);

        if (!supported) {
            testOut->Release(); testOut = nullptr;
            dl->Release(); dl = nullptr;
            continue;  // input-only or mode not supported — skip
        }

        if (outputIdx < targetDeviceIdx) {
            testOut->Release(); testOut = nullptr;
            dl->Release(); dl = nullptr;
            outputIdx++;
            continue;  // not the requested output index yet
        }

        // ---- This is our target device ----
        const int idx = 0;
        PerDevice& dev = g_state.devices[idx];
        dev.output = testOut;  // reuse already-QI'd interface
        testOut = nullptr;

        // Log device name
        BSTR name = nullptr;
        if (SUCCEEDED(dl->GetDisplayName(&name)) && name) {
            char narrow[256] = {};
            WideCharToMultiByte(CP_UTF8, 0, name, -1, narrow, sizeof(narrow), nullptr, nullptr);
            SysFreeString(name);
            fprintf(stderr, "[DeckLink] Opening output sub-device %d: %s\n",
                    targetDeviceIdx, narrow);
        }

        // Get keyer interface (optional) and attributes before releasing dl
        dl->QueryInterface(__uuidof(IDeckLinkKeyer),
                           reinterpret_cast<void**>(&dev.keyer));
        {
            IDeckLinkProfileAttributes* devAttrs = nullptr;
            if (SUCCEEDED(dl->QueryInterface(__uuidof(IDeckLinkProfileAttributes),
                    reinterpret_cast<void**>(&devAttrs))) && devAttrs) {
                BOOL supExt = FALSE;
                devAttrs->GetFlag(BMDDeckLinkSupportsExternalKeying, &supExt);
                fprintf(stderr, "[DeckLink] Output sub-device %d: supportsExternalKeying=%s\n",
                        targetDeviceIdx, supExt ? "yes" : "no");
                devAttrs->Release();
            }
        }

        dl->Release(); dl = nullptr;

        // Enable video output with selected mode
        hr = dev.output->EnableVideoOutput(mode->bmdMode, bmdVideoOutputFlagDefault);
        if (FAILED(hr)) {
            fprintf(stderr, "[DeckLink] EnableVideoOutput(%s) failed %s\n",
                    mode->id, hrStr(hr).c_str());
            dev.output->Release(); dev.output = nullptr;
            if (dev.keyer) { dev.keyer->Release(); dev.keyer = nullptr; }
            break;
        }

        // Configure keyer
        if (keyerMode == KeyerMode::FillOnly) {
            // No keyer — just output Fill
            if (dev.keyer) {
                dev.keyer->Disable();
                dev.keyer->Release(); dev.keyer = nullptr;
            }
            fprintf(stderr, "[DeckLink] Keyer: Fill only (no key output)\n");
        } else if (dev.keyer) {
            BOOL isExternal = (keyerMode == KeyerMode::External) ? TRUE : FALSE;
            HRESULT hrEnable = dev.keyer->Enable(isExternal);
            HRESULT hrLevel  = dev.keyer->SetLevel(255);
            if (FAILED(hrEnable)) {
                fprintf(stderr, "[DeckLink] WARNING: Keyer Enable(%s) failed %s — key signal may not be output\n",
                        isExternal ? "external" : "internal", hrStr(hrEnable).c_str());
            } else if (FAILED(hrLevel)) {
                fprintf(stderr, "[DeckLink] WARNING: Keyer SetLevel(255) failed %s\n",
                        hrStr(hrLevel).c_str());
            }
            fprintf(stderr, "[DeckLink] Keyer: %s (Enable hr=%s)\n",
                    isExternal ? "External (Fill SDI1 + Key SDI2)" : "Internal (composited on SDI1)",
                    hrStr(hrEnable).c_str());
        } else {
            fprintf(stderr, "[DeckLink] Keyer interface not available — Fill only\n");
        }

        // Allocate frame pool (dynamic size)
        const int   W    = mode->width;
        const int   H    = mode->height;
        const int   rowB = W * 4;

        bool poolOk = true;
        for (int i = 0; i < k_PrerollFrames; ++i) {
            hr = dev.output->CreateVideoFrame(W, H, rowB,
                bmdFormat8BitARGB, bmdFrameFlagDefault, &dev.pool[i]);
            if (FAILED(hr) || !dev.pool[i]) {
                fprintf(stderr, "[DeckLink] CreateVideoFrame[%d] failed %s\n",
                        i, hrStr(hr).c_str());
                poolOk = false; break;
            }
            // Zero-fill (transparent black preroll)
            IDeckLinkVideoBuffer* vbuf = nullptr;
            if (SUCCEEDED(dev.pool[i]->QueryInterface(
                    __uuidof(IDeckLinkVideoBuffer), reinterpret_cast<void**>(&vbuf))) && vbuf) {
                vbuf->StartAccess(bmdBufferAccessWrite);
                void* px = nullptr;
                if (SUCCEEDED(vbuf->GetBytes(&px)) && px)
                    memset(px, 0, static_cast<size_t>(rowB) * H);
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
            break;
        }

        // Register callback
        g_callbacks[idx] = new OutputCallback(&dev);
        dev.output->SetScheduledFrameCompletionCallback(g_callbacks[idx]);

        // Query hardware clock
        BMDTimeValue hwTime = 0, timeInFrame = 0, ticksPerFrame = 0;
        if (FAILED(dev.output->GetHardwareReferenceClock(
                mode->timeScale, &hwTime, &timeInFrame, &ticksPerFrame)))
            hwTime = static_cast<BMDTimeValue>(k_ClockMargin + k_PrerollFrames) * mode->frameDuration;

        BMDTimeValue prerollBase =
            (hwTime / mode->frameDuration + static_cast<BMDTimeValue>(k_ClockMargin)) * mode->frameDuration;

        // Schedule preroll frames
        bool schedOk = true;
        for (int i = 0; i < k_PrerollFrames; ++i) {
            BMDTimeValue t = prerollBase + static_cast<BMDTimeValue>(i) * mode->frameDuration;
            hr = dev.output->ScheduleVideoFrame(dev.pool[i], t, mode->frameDuration, mode->timeScale);
            if (FAILED(hr)) {
                fprintf(stderr, "[DeckLink] ScheduleVideoFrame preroll[%d] failed %s\n",
                        i, hrStr(hr).c_str());
                schedOk = false; break;
            }
        }
        if (!schedOk) { releaseDevice(idx); break; }

        dev.nextFrameTime.store(
            prerollBase / mode->frameDuration + static_cast<BMDTimeValue>(k_PrerollFrames),
            std::memory_order_release);

        hr = dev.output->StartScheduledPlayback(prerollBase, mode->timeScale, 1.0);
        if (FAILED(hr)) {
            fprintf(stderr, "[DeckLink] StartScheduledPlayback failed %s\n", hrStr(hr).c_str());
            releaseDevice(idx); break;
        }

        fprintf(stderr, "[DeckLink] Sub-device %d: %s output started OK\n",
                targetDeviceIdx, mode->label);
        g_state.deviceCount = 1;
        break;
    }
    iter->Release();

    if (g_state.deviceCount == 0) {
        Napi::Error::New(env,
            "DeckLink sub-device " + std::to_string(targetDeviceIdx) +
            " not found or could not be opened for " + displayModeId + " output")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    fprintf(stderr, "[DeckLink] Device active — sub-device=%d  mode=%s  keyer=%s\n",
            targetDeviceIdx, mode->label, keyerModeStr.c_str());
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
        g_state.stagingARGB.clear();
    }

    fprintf(stderr, "[DeckLink] Device closed\n");
    return info.Env().Undefined();
}

// ---------------------------------------------------------------------------
// JS: scheduleFrame(Buffer)
//   Converts BGRA (Electron) → ARGB (DeckLink bmdFormat8BitARGB)
// ---------------------------------------------------------------------------
static Napi::Value ScheduleFrame(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsBuffer()) {
        Napi::TypeError::New(env, "scheduleFrame expects a Buffer")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }
    if (!g_state.running.load(std::memory_order_acquire)) return env.Undefined();

    auto           buf  = info[0].As<Napi::Buffer<uint8_t>>();
    const size_t   len  = buf.ByteLength();
    const size_t   expected =
        static_cast<size_t>(g_state.activeWidth) *
        static_cast<size_t>(g_state.activeHeight) * 4u;

    if (len != expected) return env.Undefined();

    const uint8_t* bgra = buf.Data();

    std::lock_guard<std::mutex> lk(g_state.stagingMtx);
    if (g_state.stagingARGB.size() != len)
        g_state.stagingARGB.resize(len);

    // BGRA → ARGB
    uint8_t*     argb = g_state.stagingARGB.data();
    const size_t n    = static_cast<size_t>(g_state.activeWidth) * g_state.activeHeight;
    for (size_t i = 0; i < n; ++i) {
        argb[0] = bgra[3]; // A
        argb[1] = bgra[2]; // R
        argb[2] = bgra[1]; // G
        argb[3] = bgra[0]; // B
        bgra += 4; argb += 4;
    }

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
