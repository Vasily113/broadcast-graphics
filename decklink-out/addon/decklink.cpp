// decklink.cpp
// Electron N-API addon: renders video to Blackmagic DeckLink output.
//
// JS API:
//   open(deviceIndex?, displayModeId?, keyerMode?)
//   scheduleFrame(Buffer)  — BGRA bitmap from Electron/Chromium
//   close()

#include <napi.h>

#include <algorithm>
#include <atomic>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <mutex>
#include <string>
#include <vector>

#ifdef _WIN32
#include "DeckLinkAPI_manual.h"
#include <objbase.h>
using DLBool = BOOL;
#define DL_TRUE  TRUE
#define DL_FALSE FALSE
#define DL_PROFILE_ID_ATTR BMDDeckLinkProfileID_Attr
#define DL_QI(obj, iface, outPtr) \
    (obj)->QueryInterface(__uuidof(iface), reinterpret_cast<void**>(outPtr))
#define DL_QI_VIDEO_BUFFER(frame, outPtr) \
    (frame)->QueryInterface(__uuidof(IDeckLinkVideoBuffer), reinterpret_cast<void**>(outPtr))
#define DL_CB_QI(iid, ppv, cbIface) \
    ((iid) == IID_IUnknown || (iid) == __uuidof(IDeckLinkVideoOutputCallback))
