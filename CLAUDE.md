# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

恒越百川建设集团后台管理系统 (HYBC Core) — enterprise backend management system for a Chinese construction group. Covers finance, project management, construction logs, asset/warehouse management, with deep WeCom (Enterprise WeChat) and AI integration.

**pnpm monorepo:** `packages/api` (backend), `packages/web` (frontend, package name `pure-admin-thin`), `packages/miniapp` (WeCom mini program), `packages/mcp` (`hybc-mcp`, MCP server for AI agents), plus `task-runner` (Python compute nodes) and `bridge` (WeCom bridge / API relay). `n8n/` is retired and kept for reference only.

`README.md` is the GitHub-facing overview (architecture, quick start, deployment, FAQ).

## Common Commands

### Root-level
```bash
pnpm install             # Install all workspace deps (pnpm required; packages/web rejects npm installs)
npm run dev:api          # Start API dev server
npm run dev:web          # Start web dev server
npm run build:web        # Production build of web
npm run typecheck        # Typecheck both api & web
```

### Deployment — push to main IS the deploy
**Pushing to `main` auto-deploys via Cloudflare Git integration** (Workers Builds for `packages/api`, Pages for `packages/web`). Do NOT run manual production deploys; committing and pushing to `main` is the release action. Confirmed by owner 2026-07-08 — any older note claiming manual deploy is required is obsolete.

The only manual production step is D1 migrations (remote D1 commands need `--env prod`, otherwise they fail with error 7403):
```bash
cd packages/api && npx wrangler d1 migrations apply hybcdg-prod-db --remote --env prod
```
Apply migrations before (or immediately after) pushing dependent code; verify with `https://api.hybcdg.com/api/v1/system/health` (expect `ok=true`).

CI (`.github/workflows/ci.yml`) runs typecheck/test/lint for api, web and mcp on every push/PR to `main`, but it runs in parallel with the Cloudflare deploy and does not block it — run the affected package's `typecheck` and `test` locally before pushing.

### Backend (packages/api) — Hono on Cloudflare Workers
```bash
npm run dev              # wrangler dev --local (port 8787)
npm run deploy           # Manual CF Workers deploy — NOT needed normally; push to main auto-deploys
npm run db:migrate:local # Apply D1 migrations locally
npm run db:seed:mock:local # Seed mock data (MOCK-* prefix, safe to re-run)
npm run test             # Vitest
npm run typecheck        # tsc --noEmit
npm run lint             # eslint src test --ext .ts
npm run format           # prettier check
```
Local dev requires `cp .dev.vars.example .dev.vars` (sets `APP_ENV=local`; the top-level `[vars]` in wrangler.toml are production values).

### Frontend (packages/web) — Vue 3 + PureAdmin + Element Plus
```bash
npm run dev              # Vite dev server (port 8849, proxies /api → localhost:8787)
npm run build            # Production build
npm run test             # Vitest (src/**/*.{test,spec}.ts, happy-dom)
npm run typecheck        # tsc + vue-tsc
npm run lint:check       # ESLint + Prettier + Stylelint, check only (CI: advisory)
npm run lint             # Same three tools with --fix / --write
```

### Task Runner (task-runner) — Python 3.11+
```bash
docker-compose up -d     # Start via Docker
docker-compose logs -f   # Tail logs
python -m runner.main    # Direct run (after venv + pip install -r requirements.txt)
```

### Database Migrations
```bash
# Local
npm run db:migrate:local
# Remote (production)
npx wrangler d1 migrations apply hybcdg-prod-db --remote --env prod
```
Migration files: `packages/api/migrations/NNNN_description.sql` (sequential numbering). `packages/api/scripts/check-migration-numbers.mjs` (run in CI) rejects new duplicate numbers; 0036/0037/0041 are known historical duplicates.

