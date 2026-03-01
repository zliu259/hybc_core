#!/usr/bin/env bash
set -euo pipefail

DEPLOY_ROOT="${DEPLOY_ROOT:-/opt/hybc_core}"
GIT_BRANCH="${GIT_BRANCH:-main}"
SERVICE_NAME="${SERVICE_NAME:-hybc-bridge}"

if [[ ! -d "$DEPLOY_ROOT/.git" ]]; then
  echo "[bridge-update] No git repo detected, using local bundle mode"
else
  git -C "$DEPLOY_ROOT" fetch --all --prune
  git -C "$DEPLOY_ROOT" checkout "$GIT_BRANCH"
  git -C "$DEPLOY_ROOT" pull --ff-only origin "$GIT_BRANCH"
fi

if [[ ! -f "$DEPLOY_ROOT/bridge/.env" ]]; then
  cp "$DEPLOY_ROOT/bridge/.env.example" "$DEPLOY_ROOT/bridge/.env"
fi

if [[ ! -d "$DEPLOY_ROOT/bridge/.venv" ]]; then
  python3 -m venv "$DEPLOY_ROOT/bridge/.venv"
fi

"$DEPLOY_ROOT/bridge/.venv/bin/pip" install -r "$DEPLOY_ROOT/bridge/requirements.txt"

sudo cp "$DEPLOY_ROOT/bridge/systemd/hybc-bridge.service" "/etc/systemd/system/${SERVICE_NAME}.service"
sudo systemctl daemon-reload
sudo systemctl restart "$SERVICE_NAME"
sudo systemctl status "$SERVICE_NAME" --no-pager
