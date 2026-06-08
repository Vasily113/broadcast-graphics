#!/usr/bin/env bash
set -euo pipefail

BACKEND_PORT="${BACKEND_PORT:-4001}"
FRONTEND_PORT="${FRONTEND_PORT:-4000}"

kill_port() {
  local port="$1"
  local pids
  pids="$(ss -ltnp 2>/dev/null | grep ":${port} " | grep -oP 'pid=\K[0-9]+' | sort -u || true)"
  if [[ -z "$pids" ]]; then
    echo "Port ${port}: nothing listening"
    return 0
  fi
  echo "Port ${port}: stopping PID(s) ${pids//[$'\n']/ }"
  while read -r pid; do
    [[ -n "$pid" ]] || continue
    kill "$pid" 2>/dev/null || true
  done <<< "$pids"
}

echo "Stopping broadcast-graphics..."
kill_port "$FRONTEND_PORT"
kill_port "$BACKEND_PORT"
sleep 0.5
echo "Done."
