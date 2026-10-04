# 本地开发与模拟环境说明

## 目标

在本机模拟运行全部组件，不依赖云资源即可联调主要业务链路：

- Cloudflare Worker 本地运行（`wrangler dev --local`，本地 D1 / KV / R2 / Queue）
- PureAdmin Thin 前端本地调试
- Python task-runner 轮询联调（单节点，或主 / 备 / 冷备多节点）
- 企业微信小程序调试（企业微信开发者工具）

> 早期「Cloudflare Queue 远端创建受阻」的问题已解决：生产队列 `hybcdg-prod-events` 已创建并在用，本地开发使用 `wrangler dev --local` 的模拟队列。

## 目录

- `packages/api`：后端 Worker
- `packages/web`：Web 管理端（包名 `pure-admin-thin`）
- `packages/miniapp`：企业微信小程序
- `packages/mcp`：`hybc-mcp` 智能体接入
- `task-runner`：Python 计算节点
- `bridge`：企微桥接与 API 中继（本地联调一般无需启动，见 `bridge/README.md`）

## 文档指向

- 项目首页与快速开始：`README.md`
- 文档总索引：`doc/README.md`
- 统一开发记录：`doc/开发记录.md`
- 页面级 UI 设计：`doc/UI设计文档.md`

## 运行前准备

1. 安装 Node.js ≥ 20.19（推荐 22，见 `packages/web/.nvmrc`）
2. 安装 pnpm 10（CI 使用 10.22.0）。仓库是 pnpm workspace，`packages/web` 的 `preinstall` 会拒绝 npm 安装
3. 安装 Python 3.11+
4. 可选：Docker / Docker Compose（容器方式运行 task-runner）、企业微信开发者工具（调试小程序）

## 安装依赖

在仓库根目录执行一次，覆盖全部 workspace 包：

```bash
pnpm install
```

## 开发阶段约定（全本地模拟）

- Cloudflare 相关能力全部走本地模拟（`wrangler dev --local` + 本地 D1/KV/R2/Queue）。
- 计算节点使用本地 Docker / 本地 Python 轮询，不依赖云主机。
- task-runner 未配置 `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` 时只启用本地规则 Provider，无需第三方模型密钥即可联调；`MOCK_AI_ONLY=true` 可在配置了密钥时也强制只用本地规则。
- 合同起草、合同预审等 `cf_ai` 任务在 Worker 内经 Cloudflare AI 执行，本地也会调用远端推理，调试前需 `npx wrangler login`。
- 企业微信参数按需写入 `packages/api/.dev.vars`；不填时可用下文的本地免 code 登录调试 API。

## API（Worker + D1 + R2）

```bash
cd packages/api
cp .dev.vars.example .dev.vars
pnpm db:migrate:local
pnpm dev
```

- 默认监听 `http://127.0.0.1:8787`；也可在仓库根目录执行 `npm run dev:api`。
- 本地 Worker 运行时需使用支持 `compatibility_date = 2026-02-11` 的 Wrangler 版本；当前仓库已对齐到 `wrangler@^4.78.0`。
- **`.dev.vars` 是必需的**（2026-07-16 起）：`wrangler.toml` 顶层 `[vars]` 的 `APP_ENV` 已固定为 `"production"`（CF Workers Builds 自动部署实际采用顶层 vars），本地开发必须靠 `.dev.vars` 覆盖 `APP_ENV=local`，否则本地无法使用免 WeCom-code 登录（`/login/web` 会返回 400）。

### 本地登录（免企微 code）

`APP_ENV=local` 时，`POST /api/v1/auth/login/web` 不带 `code`、只传 `username` 即可签发令牌：

```bash
curl -X POST http://127.0.0.1:8787/api/v1/auth/login/web \
  -H 'content-type: application/json' \
  -d '{"username":"admin"}'
```

用户名映射角色：`admin` / `super_admin` → 超级管理员，`finance` → 财务，`manager` → 经理，`site_manager` → 现场管理员，其他任意值 → 现场操作员。返回体中的 `data.accessToken` 以 `Authorization: Bearer <token>` 调用其他接口。

关键接口：

- `GET /api/v1/system/health`
- `GET /api/v1/system/storage-check`（2026-07-17 起需鉴权：super_admin/manager 的 Bearer JWT，本地可先 `/login/web` 免 code 登录拿 token；它会写 D1/R2/KV/Queue，不是匿名探针）

### API 模拟数据（全面联调）

```bash
cd packages/api
pnpm db:migrate:local
pnpm db:seed:mock:local
```

说明：

