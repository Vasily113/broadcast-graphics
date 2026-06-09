#include "decklink_output.h"
#include "integrated_playout.h"
#include "shm_frame.h"
#include "sync_source.h"

#include "DeckLinkAPI.h"

#include <atomic>
#include <chrono>
#include <csignal>
#include <cstdlib>
#include <cstring>
#include <iostream>
#include <string>
#include <thread>
#include <vector>

#ifdef _OPENMP
#include <omp.h>
#endif

namespace {

std::atomic<bool> g_running{true};

void onSignal(int) {
  g_running.store(false, std::memory_order_release);
}

int modeWidth(const std::string& mode) {
  if (mode.find("HD720") != std::string::npos) return 1280;
  return 1920;
}

int modeHeight(const std::string& mode) {
  if (mode.find("HD720") != std::string::npos) return 720;
  return 1080;
}

int modeFrameFps(const std::string& mode) {
  if (mode == "HD1080i50") return 25;
  if (mode == "HD1080p50" || mode == "HD720p50") return 50;
  if (mode.find("p50") != std::string::npos) return 50;
  if (mode.find("i50") != std::string::npos || mode.find("i25") != std::string::npos) return 25;
  if (mode.find("p25") != std::string::npos) return 25;
  if (mode.find("p60") != std::string::npos || mode.find("5994") != std::string::npos) return 60;
  return 25;
}

bool readExternalRefLocked(IDeckLinkOutput* output) {
  if (!output) return false;
  BMDReferenceStatus status = bmdReferenceUnlocked;
  if (output->GetReferenceStatus(&status) != S_OK) return false;
  return (status & bmdReferenceLocked) != 0;
}

IDeckLinkOutput* openOutputForSyncCheck(int deviceIndex) {
  IDeckLinkIterator* iter = CreateDeckLinkIteratorInstance();
  if (!iter) return nullptr;
  int idx = 0;
  IDeckLink* dl = nullptr;
  IDeckLinkOutput* out = nullptr;
  while (iter->Next(&dl) == S_OK) {
    IDeckLinkOutput* candidate = nullptr;
    if (dl->QueryInterface(IID_IDeckLinkOutput, reinterpret_cast<void**>(&candidate)) == S_OK && candidate) {
      if (idx == deviceIndex) {
        out = candidate;
        dl->Release();
        break;
      }
      candidate->Release();
    }
    dl->Release();
    idx += 1;
  }
  iter->Release();
  return out;
}

} // namespace

