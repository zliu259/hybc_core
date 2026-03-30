# Warehouse System Upgrade Architecture Work Plan

## TL;DR

> **Quick Summary**: Extend the current `AssetType / TrackedAsset / tracked_asset_event / stock_order / project_equipment_plan` baseline into a warehouse architecture that supports composite pipe-jacking machines, modification workflows, maintenance gates, project freight attribution, and an availability dispatch board.
>
> **Deliverables**:
> - One architecture source-of-truth document for composite assets, workflows, state machines, and read models
> - One baseline-alignment map showing how the new design extends existing repo concepts
> - One phased rollout roadmap with required doc sync across plan, UI map, index, and decision log
>
> **Estimated Effort**: Medium
> **Parallel Execution**: YES - 3 waves
> **Critical Path**: Task 1 → Task 3 → Task 6 → Task 8 → Task 11 → Task 15

---

## Context

### Original Request
Design an upgraded warehouse architecture without writing code. The upgrade must handle composite pipe-jacking machines made of shell, core, and console; support modification and component swaps; tie service life to the core; support cases where shells are abandoned underground and only the core returns; enforce maintenance/inspection gates before dispatch; provide a unified work/task center; allocate transport cost to projects; and expose an availability dispatch board.

### Interview Summary
**Confirmed business decisions**:
- Pipe-jacking machines consist of shell, core, and console.
- Some shells are compatible with some cores; some consoles are compatible with some cores.
- The system must support both assembled-machine selection and compatible-components selection with a “modification required” warning.
- Service life is anchored on the core.
- A shell may be abandoned underground; the shell is scrapped while the core returns and remains traceable.
- Major equipment cannot leave the warehouse unless maintenance/service is complete.
- Returned equipment cannot be re-dispatched until inspection/service is complete.
- Warehouse flow is: site project manager initiates → office reviews/supplements → warehouse executes.
- Transport is arranged by warehouse, with budget and prepayment prepared in advance, but freight is charged to the project.
- History must be queryable by shell and by core.
- Other equipment can also be modified, but does not require the same composite-asset model.
- The dispatch board must show both immediately available assets and assets available after modification.

**User-confirmed architecture choices**:
- Keep both a whole-machine number and component asset numbers.
- v1 compatibility is maintained through manual allow-lists.
- Use one unified task center for inspection, maintenance, servicing, modification, and scrapping.
- Allow exception release only through management-level special approval with audit trace.
- Keep three parameter layers: original/factory, current/effective, and project-temporary.
- Freight allocation is project-level only in v1, not device-level.
- After a modification, overwrite the current configuration, but preserve the original/factory baseline.
- The ledger is internal-use only; there is no external audit/tax requirement driving identity design.

**Repo findings**:
- `doc/CLAUDE.md:197-200` defines tracked assets as having unique identity, maintainability, performance parameters, and full document/event timeline.
- `doc/CLAUDE.md:202-205,228-235` defines the approval engine and current role model.
- `doc/开发计划.md:348-405` defines the Phase 6 asset/warehouse baseline: `warehouse`, `asset_type`, `tracked_asset`, `tracked_asset_document`, `tracked_asset_event`, `inventory`, `stock_order`, and `project_equipment_plan`.
- `packages/api/src/types/asset.ts:1-72` and `packages/api/src/routes/asset.ts:30-38,384-432,493-616` define the current identity, event, and document model for tracked assets.
- `packages/api/src/services/serial.ts:1-49` already provides reusable serial-number patterns for document/order numbering.
- The repo does **not** currently model composite assets, parent-child component relations, or assembly history as first-class concepts.

### Metis Review
**Gaps addressed in this plan**:
- Prevent identity confusion between whole-machine and component identities
- Keep compatibility manual in v1 and block scope creep into a rule engine
- Define gate policies as workflow/state rules instead of UI-only checks
- Keep freight attribution project-level and avoid full accounting-platform expansion
- Explicitly handle shell-buried/core-recovered, special override, and reservation/conflict edge cases

---

## Work Objectives

### Core Objective
Produce a repo-aligned architecture package that explains how composite pipe-jacking assets, work tasks, dispatch/return gates, transport attribution, history reconstruction, and availability projections should work, so later implementation can proceed without re-deciding core business structure.

### Concrete Deliverables
- `doc/库房系统升级架构设计.md`
- Architecture sections covering scope, glossary, identity, compatibility/configuration, parameter model, lifecycle state machines, unified task center, dispatch/return flow, freight attribution, history model, dispatch board read model, and rollout roadmap
- `doc/UI设计文档.md` updates for affected pages and any new page/file-path mappings
- `doc/开发计划.md` updates for phased delivery sequencing
- `doc/README.md` index update and `doc/开发记录.md` architecture decision log entry

### Definition of Done
- [ ] The architecture docs define whole-machine identity, component identity, assembly/configuration history, compatibility, parameter layers, lifecycle states, tasks, gates, freight attribution, and dispatch-board categories.
- [ ] Every new concept is either mapped to an existing repo concept or clearly identified as an additive extension.
- [ ] UI doc updates include concrete page/file-path mappings.
- [ ] The development plan includes a sequenced rollout path.
- [ ] All acceptance can be verified by agent-run Read/Grep checks and saved evidence files.

### Must Have
- Core is the life/maintenance anchor
- Shell/core/console each remain independently traceable
- Whole-machine number and component numbers both exist
- Current configuration is the runtime truth, but original/factory baseline is preserved
- Dispatch/return gates and management override are explicit
- Freight is attributed to the project
- Unified task center covers inspection, maintenance, servicing, modification, and scrapping
- Dispatch board distinguishes “available now” vs “available after modification”

### Must NOT Have (Guardrails)
- Do not replace or discard `AssetType / TrackedAsset / tracked_asset_event / stock_order / project_equipment_plan`
- Do not build an automatic compatibility rules engine in v1
- Do not introduce device-level freight apportionment in v1
- Do not expand the unified task center into a generic BPM platform
- Do not force every equipment type into the pipe-jacking composite model
- Do not rely on undocumented human interpretation for key policy decisions

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** — This is architecture/doc work. Every check must be executable by an agent using `Read`, `Grep`, or read-only `Bash`.

### Test Decision
- **Infrastructure exists**: YES
- **Automated tests**: None (no code implementation in scope)
- **Framework**: none
- **Verification mode**: documentation QA-first

### QA Policy
For every task:
1. Write the QA scenarios first
2. Write or update the documentation section
3. Run Read/Grep checks
4. Save evidence under `.sisyphus/evidence/`

