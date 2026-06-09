#pragma once

#include <cstdint>
#include <functional>
#include <string>
#include <vector>

namespace channeld {

/** Fill DeckLink pool frame (BGRA). Called from ScheduledFrameCompleted on the DeckLink thread. */
using FrameProducerFn = std::function<void(uint8_t* bgra, int width, int height)>;

class DecklinkOutput {
public:
  bool open(int deviceIndex, const std::string& displayModeId, const std::string& keyerMode);
  void close();

  /** When set, each hardware frame is filled by this callback (no staging memcpy). */
  void setFrameProducer(FrameProducerFn producer);

  // Legacy SHM path: copy into staging; callback memcpys staging → pool frame.
  bool pushFrameBgra(const uint8_t* bgra, size_t byteLength);

  int width() const { return width_; }
  int height() const { return height_; }
  int targetFps() const { return targetFps_; }

  uint64_t framesPushed() const;
  uint64_t hwFramesCompleted() const;
  uint64_t hwFramesLate() const;
  uint64_t hwFramesDropped() const;

  /** Number of pool frames that started fill (next timeline index = this value). */
  uint64_t hwOnAirFrameCount() const;
  /** Index of the frame currently being filled in ScheduledFrameCompleted. */
  uint64_t hwCurrentFillIndex() const;

private:
  int width_ = 1920;
  int height_ = 1080;
  int targetFps_ = 50;
  void* outputState_ = nullptr;
};

} // namespace channeld
