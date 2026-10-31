# 大陆网页端加速：Web 的 API 流量经东京 bridge 反代 设计

日期：2026-10-31 · 状态：**owner 已批准 v2（2026-10-31「推进吧」）**；共用现有东京 VM，不单独开机（owner 2026-10-31 询问后采纳建议）；不以 Phase 0 测量为门槛，`diag.html` 改为上线后验证工具；第 10 节其余未答项按第 11 节默认决定执行 · 实施计划见 `docs/archive/2026-10-31-mainland-web-acceleration-via-bridge.md`
v1 曾提议把 `web.hybcdg.com` 整体切到 bridge；owner 2026-10-31 反馈 Pages 静态加载可接受且有缓存，**只要把 API 反代到东京服务器**。本版据此收窄：网页端宿主不动，只改 API 入口。v1 的事实调查与审阅结论保留在第 2 节。

## 1. 为什么要做

大陆同事用 `web.hybcdg.com` 时慢在 API：页面本身（Pages，`/static/*` 浏览器长缓存）只在首次或发版后拉一次，之后每天几百次的 JSON 请求、附件上传、附件预览才是日常感受。这些请求全部打到 `api.hybcdg.com`，它挂在 Cloudflare 边缘（橙云 anycast），大陆到 Cloudflare 边缘这一跳受跨境链路与 GFW 干扰，时快时慢、晚高峰尤差。慢的不是 Worker 里的业务处理，而是「浏览器 → Cloudflare 边缘」这一段。

现有兜底对这个症状无效：2026-03 的《Worker 主入口 + Azure HK Bridge 兜底方案》把 bridge 做成「网络错误才切」的被动 relay，「慢但能通」永远触发不了，且 Web 侧 `ApiRelayPool.enabled` 目前为 `false`。

小程序自 2026-03-16 起就把 `bridge.hybcdg.com` 当 API 主入口（`packages/miniapp/utils/config.js` 的 `FORCE_HK_BRIDGE_PRIMARY = true`），同一批大陆用户在小程序里没有同等级别的抱怨，说明「大陆 → 东京 VM → Cloudflare」这条路通且快。本方案就是让网页端的 API 也走这条路，并且走得比小程序更好（不经 Python 缓冲层）。

## 2. 现状（2026-10-31 调查）

### 域名与部署

| 域名 | 解析 | 承载 |
|------|------|------|
| `web.hybcdg.com` | Cloudflare 橙云 | Pages 项目 `hybc-core`，**本方案不动** |
| `api.hybcdg.com` | Cloudflare 橙云 | Worker `hybc-api-prod`，以 route 形式绑定（`wrangler.toml` `[env.prod] routes`） |
| `bridge.hybcdg.com` | 灰云直出，A `13.114.172.128` + AAAA | AWS Lightsail 东京 VM（2026-07-09 从 Azure HK 迁来；workflow 名字仍叫 Azure） |

bridge VM 上：Caddy（apt 版，systemd 单元没有 `EnvironmentFile`）终结 TLS（Let's Encrypt HTTP-01）→ `127.0.0.1:9001` uvicorn 单进程 FastAPI（`--proxy-headers --forwarded-allow-ips=*`，监听 `0.0.0.0`）。Caddyfile 由 `scripts/deploy/bridge-azure-vm.sh` 与 `bridge-azure-update.sh` 两处各自生成；`Deploy Azure Bridge` workflow 每次都以 `LOCAL_BUNDLE=true bash scripts/deploy/bridge-azure-vm.sh` 重写 Caddyfile 并重启 Caddy，只备份/恢复 `bridge/.env`。改 Caddy 相关的任何东西都必须落在脚本里。workflow 只在 `bridge/**`、两个脚本或 workflow 本身变更时触发。

