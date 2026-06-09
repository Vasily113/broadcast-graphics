#include "raster.h"

#include <algorithm>
#include <cmath>
#include <cctype>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <iostream>
#include <vector>

#ifdef PLAYOUT_HAS_PNG
#include <png.h>
#endif

namespace playoutd {
namespace {

std::string envOr(const char* key, const std::string& fallback) {
  const char* v = std::getenv(key);
  return (v && *v) ? std::string(v) : fallback;
}

void blendPixel(uint8_t* dp, const uint8_t* sp, float opacity, BlendMode mode) {
  const float sa = (sp[3] / 255.f) * opacity;
  if (sa <= 0.f) return;

  const float sr = sp[0] / 255.f;
  const float sg = sp[1] / 255.f;
  const float sb = sp[2] / 255.f;
  const float da = dp[3] / 255.f;
  const float dr = dp[0] / 255.f;
  const float dg = dp[1] / 255.f;
  const float db = dp[2] / 255.f;

  float cr = sr;
  float cg = sg;
  float cb = sb;

  if (mode == BlendMode::Multiply) {
    cr = dr * sr;
    cg = dg * sg;
    cb = db * sb;
  } else if (mode == BlendMode::Screen) {
    cr = 1.f - (1.f - dr) * (1.f - sr);
    cg = 1.f - (1.f - dg) * (1.f - sg);
    cb = 1.f - (1.f - db) * (1.f - sb);
  } else if (mode == BlendMode::Add) {
    cr = std::min(1.f, dr + sr);
    cg = std::min(1.f, dg + sg);
    cb = std::min(1.f, db + sb);
  }

  const float ia = 1.f - sa;
  const float outA = sa + da * ia;
  if (outA <= 0.f) return;
  const float outR = (cr * sa + dr * da * ia) / outA;
  const float outG = (cg * sa + dg * da * ia) / outA;
  const float outB = (cb * sa + db * da * ia) / outA;

  dp[0] = static_cast<uint8_t>(std::min(255, static_cast<int>(outR * 255.f + 0.5f)));
  dp[1] = static_cast<uint8_t>(std::min(255, static_cast<int>(outG * 255.f + 0.5f)));
  dp[2] = static_cast<uint8_t>(std::min(255, static_cast<int>(outB * 255.f + 0.5f)));
  dp[3] = static_cast<uint8_t>(std::min(255, static_cast<int>(outA * 255.f + 0.5f)));
}

/** src RGBA, dst BGRA (DeckLink). */
void blendPixelRgbaOverBgra(uint8_t* dp, const uint8_t* sp, float opacity, BlendMode mode) {
  const float sa = (sp[3] / 255.f) * opacity;
  if (sa <= 0.f) return;

  const float sr = sp[0] / 255.f;
  const float sg = sp[1] / 255.f;
  const float sb = sp[2] / 255.f;
  const float da = dp[3] / 255.f;
  const float db = dp[0] / 255.f;
  const float dg = dp[1] / 255.f;
  const float dr = dp[2] / 255.f;

  float cr = sr;
  float cg = sg;
  float cb = sb;

  if (mode == BlendMode::Multiply) {
    cr = dr * sr;
    cg = dg * sg;
    cb = db * sb;
  } else if (mode == BlendMode::Screen) {
    cr = 1.f - (1.f - dr) * (1.f - sr);
    cg = 1.f - (1.f - dg) * (1.f - sg);
    cb = 1.f - (1.f - db) * (1.f - sb);
  } else if (mode == BlendMode::Add) {
    cr = std::min(1.f, dr + sr);
    cg = std::min(1.f, dg + sg);
    cb = std::min(1.f, db + sb);
  }

  const float ia = 1.f - sa;
  const float outA = sa + da * ia;
  if (outA <= 0.f) return;
  const float outR = (cr * sa + dr * da * ia) / outA;
  const float outG = (cg * sa + dg * da * ia) / outA;
  const float outB = (cb * sa + db * da * ia) / outA;

  dp[0] = static_cast<uint8_t>(std::min(255, static_cast<int>(outB * 255.f + 0.5f)));
  dp[1] = static_cast<uint8_t>(std::min(255, static_cast<int>(outG * 255.f + 0.5f)));
  dp[2] = static_cast<uint8_t>(std::min(255, static_cast<int>(outR * 255.f + 0.5f)));
  dp[3] = static_cast<uint8_t>(std::min(255, static_cast<int>(outA * 255.f + 0.5f)));
}

void blendPixelBgraOverBgra(uint8_t* dp, const uint8_t* sp, float opacity, BlendMode mode) {
  const float sa = (sp[3] / 255.f) * opacity;
  if (sa <= 0.f) return;

  const float sb = sp[0] / 255.f;
  const float sg = sp[1] / 255.f;
  const float sr = sp[2] / 255.f;
  const float da = dp[3] / 255.f;
  const float db = dp[0] / 255.f;
  const float dg = dp[1] / 255.f;
  const float dr = dp[2] / 255.f;

  float cb = sb;
  float cg = sg;
  float cr = sr;

  if (mode == BlendMode::Multiply) {
    cr = dr * sr;
    cg = dg * sg;
    cb = db * sb;
  } else if (mode == BlendMode::Screen) {
    cr = 1.f - (1.f - dr) * (1.f - sr);
    cg = 1.f - (1.f - dg) * (1.f - sg);
    cb = 1.f - (1.f - db) * (1.f - sb);
  } else if (mode == BlendMode::Add) {
    cr = std::min(1.f, dr + sr);
    cg = std::min(1.f, dg + sg);
    cb = std::min(1.f, db + sb);
  }

  const float ia = 1.f - sa;
  const float outA = sa + da * ia;
  if (outA <= 0.f) return;
  const float outR = (cr * sa + dr * da * ia) / outA;
  const float outG = (cg * sa + dg * da * ia) / outA;
  const float outB = (cb * sa + db * da * ia) / outA;

  dp[0] = static_cast<uint8_t>(std::min(255, static_cast<int>(outB * 255.f + 0.5f)));
  dp[1] = static_cast<uint8_t>(std::min(255, static_cast<int>(outG * 255.f + 0.5f)));
  dp[2] = static_cast<uint8_t>(std::min(255, static_cast<int>(outR * 255.f + 0.5f)));
  dp[3] = static_cast<uint8_t>(std::min(255, static_cast<int>(outA * 255.f + 0.5f)));
}

} // namespace

void compositeBgraOverBgra(uint8_t* dst, int width, int height, const uint8_t* src) {
  const int pixels = width * height;
  for (int i = 0; i < pixels; ++i) {
    blendPixelBgraOverBgra(dst + i * 4, src + i * 4, 1.f, BlendMode::Normal);
  }
}

BlendMode blendModeFromString(const std::string& s) {
  if (s == "add") return BlendMode::Add;
  if (s == "multiply") return BlendMode::Multiply;
  if (s == "screen") return BlendMode::Screen;
  return BlendMode::Normal;
}

bool parseColor(const std::string& css, Rgba& out) {
  if (css.empty() || css == "transparent") {
    out = {0, 0, 0, 0};
    return true;
  }
  std::string s = css;
  if (s.front() == '#') s = s.substr(1);
  if (s.size() == 6) {
    auto hex = [](char c) -> int {
      if (c >= '0' && c <= '9') return c - '0';
      if (c >= 'a' && c <= 'f') return c - 'a' + 10;
      if (c >= 'A' && c <= 'F') return c - 'A' + 10;
      return 0;
    };
    out.r = static_cast<uint8_t>((hex(s[0]) << 4) | hex(s[1]));
    out.g = static_cast<uint8_t>((hex(s[2]) << 4) | hex(s[3]));
    out.b = static_cast<uint8_t>((hex(s[4]) << 4) | hex(s[5]));
    out.a = 255;
    return true;
  }
  return false;
}

void fillRectBgra(uint8_t* bgra, int width, int height, int x, int y, int w, int h, Rgba color) {
  const int x0 = std::max(0, x);
  const int y0 = std::max(0, y);
  const int x1 = std::min(width, x + w);
  const int y1 = std::min(height, y + h);
  for (int row = y0; row < y1; ++row) {
    uint8_t* p = bgra + (static_cast<size_t>(row) * static_cast<size_t>(width) + static_cast<size_t>(x0)) * 4u;
    for (int col = x0; col < x1; ++col) {
      const float a = color.a / 255.f;
      const float ia = 1.f - a;
      p[0] = static_cast<uint8_t>(color.b * a + p[0] * ia);
      p[1] = static_cast<uint8_t>(color.g * a + p[1] * ia);
      p[2] = static_cast<uint8_t>(color.r * a + p[2] * ia);
      p[3] = static_cast<uint8_t>(std::min(255, static_cast<int>(color.a + p[3] * ia)));
      p += 4;
    }
  }
}

void fillRectRgba(uint8_t* rgba, int width, int height, int x, int y, int w, int h, Rgba color) {
  const int x0 = std::max(0, x);
  const int y0 = std::max(0, y);
  const int x1 = std::min(width, x + w);
  const int y1 = std::min(height, y + h);
  for (int row = y0; row < y1; ++row) {
    uint8_t* p = rgba + (static_cast<size_t>(row) * static_cast<size_t>(width) + static_cast<size_t>(x0)) * 4u;
    for (int col = x0; col < x1; ++col) {
      const float a = color.a / 255.f;
      const float ia = 1.f - a;
      p[0] = static_cast<uint8_t>(color.r * a + p[0] * ia);
      p[1] = static_cast<uint8_t>(color.g * a + p[1] * ia);
      p[2] = static_cast<uint8_t>(color.b * a + p[2] * ia);
      p[3] = static_cast<uint8_t>(std::min(255, static_cast<int>(color.a + p[3] * ia)));
      p += 4;
    }
  }
}

void fillRoundedRectRgba(uint8_t* rgba, int width, int height, int x, int y, int w, int h, int radius, Rgba color) {
  if (radius <= 0) {
    fillRectRgba(rgba, width, height, x, y, w, h, color);
    return;
  }
  radius = std::min(radius, std::min(w, h) / 2);
  const int x0 = std::max(0, x);
  const int y0 = std::max(0, y);
  const int x1 = std::min(width, x + w);
  const int y1 = std::min(height, y + h);
  const int cx0 = x + radius;
  const int cy0 = y + radius;
  const int cx1 = x + w - radius;
  const int cy1 = y + h - radius;
  const int r2 = radius * radius;
  for (int row = y0; row < y1; ++row) {
    for (int col = x0; col < x1; ++col) {
      bool inside = true;
      if (col < cx0 && row < cy0) {
        const int dx = col - cx0;
        const int dy = row - cy0;
        inside = dx * dx + dy * dy <= r2;
      } else if (col >= cx1 && row < cy0) {
        const int dx = col - cx1;
        const int dy = row - cy0;
        inside = dx * dx + dy * dy <= r2;
      } else if (col < cx0 && row >= cy1) {
        const int dx = col - cx0;
        const int dy = row - cy1;
        inside = dx * dx + dy * dy <= r2;
      } else if (col >= cx1 && row >= cy1) {
        const int dx = col - cx1;
        const int dy = row - cy1;
        inside = dx * dx + dy * dy <= r2;
      }
      if (!inside) continue;
      uint8_t* p = rgba + (static_cast<size_t>(row) * static_cast<size_t>(width) + static_cast<size_t>(col)) * 4u;
      const float a = color.a / 255.f;
      const float ia = 1.f - a;
      p[0] = static_cast<uint8_t>(color.r * a + p[0] * ia);
      p[1] = static_cast<uint8_t>(color.g * a + p[1] * ia);
      p[2] = static_cast<uint8_t>(color.b * a + p[2] * ia);
      p[3] = static_cast<uint8_t>(std::min(255, static_cast<int>(color.a + p[3] * ia)));
    }
  }
}

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
    BlendMode blend) {
  if (!src || srcW <= 0 || srcH <= 0) return;

  if (std::abs(rotationDeg) < 0.01 && blend == BlendMode::Normal) {
    const int x = static_cast<int>(originX);
    const int y = static_cast<int>(originY);
    const int x0 = std::max(0, x);
    const int y0 = std::max(0, y);
    const int x1 = std::min(dstW, x + srcW);
    const int y1 = std::min(dstH, y + srcH);
    const int srcX0 = x0 - x;
    const int srcY0 = y0 - y;
    for (int row = y0; row < y1; ++row) {
      const int sy = srcY0 + (row - y0);
      const uint8_t* sp = src + (static_cast<size_t>(sy) * static_cast<size_t>(srcW) + static_cast<size_t>(srcX0)) * 4u;
      uint8_t* dp = dst + (static_cast<size_t>(row) * static_cast<size_t>(dstW) + static_cast<size_t>(x0)) * 4u;
      for (int col = x0; col < x1; ++col) {
        blendPixel(dp, sp, opacity, BlendMode::Normal);
        sp += 4;
        dp += 4;
      }
    }
    return;
  }

  if (std::abs(rotationDeg) < 0.01) {
    const int x = static_cast<int>(originX);
    const int y = static_cast<int>(originY);
    for (int ly = 0; ly < srcH; ++ly) {
      for (int lx = 0; lx < srcW; ++lx) {
        const uint8_t* sp = src + (static_cast<size_t>(ly) * static_cast<size_t>(srcW) + static_cast<size_t>(lx)) * 4u;
        if (sp[3] == 0) continue;
        const int px = x + lx;
        const int py = y + ly;
        if (px < 0 || py < 0 || px >= dstW || py >= dstH) continue;
        blendPixel(dst + (static_cast<size_t>(py) * static_cast<size_t>(dstW) + static_cast<size_t>(px)) * 4u,
                   sp, opacity, blend);
      }
    }
    return;
  }

  const double rad = rotationDeg * 3.141592653589793 / 180.0;
  const double c = std::cos(rad);
  const double s = std::sin(rad);

  for (int ly = 0; ly < srcH; ++ly) {
    for (int lx = 0; lx < srcW; ++lx) {
      const uint8_t* sp = src + (static_cast<size_t>(ly) * static_cast<size_t>(srcW) + static_cast<size_t>(lx)) * 4u;
      if (sp[3] == 0) continue;
      const double dx = originX + lx * c - ly * s;
      const double dy = originY + lx * s + ly * c;
      const int px = static_cast<int>(std::lround(dx));
      const int py = static_cast<int>(std::lround(dy));
      if (px < 0 || py < 0 || px >= dstW || py >= dstH) continue;
      uint8_t* dp = dst + (static_cast<size_t>(py) * static_cast<size_t>(dstW) + static_cast<size_t>(px)) * 4u;
      blendPixel(dp, sp, opacity, blend);
    }
  }
}

