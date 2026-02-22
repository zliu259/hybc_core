# UI Refactor Plan (Based on `doc/Re-design UI.md`)

## Goal
- Rebuild web IA and interaction model to match `doc/Re-design UI.md`.
- Keep existing API wrappers in `packages/web/src/api/*.ts` unchanged.
- Enforce role-based visibility via `meta.roles` and keep route guards in `packages/web/src/router/index.ts`.

## Scope
- In scope: route tree reorganization, page layout/interaction refactor, reusable UI patterns (card/drawer/split view), role matrix alignment.
- Out of scope: backend API contract changes, task-runner/n8n changes.

## Baseline (Current)
- Router is module/table-oriented: `packages/web/src/router/modules/{finance,project,asset,warehouse,dict,entity,...}.ts`.
- Role checks already use `meta.roles` in `packages/web/src/router/index.ts`.
- Existing views are mostly available under `packages/web/src/views/**` and can be reused/refactored.

## Role Mapping (Implementation Source of Truth)
- Current code role strings used by route guards: `super_admin`, `manager`, `site_manager`, `operator`.
- Business-role naming in `doc/Re-design UI.md` must be mapped to code roles before refactor execution.
- Sprint verification and `meta.roles` changes must use code role strings only, unless auth role payload is changed globally.

## Target IA (Module-Oriented)
- `workspace` (personal workspace, default homepage)
- `approval` (unified tasklist split view)
- `field` (project hub + project workspace)
- `warehouse-assets` (ledger, creator, templates, dispatch)
- `finance` (monitor, payment, reimbursement batch, snapshot)
- `admin` (workflow designer, thresholds, AI/runner, base, WeCom, raw ops, helpdesk)

## Execution Plan

### Sprint 1 - Remove old menu structure + foundation modules
1. Create new route module files under `packages/web/src/router/modules/` aligned to target IA.
2. Keep legacy routes as redirect-only aliases for transition; do not remove old pages yet.
3. Define canonical paths for target IA modules and add explicit redirects from legacy paths.
4. Update default landing route (`packages/web/src/router/modules/home.ts`) to canonical workspace home.
5. Gate incomplete routes by registration or explicit route-guard flag (not `showLink` only).
6. Implement Module 1 pages as first-class entry:
   - dashboard/home card workspace
   - personal reimbursement and bank card block
   - personal certificates grid + expiry warning
7. Implement Module 2 unified tasklist as fixed split view (30/70).
8. Add global IT support drawer entry in top navbar (`packages/web/src/layout/components/lay-navbar/index.vue`).

Acceptance criteria:
- All roles can log in and reach default homepage without route errors.
- Approval center supports split view and action bar flow.
- Legacy deep links are redirected to canonical new paths.

### Sprint 2 - Field command + warehouse/assets
1. Refactor project hub to card grid and role-gated create action.
2. Refactor project workspace tabs (logs/sections, equipment/materials, files) with drawer-first detail interactions.
3. Implement warehouse order creator as left-search + right-cart mode.
4. Implement dispatch Kanban with receive-side status re-evaluation dialog.

Acceptance criteria:
- Project workspace supports role-based edit/read boundaries.
- Warehouse creation/dispatch follows select-only relationship input and numeric controls.

### Sprint 3 - Finance center
1. Build contract monitor with high-density table + threshold warning states.
2. Refactor external payment initiation flow to enforce `el-select` relationship selectors and `el-input-number` amount controls.
3. Refactor reimbursement batch payout flow with drawer-based execution registration.
4. Add financial snapshot dashboard (ECharts).

Acceptance criteria:
- Finance pages follow status-color semantics and no free-text relationship inputs.

### Sprint 4 - Admin settings and operations
1. Integrate approval workflow designer (Vue Flow) as full-page admin tool.
2. Finalize threshold rules, AI/runner monitor, system base dictionary management, WeCom integration panels.
3. Build raw data operations left-tree right-table layout.
4. Build helpdesk processing workstation with detail drawer.

Acceptance criteria:
- Admin-only pages strictly limited to `super_admin`.
- End-to-end role menu visibility matches RBAC matrix in `doc/Re-design UI.md`.

## Cross-Cutting UI Rules (Mandatory)
- Relationship fields: no text input; use searchable `el-select` or selector dialog/drawer.
- Numeric and money fields: use `el-input-number` with format constraints.
- Date/time fields: use date/time pickers only.
- Interaction priority: drawer > full-page form; popconfirm/dialog for lightweight confirmations.
- Status tags must follow semantic colors (green/blue/orange/red/gray).

## Migration Safety & Rollback
- Keep old routes as redirect-only aliases until each sprint passes smoke tests.
- Incomplete modules are gated by route registration strategy or explicit guard condition in `packages/web/src/router/index.ts`.
- Rollback method: switch menu exposure back to legacy route modules without touching APIs.

## API Wrapper Constraint Clarification
- Existing API wrappers must not be modified for behavior-breaking changes.
- Adding new wrapper files for new endpoints is allowed when required by new UI modules (for example, support ticket submit/list).
- If backend endpoint is not ready, ship UI shell with non-blocking placeholder and keep route gated.

## Verification Checklist Per Sprint
1. `pnpm -C packages/web typecheck`
2. `pnpm -C packages/web build`
3. Manual RBAC smoke:
   - `super_admin` / `manager` / `site_manager` / `operator`
   - menu visibility + page access + guarded redirects
4. UX checks:
   - drawer-first interactions
   - split view pages
   - status color semantics
   - select-only relationship inputs