bridge 已有的通用 `/api/*` relay（`bridge/app/main.py`）：全量缓冲请求/响应体、强制 `Accept-Encoding: identity`、`max_inflight 120`、上游超时 30 s、带过载拒绝与 `/relay/status`。因为前面有 Caddy 清洗 `X-Forwarded-*`、uvicorn 又开了 proxy-headers，relay 注入的 `X-Forwarded-For` 首跳**今天就已经是真实客户端 IP**；问题在 Worker 侧不看它（见下）。FastAPI 没有 CORS 中间件：浏览器直接 `fetch` `/relay/status` 会被 CORS 拦（Web 端 relay pool 的探测在浏览器里本来就跑不通）；经 relay 透传的 Worker 响应带 `access-control-allow-origin: *`，不受影响。

### Web 端绑定点

- API 基址在构建期固化：`VITE_API_BASE_URL = https://api.hybcdg.com`（`.env.production` / `.env.staging`）。Web 对 API **今天就是跨域**（`web.` → `api.`），带 `X-Requested-With`，每个非简单请求都有 OPTIONS 预检；换成另一个 API 域名不会增加预检次数。
- 登录态：JWT 存在 Web 自己 origin 的 cookie 里只作客户端存储，发请求时放 `Authorization` 头，不依赖跨站 cookie。
- `src/utils/http/index.ts`：只在 `ERR_NETWORK` / 超时 / 连接中断时才走 `relay-pool.ts` 的候选；5xx 响应不触发。候选节点来自运行时加载的 `public/platform-config.json`（`ApiRelayPool`，当前 `enabled: false`，唯一节点是 `bridge.hybcdg.com`）；写请求只在带 `Idempotency-Key` 时允许回退。Web 只有付款/合同几个写接口可选地带该头，其余写请求不带。
- 附件绝对地址不止一处：
  - `src/api/upload.ts`：`uploadAttachmentFile` 直接 `fetch(resolveUploadUrl(uploadUrl))`，`resolveViewableFileUrl` 返回签名后的绝对地址。
  - `components/PhaseUpload/index.vue` 把 API 返回的绝对 `signed.fileUrl` 写进业务模型并随单据落库；**历史数据里已经持久化了 `https://api.hybcdg.com/...`**。
  - 直接把 `file_url` / `fileUrl` 塞进 `<el-link :href>` 或 `window.open` 的视图：`views/project/workspace/file-panel.vue`、`project-panel.vue`、`views/public/project-log.vue`、`views/welcome/index.vue`。这些都不经过 `upload.ts`。
  - API 侧绝对地址生产点 3 个文件：`routes/upload.ts`、`routes/public-project-log.ts`、`routes/warehouse-work-order.ts`，基址由 `WECOM_PUSH_API_BASE_URL`（`https://api.hybcdg.com`）决定。小程序在 2026-09 已有 `toRelativeApiPath()` 的先例。
- 企微 OAuth `redirect_uri`、企微 JS-SDK 签名、Passkey RP ID（`web.hybcdg.com`）都挂在**网页 origin** 上，与 API 域名无关；本方案不触碰。
- Web 没有 SSE / WebSocket / 流式响应，全部是普通 JSON 与文件 PUT/GET。

### API 端绑定点

- CORS `origin: "*"`。
- 客户端 IP 取值 `cf-connecting-ip` 优先，`x-forwarded-for` 其次，共 4 处：`middleware/rate-limit.ts`、`routes/passkeys.ts`（2 处审计 IP）、`routes/public-project-log.ts`（IP 哈希）。经任何 VM 中转后 `cf-connecting-ip` 都是中转机的 IP。**这不是预防，是现存问题**：小程序登录接口 `auth:login:miniapp`（20 次/300 s/IP）今天就已经被全体小程序用户共享 bridge 的一个 IP；网页端 API 一旦也走 VM，`auth:login:web`（20 次/300 s）与 `refresh-token`（30 次/300 s）会立刻被打平，早高峰必出 429。
- `GET /api/v1/system/health` 只回 `{ok, service, env, now}`，极轻，可作探测目标。
- `routes/system.ts` 健康检查已探测 `BRIDGE_HEALTH_URL` 与 `RELAY_STATUS_URLS`，但 `wrangler.toml` 没配 `RELAY_STATUS_URLS`。

### Cloudflare 平台事实（官方文档）