void compositeRgbaToBgra(
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
    BlendMode blend) {
  if (!src || srcW <= 0 || srcH <= 0) return;

  if (std::abs(rotationDeg) < 0.01 && blend == BlendMode::Normal) {
    const int x = static_cast<int>(originX);
    const int y = static_cast<int>(originY);
    const int x0 = std::max(0, x);
    const int y0 = std::max(0, y);
    const int x1 = std::min(dstW, x + srcW);
    const int y1 = std::min(dstH, y + srcH);
    const int srcX0 = x0 - x;
    const int srcY0 = y0 - y;
    for (int row = y0; row < y1; ++row) {
      const int sy = srcY0 + (row - y0);
      const uint8_t* sp = src + (static_cast<size_t>(sy) * static_cast<size_t>(srcW) + static_cast<size_t>(srcX0)) * 4u;
      uint8_t* dp = dst + (static_cast<size_t>(row) * static_cast<size_t>(dstW) + static_cast<size_t>(x0)) * 4u;
      for (int col = x0; col < x1; ++col) {
        blendPixelRgbaOverBgra(dp, sp, opacity, BlendMode::Normal);
        sp += 4;
        dp += 4;
      }
    }
    return;
  }

  if (std::abs(rotationDeg) < 0.01) {
    const int x = static_cast<int>(originX);
    const int y = static_cast<int>(originY);
    for (int ly = 0; ly < srcH; ++ly) {
      for (int lx = 0; lx < srcW; ++lx) {
        const uint8_t* sp = src + (static_cast<size_t>(ly) * static_cast<size_t>(srcW) + static_cast<size_t>(lx)) * 4u;
        if (sp[3] == 0) continue;
        const int px = x + lx;
        const int py = y + ly;
        if (px < 0 || py < 0 || px >= dstW || py >= dstH) continue;
        blendPixelRgbaOverBgra(dst + (static_cast<size_t>(py) * static_cast<size_t>(dstW) + static_cast<size_t>(px)) * 4u,
                               sp, opacity, blend);
      }
    }
    return;
  }

  const double rad = rotationDeg * 3.141592653589793 / 180.0;
  const double c = std::cos(rad);
  const double s = std::sin(rad);

  for (int ly = 0; ly < srcH; ++ly) {
    for (int lx = 0; lx < srcW; ++lx) {
      const uint8_t* sp = src + (static_cast<size_t>(ly) * static_cast<size_t>(srcW) + static_cast<size_t>(lx)) * 4u;
      if (sp[3] == 0) continue;
      const double dx = originX + lx * c - ly * s;
      const double dy = originY + lx * s + ly * c;
      const int px = static_cast<int>(std::lround(dx));
      const int py = static_cast<int>(std::lround(dy));
      if (px < 0 || py < 0 || px >= dstW || py >= dstH) continue;
      uint8_t* dp = dst + (static_cast<size_t>(py) * static_cast<size_t>(dstW) + static_cast<size_t>(px)) * 4u;
      blendPixelRgbaOverBgra(dp, sp, opacity, blend);
    }
  }
}

