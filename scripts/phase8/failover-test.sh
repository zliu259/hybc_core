#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"

echo "[Phase8] Failover simulation start"
echo "[Phase8] Step 1: ensure multi-node stack is running"
docker-compose -f "$ROOT_DIR/task-runner/docker-compose.local.yml" up -d

echo "[Phase8] Step 2: stop primary node"
docker stop hybc-task-runner-primary >/dev/null

echo "[Phase8] Step 3: verify secondary and standby are still running"
docker ps --format "{{.Names}}" | grep -E "^hybc-task-runner-secondary$|^hybc-task-runner-standby$" >/dev/null

echo "[Phase8] Step 4: restart primary node"
docker start hybc-task-runner-primary >/dev/null

echo "[Phase8] Failover simulation completed"