- 请求体上限按 zone 套餐：Free/Pro 100 MB，Business 200 MB。
- 同 zone 内 Worker/Pages Function 对 route 绑定的 Worker 发公网 `fetch` 会失败。v1 需要它，本版不再需要（网页宿主不动，没有双宿主问题）。

### 其他直连 `api.hybcdg.com` 的调用方（本方案不动）

小程序（经 bridge uvicorn relay）、`packages/mcp`、task-runner、`.cf-runner-container`、bridge 自身的 ingest 转发、企微推送里的 API 基址。

### 测量

本机（海外）测得 `api.hybcdg.com` 与 `bridge.hybcdg.com/api/...` 首字节都在 0.5～0.8 s，海外看不出差别；**没有大陆样本**。

## 3. 目标、非目标、反目标

### 目标

1. 大陆用户在网页端发出的全部 API 请求（JSON、附件上传直传、附件预览与下载，含历史单据里的存量附件）改走东京 VM，不再经 Cloudflare 边缘。
2. 网页地址、登录方式（企微扫码/OAuth/Passkey）、企微卡片链接全部不变，用户无感。
3. 东京入口故障时读请求自动回退到 `api.hybcdg.com` 直连；整体回滚只需一次 Web 发布。
4. 数据面与 Worker 业务逻辑零改动；`api.hybcdg.com` 继续留在 Cloudflare 供其他调用方使用。

### 非目标

- 不动 `web.hybcdg.com` 的宿主与 DNS（owner 2026-10-31 决定）。
- 不改小程序链路；不给 bridge uvicorn relay 做性能改造。
- 不在本期做多 relay 节点、负载择优；不办 ICP、不上 China Network。
- 不回填数据库里已持久化的绝对附件地址（渲染时归一即可覆盖）。
- 不为了写请求自动回退而给 Web 全面加 `Idempotency-Key`。

### 反目标（做成了也算失败）

- 限流/审计把全体网页用户记成 VM 的一个 IP（登录、刷新令牌误报 429，审计 IP 失真）。
- 网页端 API 流量挤进 uvicorn 单进程缓冲式 relay，与小程序抢 120 个并发位、大附件在 Python 内存里整份缓冲。
- 东京 VM 一挂，网页端整体不可用且只能等人工发布。
- 附件链接仍悄悄走 `api.hybcdg.com`，用户感觉「列表快了、附件还是慢」。

## 4. 入口形态比较与选择

| | A. 新域名 `api-relay.hybcdg.com`，Caddy 直接反代 Worker（**推荐**） | B. 直接把基址指到现有 `bridge.hybcdg.com`（uvicorn relay） | C. 改 `bridge.hybcdg.com` 的 Caddy，让 `/api/*` 绕过 uvicorn |
|---|---|---|---|
| 基础设施改动 | Caddy 加一个站点段 + 一条 DNS 记录 | 零 | 改现有站点段 |
| 请求体 | 流式，100 MB 不进 Python 内存 | Python 整份缓冲，受 VM 内存限制 | 流式 |
| 与小程序隔离 | 完全隔离，超时/体积单独调 | 共用 120 并发位与 30 s 上游超时 | 小程序一起改走 Caddy，失去过载拒绝与 `/relay/status` 语义 |
| 证书 | 新域名从零指向 VM，HTTP-01 自动签，**无切换窗口** | 已有 | 已有 |
| 后续迁小程序 | 可选，另起一期 | 不涉及 | 被迫一起迁 |

选 A。B 只适合作为 Phase 0 的测量工具（它今天就能用）。C 的血 radius 包含小程序，不值得。

## 5. 目标架构（方案 A）

```text
浏览器 @ web.hybcdg.com（Pages，不动）
   │ 静态：Pages / Cloudflare（不动）
   │ API： https://api-relay.hybcdg.com  ── 灰云直出 → Lightsail 东京 VM（Caddy）
   │                                         └─ reverse_proxy https://api.hybcdg.com（流式，带 X-Relay-Auth）
   └ 回退：api-relay 网络错误/502/503/504 时，读请求改打 https://api.hybcdg.com（直连 Cloudflare）

小程序 ──> bridge.hybcdg.com（Caddy → uvicorn relay）→ api.hybcdg.com     不变
MCP / task-runner / runner 容器 / bridge ingest ──> api.hybcdg.com         不变
```

