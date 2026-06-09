#pragma once

#include "slot_state.h"

#include <cstdint>
#include <functional>
#include <vector>

namespace playoutd {

class TimelineBridge;

struct CompositorLayer {
  int stackOrder = 0;
  OnAirSlot* slot = nullptr;
};

using SlotGlobalFrameFn = std::function<int(const OnAirSlot&)>;

/** Draw idle / no-on-air background. */
void compositorDrawIdle(uint8_t* bgra, int width, int height);

/**
 * Composite on-air slots in stackOrder (low → high).
 * scratch must be width*height*4; used for animated slots.
 */
void compositorRenderFrame(
    uint8_t* bgra,
    int width,
    int height,
    const std::vector<CompositorLayer>& layers,
    SlotGlobalFrameFn globalFrameFor,
    uint8_t* scratch,
    TimelineBridge* bridge);

} // namespace playoutd
