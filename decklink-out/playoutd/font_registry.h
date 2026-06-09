#pragma once

#include <string>

namespace playoutd {

// Load fonts/manifest.json from PLAYOUT_FONTS_DIR (or <repo>/fonts).
void initFontRegistry();

// Resolve template fontFamily + fontWeight to an absolute .ttf/.otf path.
std::string fontPathForFamily(const std::string& fontFamily, const std::string& fontWeight);

} // namespace playoutd
