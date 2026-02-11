# 本地开发与模拟环境说明

## 目标

本仓库已完成第一步骨架搭建，支持以下本地模拟：

- Cloudflare Worker 本地运行
- D1 本地数据库绑定
- R2 本地对象存储绑定
- Vue 3 前端本地调试
- Python task-runner 轮询联调
- n8n 本地容器启动

## 目录

- `packages/api`
- `packages/web`
- `task-runner`
- `n8n`

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

## Web（Vue 3 + Vite）

```bash
cd packages/web
npm install
npm run dev
```

默认地址：`http://localhost:5173`

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
