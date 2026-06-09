#include "template_model.h"
#include "json_util.h"

namespace playoutd {
namespace {

using namespace json;

std::string resolveValue(
    const std::string& obj,
    const char* key,
    const std::unordered_map<std::string, std::string>& variables,
    const std::string& fallback = "") {
  const auto pos = matchValueStart(obj, 0, key);
  if (!pos || *pos >= obj.size()) return fallback;
  if (obj[*pos] == '"') {
    return stringField(obj, key).value_or(fallback);
  }
  if (obj[*pos] == '{') {
    const auto binding = sliceBalanced(obj, *pos, '{', '}');
    if (!binding) return fallback;
    const auto varId = stringField(*binding, "variableId");
    if (varId) {
      const auto it = variables.find(*varId);
      if (it != variables.end()) return it->second;
    }
  }
  return fallback;
}

Transform parseTransform(const std::string& obj) {
  Transform t;
  if (auto o = extractObject(obj, "transform")) {
    t.x = numberField(*o, "x").value_or(0);
    t.y = numberField(*o, "y").value_or(0);
    t.width = numberField(*o, "width").value_or(100);
    t.height = numberField(*o, "height").value_or(80);
    t.rotation = numberField(*o, "rotation").value_or(0);
    t.scaleX = numberField(*o, "scaleX").value_or(1);
    t.scaleY = numberField(*o, "scaleY").value_or(1);
  }
  return t;
}

void parseLayerObject(
    const std::string& layerObj,
    TemplateModel& model,
    const std::unordered_map<std::string, std::string>& variables) {
  const auto type = stringField(layerObj, "type");
  if (!type) return;
  const auto id = stringField(layerObj, "id").value_or("");
  const auto visible = boolField(layerObj, "visible").value_or(true);
  const double opacity = numberField(layerObj, "opacity").value_or(1.0);
  const Transform transform = parseTransform(layerObj);
  const BlendMode blendMode = blendModeFromString(stringField(layerObj, "blendMode").value_or("normal"));

  if (*type == "rect") {
    RectLayer l;
    l.id = id;
    l.visible = visible;
    l.opacity = opacity;
    l.blendMode = blendMode;
    l.transform = transform;
    l.fill = resolveValue(layerObj, "fill", variables, "#3a3a3a");
    l.cornerRadius = numberField(layerObj, "cornerRadius").value_or(0);
    l.borderColor = stringField(layerObj, "borderColor").value_or("#000000");
    l.borderWidth = numberField(layerObj, "borderWidth").value_or(0);
    model.rects.push_back(std::move(l));
    model.paintOrder.push_back("rect:" + id);
  } else if (*type == "text") {
    TextLayer l;
    l.id = id;
    l.visible = visible;
    l.opacity = opacity;
    l.blendMode = blendMode;
    l.transform = transform;
    l.content = resolveValue(layerObj, "content", variables, "Text");
    if (auto styleObj = extractObject(layerObj, "style")) {
      l.style.fontFamily = stringField(*styleObj, "fontFamily").value_or("DejaVu Sans");
      l.style.fontSize = numberField(*styleObj, "fontSize").value_or(48);
      l.style.fontWeight = stringField(*styleObj, "fontWeight").value_or("normal");
      l.style.fill = resolveValue(*styleObj, "fill", variables, "#ffffff");
      l.style.align = stringField(*styleObj, "align").value_or("left");
      l.style.lineHeight = numberField(*styleObj, "lineHeight").value_or(1.2);
      l.style.letterSpacing = numberField(*styleObj, "letterSpacing").value_or(0);
    }
    model.texts.push_back(std::move(l));
    model.paintOrder.push_back("text:" + id);
  } else if (*type == "image") {
    ImageLayer l;
    l.id = id;
    l.visible = visible;
    l.opacity = opacity;
    l.blendMode = blendMode;
    l.transform = transform;
    l.src = resolveValue(layerObj, "src", variables, "");
    l.fit = stringField(layerObj, "fit").value_or("stretch");
    if (!l.src.empty()) {
      model.images.push_back(std::move(l));
      model.paintOrder.push_back("image:" + id);
    }
  } else if (*type == "clock") {
    ClockLayer l;
    l.id = id;
    l.visible = visible;
    l.opacity = opacity;
    l.blendMode = blendMode;
    l.transform = transform;
    l.mode = stringField(layerObj, "mode").value_or("clock");
    l.format = stringField(layerObj, "format").value_or("HH:mm:ss");
    if (auto styleObj = extractObject(layerObj, "style")) {
      l.style.fontFamily = stringField(*styleObj, "fontFamily").value_or("DejaVu Sans");
      l.style.fontSize = numberField(*styleObj, "fontSize").value_or(48);
      l.style.fontWeight = stringField(*styleObj, "fontWeight").value_or("normal");
      l.style.fill = resolveValue(*styleObj, "fill", variables, "#ffffff");
      l.style.align = stringField(*styleObj, "align").value_or("center");
      l.style.lineHeight = numberField(*styleObj, "lineHeight").value_or(1.2);
      l.style.letterSpacing = numberField(*styleObj, "letterSpacing").value_or(0);
    }
    model.clocks.push_back(std::move(l));
    model.paintOrder.push_back("clock:" + id);
  }
}

} // namespace

bool parseTemplateFromTakeJson(
    const std::string& takeJson,
    TemplateModel& out,
    std::unordered_map<std::string, std::string>& variables,
    bool parseVariablesFromJson) {
  out = TemplateModel{};
  if (parseVariablesFromJson) variables.clear();

  if (parseVariablesFromJson) {
    const auto varsObj = extractObject(takeJson, "variables");
    if (!varsObj) {
      // no variables object
    } else {
    size_t i = 1;
    while (i < varsObj->size()) {
      if (varsObj->at(i) == '}') break;
      if (varsObj->at(i) == ',') { ++i; continue; }
      if (varsObj->at(i) != '"') { ++i; continue; }
      const auto key = parseObjectKeyAt(*varsObj, i);
      if (!key) break;
      while (i < varsObj->size() && varsObj->at(i) != '"') ++i;
      if (i >= varsObj->size()) break;
      const auto val = parseObjectKeyAt(*varsObj, i);
      if (!val) break;
      variables[*key] = *val;
    }
    }
  }

  const auto templateObj = extractObject(takeJson, "template");
  if (!templateObj) return false;
  return parseTemplateObjectJson(*templateObj, out, variables);
}

namespace {

std::string layerKeyPrefix(const std::string& type) {
  if (type == "rect") return "rect:";
  if (type == "text") return "text:";
  if (type == "image") return "image:";
  if (type == "clock") return "clock:";
  return {};
}

std::string findLayerTypeById(const std::string& id, const TemplateModel& model) {
  for (const auto& l : model.rects) if (l.id == id) return "rect";
  for (const auto& l : model.texts) if (l.id == id) return "text";
  for (const auto& l : model.images) if (l.id == id) return "image";
  for (const auto& l : model.clocks) if (l.id == id) return "clock";
  return {};
}

void rebuildPaintOrderFromRootStack(const std::string& templateJson, TemplateModel& model) {
  const auto rootStack = extractArray(templateJson, "rootStack");
  if (!rootStack) return;

  std::vector<std::string> order;
  for (const auto& entry : splitTopLevelObjects(*rootStack)) {
    const auto kind = stringField(entry, "kind");
    const auto id = stringField(entry, "id");
    if (!kind || !id) continue;
    if (*kind == "layer") {
      const std::string type = findLayerTypeById(*id, model);
      const std::string prefix = layerKeyPrefix(type);
      if (!prefix.empty()) order.push_back(prefix + *id);
    }
    // Nested groups: append layers belonging to group in stack order (fallback: all group layers)
    if (*kind == "group") {
      for (const auto& l : model.rects) {
        // groupId not stored in model — skip deep group order in v1 static parse
        (void)l;
      }
    }
  }
  if (!order.empty()) model.paintOrder = std::move(order);
}

} // namespace

bool parseTemplateObjectJson(
    const std::string& templateJson,
    TemplateModel& out,
    const std::unordered_map<std::string, std::string>& variables,
    bool reorderFromRootStack) {
  out = TemplateModel{};
  out.paintOrder.clear();
  out.rects.clear();
  out.texts.clear();
  out.images.clear();
  out.clocks.clear();

  if (auto canvas = extractObject(templateJson, "canvas")) {
    out.canvasWidth = static_cast<int>(numberField(*canvas, "width").value_or(1920));
    out.canvasHeight = static_cast<int>(numberField(*canvas, "height").value_or(1080));
    out.background = stringField(*canvas, "background").value_or("transparent");
  }

  if (auto layersArr = extractArray(templateJson, "layers")) {
    for (const auto& layerObj : splitTopLevelObjects(*layersArr)) {
      parseLayerObject(layerObj, out, variables);
    }
  }

  if (reorderFromRootStack) rebuildPaintOrderFromRootStack(templateJson, out);
  applyVariablesToModel(out, variables);
  return true;
}

int parseTimelineFps(const std::string& templateJson) {
  if (auto timeline = extractObject(templateJson, "timeline")) {
    const int fps = static_cast<int>(numberField(*timeline, "fps").value_or(50));
    if (fps > 0) return fps;
  }
  return 50;
}

void applyVariablesToModel(
    TemplateModel& model,
    const std::unordered_map<std::string, std::string>& variables) {
  (void)variables;
  (void)model;
  // Values are resolved during parse via resolveValue(); update only changes variables map.
}

} // namespace playoutd
