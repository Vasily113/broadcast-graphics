#pragma once

#include "template_model.h"

#include <cstdint>
#include <string>
#include <unordered_map>

namespace playoutd {

/** Composite template into a BGRA8 framebuffer (DeckLink order). */
void renderTemplate(
    uint8_t* bgra,
    int outWidth,
    int outHeight,
    const TemplateModel& model,
    const std::unordered_map<std::string, std::string>& variables);

/** Drop cached layer rasters (call on take/clear). */
void clearLayerRasterCache();

} // namespace playoutd