This is the doc-work equivalent of RED → GREEN → VERIFY.

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Foundations)
├── Task 1: Architecture source-of-truth and glossary [writing]
├── Task 2: Current-system baseline alignment map [deep]
├── Task 3: Asset identity and numbering model [deep]
├── Task 4: Compatibility and configuration model [deep]
└── Task 5: Parameter layering and current-configuration rules [writing]

Wave 2 (Core policy/process design)
├── Task 6: Lifecycle state machines [deep]
├── Task 7: Unified task center and work-order taxonomy [unspecified-high]
├── Task 8: Dispatch / return / override gates [deep]
├── Task 9: Transport budgeting and project freight attribution [unspecified-high]
└── Task 10: History/query model and event taxonomy [deep]

Wave 3 (Read models and rollout)
├── Task 11: Dispatch-board read model and availability calculation [deep]
├── Task 12: Non-TBM modification boundary and shared abstraction [writing]
├── Task 13: Bounded contexts / aggregates / schema delta proposal [unspecified-high]
├── Task 14: UI page and permission impact map [writing]
└── Task 15: Phased rollout, doc sync, and future decision checklist [writing]

Wave FINAL (After all tasks)
├── F1: Plan compliance audit [oracle]
├── F2: Documentation consistency review [unspecified-high]
├── F3: Scenario replay QA [deep]
└── F4: Scope fidelity check [deep]

