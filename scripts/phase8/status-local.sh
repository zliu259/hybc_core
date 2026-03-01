#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"

echo "====== task-runners ======"
docker-compose -f "$ROOT_DIR/task-runner/docker-compose.local.yml" ps
