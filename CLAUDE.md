# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

恒越百川建设集团后台管理系统 (HYBC Core) — enterprise backend management system for a Chinese construction group. Covers finance, project management, construction logs, asset/warehouse management, with deep WeCom (Enterprise WeChat) and AI integration.

**Monorepo with 4 packages:** `packages/api` (backend), `packages/web` (frontend), `packages/miniapp` (WeChat mini program), `task-runner` (Python compute nodes), plus `n8n` (workflow automation).

## Common Commands

### Root-level
```bash
npm run dev:api          # Start API dev server
npm run dev:web          # Start web dev server
npm run typecheck        # Typecheck both api & web
```

### Backend (packages/api) — Hono on Cloudflare Workers
```bash
npm run dev              # wrangler dev --local (port 8787)
npm run deploy           # Deploy to CF Workers
npm run db:migrate:local # Apply D1 migrations locally
npm run db:seed:mock:local # Seed mock data (MOCK-* prefix, safe to re-run)
npm run typecheck        # tsc --noEmit
npm run lint             # eslint src --ext .ts
npm run format           # prettier check
```

### Frontend (packages/web) — Vue 3 + PureAdmin + Element Plus
```bash
npm run dev              # Vite dev server (port 8849, proxies /api → localhost:8787)
npm run build            # Production build
npm run typecheck        # tsc + vue-tsc
npm run lint:eslint      # ESLint with --fix
npm run lint:prettier    # Prettier check
npm run lint:stylelint   # CSS/SCSS lint
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
# Remote
npx wrangler d1 migrations apply hengyue-db
```
Migration files: `packages/api/migrations/NNNN_description.sql` (sequential numbering).

### Tests (framework pending — placeholder patterns)
```bash
cd packages/api && npm test -- path/to/file.test.ts
cd packages/web && npm test -- path/to/file.spec.ts
cd task-runner && pytest tests/test_file.py::test_case_name
```

## Architecture

### Backend (packages/api/src/)
Layered architecture: **Routes → Services → D1/KV/R2/Queue**

- `index.ts` — Hono app entry, registers all route modules under `/api/v1/*`
- `middleware/` — auth (JWT), rbac, api-key (task nodes), cors, error handler, logger
- `routes/` — 20+ route files, one per domain (project, contract, payment, approval, etc.)
- `services/` — business logic: approval engine, AI slot manager, event bus, serial number gen, task queue
- `types/` — TypeScript type definitions per domain (env.ts defines all Cloudflare bindings)
- `migrations/` — D1 SQL migrations (24 files, 0001–0024)
- `queue-handler.ts` — Cloudflare Queue consumer
- `scheduled.ts` — Cron triggers (every 5min, hourly, daily 6pm)

**Cloudflare bindings** (defined in `wrangler.toml` and `types/env.ts`):
- `DB` (D1) — main database
- `LEGACY_DB` (D1) — read-only legacy data, tables prefixed `legacy_`
- `KV` — sessions, config cache, WeCom contact cache
- `FILES` (R2) — file storage
- `EVENT_QUEUE` (Queue) — event bus + task dispatch

### Frontend (packages/web/src/)
PureAdmin-based Vue 3 SPA:
- `views/` — page components organized by business domain (finance/payment, finance/receipt, finance/reimbursement, project, approval, asset, warehouse, etc.)
- `api/` — HTTP request wrappers (one file per domain)
- `store/` — Pinia state management
- `composables/` — reusable composition functions (WeChat SDK, user options, project options)
- `router/` — Vue Router config
- `layout/` — PureAdmin layout templates

### Mini-app (packages/miniapp/)
Native WeChat mini program with TypeScript. Pages mirror key mobile workflows: workbench, project detail, finance, warehouse, logs, approval, survey.

### Task Runner (task-runner/runner/)
Python compute nodes using pull-model (poll API every 3-5s, no inbound ports):
- `providers/` — AI provider adapters (Claude, OpenAI, local rules)
- `tasks/` — task handlers (contract review, risk assessment, OCR, file generation, etc.)
- `security/` — mTLS + API key auth
- `importers/` — legacy data migration utilities

### Four Core Engines
1. **Approval Engine** — dynamic routing, node types: sequential/countersign/or_sign/ai_gate/auto/cc, supports return/reject/transfer/withdraw
2. **AI Decision Engine** — AI Slot abstraction layer, provider-agnostic, results logged to `ai_audit_log`
3. **Event Bus** — Cloudflare Queue connecting all engines
4. **Automation** — n8n for notifications, reports, sync workflows

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
- Four roles: super_admin, manager, site_manager, operator

## Documentation

- `doc/README.md` — document index
- `doc/CLAUDE.md` — detailed architecture and conventions (Chinese)
- `doc/开发计划.md` — development roadmap and phase breakdown
- `doc/开发记录.md` — single-file dev log (append only, never create additional log files)
- `doc/UI设计文档.md` — page-level UI spec (update when UI changes)
- `doc/local-dev-setup.md` — local environment setup guide
- `doc/background_inv.md` — business domain context
- `AGENTS.md` — operational rules for agentic coding

## Important Constraints

- D1 has 5GB limit per database — historical data archives to R2
- CF Worker execution time is limited — heavy compute must go to task-runner nodes
- AI tasks are async via Queue — never block user submissions
- WeCom API is rate-limited — contact book cached in KV, messages queued
- Legacy DB is read-only — never write to `LEGACY_DB`
- `MOCK_AI_ONLY=true` in local dev — AI tasks use local mock without API keys
