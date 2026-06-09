#include "slot_renderer.h"

#include "raster.h"
#include "template_model.h"
#include "template_render.h"
#include "timeline_bridge.h"
#include "timeline_native.h"

#include <cstring>

namespace playoutd {

bool slotNeedsPerFrameTimeline(const OnAirSlot& slot) {
  if (slot.useNativeTimeline) return slot.snapshot.hasAnimatedKeys;
  return templateNeedsPerFrameTimeline(slot.templateJson);
}

bool slotIsStaticContent(const OnAirSlot& slot) {
  if (slot.useNativeTimeline) return !slot.snapshot.hasAnimatedKeys;
  return !templateNeedsPerFrameTimeline(slot.templateJson);
}

void invalidateSlotStaticCache(OnAirSlot& slot) {
  slot.staticCacheValid = false;
}

void refreshSlotStaticCache(OnAirSlot& slot, int width, int height) {
  const size_t bytes = static_cast<size_t>(width) * static_cast<size_t>(height) * 4u;
  if (slot.staticBgra.size() != bytes) {
    slot.staticBgra.resize(bytes);
    slot.staticW = width;
    slot.staticH = height;
    slot.staticCacheValid = false;
  }
  if (slot.staticCacheValid) return;
  std::memset(slot.staticBgra.data(), 0, bytes);
  renderTemplate(slot.staticBgra.data(), width, height, slot.model, slot.variables);
  slot.staticCacheValid = true;
}

bool prepareSlotAtFrame(OnAirSlot& slot, int frame, TimelineBridge* bridge) {
  if (bridge && bridge->available()) {
    std::string prepared;
    if (!bridge->prepare(slot.templateId, frame, slot.variables, prepared)) return false;
    return parseTemplateObjectJson(prepared, slot.model, slot.variables, false);
  }
  return slot.hasModel;
}

void updateSlotAtFrame(OnAirSlot& slot, int globalFrame, TimelineBridge* bridge) {
  if (slot.isStatic) return;
  if (globalFrame == slot.lastGlobalFrame) return;

  if (slot.useNativeTimeline) {
    buildRenderModel(slot.snapshot, slot.timelinePlayback, globalFrame, slot.model);
    slot.lastGlobalFrame = globalFrame;
  } else if (templateNeedsPerFrameTimeline(slot.templateJson)) {
    prepareSlotAtFrame(slot, globalFrame, bridge);
    slot.lastGlobalFrame = globalFrame;
  }
}

void renderSlotToBuffer(uint8_t* bgra, int width, int height, OnAirSlot& slot, int globalFrame, TimelineBridge* bridge) {
  if (!slot.hasModel) return;

  if (slot.isStatic) {
    refreshSlotStaticCache(slot, width, height);
    compositeBgraOverBgra(bgra, width, height, slot.staticBgra.data());
    return;
  }

  updateSlotAtFrame(slot, globalFrame, bridge);
  renderTemplate(bgra, width, height, slot.model, slot.variables);
}

} // namespace playoutd
