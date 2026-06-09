#include "timeline_native.h"
#include "json_util.h"
#include "timeline_easing.h"
#include "template_model.h"

#include <algorithm>
#include <climits>
#include <cmath>
#include <iostream>
#include <optional>

namespace playoutd {
namespace {

using namespace json;

constexpr const char* kDefaultDirectorId = "default";
const char* kPositionProps[] = {"x", "y", "width", "height", "rotation", "scaleX", "scaleY"};

Transform identityTransform() { return {}; }

Transform composeTransforms(const Transform& parent, const Transform& local) {
  Transform o;
  o.x = parent.x + local.x;
  o.y = parent.y + local.y;
  o.width = local.width;
  o.height = local.height;
  o.rotation = parent.rotation + local.rotation;
  o.scaleX = parent.scaleX * local.scaleX;
  o.scaleY = parent.scaleY * local.scaleY;
  return o;
}

std::optional<double> numberInBag(const std::unordered_map<std::string, double>& bag, const char* key) {
  const auto it = bag.find(key);
  if (it == bag.end()) return std::nullopt;
  return it->second;
}

double propOr(const Transform& t, const char* prop, double fallback) {
  if (prop == std::string("x")) return t.x;
  if (prop == std::string("y")) return t.y;
  if (prop == std::string("width")) return t.width;
  if (prop == std::string("height")) return t.height;
  if (prop == std::string("rotation")) return t.rotation;
  if (prop == std::string("scaleX")) return t.scaleX;
  if (prop == std::string("scaleY")) return t.scaleY;
  return fallback;
}

void setProp(Transform& t, const char* prop, double v) {
  if (prop == std::string("x")) t.x = v;
  else if (prop == std::string("y")) t.y = v;
  else if (prop == std::string("width")) t.width = v;
  else if (prop == std::string("height")) t.height = v;
  else if (prop == std::string("rotation")) t.rotation = v;
  else if (prop == std::string("scaleX")) t.scaleX = v;
  else if (prop == std::string("scaleY")) t.scaleY = v;
}

bool parsePropBag(const std::string& obj, std::unordered_map<std::string, double>& out) {
  for (const char* prop : kPositionProps) {
    if (auto v = numberField(obj, prop)) out[prop] = *v;
  }
  return !out.empty();
}

Transform transformFromBag(const Transform& base, const std::unordered_map<std::string, double>& bag) {
  Transform t = base;
  for (const char* prop : kPositionProps) {
    if (auto v = numberInBag(bag, prop)) setProp(t, prop, *v);
  }
  return t;
}

bool parseStackArray(const std::string& arrBody, std::vector<StackEntry>& out) {
  out.clear();
  for (const std::string& obj : splitTopLevelObjects(arrBody)) {
    StackEntry e;
    e.kind = stringField(obj, "kind").value_or("layer");
    e.id = stringField(obj, "id").value_or("");
    if (!e.id.empty()) out.push_back(std::move(e));
  }
  return true;
}

std::vector<StackEntry> normalizeStack(
    const TemplateSnapshot& snap,
    const std::string& parentId) {
  std::vector<StackEntry> stack;
  std::unordered_map<std::string, bool> childGroups;
  std::unordered_map<std::string, bool> childLayers;
  for (const auto& g : snap.groups) {
    const std::string pid = g.parentId;
    if (pid == parentId) childGroups[g.id] = true;
  }
  auto layerGroupId = [&](const std::string& layerId) -> std::string {
    const auto it = snap.layerGroupIds.find(layerId);
    return it != snap.layerGroupIds.end() ? it->second : "";
  };
  auto considerLayer = [&](const std::string& layerId) {
    const std::string gid = layerGroupId(layerId);
    if (parentId.empty()) {
      if (gid.empty() || !childGroups.count(gid)) childLayers[layerId] = true;
    } else if (gid == parentId) {
      childLayers[layerId] = true;
    }
  };
  for (const auto& r : snap.baseModel.rects) considerLayer(r.id);
  for (const auto& t : snap.baseModel.texts) considerLayer(t.id);
  for (const auto& i : snap.baseModel.images) considerLayer(i.id);
  for (const auto& c : snap.baseModel.clocks) considerLayer(c.id);

  const std::vector<StackEntry>* stored = nullptr;
  if (parentId.empty()) {
    if (!snap.rootStack.empty()) stored = &snap.rootStack;
  } else {
    const auto it = snap.groupStacks.find(parentId);
    if (it != snap.groupStacks.end()) stored = &it->second;
  }

  if (stored && !stored->empty()) {
    for (const auto& e : *stored) {
      if (e.kind == "group" && childGroups.count(e.id)) stack.push_back(e);
      if (e.kind == "layer" && childLayers.count(e.id)) stack.push_back(e);
    }
    std::unordered_map<std::string, bool> seen;
    for (const auto& e : stack) seen[e.kind + ":" + e.id] = true;
    for (const auto& [id, _] : childGroups) {
      if (!seen["group:" + id]) stack.push_back({"group", id});
    }
    for (const auto& [id, _] : childLayers) {
      if (!seen["layer:" + id]) stack.push_back({"layer", id});
    }
    return stack;
  }

  for (const auto& [id, _] : childGroups) stack.push_back({"group", id});
  for (const auto& [id, _] : childLayers) stack.push_back({"layer", id});
  return stack;
}

void emitGroupLayers(
    const TemplateSnapshot& snap,
    const std::string& groupId,
    std::vector<std::string>& layerIds) {
  for (const auto& e : normalizeStack(snap, groupId)) {
    if (e.kind == "layer") {
      layerIds.push_back(e.id);
    } else {
      emitGroupLayers(snap, e.id, layerIds);
    }
  }
}

std::vector<std::string> flattenLayerIds(const TemplateSnapshot& snap) {
  std::vector<std::string> ordered;
  for (const auto& e : normalizeStack(snap, "")) {
    if (e.kind == "layer") {
      const auto it = snap.layerGroupIds.find(e.id);
      if (it == snap.layerGroupIds.end() || it->second.empty()) ordered.push_back(e.id);
    } else {
      emitGroupLayers(snap, e.id, ordered);
    }
  }
  std::unordered_map<std::string, bool> placed;
  for (const auto& id : ordered) placed[id] = true;
  for (const auto& kv : snap.layerGroupIds) {
    if (!placed[kv.first]) ordered.push_back(kv.first);
  }
  return ordered;
}

void rebuildPaintOrder(TemplateModel& model, const std::vector<std::string>& layerIds) {
  model.paintOrder.clear();
  auto add = [&](const std::string& prefix, const std::string& id) {
    model.paintOrder.push_back(prefix + id);
  };
  for (const std::string& id : layerIds) {
    for (const auto& r : model.rects) if (r.id == id) { add("rect:", id); break; }
    for (const auto& t : model.texts) if (t.id == id) { add("text:", id); break; }
    for (const auto& i : model.images) if (i.id == id) { add("image:", id); break; }
    for (const auto& c : model.clocks) if (c.id == id) { add("clock:", id); break; }
  }
}

const TimelineDirectorSnap* findDirector(const TimelineSnapshot& t, const std::string& id) {
  for (const auto& d : t.directors) if (d.id == id) return &d;
  return t.directors.empty() ? nullptr : &t.directors[0];
}

const TimelineDirectorSnap& directorForTrack(
    const TimelineSnapshot& timeline,
    const std::string& kind,
    const std::string& targetId,
    const std::string& prop) {
  const std::string key = kind + ":" + targetId + ":" + prop;
  const auto it = timeline.trackDirectors.find(key);
  const std::string dirId = it != timeline.trackDirectors.end() ? it->second : kDefaultDirectorId;
  if (const auto* d = findDirector(timeline, dirId)) return *d;
  static TimelineDirectorSnap fallback;
  return fallback;
}

int clampDirectorFrame(int value, const TimelineDirectorSnap& director) {
  return std::max(0, std::min(director.durationFrames, value));
}

struct LoopedFrame {
  int frame = 0;
  int direction = 1;
};

LoopedFrame resolveLoopedDirectorFrame(int value, const TimelineDirectorSnap& director) {
  LoopedFrame out;
  if (value < 0) {
    out.frame = 0;
    out.direction = 1;
    return out;
  }
  if (!director.loop) {
    out.frame = clampDirectorFrame(value, director);
    out.direction = 1;
    return out;
  }
  if (!director.swing) {
    const int period = director.durationFrames + 1;
    const int wrapped = ((value % period) + period) % period;
    out.frame = wrapped;
    out.direction = 1;
    return out;
  }
  const int duration = std::max(1, director.durationFrames);
  const int period = duration * 2;
  const int wrapped = ((value % period) + period) % period;
  if (wrapped == 0) return {0, 1};
  if (wrapped == duration) return {duration, -1};
  if (wrapped < duration) return {wrapped, 1};
  return {period - wrapped, -1};
}

LoopedFrame advanceDirectorFrame(
    int previousFrame,
    int delta,
    const TimelineDirectorSnap& director,
    int direction) {
  if (!director.loop || !director.swing) {
    return resolveLoopedDirectorFrame(previousFrame + delta, director);
  }
  const int duration = std::max(1, director.durationFrames);
  const int phase = direction == 1 ? previousFrame : (duration * 2) - previousFrame;
  return resolveLoopedDirectorFrame(phase + delta, director);
}

double getPropValue(
    double base,
    const std::string& kind,
    const std::string& targetId,
    const char* prop,
    int localFrame,
    const TimelineSnapshot& snap) {
  std::vector<const TimelineKeyframeSnap*> keys;
  for (const auto& kf : snap.keyframes) keys.push_back(&kf);

  std::vector<const TimelineKeyframeSnap*> withProp;
  for (const auto* kf : keys) {
    const auto* bag = kind == "layer" ? &kf->layers : &kf->groups;
    const auto tit = bag->find(targetId);
    if (tit == bag->end()) continue;
    if (tit->second.find(prop) != tit->second.end()) withProp.push_back(kf);
  }
  if (withProp.empty()) return base;
  if (localFrame < withProp.front()->frame) return base;

  int prevFrame = -1;
  double prevVal = base;
  int nextFrame = INT_MAX;
  double nextVal = base;
  std::string segmentEasing = "linear";
  const BezierSnap* segmentBezier = nullptr;
  for (const auto* kf : withProp) {
    const auto& bag = kind == "layer" ? kf->layers : kf->groups;
    const auto tit = bag.find(targetId);
    if (tit == bag.end()) continue;
    const auto& props = tit->second;
    const auto pv = props.find(prop);
    if (pv == props.end()) continue;
    if (kf->frame <= localFrame && kf->frame > prevFrame) {
      prevFrame = kf->frame;
      prevVal = pv->second;
    }
    if (kf->frame > localFrame && kf->frame < nextFrame) {
      nextFrame = kf->frame;
      nextVal = pv->second;
      segmentEasing = kf->easing;
      segmentBezier = kf->hasBezier ? &kf->bezier : nullptr;
    }
  }
  if (localFrame >= prevFrame && nextFrame == INT_MAX) return prevVal;
  if (prevFrame < 0 || nextFrame == INT_MAX) return base;
  if (prevFrame == nextFrame) return prevVal;
  const double t = static_cast<double>(localFrame - prevFrame) / (nextFrame - prevFrame);
  const double eased = applySegmentEase(t, segmentEasing, segmentBezier);
  return prevVal + (nextVal - prevVal) * eased;
}

Transform getLocalTransformAtFrame(
    const Transform& base,
    const std::string& kind,
    const std::string& targetId,
    const TimelineSnapshot& snap,
    int globalFrame,
    const std::unordered_map<std::string, int>& playheads) {
  Transform t = base;
  for (const char* prop : kPositionProps) {
    const auto& director = directorForTrack(snap, kind, targetId, prop);
    // Match editor: use playback playheads (stop/start/loop), not monotonic globalFrame.
    const auto it = playheads.find(director.id);
    int rawLocal = it != playheads.end()
        ? it->second
        : (director.autostart ? globalFrame - director.offsetFrames : 0);
    const LoopedFrame lf = resolveLoopedDirectorFrame(rawLocal, director);
    const double baseVal = propOr(base, prop, 0);
    setProp(t, prop, getPropValue(baseVal, kind, targetId, prop, lf.frame, snap));
  }
  return t;
}

std::vector<GroupSnapshot> getGroupChain(
    const std::string& groupId,
    const std::vector<GroupSnapshot>& groups) {
  std::vector<GroupSnapshot> chain;
  std::string id = groupId;
  std::unordered_map<std::string, bool> seen;
  while (!id.empty()) {
    if (seen[id]) break;
    seen[id] = true;
    const GroupSnapshot* g = nullptr;
    for (const auto& gr : groups) {
      if (gr.id == id) { g = &gr; break; }
    }
    if (!g) break;
    chain.insert(chain.begin(), *g);
    id = g->parentId;
  }
  return chain;
}

Transform getLayerWorldTransform(
    const std::string& layerId,
    const Transform& layerBase,
    const std::string& groupId,
    const TemplateSnapshot& snap,
    int globalFrame,
    const std::unordered_map<std::string, Transform>& groupLocals,
    const std::unordered_map<std::string, int>& playheads) {
  Transform parent = identityTransform();
  const auto chain = getGroupChain(groupId, snap.groups);
  for (const auto& g : chain) {
    const auto it = groupLocals.find(g.id);
    const Transform& local = it != groupLocals.end()
        ? it->second
        : getLocalTransformAtFrame(g.transform, "group", g.id, snap.timeline, globalFrame, playheads);
    parent = composeTransforms(parent, local);
  }
  const Transform layerLocal =
      getLocalTransformAtFrame(layerBase, "layer", layerId, snap.timeline, globalFrame, playheads);
  return composeTransforms(parent, layerLocal);
}

bool actionCrossed(int prev, int next, int actionFrame, int direction) {
  if (prev == next) return false;
  return direction == 1 ? prev < actionFrame && next >= actionFrame
                        : prev > actionFrame && next <= actionFrame;
}

void stepPlaybackToFrame(
    const TemplateSnapshot& snap,
    TimelinePlaybackState& state,
    int globalFrame) {
  const auto& timeline = snap.timeline;
  const int prev = std::max(0, state.lastGlobalFrame);
  const int next = std::max(0, globalFrame);
  const int delta = std::max(0, next - prev);

  if (state.directorPlayheads.empty()) {
    initTimelinePlaybackState(snap, state);
  }

  auto compute = [&](const std::unordered_map<std::string, int>& frozen) {
    std::unordered_map<std::string, int> playheads;
    std::unordered_map<std::string, int> directions;
    for (const auto& director : timeline.directors) {
      if (frozen.count(director.id)) {
        playheads[director.id] = frozen.at(director.id);
        directions[director.id] = state.directorDirections[director.id];
        continue;
      }
      if (state.directorStopped[director.id]) {
        playheads[director.id] = state.directorPlayheads[director.id];
        directions[director.id] = state.directorDirections[director.id];
        continue;
      }
      if (state.directorActive[director.id]) {
        const int previous = state.directorPlayheads[director.id];
        const int dir = state.directorDirections[director.id];
        const LoopedFrame lf = advanceDirectorFrame(previous, delta, director, dir);
        playheads[director.id] = lf.frame;
        directions[director.id] = lf.direction;
        continue;
      }
      if (director.autostart) {
        const LoopedFrame lf = resolveLoopedDirectorFrame(next - director.offsetFrames, director);
        playheads[director.id] = lf.frame;
        directions[director.id] = lf.direction;
        continue;
      }
      playheads[director.id] = state.directorPlayheads[director.id];
      directions[director.id] = state.directorDirections[director.id];
    }
    state.directorPlayheads = std::move(playheads);
    state.directorDirections = std::move(directions);
  };

  std::unordered_map<std::string, int> frozen;
  bool needsRecompute = false;

  const auto previousPlayheads = state.directorPlayheads;
  compute({});

  for (const auto& action : timeline.actions) {
    const auto* director = findDirector(timeline, action.directorId);
    if (!director) continue;
    const auto prevIt = previousPlayheads.find(action.directorId);
    const int prevSource = state.lastGlobalFrame < 0 || prevIt == previousPlayheads.end() ? 0 : prevIt->second;
    const int nextSource = state.directorPlayheads[action.directorId];
    int movementDirection = 1;
    if (director->swing && nextSource < prevSource) movementDirection = -1;
    if (!actionCrossed(prevSource, nextSource, action.frame, movementDirection)) continue;

    if (action.command == "startDirector" && !action.targetDirectorId.empty()) {
      state.directorActive[action.targetDirectorId] = true;
      state.directorStopped[action.targetDirectorId] = false;
      needsRecompute = true;
    } else if (action.command == "stopDirector" && !action.targetDirectorId.empty()) {
      state.directorActive[action.targetDirectorId] = false;
      state.directorStopped[action.targetDirectorId] = true;
      frozen[action.targetDirectorId] = state.directorPlayheads[action.targetDirectorId];
      needsRecompute = true;
    } else if (action.command == "setTag" && !action.tag.empty()) {
      state.tags[action.tag] = true;
    }
  }

  if (needsRecompute) {
    compute(frozen);
  }

  state.lastGlobalFrame = next;
}

bool parseTimelineObject(const std::string& timelineJson, TimelineSnapshot& snap) {
  snap.fps = static_cast<int>(numberField(timelineJson, "fps").value_or(50));
  if (snap.fps <= 0) snap.fps = 50;
  snap.durationFrames = static_cast<int>(numberField(timelineJson, "durationFrames").value_or(500));
  snap.playbackMode =
      stringField(timelineJson, "playbackMode").value_or("bounded") == "infinite" ? "infinite" : "bounded";

  if (auto directorsArr = extractArray(timelineJson, "directors")) {
    for (const std::string& obj : splitTopLevelObjects(*directorsArr)) {
      TimelineDirectorSnap d;
      d.id = stringField(obj, "id").value_or(kDefaultDirectorId);
      d.durationFrames = static_cast<int>(numberField(obj, "durationFrames").value_or(snap.durationFrames));
      d.offsetFrames = static_cast<int>(numberField(obj, "offsetFrames").value_or(0));
      d.autostart = boolField(obj, "autostart").value_or(true);
      d.loop = boolField(obj, "loop").value_or(false);
      d.swing = d.loop ? boolField(obj, "swing").value_or(false) : false;
      snap.directors.push_back(std::move(d));
    }
  }
  if (snap.directors.empty()) {
    TimelineDirectorSnap d;
    d.id = kDefaultDirectorId;
    d.durationFrames = snap.durationFrames;
    d.autostart = true;
    snap.directors.push_back(d);
  }

  if (auto td = extractObject(timelineJson, "trackDirectors")) {
    size_t i = 1;
    while (i < td->size()) {
      if ((*td)[i] == '}') break;
      if ((*td)[i] == ',') { ++i; continue; }
      if ((*td)[i] != '"') { ++i; continue; }
      const auto key = parseObjectKeyAt(*td, i);
      if (!key) break;
      while (i < td->size() && (*td)[i] != '"') ++i;
      if (i >= td->size()) break;
      const auto val = parseObjectKeyAt(*td, i);
      if (!val) break;
      snap.trackDirectors[*key] = *val;
    }
  }

  if (auto kfArr = extractArray(timelineJson, "keyframes")) {
    for (const std::string& kfObj : splitTopLevelObjects(*kfArr)) {
      TimelineKeyframeSnap kf;
      kf.frame = static_cast<int>(numberField(kfObj, "frame").value_or(0));
      kf.easing = stringField(kfObj, "easing").value_or("linear");
      if (auto bezierObj = extractObject(kfObj, "bezier")) {
        BezierSnap b;
        b.cp1x = numberField(*bezierObj, "cp1x").value_or(0.25);
        b.cp1y = numberField(*bezierObj, "cp1y").value_or(0.1);
        b.cp2x = numberField(*bezierObj, "cp2x").value_or(0.25);
        b.cp2y = numberField(*bezierObj, "cp2y").value_or(1.0);
        b.valid = true;
        kf.bezier = b;
        kf.hasBezier = true;
      }
      if (auto layersObj = extractObject(kfObj, "layers")) {
        size_t i = 1;
        while (i < layersObj->size()) {
          if ((*layersObj)[i] == '}') break;
          if ((*layersObj)[i] == ',') { ++i; continue; }
          if ((*layersObj)[i] != '"') { ++i; continue; }
          const auto layerId = parseObjectKeyAt(*layersObj, i);
          if (!layerId) break;
          while (i < layersObj->size() && (*layersObj)[i] != '{') ++i;
          if (i >= layersObj->size()) break;
          auto bagObj = sliceBalanced(*layersObj, i, '{', '}');
          if (!bagObj) break;
          std::unordered_map<std::string, double> bag;
          parsePropBag(*bagObj, bag);
          if (!bag.empty()) kf.layers[*layerId] = std::move(bag);
          i += bagObj->size();
        }
      }
      if (auto groupsObj = extractObject(kfObj, "groups")) {
        size_t i = 1;
        while (i < groupsObj->size()) {
          if ((*groupsObj)[i] == '}') break;
          if ((*groupsObj)[i] == ',') { ++i; continue; }
          if ((*groupsObj)[i] != '"') { ++i; continue; }
          const auto groupId = parseObjectKeyAt(*groupsObj, i);
          if (!groupId) break;
          while (i < groupsObj->size() && (*groupsObj)[i] != '{') ++i;
          if (i >= groupsObj->size()) break;
          auto bagObj = sliceBalanced(*groupsObj, i, '{', '}');
          if (!bagObj) break;
          std::unordered_map<std::string, double> bag;
          parsePropBag(*bagObj, bag);
          if (!bag.empty()) kf.groups[*groupId] = std::move(bag);
          i += bagObj->size();
        }
      }
      snap.keyframes.push_back(std::move(kf));
    }
    std::sort(snap.keyframes.begin(), snap.keyframes.end(),
              [](const auto& a, const auto& b) { return a.frame < b.frame; });
  }

  if (auto actionsArr = extractArray(timelineJson, "actions")) {
    for (const std::string& obj : splitTopLevelObjects(*actionsArr)) {
      TimelineActionSnap a;
      a.directorId = stringField(obj, "directorId").value_or(kDefaultDirectorId);
      a.frame = static_cast<int>(numberField(obj, "frame").value_or(0));
      a.command = stringField(obj, "command").value_or("startDirector");
      a.targetDirectorId = stringField(obj, "targetDirectorId").value_or("");
      a.tag = stringField(obj, "tag").value_or("");
      snap.actions.push_back(std::move(a));
    }
    std::sort(snap.actions.begin(), snap.actions.end(),
              [](const auto& a, const auto& b) { return a.frame < b.frame; });
  }

  return true;
}

bool hasAnimatedKeys(const TimelineSnapshot& snap) {
  if (!snap.actions.empty()) return true;
  for (const auto& kf : snap.keyframes) {
    if (!kf.layers.empty() || !kf.groups.empty()) return true;
  }
  return false;
}

} // namespace

bool loadTemplateSnapshot(
    const std::string& templateJson,
    TemplateSnapshot& out,
    const std::unordered_map<std::string, std::string>& variables) {
  out = {};
  if (!parseTemplateObjectJson(templateJson, out.baseModel, variables, true)) return false;

  if (auto layersArr = extractArray(templateJson, "layers")) {
    for (const std::string& layerObj : splitTopLevelObjects(*layersArr)) {
      const auto id = stringField(layerObj, "id").value_or("");
      if (auto gid = stringField(layerObj, "groupId")) {
        if (!gid->empty()) out.layerGroupIds[id] = *gid;
      }
    }
  }

  if (auto groupsArr = extractArray(templateJson, "groups")) {
    for (const std::string& obj : splitTopLevelObjects(*groupsArr)) {
      GroupSnapshot g;
      g.id = stringField(obj, "id").value_or("");
      g.parentId = stringField(obj, "parentId").value_or("");
      if (auto tr = extractObject(obj, "transform")) {
        g.transform.x = numberField(*tr, "x").value_or(0);
        g.transform.y = numberField(*tr, "y").value_or(0);
        g.transform.width = numberField(*tr, "width").value_or(100);
        g.transform.height = numberField(*tr, "height").value_or(100);
        g.transform.rotation = numberField(*tr, "rotation").value_or(0);
        g.transform.scaleX = numberField(*tr, "scaleX").value_or(1);
        g.transform.scaleY = numberField(*tr, "scaleY").value_or(1);
      }
      if (!g.id.empty()) out.groups.push_back(std::move(g));
    }
  }

  if (auto rs = extractArray(templateJson, "rootStack")) parseStackArray(*rs, out.rootStack);

  if (auto gs = extractObject(templateJson, "groupStacks")) {
    size_t i = 1;
    while (i < gs->size()) {
      if ((*gs)[i] == '}') break;
      if ((*gs)[i] == ',') { ++i; continue; }
      if ((*gs)[i] != '"') { ++i; continue; }
      const auto groupId = parseObjectKeyAt(*gs, i);
      if (!groupId) break;
      while (i < gs->size() && (*gs)[i] != '[') ++i;
      if (i >= gs->size()) break;
      auto arr = sliceBalanced(*gs, i, '[', ']');
      if (!arr) break;
      std::vector<StackEntry> entries;
      parseStackArray(*arr, entries);
      if (!groupId->empty()) out.groupStacks[*groupId] = std::move(entries);
      i += arr->size();
    }
  }

  if (auto timeline = extractObject(templateJson, "timeline")) {
    parseTimelineObject(*timeline, out.timeline);
  }

  out.hasAnimatedKeys = hasAnimatedKeys(out.timeline);
  out.needsStackFlatten = !out.rootStack.empty() || !out.groups.empty();
  out.cachedPaintOrder = buildPaintOrderFromSnapshot(out);
  return true;
}

std::vector<std::string> buildPaintOrderFromSnapshot(const TemplateSnapshot& snap) {
  if (!snap.needsStackFlatten && !snap.hasAnimatedKeys) return snap.baseModel.paintOrder;
  TemplateModel tmp = snap.baseModel;
  rebuildPaintOrder(tmp, flattenLayerIds(snap));
  return tmp.paintOrder;
}

void initTimelinePlaybackState(const TemplateSnapshot& snap, TimelinePlaybackState& state) {
  state = {};
  state.lastGlobalFrame = -1;
  for (const auto& d : snap.timeline.directors) {
    state.directorPlayheads[d.id] = 0;
    state.directorDirections[d.id] = 1;
    state.directorActive[d.id] = false;
    state.directorStopped[d.id] = false;
  }
}

void buildRenderModel(
    const TemplateSnapshot& snap,
    TimelinePlaybackState& playback,
    int globalFrame,
    TemplateModel& out) {
  if (!snap.hasAnimatedKeys && !snap.needsStackFlatten) return;

  {
    if (snap.hasAnimatedKeys) {
      stepPlaybackToFrame(snap, playback, globalFrame);
    } else if (playback.lastGlobalFrame < 0) {
      initTimelinePlaybackState(snap, playback);
      playback.lastGlobalFrame = globalFrame;
    }

    const auto& playheads = playback.directorPlayheads;

    std::unordered_map<std::string, Transform> groupLocals;
    for (const auto& g : snap.groups) {
      groupLocals[g.id] =
          getLocalTransformAtFrame(g.transform, "group", g.id, snap.timeline, globalFrame, playheads);
    }

    auto applyToLayer = [&](auto& layer, const std::string& id, const Transform& base) {
      const std::string gid = snap.layerGroupIds.count(id) ? snap.layerGroupIds.at(id) : "";
      layer.transform = getLayerWorldTransform(id, base, gid, snap, globalFrame, groupLocals, playheads);
    };

    for (auto& r : out.rects) {
      for (const auto& br : snap.baseModel.rects) {
        if (br.id == r.id) { applyToLayer(r, r.id, br.transform); break; }
      }
    }
    for (auto& t : out.texts) {
      for (const auto& bt : snap.baseModel.texts) {
        if (bt.id == t.id) { applyToLayer(t, t.id, bt.transform); break; }
      }
    }
    for (auto& i : out.images) {
      for (const auto& bi : snap.baseModel.images) {
        if (bi.id == i.id) { applyToLayer(i, i.id, bi.transform); break; }
      }
    }
    for (auto& c : out.clocks) {
      for (const auto& bc : snap.baseModel.clocks) {
        if (bc.id == c.id) { applyToLayer(c, c.id, bc.transform); break; }
      }
    }

  }
}

} // namespace playoutd
