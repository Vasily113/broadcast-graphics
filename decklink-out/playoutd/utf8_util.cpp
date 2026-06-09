#include "utf8_util.h"

namespace playoutd::utf8 {

void appendCodepoint(std::string& out, uint32_t cp) {
  if (cp <= 0x7Fu) {
    out.push_back(static_cast<char>(cp));
  } else if (cp <= 0x7FFu) {
    out.push_back(static_cast<char>(0xC0u | (cp >> 6)));
    out.push_back(static_cast<char>(0x80u | (cp & 0x3Fu)));
  } else if (cp <= 0xFFFFu) {
    out.push_back(static_cast<char>(0xE0u | (cp >> 12)));
    out.push_back(static_cast<char>(0x80u | ((cp >> 6) & 0x3Fu)));
    out.push_back(static_cast<char>(0x80u | (cp & 0x3Fu)));
  } else if (cp <= 0x10FFFFu) {
    out.push_back(static_cast<char>(0xF0u | (cp >> 18)));
    out.push_back(static_cast<char>(0x80u | ((cp >> 12) & 0x3Fu)));
    out.push_back(static_cast<char>(0x80u | ((cp >> 6) & 0x3Fu)));
    out.push_back(static_cast<char>(0x80u | (cp & 0x3Fu)));
  }
}

bool nextCodepoint(const std::string& s, size_t& index, uint32_t& codepoint) {
  if (index >= s.size()) return false;
  const unsigned char c0 = static_cast<unsigned char>(s[index]);
  if (c0 < 0x80u) {
    codepoint = c0;
    ++index;
    return true;
  }
  if ((c0 & 0xE0u) == 0xC0u && index + 1 < s.size()) {
    const unsigned char c1 = static_cast<unsigned char>(s[index + 1]);
    if ((c1 & 0xC0u) == 0x80u) {
      codepoint = ((c0 & 0x1Fu) << 6) | (c1 & 0x3Fu);
      index += 2;
      return true;
    }
  }
  if ((c0 & 0xF0u) == 0xE0u && index + 2 < s.size()) {
    const unsigned char c1 = static_cast<unsigned char>(s[index + 1]);
    const unsigned char c2 = static_cast<unsigned char>(s[index + 2]);
    if ((c1 & 0xC0u) == 0x80u && (c2 & 0xC0u) == 0x80u) {
      codepoint = ((c0 & 0x0Fu) << 12) | ((c1 & 0x3Fu) << 6) | (c2 & 0x3Fu);
      index += 3;
      return true;
    }
  }
  if ((c0 & 0xF8u) == 0xF0u && index + 3 < s.size()) {
    const unsigned char c1 = static_cast<unsigned char>(s[index + 1]);
    const unsigned char c2 = static_cast<unsigned char>(s[index + 2]);
    const unsigned char c3 = static_cast<unsigned char>(s[index + 3]);
    if ((c1 & 0xC0u) == 0x80u && (c2 & 0xC0u) == 0x80u && (c3 & 0xC0u) == 0x80u) {
      codepoint = ((c0 & 0x07u) << 18) | ((c1 & 0x3Fu) << 12) | ((c2 & 0x3Fu) << 6) | (c3 & 0x3Fu);
      index += 4;
      return true;
    }
  }
  ++index;
  codepoint = 0xFFFDu;
  return true;
}

} // namespace playoutd::utf8
