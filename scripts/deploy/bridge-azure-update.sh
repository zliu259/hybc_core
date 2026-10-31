#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
as_root() {
  if [[ "${EUID}" -eq 0 ]]; then
    "$@"
  else
    sudo "$@"
  fi
}
# shellcheck source=bridge-caddy.sh
source "$SCRIPT_DIR/bridge-caddy.sh"

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

upsert_env() {
  local file="$1"
  local key="$2"
  local value="$3"
  if grep -q "^${key}=" "$file"; then
    sed -i.bak "s#^${key}=.*#${key}=${value}#" "$file"
  else
    printf "%s=%s\n" "$key" "$value" >>"$file"
  fi
}

WORKER_API_BASE_URL="${WORKER_API_BASE_URL:-https://api.hybcdg.com}"
RELAY_API_TIMEOUT_SECONDS="${RELAY_API_TIMEOUT_SECONDS:-30}"

upsert_env "$DEPLOY_ROOT/bridge/.env" "WORKER_API_BASE_URL" "$WORKER_API_BASE_URL"
upsert_env "$DEPLOY_ROOT/bridge/.env" "RELAY_API_TIMEOUT_SECONDS" "$RELAY_API_TIMEOUT_SECONDS"

if [[ -n "${BRIDGE_PROXY_TOKEN:-}" ]]; then
  upsert_env "$DEPLOY_ROOT/bridge/.env" "BRIDGE_PROXY_TOKEN" "$BRIDGE_PROXY_TOKEN"
fi
if [[ -n "${RELAY_TRUST_TOKEN:-}" ]]; then
  upsert_env "$DEPLOY_ROOT/bridge/.env" "RELAY_TRUST_TOKEN" "$RELAY_TRUST_TOKEN"
fi
if [[ -n "${API_RELAY_PUBLIC_DOMAIN:-}" ]]; then
  upsert_env "$DEPLOY_ROOT/bridge/.env" "API_RELAY_PUBLIC_DOMAIN" "$API_RELAY_PUBLIC_DOMAIN"
fi
if [[ -n "${API_RELAY_UPSTREAM:-}" ]]; then
  upsert_env "$DEPLOY_ROOT/bridge/.env" "API_RELAY_UPSTREAM" "$API_RELAY_UPSTREAM"
fi
if [[ -n "${WEB_PUBLIC_DOMAIN:-}" ]]; then
  upsert_env "$DEPLOY_ROOT/bridge/.env" "WEB_PUBLIC_DOMAIN" "$WEB_PUBLIC_DOMAIN"
fi
if [[ -n "${WEB_STATIC_UPSTREAM:-}" ]]; then
  upsert_env "$DEPLOY_ROOT/bridge/.env" "WEB_STATIC_UPSTREAM" "$WEB_STATIC_UPSTREAM"
fi
if [[ -n "${CF_DNS_API_TOKEN:-}" ]]; then
  upsert_env "$DEPLOY_ROOT/bridge/.env" "CF_DNS_API_TOKEN" "$CF_DNS_API_TOKEN"
fi
upsert_env "$DEPLOY_ROOT/bridge/.env" "BRIDGE_HOST" "${BRIDGE_HOST:-127.0.0.1}"

if [[ ! -d "$DEPLOY_ROOT/bridge/.venv" ]]; then
  python3 -m venv "$DEPLOY_ROOT/bridge/.venv"
fi

"$DEPLOY_ROOT/bridge/.venv/bin/pip" install -r "$DEPLOY_ROOT/bridge/requirements.txt"

apply_caddy "$DEPLOY_ROOT/bridge/.env"

sudo cp "$DEPLOY_ROOT/bridge/systemd/hybc-bridge.service" "/etc/systemd/system/${SERVICE_NAME}.service"
sudo systemctl daemon-reload
sudo systemctl restart "$SERVICE_NAME"
sudo systemctl status "$SERVICE_NAME" --no-pager
