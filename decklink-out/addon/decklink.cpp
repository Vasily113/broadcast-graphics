// decklink.cpp
// Electron N-API addon: renders 1080i50 Fill+Key to Blackmagic DeckLink 8K Pro.
//
// Architecture (pull model):
//   - Open(): creates SDK-managed frames via CreateVideoFrame(), pre-schedules
//     k_PrerollFrames black frames, starts scheduled playback.
//   - scheduleFrame(Buffer): called from Electron paint at 50 fps.
//     Copies the BGRA bitmap into a thread-safe staging buffer.
//   - ScheduledFrameCompleted() (driver thread): reads staging buffer,
//     converts BGRA→ARGB into the just-completed frame, then reschedules it.
//     This keeps exactly k_PrerollFrames frames "in flight" at all times.
//   - Close(): tears down safely; running flag prevents use-after-free.

// DeckLinkAPI_manual.h already includes windows.h with WIN32_LEAN_AND_MEAN/NOMINMAX
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
//   TimeScale = 25 000 ticks/s  →  FrameDuration = 1 000 ticks/frame  (= 1/25 s)
// ---------------------------------------------------------------------------
static constexpr BMDTimeScale k_TimeScale     = 25000;
static constexpr BMDTimeValue k_FrameDuration = 1000;
static constexpr int          k_PrerollFrames = 3;   // frames to queue before StartScheduledPlayback
static constexpr int          k_ClockMargin   = 6;   // extra frames beyond hw clock when prerolling

// ---------------------------------------------------------------------------
// Global state
// ---------------------------------------------------------------------------
struct State {
    // COM interfaces (owned by main thread; only valid while running==true)
    IDeckLinkOutput*         output  = nullptr;
    IDeckLinkKeyer*          keyer   = nullptr;

    // Frame pool — SDK-managed frames (CreateVideoFrame)
    IDeckLinkMutableVideoFrame* pool[k_PrerollFrames] = {};

    // Playback control
    std::atomic<bool>         running{false};
    std::atomic<BMDTimeValue> nextFrameTime{0};  // next display-time counter (in frame units)

    // Staging buffer: latest BGRA from Electron's paint callback
    std::vector<uint8_t> stagingBGRA;
    bool                 stagingFresh = false;
    std::mutex           stagingMtx;

    // Main-thread lock (guards open/close)
    std::mutex mtx;
};
static State g_state;

// ---------------------------------------------------------------------------
// OutputCallback  (implements IDeckLinkVideoOutputCallback)
// Runs on the DeckLink driver thread.
// ---------------------------------------------------------------------------
class OutputCallback final : public IDeckLinkVideoOutputCallback {
public:
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

    // IDeckLinkVideoOutputCallback
    HRESULT STDMETHODCALLTYPE ScheduledPlaybackHasStopped() override { return S_OK; }

    HRESULT STDMETHODCALLTYPE ScheduledFrameCompleted(
        IDeckLinkVideoFrame*          completedFrame,
        BMDOutputFrameCompletionResult result) override
    {
        // Bail out immediately if we're shutting down or frame was flushed
        if (!g_state.running.load(std::memory_order_acquire)) return S_OK;
        if (result == bmdOutputFrameFlushed)                   return S_OK;

        // ---- Update frame pixels from staging buffer ----
        IDeckLinkVideoBuffer* buf = nullptr;
        if (SUCCEEDED(completedFrame->QueryInterface(
                __uuidof(IDeckLinkVideoBuffer),
                reinterpret_cast<void**>(&buf))) && buf)
        {
            buf->StartAccess(bmdBufferAccessWrite);
            void* pixels = nullptr;
            if (SUCCEEDED(buf->GetBytes(&pixels)) && pixels) {
                std::lock_guard<std::mutex> lk(g_state.stagingMtx);
                if (g_state.stagingFresh &&
                    g_state.stagingBGRA.size() == 1920u * 1080u * 4u)
                {
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
                    g_state.stagingFresh = false;
                }
            }
            buf->EndAccess(bmdBufferAccessWrite);
            buf->Release();
        }

        // ---- Reschedule this frame at the next display slot ----
        // Load running once more (Close() may have fired during pixel copy)
        if (!g_state.running.load(std::memory_order_acquire)) return S_OK;

        BMDTimeValue slot = g_state.nextFrameTime.fetch_add(1, std::memory_order_relaxed);
        g_state.output->ScheduleVideoFrame(
            completedFrame,
            slot * k_FrameDuration,
            k_FrameDuration,
            k_TimeScale);

        return S_OK;
    }

private:
    std::atomic<ULONG> m_ref{1};
};

