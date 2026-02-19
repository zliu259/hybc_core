#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"

echo "[Phase8] Stopping local task-runners..."
docker-compose -f "$ROOT_DIR/task-runner/docker-compose.local.yml" down

echo "[Phase8] Stopping local n8n..."
docker-compose -f "$ROOT_DIR/n8n/docker-compose.yml" down

echo "[Phase8] Local services stopped."