### 5.1 东京入口：`api-relay.hybcdg.com`（我拟的名字，可改）

- DNS：A `13.114.172.128` + AAAA，灰云直出（不能橙云，否则又回到 Cloudflare 边缘）。
- Caddy 站点段（只写 `https://`，不显式声明 `http://` 站点，让 Caddy 自动 301）：`reverse_proxy https://api.hybcdg.com`，`header_up Host {upstream_hostport}`，`transport http { tls_server_name api.hybcdg.com }`；**先删后设** `X-Relay-Auth`（丢弃客户端自带的，再写入 `{env.RELAY_TRUST_TOKEN}`）；Caddy 对非 `trusted_proxies` 来源默认丢弃并重写 `X-Forwarded-*`，所以 `X-Forwarded-For` 只会是一个值：真实客户端 IP。响应/读取超时放宽到 120 s 覆盖大附件；`request_body max_size` 与 zone 套餐上限对齐（Free/Pro 100 MB）。`encode zstd gzip` 给客户端压缩。
- 证书：新域名一开始就指向 VM，现有 HTTP-01 流程直接可用。**不需要** v1 的 DNS-01、换 Caddy 二进制、`apt-mark hold`。
- CORS：Worker 的 `access-control-allow-origin: *` 等头原样透传；OPTIONS 预检照常转给 Worker（今天也是这样，只是终点从 Cloudflare 边缘变成东京）。
- Lightsail 防火墙放行 UDP 443（HTTP/3 对丢包链路有帮助）；顺手把 uvicorn 收到 `127.0.0.1:9001` 或在防火墙封掉 9001。
- 网页 API 流量只经 Caddy，不进 uvicorn，小程序 relay 不受影响。

### 5.2 Web 改基址 + 附件地址归一 + 自动回退

- `VITE_API_BASE_URL = https://api-relay.hybcdg.com`（`.env.production`、`.env.staging`）。
- 新增归一 helper（放 `src/utils/`）：凡 origin 为 `https://api.hybcdg.com` 的绝对地址，把 origin 替换为当前 API 基址；其余原样返回。接两类调用点：
  - `src/api/upload.ts` 的 `toAbsoluteApiUrl` 改为调用它（上传直传、签名预览随之走东京）；
  - 直接渲染 `file_url` / `fileUrl` 的视图（§2 四处，实施时全量 grep）在渲染处套 helper。这样**存量落库的绝对地址也走东京**，不需要回填数据。
- API 侧 `WECOM_PUSH_API_BASE_URL` 与 3 个绝对地址生产点不动（小程序与企微推送仍依赖绝对地址）。
- 自动回退（复用现有 relay pool，角色对调）：`platform-config.json` 的 `ApiRelayPool` 改为 `enabled: true`，节点换成 `{ id: "direct-worker", baseUrl: "https://api.hybcdg.com", statusPath: "/api/v1/system/health", supportsWriteFallback: false, probeTimeoutMs: 3000 }`（Cloudflare 路径本来就慢，1200 ms 探测会误判）。`http/index.ts` 的触发条件从「仅网络错误」扩到「网络错误，或主入口返回 502/503/504」（这些是 Caddy 转发失败的信号，响应体未被业务消费，GET 重放安全）。写请求维持现状：只有带 `Idempotency-Key` 的才回退，其余报错由用户重试。
- 本地开发不受影响（`.env.development` 仍走 Vite 代理）。

### 5.3 让 Worker 拿到真实客户端 IP（切换的硬前提）

