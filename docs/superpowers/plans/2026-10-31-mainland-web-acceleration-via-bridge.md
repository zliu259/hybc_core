# 大陆网页端加速（API 经东京 bridge 反代）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `web.hybcdg.com` 的全部 API 请求（JSON、附件直传、附件预览，含存量附件）经新域名 `api-relay.hybcdg.com` 由东京 VM 上的 Caddy 直接反代到 Worker，同时让 Worker 在可信中转后仍拿到真实客户端 IP。

**Architecture:** Worker 侧新增「可信中转」判定：请求头 `X-Relay-Auth` 等于 secret `RELAY_TRUST_TOKEN` 时取 `X-Forwarded-For` 首跳为客户端 IP，四处取 IP 的代码统一改用它。VM 侧 Caddy 新增 `api-relay.hybcdg.com` 站点，流式反代 `https://api.hybcdg.com` 并写入该头；bridge 的 uvicorn relay 顺带写入同一个头。Web 侧把 API 基址换到新域名，附件绝对地址在渲染处把 origin 归一到当前基址，现有 relay pool 角色对调为「主入口失败时读请求回退直连 Worker」。

**Tech Stack:** Hono on Cloudflare Workers（TypeScript, Vitest）· Vue 3 / Vite / Axios（Vitest, happy-dom）· FastAPI + httpx（Python 3.11）· Caddy 2 · bash 部署脚本 · GitHub Actions

**Spec:** `docs/superpowers/specs/2026-10-31-mainland-web-acceleration-via-bridge-design.md`

## Global Constraints

- 新域名：`api-relay.hybcdg.com`，灰云直出，A `13.114.172.128` + AAAA（与 `bridge.hybcdg.com` 同机同 IP）。
- 上游：`https://api.hybcdg.com`，Worker 继续以 route 形式绑定，不改 Custom Domain。
- 可信中转头：`X-Relay-Auth`；secret 名：`RELAY_TRUST_TOKEN`（Worker secret、`bridge/.env`、Caddy 环境文件三处同值）。该键只能走 `wrangler secret put RELAY_TRUST_TOKEN --env prod`，不得出现在任何 `wrangler*.toml` 的 vars 段落。
- Worker 取 IP 顺序：可信中转 → `X-Forwarded-For` 首跳；否则 `cf-connecting-ip` → `x-forwarded-for` 首跳 → `x-real-ip`。不带有效令牌的 XFF 一律不信。
- Caddy：`header_up X-Relay-Auth {env.RELAY_TRUST_TOKEN}`（Set 语义会整体替换客户端自带的同名头；**不要**再写 `header_up -X-Relay-Auth`，Caddy 的删除操作在设置之后执行，会把刚设的值删掉）；上游超时 120 s；`request_body max_size 100MB`；`encode zstd gzip`；只声明 `https://` 站点。
- `wrangler.toml` 顶层 `[vars]` 与 `[env.prod.vars]` 必须逐键逐值一致（`test/wrangler-prod-env.test.ts` 守卫）。
- Web 写请求不自动回退（维持「仅带 `Idempotency-Key` 的写请求可回退」）；读请求回退触发条件 = 网络错误 或 主入口返回 502/503/504。
- 直连 Worker 作为回退节点时探测 `/api/v1/system/health`，`probeTimeoutMs` 3000。
- 存量附件不回填数据库，渲染时归一。
- 提交信息格式 `<type>: <description>`，不加任何 AI 署名 trailer。
- 本仓库用 pnpm；`packages/api`、`packages/web` 改动推送前本地跑通该包的 `typecheck` 与 `test`。

## Review Focus

1. 客户端直连 `api.hybcdg.com` 时自带伪造的 `X-Relay-Auth` 与 `X-Forwarded-For`：Worker 必须忽略，仍用 `cf-connecting-ip`（Task 1 测试）。
2. 可信中转到达但 `X-Forwarded-For` 缺失或为空：必须退回 `cf-connecting-ip`，不能得到空串当 actor key（Task 1 测试）。
3. 主入口对不带 `Idempotency-Key` 的 POST 返回 502/503/504：不得重放到直连 Worker（Task 7 测试）。
4. `normalizeApiUrl` 对 `https://api.hybcdg.com.evil.com/...` 与本地开发（基址为空）时的绝对地址：前者不得改写，后者保持原样（Task 6 测试）。
5. `/api/v1/system/health` 的 `relay_trusted` 在直连 + 伪造头时必须为 `false`（Task 3 测试）。

---

## 任务顺序与上线门

```
Task 1 ─ Task 2 ─ Task 3 ──┐
Task 4（bridge）───────────┤→ 合并到 main（Worker/bridge 自动部署，无令牌时行为不变）
Task 5（Caddy/脚本/workflow）┘
        ↓ 运维门 A（owner/有权限者）：生成令牌 → Worker secret → GitHub secret → DNS 记录 → 跑 workflow → 防火墙 → zone WAF 核对
Task 6 ─ Task 7 ──→ 合并到 main（基址未变，行为不变）
        ↓ 本地用生产构建指向 api-relay 做 5.7 端到端验证
Task 8（基址切换 + diag.html）──→ 合并到 main（Pages 发布即切换）
Task 9（文档收尾）
```

