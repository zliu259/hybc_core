# Passkey + Project-Based Views (Web & Miniapp)

## TL;DR

> **Quick Summary**: Deliver doc-first design for Passkey bootstrap auth (WeCom-first) and project-based views across Web and Miniapp, then implement in phased, backward-compatible waves.
>
> **Deliverables**:
> - Updated planning and design docs (`doc/开发计划.md`, `doc/UI设计文档.md`, `doc/CLAUDE.md`, `doc/README.md`)
> - Web Passkey enrollment/login (after first WeCom login)
> - Web project workspace (project-centered one-stop views)
> - Miniapp project-centered module with all-project browse/read-detail support
>
> **Estimated Effort**: Large
> **Parallel Execution**: YES - 4 implementation waves + final verification
> **Critical Path**: T1 -> T6 -> T10 -> T15 -> T16 -> F1-F4

---

## Context

### Original Request
Add three requirements: (1) Passkey login after first WeCom login and enrollment, (2) project-based one-stop views on Web, (3) project-based module on Miniapp with all-project browse/read-detail access for non-participants while keeping Miniapp finance/warehouse unchanged. Complete docs/design first.

### Interview Summary
**Key Discussions**:
- User explicitly requests documentation and design first, then implementation.
- Changes affect auth architecture and information architecture across two clients.

**Research Findings**:
- Existing primary docs requiring synchronized updates: `doc/开发计划.md`, `doc/UI设计文档.md`, `doc/CLAUDE.md`, `doc/README.md`.
- Existing role model and API conventions must be preserved (`/api/v1`, WeCom userid linkage).

### Metis Review
**Identified Gaps (addressed in plan)**:
- Passkey environment constraints and rollout controls need explicit guardrails.
- Project-based IA can cause scope creep; explicit IN/OUT and migration compatibility are required.
- Non-participant visibility in Miniapp project details requires strict read-model boundaries.

---

## Work Objectives

### Core Objective
Introduce a secure, backward-compatible authentication extension (Passkey) and project-centric navigation model across Web/Miniapp, while making documentation the first delivered artifact and implementation follow approved design.

### Concrete Deliverables
- Updated requirement/design docs with architecture, UX flows, permissions, rollout, and migration strategy.
- Passkey APIs, storage, feature flag, and Web UI flows.
- Web project workspace route group and data contracts.
- Miniapp project module alignment and read-only all-project browsing.

### Definition of Done
- [ ] Required docs updated and internally consistent.
- [ ] WeCom-first -> Passkey enrollment/login flow passes QA scenarios.
- [ ] Web project workspace supports one-stop navigation for project/equipment/finance.
- [ ] Miniapp project module supports all-project browse + detail read for non-participants.
- [ ] Existing Miniapp finance/warehouse flows unchanged.

### Must Have
- Canonical identity remains WeCom `userid`; Passkey is attached credential.
- Docs/design changes land before implementation waves.
- Backward compatibility for existing routes and auth sessions.

### Must NOT Have (Guardrails)
- No replacement of WeCom bootstrap login.
- No destructive migration of existing auth/session tables.
- No expansion of Miniapp finance/warehouse scope.
- No implicit permission broadening of sensitive finance fields.

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** for task acceptance checks in execution phase.

### Test Decision
- **Infrastructure exists**: YES
- **Automated tests**: Tests-after
- **Framework**: Web (`pnpm typecheck`, `pnpm build`), API tests per existing scripts, Miniapp static/type checks + scripted API checks

### QA Policy
- Web UI flows: Playwright scenarios for auth and route transitions.
- API/auth: curl-based assertions for challenge lifecycle, register/auth, revoke.
- Miniapp APIs: curl + contract checks; client behavior via scripted page-state assertions where possible.
- Evidence path convention: `.sisyphus/evidence/task-{N}-{scenario}.{ext}`

---

## Execution Strategy

### Parallel Execution Waves

Wave 1 (Docs & Design First Gate):
- T1-T5

Wave 2 (Passkey Foundation & Security):
- T6-T10

Wave 3 (Web Project Workspace):
- T11-T15

Wave 4 (Miniapp Project Module Alignment):
- T16-T19

Wave FINAL (Independent Verification):
- F1-F4

