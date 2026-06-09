#pragma once

#include "template_model.h"
#include "timeline_native.h"

#include <chrono>
#include <cstdint>
#include <string>
#include <unordered_map>
#include <vector>

namespace playoutd {

enum class SlotLifecycle {
  Off,
  On,
  Hold,
};

struct OnAirSlot {
  std::string templateId;
  std::string takeJson;
  std::string templateJson;
  TemplateModel model;
  TemplateSnapshot snapshot;
  TimelinePlaybackState timelinePlayback;
  bool useNativeTimeline = false;
  std::unordered_map<std::string, std::string> variables;
  std::chrono::steady_clock::time_point takeTime {};
  uint64_t takeDisplayFrame = 0;
  int timelineFps = 50;
  int lastGlobalFrame = -1;
  int stackOrder = 0;
  SlotLifecycle lifecycle = SlotLifecycle::On;
  bool hasModel = false;
  bool isStatic = false;
  std::vector<uint8_t> staticBgra;
  int staticW = 0;
  int staticH = 0;
  bool staticCacheValid = false;
};

} // namespace playoutd
