#pragma once

#include <cstdint>
#include <string>
#include <unordered_map>
#include <vector>

namespace playoutd {

struct Transform {
  double x = 0;
  double y = 0;
  double width = 100;
  double height = 100;
  double rotation = 0;
  double scaleX = 1;
  double scaleY = 1;
};

struct TextStyle {
  std::string fontFamily = "DejaVu Sans";
  double fontSize = 48;
  std::string fontWeight = "normal";
  std::string fill = "#ffffff";
  std::string align = "left";
  double lineHeight = 1.2;   // multiplier (PIXI)
  double letterSpacing = 0;  // px
};

enum class BlendMode { Normal, Add, Multiply, Screen };

BlendMode blendModeFromString(const std::string& s);

struct RectLayer {
  std::string id;
  Transform transform;
  double opacity = 1;
  bool visible = true;
  BlendMode blendMode = BlendMode::Normal;
  std::string fill = "#3a3a3a";
  double cornerRadius = 0;
  std::string borderColor = "#000000";
  double borderWidth = 0;
};

struct TextLayer {
  std::string id;
  Transform transform;
  double opacity = 1;
  bool visible = true;
  BlendMode blendMode = BlendMode::Normal;
  std::string content;
  TextStyle style;
};

struct ImageLayer {
  std::string id;
  Transform transform;
  double opacity = 1;
  bool visible = true;
  BlendMode blendMode = BlendMode::Normal;
  std::string src;
  std::string fit = "stretch";
};

struct ClockLayer {
  std::string id;
  Transform transform;
  double opacity = 1;
  bool visible = true;
  BlendMode blendMode = BlendMode::Normal;
  std::string mode = "clock";
  std::string format = "HH:mm:ss";
  TextStyle style;
};

struct TemplateModel {
  int canvasWidth = 1920;
  int canvasHeight = 1080;
  std::string background = "transparent";
  std::vector<RectLayer> rects;
  std::vector<TextLayer> texts;
  std::vector<ImageLayer> images;
  std::vector<ClockLayer> clocks;
  // Paint order: layer ids back → front
  std::vector<std::string> paintOrder;
};

bool parseTemplateFromTakeJson(
    const std::string& takeJson,
    TemplateModel& out,
    std::unordered_map<std::string, std::string>& variables,
    bool parseVariablesFromJson = true);

bool parseTemplateObjectJson(
    const std::string& templateJson,
    TemplateModel& out,
    const std::unordered_map<std::string, std::string>& variables,
    bool reorderFromRootStack = true);

int parseTimelineFps(const std::string& templateJson);

void applyVariablesToModel(
    TemplateModel& model,
    const std::unordered_map<std::string, std::string>& variables);

} // namespace playoutd
