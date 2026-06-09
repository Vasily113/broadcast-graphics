#include "decklink_output.h"

#include "DeckLinkAPI.h"

using DLBool = bool;
#define DL_TRUE true
#define DL_FALSE false

#include <atomic>
#include <chrono>
#include <cstdio>
#include <cstring>
#include <mutex>
#include <string>
#include <thread>

namespace channeld {
namespace {

#define DL_QI(obj, iface, outPtr) \
  (obj)->QueryInterface(IID_##iface, reinterpret_cast<void**>(outPtr))
#define DL_QI_VIDEO_BUFFER(frame, outPtr) \
  (frame)->QueryInterface(IID_IDeckLinkVideoBuffer, reinterpret_cast<void**>(outPtr))

static const BMDPixelFormat kFramePixelFormat = bmdFormat8BitBGRA;

struct ModeInfo {
  const char* id;
  BMDDisplayMode bmdMode;
  int width;
  int height;
  BMDTimeScale timeScale;
  BMDTimeValue frameDuration;
  const char* label;
};

static const ModeInfo kModes[] = {
    {"HD1080i50", bmdModeHD1080i50, 1920, 1080, 25000, 1000, "1080i 50"},
    {"HD1080p50", bmdModeHD1080p50, 1920, 1080, 50000, 1000, "1080p 50"},
    {"HD1080p25", bmdModeHD1080p25, 1920, 1080, 25000, 1000, "1080p 25"},
    {"HD720p50", bmdModeHD720p50, 1280, 720, 50000, 1000, "720p 50"},
};

const ModeInfo* findMode(const std::string& id) {
  for (const auto& m : kModes) {
    if (id == m.id) return &m;
  }
  return nullptr;
}

enum class KeyerMode { External, Internal, FillOnly };

KeyerMode parseKeyer(const std::string& s) {
  if (s == "internal") return KeyerMode::Internal;
  if (s == "fill_only") return KeyerMode::FillOnly;
  return KeyerMode::External;
}

static constexpr int kPrerollFrames = 3;
static constexpr int kClockMargin = 6;

struct PerDevice {
  IDeckLinkOutput* output = nullptr;
  IDeckLinkKeyer* keyer = nullptr;
  IDeckLinkMutableVideoFrame* pool[kPrerollFrames] = {};
  std::atomic<BMDTimeValue> nextFrameTime{0};
};

struct OutputState {
  PerDevice dev;
  bool running = false;
  int activeWidth = 1920;
  int activeHeight = 1080;
  BMDTimeScale activeTimeScale = 25000;
  BMDTimeValue activeFrameDuration = 1000;
  std::mutex stagingMtx;
  std::mutex producerMtx;
  FrameProducerFn frameProducer;
  std::vector<uint8_t> staging;
  std::atomic<uint64_t> framesPushed{0};
  std::atomic<uint64_t> hwCompleted{0};
  std::atomic<uint64_t> hwLate{0};
  std::atomic<uint64_t> hwDropped{0};
  std::atomic<uint64_t> hwOnAirIndex{0};
  std::atomic<uint64_t> hwCurrentFillIndex{0};
};

class OutputCallback final : public IDeckLinkVideoOutputCallback {
public:
  explicit OutputCallback(PerDevice* dev, OutputState* st)
      : dev_(dev), st_(st), ref_(1) {}

  HRESULT STDMETHODCALLTYPE QueryInterface(REFIID iid, void** ppv) override {
    if (!ppv) return E_POINTER;
    auto iidEq = [](REFIID a, REFIID b) {
      return std::memcmp(&a, &b, sizeof(REFIID)) == 0;
    };
    if (iidEq(iid, IID_IUnknown) || iidEq(iid, IID_IDeckLinkVideoOutputCallback)) {
      *ppv = static_cast<IDeckLinkVideoOutputCallback*>(this);
      AddRef();
      return S_OK;
    }
    *ppv = nullptr;
    return E_NOINTERFACE;
  }
  ULONG STDMETHODCALLTYPE AddRef() override { return ++ref_; }
  ULONG STDMETHODCALLTYPE Release() override {
    ULONG r = --ref_;
    if (r == 0) delete this;
    return r;
  }

  HRESULT STDMETHODCALLTYPE ScheduledPlaybackHasStopped() override { return S_OK; }

  HRESULT STDMETHODCALLTYPE ScheduledFrameCompleted(
      IDeckLinkVideoFrame* completedFrame,
      BMDOutputFrameCompletionResult result) override {
    if (!st_->running) return S_OK;
    switch (result) {
      case bmdOutputFrameCompleted:
        st_->hwCompleted.fetch_add(1, std::memory_order_relaxed);
        break;
      case bmdOutputFrameDisplayedLate:
        st_->hwLate.fetch_add(1, std::memory_order_relaxed);
        break;
      case bmdOutputFrameDropped:
        st_->hwDropped.fetch_add(1, std::memory_order_relaxed);
        break;
      case bmdOutputFrameFlushed:
        return S_OK;
      default:
        break;
    }

    const int W = st_->activeWidth;
    const int H = st_->activeHeight;
    const size_t frameBytes = static_cast<size_t>(W) * static_cast<size_t>(H) * 4u;

    IDeckLinkVideoBuffer* buf = nullptr;
    if (SUCCEEDED(DL_QI_VIDEO_BUFFER(completedFrame, &buf)) && buf) {
      buf->StartAccess(bmdBufferAccessWrite);
      void* pixels = nullptr;
      if (SUCCEEDED(buf->GetBytes(&pixels)) && pixels) {
        const uint64_t airIndex = st_->hwOnAirIndex.fetch_add(1, std::memory_order_acq_rel);
        st_->hwCurrentFillIndex.store(airIndex, std::memory_order_release);
        FrameProducerFn producer;
        {
          std::lock_guard<std::mutex> lk(st_->producerMtx);
          producer = st_->frameProducer;
        }
        if (producer) {
          producer(static_cast<uint8_t*>(pixels), W, H);
          st_->framesPushed.fetch_add(1, std::memory_order_relaxed);
        } else {
          std::lock_guard<std::mutex> lk(st_->stagingMtx);
          if (st_->staging.size() == frameBytes) {
            std::memcpy(pixels, st_->staging.data(), frameBytes);
          } else {
            std::memset(pixels, 0, frameBytes);
          }
        }
      }
      buf->EndAccess(bmdBufferAccessWrite);
      buf->Release();
    }

    if (!st_->running) return S_OK;
    BMDTimeValue slot = dev_->nextFrameTime.fetch_add(1, std::memory_order_relaxed);
    dev_->output->ScheduleVideoFrame(
        completedFrame,
        slot * st_->activeFrameDuration,
        st_->activeFrameDuration,
        st_->activeTimeScale);
    return S_OK;
  }

private:
  PerDevice* dev_;
  OutputState* st_;
  std::atomic<ULONG> ref_;
};

static OutputCallback* g_callback = nullptr;

static void releaseDevice(PerDevice& dev) {
  if (!dev.output) return;
  dev.output->StopScheduledPlayback(0, nullptr, 0);
  dev.output->DisableVideoOutput();
  dev.output->SetScheduledFrameCompletionCallback(nullptr);
  if (g_callback) {
    g_callback->Release();
    g_callback = nullptr;
  }
  if (dev.keyer) {
    dev.keyer->Disable();
    dev.keyer->Release();
    dev.keyer = nullptr;
  }
  for (int i = 0; i < kPrerollFrames; ++i) {
    if (dev.pool[i]) {
      dev.pool[i]->Release();
      dev.pool[i] = nullptr;
    }
  }
  dev.output->Release();
  dev.output = nullptr;
}

int deriveFrameFps(const ModeInfo& mode) {
  if (mode.frameDuration <= 0) return 50;
  return static_cast<int>(mode.timeScale / mode.frameDuration);
}

bool isInterlacedModeId(const std::string& modeId) {
  return modeId.find('i') != std::string::npos && modeId.find("HD") != std::string::npos;
}

static std::string hrStr(HRESULT hr) {
  char buf[24];
  std::snprintf(buf, sizeof(buf), "0x%08X", static_cast<unsigned>(hr));
  return buf;
}

} // namespace

bool DecklinkOutput::open(int deviceIndex, const std::string& displayModeId, const std::string& keyerModeStr) {
  const ModeInfo* mode = findMode(displayModeId);
  if (!mode) {
    std::fprintf(stderr, "[decklink-channeld] unknown display mode: %s\n", displayModeId.c_str());
    return false;
  }

  auto* st = new OutputState();
  outputState_ = st;
  st->activeWidth = mode->width;
  st->activeHeight = mode->height;
  st->activeTimeScale = mode->timeScale;
  st->activeFrameDuration = mode->frameDuration;
  width_ = mode->width;
  height_ = mode->height;
  targetFps_ = deriveFrameFps(*mode);
  st->staging.resize(static_cast<size_t>(width_) * static_cast<size_t>(height_) * 4u);

  const KeyerMode keyerMode = parseKeyer(keyerModeStr);
  const BMDSupportedVideoModeFlags modeFlags =
      (keyerMode == KeyerMode::FillOnly) ? bmdSupportedVideoModeDefault : bmdSupportedVideoModeKeying;

  if (g_callback) {
    g_callback->Release();
    g_callback = nullptr;
  }

  IDeckLinkIterator* iter = CreateDeckLinkIteratorInstance();
  if (!iter) {
    std::fprintf(stderr,
        "[decklink-channeld] CreateDeckLinkIteratorInstance failed — install Desktop Video / libDeckLinkAPI.so\n");
    delete st;
    outputState_ = nullptr;
    return false;
  }

  int outputIdx = 0;
  int outputsSeen = 0;
  int outputsSupported = 0;
  IDeckLink* dl = nullptr;
  bool opened = false;
  const char* failReason = "no DeckLink output supports this mode (check display_mode, keyer, device busy?)";
  while (iter->Next(&dl) == S_OK) {
    IDeckLinkOutput* testOut = nullptr;
    if (FAILED(DL_QI(dl, IDeckLinkOutput, reinterpret_cast<void**>(&testOut))) || !testOut) {
      dl->Release();
      continue;
    }
    BMDDisplayMode actualMode = 0;
    DLBool supported = DL_FALSE;
    testOut->DoesSupportVideoMode(
        bmdVideoConnectionUnspecified, mode->bmdMode, kFramePixelFormat,
        bmdNoVideoOutputConversion, modeFlags, &actualMode, &supported);
    outputsSeen++;
    if (!supported) {
      testOut->Release();
      dl->Release();
      continue;
    }
    outputsSupported++;
    if (outputIdx < deviceIndex) {
      testOut->Release();
      dl->Release();
      outputIdx++;
      continue;
    }

    st->dev.output = testOut;
    DL_QI(dl, IDeckLinkKeyer, reinterpret_cast<void**>(&st->dev.keyer));
    dl->Release();

    HRESULT hrEnable = E_FAIL;
    for (int attempt = 0; attempt < 8; ++attempt) {
      hrEnable = st->dev.output->EnableVideoOutput(mode->bmdMode, bmdVideoOutputFlagDefault);
      if (SUCCEEDED(hrEnable)) break;
      if (attempt == 0) {
        std::fprintf(stderr,
            "[decklink-channeld] EnableVideoOutput(%s) failed %s (E_ACCESSDENIED = output in use; "
            "run ../stop-decklink.sh)\n",
            mode->id, hrStr(hrEnable).c_str());
      }
      std::this_thread::sleep_for(std::chrono::milliseconds(400));
    }
    if (FAILED(hrEnable)) {
      failReason = "EnableVideoOutput failed (device busy — stop Electron/Media Express/other SDI apps)";
      releaseDevice(st->dev);
      break;
    }

    if (keyerMode == KeyerMode::FillOnly) {
      if (st->dev.keyer) {
        st->dev.keyer->Disable();
        st->dev.keyer->Release();
        st->dev.keyer = nullptr;
      }
    } else if (st->dev.keyer) {
      const bool ext = keyerMode == KeyerMode::External;
      st->dev.keyer->Enable(ext);
      st->dev.keyer->SetLevel(255);
    }

    const int W = mode->width;
    const int H = mode->height;
    const int rowB = W * 4;
    bool poolOk = true;
    for (int i = 0; i < kPrerollFrames; ++i) {
      if (FAILED(st->dev.output->CreateVideoFrame(
              W, H, rowB, kFramePixelFormat, bmdFrameFlagDefault, &st->dev.pool[i])) ||
          !st->dev.pool[i]) {
        poolOk = false;
        break;
      }
    }
    if (!poolOk) {
      failReason = "CreateVideoFrame failed";
      std::fprintf(stderr, "[decklink-channeld] CreateVideoFrame pool failed for %s\n", mode->id);
      releaseDevice(st->dev);
      break;
    }

    g_callback = new OutputCallback(&st->dev, st);
    st->dev.output->SetScheduledFrameCompletionCallback(g_callback);

    BMDTimeValue hwTime = 0, timeInFrame = 0, ticksPerFrame = 0;
    if (FAILED(st->dev.output->GetHardwareReferenceClock(
            mode->timeScale, &hwTime, &timeInFrame, &ticksPerFrame))) {
      hwTime = static_cast<BMDTimeValue>(kClockMargin + kPrerollFrames) * mode->frameDuration;
    }
    BMDTimeValue prerollBase =
        (hwTime / mode->frameDuration + static_cast<BMDTimeValue>(kClockMargin)) * mode->frameDuration;

    bool schedOk = true;
    for (int i = 0; i < kPrerollFrames; ++i) {
      BMDTimeValue t = prerollBase + static_cast<BMDTimeValue>(i) * mode->frameDuration;
      if (FAILED(st->dev.output->ScheduleVideoFrame(
              st->dev.pool[i], t, mode->frameDuration, mode->timeScale))) {
        schedOk = false;
        break;
      }
    }
    if (!schedOk) {
      failReason = "ScheduleVideoFrame preroll failed";
      std::fprintf(stderr, "[decklink-channeld] ScheduleVideoFrame preroll failed for %s\n", mode->id);
      releaseDevice(st->dev);
      break;
    }

    st->dev.nextFrameTime.store(
        prerollBase / mode->frameDuration + static_cast<BMDTimeValue>(kPrerollFrames),
        std::memory_order_release);

    HRESULT hrPlay = st->dev.output->StartScheduledPlayback(prerollBase, mode->timeScale, 1.0);
    if (FAILED(hrPlay)) {
      failReason = "StartScheduledPlayback failed";
      std::fprintf(stderr,
          "[decklink-channeld] StartScheduledPlayback failed %s for %s\n",
          hrStr(hrPlay).c_str(), mode->id);
      releaseDevice(st->dev);
      break;
    }

    st->running = true;
    opened = true;
    const int fieldFps = isInterlacedModeId(mode->id) ? targetFps_ * 2 : 0;
    if (fieldFps > 0) {
      std::fprintf(stderr,
          "[decklink-channeld] output started: sub-device=%d mode=%s (%s) keyer=%s frameFps=%d fieldFps=%d\n",
          deviceIndex, mode->id, mode->label, keyerModeStr.c_str(), targetFps_, fieldFps);
    } else {
      std::fprintf(stderr,
          "[decklink-channeld] output started: sub-device=%d mode=%s (%s) keyer=%s frameFps=%d\n",
          deviceIndex, mode->id, mode->label, keyerModeStr.c_str(), targetFps_);
    }
    break;
  }
  iter->Release();

  if (!opened) {
    if (outputsSupported > 0 && outputsSupported <= deviceIndex) {
      failReason = "device_index out of range (fewer SDI outputs than index)";
    } else if (outputsSupported == 0 && outputsSeen > 0) {
      failReason = "mode/keyer not supported on any output (try HD1080i50 or unlock ref for p50)";
    }
    std::fprintf(stderr,
        "[decklink-channeld] open failed: device_index=%d mode=%s keyer=%s (%s; outputs=%d supported=%d)\n",
        deviceIndex, displayModeId.c_str(), keyerModeStr.c_str(), failReason, outputsSeen,
        outputsSupported);
    delete st;
    outputState_ = nullptr;
    return false;
  }
  return true;
}

void DecklinkOutput::close() {
  auto* st = static_cast<OutputState*>(outputState_);
  if (!st) return;
  st->running = false;
  releaseDevice(st->dev);
  delete st;
  outputState_ = nullptr;
}

void DecklinkOutput::setFrameProducer(FrameProducerFn producer) {
  auto* st = static_cast<OutputState*>(outputState_);
  if (st) {
    std::lock_guard<std::mutex> lk(st->producerMtx);
    st->frameProducer = std::move(producer);
  }
}

bool DecklinkOutput::pushFrameBgra(const uint8_t* bgra, size_t byteLength) {
  auto* st = static_cast<OutputState*>(outputState_);
  if (!st || !st->running || !bgra) return false;
  const size_t expected = static_cast<size_t>(width_) * static_cast<size_t>(height_) * 4u;
  if (byteLength != expected) return false;
  {
    std::lock_guard<std::mutex> lk(st->stagingMtx);
    if (st->staging.size() != expected) st->staging.resize(expected);
    std::memcpy(st->staging.data(), bgra, expected);
  }
  st->framesPushed.fetch_add(1, std::memory_order_relaxed);
  return true;
}

uint64_t DecklinkOutput::framesPushed() const {
  auto* st = static_cast<const OutputState*>(outputState_);
  return st ? st->framesPushed.load(std::memory_order_relaxed) : 0;
}

uint64_t DecklinkOutput::hwFramesCompleted() const {
  auto* st = static_cast<const OutputState*>(outputState_);
  return st ? st->hwCompleted.load(std::memory_order_relaxed) : 0;
}

uint64_t DecklinkOutput::hwFramesLate() const {
  auto* st = static_cast<const OutputState*>(outputState_);
  return st ? st->hwLate.load(std::memory_order_relaxed) : 0;
}

uint64_t DecklinkOutput::hwFramesDropped() const {
  auto* st = static_cast<const OutputState*>(outputState_);
  return st ? st->hwDropped.load(std::memory_order_relaxed) : 0;
}

uint64_t DecklinkOutput::hwOnAirFrameCount() const {
  auto* st = static_cast<const OutputState*>(outputState_);
  return st ? st->hwOnAirIndex.load(std::memory_order_acquire) : 0;
}

uint64_t DecklinkOutput::hwCurrentFillIndex() const {
  auto* st = static_cast<const OutputState*>(outputState_);
  return st ? st->hwCurrentFillIndex.load(std::memory_order_acquire) : 0;
}

} // namespace channeld
