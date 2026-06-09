#include "decklink_output.h"
#include "render_ahead.h"
#include "sync_source.h"

#include "../playoutd/control_server.h"
#include "../playoutd/font_registry.h"
#include "../playoutd/scene.h"
#include "../playoutd/timeline_bridge.h"

#include "DeckLinkAPI.h"

#include <atomic>
#include <cmath>
#include <chrono>
#include <csignal>
#include <cstdlib>
#include <deque>
#include <iostream>
#include <memory>
#include <string>
#include <thread>

namespace {

std::atomic<bool> g_running{true};

void onSignal(int) {
  g_running.store(false, std::memory_order_release);
}

std::string envOr(const char* key, const std::string& fallback) {
  const char* v = std::getenv(key);
  return (v && *v) ? std::string(v) : fallback;
}

int modeWidth(const std::string& mode) {
  if (mode.find("HD720") != std::string::npos) return 1280;
  return 1920;
}

int modeHeight(const std::string& mode) {
  if (mode.find("HD720") != std::string::npos) return 720;
  return 1080;
}

bool isInterlacedMode(const std::string& mode) {
  return mode.find('i') != std::string::npos && mode.find("HD") != std::string::npos;
}

int modeFrameFps(const std::string& mode) {
  if (mode == "HD1080i50" || mode == "HD1080p25") return 25;
  if (mode == "HD1080p50" || mode == "HD720p50") return 50;
  if (mode.find("p50") != std::string::npos) return 50;
  if (mode.find("i50") != std::string::npos || mode.find("i25") != std::string::npos) return 25;
  if (mode.find("p25") != std::string::npos) return 25;
  if (mode.find("p60") != std::string::npos || mode.find("5994") != std::string::npos) return 60;
  if (mode.find("p30") != std::string::npos) return 30;
  return 25;
}

std::string controlSocketFromChannel(const std::string& channelId) {
  std::string n = "bgv13_playout_";
  for (char c : channelId) {
    if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')) {
      n += c;
    } else if (c == '-' || c == '_') {
      n += '_';
    }
  }
  if (n.size() <= 14) n += "default";
  return "/tmp/" + n + ".sock";
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

namespace channeld {

int runIntegratedPlayout() {
  std::signal(SIGINT, onSignal);
  std::signal(SIGTERM, onSignal);

  const int deviceIndex = std::atoi(envOr("DECKLINK_DEVICE_INDEX", "0").c_str());
  const std::string displayMode = envOr("DECKLINK_DISPLAY_MODE", "HD1080i50");
  const std::string keyerMode = envOr("DECKLINK_KEYER_MODE", "external");
  const std::string syncPref = envOr("DECKLINK_SYNC_PREFERENCE", "external_first");
  const std::string channelId = envOr("DECKLINK_CHANNEL_ID", "default");
  const std::string controlSocket =
      envOr("PLAYOUT_CONTROL_SOCKET", controlSocketFromChannel(channelId));

  const int width = modeWidth(displayMode);
  const int height = modeHeight(displayMode);
  const int targetFrameFps = modeFrameFps(displayMode);
  const bool interlaced = isInterlacedMode(displayMode);
  const int targetFieldFps = interlaced ? targetFrameFps * 2 : 0;

  std::cerr << "[decklink-unified] channel=" << channelId
            << " mode=" << displayMode << " keyer=" << keyerMode
            << " syncPref=" << syncPref
            << " " << width << "x" << height;
  if (interlaced) {
    std::cerr << " @" << targetFrameFps << "fps frames (" << targetFieldFps << " fields/s)";
  } else {
    std::cerr << " @" << targetFrameFps << "fps";
  }
  std::cerr << " (playout+output, hardware schedule, no SHM)\n";

  IDeckLinkOutput* syncOut = openOutputForSyncCheck(deviceIndex);
  const bool externalLocked = readExternalRefLocked(syncOut);
  if (syncOut) syncOut->Release();
  const auto selected = chooseSyncSource(externalLocked, syncPref);
  std::cerr << "[decklink-unified][Sync] Preference: " << syncPref << "\n";
  std::cerr << "[decklink-unified][Sync] External reference: "
            << (externalLocked ? "LOCKED" : "UNLOCKED") << " (mode=" << displayMode << ")\n";
  std::cerr << "[decklink-unified][Sync] Selected source: " << toString(selected) << "\n";

  playoutd::initFontRegistry();

  playoutd::ControlServer control(controlSocket);
  if (!control.start()) return 1;
  std::cerr << "[decklink-unified] control socket " << controlSocket << "\n";

  std::unique_ptr<playoutd::TimelineBridge> timelineBridge;
  if (playoutd::playoutUseNodeTimelineBridge()) {
    timelineBridge = std::make_unique<playoutd::TimelineBridge>();
  }
  playoutd::Scene scene(timelineBridge.get());
  scene.setOutputFrameRate(targetFrameFps);

  const bool renderAhead = envOr("DECKLINK_RENDER_AHEAD", "1") != "0";
  const bool hwTimeline = envOr("DECKLINK_HW_TIMELINE", "1") != "0";
  std::unique_ptr<RenderAhead> ahead;

  DecklinkOutput output;
  if (!output.open(deviceIndex, displayMode, keyerMode)) {
    std::cerr << "[decklink-unified] DeckLink output failed — is another decklink-channeld/Electron still running?\n";
    control.stop();
    return 3;
  }

  if (hwTimeline) {
    scene.setHwOnAirFrameQuery([&output]() { return output.hwOnAirFrameCount(); });
  }

  RenderAhead::HwFrameCountFn hwCountFn;
  if (hwTimeline) {
    hwCountFn = [&output]() { return output.hwOnAirFrameCount(); };
  }

  if (renderAhead) {
    ahead = std::make_unique<RenderAhead>(scene, width, height, output.targetFps(), hwCountFn);
    ahead->start();
    std::cerr << "[decklink-unified] render-ahead: on (DeckLink callback = memcpy only)\n";
  } else {
    std::cerr << "[decklink-unified] render-ahead: off (render inside DeckLink callback)\n";
  }

  if (hwTimeline) {
    std::cerr << "[decklink-unified] timeline: hardware SDI frame index (B4+)\n";
  } else {
    std::cerr << "[decklink-unified] timeline: software render pacing (DECKLINK_HW_TIMELINE=0)\n";
  }

  if (ahead) {
    output.setFrameProducer([&ahead](uint8_t* bgra, int w, int h) {
      const size_t bytes = static_cast<size_t>(w) * static_cast<size_t>(h) * 4u;
      ahead->copyReadyFrame(bgra, bytes);
    });
  } else {
    output.setFrameProducer([&scene, &output, hwTimeline](uint8_t* bgra, int w, int h) {
      if (hwTimeline) {
        scene.renderRgba(bgra, w, h, output.hwCurrentFillIndex());
      } else {
        scene.renderRgba(bgra, w, h);
      }
    });
  }

  uint64_t lastHwCompleted = 0;
  uint64_t lastRenderCount = 0;
  auto statsStart = std::chrono::steady_clock::now();

  while (g_running.load(std::memory_order_acquire)) {
    std::deque<playoutd::ControlCommand> cmds;
    if (control.drainCommands(cmds)) {
      for (const auto& cmd : cmds) {
        scene.apply(cmd);
        std::cerr << "[decklink-unified] " << playoutd::commandTypeName(cmd.type);
        if (!cmd.templateId.empty()) std::cerr << " template=" << cmd.templateId;
        if (!cmd.cueAction.empty()) std::cerr << " action=" << cmd.cueAction;
        if (!cmd.transitionRecipe.empty()) std::cerr << " recipe=" << cmd.transitionRecipe;
        std::cerr << "\n";
      }
    }

    const auto now = std::chrono::steady_clock::now();
    if (now - statsStart >= std::chrono::seconds(30)) {
      const double sec = std::chrono::duration<double>(now - statsStart).count();
      const uint64_t completed = output.hwFramesCompleted();
      const uint64_t delta = completed - lastHwCompleted;
      lastHwCompleted = completed;
      const double hwFps = sec > 0 ? static_cast<double>(delta) / sec : 0.0;
      const int hwTarget = output.targetFps();
      std::cerr << "[decklink-unified] stats: hwFps=" << hwFps
                << " targetFrameFps=" << hwTarget;
      if (interlaced) {
        std::cerr << " targetFieldFps=" << (hwTarget * 2);
      }
      std::cerr << " published=" << output.framesPushed()
                << " completed=" << completed
                << " late=" << output.hwFramesLate()
                << " dropped=" << output.hwFramesDropped();
      if (ahead) {
        const uint64_t rendered = ahead->framesRendered();
        const uint64_t renderDelta = rendered - lastRenderCount;
        lastRenderCount = rendered;
        const double renderFps = sec > 0 ? static_cast<double>(renderDelta) / sec : 0.0;
        std::cerr << " renderFps=" << renderFps;
        if (!interlaced && renderFps > 0 && renderFps < hwTarget - 2.0) {
          std::cerr << " (CPU render < target)";
        }
      }
      if (interlaced && hwFps > 0 && std::abs(hwFps - hwTarget) < 1.5) {
        std::cerr << " (interlaced: OK)";
      } else if (!interlaced && hwFps > 0 && hwFps < hwTarget - 2.0) {
        std::cerr << " (SDI behind render?)";
      }
      std::cerr << "\n";
      statsStart = now;
    }

    std::this_thread::sleep_for(std::chrono::milliseconds(5));
  }

  output.close();
  if (ahead) ahead->stop();
  control.stop();
  std::cerr << "[decklink-unified] stopped\n";
  return 0;
}

} // namespace channeld
