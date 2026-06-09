#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
DECKLINK_DIR="$ROOT_DIR/decklink-out"
BACKEND_URL="${BACKEND_URL:-http://localhost:3001}"
DECKLINK_PIPELINE="${DECKLINK_PIPELINE:-legacy}"
# Native-channel default: spread RGBA->BGRA conversion across CPU cores.
DECKLINK_CONVERT_THREADS="${DECKLINK_CONVERT_THREADS:-16}"

ADDON_PATH="$DECKLINK_DIR/addon/build/Release/decklink.node"
CHANNELD_BIN="$DECKLINK_DIR/channeld/decklink-channeld"
PLAYOUTD_BIN="$DECKLINK_DIR/playoutd/playoutd"
PROFILE_RESTART_DELAY="${PROFILE_RESTART_DELAY:-6}"
CHANNEL_START_STAGGER="${CHANNEL_START_STAGGER:-10}"
# 0 = hardware egl-angle (recommended with NVIDIA). Set to 1 only for headless/software fallback.
ELECTRON_USE_SOFTWARE_GL="${ELECTRON_USE_SOFTWARE_GL:-0}"

# Optional override: comma-separated channel UUIDs (ignores API discovery)
# Example: DECKLINK_CHANNEL_IDS=uuid1,uuid2 ./start-decklink.sh
declare -a CHANNEL_IDS=()
declare -a CHANNEL_LABELS=()
declare -a CHANNEL_PIDS=()
STOPPING=0

