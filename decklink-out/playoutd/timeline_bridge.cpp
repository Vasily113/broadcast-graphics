#include "timeline_bridge.h"
#include "json_util.h"

#include <chrono>
#include <cctype>
#include <cstdlib>
#include <iostream>
#include <mutex>
#include <sstream>
#include <thread>
#include <unistd.h>
#include <vector>

#include <sys/types.h>
#include <sys/wait.h>

namespace playoutd {
namespace {

std::mutex g_bridgeIoMutex;

std::string escapeJsonString(const std::string& s) {
  std::string out;
  out.reserve(s.size() + 8);
  for (char c : s) {
    switch (c) {
      case '"': out += "\\\""; break;
      case '\\': out += "\\\\"; break;
      case '\n': out += "\\n"; break;
      case '\r': out += "\\r"; break;
      case '\t': out += "\\t"; break;
      default: out.push_back(c);
    }
  }
  return out;
}

std::string variablesToJson(const std::unordered_map<std::string, std::string>& variables) {
  std::ostringstream oss;
  oss << '{';
  bool first = true;
  for (const auto& kv : variables) {
    if (!first) oss << ',';
    first = false;
    oss << '"' << escapeJsonString(kv.first) << "\":\"" << escapeJsonString(kv.second) << '"';
  }
  oss << '}';
  return oss.str();
}

bool writeAll(int fd, const std::string& data) {
  size_t off = 0;
  while (off < data.size()) {
    const ssize_t n = ::write(fd, data.data() + off, data.size() - off);
    if (n <= 0) return false;
    off += static_cast<size_t>(n);
  }
  return true;
}

bool readLine(int fd, std::string& line, int timeoutMs) {
  line.clear();
  const auto deadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(timeoutMs);
  char ch = 0;
  while (std::chrono::steady_clock::now() < deadline) {
    const ssize_t n = ::read(fd, &ch, 1);
    if (n == 1) {
      if (ch == '\n') return true;
      line.push_back(ch);
      continue;
    }
    if (n == 0) return false;
    std::this_thread::sleep_for(std::chrono::milliseconds(1));
  }
  return false;
}

} // namespace

bool objectHasNonEmptyMap(const std::string& objJson) {
  for (char c : objJson) {
    if (c != '{' && c != '}' && !std::isspace(static_cast<unsigned char>(c))) return true;
  }
  return false;
}

bool keyframeHasAnimatedContent(const std::string& kfObj) {
  if (auto layers = json::extractObject(kfObj, "layers")) {
    if (objectHasNonEmptyMap(*layers)) return true;
  }
  if (auto groups = json::extractObject(kfObj, "groups")) {
    if (objectHasNonEmptyMap(*groups)) return true;
  }
  return false;
}

bool hasAnyTimelineKeysInTimelineJson(const std::string& timelineJson) {
  if (auto actions = json::extractArray(timelineJson, "actions")) {
    if (!json::splitTopLevelObjects(*actions).empty()) return true;
  }
  if (auto keyframes = json::extractArray(timelineJson, "keyframes")) {
    for (const std::string& kf : json::splitTopLevelObjects(*keyframes)) {
      if (keyframeHasAnimatedContent(kf)) return true;
    }
  }
  return false;
}

bool templateNeedsPerFrameTimeline(const std::string& templateJson) {
  const auto timeline = json::extractObject(templateJson, "timeline");
  if (!timeline) return false;
  return hasAnyTimelineKeysInTimelineJson(*timeline);
}

bool templateNeedsStackFlattenPrepare(const std::string& templateJson) {
  if (templateJson.find("\"rootStack\"") != std::string::npos) return true;
  if (auto groups = json::extractArray(templateJson, "groups")) {
    if (!json::splitTopLevelObjects(*groups).empty()) return true;
  }
  return false;
}

TimelineBridge::TimelineBridge() {
  const char* nodeBin = std::getenv("PLAYOUT_NODE");
  if (!nodeBin || !*nodeBin) nodeBin = "node";

  const char* scriptEnv = std::getenv("PLAYOUT_TIMELINE_BRIDGE");
  std::string script = scriptEnv && *scriptEnv
      ? std::string(scriptEnv)
      : std::string();

  if (script.empty()) {
    const char* self = "/proc/self/exe";
    char exePath[4096] = {};
    const ssize_t len = ::readlink(self, exePath, sizeof(exePath) - 1);
    if (len > 0) {
      std::string dir(exePath, static_cast<size_t>(len));
      const size_t slash = dir.rfind('/');
      if (slash != std::string::npos) {
        script = dir.substr(0, slash + 1) + "timeline_bridge.js";
      }
    }
  }

  int pipeIn[2] = {};
  int pipeOut[2] = {};
  if (::pipe(pipeIn) != 0 || ::pipe(pipeOut) != 0) return;

  childPid_ = ::fork();
  if (childPid_ < 0) return;

  if (childPid_ == 0) {
    ::dup2(pipeIn[0], STDIN_FILENO);
    ::dup2(pipeOut[1], STDOUT_FILENO);
    ::close(pipeIn[0]);
    ::close(pipeIn[1]);
    ::close(pipeOut[0]);
    ::close(pipeOut[1]);
    execlp(nodeBin, nodeBin, script.c_str(), static_cast<char*>(nullptr));
    _exit(127);
  }

  ::close(pipeIn[0]);
  ::close(pipeOut[1]);
  childStdin_ = pipeIn[1];
  childStdout_ = pipeOut[0];

  std::string pingLine;
  const std::string pingReq = "{\"op\":\"ping\"}\n";
  if (!writeAll(childStdin_, pingReq) || !readLine(childStdout_, pingLine, 3000)) {
    std::cerr << "[playoutd] timeline bridge failed to start\n";
    return;
  }
  available_ = pingLine.find("\"ok\":true") != std::string::npos;
  if (available_) {
    std::cout << "[playoutd] timeline bridge ready (" << script << ")\n";
  }
}

TimelineBridge::~TimelineBridge() {
  if (childStdin_ >= 0) ::close(childStdin_);
  if (childStdout_ >= 0) ::close(childStdout_);
  if (childPid_ > 0) {
    ::kill(childPid_, SIGTERM);
    int status = 0;
    ::waitpid(childPid_, &status, 0);
  }
}

bool TimelineBridge::requestLine(const std::string& req, std::string& responseLine, int timeoutMs) {
  if (!available_ || childStdin_ < 0 || childStdout_ < 0) return false;
  std::lock_guard<std::mutex> lock(g_bridgeIoMutex);
  if (!writeAll(childStdin_, req)) return false;
  if (!readLine(childStdout_, responseLine, timeoutMs)) return false;
  return responseLine.find("\"ok\":true") != std::string::npos;
}

bool TimelineBridge::loadTemplate(const std::string& templateId, const std::string& templateJson) {
  std::ostringstream req;
  req << "{\"op\":\"load\",\"id\":\"" << escapeJsonString(templateId) << "\",\"template\":" << templateJson
      << "}\n";
  std::string line;
  if (!requestLine(req.str(), line, 10000)) {
    std::cerr << "[playoutd] timeline load failed: " << line.substr(0, 200) << "\n";
    return false;
  }
  return true;
}

void TimelineBridge::unloadTemplate(const std::string& templateId) {
  std::ostringstream req;
  req << "{\"op\":\"unload\",\"id\":\"" << escapeJsonString(templateId) << "\"}\n";
  std::string line;
  requestLine(req.str(), line, 2000);
}

bool TimelineBridge::prepare(
    const std::string& templateId,
    int frame,
    const std::unordered_map<std::string, std::string>& variables,
    std::string& preparedTemplateJson) {
  std::ostringstream req;
  req << "{\"op\":\"prepare\",\"id\":\"" << escapeJsonString(templateId) << "\",\"frame\":" << frame
      << ",\"variables\":" << variablesToJson(variables) << "}\n";

  std::string line;
  if (!requestLine(req.str(), line, 5000)) {
    std::cerr << "[playoutd] timeline prepare error: " << line.substr(0, 200) << "\n";
    return false;
  }

  const auto prepared = json::extractObject(line, "template");
  if (!prepared) return false;
  preparedTemplateJson = *prepared;
  return true;
}

} // namespace playoutd
