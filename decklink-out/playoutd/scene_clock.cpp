#include "scene_clock.h"

#include <algorithm>

namespace playoutd {

void SceneClock::setOutputFrameRate(int fps) {
  outputFrameFps_ = std::max(1, fps);
}

void SceneClock::setHwOnAirFrameQuery(std::function<uint64_t()> query) {
  hwQuery_ = std::move(query);
}

uint64_t SceneClock::rawHwFrame() const {
  if (hwQuery_) return hwQuery_();
  return softwareCounter_;
}

uint64_t SceneClock::timelineHwIndex(uint64_t rawHw) const {
  if (!paused_) return rawHw >= pauseSkew_ ? rawHw - pauseSkew_ : 0;
  return frozenHw_ >= pauseSkew_ ? frozenHw_ - pauseSkew_ : 0;
}

uint64_t SceneClock::currentTimelineHwIndex() const {
  return timelineHwIndex(rawHwFrame());
}

int SceneClock::globalFrameForTake(uint64_t takeDisplayFrame, int timelineFps, uint64_t rawHw) const {
  const uint64_t timelineHw = timelineHwIndex(rawHw);
  if (timelineHw <= takeDisplayFrame) return 0;
  const uint64_t elapsed = timelineHw - takeDisplayFrame;
  const int fps = outputFrameFps_ > 0 ? outputFrameFps_ : 50;
  const int tFps = timelineFps > 0 ? timelineFps : 50;
  return static_cast<int>(elapsed * static_cast<uint64_t>(tFps) / static_cast<uint64_t>(fps));
}

void SceneClock::pause(uint64_t rawHw) {
  frozenHw_ = rawHw;
  paused_ = true;
}

void SceneClock::resume(uint64_t rawHw) {
  if (!paused_) return;
  if (rawHw > frozenHw_) pauseSkew_ += rawHw - frozenHw_;
  paused_ = false;
}

uint64_t SceneClock::softwareFrameTick() {
  return softwareCounter_++;
}

} // namespace playoutd
