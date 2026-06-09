#pragma once

#include <cstdint>
#include <functional>

namespace playoutd {

/** Maps hardware SDI frame index → timeline frame index (B4+), with pause skew. */
class SceneClock {
 public:
  void setOutputFrameRate(int fps);
  void setHwOnAirFrameQuery(std::function<uint64_t()> query);

  uint64_t rawHwFrame() const;
  uint64_t timelineHwIndex(uint64_t rawHw) const;
  uint64_t currentTimelineHwIndex() const;

  int globalFrameForTake(uint64_t takeDisplayFrame, int timelineFps, uint64_t rawHw) const;

  bool hasHwQuery() const { return static_cast<bool>(hwQuery_); }
  bool paused() const { return paused_; }
  void pause(uint64_t rawHw);
  void resume(uint64_t rawHw);

  uint64_t softwareFrameTick();

 private:
  int outputFrameFps_ = 50;
  std::function<uint64_t()> hwQuery_;
  uint64_t softwareCounter_ = 0;
  bool paused_ = false;
  uint64_t frozenHw_ = 0;
  uint64_t pauseSkew_ = 0;
};

} // namespace playoutd