- `scripts/mock-data.sql` 会先清理同前缀 `MOCK-*` 的旧测试数据，再写入新一批完整业务链路数据。
- 覆盖模块：实体、项目、合同、付款、收款/发票、报销（含查重/批次）、资产仓库、施工日志、勘查、审批实例、AI任务样例。
- 库房升级专项样例已包含：
  - `shell / core / console` 组件资产
  - `asset_compatibility_rule` 兼容关系
  - `tracked_asset_configuration` 组合配置（`active` / `planned`）
  - `warehouse_asset_work_order` 工单样例（`pending_approval` / `in_progress` / `completed`）
  - 带 `configuration_role`、`configuration_group_key`、`requires_modification` 的 `stock_order_item`
  - `configuration_created / configuration_updated / work_order_completed` 等资产时间线样例
- 该脚本只清理 `MOCK-*` 范围内数据，不会删除业务真实数据。

## Web（PureAdmin Thin）

前端代码基于下列仓库初始化：

- `https://github.com/pure-admin/pure-admin-thin.git`

```bash
cd packages/web
pnpm dev
```

默认地址：`http://localhost:8849`；`/api` 请求代理到 `http://127.0.0.1:8787`（`.env.development` 中的 `VITE_API_TARGET`）。也可在仓库根目录执行 `npm run dev:web`。

登录页只提供企业微信扫码与 Passkey 两种方式，在浏览器内扫码登录需要先完成下一节的企业微信配置。

## 企业微信配置（Web 扫码登录 + 通讯录）

### 1) 在企业微信管理后台准备应用

1. 进入「企业微信管理后台」→「应用管理」→「自建应用」→ 新建应用。
2. 记录以下信息：
   - 企业 ID（`corpid`）
   - 应用 Secret（`secret`）
   - 应用 AgentId（`agentid`）
3. 在该应用配置可访问的回调地址（用于扫码回跳 Web 登录页）。

### 2) 本系统变量与 wrangler.toml 对应关系

`packages/api/.dev.vars`（由 `.dev.vars.example` 复制）统一存放本地配置：

- `APP_ENV`（本地必须为 `local`）
- `JWT_SECRET`
- `UPLOAD_SIGNING_SECRET`
- `TASK_API_KEY`
- `AGENT_REPLAY_SECRET`
- `WECHAT_CORPID`
- `WECHAT_AGENT_ID`
- `WECHAT_SECRET`
- `WECHAT_BRIDGE_TOKEN`
- `WECHAT_REDIRECT_URI`（扫码后回跳地址，例如本地测试域名 `http://apix.hybcdg.com:8849/login`）
- `PASSKEY_RP_ID`、`PASSKEY_RP_NAME`

`packages/api/wrangler.toml` 的 `[vars]` 与 `[env.prod.vars]` 保存的是**生产**非敏感配置（企业 ID、AgentId、回调地址等），本地开发不要修改；`wrangler dev` 时 `.dev.vars` 中的同名变量会覆盖它们。

示例文件：`packages/api/.dev.vars.example`

### 3) 本地与生产建议

- 本地开发：
  - 全部变量（企业 ID、AgentId、回调地址与各类密钥）都写在 `packages/api/.dev.vars`。
- 线上环境：
  - `wrangler.toml` 只保留非敏感变量。
  - 密钥只经 `npx wrangler secret put <NAME> --env prod` 注入。`JWT_SECRET`、`UPLOAD_SIGNING_SECRET`、`TASK_API_KEY`、`WECHAT_SECRET`、`WECHAT_BRIDGE_TOKEN`、`AGENT_REPLAY_SECRET` 绝不能写进任何 `vars` 段：同名 var 与 secret 在 Workers 中不能共存（API 10053），且提交过的值会永久留在 git 历史里。回归守卫见 `packages/api/test/wrangler-prod-env.test.ts`。

### 4) 已落地接口与前端能力

- 扫码地址获取：`GET /api/v1/auth/oauth-url`
- 扫码回调换取登录态：`POST /api/v1/auth/login/web`（入参 `code`）
- 通讯录同步：`POST /api/v1/auth/wecom/contacts/sync`
- 通讯录读取：`GET /api/v1/auth/wecom/contacts`

Web 端：

- 登录页使用企业微信扫码登录：`packages/web/src/views/login/index.vue`
- 通讯录页面可手动同步并查看：`packages/web/src/views/wecom/contacts.vue`

### 5) 常见故障排查（本地 + 企微扫码）

1. 报错：`not allow to access from your ip`（`errcode=60020`）
   - 含义：当前后端出口公网 IP 不在企业微信应用「企业可信IP」白名单。
   - 处理：在企业微信管理后台 -> 应用管理 -> 自建应用 -> 企业可信IP，添加报错中的 `from ip`。
   - 注意：本地网络公网 IP 变化后需重新加白；生产环境的企微 API 调用经 bridge 固定出口代理。

