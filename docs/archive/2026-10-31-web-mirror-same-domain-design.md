# 网页端同域名整站镜像：`web.hybcdg.com` 直出东京 VM，Caddy 反代 Pages 源站 设计

日期：2026-10-31 · 状态：owner 已批准（2026-10-31「推进整站镜像」）· 承接 `docs/archive/2026-10-31-mainland-web-acceleration-via-bridge-design.md`（API 入口已于当日上线）

## 1. 为什么要做

API 切到 `api-relay.hybcdg.com` 后，大陆同事反馈接口快了，但「打开页面」仍慢。实测登录页每次打开必须跨境回 Cloudflare 边缘的请求有四个：`index.html`（`max-age=0, must-revalidate`，边缘 DYNAMIC）、`platform-config.json`（同）、根目录两张无 hash 的 PNG（`REVALIDATED`）；发版后还要重拉几 MB 的 js chunk，且部分 chunk 在边缘 MISS。这些全部走「浏览器 → Cloudflare 边缘」这段慢链路。

owner 要求：同域名镜像，不改用户访问的地址。

## 2. 方案

`web.hybcdg.com` 的 DNS 从橙云 CNAME 改为灰云 A/AAAA 直出到现有东京 VM（与 `bridge` / `api-relay` 同机同 IP）。VM 上的 Caddy 新增 `web.hybcdg.com` 站点：

- 其余路径流式反代 Pages 源站 `https://hybc-core.pages.dev`（`Host` 改写为源站域名），并把响应 `Location` 头里的 `https://hybc-core.pages.dev` 改回 `https://web.hybcdg.com`（Pages 会对 `/diag.html` 一类路径发 308 去扩展名跳转）。
- `/api/*` 同时反代 Worker（与 `api-relay` 站点同一段配置），让网页域名自带同源 API 能力；当前 Web 构建仍用绝对基址 `api-relay`，这段只是兜底。
- 证书走 **DNS-01（Cloudflare）**：可以在 DNS 仍指向 Cloudflare 时就预先签发，切换瞬间没有 TLS 握手失败窗口。需要 Caddy 带 `caddy-dns/cloudflare` 模块的构建，和一个 Cloudflare API Token。
- Pages 继续作为静态源站自动构建；不新增第二条发布流水线；Pages 项目里的自定义域名绑定**保留不删**（回滚只改 DNS）。

```text
大陆用户 ── https (h2/h3) ──> web.hybcdg.com = 东京 VM Caddy
                               ├── /api/*  → https://api.hybcdg.com（X-Relay-Auth）
                               └── /*      → https://hybc-core.pages.dev（Host 改写，Location 改回）
网页端 API 主入口仍是 api-relay.hybcdg.com（同机），回退直连 api.hybcdg.com
```

## 3. 目标 / 非目标 / 反目标

目标：登录页首屏、`index.html`、`platform-config.json`、chunk、图片全部不再经 Cloudflare 边缘；域名、Passkey RP ID、企微可信域名与回调、同事收藏全部不变；切换与回滚都只改 DNS；Pages 仍是唯一静态构建源。

非目标：不在 VM 落静态文件、不加第二条构建流水线；不做 VM 侧 HTTP 缓存层（东京到 Cloudflare 东京边缘几十毫秒）；不改 Web 代码；不处理 `vertex-beta.hybcdg.com`。

反目标：切换瞬间证书未就绪导致 TLS 失败；用户被 Pages 跳转带到 `pages.dev` 源站域名（origin 变了，登录与 Passkey 失效）；apt 升级把带 DNS 模块的 Caddy 换回官方包导致续期静默失败；令牌进 journal 或 CI 日志。

## 4. 关键决策

