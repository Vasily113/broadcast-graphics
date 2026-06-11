#!/usr/bin/env bash
set -euo pipefail

ADDON_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$ADDON_DIR/../.." && pwd)"

SDK_INCLUDE_DIR="${BMD_SDK_INCLUDE_DIR:-$REPO_ROOT/Blackmagic DeckLink SDK 16.0/Linux/include}"
WRAPPER_DIR="$ADDON_DIR/bmd-sdk"

if [[ ! -f "$SDK_INCLUDE_DIR/DeckLinkAPI.h" || ! -f "$SDK_INCLUDE_DIR/DeckLinkAPIDispatch.cpp" ]]; then
  echo "ERROR: Blackmagic DeckLink SDK headers not found."
  echo "Expected files:"
  echo "  $SDK_INCLUDE_DIR/DeckLinkAPI.h"
  echo "  $SDK_INCLUDE_DIR/DeckLinkAPIDispatch.cpp"
  echo
  echo "Put the SDK at:"
  echo "  $REPO_ROOT/Blackmagic DeckLink SDK 16.0"
  echo "or set BMD_SDK_INCLUDE_DIR to the SDK Linux/include directory."
  exit 1
fi

mkdir -p "$WRAPPER_DIR"

# node-gyp and g++ source lists are simpler without spaces in source paths.
cp "$SDK_INCLUDE_DIR/DeckLinkAPIDispatch.cpp" "$WRAPPER_DIR/DeckLinkAPIDispatch.cpp"

if [[ -L "$WRAPPER_DIR/include" || ! -e "$WRAPPER_DIR/include" || ! -d "$WRAPPER_DIR/include" ]]; then
  rm -f "$WRAPPER_DIR/include"
  ln -sfn "$SDK_INCLUDE_DIR" "$WRAPPER_DIR/include"
elif [[ ! -f "$WRAPPER_DIR/include/DeckLinkAPI.h" ]]; then
  echo "ERROR: $WRAPPER_DIR/include exists but does not contain DeckLinkAPI.h"
  echo "Remove it or set BMD_SDK_INCLUDE_DIR to a valid SDK include directory."
  exit 1
fi

echo "Prepared DeckLink SDK wrapper: $WRAPPER_DIR"
