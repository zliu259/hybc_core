# 网页端同域名整站镜像 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `web.hybcdg.com` 灰云直出东京 VM，Caddy 用 DNS-01 预签证书并反代 Pages 源站，切换与回滚只改 DNS。

**Architecture:** 复用 `scripts/deploy/bridge-caddy.sh` 的模板函数库：新增 web 站点段（`/api/*` → Worker，其余 → `hybc-core.pages.dev`，`Location` 改回本域名，`tls dns cloudflare`），新增「带 cloudflare DNS 模块的 Caddy 自定义构建」安装函数（dpkg-divert + alternatives），Caddy 环境文件多写 `CF_DNS_API_TOKEN`。workflow 透传新 secret/var 并用 `--resolve` 自检。Worker 状态中心加 `web_entry`。

**Tech Stack:** bash · Caddy 2（caddy-dns/cloudflare）· GitHub Actions · Hono/Workers

**Spec:** `docs/superpowers/specs/2026-10-31-web-mirror-same-domain-design.md`

## Global Constraints

- 新键：`WEB_PUBLIC_DOMAIN`（空/`none` = 关）、`WEB_STATIC_UPSTREAM`（默认 `hybc-core.pages.dev`）、`CF_DNS_API_TOKEN`；GitHub：secret `AZURE_BRIDGE_CF_DNS_API_TOKEN`，var `AZURE_BRIDGE_WEB_DOMAIN`、`AZURE_BRIDGE_WEB_UPSTREAM`。
- web 站点只声明 `https://`；`tls { dns cloudflare {env.CF_DNS_API_TOKEN}  resolvers 1.1.1.1 1.0.0.1 }`；`header_up Host hybc-core.pages.dev`；`header_down Location https://hybc-core.pages.dev https://web.hybcdg.com`；`/api/*` 段与 api-relay 站点同款（`X-Relay-Auth` Set 语义，不加删除指令）。
- 没有 `CF_DNS_API_TOKEN` 时不渲染 web 站点（避免 ACME 空转）；只有渲染 web 站点时才安装自定义 Caddy。
- 自定义 Caddy：下载 `https://caddyserver.com/api/download?os=linux&arch=<arch>&p=github.com%2Fcaddy-dns%2Fcloudflare`，`uname -m` x86_64→amd64、aarch64/arm64→arm64；校验 `list-modules` 含 `dns.providers.cloudflare` 再安装；`dpkg-divert --divert /usr/bin/caddy.default --rename /usr/bin/caddy`、`/usr/bin/caddy.custom`、`update-alternatives --set caddy /usr/bin/caddy.custom`；已含模块则跳过。
- 提交信息 `<type>: <description>`，无 AI 署名 trailer。

## Review Focus

1. `WEB_PUBLIC_DOMAIN` 配了但 `CF_DNS_API_TOKEN` 为空：不得渲染 web 站点（Task 1 测试）。
2. 现有 3 参数调用 `render_caddyfile` 不得变化（Task 1 测试）。
3. Pages 308 的 `Location` 必须改回本域名（Task 1 模板断言；切换前 `--resolve` 实测）。
4. `caddy_download_url` 对未知架构必须失败而非下载错误二进制（Task 1 测试）。
5. 令牌不得进 journal/CI：沿用去 `--environ` 的 drop-in；workflow 的自检只打印 HTTP 状态（Task 2）。

---

### Task 1: Caddy 模板库——web 站点、自定义构建安装、env 文件

**Files:** Modify `scripts/deploy/bridge-caddy.sh`、`scripts/deploy/bridge-caddy.test.sh`

**Interfaces（Produces）:**
- `render_caddyfile BRIDGE_DOMAINS API_RELAY_DOMAIN API_RELAY_UPSTREAM [WEB_DOMAIN] [WEB_UPSTREAM]`：第 4 参非空时追加 web 站点段。
- `caddy_download_url MACHINE`：`x86_64`→amd64 URL，`aarch64|arm64`→arm64 URL，其它返回 1。
- `ensure_caddy_cloudflare_dns`：`caddy list-modules` 已含 `dns.providers.cloudflare` → 直接返回 0；否则下载、校验、divert、alternatives。
- `install_caddy_env ENV_FILE`：同时写 `RELAY_TRUST_TOKEN` 与 `CF_DNS_API_TOKEN`。
- `apply_caddy ENV_FILE`：解析 `WEB_PUBLIC_DOMAIN`/`WEB_STATIC_UPSTREAM`/`CF_DNS_API_TOKEN`；域名非空且非 `none` 且 token 非空 → `ensure_caddy_cloudflare_dns` + 渲染 web 段；token 空则告警并跳过 web 段。

- [ ] Step 1 写失败测试（追加到 `bridge-caddy.test.sh`）：web 段存在性与内容（`https://web.hybcdg.com {`、`dns cloudflare {env.CF_DNS_API_TOKEN}`、`resolvers 1.1.1.1`、`reverse_proxy https://hybc-core.pages.dev`、`header_up Host hybc-core.pages.dev`、`header_down Location https://hybc-core.pages.dev https://web.hybcdg.com`、`handle /api/*`、不含 `^http://web`）；3 参调用不含 web；`caddy_download_url` 三例；`ensure_caddy_cloudflare_dns` 在 PATH 里放假 `caddy`（`list-modules` 输出含模块）时返回 0 且不调用 curl（假 `curl` 命中即 fail）。
- [ ] Step 2 运行 `bash scripts/deploy/bridge-caddy.test.sh` → FAIL（函数不存在）。
- [ ] Step 3 实现；Step 4 测试通过 + `bash -n`。
- [ ] Step 5 Commit `feat(deploy): Caddy 模板新增 web.hybcdg.com 整站镜像站点与 cloudflare DNS 构建安装`。