Critical Path: 1 → 3 → 6 → 8 → 11 → 15 → F1-F4
Max Concurrent: 5
```

### Dependency Matrix
- **1**: — → 6, 7, 8, 10, 15
- **2**: — → 13, 14, 15
- **3**: 1 → 6, 8, 10, 11, 13
- **4**: 1, 2 → 6, 8, 11, 13
- **5**: 1, 3, 4 → 6, 8, 10, 11
- **6**: 1, 3, 4, 5 → 8, 10, 11, 13, 15
- **7**: 1, 2 → 8, 9, 11, 14, 15
- **8**: 1, 3, 5, 6, 7 → 9, 11, 14, 15
- **9**: 7, 8 → 11, 13, 15
- **10**: 3, 5, 6 → 11, 13, 15
- **11**: 6, 7, 8, 9, 10 → 14, 15
- **12**: 1, 4, 7 → 13, 15
- **13**: 2, 3, 4, 6, 9, 10, 12 → 15
- **14**: 2, 7, 8, 11 → 15
- **15**: 1, 2, 6, 8, 9, 10, 11, 13, 14 → F1-F4

### Agent Dispatch Summary
- **Wave 1**: 5 agents — T1 `writing`, T2-T4 `deep`, T5 `writing`
- **Wave 2**: 5 agents — T6 `deep`, T7 `unspecified-high`, T8 `deep`, T9 `unspecified-high`, T10 `deep`
- **Wave 3**: 5 agents — T11 `deep`, T12 `writing`, T13 `unspecified-high`, T14 `writing`, T15 `writing`
- **Final**: 4 agents — F1 `oracle`, F2 `unspecified-high`, F3 `deep`, F4 `deep`

---

## TODOs

- [ ] 1. Architecture source-of-truth and glossary

  **What to do**:
  - Create or update `doc/库房系统升级架构设计.md` as the primary architecture document.
  - Define scope, non-goals, glossary, and all user-confirmed decisions.

  **Must NOT do**:
  - Do not include implementation code, SQL, or pixel-level UI specs.
  - Do not present unresolved ideas as approved decisions.

  **Recommended Agent Profile**:
  - **Category**: `writing`
    - Reason: This task is about clarity, vocabulary, and scope control.
  - **Skills**: [`everything-claude-code:architecture-decision-records`, `everything-claude-code:product-lens`]
    - `everything-claude-code:architecture-decision-records`: Capture durable architecture decisions.
    - `everything-claude-code:product-lens`: Keep the business goal and boundaries explicit.
  - **Skills Evaluated but Omitted**:
    - `everything-claude-code:api-design`: Not at API level yet.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: 6, 7, 8, 10, 15
  - **Blocked By**: None

  **References**:
  - `doc/CLAUDE.md:197-205` - Official repo language for assets and approvals.
  - `doc/开发计划.md:348-405` - Existing Phase 6 baseline to extend instead of replace.
  - `AGENTS.md:13-18` - Mandatory doc index, decision log, and UI-mapping rules.

  **Acceptance Criteria**:
  - [ ] The source-of-truth doc contains sections for background, scope, glossary, confirmed decisions, non-goals, and future decisions.
  - [ ] The glossary explicitly defines whole-machine number, shell, core, console, unified task center, special override, and project-level freight.

  **QA Scenarios**:
  ```
  Scenario: Required architecture sections exist
    Tool: Read + Grep
    Preconditions: `doc/库房系统升级架构设计.md` exists
    Steps:
      1. Read the first 200 lines.
      2. Grep for: `Glossary`, `Scope`, `Confirmed Decisions`, `Non-goals`, `Future Decisions`.
      3. Confirm all required sections are present.
    Expected Result: All mandatory sections exist and are readable.
    Failure Indicators: Missing section or missing key business term.
    Evidence: .sisyphus/evidence/task-1-outline.txt

  Scenario: Scope guardrails are explicit
    Tool: Grep
    Preconditions: scope section is written
    Steps:
      1. Grep for `rules engine`, `device-level freight`, `external audit`.
      2. Confirm they appear only under non-goals or later phases.
    Expected Result: Scope is clearly constrained.
    Evidence: .sisyphus/evidence/task-1-scope-guard.txt
  ```

  **Evidence to Capture**:
  - [ ] task-1-outline.txt
  - [ ] task-1-scope-guard.txt

  **Commit**: NO

- [ ] 2. Current-system baseline alignment map

  **What to do**:
  - Build a table mapping current repo concepts to their role in the upgraded architecture.
  - Mark each concept as reused, extended, or additive.

  **Must NOT do**:
  - Do not declare current baseline objects obsolete.
  - Do not ignore UI and API realities already in the repo.

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: This requires cross-checking docs, types, routes, and UI map.
  - **Skills**: [`everything-claude-code:codebase-onboarding`, `everything-claude-code:architecture-decision-records`]
    - `everything-claude-code:codebase-onboarding`: Extract baseline objects and conventions.
    - `everything-claude-code:architecture-decision-records`: Record reuse/extend/add decisions.
  - **Skills Evaluated but Omitted**:
    - `everything-claude-code:database-migrations`: Not yet at migration detail.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: 13, 14, 15
  - **Blocked By**: None

  **References**:
  - `doc/开发计划.md:348-399` - Existing warehouse and asset baseline.
  - `packages/api/src/types/asset.ts:1-72` - Asset, rental, document, and event types.
  - `packages/api/src/routes/asset.ts:384-432,493-616` - Current tracked-asset creation/update/event behavior.
  - `doc/UI设计文档.md:81-93` - Existing asset/warehouse/dispatch/equipment-plan pages.

  **Acceptance Criteria**:
  - [ ] The alignment map covers at least 8 existing objects/pages.
  - [ ] Every new concept is mapped to “extend existing object” or “additive new object”.

  **QA Scenarios**:
  ```
  Scenario: Baseline object coverage is complete
    Tool: Grep
    Preconditions: alignment section exists
    Steps:
      1. Grep for `warehouse`, `asset_type`, `tracked_asset`, `tracked_asset_event`, `stock_order`, `project_equipment_plan`, `inventory`.
      2. Confirm every listed object appears in the mapping table.
    Expected Result: No core baseline object is omitted.
    Evidence: .sisyphus/evidence/task-2-baseline-map.txt

  Scenario: No replacement design sneaks in
    Tool: Grep
    Preconditions: alignment section exists
    Steps:
      1. Grep for `replace tracked_asset`, `retire stock_order`, `obsolete project_equipment_plan`.
      2. Confirm none of those ideas are presented as the v1 plan.
    Expected Result: The design is clearly extend-not-replace.
    Evidence: .sisyphus/evidence/task-2-no-replacement.txt
  ```

  **Evidence to Capture**:
  - [ ] task-2-baseline-map.txt
  - [ ] task-2-no-replacement.txt

  **Commit**: NO

- [ ] 3. Asset identity and numbering model

  **What to do**:
  - Define identity boundaries for whole-machine number, shell number, core number, and console number.
  - Define how time-bounded configuration/assembly links those identities together.

  **Must NOT do**:
  - Do not permanently bind whole-machine number to one shell.
  - Do not collapse component traceability into the whole-machine view.

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Identity design is the core structural decision.
  - **Skills**: [`everything-claude-code:architecture-decision-records`]
    - `everything-claude-code:architecture-decision-records`: Capture durable identity rules.
  - **Skills Evaluated but Omitted**:
    - `everything-claude-code:api-design`: Identity first, API later.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: 6, 8, 10, 11, 13
  - **Blocked By**: 1

  **References**:
  - `packages/api/src/types/asset.ts:14-31` - Current tracked-asset identity fields.
  - `packages/api/src/routes/asset.ts:30-38,384-432` - Current `HY-{TYPE}-{SEQ}` asset-code generation and create flow.
  - `packages/api/src/services/serial.ts:1-49` - Existing serial-number pattern for documents/orders.
  - `doc/CLAUDE.md:197-200,266-269` - Existing asset and serial conventions.

  **Acceptance Criteria**:
  - [ ] The doc defines all four identity layers.
  - [ ] The doc states that one core may be associated with multiple shells over time, but only one current configuration exists at a point in time.
  - [ ] The doc explicitly states internal traceability has priority over external audit requirements.

  **QA Scenarios**:
  ```
  Scenario: Identity layers are explicit
    Tool: Read
    Preconditions: identity section exists
    Steps:
      1. Read the identity section.
      2. Confirm it defines whole-machine, shell, core, console, and current configuration.
      3. Confirm it distinguishes business view from traceability view.
    Expected Result: Identity structure is unambiguous.
    Evidence: .sisyphus/evidence/task-3-identity-model.txt

  Scenario: Current configuration is unique per point in time
    Tool: Grep
    Preconditions: identity section exists
    Steps:
      1. Grep for `point in time`, `single current configuration`, `time-bounded assembly`.
      2. Confirm all three constraints are present.
    Expected Result: No multi-current ambiguity.
    Evidence: .sisyphus/evidence/task-3-current-config-uniqueness.txt
  ```

  **Evidence to Capture**:
  - [ ] task-3-identity-model.txt
  - [ ] task-3-current-config-uniqueness.txt

  **Commit**: NO

- [ ] 4. Compatibility and configuration model

  **What to do**:
  - Define manual allow-lists for shell↔core and core↔console compatibility.
  - Define the difference between compatible, currently assembled, and modification-required.

  **Must NOT do**:
  - Do not introduce automatic compatibility inference.
  - Do not treat compatibility as if it means “already assembled”.

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: This task separates compatibility policy from current physical configuration.
  - **Skills**: [`everything-claude-code:product-lens`]
    - `everything-claude-code:product-lens`: Helps keep “can combine” separate from “ready to dispatch”.
  - **Skills Evaluated but Omitted**:
    - `everything-claude-code:database-migrations`: Not yet defining tables.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: 6, 8, 11, 13
  - **Blocked By**: 1, 2

  **References**:
  - `doc/CLAUDE.md:197-200` - Existing assets support modification, which aligns with this model.
  - `doc/开发计划.md:371-387` - Existing stock-order and equipment-plan baseline.
  - `doc/UI设计文档.md:88-93` - Existing dispatch and project-equipment pages.

  **Acceptance Criteria**:
  - [ ] The doc distinguishes compatibility, current assembly, and modification-required.
  - [ ] The doc explicitly states manual allow-list is the v1 source of truth.
  - [ ] The doc includes both assembled-outbound and compatible-but-needs-modification examples.

  **QA Scenarios**:
  ```
  Scenario: Compatibility is not the same as assembly
    Tool: Read + Grep
    Preconditions: compatibility section exists
    Steps:
      1. Grep for `compatibility`, `assembly`, `modification required`.
      2. Read those paragraphs.
      3. Confirm the three concepts are defined separately.
    Expected Result: Clear conceptual separation.
    Evidence: .sisyphus/evidence/task-4-compatibility-vs-assembly.txt

  Scenario: No rules engine scope creep
    Tool: Grep
    Preconditions: compatibility section exists
    Steps:
      1. Grep for `automatic rules engine`, `parameter-derived compatibility`.
      2. Confirm they appear only as later-phase ideas or non-goals.
    Expected Result: v1 stays manual.
    Evidence: .sisyphus/evidence/task-4-manual-allowlist.txt
  ```

  **Evidence to Capture**:
  - [ ] task-4-compatibility-vs-assembly.txt
  - [ ] task-4-manual-allowlist.txt

  **Commit**: NO

- [ ] 5. Parameter layering and current-configuration rules

  **What to do**:
  - Define original/factory, current/effective, and project-temporary parameter layers.
  - Define which parameters belong to component assets and which belong to the whole-machine view.

  **Must NOT do**:
  - Do not allow project-temporary values to overwrite factory baseline.
  - Do not describe current parameters without context of configuration and component relationships.

  **Recommended Agent Profile**:
  - **Category**: `writing`
    - Reason: This is mainly a semantic and data-ownership definition task.
  - **Skills**: [`everything-claude-code:architecture-decision-records`]
    - `everything-claude-code:architecture-decision-records`: Capture parameter-layer rules explicitly.
  - **Skills Evaluated but Omitted**:
    - `everything-claude-code:api-design`: Not yet at contract detail.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: 6, 8, 10, 11
  - **Blocked By**: 1, 3, 4

  **References**:
  - `doc/CLAUDE.md:198-200` - Tracked assets already have performance parameters.
  - `packages/api/src/types/asset.ts:14-31` - `properties_json` is the current parameter carrier.
  - `doc/UI设计文档.md:81-93` - Asset detail/dashboard/project-equipment pages will consume these semantics.

  **Acceptance Criteria**:
  - [ ] All three parameter layers are defined.
  - [ ] The doc explicitly states current configuration is overwritten after modification, but factory baseline is preserved.
  - [ ] At least one key parameter example (such as outer diameter) is described across all three layers.

  **QA Scenarios**:
  ```
  Scenario: All three parameter layers are present
    Tool: Grep
    Preconditions: parameter section exists
    Steps:
      1. Grep for `factory`, `current`, `project-temporary`.
      2. Confirm each has a definition and purpose.
    Expected Result: Parameter layering is complete.
    Evidence: .sisyphus/evidence/task-5-parameter-layers.txt

  Scenario: Factory baseline cannot be overwritten
    Tool: Read
    Preconditions: parameter section exists
    Steps:
      1. Read the modification rule subsection.
      2. Confirm it explicitly says current may change while factory baseline is preserved.
    Expected Result: Parameter-history policy is clear.
    Evidence: .sisyphus/evidence/task-5-factory-preserved.txt
  ```

  **Evidence to Capture**:
  - [ ] task-5-parameter-layers.txt
  - [ ] task-5-factory-preserved.txt

  **Commit**: NO

- [ ] 6. Lifecycle state machines

  **What to do**:
  - Define lifecycle state machines for shell, core, console, whole-machine business view, and configuration relationship.
  - Cover available, reserved, in transit, on project, returned quarantine, inspection, service, modification, scrapped, buried shell, and recovered core.

  **Must NOT do**:
  - Do not allow “on project” and “dispatchable” to coexist.
  - Do not omit buried-shell and recovered-core edge states.

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: State machines drive availability, gates, and history consistency.
  - **Skills**: [`everything-claude-code:architecture-decision-records`]
    - `everything-claude-code:architecture-decision-records`: Capture durable state transitions.
  - **Skills Evaluated but Omitted**:
    - `everything-claude-code:api-design`: State logic before endpoint design.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: 8, 10, 11, 13, 15
  - **Blocked By**: 1, 3, 4, 5

  **References**:
  - `doc/CLAUDE.md:197-200` - Tracked assets require full lifecycle and event timeline.
  - `doc/开发计划.md:371-399` - Stock orders, equipment planning, inventory, and dashboard are downstream consumers of state.
  - `packages/api/src/types/asset.ts:14-31,62-72` - Existing asset state and event structures.

  **Acceptance Criteria**:
  - [ ] The document defines state sets and legal transitions for at least 5 object/view types.
  - [ ] Returned assets are explicitly routed through quarantine/inspection before release.
  - [ ] Buried-shell and recovered-core handling is explicit.

  **QA Scenarios**:
  ```
  Scenario: State machine covers critical paths
    Tool: Read + Grep
    Preconditions: lifecycle section exists
    Steps:
      1. Grep for `returned quarantine`, `inspection`, `service`, `modification`, `scrapped`.
      2. Read the related transition table or diagram.
    Expected Result: All critical states are represented.
    Evidence: .sisyphus/evidence/task-6-lifecycle-states.txt

  Scenario: Mutually exclusive states are explicit
    Tool: Read
    Preconditions: lifecycle section exists
    Steps:
      1. Read definitions for `available`, `on project`, and `in transit`.
      2. Confirm they are defined as mutually exclusive.
    Expected Result: Availability logic is unambiguous.
    Evidence: .sisyphus/evidence/task-6-mutual-exclusion.txt
  ```

  **Evidence to Capture**:
  - [ ] task-6-lifecycle-states.txt
  - [ ] task-6-mutual-exclusion.txt

  **Commit**: NO

- [ ] 7. Unified task center and work-order taxonomy

  **What to do**:
  - Define task/work-order types, statuses, owners, triggers, and closure conditions.
  - Define which fields are universal and which are composite-asset-specific.

  **Must NOT do**:
  - Do not turn the task center into a generic BPM platform.
  - Do not require shell/core/console fields for every equipment type.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: This task spans asset, warehouse, and approval boundaries.
  - **Skills**: [`everything-claude-code:product-lens`]
    - `everything-claude-code:product-lens`: Helps separate useful unification from over-platformization.
  - **Skills Evaluated but Omitted**:
    - `everything-claude-code:api-design`: Not yet at endpoint expansion.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: 8, 9, 11, 14, 15
  - **Blocked By**: 1, 2

  **References**:
  - `doc/UI设计文档.md:70-75` - Existing unified workbench/approval-center pages.
  - `doc/CLAUDE.md:202-205,228-235` - Approval engine and role model.
  - `doc/开发计划.md:362-387` - Existing tracked-asset, stock-order, and equipment-plan flow.

  **Acceptance Criteria**:
  - [ ] At least 5 task types are defined: inspection, maintenance, servicing, modification, scrapping.
  - [ ] The doc distinguishes generic equipment tasks from pipe-jacking composite tasks.
  - [ ] The doc defines the relationship between task closure and dispatch release.

  **QA Scenarios**:
  ```
  Scenario: Core task taxonomy is complete
    Tool: Grep
    Preconditions: task-center section exists
    Steps:
      1. Grep for `inspection`, `maintenance`, `servicing`, `modification`, `scrapping`.
      2. Confirm each is defined.
    Expected Result: The unified task taxonomy is complete.
    Evidence: .sisyphus/evidence/task-7-task-taxonomy.txt

  Scenario: Non-TBM work stays simple
    Tool: Read
    Preconditions: task-center section exists
    Steps:
      1. Read the non-TBM subsection.
      2. Confirm it says generic equipment can use the same task center without composite-asset fields.
    Expected Result: Reuse boundary is clear.
    Evidence: .sisyphus/evidence/task-7-non-tbm-boundary.txt
  ```

  **Evidence to Capture**:
  - [ ] task-7-task-taxonomy.txt
  - [ ] task-7-non-tbm-boundary.txt

  **Commit**: NO

- [ ] 8. Dispatch / return / override gates

  **What to do**:
  - Define the complete operational path: site PM request → office review/supplement → warehouse execution → transport arrangement → site receipt / return → inspection/service → available again.
  - Define gate-release logic, return quarantine, management special override, and audit trace requirements.

  **Must NOT do**:
  - Do not describe gates as UI-only reminders.
  - Do not allow override without management accountability and audit.

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: This is a cross-role, cross-state, cross-approval workflow.
  - **Skills**: [`everything-claude-code:product-lens`, `everything-claude-code:architecture-decision-records`]
    - `everything-claude-code:product-lens`: Clarifies multi-role workflow intent.
    - `everything-claude-code:architecture-decision-records`: Records release-gate policy.
  - **Skills Evaluated but Omitted**:
    - `everything-claude-code:security-review`: Not the primary focus here.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: 9, 11, 14, 15
  - **Blocked By**: 1, 3, 5, 6, 7

  **References**:
  - `doc/CLAUDE.md:202-205,228-235` - Available approval-node types and role model.
  - `doc/开发计划.md:371-379` - Existing stock-order flow and approval integration.
  - `doc/UI设计文档.md:88-89,92-93` - Stock-order, dispatch, and project-equipment pages.

  **Acceptance Criteria**:
  - [ ] The standard outbound and return paths are explicitly written.
  - [ ] The “cannot dispatch before required maintenance/service” rule is explicit.
  - [ ] Override trigger, approver, audit data, and bypassed gate recording are explicit.

  **QA Scenarios**:
  ```
  Scenario: Standard dispatch/return flow is closed-loop
    Tool: Read
    Preconditions: workflow section exists
    Steps:
      1. Read the flow diagram or swimlane.
      2. Confirm it includes site PM initiation, office review, warehouse execution, and return quarantine.
    Expected Result: The operational loop is complete.
    Evidence: .sisyphus/evidence/task-8-standard-flow.txt

  Scenario: Override is controlled, not freeform
    Tool: Grep
    Preconditions: override subsection exists
    Steps:
      1. Grep for `management approval`, `reason`, `risk acknowledgement`, `audit`.
      2. Confirm all four are mandatory.
    Expected Result: Override is a controlled exception path.
    Evidence: .sisyphus/evidence/task-8-override-controls.txt
  ```

  **Evidence to Capture**:
  - [ ] task-8-standard-flow.txt
  - [ ] task-8-override-controls.txt

  **Commit**: NO

- [ ] 9. Transport budgeting and project freight attribution

  **What to do**:
  - Define transport preconditions: budget request, prepayment, carrier arrangement, shipment event, and cost confirmation.
  - Define project-level freight attribution and its linkage to stock-order and project records.

  **Must NOT do**:
  - Do not introduce device-level freight splitting.
  - Do not expand into a full accounting platform design.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: This bridges warehouse execution, approval, and project-cost semantics.
  - **Skills**: [`everything-claude-code:product-lens`]
    - `everything-claude-code:product-lens`: Keeps the model scoped to project-level costing.
  - **Skills Evaluated but Omitted**:
    - `everything-claude-code:api-design`: Define business policy first.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: 11, 13, 15
  - **Blocked By**: 7, 8

  **References**:
  - `doc/CLAUDE.md:202-205` - Approval engine supports amount-threshold and multi-node approval patterns.
  - `doc/开发计划.md:371-387` - Stock-order and equipment-plan are upstream of transport planning.

  **Acceptance Criteria**:
  - [ ] The document defines the sequence budget → prepayment → transport arrangement → project allocation.
  - [ ] The document explicitly states v1 is project-level only, not device-level.
  - [ ] The document explains how freight data links to project and stock-order context.

  **QA Scenarios**:
  ```
  Scenario: Project-level freight chain is explicit
    Tool: Grep
    Preconditions: transport section exists
    Steps:
      1. Grep for `budget`, `prepayment`, `transport arrangement`, `project allocation`.
      2. Confirm all four appear in sequence.
    Expected Result: Freight attribution chain is complete.
    Evidence: .sisyphus/evidence/task-9-project-freight.txt

  Scenario: Device-level freight is excluded
    Tool: Grep
    Preconditions: transport section exists
    Steps:
      1. Grep for `device-level freight`.
      2. Confirm it appears only as non-goal or later-phase item.
    Expected Result: v1 cost scope is controlled.
    Evidence: .sisyphus/evidence/task-9-no-device-allocation.txt
  ```

  **Evidence to Capture**:
  - [ ] task-9-project-freight.txt
  - [ ] task-9-no-device-allocation.txt

  **Commit**: NO

- [ ] 10. History/query model and event taxonomy

  **What to do**:
  - Define a history model queryable by whole-machine, shell, and core.
  - Define an event taxonomy that covers creation, assembly, disassembly, swap, modification, inspection, maintenance, service, dispatch, return, buried-shell scrap, override, and transport.

  **Must NOT do**:
  - Do not preserve only whole-machine events and lose shell/core independence.
  - Do not rely on manual interpretation to reconstruct history.

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: This task must guarantee point-in-time reconstruction and dual-entry queries.
  - **Skills**: [`everything-claude-code:architecture-decision-records`]
    - `everything-claude-code:architecture-decision-records`: Best fit for event taxonomy and query-boundary decisions.
  - **Skills Evaluated but Omitted**:
    - `everything-claude-code:database-migrations`: Event semantics first.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: 11, 13, 15
  - **Blocked By**: 3, 5, 6

  **References**:
  - `packages/api/src/types/asset.ts:51-72` - Existing document/event structures.
  - `packages/api/src/routes/asset.ts:493-616` - Existing event/document endpoints.
  - `doc/CLAUDE.md:198-200` - Existing requirement for full document library + event timeline.

  **Acceptance Criteria**:
  - [ ] At least 10 event types are defined.
  - [ ] The doc defines what “query by shell” and “query by core” return.
  - [ ] The buried-shell / recovered-core case remains reconstructable.

  **QA Scenarios**:
  ```
  Scenario: Event taxonomy is broad enough
    Tool: Grep
    Preconditions: history section exists
    Steps:
      1. Grep for `assembly`, `disassembly`, `modification`, `inspection`, `maintenance`, `service`, `dispatch`, `return`, `scrap`, `override`, `transport`.
      2. Confirm the critical events are present.
    Expected Result: Event taxonomy supports history reconstruction.
    Evidence: .sisyphus/evidence/task-10-event-taxonomy.txt

  Scenario: Shell and core query views both work
    Tool: Read
    Preconditions: history section exists
    Steps:
      1. Read the `query by shell` and `query by core` subsections.
      2. Confirm both roll back to shared event timeline and assembly history.
    Expected Result: Dual-entry query model is coherent.
    Evidence: .sisyphus/evidence/task-10-query-views.txt
  ```

  **Evidence to Capture**:
  - [ ] task-10-event-taxonomy.txt
  - [ ] task-10-query-views.txt

  **Commit**: NO

- [ ] 11. Dispatch-board read model and availability calculation

  **What to do**:
  - Define dispatch-board categories: available now, available after modification, blocked by maintenance, reserved, in transit, on project, scrapped.
  - Define the availability formula using state, open tasks, compatibility, assembly/configuration, reservation, transit, and override conditions.

  **Must NOT do**:
  - Do not turn the dispatch board into an auto-scheduling engine.
  - Do not ignore open blocking tasks or return-quarantine status.

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: This is the main cross-context read model.
  - **Skills**: [`everything-claude-code:product-lens`]
    - `everything-claude-code:product-lens`: Keeps visibility/read-model scope separate from automated planning.
  - **Skills Evaluated but Omitted**:
    - `everything-claude-code:api-design`: Read-model semantics first.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3
  - **Blocks**: 14, 15
  - **Blocked By**: 6, 7, 8, 9, 10

  **References**:
  - `doc/UI设计文档.md:88-93` - Dispatch board, stock-order, and project-equipment pages.
  - `doc/开发计划.md:380-399` - Equipment plan, inventory, and dashboard are direct consumers.
  - `packages/api/src/types/asset.ts:14-31,62-72` - Existing state and event inputs.

  **Acceptance Criteria**:
  - [ ] At least 7 dispatch-board states are defined.
  - [ ] The doc explicitly defines “available after modification”.
  - [ ] The doc states that open blocking work suppresses availability.

  **QA Scenarios**:
  ```
  Scenario: Dispatch-board categories are complete
    Tool: Grep
    Preconditions: dispatch-board section exists
    Steps:
      1. Grep for `available now`, `available after modification`, `blocked`, `reserved`, `in transit`, `on project`, `scrapped`.
      2. Confirm all categories are defined.
    Expected Result: Minimum dispatch-board state set is complete.
    Evidence: .sisyphus/evidence/task-11-dispatch-statuses.txt

  Scenario: Availability formula includes blockers
    Tool: Read
    Preconditions: availability formula subsection exists
    Steps:
      1. Read the availability formula.
      2. Confirm it includes open work and return quarantine as blocking factors.
    Expected Result: Availability logic matches the business gates.
    Evidence: .sisyphus/evidence/task-11-availability-formula.txt
  ```

  **Evidence to Capture**:
  - [ ] task-11-dispatch-statuses.txt
  - [ ] task-11-availability-formula.txt

  **Commit**: NO

- [ ] 12. Non-TBM modification boundary and shared abstraction

  **What to do**:
  - Define how other equipment can use the same task center and event model without becoming composite assets.
  - Keep a light abstraction that allows modification tracking without shell/core/console semantics.

  **Must NOT do**:
  - Do not force all equipment into the composite-asset model.
  - Do not remove the possibility of future light-weight composite extensions.

  **Recommended Agent Profile**:
  - **Category**: `writing`
    - Reason: This is a boundary-setting task rather than a deep modeling task.
  - **Skills**: [`everything-claude-code:product-lens`]
    - `everything-claude-code:product-lens`: Helps keep the shared abstraction minimal.
  - **Skills Evaluated but Omitted**:
    - `everything-claude-code:architecture-decision-records`: Helpful but not essential here.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3
  - **Blocks**: 13, 15
  - **Blocked By**: 1, 4, 7

  **References**:
  - `doc/CLAUDE.md:197-200` - Generic tracked-asset concept already exists.
  - `doc/开发计划.md:362-399` - Generic tracked-asset/inventory/dashboard baseline.

  **Acceptance Criteria**:
  - [ ] The doc states pipe-jacking machines are a composite-asset special case.
  - [ ] The doc states non-TBM equipment follows single-asset + task/event + optional parameter change.
  - [ ] The doc leaves a future extension seam without pulling it into v1.

  **QA Scenarios**:
  ```
  Scenario: Composite-vs-generic split is clear
    Tool: Read
    Preconditions: non-TBM boundary section exists
    Steps:
      1. Read the comparison subsection.
      2. Confirm the document explicitly distinguishes composite pipe-jacking assets from generic modifiable assets.
    Expected Result: Reuse boundary is clear.
    Evidence: .sisyphus/evidence/task-12-boundary-split.txt

  Scenario: No global composite-asset mandate
    Tool: Grep
    Preconditions: non-TBM boundary section exists
    Steps:
      1. Grep for `all equipment uses the composite model`.
      2. Confirm no such rule appears.
    Expected Result: Scope stays controlled.
    Evidence: .sisyphus/evidence/task-12-no-global-composite.txt
  ```

  **Evidence to Capture**:
  - [ ] task-12-boundary-split.txt
  - [ ] task-12-no-global-composite.txt

  **Commit**: NO

- [ ] 13. Bounded contexts / aggregates / schema delta proposal

  **What to do**:
  - Define bounded contexts/capability zones: asset master data, compatibility/configuration, unified task center, dispatch execution, transport attribution, approvals, and dispatch-board read model.
  - Propose additive schema delta only; do not write final SQL.

  **Must NOT do**:
  - Do not require deleting or renaming core baseline objects.
  - Do not freeze final persistence details at this stage.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: This consolidates all architecture work into one implementable structure.
  - **Skills**: [`everything-claude-code:database-migrations`, `everything-claude-code:architecture-decision-records`]
    - `everything-claude-code:database-migrations`: Helps frame additive schema changes.
    - `everything-claude-code:architecture-decision-records`: Records bounded-context and aggregate decisions.
  - **Skills Evaluated but Omitted**:
    - `everything-claude-code:api-design`: Only touch interface boundaries, not full endpoint specs.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3
  - **Blocks**: 15
  - **Blocked By**: 2, 3, 4, 6, 9, 10, 12

  **References**:
  - `doc/开发计划.md:355-399` - Existing database/module baseline.
  - `packages/api/src/types/asset.ts:1-72` - Current asset/event/rental object model.
  - `packages/api/src/routes/asset.ts:384-432,493-616` - Current asset/event behavior.
  - `doc/CLAUDE.md:197-205` - Asset + approval engine system boundaries.

  **Acceptance Criteria**:
  - [ ] The doc lists at least 6 bounded contexts/capability zones.
  - [ ] The doc marks each structural object as reused, extended, or additive.
  - [ ] The doc explicitly says schema delta is incremental and non-destructive.

  **QA Scenarios**:
  ```
  Scenario: Bounded context coverage is complete
    Tool: Grep
    Preconditions: architecture-boundary section exists
    Steps:
      1. Grep for `asset master data`, `compatibility`, `task center`, `dispatch`, `transport`, `approval`, `read model`.
      2. Confirm at least 6 zones are defined.
    Expected Result: System boundary map is complete.
    Evidence: .sisyphus/evidence/task-13-bounded-contexts.txt

  Scenario: Incremental-delta rule is explicit
    Tool: Read
    Preconditions: schema-delta subsection exists
    Steps:
      1. Read the schema-delta subsection.
      2. Confirm it explicitly says `incremental`, `non-destructive`, and `do not replace tracked_asset / stock_order`.
    Expected Result: Repo alignment is preserved.
    Evidence: .sisyphus/evidence/task-13-incremental-delta.txt
  ```

  **Evidence to Capture**:
  - [ ] task-13-bounded-contexts.txt
  - [ ] task-13-incremental-delta.txt

  **Commit**: NO

- [ ] 14. UI page and permission impact map

  **What to do**:
  - Update `doc/UI设计文档.md` with all affected pages, suggested additions, routes, and file paths.
  - Add a role-visibility matrix for site PM, office, warehouse, and management across task center, stock order, dispatch board, and asset detail flows.

  **Must NOT do**:
  - Do not add page descriptions without file paths.
  - Do not invent a separate role model outside the existing repo roles.

  **Recommended Agent Profile**:
  - **Category**: `writing`
    - Reason: This is a documentation mapping task.
  - **Skills**: [`everything-claude-code:design-system`, `everything-claude-code:product-lens`]
    - `everything-claude-code:design-system`: Good fit for page-level consistency.
    - `everything-claude-code:product-lens`: Good fit for role-oriented page behavior.
  - **Skills Evaluated but Omitted**:
    - `everything-claude-code:frontend-patterns`: No component implementation in scope.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3
  - **Blocks**: 15
  - **Blocked By**: 2, 7, 8, 11

  **References**:
  - `doc/UI设计文档.md:70-93` - Existing unified task/workbench, asset, warehouse, dispatch, and project-equipment pages.
  - `doc/CLAUDE.md:228-235` - Existing role model.
  - `AGENTS.md:13-18` - UI changes must update page-level mapping with concrete file paths.

  **Acceptance Criteria**:
  - [ ] Every affected/new page is recorded in `doc/UI设计文档.md` with a file path.
  - [ ] The role matrix covers site PM, office, warehouse, and management.
  - [ ] The page map covers asset detail, stock order, dispatch board, unified task center, and project equipment view.

  **QA Scenarios**:
  ```
  Scenario: Page-path mapping is complete
    Tool: Grep
    Preconditions: UI doc is updated
    Steps:
      1. Grep for `asset/detail`, `warehouse/stock-order`, `warehouse/dispatch`, `approval/unified-tasklist`, `project/equipment-view`.
      2. Confirm all expected paths exist.
    Expected Result: UI mapping is implementation-ready.
    Evidence: .sisyphus/evidence/task-14-ui-paths.txt

  Scenario: Role matrix is complete
    Tool: Read
    Preconditions: role matrix exists
    Steps:
      1. Read the role matrix.
      2. Confirm it includes site PM, office, warehouse, and management.
    Expected Result: Permission scope is explicit.
    Evidence: .sisyphus/evidence/task-14-role-matrix.txt
  ```

  **Evidence to Capture**:
  - [ ] task-14-ui-paths.txt
  - [ ] task-14-role-matrix.txt

  **Commit**: NO

- [ ] 15. Phased rollout, doc sync, and future decision checklist

  **What to do**:
  - Update `doc/README.md`, `doc/开发计划.md`, and `doc/开发记录.md` to register this architecture work.
  - Define rollout sequencing: docs/model first, then schema delta, then task/gate flow, then read models/UI.
  - Create a future-decision list for rule engine, device-level freight, external audit posture, multi-project shared transport, and similar non-v1 topics.

  **Must NOT do**:
  - Do not skip the index and decision-log updates.
  - Do not mix future questions into current required scope.

  **Recommended Agent Profile**:
  - **Category**: `writing`
    - Reason: This task packages the architecture into an executable documentation handoff.
  - **Skills**: [`everything-claude-code:architecture-decision-records`, `everything-claude-code:product-lens`]
    - `everything-claude-code:architecture-decision-records`: Good fit for final decisions and deferred items.
    - `everything-claude-code:product-lens`: Good fit for ordering rollout by business value and dependency.
  - **Skills Evaluated but Omitted**:
    - `everything-claude-code:blueprint`: The work is already fully decomposed here.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3
  - **Blocks**: Final Verification Wave
  - **Blocked By**: 1, 2, 6, 8, 9, 10, 11, 13, 14

  **References**:
  - `AGENTS.md:13-18` - Mandatory index, log, and UI-doc maintenance rules.
  - `doc/README.md:1-20` - Current documentation index entry point.
  - `doc/开发计划.md:348-405` - Existing Phase 6 baseline to extend with rollout sequencing.

  **Acceptance Criteria**:
  - [ ] `doc/README.md` includes the new architecture doc.
  - [ ] `doc/开发计划.md` includes the phased upgrade path or follow-on stage.
  - [ ] `doc/开发记录.md` contains a new architecture decision entry.
  - [ ] The rollout path is ordered and consistent with task dependencies.

  **QA Scenarios**:
  ```
  Scenario: Required docs are all synced
    Tool: Grep
    Preconditions: index, dev plan, and dev log have been updated
    Steps:
      1. Grep `doc/README.md` for the architecture doc name.
      2. Grep `doc/开发计划.md` for the warehouse-architecture upgrade entry.
      3. Grep `doc/开发记录.md` for the architecture decision record title.
    Expected Result: All three sync points exist.
    Evidence: .sisyphus/evidence/task-15-doc-sync.txt

  Scenario: Future questions are not mixed into current scope
    Tool: Read
    Preconditions: rollout section exists
    Steps:
      1. Read the rollout and deferred-decisions sections.
      2. Confirm future topics are listed separately from current deliverables.
    Expected Result: Execution path is focused and actionable.
    Evidence: .sisyphus/evidence/task-15-rollout-focus.txt
  ```

  **Evidence to Capture**:
  - [ ] task-15-doc-sync.txt
  - [ ] task-15-rollout-focus.txt

  **Commit**: NO

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> Four review agents run in parallel. All must approve. Present consolidated results to the user and wait for explicit okay.

- [ ] F1. **Plan Compliance Audit** — `oracle`
  Read the architecture doc set end-to-end. Verify every Must Have appears in the final documents; verify every Must NOT Have is absent. Confirm evidence files exist and all new concepts map back to existing repo baseline or are explicitly marked as additive.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Docs [N/N] | VERDICT: APPROVE/REJECT`

  **QA Scenarios**:
  ```
  Scenario: Must-have and guardrail audit
    Tool: Read + Grep
    Preconditions: All doc deliverables and evidence files exist
    Steps:
      1. Read this plan's Must Have and Must NOT Have lists.
      2. Grep the final docs for the required concepts and forbidden scope items.
      3. Confirm task evidence files exist for Tasks 1-15.
    Expected Result: All required concepts are present, forbidden scope is absent, evidence is complete.
    Failure Indicators: Missing must-have, present forbidden scope, or missing evidence file.
    Evidence: .sisyphus/evidence/final-qa/f1-plan-compliance.txt
  ```

