#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
TARGET="${1:-all}"

if [[ "$TARGET" == "runner" ]]; then
  docker-compose -f "$ROOT_DIR/task-runner/docker-compose.local.yml" logs -f
  exit 0
fi

echo "[Phase8] Tailing task-runner logs (Ctrl+C to stop)"
docker-compose -f "$ROOT_DIR/task-runner/docker-compose.local.yml" logs -f