### Dependency Matrix
- T1: — -> T6,T11,T16
- T2: — -> T11,T16
- T3: — -> T6,T11,T16
- T4: — -> All implementation tasks
- T5: — -> T11,T16
- T6: T1,T3 -> T7,T8,T9,T10
- T7: T6 -> T8,T9
- T8: T6,T7 -> T9,T10
- T9: T6,T8 -> T10
- T10: T8,T9 -> T15
- T11: T1,T2,T3,T5 -> T12,T13,T14
- T12: T11 -> T15
- T13: T11 -> T15
- T14: T11 -> T15
- T15: T10,T12,T13,T14 -> T19
- T16: T1,T2,T3,T5 -> T17,T18
- T17: T16 -> T19
- T18: T16 -> T19
- T19: T15,T17,T18 -> F1-F4

### Agent Dispatch Summary
- Wave 1: writing/unspecified-high (docs architecture consistency)
- Wave 2: deep/unspecified-high (auth security + API)
- Wave 3: visual-engineering/quick (web IA + UX)
- Wave 4: quick/unspecified-high (miniapp IA + policy checks)
- Final: oracle/deep/unspecified-high

---

## TODOs

- [ ] 1. Update `doc/开发计划.md` for new requirement stream (Docs-first)

  **What to do**:
  - Add a dedicated sub-phase for Passkey auth and project-based views.
  - Define explicit sequence: docs/design -> auth foundation -> web IA -> miniapp IA.

  **Must NOT do**:
  - Do not rewrite unrelated historical phases.

  **Recommended Agent Profile**:
  - **Category**: `writing`
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES (Wave 1)
  - **Blocks**: T6,T11,T16
  - **Blocked By**: None

  **References**:
  - `doc/开发计划.md`
  - `doc/CLAUDE.md`

  **Acceptance Criteria**:
  - [ ] New phase entries and milestones appear in `doc/开发计划.md`.
  - [ ] Sequence clearly marks doc-first gate before coding.

  **QA Scenarios**:
  - Scenario: planning doc contains new phase headings and checklist items.
  - Scenario: no unrelated phases removed or reordered unexpectedly.

- [ ] 2. Update `doc/UI设计文档.md` for project-based IA (Web + Miniapp)

  **What to do**:
  - Add web project workspace page map and route-level pointers.
  - Add miniapp project-based module map and non-participant read-only behavior.

  **Must NOT do**:
  - Do not alter miniapp finance/warehouse page logic requirements.

  **Recommended Agent Profile**:
  - **Category**: `writing`
  - **Skills**: [`frontend-ui-ux`]

  **Parallelization**:
  - **Can Run In Parallel**: YES (Wave 1)
  - **Blocks**: T11,T16
  - **Blocked By**: None

  **References**:
  - `doc/UI设计文档.md`
  - `packages/web/src/views/project/`
  - `packages/miniapp/pages/`

  **Acceptance Criteria**:
  - [ ] New page entries include concrete file-path targets.
  - [ ] Read-only vs participant actions are documented.

  **QA Scenarios**:
  - Scenario: grep finds new `project based` section and route/file pointers.
  - Scenario: miniapp finance/warehouse section unchanged except explicit boundary note.

- [ ] 3. Update `doc/CLAUDE.md` architecture constraints for Passkey

  **What to do**:
  - Add WeCom-first + Passkey-bound identity model.
  - Add passkey security constraints (challenge TTL, revocation, audit, fallback).

  **Must NOT do**:
  - Do not redefine core tech stack outside auth-related additions.

  **Recommended Agent Profile**:
  - **Category**: `writing`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (Wave 1)
  - **Blocks**: T6,T11,T16
  - **Blocked By**: None

  **References**:
  - `doc/CLAUDE.md`
  - `packages/api/src/routes/auth.ts`

  **Acceptance Criteria**:
  - [ ] Auth section defines canonical identity and passkey constraints.
  - [ ] Backward compatibility and rollout guardrails documented.

  **QA Scenarios**:
  - Scenario: search confirms passkey terms and WeCom-first invariant.
  - Scenario: no contradiction with existing role/API conventions.

- [ ] 4. Update `doc/README.md` index and doc linkage

  **What to do**:
  - Ensure new/updated doc sections are discoverable from index.
  - Add cross-links for auth and project-based IA decisions.

  **Must NOT do**:
  - Do not create extra scattered planning files.

  **Recommended Agent Profile**:
  - **Category**: `writing`

  **Parallelization**:
  - **Can Run In Parallel**: YES (Wave 1)
  - **Blocks**: all implementation tasks
  - **Blocked By**: None

  **References**:
  - `doc/README.md`

  **Acceptance Criteria**:
  - [ ] Index points to updated planning/design sections.

  **QA Scenarios**:
  - Scenario: read index and verify no broken or missing pointers.