void blitRgba(uint8_t* dst, int dstW, int dstH, const uint8_t* src, int srcW, int srcH, int x, int y, float opacity) {
  compositeRgba(dst, dstW, dstH, src, srcW, srcH, x, y, 0, opacity, BlendMode::Normal);
}

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
    float opacity) {
  if (srcW <= 0 || srcH <= 0 || targetW <= 0 || targetH <= 0) return;
  if (srcW == targetW && srcH == targetH) {
    blitRgba(dst, dstW, dstH, src, srcW, srcH, dstX, dstY, opacity);
    return;
  }
  std::vector<uint8_t> scaled(static_cast<size_t>(targetW) * static_cast<size_t>(targetH) * 4u, 0);
  for (int y = 0; y < targetH; ++y) {
    const int sy = std::min(srcH - 1, y * srcH / targetH);
    for (int x = 0; x < targetW; ++x) {
      const int sx = std::min(srcW - 1, x * srcW / targetW);
      const uint8_t* sp = src + (static_cast<size_t>(sy) * srcW + sx) * 4u;
      uint8_t* dp = scaled.data() + (static_cast<size_t>(y) * targetW + x) * 4u;
      dp[0] = sp[0];
      dp[1] = sp[1];
      dp[2] = sp[2];
      dp[3] = sp[3];
    }
  }
  blitRgba(dst, dstW, dstH, scaled.data(), targetW, targetH, dstX, dstY, opacity);
}

