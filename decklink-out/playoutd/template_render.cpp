#include "template_render.h"
#include "raster.h"
#include "text_render.h"

#include <algorithm>
#include <cmath>
#include <iostream>
#include <unordered_map>

namespace playoutd {
namespace {

double clamp01(double v) {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

struct LayerLookup {
  const RectLayer* rect = nullptr;
  const TextLayer* text = nullptr;
  const ImageLayer* image = nullptr;
  const ClockLayer* clock = nullptr;
};

LayerLookup findLayer(const TemplateModel& model, const std::string& key) {
  LayerLookup l;
  if (key.rfind("rect:", 0) == 0) {
    const std::string id = key.substr(5);
    for (const auto& r : model.rects) if (r.id == id) { l.rect = &r; break; }
  } else if (key.rfind("text:", 0) == 0) {
    const std::string id = key.substr(5);
    for (const auto& t : model.texts) if (t.id == id) { l.text = &t; break; }
  } else if (key.rfind("image:", 0) == 0) {
    const std::string id = key.substr(6);
    for (const auto& i : model.images) if (i.id == id) { l.image = &i; break; }
  } else if (key.rfind("clock:", 0) == 0) {
    const std::string id = key.substr(6);
    for (const auto& c : model.clocks) if (c.id == id) { l.clock = &c; break; }
  }
  return l;
}

Transform scaleTransform(const Transform& t, double sx, double sy) {
  Transform o = t;
  o.x *= sx;
  o.y *= sy;
  o.width *= sx * t.scaleX;
  o.height *= sy * t.scaleY;
  o.scaleX = 1;
  o.scaleY = 1;
  return o;
}

std::unordered_map<std::string, DecodedImage> g_imageCache;

struct LayerRasterEntry {
  uint64_t contentKey = 0;
  int bufW = 0;
  int bufH = 0;
  std::vector<uint8_t> pixels;
};

std::unordered_map<std::string, LayerRasterEntry> g_layerRasterCache;

uint64_t mix64(uint64_t h, uint64_t v) {
  return h ^ (v + 0x9e3779b97f4a7c15ULL + (h << 6) + (h >> 2));
}

uint64_t hashString64(const std::string& s) {
  uint64_t h = 14695981039346656037ULL;
  for (unsigned char c : s) h = mix64(h, c);
  return h;
}

uint64_t rectContentKey(const RectLayer& layer, int bufW, int bufH) {
  uint64_t h = hashString64(layer.fill);
  h = mix64(h, hashString64(layer.borderColor));
  h = mix64(h, static_cast<uint64_t>(bufW));
  h = mix64(h, static_cast<uint64_t>(bufH));
  h = mix64(h, static_cast<uint64_t>(layer.cornerRadius * 1000));
  h = mix64(h, static_cast<uint64_t>(layer.borderWidth * 1000));
  h = mix64(h, static_cast<uint64_t>(layer.opacity * 1000));
  h = mix64(h, static_cast<uint64_t>(static_cast<int>(layer.blendMode)));
  return h;
}

void drawRectToBuffer(std::vector<uint8_t>& buf, int w, int h, const RectLayer& layer);

void compositeLayerBuffer(
    uint8_t* rgba,
    int outW,
    int outH,
    const std::vector<uint8_t>& buf,
    int bufW,
    int bufH,
    const Transform& t,
    float opacity,
    BlendMode blend);

uint64_t textRasterKey(const TextLayer& layer, const std::string& text, int bufW, int bufH) {
  uint64_t h = hashString64(text);
  h = mix64(h, hashString64(layer.style.fontFamily));
  h = mix64(h, hashString64(layer.style.fill));
  h = mix64(h, static_cast<uint64_t>(layer.style.fontSize * 100));
  h = mix64(h, static_cast<uint64_t>(bufW));
  h = mix64(h, static_cast<uint64_t>(bufH));
  return h;
}

bool tryDrawOpaqueRectFast(
    uint8_t* bgra,
    int outW,
    int outH,
    const RectLayer& layer,
    const Transform& t) {
  if (layer.cornerRadius > 0.01 || layer.borderWidth > 0.01) return false;
  if (std::abs(t.rotation) > 0.01) return false;
  if (layer.blendMode != BlendMode::Normal || layer.opacity < 0.99) return false;

  Rgba fill;
  if (!parseColor(layer.fill, fill)) return false;
  fill.a = static_cast<uint8_t>(clamp01(layer.opacity) * fill.a);
  if (fill.a == 0) return true;

  const int dx = static_cast<int>(std::lround(t.x));
  const int dy = static_cast<int>(std::lround(t.y));
  const int dw = std::max(1, static_cast<int>(std::lround(t.width)));
  const int dh = std::max(1, static_cast<int>(std::lround(t.height)));
  fillRectBgra(bgra, outW, outH, dx, dy, dw, dh, fill);
  return true;
}

void drawRectCached(
    uint8_t* bgra,
    int outW,
    int outH,
    const RectLayer& layer,
    const Transform& t,
    double sx,
    double sy) {
  if (tryDrawOpaqueRectFast(bgra, outW, outH, layer, t)) return;

  const int lw = std::max(1, static_cast<int>(t.width));
  const int lh = std::max(1, static_cast<int>(t.height));
  const uint64_t key = rectContentKey(layer, lw, lh);

  auto& entry = g_layerRasterCache[layer.id];
  if (entry.contentKey != key || entry.bufW != lw || entry.bufH != lh) {
    entry.bufW = lw;
    entry.bufH = lh;
    entry.contentKey = key;
    entry.pixels.assign(static_cast<size_t>(lw) * static_cast<size_t>(lh) * 4u, 0);
    RectLayer local = layer;
    local.cornerRadius *= sx;
    local.borderWidth *= sx;
    drawRectToBuffer(entry.pixels, lw, lh, local);
  }

  compositeRgbaToBgra(bgra, outW, outH, entry.pixels.data(), lw, lh, t.x, t.y, t.rotation,
                      static_cast<float>(layer.opacity), layer.blendMode);
}

void drawTextCompositeCached(
    uint8_t* bgra,
    int outW,
    int outH,
    const TextLayer& layer,
    const Transform& destTransform,
    const std::string& text,
    const std::string& cacheId) {
  const int lw = std::max(1, static_cast<int>(std::lround(layer.transform.width)));
  const int lh = std::max(1, static_cast<int>(std::lround(layer.transform.height)));
  const int contentW = std::max(1, measureTextContentWidth(layer, text, lw));
  const int contentH = std::max(1, measureTextContentHeight(layer, text, lw));

  const int destBoxW = std::max(1, static_cast<int>(std::lround(destTransform.width)));
  const int destBoxH = std::max(1, static_cast<int>(std::lround(destTransform.height)));
  const int dw = lw > 0
      ? std::max(1, static_cast<int>(std::lround(contentW * static_cast<double>(destBoxW) / lw)))
      : destBoxW;
  const int dh = lh > 0
      ? std::max(1, static_cast<int>(std::lround(contentH * static_cast<double>(destBoxH) / lh)))
      : destBoxH;

  const uint64_t key = textRasterKey(layer, text, contentW, contentH);
  auto& entry = g_layerRasterCache[cacheId];
  if (entry.contentKey != key || entry.bufW != contentW || entry.bufH != contentH) {
    entry.bufW = contentW;
    entry.bufH = contentH;
    entry.contentKey = key;
    entry.pixels.assign(static_cast<size_t>(contentW) * static_cast<size_t>(contentH) * 4u, 0);
    TextLayer local = layer;
    local.transform.x = 0;
    local.transform.y = 0;
    local.transform.width = lw;
    local.transform.height = contentH;
    local.transform.scaleX = 1;
    local.transform.scaleY = 1;
    drawTextLayer(entry.pixels.data(), contentW, contentH, local, text, true);
  }

  const int dx = static_cast<int>(std::lround(destTransform.x));
  const int dy = static_cast<int>(std::lround(destTransform.y));
  const float opacity = static_cast<float>(layer.opacity);

  if (contentW == dw && contentH == dh) {
    compositeRgbaToBgra(bgra, outW, outH, entry.pixels.data(), contentW, contentH, dx, dy,
                        destTransform.rotation, opacity, layer.blendMode);
    return;
  }

  const size_t scaledBytes = static_cast<size_t>(dw) * static_cast<size_t>(dh) * 4u;
  const std::string scaleKey = cacheId + ":scaled:" + std::to_string(dw) + "x" + std::to_string(dh);
  const uint64_t scaleHash = mix64(key, static_cast<uint64_t>(dw) << 32 | static_cast<uint64_t>(dh));
  auto& scaledEntry = g_layerRasterCache[scaleKey];
  if (scaledEntry.contentKey != scaleHash || scaledEntry.bufW != dw || scaledEntry.bufH != dh) {
    scaledEntry.bufW = dw;
    scaledEntry.bufH = dh;
    scaledEntry.contentKey = scaleHash;
    scaledEntry.pixels.assign(scaledBytes, 0);
    scaleBlitRgba(scaledEntry.pixels.data(), dw, dh, entry.pixels.data(), contentW, contentH, 0, 0, dw, dh, 1.f);
  }
  compositeRgbaToBgra(bgra, outW, outH, scaledEntry.pixels.data(), dw, dh, dx, dy, destTransform.rotation, opacity,
                      layer.blendMode);
}

const DecodedImage* getImage(const std::string& src) {
  const std::string path = resolveAssetPath(src);
  if (path.empty()) return nullptr;
  auto it = g_imageCache.find(path);
  if (it != g_imageCache.end()) return &it->second;
  DecodedImage img;
  if (!loadImageFile(path, img)) {
    std::cerr << "[playoutd] image load failed: " << path << "\n";
    return nullptr;
  }
  auto inserted = g_imageCache.emplace(path, std::move(img));
  return &inserted.first->second;
}

void drawRectToBuffer(std::vector<uint8_t>& buf, int w, int h, const RectLayer& layer) {
  Rgba fill;
  if (!parseColor(layer.fill, fill)) return;
  fill.a = static_cast<uint8_t>(clamp01(layer.opacity) * 255.0);

  const int radius = static_cast<int>(layer.cornerRadius);
  const int border = static_cast<int>(layer.borderWidth);

  if (border > 0) {
    Rgba borderColor;
    if (parseColor(layer.borderColor, borderColor)) {
      borderColor.a = fill.a;
      fillRoundedRectRgba(buf.data(), w, h, 0, 0, w, h, radius, borderColor);
      const int inset = std::min(border, std::min(w, h) / 2);
      fillRoundedRectRgba(buf.data(), w, h, inset, inset, w - inset * 2, h - inset * 2,
                         std::max(0, radius - inset), fill);
      return;
    }
  }
  fillRoundedRectRgba(buf.data(), w, h, 0, 0, w, h, radius, fill);
}

void compositeLayerBuffer(
    uint8_t* bgra,
    int outW,
    int outH,
    const std::vector<uint8_t>& buf,
    int bufW,
    int bufH,
    const Transform& t,
    float opacity,
    BlendMode blend) {
  compositeRgbaToBgra(bgra, outW, outH, buf.data(), bufW, bufH, t.x, t.y, t.rotation, opacity, blend);
}

// PIXI: wordWrap at layer width, intrinsic height (not clipped to layer box), then scaleX/scaleY.
void drawTextComposite(
    uint8_t* rgba,
    int outW,
    int outH,
    const TextLayer& layer,
    const Transform& destTransform,
    const std::string& text) {
  const int lw = std::max(1, static_cast<int>(std::lround(layer.transform.width)));
  const int lh = std::max(1, static_cast<int>(std::lround(layer.transform.height)));
  const int contentW = std::max(1, measureTextContentWidth(layer, text, lw));
  const int contentH = std::max(1, measureTextContentHeight(layer, text, lw));

  std::vector<uint8_t> buf(static_cast<size_t>(contentW) * static_cast<size_t>(contentH) * 4u, 0);

  TextLayer local = layer;
  local.transform.x = 0;
  local.transform.y = 0;
  local.transform.width = lw;
  local.transform.height = contentH;
  local.transform.scaleX = 1;
  local.transform.scaleY = 1;
  drawTextLayer(buf.data(), contentW, contentH, local, text, true);

  const int destBoxW = std::max(1, static_cast<int>(std::lround(destTransform.width)));
  const int destBoxH = std::max(1, static_cast<int>(std::lround(destTransform.height)));
  const int dw = lw > 0
      ? std::max(1, static_cast<int>(std::lround(contentW * static_cast<double>(destBoxW) / lw)))
      : destBoxW;
  const int dh = lh > 0
      ? std::max(1, static_cast<int>(std::lround(contentH * static_cast<double>(destBoxH) / lh)))
      : destBoxH;
  const int dx = static_cast<int>(std::lround(destTransform.x));
  const int dy = static_cast<int>(std::lround(destTransform.y));
  const float opacity = static_cast<float>(layer.opacity);

  if (contentW == dw && contentH == dh) {
    compositeRgba(rgba, outW, outH, buf.data(), contentW, contentH, dx, dy, destTransform.rotation, opacity,
                    layer.blendMode);
    return;
  }

  std::vector<uint8_t> scaled(static_cast<size_t>(dw) * static_cast<size_t>(dh) * 4u, 0);
  scaleBlitRgba(scaled.data(), dw, dh, buf.data(), contentW, contentH, 0, 0, dw, dh, 1.f);
  compositeRgba(rgba, outW, outH, scaled.data(), dw, dh, dx, dy, destTransform.rotation, opacity,
                layer.blendMode);
}

void drawImageLayer(uint8_t* bgra, int w, int h, const ImageLayer& layer, double sx, double sy) {
  if (!layer.visible || layer.src.empty()) return;
  const DecodedImage* img = getImage(layer.src);
  if (!img || img->width <= 0 || img->height <= 0) return;

  Transform t = scaleTransform(layer.transform, sx, sy);
  int dw = std::max(1, static_cast<int>(t.width));
  int dh = std::max(1, static_cast<int>(t.height));

  std::vector<uint8_t> scaled(static_cast<size_t>(dw) * static_cast<size_t>(dh) * 4u);
  int sw = img->width;
  int sh = img->height;

  if (layer.fit == "contain" || layer.fit == "cover") {
    const double scale = layer.fit == "contain"
        ? std::min(static_cast<double>(dw) / sw, static_cast<double>(dh) / sh)
        : std::max(static_cast<double>(dw) / sw, static_cast<double>(dh) / sh);
    sw = std::max(1, static_cast<int>(img->width * scale));
    sh = std::max(1, static_cast<int>(img->height * scale));
    scaled.assign(static_cast<size_t>(sw) * static_cast<size_t>(sh) * 4u, 0);
    for (int y = 0; y < sh; ++y) {
      const int syi = std::min(img->height - 1, y * img->height / sh);
      for (int x = 0; x < sw; ++x) {
        const int sxi = std::min(img->width - 1, x * img->width / sw);
        const uint8_t* sp = img->rgba.data() + (static_cast<size_t>(syi) * img->width + sxi) * 4u;
        uint8_t* dp = scaled.data() + (static_cast<size_t>(y) * sw + x) * 4u;
        dp[0] = sp[0]; dp[1] = sp[1]; dp[2] = sp[2]; dp[3] = sp[3];
      }
    }
    std::vector<uint8_t> fitted(static_cast<size_t>(dw) * static_cast<size_t>(dh) * 4u, 0);
    const int ox = (dw - sw) / 2;
    const int oy = (dh - sh) / 2;
    blitRgba(fitted.data(), dw, dh, scaled.data(), sw, sh, ox, oy, 1.f);
    scaled = std::move(fitted);
    sw = dw;
    sh = dh;
  } else {
    for (int y = 0; y < dh; ++y) {
      const int syi = std::min(img->height - 1, y * img->height / std::max(1, dh));
      for (int x = 0; x < dw; ++x) {
        const int sxi = std::min(img->width - 1, x * img->width / std::max(1, dw));
        const uint8_t* sp = img->rgba.data() + (static_cast<size_t>(syi) * img->width + sxi) * 4u;
        uint8_t* dp = scaled.data() + (static_cast<size_t>(y) * dw + x) * 4u;
        dp[0] = sp[0]; dp[1] = sp[1]; dp[2] = sp[2]; dp[3] = sp[3];
      }
    }
    sw = dw;
    sh = dh;
  }

  compositeLayerBuffer(bgra, w, h, scaled, sw, sh, t,
                       static_cast<float>(layer.opacity), layer.blendMode);
}

} // namespace

void clearLayerRasterCache() {
  g_layerRasterCache.clear();
}

void renderTemplate(
    uint8_t* bgra,
    int outWidth,
    int outHeight,
    const TemplateModel& model,
    const std::unordered_map<std::string, std::string>& variables) {
  (void)variables;
  const double sx = model.canvasWidth > 0 ? static_cast<double>(outWidth) / model.canvasWidth : 1.0;
  const double sy = model.canvasHeight > 0 ? static_cast<double>(outHeight) / model.canvasHeight : 1.0;

  Rgba bg;
  if (parseColor(model.background, bg) && bg.a > 0) {
    fillRectBgra(bgra, outWidth, outHeight, 0, 0, outWidth, outHeight, bg);
  }

  for (auto it = model.paintOrder.rbegin(); it != model.paintOrder.rend(); ++it) {
    const LayerLookup l = findLayer(model, *it);
    if (l.rect && l.rect->visible) {
      const Transform t = scaleTransform(l.rect->transform, sx, sy);
      drawRectCached(bgra, outWidth, outHeight, *l.rect, t, sx, sy);
    } else if (l.text && l.text->visible) {
      const Transform dest = scaleTransform(l.text->transform, sx, sy);
      drawTextCompositeCached(bgra, outWidth, outHeight, *l.text, dest, l.text->content, l.text->id);
    } else if (l.clock && l.clock->visible) {
      TextLayer asText;
      asText.visible = true;
      asText.opacity = l.clock->opacity;
      asText.blendMode = l.clock->blendMode;
      asText.transform = l.clock->transform;
      asText.style = l.clock->style;
      const Transform dest = scaleTransform(l.clock->transform, sx, sy);
      const std::string clockText = formatClockValue(*l.clock);
      drawTextCompositeCached(bgra, outWidth, outHeight, asText, dest, clockText, l.clock->id);
    } else if (l.image && l.image->visible) {
      drawImageLayer(bgra, outWidth, outHeight, *l.image, sx, sy);
    }
  }
}

} // namespace playoutd
