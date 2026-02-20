# 本地开发与模拟环境说明

## 目标

本仓库已完成第一步骨架搭建，支持以下本地模拟：

- Cloudflare Worker 本地运行
- D1 本地数据库绑定
- R2 本地对象存储绑定
- PureAdmin Thin 前端本地调试
- Python task-runner 轮询联调
- n8n 本地容器启动
- 企业微信小程序目录与依赖

## Phase 0 完成状态

- 已完成：脚手架、D1/KV/R2、数据库初始化、中间件骨架、开发环境验证。
- 阻塞项：Cloudflare Queue 远端创建（`wrangler queues create` 返回 `settings invalid`）。
- 当前处理：已在 `wrangler.toml` 配置本地队列绑定用于开发联调。

## 目录

- `packages/api`
- `packages/web`
- `task-runner`
- `n8n`
- `packages/miniapp`

## 文档指向

- 文档总索引：`doc/README.md`
- 统一开发记录：`doc/开发记录.md`
- 页面级 UI 设计：`doc/UI设计文档.md`

## 运行前准备

1. 安装 Node.js 20+
2. 安装 Python 3.11+
3. 安装 Docker / Docker Compose

## 开发阶段约定（全本地模拟）

- Cloudflare 相关能力全部走本地模拟（`wrangler dev --local` + 本地 D1/KV/R2/Queue）。
- 计算节点使用本地 Docker / 本地 Python 轮询，不依赖云主机。
- AI 任务默认走本地 mock（`MOCK_AI_ONLY=true`），即使未提供第三方模型密钥也可联调。
- 企业微信仅保留变量占位；你提供注册信息后再填充到本地环境变量。

## API（Worker + D1 + R2）

```bash
cd packages/api
npm install
cp .dev.vars.example .dev.vars
npx wrangler d1 migrations apply hybc-local --local
npm run dev
```

关键接口：

- `GET /api/v1/system/health`
- `GET /api/v1/system/storage-check`

### API 模拟数据（全面联调）

```bash
cd packages/api
npm run db:migrate:local
npm run db:seed:mock:local
```

说明：

- `scripts/mock-data.sql` 会先清理同前缀 `MOCK-*` 的旧测试数据，再写入新一批完整业务链路数据。
- 覆盖模块：实体、项目、合同、付款、收款/发票、报销（含查重/批次）、资产仓库、施工日志、勘查、审批实例、AI任务样例。
- 该脚本只清理 `MOCK-*` 范围内数据，不会删除业务真实数据。

## Web（PureAdmin Thin）

前端代码已通过下列仓库克隆初始化：

- `https://github.com/pure-admin/pure-admin-thin.git`

```bash
cd packages/web
npm install
npm run dev
```

默认地址：`http://localhost:8849`

## 企业微信配置（Web 扫码登录 + 通讯录）

### 1) 在企业微信管理后台准备应用

1. 进入「企业微信管理后台」→「应用管理」→「自建应用」→ 新建应用。
2. 记录以下信息：
   - 企业 ID（`corpid`）
   - 应用 Secret（`secret`）
   - 应用 AgentId（`agentid`）
3. 在该应用配置可访问的回调地址（用于扫码回跳 Web 登录页）。

### 2) 本系统变量与 wrangler.toml 对应关系

`packages/api/.dev.vars` 建议统一配置（开发期）：

- `APP_ENV`
- `JWT_SECRET`
- `UPLOAD_SIGNING_SECRET`
- `TASK_API_KEY`
- `WECHAT_CORPID`
- `WECHAT_AGENT_ID`
- `WECHAT_SECRET`
- `WECHAT_REDIRECT_URI`

`packages/api/wrangler.toml` 的 `[vars]` 可保留默认本地值作为兜底：

- `WECHAT_CORPID` ← 企业微信 `corpid`
- `WECHAT_AGENT_ID` ← 企业微信应用 `agentid`
- `WECHAT_REDIRECT_URI` ← 扫码后回跳地址（例如 `http://localhost:8848/login`）

敏感信息（`WECHAT_SECRET`、`JWT_SECRET`、`UPLOAD_SIGNING_SECRET`）建议只放 `.dev.vars`。

示例文件：`packages/api/.dev.vars.example`

### 3) 本地与生产建议

- 本地开发：
  - 在 `packages/api/.dev.vars` 写入 `WECHAT_SECRET`、`JWT_SECRET`、`UPLOAD_SIGNING_SECRET`
  - 在 `packages/api/wrangler.toml` 写入 `WECHAT_CORPID`、`WECHAT_AGENT_ID`、`WECHAT_REDIRECT_URI`
- 线上环境：
  - `wrangler.toml` 保留非敏感变量
  - 使用 `wrangler secret put WECHAT_SECRET` 注入 Secret

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
   - 注意：本地网络公网 IP 变化后需重新加白，建议后续切换到固定出口 IP 环境。

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

## 企业微信小程序（目录 + 依赖）

```bash
cd packages/miniapp
npm install
```

当前已创建：

- 原生小程序基础目录
- `miniprogram-api-typings`
- `weui-miniprogram`
- TypeScript 校验配置

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

- `MOCK_AI_ONLY=true`（默认）
- `API_BASE_URL=http://host.docker.internal:8787`
- `API_KEY=local-dev-task-api-key`
- `CAPABILITIES=contract_review,payment_risk_assessment,approval_ai_gate,...`

## n8n

```bash
cd n8n
cp .env.example .env
docker-compose up -d
```

默认地址：`http://localhost:5678`

## 单测命令（当前与后续建议）

- API: `cd packages/api && npm test -- path/to/file.test.ts`
- Web: `cd packages/web && npm test -- path/to/file.spec.ts`
- Task runner: `cd task-runner && pytest tests/test_file.py::test_case_name`

说明：当前尚未接入完整测试框架，以上为骨架阶段约定入口。