- [ ] F2. **Documentation Consistency Review** — `unspecified-high`
  Review changed markdown files for naming consistency, section completeness, broken links/file paths, duplicated terms, and contradictions between `doc/CLAUDE.md`, `doc/开发计划.md`, `doc/UI设计文档.md`, and the architecture doc.
  Output: `Consistency [PASS/FAIL] | Paths [PASS/FAIL] | Terminology [PASS/FAIL] | VERDICT`

  **QA Scenarios**:
  ```
  Scenario: Cross-doc consistency check
    Tool: Read + Grep
    Preconditions: All final docs are updated
    Steps:
      1. Read the relevant sections in the architecture doc, `doc/CLAUDE.md`, `doc/开发计划.md`, and `doc/UI设计文档.md`.
      2. Grep for key terms: `whole-machine number`, `core`, `unified task center`, `special override`, `project-level freight`, `available after modification`.
      3. Verify all new page/file paths are valid in the UI doc and architecture doc is indexed in `doc/README.md`.
    Expected Result: Terminology matches, paths resolve, and no contradictions remain.
    Failure Indicators: Conflicting definitions, missing file paths, or missing index entry.
    Evidence: .sisyphus/evidence/final-qa/f2-doc-consistency.txt
  ```

- [ ] F3. **Scenario Replay QA** — `deep`
  Replay the required business scenarios using the final documents only: assembled outbound, compatible-but-needs-modification outbound, return quarantine, shell buried underground/core recovered, management override release, project freight attribution.
  Output: `Scenarios [N/N pass] | Edge Cases [N tested] | VERDICT`

  **QA Scenarios**:
  ```
  Scenario: Business scenario replay from docs only
    Tool: Read
    Preconditions: The architecture doc contains workflows, state machines, task model, and freight rules
    Steps:
      1. Replay 6 scenarios: assembled outbound, compatible-but-modification-needed outbound, return quarantine, buried shell/core recovery, management override, project freight attribution.
      2. For each scenario, record actor, object, state transition, task effect, approval effect, and final result.
      3. Confirm each scenario can be answered from docs alone.
    Expected Result: All scenarios replay cleanly without human interpretation.
    Failure Indicators: Any scenario leaves state, approval, task, or cost outcome undefined.
    Evidence: .sisyphus/evidence/final-qa/f3-scenario-replay.txt
  ```

