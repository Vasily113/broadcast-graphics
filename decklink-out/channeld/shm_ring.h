#pragma once

#include <atomic>
#include <cstdint>

namespace channeld {

static constexpr uint32_t kShmMagic = 0x42475631; // BGV1
static constexpr uint16_t kShmVersion = 1;
static constexpr uint16_t kMaxSlots = 8;

constexpr uint32_t kShmFlagFlipY = 1u;
constexpr uint32_t kShmFlagValid = 2u;
constexpr uint32_t kShmFlagPayloadRgba = 4u;
constexpr uint32_t kShmFlagPayloadBgra = 8u;

enum class PixelFormat : uint16_t {
  RGBA8 = 1,
  BGRA8 = 2,
};

// Header is intentionally POD and cache-line aligned to simplify lock-free access.
struct alignas(64) ShmHeader {
  uint32_t magic;
  uint16_t version;
  uint16_t headerSize;
  uint16_t width;
  uint16_t height;
  uint16_t pixelFormat;
  uint16_t slotCount;
  uint32_t frameBytes;
  std::atomic<uint32_t> sessionId;
  std::atomic<uint64_t> writeSeq;
  std::atomic<uint32_t> writeIndex;
  std::atomic<uint64_t> producerTsNs;
  std::atomic<uint32_t> flags; // bit0 flipY, bit1 valid
  std::atomic<uint64_t> droppedByProducer;
  std::atomic<uint64_t> consumedSeq;
  std::atomic<uint64_t> droppedByConsumer;
  uint8_t reserved[64];
};

struct alignas(64) ShmSlotMeta {
  std::atomic<uint64_t> seq;
  std::atomic<uint32_t> ready;
  uint32_t reserved0;
  uint64_t tsNs;
  uint8_t reserved[40];
};

static inline bool isValidHeader(const ShmHeader* h) {
  if (!h) return false;
  if (h->magic != kShmMagic) return false;
  if (h->version != kShmVersion) return false;
  if (h->slotCount == 0 || h->slotCount > kMaxSlots) return false;
  if (h->frameBytes == 0) return false;
  return true;
}

} // namespace channeld
