#include "font_registry.h"
#include "json_util.h"

#include <algorithm>
#include <cctype>
#include <cstdlib>
#include <fstream>
#include <iostream>
#include <string>
#include <vector>

namespace playoutd {
namespace {

struct FontEntry {
  std::string id;
  std::string family;
  std::string regular;
  std::string bold;
};

std::string g_fontsDir;
std::vector<FontEntry> g_entries;

bool fileReadable(const std::string& path) {
  std::ifstream f(path, std::ios::binary);
  return f.good();
}

std::string trimLower(const std::string& s) {
  size_t a = 0;
  size_t b = s.size();
  while (a < b && std::isspace(static_cast<unsigned char>(s[a]))) ++a;
  while (b > a && std::isspace(static_cast<unsigned char>(s[b - 1]))) --b;
  std::string out = s.substr(a, b - a);
  for (char& c : out) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
  return out;
}

std::string joinPath(const std::string& dir, const std::string& file) {
  if (dir.empty()) return file;
  if (dir.back() == '/') return dir + file;
  return dir + "/" + file;
}

void loadManifest(const std::string& dir) {
  g_entries.clear();
  const std::string manifestPath = joinPath(dir, "manifest.json");
  std::ifstream in(manifestPath);
  if (!in.good()) {
    std::cerr << "[playoutd] font manifest not found: " << manifestPath << "\n";
    return;
  }
  std::string json((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
  auto entriesArr = playoutd::json::extractArray(json, "entries");
  if (!entriesArr) return;

  for (const std::string& obj : playoutd::json::splitTopLevelObjects(*entriesArr)) {
    FontEntry e;
    e.id = playoutd::json::stringField(obj, "id").value_or("");
    e.family = playoutd::json::stringField(obj, "family").value_or("");
    e.regular = playoutd::json::stringField(obj, "regular").value_or("");
    e.bold = playoutd::json::stringField(obj, "bold").value_or("");
    if (!e.id.empty() && !e.family.empty() && !e.regular.empty()) g_entries.push_back(std::move(e));
  }
  std::cout << "[playoutd] loaded " << g_entries.size() << " project font(s) from " << manifestPath << "\n";
}

const FontEntry* findByFamily(const std::string& family) {
  const std::string want = trimLower(family);
  if (want.empty()) return nullptr;
  for (const FontEntry& e : g_entries) {
    if (trimLower(e.family) == want) return &e;
  }
  return nullptr;
}

std::string systemFallback(bool bold) {
  static const char* kRegular[] = {
      "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
      "/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf",
      "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
      nullptr,
  };
  static const char* kBold[] = {
      "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
      "/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf",
      "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
      nullptr,
  };
  auto tryList = [](const char* const* list) -> std::string {
    for (size_t i = 0; list[i] != nullptr; ++i) {
      if (fileReadable(list[i])) return list[i];
    }
    return {};
  };
  std::string path = tryList(bold ? kBold : kRegular);
  if (path.empty()) path = tryList(bold ? kRegular : kBold);
  return path;
}

} // namespace

void initFontRegistry() {
  g_fontsDir.clear();
  g_entries.clear();
  if (const char* env = std::getenv("PLAYOUT_FONTS_DIR")) {
    if (*env) g_fontsDir = env;
  }
  if (g_fontsDir.empty()) return;
  loadManifest(g_fontsDir);
}

std::string fontPathForFamily(const std::string& fontFamily, const std::string& fontWeight) {
  (void)fontWeight;
  if (g_fontsDir.empty()) initFontRegistry();

  if (const FontEntry* e = findByFamily(fontFamily)) {
    const std::string reg = joinPath(g_fontsDir, e->regular);
    if (fileReadable(reg)) return reg;
  }

  const char* env = std::getenv("PLAYOUT_FONT_PATH");
  if (env && *env && fileReadable(env)) return env;

  return systemFallback(false);
}

} // namespace playoutd
