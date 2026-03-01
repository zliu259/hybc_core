#!/usr/bin/env bash
set -euo pipefail

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "[bridge-azure] Missing command: $1" >&2
    exit 1
  fi
}

as_root() {
  if [[ "${EUID}" -eq 0 ]]; then
    "$@"
  else
    sudo "$@"
  fi
}

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

GIT_REPO_URL="${GIT_REPO_URL:-}"
GIT_BRANCH="${GIT_BRANCH:-main}"
DEPLOY_ROOT="${DEPLOY_ROOT:-/opt/hybc_core}"
BRIDGE_ENV_FILE="${BRIDGE_ENV_FILE:-$DEPLOY_ROOT/bridge/.env}"
BRIDGE_SERVICE_NAME="${BRIDGE_SERVICE_NAME:-hybc-bridge}"
LOCAL_BUNDLE="${LOCAL_BUNDLE:-false}"

if [[ "$LOCAL_BUNDLE" != "true" && -z "$GIT_REPO_URL" ]]; then
  echo "[bridge-azure] GIT_REPO_URL is required"
  exit 1
fi

require_cmd git

as_root apt-get update -y
as_root apt-get install -y python3 python3-venv python3-pip git

if [[ "$LOCAL_BUNDLE" == "true" ]]; then
  if [[ ! -d "$DEPLOY_ROOT/bridge" ]]; then
    echo "[bridge-azure] LOCAL_BUNDLE=true but $DEPLOY_ROOT/bridge not found" >&2
    exit 1
  fi
else
  if [[ ! -d "$DEPLOY_ROOT/.git" ]]; then
    as_root mkdir -p "$(dirname "$DEPLOY_ROOT")"
    as_root git clone --branch "$GIT_BRANCH" "$GIT_REPO_URL" "$DEPLOY_ROOT"
  else
    as_root git -C "$DEPLOY_ROOT" fetch --all --prune
    as_root git -C "$DEPLOY_ROOT" checkout "$GIT_BRANCH"
    as_root git -C "$DEPLOY_ROOT" pull --ff-only origin "$GIT_BRANCH"
  fi
fi

if [[ ! -f "$BRIDGE_ENV_FILE" ]]; then
  as_root cp "$DEPLOY_ROOT/bridge/.env.example" "$BRIDGE_ENV_FILE"
fi

if [[ -n "${WECOM_VERIFY_TOKEN:-}" ]]; then
  as_root bash -lc "$(declare -f upsert_env); upsert_env '$BRIDGE_ENV_FILE' 'WECOM_VERIFY_TOKEN' '${WECOM_VERIFY_TOKEN}'"
fi
if [[ -n "${WORKER_INGEST_URL:-}" ]]; then
  as_root bash -lc "$(declare -f upsert_env); upsert_env '$BRIDGE_ENV_FILE' 'WORKER_INGEST_URL' '${WORKER_INGEST_URL}'"
fi
if [[ -n "${BRIDGE_HMAC_SECRET:-}" ]]; then
  as_root bash -lc "$(declare -f upsert_env); upsert_env '$BRIDGE_ENV_FILE' 'BRIDGE_HMAC_SECRET' '${BRIDGE_HMAC_SECRET}'"
fi

as_root python3 -m venv "$DEPLOY_ROOT/bridge/.venv"
as_root "$DEPLOY_ROOT/bridge/.venv/bin/pip" install --upgrade pip
as_root "$DEPLOY_ROOT/bridge/.venv/bin/pip" install -r "$DEPLOY_ROOT/bridge/requirements.txt"

as_root cp "$DEPLOY_ROOT/bridge/systemd/hybc-bridge.service" "/etc/systemd/system/${BRIDGE_SERVICE_NAME}.service"
as_root systemctl daemon-reload
as_root systemctl enable "${BRIDGE_SERVICE_NAME}.service"
as_root systemctl restart "${BRIDGE_SERVICE_NAME}.service"

echo "[bridge-azure] Deployment completed"
echo "- Service: sudo systemctl status ${BRIDGE_SERVICE_NAME}.service"
echo "- Health:  curl http://127.0.0.1:9001/health"
