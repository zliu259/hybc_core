# AGENTS.md

## Repository Reality Check
- The workspace is a pnpm monorepo running in production: `packages/api`, `packages/web` (package name `pure-admin-thin`), `packages/miniapp`, `packages/mcp`, `task-runner`, `bridge`. `n8n/` is retired and kept for reference only.
- Source-of-truth files found:
  - `README.md` (overview, quick start, deployment)
  - `doc/CLAUDE.md`
  - `doc/开发计划.md`
  - `doc/background_inv.md`
- No Cursor rules found in `.cursor/rules/`.
- No `.cursorrules` file found.
- No Copilot instructions found in `.github/copilot-instructions.md`.

## Documentation Rules (Mandatory)
- Use `doc/README.md` as the document index and entry point.
- Keep all development logs in a single file: `doc/开发记录.md`.
- Never create additional dated dev-log files; always append a new timestamp section to `doc/开发记录.md`.
- Timestamp section format: `## YYYY-MM-DD HH:mm (TZ)`.
- UI changes must update page-level mapping in `doc/UI设计文档.md` with concrete file-path pointers.

## Documentation Layout (three areas)
- `doc/` — long-lived, still-authoritative docs: `CLAUDE.md`, `开发计划.md`, `开发记录.md`, `UI设计文档.md`, `background_inv.md`, `local-dev-setup.md`, plus `guide/` and `legacy_data/`. This is where active work is tracked.
- `docs/archive/` — **implemented / shipped** one-off design docs, implementation plans, and phase notes. Historical reference only; do NOT treat as current instructions. Index: `docs/archive/README.md`.
- `docs/planned/` — **not-yet-implemented** design/plan docs. Index: `docs/planned/README.md`.
- When a planned doc is implemented, move it from `docs/planned/` to `docs/archive/`, update both indexes and `doc/README.md`, and append an implementation record to `doc/开发记录.md`.

## How To Use This File
- Treat this as operational guidance for agentic coding in this repo.
- Prefer explicit rules from `doc/CLAUDE.md` over assumptions.
- If implementation code is later added and conflicts with this file, follow code + local config closest to changed files.

## Project Shape (Planned)
- Monorepo target structure (from docs):
  - `packages/api` (Hono + TypeScript on Cloudflare Workers)
  - `packages/web` (PureAdmin Vue 3 + Element Plus + TypeScript)
  - `task-runner` (Python 3.11+ distributed compute nodes)
  - `n8n` (workflow automation — retired; automation now runs on Worker Cron Triggers + task-runner)
- Core infra: Cloudflare D1, KV, R2, Queue, Cron.

## Build, Lint, Test, Typecheck Commands

### Important Status
- Install dependencies once at the repo root with `pnpm install` (pnpm is required; `packages/web` rejects npm installs).
- Pushing to `main` auto-deploys the API (Workers Builds) and Web (Cloudflare Pages). Manual deploy scripts are an emergency bypass only.
- The production queue `hybcdg-prod-events` exists; local dev uses the simulated queue from `wrangler dev --local`.

### Backend (`packages/api`) - documented
- Dev: `npm run dev` (requires `cp .dev.vars.example .dev.vars`)
- Deploy: push to `main`; `npm run deploy` is an emergency bypass only
- DB migration apply (production): `npx wrangler d1 migrations apply hybcdg-prod-db --remote --env prod` (remote D1 commands fail with 7403 without `--env prod`)
- Local migration apply: `npm run db:migrate:local`
- Test: `npm test` (Vitest)
- Lint: `npm run lint`
- Format check: `npm run format`
- Typecheck: `npm run typecheck`

### Web (`packages/web`) - documented
- Dev: `npm run dev`
- Build: `npm run build`
- Test: `npm test` (Vitest)
- Typecheck: `npm run typecheck`
- Lint (check only): `npm run lint:check`
- Deploy: push to `main` (Cloudflare Pages); there is no deploy script

### Task runner (`task-runner`) - documented
- Start services: `docker-compose up -d`
- Tail logs: `docker-compose logs -f`

### n8n (`n8n`)
- Retired; kept for reference only. Do not add new workflows here.

### Lint/Test/Typecheck
- API lint/format/typecheck/test scripts are available in `packages/api/package.json`.
- Web project contains its own lint/typecheck/test scripts in `packages/web/package.json`.
- Vitest is wired for api, web and mcp; miniapp has plain node assert scripts; task-runner uses pytest.
- CI (`.github/workflows/ci.yml`) runs typecheck/test/lint for api, web and mcp on push/PR to `main` (web lint is advisory). It does not block the Cloudflare deploy.