- [ ] 5. Add doc-level migration/risk note to `doc/开发记录.md`

  **What to do**:
  - Append timestamped design decision log for passkey + project-based IA.

  **Must NOT do**:
  - Do not create additional development-log files.

  **Recommended Agent Profile**:
  - **Category**: `writing`

  **Parallelization**:
  - **Can Run In Parallel**: YES (Wave 1)
  - **Blocks**: T11,T16
  - **Blocked By**: None

  **References**:
  - `doc/开发记录.md`
  - `doc/README.md`

  **Acceptance Criteria**:
  - [ ] New timestamp section includes target/change/impact/next-step.

  **QA Scenarios**:
  - Scenario: verify only `doc/开发记录.md` is used for this log.

- [ ] 6. Add passkey persistence schema and migrations (API)

  **What to do**:
  - Add passkey credential and passkey audit tables with additive migrations.
  - Keep existing auth tables/sessions intact.

  **Must NOT do**:
  - No destructive migration or field removal.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`

  **Parallelization**:
  - **Can Run In Parallel**: YES (Wave 2)
  - **Blocks**: T7,T8,T9
  - **Blocked By**: T1,T3

  **References**:
  - `packages/api/migrations/`
  - `doc/CLAUDE.md`

  **Acceptance Criteria**:
  - [ ] Migration applies locally without altering old auth behavior.

  **QA Scenarios**:
  - Scenario: migration apply succeeds; rollback path documented.
  - Scenario: legacy WeCom login still works after migration.

- [ ] 7. Implement passkey challenge/session primitives

  **What to do**:
  - Add challenge issue/consume with TTL and one-time semantics.
  - Bind challenge to session action (register/authenticate).

  **Must NOT do**:
  - Do not persist reusable or long-lived challenge payloads.

  **Recommended Agent Profile**:
  - **Category**: `deep`

  **Parallelization**:
  - **Can Run In Parallel**: YES (Wave 2)
  - **Blocks**: T8,T9
  - **Blocked By**: T6

  **References**:
  - `packages/api/src/routes/auth.ts`
  - `packages/api/src/services/`

  **Acceptance Criteria**:
  - [ ] Challenge cannot be reused.
  - [ ] Expired challenge is rejected.

  **QA Scenarios**:
  - Scenario: issue challenge then consume once -> success.
  - Scenario: replay same challenge -> rejected with expected error.

- [ ] 8. Add passkey routes and auth-method session provenance

  **What to do**:
  - Implement register begin/finish, auth begin/finish, list/revoke endpoints.
  - Session token carries `auth_method` and `wecom_verified_at` metadata.

  **Must NOT do**:
  - Do not break `/api/v1/auth/login/web` and `/api/v1/user/me` contracts.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`

  **Parallelization**:
  - **Can Run In Parallel**: YES (Wave 2)
  - **Blocks**: T9,T10
  - **Blocked By**: T6,T7

  **References**:
  - `packages/api/src/routes/auth.ts`
  - `packages/api/src/middleware/auth.ts`

  **Acceptance Criteria**:
  - [ ] WeCom-first enrollment enforced.
  - [ ] Passkey login works for enrolled user.
  - [ ] Revoke removes credential from subsequent auth.

  **QA Scenarios**:
  - Scenario: unenrolled user attempts passkey auth -> rejected.
  - Scenario: enrolled user passkey auth -> success and `auth_method=passkey`.

- [ ] 9. Add Web passkey UX (enroll/manage/login entry)

  **What to do**:
  - Add settings UI to enroll/manage passkeys after WeCom login.
  - Add optional passkey login entry on web login page.

  **Must NOT do**:
  - Do not remove WeCom login entry.

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
  - **Skills**: [`frontend-ui-ux`]

  **Parallelization**:
  - **Can Run In Parallel**: YES (Wave 2)
  - **Blocks**: T10
  - **Blocked By**: T8

  **References**:
  - `packages/web/src/views/login/index.vue`
  - `packages/web/src/layout/components/lay-setting/index.vue`

  **Acceptance Criteria**:
  - [ ] Enroll and revoke flows available for logged-in users.
  - [ ] Login page supports passkey attempt and fallback to WeCom.

  **QA Scenarios**:
  - Scenario: first login via WeCom then enroll passkey -> success UI state.
  - Scenario: no passkey present -> clear fallback guidance shown.

