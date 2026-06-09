#pragma once

#include "template_model.h"

#include <cstdint>
#include <string>
#include <vector>

namespace playoutd {

struct Rgba {
  uint8_t r = 0;
  uint8_t g = 0;
  uint8_t b = 0;
  uint8_t a = 255;
};

bool parseColor(const std::string& css, Rgba& out);

void fillRectRgba(uint8_t* rgba, int width, int height, int x, int y, int w, int h, Rgba color);
void fillRectBgra(uint8_t* bgra, int width, int height, int x, int y, int w, int h, Rgba color);
/** Composite full-frame src BGRA over dst BGRA (Normal blend). */
void compositeBgraOverBgra(uint8_t* dst, int width, int height, const uint8_t* src);
void fillRoundedRectRgba(uint8_t* rgba, int width, int height, int x, int y, int w, int h, int radius, Rgba color);
void blitRgba(uint8_t* dst, int dstW, int dstH, const uint8_t* src, int srcW, int srcH, int x, int y, float opacity);
void scaleBlitRgba(
    uint8_t* dst,
    int dstW,
    int dstH,
    const uint8_t* src,
    int srcW,
    int srcH,
    int dstX,
    int dstY,
    int targetW,
    int targetH,
    float opacity);

/** Composite src (local 0,0) onto dst with rotation around origin (degrees, top-left pivot). */
void compositeRgba(
    uint8_t* dst,
    int dstW,
    int dstH,
    const uint8_t* src,
    int srcW,
    int srcH,
    double originX,
    double originY,
    double rotationDeg,
    float opacity,
    BlendMode blend);

/** Composite RGBA layer buffer onto BGRA framebuffer (DeckLink order). */
void compositeRgbaToBgra(
    uint8_t* dstBgra,
    int dstW,
    int dstH,
    const uint8_t* srcRgba,
    int srcW,
    int srcH,
    double originX,
    double originY,
    double rotationDeg,
    float opacity,
    BlendMode blend);

struct DecodedImage {
  int width = 0;
  int height = 0;
  std::vector<uint8_t> rgba;
};

bool loadImageFile(const std::string& path, DecodedImage& out);
std::string resolveAssetPath(const std::string& src);

} // namespace playoutd