### Tests
```bash
cd packages/api && npm test -- path/to/file.test.ts      # Vitest
cd packages/web && npm test -- src/path/to/file.test.ts  # Vitest
cd packages/mcp && npm test                              # Vitest
cd packages/miniapp && node utils/<name>.test.js         # plain node assert scripts
cd task-runner && pytest tests/test_file.py::test_case_name  # pytest is not in requirements.txt; install it separately
```

## Architecture

### Backend (packages/api/src/)
Layered architecture: **Routes → Services → D1/KV/R2/Queue**

- `index.ts` — Hono app entry, registers all route modules under `/api/v1/*`
- `middleware/` — auth (JWT), rbac, api-key (task nodes), cors, error handler, logger
- `routes/` — one file per domain (project, contract, payment, approval, etc.), tests colocated as `*.test.ts`
- `services/` — business logic: approval engine (`services/approval/`), AI slot manager, `cf_ai` executor, event bus, serial number gen, task queue
- `types/` — TypeScript type definitions per domain (env.ts defines all Cloudflare bindings)
- `migrations/` — D1 SQL migrations (`packages/api/migrations/`, sequential `NNNN_description.sql`)
- `queue-handler.ts` — Cloudflare Queue consumer
- `scheduled.ts` — Cron triggers (every 2 min, hourly, daily at 18:00 UTC = 02:00 Beijing)

**Cloudflare bindings** (defined in `wrangler.toml` and `types/env.ts`):
- `DB` (D1) — main database
- `LEGACY_DB` (D1) — read-only legacy data, tables prefixed `legacy_`
- `KV` — sessions, config cache, WeCom contact cache
- `FILES` (R2) — file storage
- `EVENT_QUEUE` (Queue) — event bus + task dispatch
- `AI` — Workers AI / AI Gateway, used by the in-Worker `cf_ai` provider

### Frontend (packages/web/src/)
PureAdmin-based Vue 3 SPA:
- `views/` — page components organized by business domain (finance/payment, finance/receipt, finance/reimbursement, project, approval, asset, warehouse, etc.)
- `api/` — HTTP request wrappers (one file per domain)
- `store/` — Pinia state management
- `composables/` — reusable composition functions (WeChat SDK, user options, project options)
- `router/` — Vue Router config
- `layout/` — PureAdmin layout templates

### Mini-app (packages/miniapp/)
Native WeCom mini program written in JavaScript (type-checked with `tsc --noEmit`). TDesign components are vendored in `tdesign-miniprogram/`, so no "build npm" step is needed. Main pages cover workbench, projects, finance, warehouse, logs, approval and survey; subpackages are `packageFinance`, `packageProject` and `packageTools`. By default it calls the API through the bridge relay (`https://bridge.hybcdg.com`) and falls back to the Worker directly.

### Task Runner (task-runner/)
Python compute nodes using pull-model (poll API every 3s by default, no inbound ports):
- `runner/main.py` · `poller.py` · `heartbeat.py` — poll loop, node registration and heartbeat
- `runner/executor.py` — dispatches each task type to the first provider that supports it (prompts in `prompts.py`, result normalization in `postprocess.py`)
- `runner/providers/` — AI provider adapters (OpenAI, Claude, local rules)
- `runner/importers/` — legacy data migration utilities
- `runner/tasks/` — early per-task processors; not imported by the executor
- `security/` — local mTLS certs and generator script

Production runs as a Cloudflare Container (`.cf-runner-container/`, `runner.hybcdg.com`); its `runner/` is a synced copy of `task-runner/runner/`, and its `src/index.ts` `CAPABILITIES` overrides the default capability list.

### MCP (packages/mcp/) and Bridge (bridge/)
- `packages/mcp` — `hybc-mcp` stdio MCP server + CLI. Agent tokens (`auth_method: mcp_agent`) are read-only via an endpoint allowlist; high-risk writes (approve/reject) are parked until the user confirms in WeCom, then replayed server-side (only when the server-side switch is on; otherwise they get 403).
- `bridge/` — FastAPI service on a fixed-IP VM: WeCom callback ingest, WeCom API egress proxy, and API relay for mainland access. Deployed by `.github/workflows/deploy-bridge-azure.yml` when `bridge/**` changes.

