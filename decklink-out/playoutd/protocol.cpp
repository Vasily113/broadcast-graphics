#include "protocol.h"

namespace playoutd {
namespace {

std::string extractJsonString(const std::string& json, const char* key) {
  const std::string needle = std::string("\"") + key + "\"";
  size_t pos = json.find(needle);
  if (pos == std::string::npos) return {};
  pos = json.find(':', pos);
  if (pos == std::string::npos) return {};
  pos = json.find('"', pos);
  if (pos == std::string::npos) return {};
  const size_t start = pos + 1;
  const size_t end = json.find('"', start);
  if (end == std::string::npos) return {};
  return json.substr(start, end - start);
}

} // namespace

CommandType parseCommandType(const std::string& json) {
  const std::string type = extractJsonString(json, "type");
  if (type == "take") return CommandType::Take;
  if (type == "clear") return CommandType::Clear;
  if (type == "update") return CommandType::Update;
  if (type == "pause") return CommandType::Pause;
  if (type == "continue") return CommandType::Continue;
  if (type == "cue") return CommandType::Cue;
  if (type == "transition") return CommandType::Transition;
  return CommandType::Unknown;
}

ControlCommand parseControlLine(const std::string& line) {
  ControlCommand cmd;
  cmd.rawJson = line;
  cmd.type = parseCommandType(line);
  cmd.templateId = extractJsonString(line, "templateId");
  cmd.channelId = extractJsonString(line, "channelId");
  cmd.cueAction = extractJsonString(line, "cueAction");
  if (cmd.cueAction.empty()) cmd.cueAction = extractJsonString(line, "action");
  cmd.targetSlotId = extractJsonString(line, "targetSlotId");
  if (cmd.targetSlotId.empty()) cmd.targetSlotId = extractJsonString(line, "targetTemplateId");
  cmd.transitionRecipe = extractJsonString(line, "recipe");
  if (cmd.transitionRecipe.empty()) cmd.transitionRecipe = extractJsonString(line, "transition");
  return cmd;
}

const char* commandTypeName(CommandType type) {
  switch (type) {
    case CommandType::Take: return "take";
    case CommandType::Clear: return "clear";
    case CommandType::Update: return "update";
    case CommandType::Pause: return "pause";
    case CommandType::Continue: return "continue";
    case CommandType::Cue: return "cue";
    case CommandType::Transition: return "transition";
    default: return "unknown";
  }
}

} // namespace playoutd
