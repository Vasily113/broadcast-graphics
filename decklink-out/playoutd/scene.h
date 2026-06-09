#pragma once

#include "compositor.h"
#include "protocol.h"
#include "scene_clock.h"
#include "slot_state.h"
#include "timeline_bridge.h"

#include <cstdint>
#include <functional>
#include <mutex>
#include <string>
#include <unordered_map>
#include <vector>

namespace playoutd {

bool playoutUseNodeTimelineBridge();

class Scene {
 public:
  explicit Scene(TimelineBridge* bridge = nullptr);

  void apply(const ControlCommand& cmd);
  void renderRgba(uint8_t* bgra, int width, int height);
  void renderRgba(uint8_t* bgra, int width, int height, uint64_t displayFrameIndex);

  void setOutputFrameRate(int fps);
  void setHwOnAirFrameQuery(std::function<uint64_t()> query);

  bool paused() const;
  bool usesHwTimeline() const { return clock_.hasHwQuery(); }

 private:
  void handleTake(const ControlCommand& cmd);
  void handleClear(const ControlCommand& cmd);
  void handleUpdate(const ControlCommand& cmd);
  void handlePause();
  void handleContinue();
  void handleCue(const ControlCommand& cmd);
  void handleTransition(const ControlCommand& cmd);

  int globalFrameForSlot(const OnAirSlot& slot, uint64_t rawHw) const;
  std::vector<CompositorLayer> buildLayerList();

  TimelineBridge* bridge_ = nullptr;
  SceneClock clock_;
  mutable std::mutex mutex_;
  std::unordered_map<std::string, OnAirSlot> onAir_;
  int nextStackOrder_ = 0;
  std::vector<uint8_t> scratch_;
};

} // namespace playoutd
