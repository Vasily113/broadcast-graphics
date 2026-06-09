#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PLAYOUT_DIR="$ROOT_DIR/../playoutd"
OUT_BIN="$ROOT_DIR/decklink-channeld"

CXXFLAGS=(
  -std=c++17
  -O2
  -Wall -Wextra
  -fopenmp
  -I"$ROOT_DIR"
  -I"$PLAYOUT_DIR"
  -I"$ROOT_DIR/../addon/include"
  -I"$ROOT_DIR/../addon/bmd-sdk/include"
)

LIBS=(-ldl -lpthread -lrt)
DEFS=()
SOURCES=(
  "$ROOT_DIR/main.cpp"
  "$ROOT_DIR/integrated_playout.cpp"
  "$ROOT_DIR/render_ahead.cpp"
  "$ROOT_DIR/shm_frame.cpp"
  "$ROOT_DIR/decklink_output.cpp"
  "$ROOT_DIR/../addon/bmd-sdk/DeckLinkAPIDispatch.cpp"
  "$PLAYOUT_DIR/protocol.cpp"
  "$PLAYOUT_DIR/render_format.cpp"
  "$PLAYOUT_DIR/json_util.cpp"
  "$PLAYOUT_DIR/utf8_util.cpp"
  "$PLAYOUT_DIR/template_parse.cpp"
  "$PLAYOUT_DIR/raster.cpp"
  "$PLAYOUT_DIR/font_registry.cpp"
  "$PLAYOUT_DIR/text_render.cpp"
  "$PLAYOUT_DIR/template_render.cpp"
  "$PLAYOUT_DIR/scene.cpp"
  "$PLAYOUT_DIR/scene_clock.cpp"
  "$PLAYOUT_DIR/slot_renderer.cpp"
  "$PLAYOUT_DIR/compositor.cpp"
  "$PLAYOUT_DIR/timeline_easing.cpp"
  "$PLAYOUT_DIR/timeline_bridge.cpp"
  "$PLAYOUT_DIR/timeline_native.cpp"
  "$PLAYOUT_DIR/control_server.cpp"
)

if pkg-config --exists libpng 2>/dev/null; then
  CXXFLAGS+=($(pkg-config --cflags libpng))
  LIBS+=($(pkg-config --libs libpng))
  DEFS+=(-DPLAYOUT_HAS_PNG)
else
  echo "WARNING: libpng not found — image layers disabled (install libpng-dev)"
fi

if pkg-config --exists freetype2 2>/dev/null; then
  CXXFLAGS+=($(pkg-config --cflags freetype2))
  LIBS+=($(pkg-config --libs freetype2))
  DEFS+=(-DPLAYOUT_HAS_FREETYPE)
else
  echo "WARNING: freetype2 not found — text will render as boxes (install libfreetype6-dev)"
fi

echo "Building $OUT_BIN (SHM + integrated playout) ..."
g++ \
  "${CXXFLAGS[@]}" \
  "${DEFS[@]}" \
  "${SOURCES[@]}" \
  "${LIBS[@]}" \
  -o "$OUT_BIN"

echo "Built: $OUT_BIN"
