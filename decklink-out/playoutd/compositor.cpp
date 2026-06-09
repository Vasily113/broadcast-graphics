#include "compositor.h"

#include "raster.h"
#include "slot_renderer.h"
#include "timeline_bridge.h"

#include <algorithm>
#include <cstring>

namespace playoutd {

void compositorDrawIdle(uint8_t* bgra, int width, int height) {
  Rgba bg {16, 16, 16, 255};
  fillRectBgra(bgra, width, height, 0, 0, width, height, bg);
  fillRectBgra(bgra, width, height, 48, height - 120, width - 96, 72, {32, 32, 96, 255});
}

void compositorRenderFrame(
    uint8_t* bgra,
    int width,
    int height,
    const std::vector<CompositorLayer>& layers,
    SlotGlobalFrameFn globalFrameFor,
    uint8_t* scratch,
    TimelineBridge* bridge) {
  const size_t frameBytes = static_cast<size_t>(width) * static_cast<size_t>(height) * 4u;
  std::memset(bgra, 0, frameBytes);

  std::vector<CompositorLayer> sorted = layers;
  std::sort(sorted.begin(), sorted.end(), [](const CompositorLayer& a, const CompositorLayer& b) {
    return a.stackOrder < b.stackOrder;
  });

  for (const CompositorLayer& layer : sorted) {
    OnAirSlot* slot = layer.slot;
    if (!slot || !slot->hasModel) continue;
    if (slot->lifecycle == SlotLifecycle::Off) continue;

    const int gFrame = globalFrameFor(*slot);

    if (slot->isStatic) {
      renderSlotToBuffer(bgra, width, height, *slot, gFrame, bridge);
    } else {
      std::memset(scratch, 0, frameBytes);
      renderSlotToBuffer(scratch, width, height, *slot, gFrame, bridge);
      compositeBgraOverBgra(bgra, width, height, scratch);
    }
  }
}

} // namespace playoutd