- [ ] F4. **Scope Fidelity Check** — `deep`
  Compare final docs against the scoped requirements. Verify no drift into external compliance, rule engine, device-level freight apportionment, or generic BPM platform design. Flag any missing requirement or extra architecture surface.
  Output: `Scope [N/N compliant] | Creep [CLEAN/N issues] | VERDICT`

  **QA Scenarios**:
  ```
  Scenario: Scope-creep audit
    Tool: Read + Grep
    Preconditions: Final docs are frozen for review
    Steps:
      1. Read this plan's original request, Must Have, and Must NOT Have.
      2. Grep the final docs for: `rules engine`, `device-level freight`, `external audit`, `generic BPM`, `auto-scheduling`.
      3. Confirm those items appear only as non-goals or later-phase ideas.
    Expected Result: Final docs match requested scope without architecture inflation.
    Failure Indicators: Unrequested platform expansion or missing core requirement.
    Evidence: .sisyphus/evidence/final-qa/f4-scope-fidelity.txt
  ```

---

## Commit Strategy

- **Commit A**: `docs(warehouse): add architecture glossary identity and configuration rules`
  - Includes Tasks: 1, 2, 3, 4, 5
  - Files: `doc/库房系统升级架构设计.md`

- **Commit B**: `docs(warehouse): define lifecycle tasks gates freight and read models`
  - Includes Tasks: 6, 7, 8, 9, 10, 11, 12, 13
  - Files: `doc/库房系统升级架构设计.md`

- **Commit C**: `docs(warehouse): sync ui plan index and decision log`
  - Includes Tasks: 14, 15
  - Files: `doc/UI设计文档.md`, `doc/开发计划.md`, `doc/README.md`, `doc/开发记录.md`

---

## Success Criteria

### Verification Commands
```bash
python3 - <<'PY'
from pathlib import Path
required = [
    'doc/库房系统升级架构设计.md',
    'doc/UI设计文档.md',
    'doc/开发计划.md',
    'doc/README.md',
    'doc/开发记录.md',
]
for path in required:
    print(path, 'OK' if Path(path).exists() else 'MISSING')
PY
# Expected: all required docs report OK after execution
```

### Final Checklist
- [ ] Dual identity model (whole machine + parts) is defined
- [ ] Compatibility, configuration, and parameter layering are defined
- [ ] Task center, gates, overrides, and return quarantine are defined
- [ ] Project-level freight attribution is defined
- [ ] Dispatch-board read model is defined
- [ ] README / dev plan / UI doc / decision log are synced
