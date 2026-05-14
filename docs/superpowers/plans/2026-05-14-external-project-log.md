# External Project Log Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a QR-code based public project log form for external workers, with AI continuity/reasonability audit and automatic low-risk adoption into construction and project logs.

**Architecture:** Add a tokenized public link table and an external submission table. Public submissions enqueue `external_log_audit`; task completion stores the AI review, auto-approves low-risk results, and creates canonical `operator_log` plus `manager_log` rows with source tracking.

**Tech Stack:** Cloudflare Workers + Hono + D1 + Queue/AI Slot; Vue 3 + Element Plus + PureAdmin router; task-runner provider prompts.

---

### Task 1: Backend Persistence

**Files:**

- Create: `packages/api/migrations/0044_external_project_log.sql`
- Modify: `packages/api/src/types/ai.ts`
- Modify: `packages/api/src/types/log.ts`

- [ ] Add `project_public_log_link` and `external_log_submission`.
- [ ] Add `external_submission_id`/source fields to `operator_log` and `manager_log`.
- [ ] Add `external_log_audit` to AI task types.

### Task 2: Backend Public Log Service And Routes

**Files:**

- Create: `packages/api/src/services/external-log-audit.ts`
- Create: `packages/api/src/routes/public-project-log.ts`
- Modify: `packages/api/src/routes/project.ts`
- Modify: `packages/api/src/routes/task.ts`
- Modify: `packages/api/src/index.ts`
- Modify: `packages/api/src/routes/admin.ts`

- [ ] Generate/revoke tokenized public project links from authenticated project workspace APIs.
- [ ] Resolve public link metadata and accept external submissions without platform login.
- [ ] Enqueue `external_log_audit` tasks with project, section, same-day logs, and previous logs as context.
- [ ] On task result, store the AI JSON; auto-approve low-risk submissions and otherwise mark `needs_manual_review`.
- [ ] Expose review list/detail and manual approve/reject APIs for internal users.
- [ ] Seed default AI prompt/routing for `external_log_audit`.

### Task 3: Web Public Form And Project Workspace

**Files:**

- Create: `packages/web/src/api/public-project-log.ts`
- Create: `packages/web/src/views/public/project-log.vue`
- Modify: `packages/web/src/router/modules/remaining.ts`
- Modify: `packages/web/src/router/index.ts`
- Modify: `packages/web/src/api/project.ts`
- Modify: `packages/web/src/views/project/workspace/project-panel.vue`

- [ ] Add a public, menu-less route at `/public/project-log/:token`.
- [ ] Build a mobile-first form that submits both section construction log and project log.
- [ ] Add project workspace controls for generating/printing/resetting/revoking QR links.
- [ ] Add an external submissions review drawer with AI score, findings, and manual approve/reject.

### Task 4: Documentation And Verification

**Files:**

- Modify: `doc/UI设计文档.md`
- Modify: `doc/开发记录.md`

- [ ] Document public log route and project workspace mapping.
- [ ] Append a single timestamped development log entry.
- [ ] Run API typecheck/tests and Web typecheck/build where tooling is available.