所有代码任务在分支 `feat/api-relay-tokyo` 上进行，分两到三个 PR 合并（Task 1–5 一个，Task 6–7 一个，Task 8–9 一个），每个 PR 合并前 CI 与本地 `typecheck`/`test` 通过。

---

### Task 1: Worker 侧客户端 IP 解析工具 + 令牌配置

**Files:**
- Create: `packages/api/src/utils/timing-safe-equal.ts`
- Create: `packages/api/src/utils/client-ip.ts`
- Create: `packages/api/src/utils/client-ip.test.ts`
- Modify: `packages/api/src/services/agent-replay.ts:227-240`（删私有 `timingSafeEqual`，改 import）
- Modify: `packages/api/src/types/env.ts`（加 `RELAY_TRUST_TOKEN?: string`）
- Modify: `packages/api/.dev.vars.example`（加 `RELAY_TRUST_TOKEN=local-dev-relay-trust-token-not-for-prod`，并把键名补进文件头部「不得出现在 vars 段落」清单）
- Modify: `packages/api/test/wrangler-prod-env.test.ts:~150`（`SECRET_ONLY_KEYS` 加 `"RELAY_TRUST_TOKEN"`）

**Interfaces:**
- Produces:
  - `timingSafeEqual(a: string, b: string): boolean`（`utils/timing-safe-equal.ts`，与 agent-replay 现有实现语义一致：长度不同返回 false，逐字节异或累加）
  - `RELAY_AUTH_HEADER = "x-relay-auth"`
  - `isTrustedRelay(headers: Headers, env: Pick<Env, "RELAY_TRUST_TOKEN">): boolean`：`env.RELAY_TRUST_TOKEN` 非空且长度 ≥ 16，且请求头值与之 `timingSafeEqual`。
  - `resolveClientIp(headers: Headers, env: Pick<Env, "RELAY_TRUST_TOKEN">): string | undefined`：按 Global Constraints 的顺序取值；XFF 首跳取 `split(",")[0].trim()`；空串视为无值；全部无值返回 `undefined`。

- [ ] **Step 1: 写失败测试 `client-ip.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { isTrustedRelay, resolveClientIp } from "./client-ip";

const env = { RELAY_TRUST_TOKEN: "0123456789abcdef0123456789abcdef" };
const h = (init: Record<string, string>) => new Headers(init);

describe("resolveClientIp", () => {
  it("直连 Cloudflare：取 cf-connecting-ip，忽略客户端自带的 XFF 与伪造令牌", () => {
    const headers = h({ "cf-connecting-ip": "203.0.113.9", "x-forwarded-for": "10.0.0.1", "x-relay-auth": "wrong" });
    expect(resolveClientIp(headers, env)).toBe("203.0.113.9");
  });
  it("可信中转：取 XFF 首跳（Cloudflare 会把 VM IP 追加在后）", () => {
    const headers = h({ "cf-connecting-ip": "13.114.172.128", "x-forwarded-for": "203.0.113.9, 13.114.172.128", "x-relay-auth": env.RELAY_TRUST_TOKEN });
    expect(resolveClientIp(headers, env)).toBe("203.0.113.9");
  });
  it("可信中转但 XFF 缺失或为空：退回 cf-connecting-ip", () => {
    expect(resolveClientIp(h({ "cf-connecting-ip": "13.114.172.128", "x-relay-auth": env.RELAY_TRUST_TOKEN }), env)).toBe("13.114.172.128");
    expect(resolveClientIp(h({ "cf-connecting-ip": "13.114.172.128", "x-forwarded-for": "  ", "x-relay-auth": env.RELAY_TRUST_TOKEN }), env)).toBe("13.114.172.128");
  });
  it("未配置令牌时任何 X-Relay-Auth 都不可信", () => {
    const headers = h({ "cf-connecting-ip": "13.114.172.128", "x-forwarded-for": "203.0.113.9", "x-relay-auth": "" });
    expect(resolveClientIp(headers, {})).toBe("13.114.172.128");
    expect(isTrustedRelay(headers, { RELAY_TRUST_TOKEN: "" })).toBe(false);
  });
  it("无 cf-connecting-ip 时按 x-forwarded-for 首跳、x-real-ip 顺序兜底，全无则 undefined", () => {
    expect(resolveClientIp(h({ "x-forwarded-for": "198.51.100.7, 10.0.0.1" }), {})).toBe("198.51.100.7");
    expect(resolveClientIp(h({ "x-real-ip": "198.51.100.8" }), {})).toBe("198.51.100.8");
    expect(resolveClientIp(h({}), {})).toBeUndefined();
  });
  it("令牌短于 16 字符视为未配置（防占位值生效）", () => {
    expect(isTrustedRelay(h({ "x-relay-auth": "short" }), { RELAY_TRUST_TOKEN: "short" })).toBe(false);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/api && npx vitest run src/utils/client-ip.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `timing-safe-equal.ts` 与 `client-ip.ts`**

把 `services/agent-replay.ts` 里的 `timingSafeEqual` 原样搬到 `utils/timing-safe-equal.ts` 并 `export`，agent-replay 改为 import。`client-ip.ts` 按 Interfaces 实现；`env` 类型用 `Pick<Env, "RELAY_TRUST_TOKEN">`，不引入新的 any。

- [ ] **Step 4: 加 env 类型、`.dev.vars.example`、`SECRET_ONLY_KEYS`**

- [ ] **Step 5: 运行测试、类型检查、守卫测试**

Run: `cd packages/api && npx vitest run src/utils/client-ip.test.ts test/wrangler-prod-env.test.ts src/services/agent-replay.test.ts && npm run typecheck`
Expected: 全部 PASS（agent-replay 若无同名测试文件则跳过该项）

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/utils/timing-safe-equal.ts packages/api/src/utils/client-ip.ts packages/api/src/utils/client-ip.test.ts packages/api/src/services/agent-replay.ts packages/api/src/types/env.ts packages/api/.dev.vars.example packages/api/test/wrangler-prod-env.test.ts
git commit -m "feat(api): 可信中转客户端 IP 解析（X-Relay-Auth + XFF 首跳）"
```