2. 回调后 `POST /api/v1/auth/login/web` 返回 400
   - 先检查回调地址：`WECHAT_REDIRECT_URI` 应为 `http://apix.hybcdg.com:8849/login`。
   - 确认前端实际访问域名与企业微信可信域名一致（含端口）。
   - 确认扫码后回调 URL 中包含 `code` 参数，且在 5 分钟内完成换取登录态。

3. 返回体为 `{ "success": false, "error": { "message": "ok" } }`
   - 含义：企业微信接口返回成功文本，但未返回后端期望的用户标识字段。
   - 处理方向：
     - 确认扫码账号是企业内部成员。
     - 确认该成员在应用可见范围内。
     - 确认应用配置与授权范围满足获取内部成员身份。

4. 本地不带 `code` 调用 `POST /api/v1/auth/login/web` 返回 400 `Missing WeCom code`
   - `.dev.vars` 不存在或其中 `APP_ENV` 不是 `local`；复制示例文件后重启 `pnpm dev`。

## 企业微信小程序

用企业微信开发者工具导入 `packages/miniapp`（AppID 见 `project.config.json`）：

- TDesign 组件已随仓库提供（`packages/miniapp/tdesign-miniprogram/`），图表组件在 `packageProject/qiun-wx-ucharts/`，无需「构建 npm」。
- 默认经 bridge 中继 `https://bridge.hybcdg.com` 访问 API，失败时回退直连 `https://api.hybcdg.com`；联调时可在「我的 → 账号与配置 → 联调配置」修改接口地址（写入本机缓存，逻辑见 `utils/config.js`）。
- 小程序登录走 `POST /api/v1/auth/login/miniapp`，需要企业微信 code；连接本地 API 时，`.dev.vars` 中要配置真实的企业微信应用参数。
- 类型检查：`cd packages/miniapp && pnpm typecheck`；工具函数测试：`node utils/<name>.test.js`。
- 上传有 2MB 源码包限制，`project.config.json` 的 `packOptions.ignore` 已排除 `miniprogram_npm`、`node_modules`、`.test.js` 与 `.d.ts` 文件。

## Task Runner（Python）

```bash
cd task-runner
cp .env.example .env
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -m runner.main
```

或 Docker 方式：

```bash
cd task-runner
cp .env.example .env
docker-compose up -d
docker-compose logs -f
```

本地模拟关键变量：

- `API_BASE_URL`：Docker 内使用 `http://host.docker.internal:8787`（示例默认值）；直接在本机运行时改为 `http://127.0.0.1:8787`
- `API_KEY=local-dev-task-api-key`（与 `.dev.vars` 的 `TASK_API_KEY` 一致）
- `MOCK_AI_ONLY`：默认 `false`；未配置模型密钥时本身就只用本地规则，设为 `true` 可强制
- `CAPABILITIES`：节点可领取的任务类型（逗号分隔，留空使用默认全集），例如 `contract_review,payment_risk_assessment,approval_ai_gate,...`

多节点 + mTLS 模拟：`scripts/phase8/start-local.sh` 启动主 / 备 / 冷备三个容器（本地证书缺失时自动生成），`scripts/phase8/stop-local.sh` 停止。

## 自动化与定时任务（无 n8n）

- 统一通过 Cloudflare Worker Cron + `task-runner` 执行自动化任务；`n8n/` 目录仅留档。
- Cron（UTC）：`*/2 * * * *`（任务调度、节点心跳、超时重排等）、`0 * * * *`（审批超时、通讯录刷新等）、`0 18 * * *`（北京时间 02:00，漏报检测与报销完整性巡检），详见 `packages/api/src/scheduled.ts`。
- 本地可通过 API 触发自动化入口：`POST /api/v1/system/automation/cron/run`（需 `X-API-Key`）。
- AI 相关任务通过 `task_queue` 分发并由 `task-runner` 轮询执行；合同起草、预审等 `cf_ai` 任务在 Worker 内执行。

## 单测命令

- API（Vitest）：`cd packages/api && pnpm test`；单个文件 `pnpm test path/to/file.test.ts`
- Web（Vitest + happy-dom，匹配 `src/**/*.{test,spec}.ts`）：`cd packages/web && pnpm test`
- MCP（Vitest）：`cd packages/mcp && pnpm test`
- 小程序（node assert 脚本）：`cd packages/miniapp && node utils/<name>.test.js`
- Task runner：`cd task-runner && pytest tests/test_file.py::test_case_name`（pytest 不在 `requirements.txt` 中，需另行安装）

CI（`.github/workflows/ci.yml`）在 push / PR 到 `main` 时执行 api / web / mcp 的 typecheck、test 与 lint；它与 Cloudflare 自动部署并行触发，不会阻止上线，推送前请先在本地跑通。
