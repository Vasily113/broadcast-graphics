#pragma once

#include <optional>
#include <string>
#include <unordered_map>

namespace playoutd {

class TimelineBridge {
 public:
  TimelineBridge();
  ~TimelineBridge();

  TimelineBridge(const TimelineBridge&) = delete;
  TimelineBridge& operator=(const TimelineBridge&) = delete;

  bool available() const { return available_; }

  bool loadTemplate(const std::string& templateId, const std::string& templateJson);
  void unloadTemplate(const std::string& templateId);

  bool prepare(
      const std::string& templateId,
      int frame,
      const std::unordered_map<std::string, std::string>& variables,
      std::string& preparedTemplateJson);

 private:
  bool requestLine(const std::string& req, std::string& responseLine, int timeoutMs);
  bool available_ = false;
  int childStdin_ = -1;
  int childStdout_ = -1;
  int childPid_ = -1;
};

/** True when timeline has animated keyframes/actions (needs Node prepare every frame). */
bool templateNeedsPerFrameTimeline(const std::string& templateJson);

/** True when groups/rootStack require stack flatten (one-time Node prepare on TAKE is enough). */
bool templateNeedsStackFlattenPrepare(const std::string& templateJson);

} // namespace playoutd