int main() {
  const char* integrated = std::getenv("DECKLINK_INTEGRATED_PLAYOUT");
  if (integrated && integrated[0] == '1' && integrated[1] == '\0') {
    return channeld::runIntegratedPlayout();
  }

  std::signal(SIGINT, onSignal);
  std::signal(SIGTERM, onSignal);

  const int deviceIndex = std::atoi(std::getenv("DECKLINK_DEVICE_INDEX") ? std::getenv("DECKLINK_DEVICE_INDEX") : "0");
  const std::string displayMode = std::getenv("DECKLINK_DISPLAY_MODE") ? std::getenv("DECKLINK_DISPLAY_MODE") : "HD1080i50";
  const std::string keyerMode = std::getenv("DECKLINK_KEYER_MODE") ? std::getenv("DECKLINK_KEYER_MODE") : "external";
  const std::string syncPref = std::getenv("DECKLINK_SYNC_PREFERENCE") ? std::getenv("DECKLINK_SYNC_PREFERENCE") : "external_first";
  const std::string channelId = std::getenv("DECKLINK_CHANNEL_ID") ? std::getenv("DECKLINK_CHANNEL_ID") : "default";
  const std::string shmName = std::getenv("DECKLINK_SHM_NAME")
      ? std::getenv("DECKLINK_SHM_NAME")
      : channeld::shmNameFromChannelId(channelId);

  const int width = modeWidth(displayMode);
  const int height = modeHeight(displayMode);
  const int targetFps = modeFrameFps(displayMode);
  constexpr int kSlotCount = channeld::kMaxSlots;

#ifdef _OPENMP
  int convertThreads = std::thread::hardware_concurrency() > 0
      ? static_cast<int>(std::thread::hardware_concurrency())
      : 4;
  int requestedThreads = convertThreads;
  if (const char* s = std::getenv("DECKLINK_CONVERT_THREADS")) {
    const int parsed = std::atoi(s);
    if (parsed > 0) {
      requestedThreads = parsed;
      convertThreads = parsed;
    }
  }
  // Keep a sane upper bound to avoid oversubscription, but allow >8 on HEDT CPUs.
  if (convertThreads > 16) convertThreads = 16;
  if (convertThreads < 1) convertThreads = 1;
  omp_set_num_threads(convertThreads);
  std::cerr << "[decklink-channeld] RGBA->BGRA convert threads requested=" << requestedThreads
            << " applied=" << convertThreads << "\n";
#endif

  std::cerr << "[decklink-channeld] starting: device=" << deviceIndex
            << " mode=" << displayMode << " keyer=" << keyerMode
            << " shm=" << shmName << " syncPref=" << syncPref << "\n";

  IDeckLinkOutput* syncOut = openOutputForSyncCheck(deviceIndex);
  const bool externalLocked = readExternalRefLocked(syncOut);
  if (syncOut) syncOut->Release();
  const auto selected = channeld::chooseSyncSource(externalLocked, syncPref);
  std::cerr << "[decklink-channeld][Sync] Preference: " << syncPref << "\n";
  std::cerr << "[decklink-channeld][Sync] External reference: " << (externalLocked ? "LOCKED" : "UNLOCKED")
            << " (mode=" << displayMode << ")\n";
  std::cerr << "[decklink-channeld][Sync] Selected source: " << channeld::toString(selected) << "\n";

  channeld::ShmMapping shm {};
  if (!channeld::shmCreate(shmName, width, height, kSlotCount, shm)) {
    std::cerr << "[decklink-channeld] failed to create POSIX shm: " << shmName << "\n";
    return 2;
  }
  std::cerr << "[decklink-channeld] SHM ready: /" << shmName << " " << width << "x" << height
            << " slots=" << kSlotCount << "\n";

  channeld::DecklinkOutput output;
  if (!output.open(deviceIndex, displayMode, keyerMode)) {
    channeld::shmDetach(shm);
    return 3;
  }

  std::vector<uint8_t> frameRaw(static_cast<size_t>(width) * static_cast<size_t>(height) * 4u);
  std::vector<uint8_t> frameBgra(static_cast<size_t>(width) * static_cast<size_t>(height) * 4u);
  const auto frameInterval = std::chrono::microseconds(1000000 / std::max(1, targetFps));
  auto nextTick = std::chrono::steady_clock::now();

  uint64_t consumedTotal = 0;
  uint64_t idleTicks = 0;
  auto statsStart = std::chrono::steady_clock::now();
  uint64_t statsConsumed = 0;
  uint64_t statsIdle = 0;

  while (g_running.load(std::memory_order_acquire)) {
    nextTick += frameInterval;
    bool flipY = false;
    bool isRgbaRaw = false;
    uint64_t seq = 0;
    const bool gotFrame = channeld::shmConsumeLatest(shm, frameRaw.data(), frameRaw.size(), &flipY, &isRgbaRaw, &seq);
    if (gotFrame) {
      if (isRgbaRaw) {
        channeld::rgbaToBgra(frameRaw.data(), frameBgra.data(), width, height, flipY);
        output.pushFrameBgra(frameBgra.data(), frameBgra.size());
      } else {
        // playoutd publishes BGRA via shmPublishRgba — no second full-frame convert here.
        output.pushFrameBgra(frameRaw.data(), frameRaw.size());
      }
      consumedTotal++;
      statsConsumed++;
    } else {
      idleTicks++;
      statsIdle++;
    }

    const auto now = std::chrono::steady_clock::now();
    if (now - statsStart >= std::chrono::seconds(30)) {
      const double sec = std::chrono::duration<double>(now - statsStart).count();
      const double consumeFps = sec > 0 ? static_cast<double>(statsConsumed) / sec : 0.0;
      const uint64_t dropped = shm.header
          ? shm.header->droppedByConsumer.load(std::memory_order_relaxed)
          : 0;
      std::cerr << "[decklink-channeld] stats: consumeFps=" << consumeFps
                << " targetFrameFps=" << targetFps
                << " pushed=" << output.framesPushed()
                << " dropped=" << dropped
                << " idleTicks=" << statsIdle << "\n";
      statsStart = now;
      statsConsumed = 0;
      statsIdle = 0;
    }

    std::this_thread::sleep_until(nextTick);
  }

  output.close();
  channeld::shmDetach(shm);
  std::cerr << "[decklink-channeld] stopped (consumed=" << consumedTotal << " idle=" << idleTicks << ")\n";
  return 0;
}