- [ ] 10. Add passkey feature flag and rollout control

  **What to do**:
  - Add runtime switch for enable/disable and cohort rollout.

  **Must NOT do**:
  - Do not hardcode passkey enabled for all users in first release.

  **Recommended Agent Profile**:
  - **Category**: `deep`

  **Parallelization**:
  - **Can Run In Parallel**: YES (Wave 2)
  - **Blocks**: T15
  - **Blocked By**: T8,T9

  **References**:
  - `packages/api/src/types/env.ts`
  - `packages/api/src/services/auth.ts`
  - `packages/web/src/config/`

  **Acceptance Criteria**:
  - [ ] Toggle off fully hides/disables passkey entry points.

  **QA Scenarios**:
  - Scenario: feature disabled -> passkey endpoints guarded and UI hidden.

- [ ] 11. Define Web project workspace route model and navigation

  **What to do**:
  - Add project-scoped route group and navigation entry pattern.
  - Preserve compatibility with existing project list/detail routes.

  **Must NOT do**:
  - No hard removal of old routes in first rollout.

  **Recommended Agent Profile**:
  - **Category**: `quick`

  **Parallelization**:
  - **Can Run In Parallel**: YES (Wave 3)
  - **Blocks**: T12,T13,T14
  - **Blocked By**: T1,T2,T3,T5

  **References**:
  - `packages/web/src/router/modules/project.ts`
  - `packages/web/src/views/project/`

  **Acceptance Criteria**:
  - [ ] Project workspace route is reachable from project list.
  - [ ] Legacy project detail route remains functional.

  **QA Scenarios**:
  - Scenario: navigate old route and new workspace route, both render.

- [ ] 12. Build Web project workspace: project management panel

  **What to do**:
  - Add project overview/edit/read model in project context.

  **Must NOT do**:
  - No cross-project state leakage.

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`

  **Parallelization**:
  - **Can Run In Parallel**: YES (Wave 3)
  - **Blocks**: T15
  - **Blocked By**: T11

  **References**:
  - `packages/web/src/views/project/detail.vue`
  - `packages/web/src/api/project.ts`

  **Acceptance Criteria**:
  - [ ] Workspace project panel loads by `projectId`.

  **QA Scenarios**:
  - Scenario: switch between two projects rapidly; panel data stays isolated.

- [ ] 13. Build Web project workspace: equipment panel

  **What to do**:
  - Surface project-linked equipment summary/list/actions in same workspace.

  **Must NOT do**:
  - No duplicated business logic diverging from existing equipment pages.

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`

  **Parallelization**:
  - **Can Run In Parallel**: YES (Wave 3)
  - **Blocks**: T15
  - **Blocked By**: T11

  **References**:
  - `packages/web/src/views/project/equipment-view.vue`
  - `packages/web/src/views/asset/`

  **Acceptance Criteria**:
  - [ ] Equipment panel reflects selected project context only.

  **QA Scenarios**:
  - Scenario: switch project context and validate equipment list refreshes.

- [ ] 14. Build Web project workspace: finance panel

  **What to do**:
  - Add project financial summary and links to payment/receipt/reimbursement scoped views.

  **Must NOT do**:
  - No permission bypass for finance-sensitive fields.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`

  **Parallelization**:
  - **Can Run In Parallel**: YES (Wave 3)
  - **Blocks**: T15
  - **Blocked By**: T11

  **References**:
  - `packages/web/src/views/finance/`
  - `packages/api/src/routes/project.ts`

  **Acceptance Criteria**:
  - [ ] Finance panel obeys role-based visibility.

  **QA Scenarios**:
  - Scenario: operator vs manager visibility differs as specified.

- [ ] 15. Integrate workspace tabs, deep links, and permission gates

  **What to do**:
  - Unify tabbed workspace navigation and route-state persistence.
  - Connect passkey rollout constraints to secure pages if policy requires.

  **Must NOT do**:
  - No route loops/blank state regressions during tab switching.

  **Recommended Agent Profile**:
  - **Category**: `deep`

  **Parallelization**:
  - **Can Run In Parallel**: NO (Wave 3 close-out)
  - **Blocks**: T19
  - **Blocked By**: T10,T12,T13,T14

  **References**:
  - `packages/web/src/layout/components/lay-content/index.vue`
  - `packages/web/src/router/index.ts`

  **Acceptance Criteria**:
  - [ ] Opening >3 tabs does not blank content area.

  **QA Scenarios**:
  - Scenario: open 5+ workspace tabs and switch repeatedly; all render.
  - Scenario: deep-link open to specific workspace tab works after refresh.

- [ ] 16. Design and implement Miniapp project-based list/detail structure

  **What to do**:
  - Refactor miniapp project module to project-based view hierarchy aligned with web model.

  **Must NOT do**:
  - No changes to finance/warehouse module behavior.

  **Recommended Agent Profile**:
  - **Category**: `quick`

  **Parallelization**:
  - **Can Run In Parallel**: YES (Wave 4)
  - **Blocks**: T17,T18
  - **Blocked By**: T1,T2,T3,T5

  **References**:
  - `packages/miniapp/pages/index/`
  - `packages/miniapp/app.json`

  **Acceptance Criteria**:
  - [ ] Project module navigation follows project-based pattern.

  **QA Scenarios**:
  - Scenario: project list -> project detail path works from cold start.

- [ ] 17. Add all-project browse/read-detail for non-participants (Miniapp)

  **What to do**:
  - Allow all users to view project list and open detail pages in read-only mode when non-participant.

  **Must NOT do**:
  - No participant-only action exposure to non-participants.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`

  **Parallelization**:
  - **Can Run In Parallel**: YES (Wave 4)
  - **Blocks**: T19
  - **Blocked By**: T16

  **References**:
  - `packages/miniapp/pages/index/index.js`
  - `packages/api/src/routes/project.ts`

  **Acceptance Criteria**:
  - [ ] Non-participant can browse list/detail only.
  - [ ] Restricted actions hidden/blocked.

  **QA Scenarios**:
  - Scenario: non-participant opens project detail and sees read-only surface.
  - Scenario: restricted action attempt returns expected denial.