cleanup() {
  trap - EXIT INT TERM
  if [[ "$STOPPING" == "1" ]]; then
    return 0
  fi
  STOPPING=1
  local pid
  if [[ ${#CHANNEL_PIDS[@]} -gt 0 ]]; then
    echo
    echo "Stopping DeckLink output processes..."
    for pid in "${CHANNEL_PIDS[@]}"; do
      if kill -0 "$pid" >/dev/null 2>&1; then
        # Negative PID targets the process group so Electron receives SIGTERM,
        # not only the wrapper subshell.
        kill -TERM "-$pid" >/dev/null 2>&1 || kill -TERM "$pid" >/dev/null 2>&1 || true
      fi
    done
    wait "${CHANNEL_PIDS[@]}" 2>/dev/null || true
  fi
  exit 0
}

trap cleanup EXIT INT TERM

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
if [[ "$DECKLINK_PIPELINE" != "native-playout" ]]; then
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
fi

if [[ "$DECKLINK_PIPELINE" == "native-playout" ]]; then
  if [[ ! -x "$CHANNELD_BIN" ]]; then
    echo "decklink-channeld (unified) not built. Run: cd decklink-out && npm run build-channeld"
    exit 1
  fi
elif [[ "$DECKLINK_PIPELINE" == "native-playout-legacy" ]]; then
  if [[ ! -x "$PLAYOUTD_BIN" ]]; then
    echo "playoutd not built. Run: cd decklink-out && npm run build-playoutd"
    exit 1
  fi
fi

if [[ "$DECKLINK_PIPELINE" != "native-playout" && ! -f "$ADDON_PATH" ]]; then
  echo "DeckLink addon not built. Run: ./build-decklink.sh"
  exit 1
fi

if ! ldconfig -p 2>/dev/null | grep -q libDeckLinkAPI.so; then
  echo "WARNING: libDeckLinkAPI.so not found in ldconfig."
  echo "         Install Blackmagic Desktop Video for Linux."
fi

if [[ "$DECKLINK_PIPELINE" != "native-playout" && -z "${DISPLAY:-}" && -z "${WAYLAND_DISPLAY:-}" ]]; then
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
  local device_index="${3:-0}"
  local display_mode="${4:-HD1080i50}"
  local keyer_mode="${5:-external}"
  local shm_name=""
  echo "[$label] Starting DeckLink output (CHANNEL_ID=$channel_id)"
  if [[ "$DECKLINK_PIPELINE" == "native-channel" || "$DECKLINK_PIPELINE" == "native-playout" || "$DECKLINK_PIPELINE" == "native-playout-legacy" ]]; then
    if [[ ! -x "$CHANNELD_BIN" ]]; then
      echo "[$label] decklink-channeld not built. Run: cd decklink-out && npm run build-channeld"
      return 1
    fi
    local shm_name
    shm_name="$(node -e '
      const id = process.argv[1] || "default";
      let n = "bgv13_";
      for (const c of id) {
        if (/[a-zA-Z0-9]/.test(c)) n += c;
        else if (c === "-" || c === "_") n += "_";
      }
      if (n.length <= 6) n += "default";
      process.stdout.write(n);
    ' "$channel_id")"
    if [[ "$DECKLINK_PIPELINE" == "native-playout" ]]; then
      local playout_sock="/tmp/bgv13_playout_$(node -e '
        const id = process.argv[1] || "default";
        let n = "";
        for (const c of id) {
          if (/[a-zA-Z0-9]/.test(c)) n += c;
          else if (c === "-" || c === "_") n += "_";
        }
        if (n.length === 0) n = "default";
        process.stdout.write(n);
      ' "$channel_id").sock"
      setsid bash -c '
        set -euo pipefail
        label="$1"
        channeld_bin="$2"
        channel_id="$3"
        device_index="$4"
        display_mode="$5"
        keyer_mode="$6"
        sync_pref="$7"
        control_sock="$8"
        export DECKLINK_INTEGRATED_PLAYOUT=1
        export DECKLINK_CHANNEL_ID="$channel_id"
        export DECKLINK_DEVICE_INDEX="$device_index"
        export DECKLINK_DISPLAY_MODE="$display_mode"
        export DECKLINK_KEYER_MODE="$keyer_mode"
        export DECKLINK_SYNC_PREFERENCE="$sync_pref"
        export PLAYOUT_CONTROL_SOCKET="$control_sock"
        export PLAYOUT_UPLOADS_DIR="$9"
        export PLAYOUT_FONTS_DIR="${10}"
        echo "[$label] Unified playout+output (hardware schedule) control=$control_sock"
        "$channeld_bin"
      ' _ "$label" "$CHANNELD_BIN" "$channel_id" "$device_index" "$display_mode" "$keyer_mode" "${DECKLINK_SYNC_PREFERENCE:-external_first}" "$playout_sock" "$ROOT_DIR/data/uploads" "$ROOT_DIR/fonts" &
      CHANNEL_PIDS+=("$!")
      (
        sleep 3
        replay_resp="$(curl -sf -X POST "${BACKEND_URL}/api/control/replay/${channel_id}" 2>/dev/null || true)"
        if [[ -n "$replay_resp" ]]; then
          echo "[$label] playout replay: $replay_resp"
        fi
      ) &
      return 0
    fi
    setsid bash -c '
      set -euo pipefail
      label="$1"
      channeld_bin="$2"
      channel_id="$3"
      shm_name="$4"
      device_index="$5"
      display_mode="$6"
      keyer_mode="$7"
      sync_pref="$8"
      export DECKLINK_CHANNEL_ID="$channel_id"
      export DECKLINK_SHM_NAME="$shm_name"
      export DECKLINK_DEVICE_INDEX="$device_index"
      export DECKLINK_DISPLAY_MODE="$display_mode"
      export DECKLINK_KEYER_MODE="$keyer_mode"
      export DECKLINK_SYNC_PREFERENCE="$sync_pref"
      export DECKLINK_CONVERT_THREADS="$9"
      "$channeld_bin"
    ' _ "$label" "$CHANNELD_BIN" "$channel_id" "$shm_name" "$device_index" "$display_mode" "$keyer_mode" "${DECKLINK_SYNC_PREFERENCE:-external_first}" "$DECKLINK_CONVERT_THREADS" &
    CHANNEL_PIDS+=("$!")
    sleep 2
  fi
  if [[ "$DECKLINK_PIPELINE" == "native-playout-legacy" ]]; then
    local playout_sock="/tmp/bgv13_playout_$(node -e '
      const id = process.argv[1] || "default";
      let n = "";
      for (const c of id) {
        if (/[a-zA-Z0-9]/.test(c)) n += c;
        else if (c === "-" || c === "_") n += "_";
      }
      if (n.length === 0) n = "default";
      process.stdout.write(n);
    ' "$channel_id").sock"
    setsid bash -c '
      set -euo pipefail
      label="$1"
      playoutd_bin="$2"
      channel_id="$3"
      shm_name="$4"
      display_mode="$5"
      control_sock="$6"
      export DECKLINK_CHANNEL_ID="$channel_id"
      export DECKLINK_SHM_NAME="$shm_name"
      export DECKLINK_DISPLAY_MODE="$display_mode"
      export PLAYOUT_CONTROL_SOCKET="$control_sock"
      export PLAYOUT_UPLOADS_DIR="$7"
      export PLAYOUT_FONTS_DIR="$8"
      echo "[$label] Native playoutd (no Electron) control=$control_sock uploads=$PLAYOUT_UPLOADS_DIR fonts=$PLAYOUT_FONTS_DIR"
      "$playoutd_bin"
    ' _ "$label" "$PLAYOUTD_BIN" "$channel_id" "$shm_name" "$display_mode" "$playout_sock" "$ROOT_DIR/data/uploads" "$ROOT_DIR/fonts" &
    CHANNEL_PIDS+=("$!")
    (
      sleep 1
      replay_resp="$(curl -sf -X POST "${BACKEND_URL}/api/control/replay/${channel_id}" 2>/dev/null || true)"
      if [[ -n "$replay_resp" ]]; then
        echo "[$label] playout replay: $replay_resp"
      fi
    ) &
    return 0
  fi
  setsid bash -c '
    set -euo pipefail
    label="$1"
    decklink_dir="$2"
    electron_bin="$3"
    channel_id="$4"
    backend_url="$5"
    software_gl="$6"
    restart_delay="$7"
    native_producer="$8"
    shm_name="$9"
    cd "$decklink_dir"
    export CHANNEL_ID="$channel_id"
    export BACKEND_URL="$backend_url"
    export ELECTRON_USE_SOFTWARE_GL="$software_gl"
    if [[ "$native_producer" == "1" ]]; then
      export DECKLINK_NATIVE_PRODUCER=1
      export DECKLINK_SHM_NAME="$shm_name"
    fi
    while true; do
      "$electron_bin" . --no-sandbox
      local code=$?
      if [[ "$code" == "42" ]]; then
        echo "[$label] Profile switched — restarting in ${restart_delay}s..."
        sleep "$restart_delay"
        continue
      fi
      break
    done
  ' _ "$label" "$DECKLINK_DIR" "$ELECTRON_BIN" "$channel_id" "$BACKEND_URL" "$ELECTRON_USE_SOFTWARE_GL" "$PROFILE_RESTART_DELAY" \
    "$([[ "$DECKLINK_PIPELINE" == "native-channel" ]] && echo 1 || echo 0)" \
    "${shm_name}" &
  CHANNEL_PIDS+=("$!")
}

channel_runtime_settings() {
  local channel_id="$1"
  local json
  json="$(curl -sf "${BACKEND_URL}/api/channels/${channel_id}" 2>/dev/null || true)"
  if [[ -z "$json" ]]; then
    echo "0 HD1080i50 external"
    return 0
  fi
  node -e '
    const ch = JSON.parse(process.argv[1]);
    const idx = Number.isFinite(ch.device_index) ? ch.device_index : 0;
    const mode = ch.display_mode || "HD1080i50";
    const keyer = ch.keyer_mode || "external";
    process.stdout.write(`${idx} ${mode} ${keyer}`);
  ' "$json" 2>/dev/null || echo "0 HD1080i50 external"
}

if [[ "$DECKLINK_PIPELINE" == "native-playout" || "$DECKLINK_PIPELINE" == "native-playout-legacy" || "$DECKLINK_PIPELINE" == "native-channel" ]]; then
  "$ROOT_DIR/stop-decklink.sh" || true
fi

if [[ "$DECKLINK_PIPELINE" == "native-playout" ]]; then
  echo "Starting DeckLink channels (pipeline=native-playout: unified channeld, hardware schedule, no Electron)..."
else
  echo "Starting DeckLink channels (pipeline=$DECKLINK_PIPELINE, electron: $ELECTRON_BIN)..."
fi
for i in "${!CHANNEL_IDS[@]}"; do
  read -r device_index display_mode keyer_mode <<<"$(channel_runtime_settings "${CHANNEL_IDS[$i]}")"
  run_channel "${CHANNEL_IDS[$i]}" "${CHANNEL_LABELS[$i]:-Ch$((i + 1))}" "$device_index" "$display_mode" "$keyer_mode"
  # Stagger starts so profile switch (2dfd) on earlier channels finishes before the next opens
  if (( i + 1 < ${#CHANNEL_IDS[@]} )); then
    sleep "$CHANNEL_START_STAGGER"
  fi
done

echo "DeckLink output processes started in background (${#CHANNEL_IDS[@]} channel(s))."
echo "Ensure ./start.sh is running and press TAKE in Control Panel."
echo "After changing SDI sub-device in Settings, restart: ./start-decklink.sh"

wait