---

### Task 2: 四处取 IP 的代码改用 `resolveClientIp`

**Files:**
- Modify: `packages/api/src/middleware/rate-limit.ts:7-13`
- Create: `packages/api/src/middleware/rate-limit.test.ts`
- Modify: `packages/api/src/routes/passkeys.ts:78-85`（`getRequestMeta`）与 `:702`（revoke 审计）
- Modify: `packages/api/src/routes/public-project-log.ts:467-471`

**Interfaces:**
- Consumes: `resolveClientIp(headers, env)`（Task 1）
- Produces: `rate-limit.ts` 内部 `resolveActorKey(headers: Headers, env: Pick<Env, "RELAY_TRUST_TOKEN">): string`（无值时 `"anonymous"`）；`passkeys.ts` 的 `getRequestMeta(c: { req: { raw: Request }; env: Env })` 返回 `{ ip, userAgent }`。

- [ ] **Step 1: 写失败测试 `rate-limit.test.ts`**

用一个记录 `bind()` 实参的最小 D1 桩（`prepare → bind → run/first`，`first` 返回 `{ hit_count: 1 }`），把 `createRateLimitMiddleware({ scope: "t", maxRequests: 5, windowSeconds: 60 })` 挂到 `new Hono<{ Bindings: Env }>()` 上，分别发：

```ts
it("直连：actor_key 为 cf-connecting-ip，忽略伪造令牌", ...)   // 期望 bind 第二个实参 === "203.0.113.9"
it("可信中转：actor_key 为 XFF 首跳", ...)                      // 期望 === "203.0.113.9"（cf-connecting-ip 是 VM）
it("无任何 IP 头：actor_key 为 anonymous", ...)
it("超过 maxRequests 返回 429", ...)                            // first 返回 { hit_count: 6 }
```

env 用 `{ DB: fakeDb, RELAY_TRUST_TOKEN: token } as unknown as Env`。

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/api && npx vitest run src/middleware/rate-limit.test.ts`
Expected: FAIL（可信中转用例取到的是 VM IP）

- [ ] **Step 3: 改四处调用**

- `rate-limit.ts`：`resolveActorKey(c.req.raw.headers, c.env)`，内部 `resolveClientIp(...) ?? "anonymous"`。
- `passkeys.ts`：`getRequestMeta` 改签名并用 `resolveClientIp(c.req.raw.headers, c.env)`；702 行的 revoke 审计改为调用 `getRequestMeta(c)` 取 `ip`/`userAgent`。
- `public-project-log.ts`：`const clientIp = resolveClientIp(c.req.raw.headers, c.env) ?? "";`

- [ ] **Step 4: 运行测试与类型检查**

Run: `cd packages/api && npx vitest run src/middleware/rate-limit.test.ts src/routes/passkeys && npm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/middleware/rate-limit.ts packages/api/src/middleware/rate-limit.test.ts packages/api/src/routes/passkeys.ts packages/api/src/routes/public-project-log.ts
git commit -m "fix(api): 限流与审计取 IP 统一经 resolveClientIp（修小程序经 bridge 共用 IP 的 429）"
```

---

### Task 3: 健康检查暴露中转状态 + 监控项 + wrangler vars

**Files:**
- Modify: `packages/api/src/routes/system.ts:144-151`（`/health`）与 `:247-260`（status-center 外部探测）
- Create: `packages/api/src/routes/system-health-relay.test.ts`
- Modify: `packages/api/src/types/env.ts`（加 `API_RELAY_HEALTH_URL?: string`）
- Modify: `packages/api/wrangler.toml`（顶层 `[vars]` 与 `[env.prod.vars]` 同时加 `API_RELAY_HEALTH_URL = "https://api-relay.hybcdg.com/api/v1/system/health"`、`RELAY_STATUS_URLS = "https://bridge.hybcdg.com/relay/status"`）

**Interfaces:**
- Consumes: `isTrustedRelay(headers, env)`（Task 1）
- Produces: `GET /api/v1/system/health` 响应新增字段 `relay_trusted: boolean`；status-center `services` 新增 `key: "api_relay_entry"` 项（`checkExternalHealth` 探测 `API_RELAY_HEALTH_URL`，默认值同 wrangler）。

- [ ] **Step 1: 写失败测试**

```ts
it("直连 + 伪造 X-Relay-Auth：relay_trusted 为 false", ...)   // GET /health, headers cf-connecting-ip + x-relay-auth: wrong
it("可信中转：relay_trusted 为 true", ...)
```

挂 `systemRoutes` 到 `new Hono<{ Bindings: Env }>().route("/", systemRoutes)`，env 只需 `{ APP_ENV: "test", RELAY_TRUST_TOKEN: token } as unknown as Env`（`/health` 不触碰 DB）。

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/api && npx vitest run src/routes/system-health-relay.test.ts`
Expected: FAIL（无 `relay_trusted` 字段）