- 新增 Worker 中间件 `relay-trust`：请求头 `X-Relay-Auth` 与 secret `RELAY_TRUST_TOKEN` 相等时，取 `X-Forwarded-For` **首跳**为客户端 IP 写入上下文；否则按现状用 `cf-connecting-ip`。不带令牌的 XFF 一律不信。
- 抽出 `getClientIp(c)`，`rate-limit.ts`、`passkeys.ts`（2 处）、`public-project-log.ts` 四处统一改用。
- bridge uvicorn relay 顺带注入同一个 `X-Relay-Auth`（它的 XFF 首跳今天已正确，不需要再改）。**修复小程序现存 429 口径的是 Worker 开始信任这个头**，不是 bridge 侧任何改动。
- `RELAY_TRUST_TOKEN` 下发三处：`wrangler secret put RELAY_TRUST_TOKEN --env prod`；`bridge/.env`（uvicorn 读）；VM 上 Caddy 的环境文件（5.4）。`test/wrangler-prod-env.test.ts` 的「不得明文写进 vars」清单加入该键。
- 令牌泄露的后果只是能伪造限流/审计里的 IP，不涉及鉴权；轮换即可。

### 5.4 部署脚本与环境变量落点

- 两份脚本的 Caddyfile 生成抽成共用 shell 函数，新增 `api-relay` 站点段；环境变量 `API_RELAY_PUBLIC_DOMAIN`（默认 `api-relay.hybcdg.com`）、`API_RELAY_UPSTREAM`（默认 `api.hybcdg.com`）、`RELAY_TRUST_TOKEN`。
- Caddy 读 secret 的落点现在没有：脚本从 `bridge/.env` 读出 `RELAY_TRUST_TOKEN` 生成 `/etc/caddy/hybc.env`（`0640 root:caddy`），systemd drop-in 加 `EnvironmentFile=`。
- workflow 新增 GitHub secret `AZURE_BRIDGE_RELAY_TRUST_TOKEN`，部署步骤 `upsert_env` 进 `bridge/.env`（与现有 `BRIDGE_PROXY_TOKEN` 同款处理）。
- 验收：`Deploy Azure Bridge` workflow 重跑后 Caddyfile、drop-in、环境文件都还在。

### 5.5 zone 层对 VM 出口 IP 的态度（切换前必须核对）

切换后全公司网页端 API 流量都从 `13.114.172.128` 一个 IP 打到 `api.hybcdg.com`，经 Cloudflare 边缘。Worker 自家的限流由 5.3 解决，但 zone 层的 WAF 托管规则、Bot Fight Mode、zone 级 Rate Limiting 发生在 Worker 之前，一旦触发返回的是 HTML challenge 或 429，`X-Relay-Auth` 救不了。小程序今天经 bridge 的流量小得多，不能当「没事」的证据。owner 在控制台核对三项现状；若开着，给 VM IP 加 WAF 自定义放行规则，Phase 2 做一次从 VM 发起的并发压测确认不被拦。

### 5.6 监控

`routes/system.ts` 健康检查新增 `api_relay_entry`：`GET https://api-relay.hybcdg.com/api/v1/system/health` 走整条「DNS → Caddy → Worker」链路，期望 `ok=true`。顺手把 `RELAY_STATUS_URLS` 配上 `https://bridge.hybcdg.com/relay/status`。Worker 访问日志里可用 `X-Relay-Auth` 命中与否统计经中转流量占比。

### 5.7 切换前的端到端验证（不影响用户）

验证人本地把 `VITE_API_BASE_URL` 指到 `api-relay.hybcdg.com` 跑生产构建（或在 Pages Preview 分支上部署），完整走一遍：企微扫码登录、企微内 OAuth 登录、Passkey 登录与注册、上传附件、新附件预览、**历史单据里的旧附件预览与下载**、合同起草下载 docx、监控中心页面、把东京入口临时停掉看读请求是否回退到直连。全部通过再改生产基址。

### 5.8 安全面的变化

- Caddy 必须先删客户端自带的 `X-Relay-Auth` 再设自己的，防止客户端自证可信。
- Worker 仍在 Cloudflare 后面，WAF/DDoS 前置不变；新域名只是多了一个经 VM 的入口，VM 防火墙只开 80/443(+UDP 443)/22。
- CORS `*` 不变。

## 6. 影响面清单

