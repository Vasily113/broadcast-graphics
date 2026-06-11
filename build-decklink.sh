#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
DECKLINK_DIR="$REPO_ROOT/decklink-out"

echo "Building DeckLink native addon for Electron 28..."

if ! python3 -c "import distutils" 2>/dev/null; then
  echo "ERROR: Python distutils missing (required by node-gyp)."
  echo "Install: sudo apt install python3-setuptools"
  exit 1
fi

bash "$DECKLINK_DIR/addon/prepare-bmd-sdk.sh"

cd "$DECKLINK_DIR"

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
