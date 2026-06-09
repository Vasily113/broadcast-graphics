#pragma once

#include <string>

namespace playoutd {

struct RenderFormat {
  int width = 1920;
  int height = 1080;
  int fps = 50;
  bool interlaced = true; // HD1080i50 default
  std::string decklinkModeId = "HD1080i50";
};

// Supported now: HD1080i50 (default), HD1080p50.
RenderFormat renderFormatFromDecklinkMode(const std::string& displayModeId);

} // namespace playoutd