| 位置 | 改动 |
|------|------|
| `packages/web/.env.production`、`.env.staging` | `VITE_API_BASE_URL` → `https://api-relay.hybcdg.com` |
| `packages/web/public/platform-config.json` | `ApiRelayPool` 启用，节点换成直连 Worker |
| `packages/web/src/utils/http/index.ts` | 回退触发条件加 502/503/504 |
| `packages/web/src/utils/`（新 helper）、`src/api/upload.ts` | 绝对地址 origin 归一到当前基址 |
| `components/PhaseUpload`、`views/project/workspace/file-panel.vue`、`project-panel.vue`、`views/public/project-log.vue`、`views/welcome/index.vue`（实施时全量 grep） | 渲染处套归一 helper |
| `packages/api/src/middleware/relay-trust.ts`（新）、`utils/client-ip.ts`（新） | 可信中转识别、统一取 IP |
| `rate-limit.ts`、`passkeys.ts`、`public-project-log.ts` | 改用 `getClientIp` |
| `routes/system.ts`、`types/env.ts`、`test/wrangler-prod-env.test.ts`、`wrangler.toml` | 健康项 `api_relay_entry`、`RELAY_STATUS_URLS`、`RELAY_TRUST_TOKEN` 类型与守卫 |
| `bridge/app/main.py`、`.env.example`、`README.md` | relay 注入 `X-Relay-Auth` |
| `scripts/deploy/bridge-azure-vm.sh`、`bridge-azure-update.sh`、`scripts/deploy/README.md`、`.github/workflows/deploy-bridge-azure.yml` | 共用 Caddyfile 模板函数、`api-relay` 站点段、Caddy 环境文件与 drop-in、新 secret 下发 |
| Cloudflare 控制台（owner） | `api-relay` 的 A/AAAA 记录（灰云）、Worker secret、zone 层 WAF/Bot/Rate Limiting 核对与放行 |
| Lightsail 控制台（owner） | 防火墙 UDP 443；封 9001 |
| 企微后台、Pages 项目、`web.hybcdg.com` DNS | **无改动** |
| `README.md` 部署表、`doc/CLAUDE.md`、`doc/开发记录.md` | 入口说明与记录 |

## 7. 实施分期

| 阶段 | 内容 | 验收 |
|------|------|------|
| **0 测量**（半天，可选） | `public/diag.html` 纯静态页：对 `api.hybcdg.com/api/v1/system/health` 与 `bridge.hybcdg.com/api/v1/system/health`（经现有 relay，CORS 头透传）各测 5 次，表格 + 一键复制；请 3～5 位大陆同事在工作时段和晚高峰各跑一次 | bridge 路径 p50 明显优于直连（建议 ≥ 2 倍）才继续；若无差别，问题不在入口链路，方案中止 |
| **1 Worker 可信中转**（后端，用户无感） | 5.3 + 5.6 + bridge relay 带头 + secret 下发 | 单测覆盖「有令牌取 XFF 首跳 / 无令牌取 cf-connecting-ip / 伪造令牌被忽略」；**小程序登录限流从「全体共用 bridge IP」恢复为按人计** |
| **2 东京入口** | 5.1 Caddy 站点段 + DNS + 5.4 脚本与环境变量 + 5.5 zone 层核对与压测 | `curl https://api-relay.hybcdg.com/api/v1/system/health` 返回 `ok=true`；Worker 日志里该请求带可信头且客户端 IP 正确；workflow 重跑不覆盖 |
| **3 Web 切换** | 5.2 全部，先按 5.7 验证，再 push `main`（Pages 自动发布，用户无感） | 验证清单全部通过；上线后登录/刷新令牌无 429；新旧附件都走 `api-relay` |
| **4 观察 48 小时** | 大陆同事复跑 `diag.html`；监控 `api_relay_entry` 持续 ok | 无 429、无登录异常、附件可用 |
| **5 收尾** | 文档、`开发记录`；评估小程序是否也迁到 Caddy 直通路径、是否启用旧 Azure HK 机器作第二节点 | 文档与实际一致 |

顺序：**1 → 2 → 3 → 4**，串行。Phase 1 是 Phase 3 的硬前提（否则早高峰必 429）；Phase 2 依赖 1（令牌）。

## 8. 回滚

