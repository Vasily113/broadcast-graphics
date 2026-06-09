#include "shm_frame.h"

#include <algorithm>
#include <cctype>
#include <chrono>
#include <cstring>
#include <fcntl.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <unistd.h>

#ifdef _OPENMP
#include <omp.h>
#endif

namespace channeld {
namespace {

constexpr size_t kAlign = 64;

size_t alignUp(size_t value, size_t alignment) {
  return (value + alignment - 1) & ~(alignment - 1);
}

size_t layoutSize(int width, int height, int slotCount) {
  const size_t frameBytes = static_cast<size_t>(width) * static_cast<size_t>(height) * 4u;
  const size_t slotsOffset = alignUp(sizeof(ShmHeader), kAlign);
  const size_t framesOffset = alignUp(slotsOffset + sizeof(ShmSlotMeta) * static_cast<size_t>(slotCount), kAlign);
  return framesOffset + frameBytes * static_cast<size_t>(slotCount);
}

bool mapFile(const std::string& shmName, bool create, int width, int height, int slotCount, ShmMapping& out) {
  const std::string path = "/" + shmName;
  const size_t totalSize = layoutSize(width, height, slotCount);
  int flags = create ? (O_CREAT | O_RDWR) : O_RDWR;
  int fd = shm_open(path.c_str(), flags, 0666);
  if (fd < 0) return false;

  if (create) {
    if (ftruncate(fd, static_cast<off_t>(totalSize)) != 0) {
      close(fd);
      return false;
    }
  } else {
    struct stat st {};
    if (fstat(fd, &st) != 0 || static_cast<size_t>(st.st_size) < totalSize) {
      close(fd);
      return false;
    }
  }

  void* base = mmap(nullptr, totalSize, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
  close(fd);
  if (base == MAP_FAILED) return false;

  out.base = base;
  out.size = totalSize;
  out.width = width;
  out.height = height;
  out.slotCount = slotCount;
  out.frameBytes = static_cast<uint32_t>(width) * static_cast<uint32_t>(height) * 4u;

  out.header = reinterpret_cast<ShmHeader*>(base);
  const size_t slotsOffset = alignUp(sizeof(ShmHeader), kAlign);
  out.slots = reinterpret_cast<ShmSlotMeta*>(static_cast<uint8_t*>(base) + slotsOffset);
  const size_t framesOffset = alignUp(slotsOffset + sizeof(ShmSlotMeta) * static_cast<size_t>(slotCount), kAlign);
  out.frames = static_cast<uint8_t*>(base) + framesOffset;

  if (create) {
    std::memset(base, 0, totalSize);
    out.header->magic = kShmMagic;
    out.header->version = kShmVersion;
    out.header->headerSize = static_cast<uint16_t>(sizeof(ShmHeader));
    out.header->width = static_cast<uint16_t>(width);
    out.header->height = static_cast<uint16_t>(height);
    out.header->pixelFormat = static_cast<uint16_t>(PixelFormat::RGBA8);
    out.header->slotCount = static_cast<uint16_t>(slotCount);
    out.header->frameBytes = out.frameBytes;
    out.header->sessionId.store(1, std::memory_order_release);
    out.header->flags.store(1u, std::memory_order_release); // valid
  }

  return isValidHeader(out.header);
}

uint64_t nowNs() {
  using clock = std::chrono::steady_clock;
  return static_cast<uint64_t>(
      std::chrono::duration_cast<std::chrono::nanoseconds>(clock::now().time_since_epoch()).count());
}

} // namespace

void rgbaToBgra(const uint8_t* src, uint8_t* dst, int w, int h, bool flipY) {
  const size_t rowBytes = static_cast<size_t>(w) * 4u;
#ifdef _OPENMP
#pragma omp parallel for schedule(static)
#endif
  for (int y = 0; y < h; ++y) {
    const int sy = flipY ? (h - 1 - y) : y;
    const uint8_t* s = src + static_cast<size_t>(sy) * rowBytes;
    uint8_t* d = dst + static_cast<size_t>(y) * rowBytes;
    for (int x = 0; x < w; ++x) {
      const uint8_t* p = s + static_cast<size_t>(x) * 4u;
      uint8_t* q = d + static_cast<size_t>(x) * 4u;
      q[0] = p[2];
      q[1] = p[1];
      q[2] = p[0];
      q[3] = p[3];
    }
  }
}

std::string shmNameFromChannelId(const std::string& channelId) {
  std::string name = "bgv13_";
  for (char c : channelId) {
    if (std::isalnum(static_cast<unsigned char>(c))) name.push_back(c);
    else if (c == '-' || c == '_') name.push_back('_');
  }
  if (name.size() <= 6) name += "default";
  return name;
}

bool shmCreate(const std::string& shmName, int width, int height, int slotCount, ShmMapping& out) {
  if (slotCount < 2) slotCount = 2;
  if (slotCount > kMaxSlots) slotCount = kMaxSlots;
  return mapFile(shmName, true, width, height, slotCount, out);
}

bool shmAttach(const std::string& shmName, int width, int height, int slotCount, ShmMapping& out) {
  if (slotCount < 2) slotCount = 2;
  return mapFile(shmName, false, width, height, slotCount, out);
}

void shmDetach(ShmMapping& mapping) {
  if (mapping.base && mapping.size) {
    munmap(mapping.base, mapping.size);
  }
  mapping = {};
}

bool shmPublishRgba(ShmMapping& mapping, const uint8_t* rgba, size_t byteLength, bool flipY) {
  if (!mapping.header || !mapping.frames || !rgba) return false;
  if (byteLength != mapping.frameBytes) return false;

  const uint64_t nextSeq = mapping.header->writeSeq.load(std::memory_order_acquire) + 1;
  const int slot = static_cast<int>((nextSeq - 1) % static_cast<uint64_t>(mapping.slotCount));

  uint8_t* dstFrame = mapping.frames + static_cast<size_t>(slot) * mapping.frameBytes;
  rgbaToBgra(rgba, dstFrame, mapping.width, mapping.height, flipY);

  mapping.slots[slot].seq.store(nextSeq, std::memory_order_release);
  mapping.slots[slot].tsNs = nowNs();
  mapping.slots[slot].ready.store(1, std::memory_order_release);

  mapping.header->writeIndex.store(static_cast<uint32_t>(slot), std::memory_order_release);
  mapping.header->producerTsNs.store(nowNs(), std::memory_order_release);
  mapping.header->flags.store(
      (flipY ? kShmFlagFlipY : 0u) | kShmFlagValid | kShmFlagPayloadBgra, std::memory_order_release);
  mapping.header->writeSeq.store(nextSeq, std::memory_order_release);
  return true;
}

bool shmPublishBgra(ShmMapping& mapping, const uint8_t* bgra, size_t byteLength, bool flipY) {
  if (!mapping.header || !mapping.frames || !bgra) return false;
  if (byteLength != mapping.frameBytes) return false;

  const uint64_t nextSeq = mapping.header->writeSeq.load(std::memory_order_acquire) + 1;
  const int slot = static_cast<int>((nextSeq - 1) % static_cast<uint64_t>(mapping.slotCount));

  uint8_t* dstFrame = mapping.frames + static_cast<size_t>(slot) * mapping.frameBytes;
  std::memcpy(dstFrame, bgra, mapping.frameBytes);

  mapping.slots[slot].seq.store(nextSeq, std::memory_order_release);
  mapping.slots[slot].tsNs = nowNs();
  mapping.slots[slot].ready.store(1, std::memory_order_release);

  mapping.header->writeIndex.store(static_cast<uint32_t>(slot), std::memory_order_release);
  mapping.header->producerTsNs.store(nowNs(), std::memory_order_release);
  mapping.header->flags.store(
      (flipY ? kShmFlagFlipY : 0u) | kShmFlagValid | kShmFlagPayloadBgra, std::memory_order_release);
  mapping.header->writeSeq.store(nextSeq, std::memory_order_release);
  return true;
}

bool shmPublishRgbaRaw(ShmMapping& mapping, const uint8_t* rgba, size_t byteLength, bool flipY) {
  if (!mapping.header || !mapping.frames || !rgba) return false;
  if (byteLength != mapping.frameBytes) return false;

  const uint64_t nextSeq = mapping.header->writeSeq.load(std::memory_order_acquire) + 1;
  const int slot = static_cast<int>((nextSeq - 1) % static_cast<uint64_t>(mapping.slotCount));

  uint8_t* dstFrame = mapping.frames + static_cast<size_t>(slot) * mapping.frameBytes;
  std::memcpy(dstFrame, rgba, mapping.frameBytes);

  mapping.slots[slot].seq.store(nextSeq, std::memory_order_release);
  mapping.slots[slot].tsNs = nowNs();
  mapping.slots[slot].ready.store(1, std::memory_order_release);

  mapping.header->writeIndex.store(static_cast<uint32_t>(slot), std::memory_order_release);
  mapping.header->producerTsNs.store(nowNs(), std::memory_order_release);
  mapping.header->flags.store(
      (flipY ? kShmFlagFlipY : 0u) | kShmFlagValid | kShmFlagPayloadRgba, std::memory_order_release);
  mapping.header->writeSeq.store(nextSeq, std::memory_order_release);
  return true;
}

bool shmConsumeLatest(ShmMapping& mapping, uint8_t* dst, size_t dstBytes, bool* flipY, bool* isRgbaRaw, uint64_t* consumedSeq) {
  if (!mapping.header || !mapping.frames || !dst) return false;
  if (dstBytes != mapping.frameBytes) return false;

  const uint64_t writeSeq = mapping.header->writeSeq.load(std::memory_order_acquire);
  if (writeSeq == 0) return false;

  const uint64_t lastConsumed = mapping.header->consumedSeq.load(std::memory_order_acquire);
  if (writeSeq <= lastConsumed) return false;

  if (writeSeq > lastConsumed + 1) {
    mapping.header->droppedByConsumer.fetch_add(writeSeq - lastConsumed - 1, std::memory_order_relaxed);
  }

  const uint32_t slot = mapping.header->writeIndex.load(std::memory_order_acquire);
  if (slot >= static_cast<uint32_t>(mapping.slotCount)) return false;

  if (mapping.slots[slot].ready.load(std::memory_order_acquire) == 0) return false;
  if (mapping.slots[slot].seq.load(std::memory_order_acquire) != writeSeq) return false;

  const uint8_t* srcFrame = mapping.frames + static_cast<size_t>(slot) * mapping.frameBytes;
  std::memcpy(dst, srcFrame, mapping.frameBytes);

  const uint32_t flags = mapping.header->flags.load(std::memory_order_acquire);
  if (flipY) *flipY = (flags & kShmFlagFlipY) != 0;
  if (isRgbaRaw) *isRgbaRaw = (flags & kShmFlagPayloadRgba) != 0 && (flags & kShmFlagPayloadBgra) == 0;

  mapping.header->consumedSeq.store(writeSeq, std::memory_order_release);
  if (consumedSeq) *consumedSeq = writeSeq;
  return true;
}

} // namespace channeld
