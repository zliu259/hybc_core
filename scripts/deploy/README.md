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
- `BRIDGE_EXTRA_DOMAINS` (optional, comma-separated, e.g. `bridge-hk-2.hybcdg.com,bridge-sg-1.hybcdg.com`)
- Caddy reverse-proxies `:443` to `127.0.0.1:9001` (uvicorn relay, miniapp primary entry)

Web API entry (`scripts/deploy/bridge-caddy.sh`, shared by both scripts so the Caddyfile never drifts):

- `API_RELAY_PUBLIC_DOMAIN` (default: `api-relay.hybcdg.com`; set `none` to disable the site) — https only,
  streamed straight to the Worker, bypassing uvicorn
- `API_RELAY_UPSTREAM` (default: `api.hybcdg.com`)
- `RELAY_TRUST_TOKEN` — written to `bridge/.env` (uvicorn relay) and copied into `/etc/caddy/hybc.env`
  (loaded via systemd drop-in `/etc/systemd/system/caddy.service.d/hybc-env.conf`); Caddy injects it as
  `X-Relay-Auth` so the Worker trusts the first `X-Forwarded-For` hop as the client IP. Same value as the
  Worker secret `RELAY_TRUST_TOKEN` (`wrangler secret put RELAY_TRUST_TOKEN --env prod`).
- `BRIDGE_HOST` defaults to `127.0.0.1` (uvicorn is only reached through Caddy on the same host)
- Template regression test: `bash scripts/deploy/bridge-caddy.test.sh`

Web mirror (same public domain, `scripts/deploy/bridge-caddy.sh`):

- `WEB_PUBLIC_DOMAIN` (empty or `none` = off; production: `web.hybcdg.com`) — https only; `/api/*` is proxied to the
  Worker like `api-relay`, everything else to the Pages origin `WEB_STATIC_UPSTREAM` (default `hybc-core.pages.dev`)
  with `Host` rewritten and `Location` rewritten back to the public domain (Pages issues 308 extension-stripping redirects).
- Certificates use Cloudflare DNS-01 so they can be issued **before** the DNS record is moved to the VM:
  `CF_DNS_API_TOKEN` = Cloudflare API token with `Zone:Zone:Read` + `Zone:DNS:Edit` on the zone (GitHub secret
  `AZURE_BRIDGE_CF_DNS_API_TOKEN`). Without the token the web site is skipped with a warning.
- The web site needs a Caddy build with `caddy-dns/cloudflare`; `ensure_caddy_cloudflare_dns` downloads it from the
  official download API and installs it the way the Caddy docs recommend for apt installs (`dpkg-divert` the packaged
  binary to `/usr/bin/caddy.default`, custom build at `/usr/bin/caddy.custom`, `update-alternatives` → custom), so apt
  upgrades never swap it back. Runs only when the web site is enabled.
- Cut-over: enable with GitHub var `AZURE_BRIDGE_WEB_DOMAIN=web.hybcdg.com`, run the workflow, verify with
  `curl --resolve web.hybcdg.com:443:<VM IP> https://web.hybcdg.com/`, then change the `web` DNS record to a
  **DNS-only** A/AAAA pointing at the VM. Roll back by restoring the proxied CNAME to `hybc-core.pages.dev`.

DNS cut-over / rollback helper (`scripts/deploy/cf-dns.py`, stdlib only; reads the Cloudflare API token from
`~/.hybc/cf-dns-token` — Zone:Read + DNS:Edit on `hybcdg.com`, same value as the GitHub secret — and never prints it):

```bash
python3 -I scripts/deploy/cf-dns.py verify
python3 -I scripts/deploy/cf-dns.py show web.hybcdg.com
python3 -I scripts/deploy/cf-dns.py cutover web.hybcdg.com 13.114.172.128 2406:da14:33e:c700:7141:8509:bd15:77bc
python3 -I scripts/deploy/cf-dns.py rollback web.hybcdg.com hybc-core.pages.dev
```

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
  - `AZURE_BRIDGE_PROXY_TOKEN`
  - `AZURE_BRIDGE_RELAY_TRUST_TOKEN` (trusted-relay token, see above)
  - `AZURE_BRIDGE_CF_DNS_API_TOKEN` (Cloudflare DNS-01 token for the web mirror, see above)
- Optional GitHub variables: `AZURE_BRIDGE_WORKER_API_BASE_URL`, `AZURE_BRIDGE_RELAY_API_TIMEOUT_SECONDS`,
  `AZURE_BRIDGE_API_RELAY_DOMAIN` (defaults to `api-relay.hybcdg.com`),
  `AZURE_BRIDGE_WEB_DOMAIN` (web mirror domain; unset = off), `AZURE_BRIDGE_WEB_UPSTREAM` (defaults to `hybc-core.pages.dev`)

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
