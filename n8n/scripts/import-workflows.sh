#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
WF_DIR="$ROOT_DIR/n8n/workflows"

if [[ ! -d "$WF_DIR" ]]; then
  echo "[n8n] workflows directory not found: $WF_DIR"
  exit 1
fi

echo "[n8n] Workflows present (import via n8n UI or API):"
ls "$WF_DIR"/*.json

echo
echo "[n8n] If using API import, configure:"
echo "- N8N_BASE_URL"
echo "- N8N_API_KEY"
echo "Then extend this script with /rest/workflows API calls."