- [ ] **Step 3: 实现**

`/health` 加 `relay_trusted: isTrustedRelay(c.req.raw.headers, c.env)`；status-center 的 `externalChecks` 数组加 `checkExternalHealth("api_relay_entry", c.env.API_RELAY_HEALTH_URL || "https://api-relay.hybcdg.com/api/v1/system/health")`；wrangler 两段 vars 同步加两键。

- [ ] **Step 4: 运行测试、守卫与类型检查**

Run: `cd packages/api && npx vitest run src/routes/system-health-relay.test.ts test/wrangler-prod-env.test.ts && npm run typecheck && npm run lint`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/routes/system.ts packages/api/src/routes/system-health-relay.test.ts packages/api/src/types/env.ts packages/api/wrangler.toml
git commit -m "feat(api): health 暴露 relay_trusted，监控中心探测 api-relay 入口"
```

---

### Task 4: bridge uvicorn relay 注入 `X-Relay-Auth`

**Files:**
- Modify: `bridge/app/config.py`（`Settings` 加 `relay_trust_token: str = os.getenv("RELAY_TRUST_TOKEN", "")`）
- Modify: `bridge/app/main.py:311-337`（`_filter_request_headers`）
- Create: `bridge/tests/__init__.py`（空）、`bridge/tests/test_relay_headers.py`
- Modify: `bridge/.env.example`（加 `RELAY_TRUST_TOKEN=replace-me` 与一行注释；`BRIDGE_HOST` 默认改 `127.0.0.1`）
- Modify: `bridge/README.md`（Generic API relay 小节补「注入 `X-Relay-Auth`」；Required env 补 `RELAY_TRUST_TOKEN`）

**Interfaces:**
- Produces: `_filter_request_headers(headers) -> dict[str, str]`：`blocked` 集合加入 `"x-relay-auth"`（丢弃客户端自带值）；当 `settings.relay_trust_token` 非空且不等于 `"replace-me"` 时设置 `safe_headers["X-Relay-Auth"] = settings.relay_trust_token`。

- [ ] **Step 1: 准备本地 venv 并写失败测试**

```bash
cd bridge && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt pytest
```

```python
# bridge/tests/test_relay_headers.py
from app import main

def test_injects_relay_auth_and_drops_client_value(monkeypatch):
    monkeypatch.setattr(main.settings, "relay_trust_token", "0123456789abcdef0123456789abcdef")
    out = main._filter_request_headers({"X-Relay-Auth": "forged", "Authorization": "Bearer t", "Host": "x"})
    assert out["X-Relay-Auth"] == "0123456789abcdef0123456789abcdef"
    assert out["Authorization"] == "Bearer t"
    assert "Host" not in out

def test_no_token_means_no_header(monkeypatch):
    monkeypatch.setattr(main.settings, "relay_trust_token", "")
    out = main._filter_request_headers({"X-Relay-Auth": "forged"})
    assert "X-Relay-Auth" not in out

def test_placeholder_token_is_ignored(monkeypatch):
    monkeypatch.setattr(main.settings, "relay_trust_token", "replace-me")
    assert "X-Relay-Auth" not in main._filter_request_headers({})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd bridge && .venv/bin/python -m pytest tests -q`
Expected: FAIL（`Settings` 无 `relay_trust_token`）

- [ ] **Step 3: 实现 config 与 header 注入；更新 `.env.example` 与 README**

- [ ] **Step 4: 运行测试与编译检查**

Run: `cd bridge && .venv/bin/python -m pytest tests -q && python3 -m compileall app`
Expected: 3 passed

- [ ] **Step 5: Commit**（`.venv` 已被 gitignore，确认 `git status` 不含它）

```bash
git add bridge/app/config.py bridge/app/main.py bridge/tests bridge/.env.example bridge/README.md
git commit -m "feat(bridge): /api 中继注入 X-Relay-Auth 可信中转头"
```

---

### Task 5: Caddy `api-relay` 站点、环境文件、部署脚本与 workflow

**Files:**
- Create: `scripts/deploy/bridge-caddy.sh`（可 `source` 的函数库）
- Create: `scripts/deploy/bridge-caddy.test.sh`
- Modify: `scripts/deploy/bridge-azure-vm.sh:105-173`
- Modify: `scripts/deploy/bridge-azure-update.sh:34-83`
- Modify: `.github/workflows/deploy-bridge-azure.yml`
- Modify: `scripts/deploy/README.md`

**Interfaces:**
- Produces（`bridge-caddy.sh`）：
  - `render_caddyfile BRIDGE_DOMAIN_LIST API_RELAY_DOMAIN API_RELAY_UPSTREAM`：向 stdout 输出完整 Caddyfile。bridge 段保持现状（`http://` + `https://` 两段反代 `127.0.0.1:9001`）；`API_RELAY_DOMAIN` 非空时追加：

    ```caddyfile
    https://API_RELAY_DOMAIN {
      encode zstd gzip
      request_body {
        max_size 100MB
      }
      reverse_proxy https://API_RELAY_UPSTREAM {
        header_up Host {upstream_hostport}
        header_up X-Relay-Auth {env.RELAY_TRUST_TOKEN}
        transport http {
          tls_server_name API_RELAY_UPSTREAM
          response_header_timeout 120s
        }
      }
    }
    ```
  - `install_caddy_env BRIDGE_ENV_FILE`：从 `bridge/.env` 读 `RELAY_TRUST_TOKEN`，写 `/etc/caddy/hybc.env`（`0640 root:caddy`），写 drop-in `/etc/systemd/system/caddy.service.d/hybc-env.conf`（`[Service]` + `EnvironmentFile=/etc/caddy/hybc.env`），`systemctl daemon-reload`。
  - `apply_caddy BRIDGE_ENV_FILE`：读 `BRIDGE_PUBLIC_DOMAIN`/`BRIDGE_EXTRA_DOMAINS`/`API_RELAY_PUBLIC_DOMAIN`/`API_RELAY_UPSTREAM`（后两者默认 `api-relay.hybcdg.com` / `api.hybcdg.com`），调用上面两个函数写 `/etc/caddy/Caddyfile`，`caddy validate --config /etc/caddy/Caddyfile`，`systemctl enable caddy && systemctl restart caddy`。