- [ ] 18. Keep Miniapp finance and warehouse modules stable (regression lock)

  **What to do**:
  - Ensure navigation and API bindings for finance/warehouse stay unchanged.

  **Must NOT do**:
  - No refactor of miniapp finance/warehouse flows in this stream.

  **Recommended Agent Profile**:
  - **Category**: `quick`

  **Parallelization**:
  - **Can Run In Parallel**: YES (Wave 4)
  - **Blocks**: T19
  - **Blocked By**: T16

  **References**:
  - `packages/miniapp/pages/finance/`
  - `packages/miniapp/pages/warehouse/`

  **Acceptance Criteria**:
  - [ ] Existing finance/warehouse routes and key actions still pass baseline checks.

  **QA Scenarios**:
  - Scenario: smoke-run current finance and warehouse top flows unchanged.

- [ ] 19. End-to-end integration, rollout notes, and release gate

  **What to do**:
  - Integrate auth + web + miniapp behavior behind controlled rollout steps.
  - Publish release gate criteria and rollback checklist.

  **Must NOT do**:
  - No global rollout before doc/design signoff and smoke pass.

  **Recommended Agent Profile**:
  - **Category**: `deep`

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Blocks**: F1-F4
  - **Blocked By**: T15,T17,T18

  **References**:
  - `doc/开发计划.md`
  - `doc/开发记录.md`
  - `packages/web/src/router/`
  - `packages/miniapp/pages/`

  **Acceptance Criteria**:
  - [ ] Rollout plan includes feature-flag cohorts and rollback path.
  - [ ] All mandatory evidence artifacts exist for prior tasks.

  **QA Scenarios**:
  - Scenario: rollout OFF keeps legacy behavior.
  - Scenario: rollout ON for cohort enables new flows without regressions.

---

## Final Verification Wave (MANDATORY)

- [ ] F1. **Plan Compliance Audit** (`oracle`)
  - Verify all Must Have / Must NOT Have against diffs and evidence.

- [ ] F2. **Code Quality Review** (`unspecified-high`)
  - Run typecheck/lint/build and static smell checks.

- [ ] F3. **Real QA Replay** (`unspecified-high` + `playwright`)
  - Re-run all scenario scripts and collect evidence artifacts.

- [ ] F4. **Scope Fidelity Check** (`deep`)
  - Ensure no unauthorized scope expansion, especially Miniapp finance/warehouse.

---

## Commit Strategy

- Group A (Docs-first): `docs(plan): add passkey and project-based view design`
- Group B (Auth foundation): `feat(auth): add passkey enrollment and login flow`
- Group C (Web IA): `feat(web): introduce project workspace routes and views`
- Group D (Miniapp IA): `feat(miniapp): align project module to project-based views`

---

## Success Criteria

### Verification Commands
```bash
cd packages/web && pnpm typecheck && pnpm build
cd packages/api && npm run typecheck
cd packages/miniapp && npm run typecheck
```

### Final Checklist
- [ ] Docs updated and approved before implementation starts
- [ ] Passkey flow works with WeCom-first bootstrap and revocation
- [ ] Web project workspace complete for project/equipment/finance context
- [ ] Miniapp all-project browse + project detail read works for non-participants
- [ ] Miniapp finance/warehouse module behavior unchanged
