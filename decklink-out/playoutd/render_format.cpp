#include "render_format.h"

namespace playoutd {

RenderFormat renderFormatFromDecklinkMode(const std::string& displayModeId) {
  RenderFormat f;
  if (displayModeId.find("HD720") != std::string::npos) {
    f.width = 1280;
    f.height = 720;
  }

  if (displayModeId == "HD1080p50") {
    f.interlaced = false;
    f.decklinkModeId = displayModeId;
    f.fps = 50;
    return f;
  }

  if (displayModeId.find("p50") != std::string::npos) {
    f.interlaced = false;
    f.fps = 50;
  } else if (displayModeId.find("p25") != std::string::npos) {
    f.interlaced = false;
    f.fps = 25;
  } else if (displayModeId.find("i50") != std::string::npos) {
    f.interlaced = true;
    f.fps = 25; // 25 video frames/s, 50 fields/s
  }

  if (displayModeId.empty() || displayModeId == "HD1080i50") {
    f.interlaced = true;
    f.decklinkModeId = "HD1080i50";
    f.fps = 25;
  } else {
    f.decklinkModeId = displayModeId;
  }

  return f;
}

} // namespace playoutd
