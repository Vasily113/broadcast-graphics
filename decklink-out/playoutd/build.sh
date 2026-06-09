#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
CHANNELD_DIR="$ROOT_DIR/../channeld"
OUT_BIN="$ROOT_DIR/playoutd"

CXXFLAGS=(
  -std=c++17
  -O2
  -Wall -Wextra
  -fopenmp
  -I"$CHANNELD_DIR"
)

LIBS=(-lpthread -lrt)
DEFS=()

if pkg-config --exists libpng 2>/dev/null; then
  CXXFLAGS+=($(pkg-config --cflags libpng))
  LIBS+=($(pkg-config --libs libpng))
  DEFS+=(-DPLAYOUT_HAS_PNG)
  echo "Using libpng"
else
  echo "WARNING: libpng not found — image layers disabled (install libpng-dev)"
fi

if pkg-config --exists freetype2 2>/dev/null; then
  CXXFLAGS+=($(pkg-config --cflags freetype2))
  LIBS+=($(pkg-config --libs freetype2))
  DEFS+=(-DPLAYOUT_HAS_FREETYPE)
  echo "Using freetype2"
else
  echo "WARNING: freetype2 not found — text will render as colored boxes (install libfreetype6-dev)"
fi

echo "Building $OUT_BIN ..."
g++ \
  "${CXXFLAGS[@]}" \
  "${DEFS[@]}" \
  "$ROOT_DIR/main.cpp" \
  "$ROOT_DIR/protocol.cpp" \
  "$ROOT_DIR/render_format.cpp" \
  "$ROOT_DIR/json_util.cpp" \
  "$ROOT_DIR/utf8_util.cpp" \
  "$ROOT_DIR/template_parse.cpp" \
  "$ROOT_DIR/raster.cpp" \
  "$ROOT_DIR/font_registry.cpp" \
  "$ROOT_DIR/text_render.cpp" \
  "$ROOT_DIR/template_render.cpp" \
  "$ROOT_DIR/scene.cpp" \
  "$ROOT_DIR/scene_clock.cpp" \
  "$ROOT_DIR/slot_renderer.cpp" \
  "$ROOT_DIR/compositor.cpp" \
  "$ROOT_DIR/timeline_easing.cpp" \
  "$ROOT_DIR/timeline_bridge.cpp" \
  "$ROOT_DIR/timeline_native.cpp" \
  "$ROOT_DIR/control_server.cpp" \
  "$CHANNELD_DIR/shm_frame.cpp" \
  "${LIBS[@]}" \
  -o "$OUT_BIN"

echo "Built: $OUT_BIN"
