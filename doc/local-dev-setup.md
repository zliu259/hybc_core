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

## API（Worker + D1 + R2）

```bash
cd packages/api
npm install
npx wrangler d1 migrations apply hybc-local --local
npm run dev
```

关键接口：

- `GET /api/v1/system/health`
- `GET /api/v1/system/storage-check`

## Web（PureAdmin Thin）

前端代码已通过下列仓库克隆初始化：

- `https://github.com/pure-admin/pure-admin-thin.git`

```bash
cd packages/web
npm install
npm run dev
```

默认地址：`http://localhost:5173`

## 企业微信配置（Web 扫码登录 + 通讯录）

### 1) 在企业微信管理后台准备应用

1. 进入「企业微信管理后台」→「应用管理」→「自建应用」→ 新建应用。
2. 记录以下信息：
   - 企业 ID（`corpid`）
   - 应用 Secret（`secret`）
   - 应用 AgentId（`agentid`）
3. 在该应用配置可访问的回调地址（用于扫码回跳 Web 登录页）。

### 2) 本系统变量与 wrangler.toml 对应关系

`packages/api/wrangler.toml` 的 `[vars]` 中配置：

- `WECHAT_CORPID` ← 企业微信 `corpid`
- `WECHAT_AGENT_ID` ← 企业微信应用 `agentid`
- `WECHAT_REDIRECT_URI` ← 扫码后回跳地址（例如 `http://localhost:8848/login`）

敏感信息 Secret 不建议写入 `wrangler.toml`，本地使用 `packages/api/.dev.vars`：

- `WECHAT_SECRET` ← 企业微信应用 `secret`

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
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -m runner.main
```

或 Docker 方式：

```bash
cd task-runner
docker-compose up -d
docker-compose logs -f
```

## n8n

```bash
cd n8n
docker-compose up -d
```

默认地址：`http://localhost:5678`

## 单测命令（当前与后续建议）

- API: `cd packages/api && npm test -- path/to/file.test.ts`
- Web: `cd packages/web && npm test -- path/to/file.spec.ts`
- Task runner: `cd task-runner && pytest tests/test_file.py::test_case_name`

说明：当前尚未接入完整测试框架，以上为骨架阶段约定入口。
