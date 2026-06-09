#include "scene.h"

#include "json_util.h"
#include "slot_renderer.h"
#include "template_model.h"
#include "template_render.h"
#include "timeline_bridge.h"
#include "timeline_native.h"

#include <cstdlib>
#include <cstring>
#include <iostream>

namespace playoutd {

bool playoutUseNodeTimelineBridge() {
  const char* env = std::getenv("PLAYOUT_USE_NODE_TIMELINE");
  return env && *env && (env[0] == '1' || env[0] == 'y' || env[0] == 'Y');
}

namespace {

void mergeVariablesFromJson(const std::string& json, std::unordered_map<std::string, std::string>& variables) {
  const auto varsObj = json::extractObject(json, "variables");
  if (!varsObj) return;
  size_t i = 1;
  while (i < varsObj->size()) {
    if (varsObj->at(i) == '}') break;
    if (varsObj->at(i) == ',') { ++i; continue; }
    if (varsObj->at(i) != '"') { ++i; continue; }
    const auto key = json::parseObjectKeyAt(*varsObj, i);
    if (!key) break;
    while (i < varsObj->size() && varsObj->at(i) != '"') ++i;
    if (i >= varsObj->size()) break;
    const auto val = json::parseObjectKeyAt(*varsObj, i);
    if (!val) break;
    variables[*key] = *val;
  }
}

uint64_t takeAnchorFrame(const SceneClock& clock) {
  if (clock.hasHwQuery()) return clock.rawHwFrame();
  return clock.currentTimelineHwIndex();
}

} // namespace

Scene::Scene(TimelineBridge* bridge) : bridge_(bridge) {}

void Scene::setOutputFrameRate(int fps) {
  std::lock_guard<std::mutex> lock(mutex_);
  clock_.setOutputFrameRate(fps);
}

void Scene::setHwOnAirFrameQuery(std::function<uint64_t()> query) {
  std::lock_guard<std::mutex> lock(mutex_);
  clock_.setHwOnAirFrameQuery(std::move(query));
}

bool Scene::paused() const {
  std::lock_guard<std::mutex> lock(mutex_);
  return clock_.paused();
}

int Scene::globalFrameForSlot(const OnAirSlot& slot, uint64_t rawHw) const {
  return clock_.globalFrameForTake(slot.takeDisplayFrame, slot.timelineFps, rawHw);
}

std::vector<CompositorLayer> Scene::buildLayerList() {
  std::vector<CompositorLayer> layers;
  layers.reserve(onAir_.size());
  for (auto& kv : onAir_) {
    CompositorLayer layer;
    layer.stackOrder = kv.second.stackOrder;
    layer.slot = &kv.second;
    layers.push_back(layer);
  }
  return layers;
}

void Scene::handleTake(const ControlCommand& cmd) {
  OnAirSlot slot;
  slot.templateId = cmd.templateId;
  slot.takeJson = cmd.rawJson;
  slot.takeTime = std::chrono::steady_clock::now();
  slot.takeDisplayFrame = takeAnchorFrame(clock_);
  slot.lastGlobalFrame = -1;
  slot.stackOrder = nextStackOrder_++;
  slot.lifecycle = SlotLifecycle::On;
  invalidateSlotStaticCache(slot);

  const auto templateObj = json::extractObject(cmd.rawJson, "template");
  if (!templateObj) return;

  slot.templateJson = *templateObj;
  slot.timelineFps = parseTimelineFps(slot.templateJson);
  parseTemplateFromTakeJson(cmd.rawJson, slot.model, slot.variables, true);

  const bool bridgeOk = bridge_ && bridge_->available();
  const bool preferNative = !playoutUseNodeTimelineBridge();

  if (preferNative && loadTemplateSnapshot(slot.templateJson, slot.snapshot, slot.variables)) {
    slot.useNativeTimeline = true;
    slot.model = slot.snapshot.baseModel;
    slot.model.paintOrder = slot.snapshot.cachedPaintOrder;
    initTimelinePlaybackState(slot.snapshot, slot.timelinePlayback);
    clearLayerRasterCache();
    buildRenderModel(slot.snapshot, slot.timelinePlayback, 0, slot.model);
    slot.lastGlobalFrame = 0;
  } else if (bridgeOk) {
    slot.useNativeTimeline = false;
    const bool perFrame = templateNeedsPerFrameTimeline(slot.templateJson);
    const bool stackOnce = !perFrame && templateNeedsStackFlattenPrepare(slot.templateJson);
    if (perFrame || stackOnce) {
      if (!bridge_->loadTemplate(slot.templateId, slot.templateJson)) {
        std::cerr << "[playoutd] timeline load failed for " << slot.templateId << "\n";
      }
      updateSlotAtFrame(slot, 0, bridge_);
      slot.lastGlobalFrame = 0;
    }
    std::cout << "[playoutd] take " << slot.templateId
              << " timeline=node perFrame=" << (perFrame ? 1 : 0)
              << " timelineFps=" << slot.timelineFps << "\n";
  } else {
    slot.useNativeTimeline = false;
    std::cout << "[playoutd] take " << slot.templateId << " timeline=static\n";
  }

  slot.hasModel = true;
  slot.isStatic = slotIsStaticContent(slot);
  if (slot.useNativeTimeline) {
    std::cout << "[playoutd] take " << slot.templateId
              << " timeline=native animated=" << (slot.snapshot.hasAnimatedKeys ? 1 : 0)
              << " static=" << (slot.isStatic ? 1 : 0)
              << " timelineFps=" << slot.timelineFps << "\n";
  }
  onAir_[cmd.templateId] = std::move(slot);
}

void Scene::handleClear(const ControlCommand& cmd) {
  if (bridge_ && bridge_->available()) {
    bridge_->unloadTemplate(cmd.templateId);
  }
  if (onAir_.erase(cmd.templateId) > 0) clearLayerRasterCache();
}

void Scene::handleUpdate(const ControlCommand& cmd) {
  auto it = onAir_.find(cmd.templateId);
  if (it == onAir_.end()) return;
  mergeVariablesFromJson(cmd.rawJson, it->second.variables);
  it->second.lastGlobalFrame = -1;
  invalidateSlotStaticCache(it->second);
  const uint64_t rawHw = clock_.hasHwQuery() ? clock_.rawHwFrame() : clock_.softwareFrameTick();
  const int frame = globalFrameForSlot(it->second, rawHw);
  if (it->second.useNativeTimeline) {
    buildRenderModel(it->second.snapshot, it->second.timelinePlayback, frame, it->second.model);
    it->second.lastGlobalFrame = frame;
  } else if (templateNeedsPerFrameTimeline(it->second.templateJson)) {
    updateSlotAtFrame(it->second, frame, bridge_);
  } else if (!it->second.takeJson.empty()) {
    parseTemplateFromTakeJson(it->second.takeJson, it->second.model, it->second.variables, false);
  }
  it->second.isStatic = slotIsStaticContent(it->second);
}

void Scene::handlePause() {
  if (clock_.paused()) return;
  clock_.pause(clock_.rawHwFrame());
  std::cout << "[playoutd] pause channel timeline at hw=" << clock_.rawHwFrame() << "\n";
}

void Scene::handleContinue() {
  if (!clock_.paused()) return;
  const uint64_t raw = clock_.rawHwFrame();
  clock_.resume(raw);
  std::cout << "[playoutd] continue channel timeline at hw=" << raw << "\n";
}

void Scene::handleCue(const ControlCommand& cmd) {
  std::cout << "[playoutd] cue (skeleton) action=" << cmd.cueAction
            << " target=" << (cmd.targetSlotId.empty() ? cmd.templateId : cmd.targetSlotId) << "\n";
}

void Scene::handleTransition(const ControlCommand& cmd) {
  std::cout << "[playoutd] transition (skeleton) recipe=" << cmd.transitionRecipe << "\n";
}

void Scene::apply(const ControlCommand& cmd) {
  std::lock_guard<std::mutex> lock(mutex_);

  switch (cmd.type) {
    case CommandType::Take:
      if (!cmd.templateId.empty()) handleTake(cmd);
      break;
    case CommandType::Clear:
      if (!cmd.templateId.empty()) handleClear(cmd);
      break;
    case CommandType::Update:
      if (!cmd.templateId.empty()) handleUpdate(cmd);
      break;
    case CommandType::Pause:
      handlePause();
      break;
    case CommandType::Continue:
      handleContinue();
      break;
    case CommandType::Cue:
      handleCue(cmd);
      break;
    case CommandType::Transition:
      handleTransition(cmd);
      break;
    default:
      break;
  }
}

void Scene::renderRgba(uint8_t* bgra, int width, int height) {
  uint64_t rawHw = 0;
  {
    std::lock_guard<std::mutex> lock(mutex_);
    rawHw = clock_.hasHwQuery() ? clock_.rawHwFrame() : clock_.softwareFrameTick();
  }
  renderRgba(bgra, width, height, rawHw);
}

void Scene::renderRgba(uint8_t* bgra, int width, int height, uint64_t rawHw) {
  const size_t frameBytes = static_cast<size_t>(width) * static_cast<size_t>(height) * 4u;

  std::lock_guard<std::mutex> lock(mutex_);

  if (onAir_.empty()) {
    compositorDrawIdle(bgra, width, height);
    return;
  }

  if (scratch_.size() != frameBytes) scratch_.resize(frameBytes);

  const auto layers = buildLayerList();
  const auto globalFn = [this, rawHw](const OnAirSlot& slot) {
    return globalFrameForSlot(slot, rawHw);
  };

  compositorRenderFrame(bgra, width, height, layers, globalFn, scratch_.data(), bridge_);
}

} // namespace playoutd
