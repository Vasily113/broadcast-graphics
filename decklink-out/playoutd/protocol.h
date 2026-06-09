#pragma once

#include <string>

namespace playoutd {

// Matches backend /ws/control JSON commands (see README).
enum class CommandType {
  Unknown,
  Take,
  Clear,
  Update,
  Pause,
  Continue,
  Cue,
  Transition,
};

struct ControlCommand {
  CommandType type = CommandType::Unknown;
  std::string templateId;
  std::string channelId;
  std::string rawJson;
  // Cue / transition (protocol v2 skeleton)
  std::string cueAction;
  std::string targetSlotId;
  std::string transitionRecipe;
};

CommandType parseCommandType(const std::string& json);
ControlCommand parseControlLine(const std::string& line);
const char* commandTypeName(CommandType type);

} // namespace playoutd