- 阶段 1、2 是纯增量，直接 revert 提交即可；东京入口多一个域名不影响任何现有调用方。
- 阶段 3 之后：revert Web 提交并 push `main`，Pages 2～3 分钟发布完成，API 回到直连 Cloudflare。期间读请求已由 relay pool 自动回退到直连，写请求报错重试。
- 不需要动 DNS、不需要动 Worker。

## 9. 风险与应对

| 风险 | 说明 | 应对 |
|------|------|------|
| VM 单点 | 网页端 API 随 VM 一起不可用 | 它已是小程序与企微回调的单点；读请求自动回退直连；回滚一次发布；Lightsail 快照；第二节点是后续项 |
| zone 层拦截 VM IP | WAF/Bot/Rate Limiting 把单一出口 IP 当攻击源 | 5.5：切换前核对、放行、压测 |
| VM IP 或 SNI 被封 | 固定 IP 承载全部网页 API 流量后画像变大 | 业务 HTTPS 流量特征正常，概率低；relay pool 结构保留，第二节点随时切 |
| 带宽/流量配额 | Lightsail 套餐含月流量额度 | JSON + 附件，百人规模远不到额度；实施前让 owner 确认套餐 |
| 写请求在东京故障瞬间失败 | 不自动回退 | 用户重试；付款/合同已有可选幂等键，后续可逐步铺开 |
| 探测误判 | 直连 Cloudflare 慢，探测超时导致不回退 | `probeTimeoutMs` 3000 |
| 令牌泄露 | 可伪造限流/审计 IP | 不触及鉴权；轮换 secret |
| 脚本漂移 | Caddyfile 两处生成 | 抽成共用模板函数 |

## 10. 待 owner 拍板（2026-10-31 批准时的处理）

批准时 owner 只明确了「推进」与「共用现有 VM」。其余各项按括号内处理，owner 随时可改：

1. 东京 API 入口的域名：`api-relay.hybcdg.com`（未反对，照此执行；改名只需改 DNS、Caddy 环境变量与 Web 基址）
2. Lightsail 实例的套餐（vCPU/内存/月流量）是多少？旧的 Azure HK VM 是否还在、要不要留作第二节点？
3. 不以 Phase 0 为门槛，直接进 Phase 1；`diag.html` 仍做，作为上线后让大陆同事复测的工具。
4. Cloudflare zone 层现在是否开着 WAF 托管规则 / Bot Fight Mode / zone 级 Rate Limiting？（控制台才能看到；决定 5.5 要不要加放行规则）
5. 存量附件：按「渲染时归一，历史附件也走东京、不回填数据」执行。
6. 写请求不自动回退（维持「仅带 `Idempotency-Key` 的写请求可回退」）。
7. DNS 记录、Worker secret、GitHub secret、Lightsail 防火墙、zone WAF 放行——这些控制台操作由谁执行、何时执行？

## 11. 我替你做的默认决定（可推翻）

- 东京入口与现有 bridge 共用一台 Lightsail VM 和同一个公网 IP；满足「企微线需与用户流量分离 / 需要地域容灾 / CPU、带宽、健康项 p95 出现压力」任一条件时再开第二台，把 `api-relay` 的 DNS 挪过去（owner 2026-10-31 采纳）。
- 用新域名 + Caddy 直接反代 Worker，不复用 uvicorn relay，不改小程序路径。
- 存量附件绝对地址在渲染时把 origin 换成当前基址，不做数据回填。
- 中转可信凭据用一个共享 secret 头 `X-Relay-Auth`，不做 HMAC 签名（它不保护鉴权，只保护 IP 口径）。
- 回退复用现有 relay pool（角色对调），触发条件加 502/503/504，写请求不自动回退。
- 回滚靠一次 Web 发布，不做运行时基址开关。
- 保留 relay pool 代码；bridge 不加 CORS。
- 四个阶段串行，不并行。

## 12. 留给实施者的

Caddyfile 具体写法与超时数值、`relay-trust` 中间件与 `getClientIp` 的测试用例、归一 helper 的命名与视图 grep 清单、`http/index.ts` 回退条件的具体判定、`diag.html` 的样式、部署脚本的模板函数拆法与 drop-in 内容、`开发记录` 条目。