- 两份部署脚本删除各自的 Caddyfile heredoc，改为 `source "$(dirname "$0")/bridge-caddy.sh"` 后调用 `apply_caddy`；新增 env 透传：`API_RELAY_PUBLIC_DOMAIN`、`API_RELAY_UPSTREAM`、`RELAY_TRUST_TOKEN` 走与 `BRIDGE_PROXY_TOKEN` 相同的 `upsert_env`；`BRIDGE_HOST` 若未设置则 upsert 为 `127.0.0.1`。
- workflow：`source` 列表加 `scripts/deploy/bridge-caddy.sh`；`cp` 到 `$DEPLOY_ROOT/scripts/deploy/`；`export RELAY_TRUST_TOKEN="${{ secrets.AZURE_BRIDGE_RELAY_TRUST_TOKEN }}"`、`export API_RELAY_PUBLIC_DOMAIN="${{ vars.AZURE_BRIDGE_API_RELAY_DOMAIN }}"`（空则脚本取默认）；部署后新增非致命检查 `curl -fsS --max-time 8 "https://${API_RELAY_PUBLIC_DOMAIN:-api-relay.hybcdg.com}/api/v1/system/health" || echo "api-relay not reachable yet (DNS/cert pending)"`。

- [ ] **Step 1: 写失败测试 `bridge-caddy.test.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
source "$here/bridge-caddy.sh"
out="$(render_caddyfile "bridge.hybcdg.com" "api-relay.hybcdg.com" "api.hybcdg.com")"
grep -q '^https://bridge.hybcdg.com {' <<<"$out"
grep -q 'reverse_proxy 127.0.0.1:9001' <<<"$out"
grep -q '^https://api-relay.hybcdg.com {' <<<"$out"
grep -q 'reverse_proxy https://api.hybcdg.com {' <<<"$out"
grep -q 'header_up X-Relay-Auth {env.RELAY_TRUST_TOKEN}' <<<"$out"
! grep -q 'header_up -X-Relay-Auth' <<<"$out"
! grep -q '^http://api-relay' <<<"$out"
grep -q 'response_header_timeout 120s' <<<"$out"
grep -q 'max_size 100MB' <<<"$out"
# 不传 api-relay 域名时不输出该段
out2="$(render_caddyfile "bridge.hybcdg.com" "" "api.hybcdg.com")"
! grep -q 'api-relay' <<<"$out2"
echo "bridge-caddy.test.sh: ok"
```

- [ ] **Step 2: 运行确认失败**

Run: `bash scripts/deploy/bridge-caddy.test.sh`
Expected: 报错（`bridge-caddy.sh` 不存在）

- [ ] **Step 3: 实现 `bridge-caddy.sh`，改两份脚本与 workflow，更新 `scripts/deploy/README.md`**

`as_root`/`upsert_env` 已在两份脚本各自定义，`bridge-caddy.sh` 只用 `as_root`（调用方保证已定义）。

- [ ] **Step 4: 验证**

Run: `bash scripts/deploy/bridge-caddy.test.sh && bash -n scripts/deploy/bridge-azure-vm.sh && bash -n scripts/deploy/bridge-azure-update.sh`
Expected: `ok` 且无语法错误。若本机有 `caddy`，再跑 `render_caddyfile ... > /tmp/Caddyfile && caddy validate --config /tmp/Caddyfile --adapter caddyfile`。

- [ ] **Step 5: Commit**

```bash
git add scripts/deploy/bridge-caddy.sh scripts/deploy/bridge-caddy.test.sh scripts/deploy/bridge-azure-vm.sh scripts/deploy/bridge-azure-update.sh scripts/deploy/README.md .github/workflows/deploy-bridge-azure.yml
git commit -m "feat(deploy): Caddy 新增 api-relay 站点直通 Worker，令牌经环境文件注入"
```

---

