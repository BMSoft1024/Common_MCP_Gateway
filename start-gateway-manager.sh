#!/usr/bin/env bash
# Starts the Common MCP Gateway Manager (backend :1525 + frontend :5173) on Linux/macOS/Git Bash.
# Usage: ./start-gateway-manager.sh [--no-open]   (Ctrl+C stops both services)
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT/gateway-manager/backend"
FRONTEND_DIR="$ROOT/gateway-manager/frontend"
OPEN_BROWSER=1
[ "${1:-}" = "--no-open" ] && OPEN_BROWSER=0

echo "Starting Common MCP Gateway Manager..."

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Error: Node.js 18+ and npm are required." >&2
  exit 1
fi

for dir in "$BACKEND_DIR" "$FRONTEND_DIR"; do
  if [ ! -d "$dir/node_modules" ]; then
    echo "Installing dependencies in ${dir#"$ROOT"/} ..."
    (cd "$dir" && npm install --no-audit --no-fund) || { echo "npm install failed in $dir" >&2; exit 1; }
  fi
done

PIDS=()
cleanup() {
  trap - INT TERM EXIT
  echo
  echo "Stopping services..."
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null
  done
  wait 2>/dev/null
  echo "Done!"
}
trap cleanup INT TERM EXIT

echo "[1/2] Starting backend (port 1525)..."
(cd "$BACKEND_DIR" && exec npm run dev) &
PIDS+=($!)

# Wait until the backend answers before starting the frontend (max ~30 s).
for _ in $(seq 1 30); do
  if command -v curl >/dev/null 2>&1 && curl -fs http://127.0.0.1:1525/api/status >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

echo "[2/2] Starting frontend (port 5173)..."
(cd "$FRONTEND_DIR" && exec npm run dev) &
PIDS+=($!)

echo
echo "==================================="
echo "Common MCP Gateway Manager started"
echo "==================================="
echo "Backend:  http://127.0.0.1:1525"
echo "Frontend: http://localhost:5173"
echo "Press Ctrl+C to stop."
echo

if [ "$OPEN_BROWSER" = "1" ]; then
  sleep 3
  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open http://localhost:5173 >/dev/null 2>&1 &
  elif command -v open >/dev/null 2>&1; then
    open http://localhost:5173 >/dev/null 2>&1 &
  elif command -v cmd.exe >/dev/null 2>&1; then
    cmd.exe /c start http://localhost:5173 >/dev/null 2>&1 &
  fi
fi

wait
