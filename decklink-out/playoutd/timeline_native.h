#pragma once

#include "template_model.h"

#include <string>
#include <unordered_map>
#include <vector>

namespace playoutd {

struct StackEntry {
  std::string kind;  // "layer" | "group"
  std::string id;
};

struct GroupSnapshot {
  std::string id;
  std::string parentId;
  Transform transform;
};

struct BezierSnap {
  double cp1x = 0.25;
  double cp1y = 0.1;
  double cp2x = 0.25;
  double cp2y = 1.0;
  bool valid = false;
};

struct TimelineKeyframeSnap {
  int frame = 0;
  std::string easing = "linear";
  BezierSnap bezier;
  bool hasBezier = false;
  std::unordered_map<std::string, std::unordered_map<std::string, double>> layers;
  std::unordered_map<std::string, std::unordered_map<std::string, double>> groups;
};

struct TimelineDirectorSnap {
  std::string id;
  int durationFrames = 125;
  int offsetFrames = 0;
  bool autostart = true;
  bool loop = false;
  bool swing = false;
};

struct TimelineActionSnap {
  std::string directorId;
  int frame = 0;
  std::string command;
  std::string targetDirectorId;
  std::string tag;
};

struct TimelineSnapshot {
  int fps = 50;
  int durationFrames = 500;
  std::string playbackMode = "bounded";
  std::vector<TimelineDirectorSnap> directors;
  std::unordered_map<std::string, std::string> trackDirectors;
  std::vector<TimelineKeyframeSnap> keyframes;
  std::vector<TimelineActionSnap> actions;
};

struct TemplateSnapshot {
  TemplateModel baseModel;
  std::unordered_map<std::string, std::string> layerGroupIds;
  std::vector<GroupSnapshot> groups;
  std::vector<StackEntry> rootStack;
  std::unordered_map<std::string, std::vector<StackEntry>> groupStacks;
  TimelineSnapshot timeline;
  bool hasAnimatedKeys = false;
  bool needsStackFlatten = false;
  /** Built once at load; stable while template is on air. */
  std::vector<std::string> cachedPaintOrder;
};

struct TimelinePlaybackState {
  std::unordered_map<std::string, int> directorPlayheads;
  std::unordered_map<std::string, int> directorDirections;
  std::unordered_map<std::string, bool> directorActive;
  std::unordered_map<std::string, bool> directorStopped;
  std::unordered_map<std::string, bool> tags;
  int lastGlobalFrame = -1;
};

bool loadTemplateSnapshot(
    const std::string& templateJson,
    TemplateSnapshot& out,
    const std::unordered_map<std::string, std::string>& variables);

void initTimelinePlaybackState(const TemplateSnapshot& snap, TimelinePlaybackState& state);

/** Paint order keys (rect:/text:/…) from rootStack; computed once at load. */
std::vector<std::string> buildPaintOrderFromSnapshot(const TemplateSnapshot& snap);

/** Update transforms in an existing model (no full model copy, no paint-order rebuild). */
void buildRenderModel(
    const TemplateSnapshot& snap,
    TimelinePlaybackState& playback,
    int globalFrame,
    TemplateModel& out);

} // namespace playoutd