1. **证书 DNS-01**：Token 需 `Zone:Zone:Read` + `Zone:DNS:Edit`，Zone Resources 限定 `hybcdg.com`（caddy-dns/cloudflare 要求两项权限；若单 token 的 zone 查询失败，再拆成 `zone_token` + `api_token` 两个）。`tls { dns cloudflare {env.CF_DNS_API_TOKEN}  resolvers 1.1.1.1 1.0.0.1 }`。
2. **Caddy 自定义构建**：从 `https://caddyserver.com/api/download?os=linux&arch=<amd64|arm64>&p=github.com%2Fcaddy-dns%2Fcloudflare` 下载，按 Caddy 官方「apt 包 + 自定义构建」方式安装：`dpkg-divert --divert /usr/bin/caddy.default --rename /usr/bin/caddy`，自定义二进制放 `/usr/bin/caddy.custom`，`update-alternatives` 把 `/usr/bin/caddy` 指向 custom；apt 升级只会更新 `.default`，不会碰 alternatives。systemd 单元与现有 drop-in（`EnvironmentFile`、去 `--environ` 的 `ExecStart`）原样复用。只在配置了 web 域名时才下载替换。
3. **令牌落点**：`CF_DNS_API_TOKEN` 走 GitHub secret `AZURE_BRIDGE_CF_DNS_API_TOKEN` → `bridge/.env` → `/etc/caddy/hybc.env`（0640 root:caddy），与 `RELAY_TRUST_TOKEN` 同路。同一个 Token 本机也保存一份（`~/.hybc/cf-dns-token`，0600）供 Claude 通过 Cloudflare API 执行 DNS 切换与回滚。
4. **开关**：`WEB_PUBLIC_DOMAIN`（GitHub var `AZURE_BRIDGE_WEB_DOMAIN`）为空或 `none` 时不渲染 web 站点、不换 Caddy 二进制；合并代码不改变 VM 行为，等 Token 就位后置为 `web.hybcdg.com` 再重跑 workflow 预签证书。`WEB_STATIC_UPSTREAM` 默认 `hybc-core.pages.dev`。
5. **Host 头**：对 Pages 源站显式 `header_up Host hybc-core.pages.dev`（不带端口），`tls_server_name` 同值。
6. **部署自检**：workflow 在 VM 上用 `curl --resolve web.hybcdg.com:443:127.0.0.1` 打本机，DNS 未切就能验证证书与反代；失败只告警不致命（签发可能晚于重启几十秒）。
7. **监控**：状态中心新增 `web_entry`（`WEB_ENTRY_HEALTH_URL`，默认 `https://web.hybcdg.com/platform-config.json`）。
8. **切换与回滚**：Cloudflare API 把 `web` 记录由 CNAME（proxied）改为 A `13.114.172.128` + AAAA `2406:da14:33e:c700:7141:8509:bd15:77bc`（proxied false）；回滚反向改回 CNAME `hybc-core.pages.dev` proxied true，Pages 自定义域名重新激活是分钟级。切换前先用 `--resolve` 从本机做完整验证（首页、chunk、`/diag.html` 308 → `web.hybcdg.com/diag`、`/login`、`WW_verify` 文件、`/api/v1/system/health`）。

## 5. 影响面

`scripts/deploy/bridge-caddy.sh`（web 站点模板、自定义构建安装、env 文件多一键）、`bridge-caddy.test.sh`、`bridge-azure-vm.sh` / `bridge-azure-update.sh`（透传三个新键）、`.github/workflows/deploy-bridge-azure.yml`（secret/var、自检）、`scripts/deploy/README.md`、`packages/api/src/routes/system.ts` + `types/env.ts` + `wrangler.toml`（`web_entry`）、`README.md` / `CLAUDE.md` / `doc/开发记录.md`。企微后台、Web 代码、Pages 项目：无改动。

## 6. 风险

| 风险 | 应对 |
|------|------|
| VM 单点扩大到整站 | 已是 API/小程序/企微回调单点；DNS 一步回滚；后续第二节点 |
| Token 权限不足导致 DNS-01 失败 | 预签阶段即暴露；拆双 token 或补 Zone:Read |
| apt 覆盖二进制 | dpkg-divert + alternatives |
| Pages 域名回滚激活延迟 | 保留绑定；TTL 自动（300s）；切换选低峰 |
| pages.dev 响应带 `x-robots-tag: noindex` | 内部系统，正好 |
| 海外 owner 多绕东京 | 可接受 |
