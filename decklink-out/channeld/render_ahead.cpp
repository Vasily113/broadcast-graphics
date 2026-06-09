#include "render_ahead.h"

#include "../playoutd/scene.h"

#include <algorithm>
#include <cstring>
#include <limits>
#include <thread>

namespace channeld {

RenderAhead::RenderAhead(
    playoutd::Scene& scene,
    int width,
    int height,
    int targetFrameFps,
    HwFrameCountFn hwFrameCount)
    : scene_(scene),
      width_(width),
      height_(height),
      targetFrameFps_(std::max(1, targetFrameFps)),
      hwFrameCount_(std::move(hwFrameCount)) {
  frameBytes_ = static_cast<size_t>(width_) * static_cast<size_t>(height_) * 4u;
  scratch_.resize(frameBytes_);
  published_.resize(frameBytes_);
  std::memset(published_.data(), 0, frameBytes_);
}

RenderAhead::~RenderAhead() {
  stop();
}

void RenderAhead::start() {
  if (running_.exchange(true, std::memory_order_acq_rel)) return;
  thread_ = std::thread([this] { renderLoop(); });
}

void RenderAhead::stop() {
  if (!running_.exchange(false, std::memory_order_acq_rel)) return;
  if (thread_.joinable()) thread_.join();
}

void RenderAhead::renderLoop() {
  if (hwFrameCount_) {
    uint64_t lastPrepared = std::numeric_limits<uint64_t>::max();
    while (running_.load(std::memory_order_acquire)) {
      const uint64_t nextIndex = hwFrameCount_();
      if (nextIndex != lastPrepared) {
        scene_.renderRgba(scratch_.data(), width_, height_, nextIndex);
        {
          std::lock_guard<std::mutex> lk(publishMtx_);
          std::memcpy(published_.data(), scratch_.data(), frameBytes_);
        }
        framesRendered_.fetch_add(1, std::memory_order_relaxed);
        lastPrepared = nextIndex;
        continue;
      }
      std::this_thread::sleep_for(std::chrono::microseconds(200));
    }
    return;
  }

  const auto framePeriod =
      std::chrono::nanoseconds(1'000'000'000 / static_cast<int64_t>(targetFrameFps_));
  auto nextTick = std::chrono::steady_clock::now();

  while (running_.load(std::memory_order_acquire)) {
    nextTick += framePeriod;
    scene_.renderRgba(scratch_.data(), width_, height_);
    {
      std::lock_guard<std::mutex> lk(publishMtx_);
      std::memcpy(published_.data(), scratch_.data(), frameBytes_);
    }
    framesRendered_.fetch_add(1, std::memory_order_relaxed);

    const auto now = std::chrono::steady_clock::now();
    if (nextTick > now) {
      std::this_thread::sleep_until(nextTick);
    } else {
      nextTick = now;
    }
  }
}

void RenderAhead::copyReadyFrame(uint8_t* bgra, size_t byteLength) const {
  if (!bgra || byteLength != frameBytes_) return;
  std::lock_guard<std::mutex> lk(publishMtx_);
  std::memcpy(bgra, published_.data(), frameBytes_);
}

} // namespace channeld
