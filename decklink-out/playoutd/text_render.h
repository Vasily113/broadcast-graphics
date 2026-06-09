#pragma once

#include "raster.h"
#include "template_model.h"

#include <string>

namespace playoutd {

std::string formatClockValue(const ClockLayer& layer);

/** Layout size in template space (may exceed layer box). */
int measureTextContentHeight(const TextLayer& layer, const std::string& text, int wrapWidth);
int measureTextContentWidth(const TextLayer& layer, const std::string& text, int wrapWidth);

void drawTextLayer(
    uint8_t* rgba,
    int width,
    int height,
    const TextLayer& layer,
    const std::string& text,
    bool localOrigin = false);

} // namespace playoutd
