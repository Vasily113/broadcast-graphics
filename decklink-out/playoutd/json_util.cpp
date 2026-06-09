#include "json_util.h"
#include "utf8_util.h"

#include <cctype>
#include <cstdlib>

namespace playoutd::json {
namespace {

int hexVal(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return -1;
}

void skipWs(const std::string& s, size_t& i) {
  while (i < s.size() && std::isspace(static_cast<unsigned char>(s[i]))) ++i;
}

} // namespace

std::optional<size_t> matchValueStart(const std::string& s, size_t from, const char* key) {
  const std::string needle = std::string("\"") + key + "\"";
  size_t pos = s.find(needle, from);
  if (pos == std::string::npos) return std::nullopt;
  pos = s.find(':', pos);
  if (pos == std::string::npos) return std::nullopt;
  ++pos;
  skipWs(s, pos);
  return pos;
}

std::optional<std::string> sliceBalanced(const std::string& s, size_t start, char open, char close) {
  if (start >= s.size() || s[start] != open) return std::nullopt;
  int depth = 0;
  bool inStr = false;
  for (size_t i = start; i < s.size(); ++i) {
    const char c = s[i];
    if (c == '"' && (i == 0 || s[i - 1] != '\\')) inStr = !inStr;
    if (inStr) continue;
    if (c == open) ++depth;
    else if (c == close) {
      --depth;
      if (depth == 0) return s.substr(start, i - start + 1);
    }
  }
  return std::nullopt;
}

std::string unescapeString(const std::string& quoted) {
  if (quoted.size() < 2 || quoted.front() != '"' || quoted.back() != '"') return quoted;
  std::string out;
  out.reserve(quoted.size());
  for (size_t i = 1; i + 1 < quoted.size(); ++i) {
    if (quoted[i] == '\\' && i + 1 < quoted.size()) {
      const char e = quoted[++i];
      if (e == 'u' && i + 4 <= quoted.size()) {
        uint32_t cp = 0;
        bool ok = true;
        for (int k = 0; k < 4; ++k) {
          const int hv = hexVal(quoted[i + 1 + static_cast<size_t>(k)]);
          if (hv < 0) { ok = false; break; }
          cp = (cp << 4) | static_cast<uint32_t>(hv);
        }
        if (ok) {
          i += 4;
          utf8::appendCodepoint(out, cp);
          continue;
        }
      }
      if (e == 'n') out.push_back('\n');
      else if (e == 'r') out.push_back('\r');
      else if (e == 't') out.push_back('\t');
      else out.push_back(e);
    } else {
      out.push_back(quoted[i]);
    }
  }
  return out;
}

std::optional<std::string> extractObject(const std::string& json, const char* key) {
  const auto pos = matchValueStart(json, 0, key);
  if (!pos) return std::nullopt;
  return sliceBalanced(json, *pos, '{', '}');
}

std::optional<std::string> extractArray(const std::string& json, const char* key) {
  const auto pos = matchValueStart(json, 0, key);
  if (!pos) return std::nullopt;
  return sliceBalanced(json, *pos, '[', ']');
}

std::optional<std::string> stringField(const std::string& obj, const char* key) {
  const auto pos = matchValueStart(obj, 0, key);
  if (!pos || *pos >= obj.size() || obj[*pos] != '"') return std::nullopt;
  size_t i = *pos + 1;
  std::string raw;
  raw.push_back('"');
  while (i < obj.size()) {
    const char c = obj[i];
    if (c == '"' && obj[i - 1] != '\\') {
      raw.push_back('"');
      return unescapeString(raw);
    }
    raw.push_back(c);
    ++i;
  }
  return std::nullopt;
}

std::optional<double> numberField(const std::string& obj, const char* key) {
  const auto pos = matchValueStart(obj, 0, key);
  if (!pos) return std::nullopt;
  char* end = nullptr;
  const double v = std::strtod(obj.c_str() + *pos, &end);
  if (end == obj.c_str() + *pos) return std::nullopt;
  return v;
}

std::optional<bool> boolField(const std::string& obj, const char* key) {
  const auto pos = matchValueStart(obj, 0, key);
  if (!pos) return std::nullopt;
  if (obj.compare(*pos, 4, "true") == 0) return true;
  if (obj.compare(*pos, 5, "false") == 0) return false;
  return std::nullopt;
}

std::vector<std::string> splitTopLevelObjects(const std::string& arrayBody) {
  std::vector<std::string> out;
  if (arrayBody.size() < 2 || arrayBody.front() != '[') return out;
  size_t i = 1;
  skipWs(arrayBody, i);
  while (i < arrayBody.size() && arrayBody[i] != ']') {
    skipWs(arrayBody, i);
    if (arrayBody[i] == ',') { ++i; skipWs(arrayBody, i); }
    if (arrayBody[i] == ']') break;
    if (arrayBody[i] == '{') {
      if (auto obj = sliceBalanced(arrayBody, i, '{', '}')) {
        out.push_back(*obj);
        i += obj->size();
      } else break;
    } else ++i;
    skipWs(arrayBody, i);
  }
  return out;
}

std::optional<std::string> parseObjectKeyAt(const std::string& obj, size_t& i) {
  if (i >= obj.size() || obj[i] != '"') return std::nullopt;
  size_t keyEnd = i + 1;
  while (keyEnd < obj.size()) {
    if (obj[keyEnd] == '"' && obj[keyEnd - 1] != '\\') break;
    ++keyEnd;
  }
  if (keyEnd >= obj.size()) return std::nullopt;
  const std::string key = unescapeString(obj.substr(i, keyEnd - i + 1));
  i = keyEnd + 1;
  return key;
}

} // namespace playoutd::json