### 运维门 A（合并 Task 1–5 之后、Task 8 之前；需 Cloudflare / GitHub / Lightsail 权限）

- [ ] 生成令牌：`openssl rand -hex 32`（64 字符）。
- [ ] Worker：`cd packages/api && npx wrangler secret put RELAY_TRUST_TOKEN --env prod`。
- [ ] GitHub：仓库 secret `AZURE_BRIDGE_RELAY_TRUST_TOKEN` 同值。
- [ ] Cloudflare DNS：`api-relay` A `13.114.172.128`、AAAA 取 `dig +short AAAA bridge.hybcdg.com`，**灰云**。
- [ ] 手动触发 `Deploy Azure Bridge` workflow（或合并即触发）。远端：`sudo systemctl status caddy`，`sudo caddy validate --config /etc/caddy/Caddyfile`，Caddy 日志出现 `api-relay.hybcdg.com` 证书签发成功。
- [ ] Lightsail 防火墙：放行 UDP 443；确认 9001 不再对外（`BRIDGE_HOST=127.0.0.1` 已生效：`ss -ltnp | grep 9001`）。
- [ ] Cloudflare zone：核对 WAF 托管规则 / Bot Fight Mode / zone 级 Rate Limiting 现状；若开启，为 `13.114.172.128` 加放行规则。
- [ ] 验证：
  ```bash
  curl -s https://api-relay.hybcdg.com/api/v1/system/health            # ok=true, relay_trusted=true
  curl -s -H 'X-Relay-Auth: bogus' https://api.hybcdg.com/api/v1/system/health   # relay_trusted=false
  curl -s https://bridge.hybcdg.com/api/v1/system/health                # relay_trusted=true（uvicorn 路径）
  ```
  再从 VM 上用 `ab`/`hey` 对 `https://api.hybcdg.com/api/v1/system/health` 并发 50、总量 2000 压一次，确认无 403/429/HTML challenge。

---

### Task 6: Web 附件地址归一 helper 并接入上传与四处渲染

**Files:**
- Create: `packages/web/src/utils/api-url.ts`
- Create: `packages/web/src/utils/api-url.test.ts`
- Modify: `packages/web/src/api/upload.ts:4-14`（`toAbsoluteApiUrl` 委托给 helper）
- Modify: `packages/web/src/views/project/workspace/file-panel.vue:197`
- Modify: `packages/web/src/views/project/workspace/project-panel.vue:2413`
- Modify: `packages/web/src/views/public/project-log.vue:1450`
- Modify: `packages/web/src/views/welcome/index.vue:102,111`

**Interfaces:**
- Produces:
  - `LEGACY_API_ORIGINS: readonly string[] = ["https://api.hybcdg.com"]`
  - `getApiBaseUrl(): string`：`import.meta.env.VITE_API_BASE_URL || ""` 去尾斜杠。
  - `normalizeApiUrl(url: string, base: string = getApiBaseUrl()): string`：空值原样返回；相对路径（以 `/` 开头或无 scheme）→ `base` 非空时拼接，否则原样；绝对地址且 `new URL(url).origin` ∈ `LEGACY_API_ORIGINS` 且 `base` 非空 → 替换 origin 为 `base`（保留 pathname/search/hash）；其余绝对地址原样；`blob:`/`data:` 原样。
- 视图层：`:href="normalizeApiUrl(item.file_url)"` 等；`welcome/index.vue` 的 `window.open(normalizeApiUrl(cert.fileUrl), ...)` 与 `link.href = normalizeApiUrl(cert.fileUrl)`（`blob:` 地址经 helper 后不变）。`PhaseUpload` 落库值不改。

- [ ] **Step 1: 写失败测试 `api-url.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { normalizeApiUrl } from "./api-url";

const base = "https://api-relay.hybcdg.com";

describe("normalizeApiUrl", () => {
  it("旧绝对地址换到当前基址，路径与查询串保留", () => {
    expect(normalizeApiUrl("https://api.hybcdg.com/api/v1/upload/object/a%2Fb.pdf?expires=1&signature=s", base))
      .toBe("https://api-relay.hybcdg.com/api/v1/upload/object/a%2Fb.pdf?expires=1&signature=s");
  });
  it("相对路径拼接基址", () => {
    expect(normalizeApiUrl("/api/v1/upload/object/k", base)).toBe("https://api-relay.hybcdg.com/api/v1/upload/object/k");
  });
  it("基址为空（本地开发）时一切原样", () => {
    expect(normalizeApiUrl("https://api.hybcdg.com/x", "")).toBe("https://api.hybcdg.com/x");
    expect(normalizeApiUrl("/api/v1/x", "")).toBe("/api/v1/x");
  });
  it("不是旧 origin 的绝对地址原样，包括前缀相似的恶意域与 blob:", () => {
    expect(normalizeApiUrl("https://api.hybcdg.com.evil.com/x", base)).toBe("https://api.hybcdg.com.evil.com/x");
    expect(normalizeApiUrl("https://files.example.com/x", base)).toBe("https://files.example.com/x");
    expect(normalizeApiUrl("blob:https://web.hybcdg.com/uuid", base)).toBe("blob:https://web.hybcdg.com/uuid");
  });
  it("空值原样", () => {
    expect(normalizeApiUrl("", base)).toBe("");
  });
  it("基址与旧 origin 相同（切换前）时等价于不改写", () => {
    expect(normalizeApiUrl("https://api.hybcdg.com/x", "https://api.hybcdg.com")).toBe("https://api.hybcdg.com/x");
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/web && npx vitest run src/utils/api-url.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 helper；`upload.ts` 的 `toAbsoluteApiUrl = (url) => normalizeApiUrl(url)`；四个视图接入**

- [ ] **Step 4: 运行测试、类型检查、lint**

Run: `cd packages/web && npx vitest run src/utils/api-url.test.ts && npm run typecheck && npm run lint:check`
Expected: PASS（lint:check 为 advisory，但本任务改动的文件不得新增错误）

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/utils/api-url.ts packages/web/src/utils/api-url.test.ts packages/web/src/api/upload.ts packages/web/src/views/project/workspace/file-panel.vue packages/web/src/views/project/workspace/project-panel.vue packages/web/src/views/public/project-log.vue packages/web/src/views/welcome/index.vue
git commit -m "feat(web): 附件地址归一到当前 API 基址（含存量绝对地址）"
```

