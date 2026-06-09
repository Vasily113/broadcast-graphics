#pragma once

#include <atomic>
#include <chrono>
#include <cstdint>
#include <functional>
#include <mutex>
#include <thread>
#include <vector>

namespace playoutd {
class Scene;
}

namespace channeld {

/** Background render; DeckLink callback copies a stable published snapshot (no tear). */
class RenderAhead {
public:
  using HwFrameCountFn = std::function<uint64_t()>;

  RenderAhead(
      playoutd::Scene& scene,
      int width,
      int height,
      int targetFrameFps,
      HwFrameCountFn hwFrameCount = nullptr);
  ~RenderAhead();

  RenderAhead(const RenderAhead&) = delete;
  RenderAhead& operator=(const RenderAhead&) = delete;

  void start();
  void stop();

  void copyReadyFrame(uint8_t* bgra, size_t byteLength) const;

  uint64_t framesRendered() const {
    return framesRendered_.load(std::memory_order_relaxed);
  }

  bool hwTimelineSync() const { return static_cast<bool>(hwFrameCount_); }

private:
  void renderLoop();

  playoutd::Scene& scene_;
  int width_;
  int height_;
  int targetFrameFps_;
  HwFrameCountFn hwFrameCount_;
  size_t frameBytes_;
  std::vector<uint8_t> scratch_;
  std::vector<uint8_t> published_;
  mutable std::mutex publishMtx_;
  std::atomic<bool> running_{false};
  std::atomic<uint64_t> framesRendered_{0};
  std::thread thread_;
};

} // namespace channeld