static const BMDPixelFormat kFramePixelFormat = bmdFormat8BitARGB;
static HRESULT DL_CreateDeckLinkIterator(IDeckLinkIterator** iter) {
    return CoCreateInstance(
        CLSID_CDeckLinkIterator, nullptr, CLSCTX_ALL,
        __uuidof(IDeckLinkIterator), reinterpret_cast<void**>(iter));
}
static void DL_InitRuntime() {
    CoInitializeEx(nullptr, COINIT_MULTITHREADED);
}
static void DL_LogDeviceName(IDeckLink* dl, int targetDeviceIdx) {
    BSTR name = nullptr;
    if (SUCCEEDED(dl->GetDisplayName(&name)) && name) {
        char narrow[256] = {};
        WideCharToMultiByte(CP_UTF8, 0, name, -1, narrow, sizeof(narrow), nullptr, nullptr);
        SysFreeString(name);
        fprintf(stderr, "[DeckLink] Opening output sub-device %d: %s\n",
                targetDeviceIdx, narrow);
    }
}
#else
#include "DeckLinkAPI.h"
using DLBool = bool;
#define DL_TRUE  true
#define DL_FALSE false
#define DL_PROFILE_ID_ATTR BMDDeckLinkProfileID
#define DL_QI(obj, iface, outPtr) \
    (obj)->QueryInterface(IID_##iface, reinterpret_cast<void**>(outPtr))
#define DL_QI_VIDEO_BUFFER(frame, outPtr) \
    (frame)->QueryInterface(IID_IDeckLinkVideoBuffer, reinterpret_cast<void**>(outPtr))
static inline bool dlIidEqual(REFIID a, REFIID b) {
    return std::memcmp(&a, &b, sizeof(REFIID)) == 0;
}
#define DL_CB_QI(iid, ppv, cbIface) \
    (dlIidEqual((iid), IID_IUnknown) || dlIidEqual((iid), IID_IDeckLinkVideoOutputCallback))
static const BMDPixelFormat kFramePixelFormat = bmdFormat8BitBGRA;
static HRESULT DL_CreateDeckLinkIterator(IDeckLinkIterator** iter) {
    *iter = CreateDeckLinkIteratorInstance();
    return *iter ? S_OK : E_FAIL;
}
static void DL_InitRuntime() {}
static void DL_LogDeviceName(IDeckLink* dl, int targetDeviceIdx) {
    const char* name = nullptr;
    if (SUCCEEDED(dl->GetDisplayName(&name)) && name) {
        fprintf(stderr, "[DeckLink] Opening output sub-device %d: %s\n",
                targetDeviceIdx, name);
        free((void*)name);
    }
}
#endif

// ---------------------------------------------------------------------------
// Supported display modes table
// ---------------------------------------------------------------------------
struct ModeInfo {
    const char*    id;
    BMDDisplayMode bmdMode;
    int            width;
    int            height;
    BMDTimeScale   timeScale;
    BMDTimeValue   frameDuration;
    const char*    label;
};

static const ModeInfo k_Modes[] = {
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
    return nullptr;
}

enum class KeyerMode { External, Internal, FillOnly };

static KeyerMode parseKeyerMode(const std::string& s) {
    if (s == "internal")  return KeyerMode::Internal;
    if (s == "fill_only") return KeyerMode::FillOnly;
    return KeyerMode::External;
}

static constexpr int k_PrerollFrames = 3;
static constexpr int k_ClockMargin   = 6;
static constexpr int k_MaxDevices    = 1;

struct PerDevice {
    IDeckLinkOutput*            output = nullptr;
    IDeckLinkKeyer*             keyer  = nullptr;
    IDeckLinkMutableVideoFrame* pool[k_PrerollFrames] = {};
    std::atomic<BMDTimeValue>   nextFrameTime{0};
};

struct State {
    PerDevice            devices[k_MaxDevices];
    int                  deviceCount = 0;
    std::atomic<bool>    running{false};
    int            activeWidth         = 1920;
    int            activeHeight        = 1080;
    BMDTimeScale   activeTimeScale     = 25000;
    BMDTimeValue   activeFrameDuration = 1000;
    std::vector<uint8_t> stagingFrame;
    std::mutex           stagingMtx;
    std::mutex           mtx;
    std::atomic<uint64_t> cbCompleted{0};
    std::atomic<uint64_t> cbDisplayedLate{0};
    std::atomic<uint64_t> cbDropped{0};
    std::atomic<uint64_t> cbFlushed{0};
    std::atomic<uint64_t> cbUnknown{0};
};
static State g_state;

static void copyFrameToDeviceFormat(const uint8_t* bgra, uint8_t* dst, size_t pixelCount) {
#ifdef _WIN32
    for (size_t i = 0; i < pixelCount; ++i) {
        dst[0] = bgra[3];
        dst[1] = bgra[2];
        dst[2] = bgra[1];
        dst[3] = bgra[0];
        bgra += 4;
        dst += 4;
    }
#else
    std::memcpy(dst, bgra, pixelCount * 4);
#endif
}

static void copyBgraPaddedToStaging(
    const uint8_t* src, int srcW, int srcH,
    uint8_t* dst, int dstW, int dstH)
{
    // Fast path: Linux offscreen paint is often 1919×1079 → 1920×1080 (1px pad).
    if (srcW == dstW - 1 && srcH == dstH - 1) {
        const size_t srcRowBytes = static_cast<size_t>(srcW) * 4u;
        const size_t dstRowBytes = static_cast<size_t>(dstW) * 4u;
        for (int y = 0; y < srcH; ++y) {
            uint8_t* dstRow = dst + static_cast<size_t>(y) * dstRowBytes;
            const uint8_t* srcRow = src + static_cast<size_t>(y) * srcRowBytes;
#ifdef _WIN32
            for (int x = 0; x < srcW; ++x) {
                dstRow[x * 4 + 0] = srcRow[x * 4 + 3];
                dstRow[x * 4 + 1] = srcRow[x * 4 + 2];
                dstRow[x * 4 + 2] = srcRow[x * 4 + 1];
                dstRow[x * 4 + 3] = srcRow[x * 4 + 0];
            }
#else
            std::memcpy(dstRow, srcRow, srcRowBytes);
#endif
            // Replicate last pixel into the padded 1px column to avoid alpha/black-edge flashes.
            if (srcW > 0) {
                const size_t last = static_cast<size_t>(srcW - 1) * 4u;
                const size_t pad  = static_cast<size_t>(srcW) * 4u;
                dstRow[pad + 0] = dstRow[last + 0];
                dstRow[pad + 1] = dstRow[last + 1];
                dstRow[pad + 2] = dstRow[last + 2];
                dstRow[pad + 3] = dstRow[last + 3];
            }
        }
        // Replicate last row into padded 1px row to avoid bottom-edge flash.
        if (srcH > 0) {
            const uint8_t* lastRow = dst + static_cast<size_t>(srcH - 1) * dstRowBytes;
            uint8_t* padRow = dst + static_cast<size_t>(srcH) * dstRowBytes;
            std::memcpy(padRow, lastRow, dstRowBytes);
        } else {
            std::memset(dst + static_cast<size_t>(srcH) * dstRowBytes, 0, dstRowBytes);
        }
        return;
    }

    const size_t dstBytes = static_cast<size_t>(dstW) * static_cast<size_t>(dstH) * 4u;
    std::memset(dst, 0, dstBytes);

    const int copyW = std::min(srcW, dstW);
    const int copyH = std::min(srcH, dstH);
    const size_t rowBytes = static_cast<size_t>(copyW) * 4u;

    for (int y = 0; y < copyH; ++y) {
        const uint8_t* srcRow = src + static_cast<size_t>(y) * static_cast<size_t>(srcW) * 4u;
        uint8_t* dstRow = dst + static_cast<size_t>(y) * static_cast<size_t>(dstW) * 4u;
#ifdef _WIN32
        for (int x = 0; x < copyW; ++x) {
            dstRow[x * 4 + 0] = srcRow[x * 4 + 3];
            dstRow[x * 4 + 1] = srcRow[x * 4 + 2];
            dstRow[x * 4 + 2] = srcRow[x * 4 + 1];
            dstRow[x * 4 + 3] = srcRow[x * 4 + 0];
        }
#else
        std::memcpy(dstRow, srcRow, rowBytes);
#endif
    }
}

// WebGL readPixels: bottom-up RGBA → top-down BGRA for DeckLink/Electron.
static void copyRgbaFlippedToBgra(const uint8_t* rgba, uint8_t* dst, int w, int h) {
    for (int y = 0; y < h; ++y) {
        const uint8_t* srcRow = rgba + static_cast<size_t>(h - 1 - y) * static_cast<size_t>(w) * 4u;
        uint8_t*       dstRow = dst + static_cast<size_t>(y) * static_cast<size_t>(w) * 4u;
        for (int x = 0; x < w; ++x) {
            const uint8_t* s = srcRow + static_cast<size_t>(x) * 4u;
            uint8_t*       d = dstRow + static_cast<size_t>(x) * 4u;
            d[0] = s[2];
            d[1] = s[1];
            d[2] = s[0];
            d[3] = s[3];
        }
    }
}

class OutputCallback final : public IDeckLinkVideoOutputCallback {
public:
    explicit OutputCallback(PerDevice* dev) : m_dev(dev), m_ref(1) {}

    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID iid, void** ppv) override {
        if (!ppv) return E_POINTER;
        if (DL_CB_QI(iid, ppv, IDeckLinkVideoOutputCallback)) {
            *ppv = static_cast<IDeckLinkVideoOutputCallback*>(this);
            AddRef();
            return S_OK;
        }
        *ppv = nullptr;
        return E_NOINTERFACE;
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
        switch (result) {
            case bmdOutputFrameCompleted:
                g_state.cbCompleted.fetch_add(1, std::memory_order_relaxed);
                break;
            case bmdOutputFrameDisplayedLate:
                g_state.cbDisplayedLate.fetch_add(1, std::memory_order_relaxed);
                break;
            case bmdOutputFrameDropped:
                g_state.cbDropped.fetch_add(1, std::memory_order_relaxed);
                break;
            case bmdOutputFrameFlushed:
                g_state.cbFlushed.fetch_add(1, std::memory_order_relaxed);
                return S_OK;
            default:
                g_state.cbUnknown.fetch_add(1, std::memory_order_relaxed);
                break;
        }

        const size_t frameBytes =
            static_cast<size_t>(g_state.activeWidth) *
            static_cast<size_t>(g_state.activeHeight) * 4u;

        IDeckLinkVideoBuffer* buf = nullptr;
        if (SUCCEEDED(DL_QI_VIDEO_BUFFER(completedFrame, &buf)) && buf)
        {
            buf->StartAccess(bmdBufferAccessWrite);
            void* pixels = nullptr;
            if (SUCCEEDED(buf->GetBytes(&pixels)) && pixels) {
                std::lock_guard<std::mutex> lk(g_state.stagingMtx);
                if (g_state.stagingFrame.size() == frameBytes)
                    std::memcpy(pixels, g_state.stagingFrame.data(), frameBytes);
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

static std::string hrStr(HRESULT hr) {
    char buf[24];
    std::snprintf(buf, sizeof(buf), "0x%08X", static_cast<unsigned>(hr));
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

static BMDSupportedVideoModeFlags modeFlagsForKeyer(KeyerMode keyerMode) {
#ifdef _WIN32
    (void)keyerMode;
    return bmdSupportedVideoModeDefault;
#else
    if (keyerMode == KeyerMode::FillOnly)
        return bmdSupportedVideoModeDefault;
    return bmdSupportedVideoModeKeying;
#endif
}

static Napi::Value Open(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    std::lock_guard<std::mutex> lock(g_state.mtx);

    if (g_state.running.load()) {
        Napi::Error::New(env, "DeckLink already open").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    int targetDeviceIdx = 0;
    if (info.Length() >= 1 && info[0].IsNumber())
        targetDeviceIdx = std::max(0, info[0].As<Napi::Number>().Int32Value());

    std::string displayModeId = "HD1080i50";
    if (info.Length() >= 2 && info[1].IsString())
        displayModeId = info[1].As<Napi::String>().Utf8Value();

    std::string keyerModeStr = "external";
    if (info.Length() >= 3 && info[2].IsString())
        keyerModeStr = info[2].As<Napi::String>().Utf8Value();

    const ModeInfo* mode = findMode(displayModeId);
    if (!mode) {
        Napi::Error::New(env, "Unknown display mode: " + displayModeId)
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    KeyerMode keyerMode = parseKeyerMode(keyerModeStr);
    const BMDSupportedVideoModeFlags modeFlags = modeFlagsForKeyer(keyerMode);

    fprintf(stderr,
        "[DeckLink] open() — sub-device=%d  mode=%s (%s)  keyer=%s\n",
        targetDeviceIdx, mode->id, mode->label, keyerModeStr.c_str());

    g_state.activeWidth         = mode->width;
    g_state.activeHeight        = mode->height;
    g_state.activeTimeScale     = mode->timeScale;
    g_state.activeFrameDuration = mode->frameDuration;

    IDeckLinkIterator* iter = nullptr;
    HRESULT hr = DL_CreateDeckLinkIterator(&iter);
    if (FAILED(hr) || !iter) {
        Napi::Error::New(env, "CreateDeckLinkIterator failed: " + hrStr(hr))
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    {
        IDeckLink* first = nullptr;
        if (iter->Next(&first) == S_OK) {
            IDeckLinkProfileAttributes* attrs = nullptr;
            int64_t curProfile = 0, numSub = 0, subIdx = 0;
            DLBool hasMonitor = DL_FALSE, supExtKey = DL_FALSE;
            if (SUCCEEDED(DL_QI(first, IDeckLinkProfileAttributes, &attrs)) && attrs) {
                attrs->GetInt (DL_PROFILE_ID_ATTR,             &curProfile);
                attrs->GetInt (BMDDeckLinkNumberOfSubDevices,   &numSub);
                attrs->GetInt (BMDDeckLinkSubDeviceIndex,       &subIdx);
                attrs->GetFlag(BMDDeckLinkHasMonitorOut,        &hasMonitor);
                attrs->GetFlag(BMDDeckLinkSupportsExternalKeying, &supExtKey);
                attrs->Release();
            }
            fprintf(stderr,
                "[DeckLink] Profile check: current=0x%08X  subDevices=%lld  "
                "subIdx=%lld  monitorOut=%s  externalKey=%s\n",
                (unsigned)curProfile, (long long)numSub, (long long)subIdx,
                hasMonitor ? "yes" : "no",
                supExtKey  ? "yes" : "no");

            if (curProfile != (int64_t)bmdProfileTwoSubDevicesFullDuplex) {
                fprintf(stderr,
                    "[DeckLink] Profile is not '2dfd' (current=0x%08X) — switching to "
                    "2 Sub-Devices Full Duplex...\n", (unsigned)curProfile);

                IDeckLinkProfileManager* mgr = nullptr;
                bool switched = false;
                if (SUCCEEDED(DL_QI(first, IDeckLinkProfileManager, &mgr)) && mgr) {
                    IDeckLinkProfile* target = nullptr;
                    if (SUCCEEDED(mgr->GetProfile(bmdProfileTwoSubDevicesFullDuplex,
                            &target)) && target) {
                        DLBool isActive = DL_FALSE;
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

        hr = DL_CreateDeckLinkIterator(&iter);
        if (FAILED(hr) || !iter) {
            Napi::Error::New(env, "CreateDeckLinkIterator(re-enumerate) failed: " + hrStr(hr))
                .ThrowAsJavaScriptException();
            return env.Undefined();
        }
    }

    g_state.deviceCount = 0;
    IDeckLink* dl = nullptr;
    int outputIdx = 0;

    while (iter->Next(&dl) == S_OK) {
        IDeckLinkOutput* testOut = nullptr;
        if (FAILED(DL_QI(dl, IDeckLinkOutput, &testOut)) || !testOut) {
            dl->Release(); dl = nullptr;
            continue;
        }

        BMDDisplayMode actualMode = 0;
        DLBool supported = DL_FALSE;
        testOut->DoesSupportVideoMode(
            bmdVideoConnectionUnspecified,
            mode->bmdMode,
            kFramePixelFormat,
            bmdNoVideoOutputConversion,
            modeFlags,
            &actualMode,
            &supported);

        if (!supported) {
            testOut->Release(); testOut = nullptr;
            dl->Release(); dl = nullptr;
            continue;
        }

        if (outputIdx < targetDeviceIdx) {
            testOut->Release(); testOut = nullptr;
            dl->Release(); dl = nullptr;
            outputIdx++;
            continue;
        }

        const int idx = 0;
        PerDevice& dev = g_state.devices[idx];
        dev.output = testOut;
        testOut = nullptr;

        DL_LogDeviceName(dl, targetDeviceIdx);

        DL_QI(dl, IDeckLinkKeyer, &dev.keyer);
        {
            IDeckLinkProfileAttributes* devAttrs = nullptr;
            if (SUCCEEDED(DL_QI(dl, IDeckLinkProfileAttributes, &devAttrs)) && devAttrs) {
                DLBool supExt = DL_FALSE;
                devAttrs->GetFlag(BMDDeckLinkSupportsExternalKeying, &supExt);
                fprintf(stderr, "[DeckLink] Output sub-device %d: supportsExternalKeying=%s\n",
                        targetDeviceIdx, supExt ? "yes" : "no");
                devAttrs->Release();
            }
        }

        dl->Release(); dl = nullptr;

        hr = dev.output->EnableVideoOutput(mode->bmdMode, bmdVideoOutputFlagDefault);
        if (FAILED(hr)) {
            fprintf(stderr, "[DeckLink] EnableVideoOutput(%s) failed %s\n",
                    mode->id, hrStr(hr).c_str());
            dev.output->Release(); dev.output = nullptr;
            if (dev.keyer) { dev.keyer->Release(); dev.keyer = nullptr; }
            break;
        }

        if (keyerMode == KeyerMode::FillOnly) {
            if (dev.keyer) {
                dev.keyer->Disable();
                dev.keyer->Release(); dev.keyer = nullptr;
            }
            fprintf(stderr, "[DeckLink] Keyer: Fill only (no key output)\n");
        } else if (dev.keyer) {
            DLBool isExternal = (keyerMode == KeyerMode::External) ? DL_TRUE : DL_FALSE;
            HRESULT hrEnable = dev.keyer->Enable(isExternal);
            HRESULT hrLevel  = dev.keyer->SetLevel(255);
            if (FAILED(hrEnable)) {
                fprintf(stderr, "[DeckLink] WARNING: Keyer Enable(%s) failed %s\n",
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

        const int W = mode->width;
        const int H = mode->height;
        const int rowB = W * 4;

        bool poolOk = true;
        for (int i = 0; i < k_PrerollFrames; ++i) {
            hr = dev.output->CreateVideoFrame(W, H, rowB,
                kFramePixelFormat, bmdFrameFlagDefault, &dev.pool[i]);
            if (FAILED(hr) || !dev.pool[i]) {
                fprintf(stderr, "[DeckLink] CreateVideoFrame[%d] failed %s\n",
                        i, hrStr(hr).c_str());
                poolOk = false; break;
            }
            IDeckLinkVideoBuffer* vbuf = nullptr;
            if (SUCCEEDED(DL_QI_VIDEO_BUFFER(dev.pool[i], &vbuf)) && vbuf) {
                vbuf->StartAccess(bmdBufferAccessWrite);
                void* px = nullptr;
                if (SUCCEEDED(vbuf->GetBytes(&px)) && px)
                    std::memset(px, 0, static_cast<size_t>(rowB) * H);
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

        g_callbacks[idx] = new OutputCallback(&dev);
        dev.output->SetScheduledFrameCompletionCallback(g_callbacks[idx]);

        BMDTimeValue hwTime = 0, timeInFrame = 0, ticksPerFrame = 0;
        if (FAILED(dev.output->GetHardwareReferenceClock(
                mode->timeScale, &hwTime, &timeInFrame, &ticksPerFrame)))
            hwTime = static_cast<BMDTimeValue>(k_ClockMargin + k_PrerollFrames) * mode->frameDuration;

        BMDTimeValue prerollBase =
            (hwTime / mode->frameDuration + static_cast<BMDTimeValue>(k_ClockMargin)) * mode->frameDuration;

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

static Napi::Value Close(const Napi::CallbackInfo& info) {
    std::lock_guard<std::mutex> lock(g_state.mtx);
    if (!g_state.running.load(std::memory_order_acquire)) return info.Env().Undefined();

    g_state.running.store(false, std::memory_order_release);

    for (int d = 0; d < g_state.deviceCount; ++d)
        releaseDevice(d);
    g_state.deviceCount = 0;

    {
        std::lock_guard<std::mutex> sl(g_state.stagingMtx);
        g_state.stagingFrame.clear();
    }
    const auto completed = g_state.cbCompleted.exchange(0, std::memory_order_relaxed);
    const auto late      = g_state.cbDisplayedLate.exchange(0, std::memory_order_relaxed);
    const auto dropped   = g_state.cbDropped.exchange(0, std::memory_order_relaxed);
    const auto flushed   = g_state.cbFlushed.exchange(0, std::memory_order_relaxed);
    const auto unknown   = g_state.cbUnknown.exchange(0, std::memory_order_relaxed);
    fprintf(stderr,
            "[DeckLink] callback stats: completed=%llu late=%llu dropped=%llu flushed=%llu unknown=%llu\n",
            static_cast<unsigned long long>(completed),
            static_cast<unsigned long long>(late),
            static_cast<unsigned long long>(dropped),
            static_cast<unsigned long long>(flushed),
            static_cast<unsigned long long>(unknown));

    fprintf(stderr, "[DeckLink] Device closed\n");
    return info.Env().Undefined();
}

static Napi::Value ScheduleFrame(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsBuffer()) {
        Napi::TypeError::New(env, "scheduleFrame expects a Buffer")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }
    if (!g_state.running.load(std::memory_order_acquire)) return env.Undefined();

    auto buf = info[0].As<Napi::Buffer<uint8_t>>();

    int srcW = g_state.activeWidth;
    int srcH = g_state.activeHeight;
    if (info.Length() >= 3 && info[1].IsNumber() && info[2].IsNumber()) {
        srcW = info[1].As<Napi::Number>().Int32Value();
        srcH = info[2].As<Napi::Number>().Int32Value();
    }

    const size_t srcLen = static_cast<size_t>(srcW) * static_cast<size_t>(srcH) * 4u;
    if (buf.ByteLength() != srcLen) return env.Undefined();

    const size_t dstLen =
        static_cast<size_t>(g_state.activeWidth) *
        static_cast<size_t>(g_state.activeHeight) * 4u;

    std::lock_guard<std::mutex> lk(g_state.stagingMtx);
    if (g_state.stagingFrame.size() != dstLen)
        g_state.stagingFrame.resize(dstLen);

    if (srcW == g_state.activeWidth && srcH == g_state.activeHeight) {
        const size_t pixelCount =
            static_cast<size_t>(g_state.activeWidth) * g_state.activeHeight;
        copyFrameToDeviceFormat(buf.Data(), g_state.stagingFrame.data(), pixelCount);
    } else {
        copyBgraPaddedToStaging(
            buf.Data(), srcW, srcH,
            g_state.stagingFrame.data(), g_state.activeWidth, g_state.activeHeight);
    }
    return env.Undefined();
}

static Napi::Value ScheduleFrameRgba(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsBuffer()) {
        Napi::TypeError::New(env, "scheduleFrameRgba expects a Buffer")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }
    if (!g_state.running.load(std::memory_order_acquire)) return env.Undefined();

    auto         buf = info[0].As<Napi::Buffer<uint8_t>>();
    const size_t len = buf.ByteLength();
    const size_t expected =
        static_cast<size_t>(g_state.activeWidth) *
        static_cast<size_t>(g_state.activeHeight) * 4u;

    if (len != expected) return env.Undefined();

    const int w = g_state.activeWidth;
    const int h = g_state.activeHeight;

    std::lock_guard<std::mutex> lk(g_state.stagingMtx);
    if (g_state.stagingFrame.size() != len)
        g_state.stagingFrame.resize(len);

    copyRgbaFlippedToBgra(buf.Data(), g_state.stagingFrame.data(), w, h);
    return env.Undefined();
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    DL_InitRuntime();
    exports.Set("open",             Napi::Function::New(env, Open));
    exports.Set("close",            Napi::Function::New(env, Close));
    exports.Set("scheduleFrame",    Napi::Function::New(env, ScheduleFrame));
    exports.Set("scheduleFrameRgba", Napi::Function::New(env, ScheduleFrameRgba));
    return exports;
}

NODE_API_MODULE(decklink, Init)