### Single-test execution guidance
- API (Vitest):
  - `cd packages/api && npm test -- path/to/file.test.ts`
- Web (Vitest, matches `src/**/*.{test,spec}.ts`):
  - `cd packages/web && npm test -- src/path/to/file.test.ts`
- Mini-app (node assert scripts):
  - `cd packages/miniapp && node utils/<name>.test.js`
- Python task runner:
  - `cd task-runner && pytest tests/test_file.py::test_case_name`
- Note: pytest is not listed in `task-runner/requirements.txt`; install it separately.

## Coding Standards (Extracted + Safe Agent Defaults)

### Language & Framework
- Backend must use TypeScript + Hono on Cloudflare Workers.
- Web must use Vue 3 + Element Plus + TypeScript (PureAdmin style/structure).
- Compute node uses Python 3.11+.

### Imports
- Explicitly documented:
  - Web API wrappers belong under `api/`.
  - Shared UI/state patterns follow PureAdmin + Pinia conventions.
- Agent default (until formatter/linter exists):
  - Keep imports grouped: stdlib/external/internal.
  - Avoid unused imports.
  - Prefer explicit named imports over wildcard imports.

### Formatting
- Explicitly documented:
  - Database time fields use ISO 8601 `TEXT`.
  - Migration naming: `0001_init.sql`, `0002_xxx.sql`.
- Agent default:
  - Keep formatting consistent within file.
  - Keep lines readable and avoid dense one-liners.
  - Do not introduce style churn in unrelated code.

### Types
- TypeScript is required in backend and web.
- Backend type definitions belong in `packages/api/src/types/`.
- Agent hard rules:
  - Do not suppress type errors with `as any`, `@ts-ignore`, or `@ts-expect-error`.
  - Prefer explicit domain types for request/response payloads.

### Naming Conventions
- API path prefix: `/api/v1`.
- Serial number format: `{业务前缀}-{年月日}-{序号}`.
- DB table naming:
  - Main tables: no prefix.
  - Legacy read-only tables: `legacy_` prefix.
- DB index naming: `idx_{表名}_{字段}`.
- Asset identity format (planned): `HY-{TYPE}-{SEQ}`.

### Data & Domain Rules
- User linkage uses WeCom `userid`; avoid separate user table unless requirements change.
- Deletions use soft delete (`status` or `deleted_at`), not hard delete.
- Contract amount constraints must be enforced in API layer.
- Amount-in-Chinese-uppercase is generated by backend.

### Error Handling
- Custom error middleware (`packages/api/src/middleware/error.ts`) must be preserved.
- Request logging middleware (`packages/api/src/middleware/logger.ts`) must be preserved.
- Agent default:
  - Never use empty catch blocks.
  - Return structured, actionable error responses.
  - Validate inputs at boundary layers.

### Frontend Structure
- Follow PureAdmin conventions and directory layout.
- Use Pinia for state management.
- Place reusable logic in `composables/` and reusable UI in `components/`.

### AI/Compute Workflow Constraints
- AI calls must go through AI Slot abstraction; do not hardcode providers in business logic.
- Compute nodes run pull-mode polling (no inbound listener).
- Heavy AI/compute tasks must be offloaded from Cloudflare Workers.
- Task distribution goes through `task_queue`.
- AI outputs/results must be recorded in `ai_audit_log`.
- AI tasks are async via Queue; do not block user submissions.

## Testing Expectations (From Plan)
- End-to-end business flow tests are required before release.
- Role-based verification required for:
  - super_admin
  - finance
  - manager
  - site_manager
  - operator
- Include AI quality and auditability checks in test scope.

## Agent Workflow Rules For This Repo
- Do not invent missing scripts/commands; verify from committed config files.
- If implementation files are absent, report doc-only status explicitly.
- Prefer minimal, focused changes.
- Bugfixes must be minimal; do not refactor unrelated areas.
- Do not commit unless explicitly asked.
- If future `AGENTS.md`/Cursor/Copilot rules appear, merge and prioritize nearest-scope rules.

## Verification Checklist Before Declaring Work Complete
- Confirm target files actually exist before running project commands.
- Run diagnostics/lint/tests only where tooling is present.
- Distinguish clearly between:
  - documented/planned behavior
  - currently executable behavior

## Quick Source References
- Document index and maintenance rules: `doc/README.md`
- Single-file development log: `doc/开发记录.md`
- Page-level UI specification: `doc/UI设计文档.md`
- Architecture and conventions: `doc/CLAUDE.md`
- Development phases and testing expectations: `doc/开发计划.md`
- Business field/naming context: `doc/background_inv.md`