---

### Task 7: Web 回退策略：直连 Worker 作为回退节点，502/503/504 触发

**Files:**
- Create: `packages/web/src/utils/http/fallback-policy.ts`
- Create: `packages/web/src/utils/http/fallback-policy.test.ts`
- Create: `packages/web/src/utils/http/relay-pool.test.ts`
- Modify: `packages/web/src/utils/http/index.ts:52-61`（删 `isNetworkFallbackError`，改用 helper）与 `:66`
- Modify: `packages/web/public/platform-config.json`（`ApiRelayPool`）

**Interfaces:**
- Produces: `shouldFallbackToRelay(error: { response?: { status?: number }; code?: string }): boolean`：无 `response` 且 `code` ∈ {`ECONNABORTED`,`ERR_NETWORK`,`ETIMEDOUT`,`ERR_CONNECTION_ABORTED`} → true；有 `response` 且 `status` ∈ {502,503,504} → true；其余 false。
- `platform-config.json`：
  ```json
  "ApiRelayPool": {
    "enabled": true,
    "maxAttempts": 1,
    "nodes": [
      { "id": "direct-worker", "baseUrl": "https://api.hybcdg.com", "priority": 10, "enabled": true,
        "statusPath": "/api/v1/system/health", "supportsWriteFallback": false, "probeTimeoutMs": 3000 }
    ]
  }
  ```
- Consumes: `relay-pool.ts` 现有 `getRelayCandidates(method, headers, currentBaseURL)`（排除 `baseUrl === current` 的节点、写请求无 `Idempotency-Key` 返回 `[]`）。

- [ ] **Step 1: 写失败测试**

`fallback-policy.test.ts`：
```ts
it("网络类错误触发", () => { for (const code of ["ECONNABORTED","ERR_NETWORK","ETIMEDOUT","ERR_CONNECTION_ABORTED"]) expect(shouldFallbackToRelay({ code })).toBe(true); });
it("主入口 502/503/504 触发", () => { for (const status of [502,503,504]) expect(shouldFallbackToRelay({ response: { status } })).toBe(true); });
it("其他响应不触发", () => { for (const status of [400,401,403,404,409,429,500]) expect(shouldFallbackToRelay({ response: { status } })).toBe(false); });
it("无 code 无 response 不触发", () => { expect(shouldFallbackToRelay({})).toBe(false); });
```

`relay-pool.test.ts`（`vi.mock("@/config", () => ({ getConfig: (key?: string) => ... }))` 返回上面的 `ApiRelayPool`；`vi.stubGlobal("fetch", vi.fn())`）：
```ts
it("基址仍是直连 Worker 时（切换前）候选为空，且不发探测", ...)      // getRelayCandidates("get", {}, "https://api.hybcdg.com") → []，fetch 未被调用
it("基址为 api-relay 时直连 Worker 成为候选", ...)                    // fetch 解析为 Response(JSON {ok:true}) → 候选 [direct-worker]
it("不带 Idempotency-Key 的 POST 没有候选，且不发探测", ...)
it("带 Idempotency-Key 的 POST 仍因 supportsWriteFallback=false 没有候选", ...)
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/web && npx vitest run src/utils/http`
Expected: FAIL（模块不存在 / 配置仍 disabled）

- [ ] **Step 3: 实现 helper，`index.ts` 的 `retryWithRelay` 改为 `if (!shouldFallbackToRelay(error)) throw error;`，更新 `platform-config.json`**

- [ ] **Step 4: 运行全部 web 测试与类型检查**

Run: `cd packages/web && npm test && npm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/utils/http/fallback-policy.ts packages/web/src/utils/http/fallback-policy.test.ts packages/web/src/utils/http/relay-pool.test.ts packages/web/src/utils/http/index.ts packages/web/public/platform-config.json
git commit -m "feat(web): 直连 Worker 作为 API 回退节点，502/503/504 触发读请求回退"
```

---

### 本地端到端验证（Task 7 合并后、Task 8 之前；对应 spec 5.7）

