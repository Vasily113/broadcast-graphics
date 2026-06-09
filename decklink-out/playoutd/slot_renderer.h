#pragma once

#include "slot_state.h"
#include "timeline_bridge.h"

#include <cstdint>

namespace playoutd {

class TimelineBridge;

bool slotNeedsPerFrameTimeline(const OnAirSlot& slot);
bool slotIsStaticContent(const OnAirSlot& slot);

void invalidateSlotStaticCache(OnAirSlot& slot);
void refreshSlotStaticCache(OnAirSlot& slot, int width, int height);

/** Advance timeline model for this slot at globalFrame (mutates slot). */
void updateSlotAtFrame(OnAirSlot& slot, int globalFrame, TimelineBridge* bridge);

/** Render slot into BGRA buffer (full frame composite for this template). */
void renderSlotToBuffer(uint8_t* bgra, int width, int height, OnAirSlot& slot, int globalFrame, TimelineBridge* bridge);

} // namespace playoutd
