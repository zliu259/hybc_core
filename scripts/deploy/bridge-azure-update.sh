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

if [[ ! -d "$DEPLOY_ROOT/bridge/.venv" ]]; then
  python3 -m venv "$DEPLOY_ROOT/bridge/.venv"
fi

"$DEPLOY_ROOT/bridge/.venv/bin/pip" install -r "$DEPLOY_ROOT/bridge/requirements.txt"

if command -v caddy >/dev/null 2>&1; then
  DOMAIN_VALUE="$(grep -E '^BRIDGE_PUBLIC_DOMAIN=' "$DEPLOY_ROOT/bridge/.env" | tail -n 1 | cut -d '=' -f2-)"
  EXTRA_DOMAINS_VALUE="$(grep -E '^BRIDGE_EXTRA_DOMAINS=' "$DEPLOY_ROOT/bridge/.env" | tail -n 1 | cut -d '=' -f2-)"
  DOMAIN_LIST=""
  if [[ -n "$DOMAIN_VALUE" ]]; then
    DOMAIN_LIST="$DOMAIN_VALUE"
  fi
  if [[ -n "$EXTRA_DOMAINS_VALUE" ]]; then
    CLEAN_EXTRA="$(printf '%s' "$EXTRA_DOMAINS_VALUE" | tr -d ' ' | tr ';' ',')"
    if [[ -n "$CLEAN_EXTRA" ]]; then
      if [[ -n "$DOMAIN_LIST" ]]; then
        DOMAIN_LIST="$DOMAIN_LIST,$CLEAN_EXTRA"
      else
        DOMAIN_LIST="$CLEAN_EXTRA"
      fi
    fi
  fi
  if [[ -n "$DOMAIN_LIST" ]]; then
    sudo tee /etc/caddy/Caddyfile >/dev/null <<EOF
http://${DOMAIN_LIST} {
  encode gzip
  reverse_proxy 127.0.0.1:9001 {
    header_up X-Forwarded-Proto {scheme}
  }
}

https://${DOMAIN_LIST} {
  encode gzip
  reverse_proxy 127.0.0.1:9001 {
    header_up X-Forwarded-Proto {scheme}
  }
}
EOF
    sudo systemctl enable caddy
    sudo systemctl restart caddy
  fi
fi

sudo cp "$DEPLOY_ROOT/bridge/systemd/hybc-bridge.service" "/etc/systemd/system/${SERVICE_NAME}.service"
sudo systemctl daemon-reload
sudo systemctl restart "$SERVICE_NAME"
sudo systemctl status "$SERVICE_NAME" --no-pager
