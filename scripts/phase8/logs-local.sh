#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
TARGET="${1:-all}"

if [[ "$TARGET" == "n8n" ]]; then
  docker-compose -f "$ROOT_DIR/n8n/docker-compose.yml" logs -f
  exit 0
fi

if [[ "$TARGET" == "runner" ]]; then
  docker-compose -f "$ROOT_DIR/task-runner/docker-compose.local.yml" logs -f
  exit 0
fi

echo "[Phase8] Tailing n8n + task-runners logs (Ctrl+C to stop)"
docker-compose -f "$ROOT_DIR/n8n/docker-compose.yml" logs -f &
N8N_PID=$!
docker-compose -f "$ROOT_DIR/task-runner/docker-compose.local.yml" logs -f &
RUNNER_PID=$!

trap 'kill "$N8N_PID" "$RUNNER_PID" >/dev/null 2>&1 || true' EXIT
wait
