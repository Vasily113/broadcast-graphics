#!/usr/bin/env bash
set -uo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"

BACKEND_PORT="${BACKEND_PORT:-4001}"
FRONTEND_PORT="${FRONTEND_PORT:-4000}"
FRONTEND_HOST="${FRONTEND_HOST:-0.0.0.0}"

PIDS=()

port_pids() {
  local port="$1"
  ss -ltnp 2>/dev/null | grep ":${port} " | grep -oP 'pid=\K[0-9]+' | sort -u || true
}

port_in_use() {
  [[ -n "$(port_pids "$1")" ]]
}

ensure_port_free() {
  local port="$1" label="$2"
  if ! port_in_use "$port"; then
    return 0
  fi
  local pids
  pids="$(port_pids "$port" | tr '\n' ' ')"
  echo "ERROR: Port ${port} (${label}) is already in use by PID(s): ${pids}"
  echo "       Stop old processes: ./stop.sh"
  echo "       Or auto-stop before start: STOP_STALE=1 ./start.sh"
  exit 1
}

wait_for_port() {
  local port="$1" label="$2" tries="${3:-50}"
  local i
  for ((i = 1; i <= tries; i++)); do
    if port_in_use "$port"; then
      return 0
    fi
    sleep 0.2
  done
  echo "ERROR: ${label} did not start listening on port ${port}."
  return 1
}

cleanup() {
  local pid
  for pid in "${PIDS[@]:-}"; do
    if kill -0 "$pid" >/dev/null 2>&1; then
      kill "$pid" >/dev/null 2>&1 || true
    fi
  done
  wait 2>/dev/null || true
}

trap cleanup EXIT INT TERM

echo "Starting broadcast-graphics (Ubuntu)"
echo "Root: $ROOT_DIR"
echo "Backend:  http://localhost:$BACKEND_PORT"
echo "Frontend: http://localhost:$FRONTEND_PORT"
echo

if [[ ! -d "$BACKEND_DIR/node_modules" ]]; then
  echo "Backend dependencies not installed. Run: (cd backend && npm install)"
  exit 1
fi
if [[ ! -d "$FRONTEND_DIR/node_modules" ]]; then
  echo "Frontend dependencies not installed. Run: (cd frontend && npm install)"
  exit 1
fi

if [[ "${STOP_STALE:-0}" == "1" ]]; then
  "$ROOT_DIR/stop.sh" || true
fi

ensure_port_free "$BACKEND_PORT" "backend"
ensure_port_free "$FRONTEND_PORT" "frontend"

(
  cd "$BACKEND_DIR"
  export PORT="$BACKEND_PORT"
  exec npm start
) &
PIDS+=("$!")

if ! wait_for_port "$BACKEND_PORT" "Backend"; then
  exit 1
fi
echo "Backend is up on port $BACKEND_PORT"

(
  cd "$FRONTEND_DIR"
  export BACKEND_PORT="$BACKEND_PORT"
  exec npm run dev -- --host "$FRONTEND_HOST" --port "$FRONTEND_PORT" --strictPort
) &
PIDS+=("$!")

if ! wait_for_port "$FRONTEND_PORT" "Frontend"; then
  echo "Check frontend logs above for errors (missing deps, port conflict, etc.)."
  exit 1
fi
echo "Frontend is up on port $FRONTEND_PORT"

echo
echo "Running. Press Ctrl+C to stop."
echo "Open: http://localhost:$FRONTEND_PORT/templates"

wait
