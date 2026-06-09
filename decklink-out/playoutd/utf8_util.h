#pragma once

#include <cstdint>
#include <string>

namespace playoutd::utf8 {

/** Decode next UTF-8 codepoint; advances *index. Returns false at end. */
bool nextCodepoint(const std::string& s, size_t& index, uint32_t& codepoint);

void appendCodepoint(std::string& out, uint32_t codepoint);

} // namespace playoutd::utf8
