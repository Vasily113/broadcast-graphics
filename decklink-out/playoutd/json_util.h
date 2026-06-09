#pragma once

#include <optional>
#include <string>
#include <vector>

namespace playoutd::json {

std::optional<size_t> matchValueStart(const std::string& s, size_t from, const char* key);
std::optional<std::string> sliceBalanced(const std::string& s, size_t start, char open, char close);
std::optional<std::string> extractObject(const std::string& json, const char* key);
std::optional<std::string> extractArray(const std::string& json, const char* key);
std::string unescapeString(const std::string& quoted);
std::optional<std::string> stringField(const std::string& obj, const char* key);
std::optional<double> numberField(const std::string& obj, const char* key);
std::optional<bool> boolField(const std::string& obj, const char* key);
std::vector<std::string> splitTopLevelObjects(const std::string& arrayBody);

/** i must point at the opening '"' of an object key; advances i past the closing quote. */
std::optional<std::string> parseObjectKeyAt(const std::string& obj, size_t& i);

} // namespace playoutd::json
