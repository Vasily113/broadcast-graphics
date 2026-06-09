#include "text_render.h"
#include "font_registry.h"
#include "utf8_util.h"

#include <algorithm>
#include <cctype>
#include <chrono>
#include <cmath>
#include <cstring>
#include <fstream>
#include <iostream>
#include <string>
#include <unordered_map>
#include <vector>

#ifdef PLAYOUT_HAS_FREETYPE
#include <ft2build.h>
#include FT_FREETYPE_H
#endif

namespace playoutd {
namespace {

#ifdef PLAYOUT_HAS_FREETYPE
FT_Library g_ftLib = nullptr;
std::unordered_map<std::string, FT_Face> g_faceCache;

FT_Face cachedFace(const std::string& fontPath) {
  auto it = g_faceCache.find(fontPath);
  if (it != g_faceCache.end()) return it->second;
  FT_Face face = nullptr;
  if (FT_New_Face(g_ftLib, fontPath.c_str(), 0, &face) != 0) return nullptr;
  g_faceCache.emplace(fontPath, face);
  return face;
}

bool ensureFt() {
  if (g_ftLib) return true;
  initFontRegistry();
  if (FT_Init_FreeType(&g_ftLib) != 0) return false;
  const std::string probe = fontPathForFamily("DejaVu Sans", "normal");
  if (probe.empty()) {
    std::cerr << "[playoutd] no font found; import fonts to fonts/ or set PLAYOUT_FONTS_DIR\n";
    return false;
  }
  return true;
}

struct GlyphMetrics {
  uint32_t cp = 0;
  int advance = 0;
  int width = 0;
  int height = 0;
  int left = 0;
  int top = 0;
  std::vector<uint8_t> bitmap;
};

bool loadGlyph(FT_Face face, uint32_t cp, int loadFlags, GlyphMetrics& out) {
  if (FT_Load_Char(face, static_cast<FT_ULong>(cp), loadFlags)) return false;
  const FT_GlyphSlot g = face->glyph;
  out.cp = cp;
  out.advance = static_cast<int>(g->advance.x >> 6);
  out.width = static_cast<int>(g->bitmap.width);
  out.height = static_cast<int>(g->bitmap.rows);
  out.left = g->bitmap_left;
  out.top = g->bitmap_top;
  const size_t n = static_cast<size_t>(out.width) * static_cast<size_t>(out.height);
  out.bitmap.assign(n, 0);
  if (n > 0) std::memcpy(out.bitmap.data(), g->bitmap.buffer, n);
  return true;
}

void drawGlyphBitmap(
    uint8_t* rgba,
    int width,
    int height,
    const GlyphMetrics& glyph,
    int penX,
    int baselineY,
    const Rgba& color) {
  const int x = penX + glyph.left;
  const int y = baselineY - glyph.top;
  for (int row = 0; row < glyph.height; ++row) {
    for (int col = 0; col < glyph.width; ++col) {
      const uint8_t alpha = glyph.bitmap[static_cast<size_t>(row) * glyph.width + col];
      if (!alpha) continue;
      const int dx = x + col;
      const int dy = y + row;
      if (dx < 0 || dy < 0 || dx >= width || dy >= height) continue;
      uint8_t* p = rgba + (static_cast<size_t>(dy) * static_cast<size_t>(width) + dx) * 4u;
      const float sa = (alpha / 255.f) * (color.a / 255.f);
      const float ia = 1.f - sa;
      p[0] = static_cast<uint8_t>(color.r * sa + p[0] * ia);
      p[1] = static_cast<uint8_t>(color.g * sa + p[1] * ia);
      p[2] = static_cast<uint8_t>(color.b * sa + p[2] * ia);
      p[3] = static_cast<uint8_t>(std::min(255, static_cast<int>(color.a * sa + p[3] * ia)));
    }
  }
}

bool isWrapSpace(uint32_t cp) {
  return cp == ' ' || cp == '\t' || cp == '\r';
}

// PIXI wordWrap with breakWords=false: wrap only at spaces; long words may overflow boxW.
std::vector<std::vector<GlyphMetrics>> wrapTextToLines(
    FT_Face face,
    const std::string& text,
    int boxW,
    int loadFlags,
    int letterSpacingPx) {
  std::vector<std::vector<GlyphMetrics>> lines;
  lines.emplace_back();

  size_t idx = 0;
  uint32_t cp = 0;
  int lineWidth = 0;
  std::vector<GlyphMetrics> word;
  int wordWidth = 0;

  auto flushWord = [&]() {
    if (word.empty()) return;
    if (boxW > 0 && lineWidth > 0 && lineWidth + wordWidth > boxW) {
      lines.emplace_back();
      lineWidth = 0;
    }
    for (auto& g : word) {
      lines.back().push_back(std::move(g));
    }
    lineWidth += wordWidth;
    word.clear();
    wordWidth = 0;
  };

  while (utf8::nextCodepoint(text, idx, cp)) {
    if (cp == '\n') {
      flushWord();
      lines.emplace_back();
      lineWidth = 0;
      continue;
    }

    if (isWrapSpace(cp)) {
      flushWord();
      GlyphMetrics g;
      if (!loadGlyph(face, cp, loadFlags, g)) continue;
      const int glyphW = g.advance + letterSpacingPx;
      if (boxW > 0 && lineWidth > 0 && lineWidth + glyphW > boxW) {
        lines.emplace_back();
        lineWidth = 0;
      }
      lines.back().push_back(std::move(g));
      lineWidth += glyphW;
      continue;
    }

    GlyphMetrics g;
    if (!loadGlyph(face, cp, loadFlags, g)) {
      if (!loadGlyph(face, '?', loadFlags, g)) continue;
    }
    if (!word.empty()) wordWidth += letterSpacingPx;
    wordWidth += g.advance;
    word.push_back(std::move(g));
  }

  flushWord();

  if (lines.size() == 1 && lines[0].empty()) lines.clear();
  else if (lines.size() > 1 && lines.back().empty()) lines.pop_back();

  return lines;
}

int lineWidthPx(const std::vector<GlyphMetrics>& line, int letterSpacingPx) {
  if (line.empty()) return 0;
  int w = 0;
  for (size_t i = 0; i < line.size(); ++i) {
    w += line[i].advance;
    if (i + 1 < line.size()) w += letterSpacingPx;
  }
  return w;
}

int maxLineWidthPx(
    const std::vector<std::vector<GlyphMetrics>>& lines,
    int letterSpacingPx) {
  int maxW = 0;
  for (const auto& line : lines) {
    maxW = std::max(maxW, lineWidthPx(line, letterSpacingPx));
  }
  return maxW;
}

bool setupFaceForLayer(const TextLayer& layer, FT_Face& face, int& px, int& letterSpacingPx, int& lineStep) {
  if (!ensureFt()) return false;
  const std::string fontPath = fontPathForFamily(layer.style.fontFamily, layer.style.fontWeight);
  if (fontPath.empty()) return false;
  face = cachedFace(fontPath);
  if (!face) return false;

  double fontScale = 1.0;
  if (const char* env = std::getenv("PLAYOUT_FONT_SCALE")) {
    try { fontScale = std::stod(env); } catch (...) {}
  }
  if (fontScale <= 0) fontScale = 1.0;

  px = std::max(1, static_cast<int>(std::lround(layer.style.fontSize * fontScale)));
  FT_Set_Char_Size(
      face,
      static_cast<FT_F26Dot6>(px * 64),
      static_cast<FT_F26Dot6>(px * 64),
      72,
      72);

  letterSpacingPx = static_cast<int>(std::lround(layer.style.letterSpacing * fontScale));
  const double lineHeightMul = layer.style.lineHeight > 0.1 ? layer.style.lineHeight : 1.2;
  lineStep = std::max(1, static_cast<int>(std::lround(px * lineHeightMul)));
  return true;
}

int contentHeightFromLines(
    FT_Face face,
    const std::vector<std::vector<GlyphMetrics>>& lines,
    int lineStep) {
  const int ascender = (face->size->metrics.ascender >> 6);
  const int descender = (-face->size->metrics.descender >> 6);

  int nonEmpty = 0;
  for (const auto& line : lines) {
    if (!line.empty()) ++nonEmpty;
  }
  if (nonEmpty == 0) return std::max(1, ascender + descender);

  int bottomExtent = descender;
  for (const auto& g : lines.back()) {
    const int below = g.height - g.top;
    if (below > bottomExtent) bottomExtent = below;
  }

  return ascender + (nonEmpty - 1) * lineStep + bottomExtent;
}

#endif

} // namespace

std::string formatClockValue(const ClockLayer& layer) {
  const auto now = std::chrono::system_clock::now();
  const std::time_t t = std::chrono::system_clock::to_time_t(now);
  std::tm local {};
  localtime_r(&t, &local);
  int total = local.tm_hour * 3600 + local.tm_min * 60 + local.tm_sec;
  if (layer.mode == "countup" || layer.mode == "countdown") {
    total = std::max(0, total % 86400);
  }
  const int h = total / 3600;
  const int m = (total % 3600) / 60;
  const int s = total % 60;
  std::string fmt = layer.format;
  auto rep = [&](const std::string& tok, int v) {
    const std::string val = (v < 10 ? "0" : "") + std::to_string(v);
    size_t pos = 0;
    while ((pos = fmt.find(tok, pos)) != std::string::npos) {
      fmt.replace(pos, tok.size(), val);
      pos += val.size();
    }
  };
  rep("HH", h);
  rep("mm", m);
  rep("ss", s);
  return fmt;
}

int measureTextContentWidth(const TextLayer& layer, const std::string& text, int wrapWidth) {
#ifndef PLAYOUT_HAS_FREETYPE
  (void)layer;
  (void)text;
  return std::max(1, wrapWidth);
#else
  if (text.empty()) return std::max(1, wrapWidth);
  FT_Face face = nullptr;
  int px = 0;
  int letterSpacingPx = 0;
  int lineStep = 0;
  if (!setupFaceForLayer(layer, face, px, letterSpacingPx, lineStep)) return std::max(1, wrapWidth);

  const int boxW = std::max(1, wrapWidth);
  const auto lines = wrapTextToLines(face, text, boxW, FT_LOAD_RENDER, letterSpacingPx);
  const int w = std::max(boxW, maxLineWidthPx(lines, letterSpacingPx));
  return std::max(1, w);
#endif
}

int measureTextContentHeight(const TextLayer& layer, const std::string& text, int wrapWidth) {
#ifndef PLAYOUT_HAS_FREETYPE
  (void)layer;
  (void)text;
  (void)wrapWidth;
  return 1;
#else
  if (text.empty()) return 1;
  FT_Face face = nullptr;
  int px = 0;
  int letterSpacingPx = 0;
  int lineStep = 0;
  if (!setupFaceForLayer(layer, face, px, letterSpacingPx, lineStep)) return 1;

  const int boxW = std::max(1, wrapWidth);
  const auto lines = wrapTextToLines(face, text, boxW, FT_LOAD_RENDER, letterSpacingPx);
  const int h = contentHeightFromLines(face, lines, lineStep);
  return std::max(1, h);
#endif
}

void drawTextLayer(
    uint8_t* rgba,
    int width,
    int height,
    const TextLayer& layer,
    const std::string& text,
    bool localOrigin) {
  if (!layer.visible || text.empty()) return;
  Rgba color;
  if (!parseColor(layer.style.fill, color)) return;
  const double op = layer.opacity < 0 ? 0 : (layer.opacity > 1 ? 1 : layer.opacity);
  color.a = static_cast<uint8_t>(op * 255.0);

#ifdef PLAYOUT_HAS_FREETYPE
  FT_Face face = nullptr;
  int px = 0;
  int letterSpacingPx = 0;
  int lineStep = 0;
  if (!setupFaceForLayer(layer, face, px, letterSpacingPx, lineStep)) return;

  const int boxX = localOrigin ? 0 : static_cast<int>(layer.transform.x);
  const int boxY = localOrigin ? 0 : static_cast<int>(layer.transform.y);
  const int boxW = static_cast<int>(layer.transform.width);

  const int loadFlags = FT_LOAD_RENDER;
  const int ascender = (face->size->metrics.ascender >> 6);

  const auto lines = wrapTextToLines(face, text, boxW, loadFlags, letterSpacingPx);

  // Top-left layout like PIXI.Text (anchor 0,0). Do not clip by box height — PIXI does not
  // hide overflow when fontSize exceeds the layer box; glyphs clip at buffer edges only.
  int baselineY = boxY + ascender;
  for (const auto& line : lines) {
    if (line.empty()) {
      baselineY += lineStep;
      continue;
    }

    const int lw = lineWidthPx(line, letterSpacingPx);
    int penX = boxX;
    if (layer.style.align == "center") {
      penX = boxX + std::max(0, (boxW - lw) / 2);
    } else if (layer.style.align == "right") {
      penX = boxX + std::max(0, boxW - lw);
    }

    for (size_t i = 0; i < line.size(); ++i) {
      drawGlyphBitmap(rgba, width, height, line[i], penX, baselineY, color);
      penX += line[i].advance;
      if (i + 1 < line.size()) penX += letterSpacingPx;
    }
    baselineY += lineStep;
  }
#else
  fillRectRgba(rgba, width, height,
               static_cast<int>(layer.transform.x),
               static_cast<int>(layer.transform.y),
               static_cast<int>(layer.transform.width),
               static_cast<int>(layer.transform.height),
               color);
#endif
}

} // namespace playoutd
