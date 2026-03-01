#!/usr/bin/env bash
set -euo pipefail

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "[runner-azure] Missing command: $1" >&2
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
DEPLOY_ROOT="${DEPLOY_ROOT:-/opt/hybc_core}"
GIT_BRANCH="${GIT_BRANCH:-main}"
RUNNER_ENV_FILE="${RUNNER_ENV_FILE:-$DEPLOY_ROOT/task-runner/.env}"
RUNNER_SERVICE_NAME="${RUNNER_SERVICE_NAME:-hybc-task-runner}"

if [[ -z "$GIT_REPO_URL" ]]; then
  echo "[runner-azure] GIT_REPO_URL is required."
  echo "Example: GIT_REPO_URL=https://github.com/your-org/hybc_core.git bash scripts/deploy/runner-azure-vm.sh"
  exit 1
fi

require_cmd git

echo "[runner-azure] Installing Docker and dependencies..."
as_root apt-get update -y
as_root apt-get install -y ca-certificates curl git docker.io docker-compose-plugin
as_root systemctl enable docker
as_root systemctl restart docker

if [[ ! -d "$DEPLOY_ROOT/.git" ]]; then
  echo "[runner-azure] Cloning repository to $DEPLOY_ROOT"
  as_root mkdir -p "$(dirname "$DEPLOY_ROOT")"
  as_root git clone --branch "$GIT_BRANCH" "$GIT_REPO_URL" "$DEPLOY_ROOT"
else
  echo "[runner-azure] Updating repository in $DEPLOY_ROOT"
  as_root git -C "$DEPLOY_ROOT" fetch --all --prune
  as_root git -C "$DEPLOY_ROOT" checkout "$GIT_BRANCH"
  as_root git -C "$DEPLOY_ROOT" pull --ff-only origin "$GIT_BRANCH"
fi

if [[ ! -f "$RUNNER_ENV_FILE" ]]; then
  echo "[runner-azure] Creating runner env from template"
  as_root cp "$DEPLOY_ROOT/task-runner/.env.example" "$RUNNER_ENV_FILE"
fi

if [[ -n "${API_BASE_URL:-}" ]]; then
  as_root bash -lc "$(declare -f upsert_env); upsert_env '$RUNNER_ENV_FILE' 'API_BASE_URL' '${API_BASE_URL}'"
fi
if [[ -n "${API_KEY:-}" ]]; then
  as_root bash -lc "$(declare -f upsert_env); upsert_env '$RUNNER_ENV_FILE' 'API_KEY' '${API_KEY}'"
fi
if [[ -n "${MOCK_AI_ONLY:-}" ]]; then
  as_root bash -lc "$(declare -f upsert_env); upsert_env '$RUNNER_ENV_FILE' 'MOCK_AI_ONLY' '${MOCK_AI_ONLY}'"
fi

echo "[runner-azure] Writing systemd service: ${RUNNER_SERVICE_NAME}.service"
as_root tee "/etc/systemd/system/${RUNNER_SERVICE_NAME}.service" >/dev/null <<EOF
[Unit]
Description=HYBC Task Runner (Docker Compose)
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=${DEPLOY_ROOT}/task-runner
ExecStart=/usr/bin/docker compose up -d --build
ExecStop=/usr/bin/docker compose down
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
EOF

as_root systemctl daemon-reload
as_root systemctl enable "${RUNNER_SERVICE_NAME}.service"
as_root systemctl restart "${RUNNER_SERVICE_NAME}.service"

echo "[runner-azure] Deployment complete."
echo "- Service status: sudo systemctl status ${RUNNER_SERVICE_NAME}.service"
echo "- Runner logs:    sudo docker logs -f hybc-task-runner"
echo "- Env file:       ${RUNNER_ENV_FILE}"
