# Azure Bridge (WeCom)

This service runs on Azure VM with fixed public IP and bridges WeCom callbacks to Cloudflare Worker.

## Scope

- Current phase only covers WeCom bridge capability.
- CosmosDB and ML data pipeline are deferred to future phases.

## Local run

```bash
cd bridge
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --host 0.0.0.0 --port 9001
```

## API Contract

### 1) WeCom callback verify

- `GET /wecom/callback`
- Query params:
  - `msg_signature`
  - `timestamp`
  - `nonce`
  - `echostr`
- Behavior:
  - Verifies signature with `WECOM_VERIFY_TOKEN`
  - Returns `echostr` as plain text when valid

### 2) WeCom callback ingest

- `POST /wecom/callback`
- Query params:
  - `msg_signature`
  - `timestamp`
  - `nonce`
- Body:
  - Raw WeCom payload (XML/JSON)
- Behavior:
  - Verifies WeCom signature
  - Wraps callback into normalized JSON payload with `trace_id`
  - Forwards payload to Worker ingest endpoint

### 2.1) WeCom outbound proxy (for Worker egress pinning)

- `POST /wecom/proxy`
- Request body:
  - `{ "url": "https://qyapi.weixin.qq.com/cgi-bin/...", "method": "GET|POST", "body": {...}, "headers": {...} }`
- Header:
  - `X-Bridge-Token: <BRIDGE_PROXY_TOKEN>` (enforced when configured)
- Behavior:
  - Only allows `https://qyapi.weixin.qq.com/cgi-bin/*`
  - Only allows `GET` and `POST`
  - Executes outbound request from Azure bridge public IP
  - Returns upstream response body/status back to Worker

### 3) Health check

- `GET /health`
- Returns service heartbeat JSON

### 4) Relay status (load-aware)

- `GET /relay/status`
- Returns relay admission status for fallback selection:
  - `overloaded`
  - `reason`
  - `inflight_requests`
  - `max_inflight`
  - `timeout_rate`
  - `upstream_error_rate`
  - `cooldown_seconds_left`
  - `admission_state`

### 5) Generic API relay proxy

- `GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD /api/{path}`
- Behavior:
  - Forwards request to `${WORKER_API_BASE_URL}/api/{path}` with query string preserved
  - Keeps auth and request headers (except hop-by-hop unsafe headers)
  - Rejects early with `503` when relay is overloaded (`Retry-After` included)
  - Drops any client-supplied `X-Relay-Auth` and injects `X-Relay-Auth: <RELAY_TRUST_TOKEN>` (when configured),
    so the Worker trusts the first hop of `X-Forwarded-For` as the real client IP for rate limiting/audit
  - Intended for Worker primary -> relay fallback path, without changing business API logic

## Bridge -> Worker Signing Contract

Bridge sends JSON body to `WORKER_INGEST_URL` with headers:

- `X-Bridge-Source`: logical source tag
- `X-Bridge-Timestamp`: unix timestamp (seconds)
- `X-Bridge-Nonce`: random UUID hex
- `X-Bridge-Signature`: hex(HMAC-SHA256(secret, "{timestamp}.{nonce}." + raw_body))

Worker verifies:

1. `timestamp` freshness window (default 5 minutes)
2. nonce replay (KV cache)
3. HMAC signature equality

## Required env variables

- `WECOM_VERIFY_TOKEN`
- `WORKER_INGEST_URL`
- `BRIDGE_HMAC_SECRET`

Optional:

- `BRIDGE_SOURCE`
- `RELAY_TRUST_TOKEN` (shared with Worker secret `RELAY_TRUST_TOKEN` and the Caddy env file on the VM)
- `WORKER_TIMEOUT_SECONDS`
- `WORKER_MAX_RETRIES`
- `WORKER_API_BASE_URL`
- `RELAY_MAX_INFLIGHT`
- `RELAY_ERROR_WINDOW_SECONDS`
- `RELAY_MIN_SAMPLES`
- `RELAY_TIMEOUT_RATE_THRESHOLD`
- `RELAY_ERROR_RATE_THRESHOLD`
- `RELAY_COOLDOWN_SECONDS`
- `BRIDGE_EXTRA_DOMAINS`

## Azure deployment notes

Use systemd unit: `bridge/systemd/hybc-bridge.service`.

Service file assumes deployment path:

- code: `/opt/hybc_core/bridge`
- venv: `/opt/hybc_core/bridge/.venv`
- env file: `/opt/hybc_core/bridge/.env`

If you use additional relay subdomains (for example `bridge-hk-2.hybcdg.com`, `bridge-sg-1.hybcdg.com`), set:

- `BRIDGE_PUBLIC_DOMAIN`: primary HTTPS hostname
- `BRIDGE_EXTRA_DOMAINS`: comma-separated extra hostnames

The deployment script writes a Caddy config for all listed hosts and auto-manages TLS certificates.

### 手动更新
- 手动切换azure hk bridge 到 aws lighsail jp bridge