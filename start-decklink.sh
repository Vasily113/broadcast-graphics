#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
DECKLINK_DIR="$ROOT_DIR/decklink-out"
BACKEND_URL="${BACKEND_URL:-http://localhost:4001}"

ADDON_PATH="$DECKLINK_DIR/addon/build/Release/decklink.node"
PROFILE_RESTART_DELAY="${PROFILE_RESTART_DELAY:-6}"
CHANNEL_START_STAGGER="${CHANNEL_START_STAGGER:-10}"
# 0 = hardware egl-angle (recommended with NVIDIA). Set to 1 only for headless/software fallback.
ELECTRON_USE_SOFTWARE_GL="${ELECTRON_USE_SOFTWARE_GL:-0}"

# Optional override: comma-separated channel UUIDs (ignores API discovery)
# Example: DECKLINK_CHANNEL_IDS=uuid1,uuid2 ./start-decklink.sh
declare -a CHANNEL_IDS=()
declare -a CHANNEL_LABELS=()

resolve_electron_bin() {
  if [[ ! -d "$DECKLINK_DIR/node_modules/electron" ]]; then
    return 1
  fi
  local resolved
  resolved="$(cd "$DECKLINK_DIR" && node -p "require('electron')" 2>/dev/null || true)"
  if [[ -n "$resolved" && -x "$resolved" ]]; then
    echo "$resolved"
    return 0
  fi
  local candidate="$DECKLINK_DIR/node_modules/electron/dist/electron"
  if [[ -x "$candidate" ]]; then
    echo "$candidate"
    return 0
  fi
  return 1
}

# Fetch channels with SDI output (device_index >= 0) from backend API.
# Falls back to legacy Ch1/Ch2 UUIDs if backend is unavailable.
resolve_channels() {
  CHANNEL_IDS=()
  CHANNEL_LABELS=()

  if [[ -n "${DECKLINK_CHANNEL_IDS:-}" ]]; then
    IFS=',' read -ra CHANNEL_IDS <<< "${DECKLINK_CHANNEL_IDS}"
    local i
    for i in "${!CHANNEL_IDS[@]}"; do
      CHANNEL_IDS[$i]="$(echo "${CHANNEL_IDS[$i]}" | xargs)"
      CHANNEL_LABELS+=("Ch$((i + 1))")
    done
    echo "Using DECKLINK_CHANNEL_IDS override (${#CHANNEL_IDS[@]} channel(s))"
    return 0
  fi

  local json="" tries=0 max_tries=30
  while (( tries < max_tries )); do
    json="$(curl -sf "${BACKEND_URL}/api/channels" 2>/dev/null || true)"
    if [[ -n "$json" ]]; then
      break
    fi
    tries=$((tries + 1))
    if (( tries == 1 )); then
      echo "Waiting for backend at ${BACKEND_URL}..."
    fi
    sleep 1
  done

  if [[ -n "$json" ]]; then
    local parsed
    parsed="$(node -e '
      const channels = JSON.parse(process.argv[1]);
      channels
        .filter(c => typeof c.device_index === "number" && c.device_index >= 0)
        .sort((a, b) => (a.created_at || 0) - (b.created_at || 0))
        .forEach(c => console.log(c.id + "\t" + (c.name || c.id)));
    ' "$json" 2>/dev/null || true)"

    if [[ -n "$parsed" ]]; then
      while IFS=$'\t' read -r id name; do
        [[ -n "$id" ]] || continue
        CHANNEL_IDS+=("$id")
        CHANNEL_LABELS+=("$name")
      done <<< "$parsed"
      echo "Found ${#CHANNEL_IDS[@]} SDI channel(s) from backend"
      return 0
    fi
    echo "No channels with SDI output (device_index >= 0) in backend — using defaults"
  else
    echo "Backend unavailable — using default Ch1/Ch2 UUIDs"
  fi

  CHANNEL_IDS=(
    "${DECKLINK_CH1_ID:-399c6610-abd2-46f8-8da4-7c68dfb0aabf}"
    "${DECKLINK_CH2_ID:-83564e96-01a7-4750-af8a-3ebc124f6ec4}"
  )
  CHANNEL_LABELS=("Channel 1" "Channel 2")
}

ELECTRON_BIN=""
if ELECTRON_BIN="$(resolve_electron_bin)"; then
  :
else
  echo "Electron for Linux not found."
  if [[ -f "$DECKLINK_DIR/node_modules/electron/dist/electron.exe" ]]; then
    echo "Detected Windows Electron build (electron.exe). Reinstall for Linux:"
    echo "  cd decklink-out && rm -rf node_modules/electron && npm install"
  else
    echo "Run: cd decklink-out && npm install"
  fi
  exit 1
fi

if [[ ! -f "$ADDON_PATH" ]]; then
  echo "DeckLink addon not built. Run: ./build-decklink.sh"
  exit 1
fi

if ! ldconfig -p 2>/dev/null | grep -q libDeckLinkAPI.so; then
  echo "WARNING: libDeckLinkAPI.so not found in ldconfig."
  echo "         Install Blackmagic Desktop Video for Linux."
fi

if [[ -z "${DISPLAY:-}" && -z "${WAYLAND_DISPLAY:-}" ]]; then
  echo "WARNING: No DISPLAY/WAYLAND_DISPLAY — Electron offscreen may fail."
  echo "         Run from a desktop session or use xvfb-run."
fi

resolve_channels

if [[ ${#CHANNEL_IDS[@]} -eq 0 ]]; then
  echo "No DeckLink channels to start."
  echo "Assign an SDI sub-device in Settings (not «Нет») for each channel, then re-run."
  exit 0
fi

run_channel() {
  local channel_id="$1"
  local label="$2"
  echo "[$label] Starting DeckLink output (CHANNEL_ID=$channel_id)"
  (
    cd "$DECKLINK_DIR"
    export CHANNEL_ID="$channel_id"
    export BACKEND_URL="$BACKEND_URL"
    export ELECTRON_USE_SOFTWARE_GL="$ELECTRON_USE_SOFTWARE_GL"
    while true; do
      "$ELECTRON_BIN" . --no-sandbox
      local code=$?
      if [[ "$code" == "42" ]]; then
        echo "[$label] Profile switched — restarting in ${PROFILE_RESTART_DELAY}s..."
        sleep "$PROFILE_RESTART_DELAY"
        continue
      fi
      break
    done
  ) &
}

echo "Starting DeckLink channels (electron: $ELECTRON_BIN)..."
for i in "${!CHANNEL_IDS[@]}"; do
  run_channel "${CHANNEL_IDS[$i]}" "${CHANNEL_LABELS[$i]:-Ch$((i + 1))}"
  # Stagger starts so profile switch (2dfd) on earlier channels finishes before the next opens
  if (( i + 1 < ${#CHANNEL_IDS[@]} )); then
    sleep "$CHANNEL_START_STAGGER"
  fi
done

echo "DeckLink output processes started in background (${#CHANNEL_IDS[@]} channel(s))."
echo "Ensure ./start.sh is running and press TAKE in Control Panel."
echo "After changing SDI sub-device in Settings, restart: ./start-decklink.sh"

wait