std::string resolveAssetPath(const std::string& src) {
  if (src.empty()) return {};
  if (src.rfind("http://", 0) == 0 || src.rfind("https://", 0) == 0) return src;
  if (src.rfind("/uploads/", 0) == 0) {
    const std::string base = envOr("PLAYOUT_UPLOADS_DIR", "");
    if (!base.empty()) return base + src.substr(std::string("/uploads").size());
  }
  if (src.front() == '/') {
    const std::string base = envOr("PLAYOUT_UPLOADS_DIR", "");
    if (!base.empty()) return base + src;
  }
  return src;
}

bool loadImageFile(const std::string& path, DecodedImage& out) {
#ifdef PLAYOUT_HAS_PNG
  FILE* fp = std::fopen(path.c_str(), "rb");
  if (!fp) return false;

  png_structp png = png_create_read_struct(PNG_LIBPNG_VER_STRING, nullptr, nullptr, nullptr);
  png_infop info = png_create_info_struct(png);
  if (!png || !info) {
    std::fclose(fp);
    return false;
  }
  if (setjmp(png_jmpbuf(png))) {
    png_destroy_read_struct(&png, &info, nullptr);
    std::fclose(fp);
    return false;
  }

  png_init_io(png, fp);
  png_read_info(png, info);
  const int width = png_get_image_width(png, info);
  const int height = png_get_image_height(png, info);
  png_set_expand(png);
  png_set_strip_16(png);
  png_set_gray_to_rgb(png);
  png_set_add_alpha(png, 0xff, PNG_FILLER_AFTER);
  png_read_update_info(png, info);

  out.width = width;
  out.height = height;
  out.rgba.assign(static_cast<size_t>(width) * static_cast<size_t>(height) * 4u, 0);
  std::vector<uint8_t> row(static_cast<size_t>(png_get_rowbytes(png, info)));
  for (int y = 0; y < height; ++y) {
    png_read_row(png, row.data(), nullptr);
    std::memcpy(out.rgba.data() + static_cast<size_t>(y) * static_cast<size_t>(width) * 4u, row.data(), row.size());
  }

  png_destroy_read_struct(&png, &info, nullptr);
  std::fclose(fp);
  return true;
#else
  (void)path;
  (void)out;
  return false;
#endif
}

} // namespace playoutd
