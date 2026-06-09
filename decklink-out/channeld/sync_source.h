#pragma once

#include <string>

namespace channeld {

enum class SyncSource {
  ExternalReference,
  NvidiaVsyncFallback,
};

inline const char* toString(SyncSource s) {
  switch (s) {
    case SyncSource::ExternalReference:
      return "Blackmagic external reference";
    case SyncSource::NvidiaVsyncFallback:
      return "NVIDIA VSync fallback";
  }
  return "unknown";
}

inline SyncSource chooseSyncSource(bool externalLocked, const std::string& preference) {
  const bool externalFirst = preference != "gpu_first";
  if (externalFirst) {
    return externalLocked ? SyncSource::ExternalReference : SyncSource::NvidiaVsyncFallback;
  }
  return SyncSource::NvidiaVsyncFallback;
}

} // namespace channeld
