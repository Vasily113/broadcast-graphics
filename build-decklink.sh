#!/usr/bin/env bash
set -euo pipefail

DECKLINK_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/decklink-out" && pwd)"

echo "Building DeckLink native addon for Electron 28..."

if ! python3 -c "import distutils" 2>/dev/null; then
  echo "ERROR: Python distutils missing (required by node-gyp)."
  echo "Install: sudo apt install python3-setuptools"
  exit 1
fi

cd "$DECKLINK_DIR"

# node-gyp cannot compile sources whose path contains spaces — use bmd-sdk/ wrapper
BMD_SDK="$DECKLINK_DIR/addon/bmd-sdk"
if [[ ! -f "$BMD_SDK/DeckLinkAPIDispatch.cpp" ]]; then
  mkdir -p "$BMD_SDK"
  cp "$DECKLINK_DIR/../../Blackmagic DeckLink SDK 16.0/Linux/include/DeckLinkAPIDispatch.cpp" \
     "$BMD_SDK/DeckLinkAPIDispatch.cpp"
fi
if [[ ! -e "$BMD_SDK/include" ]]; then
  ln -sfn "../../../Blackmagic DeckLink SDK 16.0/Linux/include" "$BMD_SDK/include"
fi

if [[ ! -d node_modules ]]; then
  echo "Installing decklink-out dependencies..."
  npm install
fi

npm run build-addon

if [[ -f "$DECKLINK_DIR/addon/build/Release/decklink.node" ]]; then
  echo "OK: $DECKLINK_DIR/addon/build/Release/decklink.node"
else
  echo "ERROR: build failed — decklink.node not found"
  exit 1
fi
