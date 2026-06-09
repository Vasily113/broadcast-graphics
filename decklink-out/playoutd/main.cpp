#include "control_server.h"
#include "font_registry.h"
#include "render_format.h"
#include "scene.h"

#include <memory>
#include "timeline_bridge.h"

#include "../channeld/shm_frame.h"
#include "../channeld/shm_ring.h"

#include <atomic>
#include <chrono>
#include <csignal>
#include <cstdlib>
#include <deque>
#include <iostream>
#include <string>
#include <thread>
#include <vector>

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

} // namespace

int main() {
  std::signal(SIGINT, onSignal);
  std::signal(SIGTERM, onSignal);

  const std::string channelId = envOr("DECKLINK_CHANNEL_ID", "default");
  const std::string displayMode = envOr("DECKLINK_DISPLAY_MODE", "HD1080i50");
  const std::string shmName = envOr("DECKLINK_SHM_NAME", channeld::shmNameFromChannelId(channelId));
  const std::string controlSocket = envOr("PLAYOUT_CONTROL_SOCKET", controlSocketFromChannel(channelId));

  const playoutd::RenderFormat format = playoutd::renderFormatFromDecklinkMode(displayMode);
  const int width = modeWidth(displayMode);
  const int height = modeHeight(displayMode);
  constexpr int kSlotCount = channeld::kMaxSlots;

  std::cout << "[playoutd] channel=" << channelId
            << " shm=" << shmName
            << " mode=" << format.decklinkModeId
            << " " << width << "x" << height << "@" << format.fps
            << (format.interlaced ? "i" : "p") << "\n";

  channeld::ShmMapping shm {};
  for (int attempt = 0; attempt < 60 && g_running.load(); ++attempt) {
    if (channeld::shmAttach(shmName, width, height, kSlotCount, shm)) break;
    std::this_thread::sleep_for(std::chrono::milliseconds(100));
  }
  if (!shm.header) {
    std::cerr << "[playoutd] failed to attach SHM " << shmName << " (is decklink-channeld running?)\n";
    return 1;
  }

  playoutd::initFontRegistry();

  playoutd::ControlServer control(controlSocket);
  if (!control.start()) return 1;

  std::unique_ptr<playoutd::TimelineBridge> timelineBridge;
  if (playoutd::playoutUseNodeTimelineBridge()) {
    timelineBridge = std::make_unique<playoutd::TimelineBridge>();
  }
  playoutd::Scene scene(timelineBridge.get());
  scene.setOutputFrameRate(format.fps);
  std::vector<uint8_t> frame(static_cast<size_t>(width) * static_cast<size_t>(height) * 4u);

  const auto framePeriod = std::chrono::nanoseconds(1'000'000'000 / std::max(1, format.fps));
  auto nextTick = std::chrono::steady_clock::now();

  uint64_t published = 0;
  auto statsAt = std::chrono::steady_clock::now();

  while (g_running.load(std::memory_order_acquire)) {
    std::deque<playoutd::ControlCommand> cmds;
    if (control.drainCommands(cmds)) {
      for (const auto& cmd : cmds) {
        scene.apply(cmd);
        std::cout << "[playoutd] " << playoutd::commandTypeName(cmd.type);
        if (!cmd.templateId.empty()) std::cout << " template=" << cmd.templateId;
        std::cout << "\n";
      }
    }

    scene.renderRgba(frame.data(), width, height);
    channeld::shmPublishBgra(shm, frame.data(), frame.size(), false);
    ++published;

    const auto now = std::chrono::steady_clock::now();
    if (now - statsAt >= std::chrono::seconds(30)) {
      const double sec = std::chrono::duration<double>(now - statsAt).count();
      std::cout << "[playoutd] publish ~" << (published / sec) << " fps (target " << format.fps << ")\n";
      published = 0;
      statsAt = now;
    }

    nextTick += framePeriod;
    std::this_thread::sleep_until(nextTick);
  }

  control.stop();
  channeld::shmDetach(shm);
  std::cout << "[playoutd] stopped\n";
  return 0;
}