- [ ] `cd packages/web && VITE_API_BASE_URL=https://api-relay.hybcdg.com npm run build && npx vite preview --port 4173`，或在 Pages 的 Preview 分支把 `.env.staging` 指向 `api-relay` 部署一版。
- [ ] 走一遍：企微扫码登录、企微内 OAuth 登录、Passkey 登录与注册、上传附件、新附件预览、**历史单据里的旧附件预览与下载**（网络面板确认请求域名为 `api-relay`）、合同起草下载 docx、监控中心 `api_relay_entry` 为 up。
- [ ] 模拟东京故障：本机 hosts 把 `api-relay.hybcdg.com` 指到 `127.0.0.1` → 列表类 GET 应回退直连并成功；一次普通 POST 应报错而非重放。

---

### Task 8: 切换生产基址 + 上线 `diag.html`

**Files:**
- Modify: `packages/web/.env.production`、`packages/web/.env.staging`（`VITE_API_BASE_URL = https://api-relay.hybcdg.com`）
- Create: `packages/web/public/diag.html`

**Interfaces:**
- `diag.html`：无依赖的单页。对三个端点各 `fetch(url, { cache: "no-store" })` 5 次：`https://api.hybcdg.com/api/v1/system/health`、`https://api-relay.hybcdg.com/api/v1/system/health`、`https://bridge.hybcdg.com/api/v1/system/health`；表格列：入口、成功次数、最小/中位/最大耗时（ms）、`relay_trusted`；「复制结果」按钮把表格以文本写入剪贴板；页面标题「HYBC 网络诊断」。

- [ ] **Step 1: 写 `diag.html`，本地 `npm run dev` 打开 `http://localhost:8849/diag.html` 确认三行数据可出、复制可用**
- [ ] **Step 2: 改两份 env**
- [ ] **Step 3: 验证**

Run: `cd packages/web && npm run build && grep -l 'api-relay.hybcdg.com' dist/static/js/*.js | wc -l && grep -o 'https://api.hybcdg.com[^"]*' dist/static/js/*.js | sort -u`
Expected: 第一行 ≥ 1（新基址已进构建产物）；第二行列出的 `https://api.hybcdg.com` 出现处只应是 `LEGACY_API_ORIGINS` 常量的那一个字面量（回退节点配置在 `dist/platform-config.json`，不在 `static/js`）。

- [ ] **Step 4: Commit 并推送 PR；合并后 Pages 自动发布即切换**

```bash
git add packages/web/.env.production packages/web/.env.staging packages/web/public/diag.html
git commit -m "feat(web): API 基址切换到 api-relay.hybcdg.com，新增网络诊断页"
```

- [ ] **Step 5: 上线后 48 小时观察**：大陆同事打开 `https://web.hybcdg.com/diag.html` 复制结果回传；监控中心 `api_relay_entry` 持续 up；Worker 日志无 429 激增；附件可用。

---

### Task 9: 文档收尾

**Files:**
- Modify: `README.md:419-432`（部署表加一行 `api-relay.hybcdg.com`：网页端 API 入口，东京 VM Caddy 直通 Worker，随「Deploy Azure Bridge」部署；并在 bridge 行补「小程序经 uvicorn relay」）
- Modify: `doc/CLAUDE.md`（架构小节补一句网页端 API 经 `api-relay` 入口；Secrets 小节加 `RELAY_TRUST_TOKEN`）
- Modify: `CLAUDE.md`（根目录，Secrets 列表加 `RELAY_TRUST_TOKEN`）
- Modify: `doc/开发记录.md`（追加一条 `## 2026-MM-DD HH:MM (AEDT)` 条目：目标 / 变更 / 运维门 A 执行记录 / 验证 / 遗留，沿用现有格式）
- Modify: `docs/planned/README.md`（移除本条目）、`docs/archive/README.md`（「架构与重构」下加本 spec 与 plan 两个文件名）
- Move: 本 spec 与本 plan 到 `docs/archive/`

- [ ] **Step 1: 按上表改文档；`git mv` 两份文档**
- [ ] **Step 2: 检查链接**

Run: `grep -rn '2026-10-31-mainland-web-acceleration-via-bridge' README.md doc docs | grep -v archive`
Expected: 除 `开发记录.md` 的叙述外无指向旧路径的链接

- [ ] **Step 3: Commit**

```bash
git add README.md CLAUDE.md doc/CLAUDE.md doc/开发记录.md docs
git commit -m "docs: 网页端 API 经 api-relay 东京入口上线记录与文档归档"
```

---

## 自检记录（写完计划后对照 spec）

- Spec 5.1 → Task 5 + 运维门 A；5.2 → Task 6/7/8；5.3 → Task 1/2/4；5.4 → Task 5；5.5 → 运维门 A；5.6 → Task 3；5.7 → 本地端到端验证节；5.8 → Task 5（Set 替换客户端头）与 Task 4（blocked 集合）；6 影响面各行均有归属；7 分期与「任务顺序与上线门」一致；8 回滚 = revert Task 8 的提交。
- 类型一致性：`resolveClientIp(headers: Headers, env: Pick<Env,"RELAY_TRUST_TOKEN">)` 在 Task 1/2/3 一致；`normalizeApiUrl(url, base?)` 在 Task 6/8 一致；`shouldFallbackToRelay` 只在 Task 7。
- Review Focus 五条分别落在 Task 1（1、2）、Task 7（3）、Task 6（4）、Task 3（5）的测试里。