### Four Core Engines
1. **Approval Engine** — dynamic routing, node types: sequential/countersign/or_sign/ai_gate/auto/cc, supports return/reject/transfer/withdraw
2. **AI Decision Engine** — AI Slot abstraction layer, provider-agnostic, results logged to `ai_audit_log`. Contract drafting/review/precheck tasks run inside the Worker via the `cf_ai` provider; other tasks are pulled by task-runner nodes
3. **Event Bus** — Cloudflare Queue connecting all engines
4. **Automation** — Worker Cron Triggers + task-runner (n8n retired)

## Key Conventions

### Backend
- API paths: `/api/v1` prefix
- Time fields: ISO 8601 TEXT in D1
- Identity: WeCom `userid` is canonical — no separate user table
- Serial numbers: `{业务前缀}-{年月日}-{序号}`
- Soft delete only (`status` field or `deleted_at`)
- Contract amounts enforced at API layer
- Amount-in-Chinese-uppercase generated by backend
- No `@ts-ignore` or `as any` — use explicit domain types
- AI calls must go through AI Slot abstraction, never hardcode providers

### Frontend
- Follow PureAdmin directory structure and conventions
- API wrappers in `src/api/`, state in Pinia stores
- Reusable logic in `composables/`, reusable UI in `components/`

### Database
- Main tables: no prefix
- Legacy tables: `legacy_` prefix (read-only)
- Index naming: `idx_{table}_{column}`
- Migrations: `NNNN_description.sql`

### Auth
- WeCom OAuth (first login) + JWT sessions + optional Passkey (WebAuthn)
- JWT must carry `auth_method` and `wecom_verified_at`
- Five roles, mapped from WeCom tags: super_admin, finance, manager, site_manager, operator
- Local dev only (`APP_ENV=local`): `POST /api/v1/auth/login/web` with `{"username": "..."}` issues a token without a WeCom code (`admin`/`super_admin`, `finance`, `manager`, `site_manager` map to those roles; anything else is operator)

### Secrets
- Local: `packages/api/.dev.vars` only. Production: `npx wrangler secret put <NAME> --env prod` only.
- Never put `JWT_SECRET`, `UPLOAD_SIGNING_SECRET`, `TASK_API_KEY`, `WECHAT_SECRET`, `WECHAT_BRIDGE_TOKEN` or `AGENT_REPLAY_SECRET` in any `vars` section of wrangler.toml (guarded by `packages/api/test/wrangler-prod-env.test.ts`).

## Documentation

- `README.md` — GitHub-facing overview, quick start, deployment and FAQ
- `doc/README.md` — document index
- `doc/CLAUDE.md` — detailed architecture and conventions (Chinese)
- `doc/开发计划.md` — development roadmap and phase breakdown
- `doc/开发记录.md` — single-file dev log (append only, never create additional log files)
- `doc/UI设计文档.md` — page-level UI spec (update when UI changes)
- `doc/local-dev-setup.md` — local environment setup guide
- `doc/background_inv.md` — business domain context
- `docs/archive/` (implemented designs/plans) · `docs/planned/` (not yet implemented)
- `AGENTS.md` — operational rules for agentic coding

## Important Constraints

- D1 has 5GB limit per database — historical data archives to R2
- CF Worker execution time is limited — heavy compute must go to task-runner nodes
- AI tasks are async via Queue — never block user submissions
- WeCom API is rate-limited — contact book cached in KV, messages queued
- Legacy DB is read-only — never write to `LEGACY_DB`
- task-runner without model API keys uses only the local-rules provider (`MOCK_AI_ONLY=true` forces this even when keys are set); `cf_ai` tasks call Cloudflare AI remotely even in local dev (needs `wrangler login`)