static OutputCallback* g_callback = nullptr;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
static std::string hrStr(HRESULT hr) {
    char buf[24];
    sprintf_s(buf, sizeof(buf), "0x%08X", static_cast<unsigned>(hr));
    return buf;
}

// ---------------------------------------------------------------------------
// JS: open()  — initialize DeckLink, pre-schedule black frames, start playback
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

    IDeckLink* dl = nullptr;
    hr = iter->Next(&dl);
    iter->Release();
    if (FAILED(hr) || !dl) {
        Napi::Error::New(env, "No DeckLink device found").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    // ---- Get output interface ----
    hr = dl->QueryInterface(__uuidof(IDeckLinkOutput),
                            reinterpret_cast<void**>(&g_state.output));
    if (FAILED(hr)) {
        dl->Release();
        Napi::Error::New(env, "QueryInterface(IDeckLinkOutput) failed: " + hrStr(hr))
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    // ---- Keyer (optional — don't fail if not available) ----
    dl->QueryInterface(__uuidof(IDeckLinkKeyer),
                       reinterpret_cast<void**>(&g_state.keyer));
    dl->Release();

    // ---- Enable video output — 1080i50 ----
    hr = g_state.output->EnableVideoOutput(bmdModeHD1080i50, bmdVideoOutputFlagDefault);
    if (FAILED(hr)) {
        g_state.output->Release(); g_state.output = nullptr;
        if (g_state.keyer) { g_state.keyer->Release(); g_state.keyer = nullptr; }
        Napi::Error::New(env, "EnableVideoOutput(1080i50) failed: " + hrStr(hr))
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    // ---- Enable external keyer at full opacity ----
    // TRUE  = external key: SDI1&3 = Fill (RGB), SDI2&4 = Key (alpha as luma)
    // FALSE = internal key: composites Fill+Key over SDI input and outputs result
    if (g_state.keyer) {
        g_state.keyer->Enable(TRUE);  // TRUE = external key
        g_state.keyer->SetLevel(255); // 255 = full key signal
    }

    // ---- Allocate SDK-managed frame pool ----
    for (int i = 0; i < k_PrerollFrames; ++i) {
        hr = g_state.output->CreateVideoFrame(
            1920, 1080, 1920 * 4,
            bmdFormat8BitARGB,
            bmdFrameFlagDefault,
            &g_state.pool[i]);
        if (FAILED(hr) || !g_state.pool[i]) {
            // Cleanup already-created frames
            for (int j = 0; j < i; ++j) {
                g_state.pool[j]->Release(); g_state.pool[j] = nullptr;
            }
            if (g_state.keyer)  { g_state.keyer->Release();  g_state.keyer  = nullptr; }
            g_state.output->DisableVideoOutput();
            g_state.output->Release(); g_state.output = nullptr;
            Napi::Error::New(env, "CreateVideoFrame[" + std::to_string(i) + "] failed: " + hrStr(hr))
                .ThrowAsJavaScriptException();
            return env.Undefined();
        }
        // Zero the frame buffer (black/transparent)
        IDeckLinkVideoBuffer* buf = nullptr;
        if (SUCCEEDED(g_state.pool[i]->QueryInterface(
                __uuidof(IDeckLinkVideoBuffer), reinterpret_cast<void**>(&buf))) && buf) {
            buf->StartAccess(bmdBufferAccessWrite);
            void* px = nullptr;
            if (SUCCEEDED(buf->GetBytes(&px)) && px)
                memset(px, 0, 1920 * 1080 * 4);
            buf->EndAccess(bmdBufferAccessWrite);
            buf->Release();
        }
    }

    // ---- Register callback ----
    g_callback = new OutputCallback();
    g_state.output->SetScheduledFrameCompletionCallback(g_callback);

    // ---- Query hardware clock for preroll start time ----
    BMDTimeValue hwTime = 0, timeInFrame = 0, ticksPerFrame = 0;
    HRESULT hrClk = g_state.output->GetHardwareReferenceClock(
        k_TimeScale, &hwTime, &timeInFrame, &ticksPerFrame);
    if (FAILED(hrClk))
        hwTime = static_cast<BMDTimeValue>(k_ClockMargin + k_PrerollFrames) * k_FrameDuration;

    // Preroll base: k_ClockMargin frames beyond current hw time
    BMDTimeValue prerollBase =
        (hwTime / k_FrameDuration + static_cast<BMDTimeValue>(k_ClockMargin)) * k_FrameDuration;

    // ---- Schedule preroll frames ----
    for (int i = 0; i < k_PrerollFrames; ++i) {
        BMDTimeValue t = prerollBase + static_cast<BMDTimeValue>(i) * k_FrameDuration;
        hr = g_state.output->ScheduleVideoFrame(
            g_state.pool[i], t, k_FrameDuration, k_TimeScale);
        if (FAILED(hr)) {
            // Cleanup
            for (int j = 0; j < k_PrerollFrames; ++j) {
                if (g_state.pool[j]) { g_state.pool[j]->Release(); g_state.pool[j] = nullptr; }
            }
            g_state.output->SetScheduledFrameCompletionCallback(nullptr);
            g_callback->Release(); g_callback = nullptr;
            if (g_state.keyer)  { g_state.keyer->Release();  g_state.keyer  = nullptr; }
            g_state.output->DisableVideoOutput();
            g_state.output->Release(); g_state.output = nullptr;
            Napi::Error::New(env, "ScheduleVideoFrame preroll[" + std::to_string(i) +
                             "] failed: " + hrStr(hr)).ThrowAsJavaScriptException();
            return env.Undefined();
        }
    }

    // nextFrameTime: the frame slot right after the last preroll frame
    // (ScheduledFrameCompleted will advance this atomically from the driver thread)
    g_state.nextFrameTime.store(
        prerollBase / k_FrameDuration + static_cast<BMDTimeValue>(k_PrerollFrames),
        std::memory_order_release);

    // ---- Start playback ----
    hr = g_state.output->StartScheduledPlayback(prerollBase, k_TimeScale, 1.0);
    if (FAILED(hr)) {
        g_state.running = false;
        for (int i = 0; i < k_PrerollFrames; ++i) {
            if (g_state.pool[i]) { g_state.pool[i]->Release(); g_state.pool[i] = nullptr; }
        }
        g_state.output->SetScheduledFrameCompletionCallback(nullptr);
        g_callback->Release(); g_callback = nullptr;
        if (g_state.keyer)  { g_state.keyer->Release();  g_state.keyer  = nullptr; }
        g_state.output->DisableVideoOutput();
        g_state.output->Release(); g_state.output = nullptr;
        Napi::Error::New(env, "StartScheduledPlayback failed: " + hrStr(hr))
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    // Signal callbacks that it's safe to proceed
    g_state.running.store(true, std::memory_order_release);

    return env.Undefined();
}

// ---------------------------------------------------------------------------
// JS: close()  — stop playback and release all resources
// ---------------------------------------------------------------------------
static Napi::Value Close(const Napi::CallbackInfo& info) {
    std::lock_guard<std::mutex> lock(g_state.mtx);
    if (!g_state.running.load(std::memory_order_acquire)) return info.Env().Undefined();

    // Tell callbacks to bail out immediately (checked before every output call)
    g_state.running.store(false, std::memory_order_release);

    // Stop playback — this flushes queued frames (fires ScheduledFrameCompleted
    // with bmdOutputFrameFlushed for each, which we ignore due to running==false)
    g_state.output->StopScheduledPlayback(0, nullptr, 0);

    // DisableVideoOutput blocks until all in-flight callbacks have returned,
    // making it safe to release the frame pool afterwards.
    g_state.output->DisableVideoOutput();

    // Detach callback before releasing
    g_state.output->SetScheduledFrameCompletionCallback(nullptr);
    if (g_callback) { g_callback->Release(); g_callback = nullptr; }

    // Release keyer
    if (g_state.keyer) {
        g_state.keyer->Disable();
        g_state.keyer->Release(); g_state.keyer = nullptr;
    }

    // Release frame pool
    for (int i = 0; i < k_PrerollFrames; ++i) {
        if (g_state.pool[i]) { g_state.pool[i]->Release(); g_state.pool[i] = nullptr; }
    }

    // Release output interface
    g_state.output->Release(); g_state.output = nullptr;

    // Clear staging
    {
        std::lock_guard<std::mutex> sl(g_state.stagingMtx);
        g_state.stagingFresh = false;
    }

    return info.Env().Undefined();
}

// ---------------------------------------------------------------------------
// JS: scheduleFrame(Buffer)
//   Called from Electron's offscreen paint event at 50 fps.
//   Copies the raw BGRA bitmap into the staging buffer so the next
//   ScheduledFrameCompleted pick it up.
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
    if (len != 1920u * 1080u * 4u) return env.Undefined(); // wrong size, skip

    const uint8_t* data = buf.Data();

    std::lock_guard<std::mutex> lk(g_state.stagingMtx);
    if (g_state.stagingBGRA.size() != len)
        g_state.stagingBGRA.resize(len);
    std::memcpy(g_state.stagingBGRA.data(), data, len);
    g_state.stagingFresh = true;

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