### Task 2: 部署脚本与 workflow 透传、自检

**Files:** Modify `bridge-azure-vm.sh`、`bridge-azure-update.sh`、`.github/workflows/deploy-bridge-azure.yml`、`scripts/deploy/README.md`、`bridge/.env.example`

- 两份脚本：`WEB_PUBLIC_DOMAIN`、`WEB_STATIC_UPSTREAM`、`CF_DNS_API_TOKEN` 非空即 `upsert_env`。
- workflow：`export CF_DNS_API_TOKEN="${{ secrets.AZURE_BRIDGE_CF_DNS_API_TOKEN }}"`、`export WEB_PUBLIC_DOMAIN="${{ vars.AZURE_BRIDGE_WEB_DOMAIN }}"`、`export WEB_STATIC_UPSTREAM="${{ vars.AZURE_BRIDGE_WEB_UPSTREAM }}"`；部署后 `caddy version`；若 web 域名启用：`curl -sS -o /dev/null -w '%{http_code}' --max-time 15 --resolve "${WEB_PUBLIC_DOMAIN}:443:127.0.0.1" "https://${WEB_PUBLIC_DOMAIN}/platform-config.json"`，非 200 只告警。
- [ ] `bash -n` 两脚本、`python3 -c yaml.safe_load` workflow；Commit `feat(deploy): 透传 web 镜像域名与 Cloudflare DNS token，部署后 --resolve 自检`。

### Task 3: Worker 状态中心 `web_entry`

**Files:** Modify `packages/api/src/routes/system.ts`、`src/types/env.ts`、`wrangler.toml`（两段）
- `WEB_ENTRY_HEALTH_URL?: string`，默认 `https://web.hybcdg.com/platform-config.json`；`checkExternalHealth("web_entry", …)`。
- [ ] `vitest run test/wrangler-prod-env.test.ts src/routes/system` + typecheck + lint；Commit `feat(api): 状态中心探测网页端入口 web_entry`。

### 运维门 B（owner）
- [ ] Cloudflare 控制台 → My Profile → API Tokens → Create Token → 自定义：权限 `Zone / Zone / Read` + `Zone / DNS / Edit`，Zone Resources：Include → Specific zone → `hybcdg.com`。
- [ ] `gh secret set AZURE_BRIDGE_CF_DNS_API_TOKEN --repo zliu259/hybc_core`（粘贴 token）。
- [ ] 本机保存一份给 Claude：`mkdir -p ~/.hybc && umask 077 && cat > ~/.hybc/cf-dns-token`（粘贴后 Ctrl-D）。

### Task 4: 预签证书与切换前验证（Claude）
- [ ] 合并 PR → workflow 跑一次（web 站点仍关）。
- [ ] `gh variable set AZURE_BRIDGE_WEB_DOMAIN --body web.hybcdg.com` → `gh workflow run deploy-bridge-azure.yml --ref main` → 日志出现 `Caddy configured: … web=[web.hybcdg.com]`，`caddy version` 为自定义构建。
- [ ] 本机验证（DNS 未切）：`curl --resolve web.hybcdg.com:443:13.114.172.128 -sI https://web.hybcdg.com/` 200 且证书 CN=web.hybcdg.com；`/diag.html` → 308 `Location: https://web.hybcdg.com/diag`；`/platform-config.json` 200；入口 chunk 200 且 `cache-control: public, max-age=31536000`；`/login` 200 HTML；`/WW_verify_sVPd1Q6fW7UMqLN2.txt` 200；`/api/v1/system/health` `relay_trusted=true`。
- [ ] 浏览器（本机 hosts 指向 VM）打开登录页无报错，网络面板所有静态请求 200。

### Task 5: DNS 切换与观察（Claude，用 owner 的 token）
- [ ] `GET /zones/a1b20d98dbed6a52bcf1adc44b5863f6/dns_records?name=web.hybcdg.com` 记下记录 id 与原值（CNAME → `hybc-core.pages.dev`，proxied true）。
- [ ] `PUT` 该记录为 `A 13.114.172.128 proxied=false ttl=300`；`POST` 新增 `AAAA 2406:da14:33e:c700:7141:8509:bd15:77bc proxied=false ttl=300`。
- [ ] 60 s 后 `dig @1.1.1.1 web.hybcdg.com` 为 VM IP；`curl -sI https://web.hybcdg.com/` 200，`server` 头不再是 cloudflare；浏览器打开登录页；owner 登录一次、打开一个旧附件。
- [ ] 回滚（仅需要时）：删 AAAA，`PUT` 记录回 `CNAME hybc-core.pages.dev proxied=true`。

### Task 6: 文档
- [ ] README 部署表 Web 行、架构图；`CLAUDE.md`（根）部署说明；`doc/开发记录.md` 条目；spec/plan 归档到 `docs/archive/`，`docs/archive/README.md` 加条目。
