#pragma once

#include "shm_ring.h"

#include <cstddef>
#include <cstdint>
#include <string>

namespace channeld {

struct ShmMapping {
  void* base = nullptr;
  size_t size = 0;
  ShmHeader* header = nullptr;
  ShmSlotMeta* slots = nullptr;
  uint8_t* frames = nullptr;
  int width = 0;
  int height = 0;
  int slotCount = 0;
  uint32_t frameBytes = 0;
};

std::string shmNameFromChannelId(const std::string& channelId);

bool shmCreate(const std::string& shmName, int width, int height, int slotCount, ShmMapping& out);
bool shmAttach(const std::string& shmName, int width, int height, int slotCount, ShmMapping& out);
void shmDetach(ShmMapping& mapping);

// Producer: convert RGBA → BGRA into ring (legacy).
bool shmPublishRgba(ShmMapping& mapping, const uint8_t* rgba, size_t byteLength, bool flipY);
// Producer: BGRA frame already in DeckLink order (preferred for playoutd).
bool shmPublishBgra(ShmMapping& mapping, const uint8_t* bgra, size_t byteLength, bool flipY);
// Producer: raw RGBA in ring (Electron); consumer converts.
bool shmPublishRgbaRaw(ShmMapping& mapping, const uint8_t* rgba, size_t byteLength, bool flipY);

// Consumer: copy newest frame to dst (w*h*4). When isRgbaRaw=false, payload is already BGRA.
bool shmConsumeLatest(ShmMapping& mapping, uint8_t* dst, size_t dstBytes, bool* flipY, bool* isRgbaRaw, uint64_t* consumedSeq);

/** RGBA8 → BGRA8 (DeckLink). Used on publish in playoutd; channeld skips this when SHM is BGRA. */
void rgbaToBgra(const uint8_t* src, uint8_t* dst, int w, int h, bool flipY);

} // namespace channeld
