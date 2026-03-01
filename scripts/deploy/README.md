# Runner Deployment Scripts

This directory contains runner-only deployment scripts (no n8n dependency).

## 0) Azure WeCom Bridge

Script: `scripts/deploy/bridge-azure-vm.sh`

Example:

```bash
GIT_REPO_URL="https://github.com/<org>/hybc_core.git" \
GIT_BRANCH="main" \
WECOM_VERIFY_TOKEN="<wecom-token>" \
WORKER_INGEST_URL="https://api.hybcdg.com/api/v1/system/bridge/wecom-ingest" \
BRIDGE_HMAC_SECRET="<shared-secret>" \
bash scripts/deploy/bridge-azure-vm.sh
```

What it does:
- installs Python runtime
- installs Caddy (for HTTPS certificate and reverse proxy)
- clones/updates repo to `/opt/hybc_core`
- creates bridge venv and installs dependencies
- initializes `bridge/.env`
- installs and starts `hybc-bridge.service`

Default TLS endpoint:

- `BRIDGE_PUBLIC_DOMAIN` (default: `bridge.hybcdg.com`)
- Caddy reverse-proxies `:443` to `127.0.0.1:9001`

Auto update script on VM:

```bash
bash scripts/deploy/bridge-azure-update.sh
```

CI auto deploy workflow:

- File: `.github/workflows/deploy-bridge-azure.yml`
- Trigger: push to `main` when `bridge/**` changes, or manual dispatch.
- Required GitHub secrets:
  - `AZURE_BRIDGE_HOST`
  - `AZURE_BRIDGE_USER`
  - `AZURE_BRIDGE_SSH_KEY`

## 1) Azure VM

Script: `scripts/deploy/runner-azure-vm.sh`

Example:

```bash
GIT_REPO_URL="https://github.com/<org>/hybc_core.git" \
GIT_BRANCH="main" \
API_BASE_URL="https://api.hybcdg.com" \
API_KEY="<task-api-key>" \
MOCK_AI_ONLY="false" \
bash scripts/deploy/runner-azure-vm.sh
```

What it does:
- installs Docker + compose plugin
- clones/updates repo to `/opt/hybc_core`
- initializes `task-runner/.env`
- creates and starts `hybc-task-runner.service`

## 2) Cloudflare Containers

Script: `scripts/deploy/runner-cf-container.sh`

Example scaffold generation:

```bash
API_BASE_URL="https://api.hybcdg.com" \
API_KEY="<task-api-key>" \
RUNNER_DOMAIN="runner.hybcdg.com" \
bash scripts/deploy/runner-cf-container.sh
```

Direct deploy (requires auth/token):

```bash
export CLOUDFLARE_API_TOKEN="<cf-api-token>"
API_BASE_URL="https://api.hybcdg.com" \
API_KEY="<task-api-key>" \
RUNNER_DOMAIN="runner.hybcdg.com" \
DEPLOY="true" \
bash scripts/deploy/runner-cf-container.sh
```

Notes:
- token needs Workers/Routes/Zone edit permissions for `hybcdg.com`
- script generates a temporary project under `.cf-runner-container`
- custom domain is declared in generated `wrangler.toml`

## 3) Phased Rollout (Local -> Remote)

1. **Local validation**
   - run API + Web locally
   - ensure `/api/v1/admin/runner-runtime-config` works
   - run one automation task and confirm `task_queue.status=completed`

2. **Remote runner smoke test**
   - deploy runner to `runner.hybcdg.com`
   - verify runner heartbeat in `GET /api/v1/task/nodes`
   - run one low-risk task (`daily-log-summary`) and verify completion

3. **Hybrid test window**
   - keep local API/Web, use remote runner only
   - execute approvals + AI flows with real business data copy or mock set

4. **Incremental production cutover**
   - move API to remote while keeping rollback to local runner
   - then switch frontend API base
   - monitor queue backlog, timeout ratio, and node heartbeat for 24h

5. **Rollback rule**
   - if timeout/failure spikes, set `MOCK_AI_ONLY=true` from web admin
   - optionally stop remote runner and resume local runner
