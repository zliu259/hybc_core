#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"

echo "========== n8n =========="
docker-compose -f "$ROOT_DIR/n8n/docker-compose.yml" ps

echo
echo "====== task-runners ======"
docker-compose -f "$ROOT_DIR/task-runner/docker-compose.local.yml" ps
