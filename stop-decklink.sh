#!/usr/bin/env bash
# Release DeckLink SDI output (kill channeld / playoutd / Electron decklink-out holders).
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
DECKLINK_DIR="$ROOT_DIR/decklink-out"
CHANNELD_BIN="$DECKLINK_DIR/channeld/decklink-channeld"
PLAYOUTD_BIN="$DECKLINK_DIR/playoutd/playoutd"
DEVICE_INDEX="${DECKLINK_DEVICE_INDEX:-0}"

kill_bin() {
  local bin="$1"
  local sig="$2"
  [[ -x "$bin" ]] || return 0
  local pids
  pids="$(pgrep -x "$(basename "$bin")" 2>/dev/null || true)"
  if [[ -z "$pids" ]]; then
    return 0
  fi
  while read -r pid; do
    [[ -n "$pid" ]] || continue
    if [[ "$(readlink -f "/proc/${pid}/exe" 2>/dev/null || true)" == "$(readlink -f "$bin" 2>/dev/null || true)" ]]; then
      echo "  ${sig}: $(basename "$bin") pid=$pid"
      kill "-${sig}" "$pid" >/dev/null 2>&1 || true
    fi
  done <<< "$pids"
}

echo "Stopping DeckLink holders..."

kill_bin "$CHANNELD_BIN" TERM
kill_bin "$PLAYOUTD_BIN" TERM

while read -r pid; do
  [[ -n "$pid" ]] || continue
  if readlink "/proc/${pid}/cwd" 2>/dev/null | grep -q 'decklink-out'; then
    echo "  SIGTERM electron pid=$pid (decklink-out)"
    kill -TERM "$pid" >/dev/null 2>&1 || true
  fi
done < <(pgrep -x electron 2>/dev/null || true)

for _ in 1 2 3 4 5 6 7 8 9 10; do
  if ! pgrep -x "$(basename "$CHANNELD_BIN")" >/dev/null 2>&1 && \
     ! pgrep -x "$(basename "$PLAYOUTD_BIN")" >/dev/null 2>&1; then
    break
  fi
  sleep 0.3
done

kill_bin "$CHANNELD_BIN" KILL
kill_bin "$PLAYOUTD_BIN" KILL

dev="/dev/blackmagic/io${DEVICE_INDEX}"
if [[ -e "$dev" ]] && command -v fuser >/dev/null 2>&1; then
  holders="$(fuser "$dev" 2>/dev/null || true)"
  if [[ -n "$holders" ]]; then
    echo "  fuser -k $dev (PIDs: $holders)"
    fuser -k -TERM "$dev" >/dev/null 2>&1 || true
    sleep 1
    fuser -k -KILL "$dev" >/dev/null 2>&1 || true
  fi
fi

sleep 0.5
if pgrep -x "$(basename "$CHANNELD_BIN")" >/dev/null 2>&1; then
  echo "WARNING: $(basename "$CHANNELD_BIN") still running:"
  pgrep -af "$(basename "$CHANNELD_BIN")" 2>/dev/null || true
else
  echo "DeckLink holders stopped."
fi
