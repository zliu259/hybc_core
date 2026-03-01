#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"

if docker ps --format '{{.Names}}' | grep -q '^hybc-task-runner$'; then
  echo "[Phase8] WARNING: legacy single-node container hybc-task-runner is running."
  echo "[Phase8] Stop it first to avoid duplicate task consumption:"
  echo "         docker-compose -f $ROOT_DIR/task-runner/docker-compose.yml down"
fi

if [[ ! -f "$ROOT_DIR/task-runner/security/certs/ca.crt" ]]; then
  echo "[Phase8] Local TLS certs not found, generating..."
  "$ROOT_DIR/task-runner/security/generate-local-certs.sh"
fi

echo "[Phase8] Starting local multi-node task-runners..."
docker-compose -f "$ROOT_DIR/task-runner/docker-compose.local.yml" up -d --build

echo "[Phase8] Local services started."
echo "- task-runner nodes: primary / secondary / standby"
