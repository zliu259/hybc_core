# Fleet Fuel Governance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the full vehicle and fuel-card governance loop across API, Web, miniapp, WeCom notification, rule configuration, audit, and management dashboard.

**Architecture:** Keep the existing Hono + D1 fleet route, but move governance-specific rules, status transitions, notifications, and audit helpers into focused service files. Web routes are split by role: employee application, office processing workbench, fleet archive, management dashboard, and super-admin rule/audit center. Miniapp stays lightweight and only supports field submission, result viewing, and returned-material resubmission.

**Tech Stack:** Cloudflare Workers + Hono + D1 + KV + Queue, TypeScript, Vitest, Vue 3 + Element Plus + PureAdmin, WeChat miniapp JavaScript/WXML/WXSS, WeCom app-message API through the existing bridge.

---

## Repository Rules For This Plan

- Do not create dated development log files. Append final development notes only to `doc/开发记录.md`.
- UI page changes must update `doc/UI设计文档.md`.
- Do not commit unless the user explicitly asks. This plan uses verification checkpoints instead of commit steps.
- Keep user identity keyed by WeCom `userid`.
- Keep route prefix `/api/v1`.

## File Structure

### Backend

- Create `packages/api/src/services/fleet-governance.ts`
  - Rule policy types, risk evaluation, status transition helpers, audit helper, notification record helper.
- Create `packages/api/src/services/fleet-governance.test.ts`
  - Unit tests for risk evaluation and status transitions.
- Create `packages/api/src/services/fleet-notification.ts`
  - WeCom notification delivery and timeout notification scan.
- Create `packages/api/src/services/fleet-notification.test.ts`
  - Unit tests for notification message selection and record status updates.
- Modify `packages/api/src/routes/fleet.ts`
  - Add request-info, resubmit, rule policy CRUD, rule-hit list, notification list/retry, audit list.
  - Call governance helpers from create/process/void/bind flows.
- Modify `packages/api/src/routes/dashboard.ts`
  - Extend vehicle-fuel overview with health metrics, low-balance card counts, approved amount, coverage, and processing efficiency.
- Modify `packages/api/src/services/wecom-approval-push.ts`
  - Export reusable WeCom bridge-send helpers for fleet notifications without duplicating token and bridge logic.
- Modify `packages/api/src/scheduled.ts`
  - Run pending fleet notification delivery and fuel-application timeout scan on hourly cron.
- Create `packages/api/migrations/0048_fleet_fuel_governance.sql`
  - Adds governance columns and tables.

### Web

- Modify `packages/web/src/api/fleet.ts`
  - Add statuses, rule policy, rule hit, notification, audit, request-info, resubmit, retry notification, and enhanced workbench types.
- Modify `packages/web/src/api/dashboard.ts`
  - Extend vehicle-fuel overview response type.
- Modify `packages/web/src/router/modules/finance.ts`
  - Rename and split fleet menu entries.
- Modify `packages/web/src/router/modules/workspace.ts`
  - Keep employee fuel application path.
- Modify `packages/web/src/utils/enum-labels.ts`
  - Add `needs_info`, risk, notification, and policy labels.
- Modify `packages/web/src/views/finance/fleet/application.vue`
  - Employee-focused Web application and resubmit experience.
- Create `packages/web/src/views/finance/fleet/processing-workbench.vue`
  - Office/fiscal processing queue and detail side panel.
- Modify `packages/web/src/views/finance/fleet/vehicles.vue`
  - Fleet archive only: vehicles, cards, bindings, balance logs. Remove office processing tab.
- Modify `packages/web/src/views/finance/fleet/dashboard.vue`
  - Management-first health dashboard.
- Create `packages/web/src/views/finance/fleet/rules-audit.vue`
  - Super-admin rule configuration, notification monitor, audit list.
- Modify `packages/web/src/views/finance/fleet/applications-list.vue`
  - Keep as full-history view or redirect lightweight list to processing workbench/history tab.

### Miniapp

- Modify `packages/miniapp/pages/fuel-apply/index.js`
  - Support `needs_info`, resubmit, recent application status, balance display, retained form values on failure.
- Modify `packages/miniapp/pages/fuel-apply/index.wxml`
  - Add returned-material panel and resubmit controls.
- Modify `packages/miniapp/pages/fuel-apply/index.wxss`
  - Style status cards, risk tags, and returned-material panel.

### Documentation

- Modify `doc/UI设计文档.md`
  - Update page mapping and role entry descriptions.
- Modify `doc/开发记录.md`
  - Append one timestamped development record after implementation.
- Modify `doc/guide/02-经理手册.md`
  - Add management dashboard usage.
- Modify `doc/guide/04-现场操作员手册.md`
  - Add miniapp submission/resubmission flow.
- Modify `doc/guide/05-财务手册.md`
  - Add office processing workbench and rule-hit handling.

---

## Task 1: Backend Governance Service And Unit Tests

**Files:**
- Create: `packages/api/src/services/fleet-governance.ts`
- Create: `packages/api/src/services/fleet-governance.test.ts`

- [ ] **Step 1: Add failing tests for rule evaluation and status transitions**

Create `packages/api/src/services/fleet-governance.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  assertFuelApplicationTransition,
  buildFuelRiskSummary,
  evaluateFuelApplicationRules,
  type FleetFuelRulePolicy,
  type FuelApplicationStatus
} from "./fleet-governance";

const policies: FleetFuelRulePolicy[] = [
  {
    id: 1,
    policy_name: "单次额度超过 1000 元",
    policy_type: "amount_limit",
    config_json: JSON.stringify({ max_amount: 1000 }),
    severity: "warning",
    enabled: 1
  },
  {
    id: 2,
    policy_name: "油卡余额低于 300 元",
    policy_type: "card_balance",
    config_json: JSON.stringify({ min_balance: 300 }),
    severity: "high",
    enabled: 1
  },
  {
    id: 3,
    policy_name: "现场照片必填",
    policy_type: "photo_required",
    config_json: JSON.stringify({ required: true }),
    severity: "warning",
    enabled: 1
  }
];

describe("fleet governance", () => {
  it("evaluates amount, balance, and photo rules", () => {
    const hits = evaluateFuelApplicationRules({
      policies,
      application: {
        requested_amount: 1200,
        vehicle_mileage_km: 6800,
        photo_keys_json: "[]",
        monthly_apply_count: 1,
        previous_mileage_km: 6200,
        card_latest_balance: 260
      }
    });

    expect(hits.map(hit => hit.policy_type)).toEqual([
      "amount_limit",
      "card_balance",
      "photo_required"
    ]);
    expect(buildFuelRiskSummary(hits)).toEqual({
      risk_level: "high",
      risk_summary: "命中 3 条规则：单次额度超过 1000 元、油卡余额低于 300 元、现场照片必填"
    });
  });

  it("allows the confirmed fuel application state machine", () => {
    const allowed: Array<[FuelApplicationStatus, FuelApplicationStatus]> = [
      ["pending", "processed"],
      ["pending", "rejected"],
      ["pending", "needs_info"],
      ["needs_info", "pending"],
      ["pending", "cancelled"]
    ];

    for (const [from, to] of allowed) {
      expect(() => assertFuelApplicationTransition(from, to)).not.toThrow();
    }
  });

  it("rejects transitions out of final states except super-admin cancellation is not modeled here", () => {
    expect(() => assertFuelApplicationTransition("processed", "pending")).toThrow(
      "Invalid fuel application status transition: processed -> pending"
    );
    expect(() => assertFuelApplicationTransition("rejected", "needs_info")).toThrow(
      "Invalid fuel application status transition: rejected -> needs_info"
    );
  });
});
```

- [ ] **Step 2: Run the test and verify it fails because the service does not exist**

Run:

```bash
cd packages/api && npm test -- src/services/fleet-governance.test.ts
```

Expected: Vitest fails with an import error for `./fleet-governance`.

- [ ] **Step 3: Implement the governance service**

Create `packages/api/src/services/fleet-governance.ts`:

```ts
import type { Env } from "../types/env";

export type FuelApplicationStatus =
  | "pending"
  | "needs_info"
  | "processed"
  | "rejected"
  | "cancelled";

export type FleetFuelRiskLevel = "normal" | "warning" | "high";

export type FleetFuelRulePolicyType =
  | "amount_limit"
  | "monthly_frequency"
  | "mileage_delta"
  | "card_balance"
  | "photo_required";

export type FleetFuelRulePolicy = {
  id: number;
  policy_name: string;
  policy_type: FleetFuelRulePolicyType;
  config_json: string;
  severity: "info" | "warning" | "high";
  enabled: number;
};

export type FuelApplicationRuleContext = {
  requested_amount: number;
  vehicle_mileage_km: number;
  photo_keys_json: string | null;
  monthly_apply_count: number;
  previous_mileage_km: number | null;
  card_latest_balance: number | null;
};

export type FuelQuotaRuleHitDraft = {
  policy_id: number;
  policy_type: FleetFuelRulePolicyType;
  severity: "info" | "warning" | "high";
  hit_message: string;
  suggested_action: "review" | "verify_balance" | "request_info";
};

type JsonObject = Record<string, unknown>;

const parseConfig = (raw: string): JsonObject => {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as JsonObject)
      : {};
  } catch {
    return {};
  }
};

const toFiniteNumber = (value: unknown): number | null => {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
};

const hasUploadedPhotos = (raw: string | null): boolean => {
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) && parsed.some(item => typeof item === "string" && item.trim());
  } catch {
    return false;
  }
};

const suggestedActionFor = (
  policyType: FleetFuelRulePolicyType
): FuelQuotaRuleHitDraft["suggested_action"] => {
  if (policyType === "card_balance") return "verify_balance";
  if (policyType === "photo_required") return "request_info";
  return "review";
};

export const evaluateFuelApplicationRules = (input: {
  policies: FleetFuelRulePolicy[];
  application: FuelApplicationRuleContext;
}): FuelQuotaRuleHitDraft[] => {
  const hits: FuelQuotaRuleHitDraft[] = [];

  for (const policy of input.policies) {
    if (policy.enabled !== 1) continue;
    const config = parseConfig(policy.config_json);
    let isHit = false;

    if (policy.policy_type === "amount_limit") {
      const maxAmount = toFiniteNumber(config.max_amount);
      isHit = maxAmount !== null && input.application.requested_amount > maxAmount;
    }

    if (policy.policy_type === "monthly_frequency") {
      const maxCount = toFiniteNumber(config.max_count);
      isHit = maxCount !== null && input.application.monthly_apply_count > maxCount;
    }

    if (policy.policy_type === "mileage_delta") {
      const maxDelta = toFiniteNumber(config.max_delta_km);
      const previous = input.application.previous_mileage_km;
      isHit =
        maxDelta !== null &&
        previous !== null &&
        input.application.vehicle_mileage_km - previous > maxDelta;
    }

    if (policy.policy_type === "card_balance") {
      const minBalance = toFiniteNumber(config.min_balance);
      const balance = input.application.card_latest_balance;
      isHit = minBalance !== null && balance !== null && balance < minBalance;
    }

    if (policy.policy_type === "photo_required") {
      const required = config.required === true;
      isHit = required && !hasUploadedPhotos(input.application.photo_keys_json);
    }

    if (isHit) {
      hits.push({
        policy_id: policy.id,
        policy_type: policy.policy_type,
        severity: policy.severity,
        hit_message: policy.policy_name,
        suggested_action: suggestedActionFor(policy.policy_type)
      });
    }
  }

  return hits;
};

export const buildFuelRiskSummary = (
  hits: FuelQuotaRuleHitDraft[]
): { risk_level: FleetFuelRiskLevel; risk_summary: string } => {
  if (hits.length === 0) {
    return { risk_level: "normal", risk_summary: "未命中风险规则" };
  }
  const hasHigh = hits.some(hit => hit.severity === "high");
  const hasWarning = hits.some(hit => hit.severity === "warning");
  return {
    risk_level: hasHigh ? "high" : hasWarning ? "warning" : "normal",
    risk_summary: `命中 ${hits.length} 条规则：${hits.map(hit => hit.hit_message).join("、")}`
  };
};

const allowedTransitions: Record<FuelApplicationStatus, FuelApplicationStatus[]> = {
  pending: ["processed", "rejected", "needs_info", "cancelled"],
  needs_info: ["pending", "cancelled"],
  processed: [],
  rejected: [],
  cancelled: []
};

export const assertFuelApplicationTransition = (
  from: FuelApplicationStatus,
  to: FuelApplicationStatus
): void => {
  if (!allowedTransitions[from]?.includes(to)) {
    throw new Error(`Invalid fuel application status transition: ${from} -> ${to}`);
  }
};

export const appendApiAuditLog = async (
  env: Env,
  input: {
    actor_userid: string | null;
    actor_roles_json: string | null;
    action: string;
    target_type: string;
    target_id: string;
    status?: "success" | "failed";
    detail_json?: string | null;
  }
): Promise<void> => {
  await env.DB.prepare(
    `INSERT INTO api_audit_log
      (actor_userid, actor_roles_json, action, target_type, target_id, status, detail_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      input.actor_userid,
      input.actor_roles_json,
      input.action,
      input.target_type,
      input.target_id,
      input.status ?? "success",
      input.detail_json ?? null,
      new Date().toISOString()
    )
    .run();
};
```

- [ ] **Step 4: Run the unit test**

Run:

```bash
cd packages/api && npm test -- src/services/fleet-governance.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run API typecheck**

Run:

```bash
cd packages/api && npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Checkpoint**

Run:

```bash
git diff -- packages/api/src/services/fleet-governance.ts packages/api/src/services/fleet-governance.test.ts
```

Expected: Diff only contains the new governance service and its tests.

---

## Task 2: Database Migration For Governance State

**Files:**
- Create: `packages/api/migrations/0048_fleet_fuel_governance.sql`

- [ ] **Step 1: Create the migration**

Create `packages/api/migrations/0048_fleet_fuel_governance.sql`:

```sql
ALTER TABLE fuel_quota_application ADD COLUMN risk_level TEXT NOT NULL DEFAULT 'normal';
ALTER TABLE fuel_quota_application ADD COLUMN risk_summary TEXT;
ALTER TABLE fuel_quota_application ADD COLUMN needs_info_reason TEXT;
ALTER TABLE fuel_quota_application ADD COLUMN resubmitted_at TEXT;
ALTER TABLE fuel_quota_application ADD COLUMN supplement_count INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS fleet_fuel_rule_policy (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  policy_name TEXT NOT NULL,
  policy_type TEXT NOT NULL,
  config_json TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'warning',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_fleet_fuel_rule_policy_type
  ON fleet_fuel_rule_policy(policy_type);

CREATE INDEX IF NOT EXISTS idx_fleet_fuel_rule_policy_enabled
  ON fleet_fuel_rule_policy(enabled);

CREATE TABLE IF NOT EXISTS fuel_quota_rule_hit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER NOT NULL,
  policy_id INTEGER NOT NULL,
  policy_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  hit_message TEXT NOT NULL,
  suggested_action TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (application_id) REFERENCES fuel_quota_application(id),
  FOREIGN KEY (policy_id) REFERENCES fleet_fuel_rule_policy(id)
);

CREATE INDEX IF NOT EXISTS idx_fuel_quota_rule_hit_application_id
  ON fuel_quota_rule_hit(application_id);

CREATE INDEX IF NOT EXISTS idx_fuel_quota_rule_hit_policy_type
  ON fuel_quota_rule_hit(policy_type);

CREATE TABLE IF NOT EXISTS fleet_wecom_notification (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER,
  notification_type TEXT NOT NULL,
  target_userids_json TEXT,
  target_group_key TEXT,
  message_summary TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  sent_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (application_id) REFERENCES fuel_quota_application(id)
);

CREATE INDEX IF NOT EXISTS idx_fleet_wecom_notification_application_id
  ON fleet_wecom_notification(application_id);

CREATE INDEX IF NOT EXISTS idx_fleet_wecom_notification_status
  ON fleet_wecom_notification(status);

CREATE INDEX IF NOT EXISTS idx_fleet_wecom_notification_type
  ON fleet_wecom_notification(notification_type);

INSERT INTO fleet_fuel_rule_policy
  (policy_name, policy_type, config_json, severity, enabled, created_by, created_at, updated_at)
VALUES
  ('单次申请额度超过 1000 元', 'amount_limit', '{"max_amount":1000}', 'warning', 1, 'system', datetime('now'), datetime('now')),
  ('单人每月申请超过 6 次', 'monthly_frequency', '{"max_count":6}', 'warning', 1, 'system', datetime('now'), datetime('now')),
  ('本次里程较上次增加超过 1500 公里', 'mileage_delta', '{"max_delta_km":1500}', 'warning', 1, 'system', datetime('now'), datetime('now')),
  ('油卡余额低于 300 元', 'card_balance', '{"min_balance":300}', 'high', 1, 'system', datetime('now'), datetime('now')),
  ('现场照片必填', 'photo_required', '{"required":true}', 'warning', 1, 'system', datetime('now'), datetime('now'));
```

- [ ] **Step 2: Apply the migration locally**

Run:

```bash
cd packages/api && npm run db:migrate:local
```

Expected: Wrangler reports migration `0048_fleet_fuel_governance.sql` applied locally. If local D1 already contains partially applied manual columns, stop and inspect `.wrangler/state` instead of editing the migration in place.

- [ ] **Step 3: Checkpoint**

Run:

```bash
git diff -- packages/api/migrations/0048_fleet_fuel_governance.sql
```

Expected: Diff contains only the new migration.

---

## Task 3: Fleet Route Governance API

**Files:**
- Modify: `packages/api/src/routes/fleet.ts`
- Modify: `packages/api/src/services/fleet-governance.ts`
- Test: `packages/api/src/services/fleet-governance.test.ts`

- [ ] **Step 1: Extend the governance service with D1 helper functions**

Append these exports to `packages/api/src/services/fleet-governance.ts`:

```ts
export const listEnabledFleetFuelRulePolicies = async (env: Env): Promise<FleetFuelRulePolicy[]> => {
  const rows = await env.DB.prepare(
    `SELECT id, policy_name, policy_type, config_json, severity, enabled
       FROM fleet_fuel_rule_policy
      WHERE enabled = 1
      ORDER BY id ASC`
  ).all<FleetFuelRulePolicy>();
  return rows.results ?? [];
};

export const replaceFuelQuotaRuleHits = async (
  env: Env,
  applicationId: number,
  hits: FuelQuotaRuleHitDraft[]
): Promise<void> => {
  await env.DB.prepare("DELETE FROM fuel_quota_rule_hit WHERE application_id = ?")
    .bind(applicationId)
    .run();
  const now = new Date().toISOString();
  for (const hit of hits) {
    await env.DB.prepare(
      `INSERT INTO fuel_quota_rule_hit
        (application_id, policy_id, policy_type, severity, hit_message, suggested_action, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        applicationId,
        hit.policy_id,
        hit.policy_type,
        hit.severity,
        hit.hit_message,
        hit.suggested_action,
        now
      )
      .run();
  }
};

export const createFleetNotificationRecord = async (
  env: Env,
  input: {
    application_id: number | null;
    notification_type: "submitted" | "timeout" | "processed" | "needs_info" | "balance_warning";
    target_userids_json?: string | null;
    target_group_key?: string | null;
    message_summary: string;
  }
): Promise<void> => {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO fleet_wecom_notification
      (application_id, notification_type, target_userids_json, target_group_key,
       message_summary, status, retry_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?)`
  )
    .bind(
      input.application_id,
      input.notification_type,
      input.target_userids_json ?? null,
      input.target_group_key ?? null,
      input.message_summary,
      now,
      now
    )
    .run();
};
```

- [ ] **Step 2: Add route-local helpers in `fleet.ts`**

Near the top of `packages/api/src/routes/fleet.ts`, add imports:

```ts
import {
  appendApiAuditLog,
  assertFuelApplicationTransition,
  buildFuelRiskSummary,
  createFleetNotificationRecord,
  evaluateFuelApplicationRules,
  listEnabledFleetFuelRulePolicies,
  replaceFuelQuotaRuleHits,
  type FuelApplicationStatus
} from "../services/fleet-governance";
```

Add helper functions below `appendFuelCardBalanceLog`:

```ts
const loadFuelRuleContext = async (
  env: Env,
  input: {
    applicantUserid: string;
    vehicleId: number;
    fuelCardId: number;
    requestedAt: string;
    requestedAmount: number;
    vehicleMileageKm: number;
    photoKeysJson: string | null;
  }
) => {
  const monthStart = `${input.requestedAt.slice(0, 7)}-01T00:00:00.000Z`;
  const nextMonth = new Date(monthStart);
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);

  const monthly = await env.DB.prepare(
    `SELECT COUNT(*) AS count
       FROM fuel_quota_application
      WHERE applicant_userid = ? AND requested_at >= ? AND requested_at < ?`
  )
    .bind(input.applicantUserid, monthStart, nextMonth.toISOString())
    .first<{ count: number }>();

  const previousMileage = await env.DB.prepare(
    `SELECT vehicle_mileage_km
       FROM fuel_quota_application
      WHERE vehicle_id = ? AND status IN ('pending', 'processed', 'rejected', 'needs_info')
      ORDER BY requested_at DESC, id DESC
      LIMIT 1`
  )
    .bind(input.vehicleId)
    .first<{ vehicle_mileage_km: number }>();

  const card = await env.DB.prepare("SELECT latest_balance FROM fuel_card WHERE id = ?")
    .bind(input.fuelCardId)
    .first<{ latest_balance: number }>();

  return {
    requested_amount: input.requestedAmount,
    vehicle_mileage_km: input.vehicleMileageKm,
    photo_keys_json: input.photoKeysJson,
    monthly_apply_count: (monthly?.count ?? 0) + 1,
    previous_mileage_km: previousMileage?.vehicle_mileage_km ?? null,
    card_latest_balance: card?.latest_balance ?? null
  };
};

const evaluateAndPersistFuelRisk = async (
  env: Env,
  input: {
    applicationId: number;
    applicantUserid: string;
    vehicleId: number;
    fuelCardId: number;
    requestedAt: string;
    requestedAmount: number;
    vehicleMileageKm: number;
    photoKeysJson: string | null;
  }
) => {
  const policies = await listEnabledFleetFuelRulePolicies(env);
  const context = await loadFuelRuleContext(env, input);
  const hits = evaluateFuelApplicationRules({ policies, application: context });
  const summary = buildFuelRiskSummary(hits);

  await replaceFuelQuotaRuleHits(env, input.applicationId, hits);
  await env.DB.prepare(
    "UPDATE fuel_quota_application SET risk_level = ?, risk_summary = ?, updated_at = ? WHERE id = ?"
  )
    .bind(summary.risk_level, summary.risk_summary, nowIso(), input.applicationId)
    .run();

  return summary;
};
```

- [ ] **Step 3: Enhance application creation**

In `POST /fuel-applications`, after insert succeeds and before returning, replace the existing event-only block with:

```ts
const applicationId = Number(result.meta.last_row_id);
const riskSummary = await evaluateAndPersistFuelRisk(c.env, {
  applicationId,
  applicantUserid: auth.sub,
  vehicleId: body.vehicle_id,
  fuelCardId: body.fuel_card_id,
  requestedAt: ts,
  requestedAmount: body.requested_amount,
  vehicleMileageKm: body.vehicle_mileage_km,
  photoKeysJson: body.photo_keys_json ?? null
});

await createFleetNotificationRecord(c.env, {
  application_id: applicationId,
  notification_type: "submitted",
  target_group_key: "finance_office",
  message_summary: `油卡申请 ${applicationNo} 待处理，额度 ${body.requested_amount} 元，风险：${riskSummary.risk_summary}`
});

await appendApiAuditLog(c.env, {
  actor_userid: auth.sub,
  actor_roles_json: JSON.stringify(auth.roles ?? []),
  action: "fuel_application_submit",
  target_type: "fuel_quota_application",
  target_id: String(applicationId),
  detail_json: JSON.stringify({
    application_no: applicationNo,
    vehicle_id: body.vehicle_id,
    fuel_card_id: body.fuel_card_id,
    requested_amount: body.requested_amount,
    risk_level: riskSummary.risk_level
  })
});
```

Keep the existing `event_log` insert for `fuel_quota_application_submitted`, but use `applicationId` instead of `result.meta.last_row_id`.

- [ ] **Step 4: Add request-info endpoint**

Add this route before `/:id/void`:

```ts
fleetRoutes.post(
  "/fuel-applications/:id/request-info",
  requireRoles(["super_admin", "finance"]),
  async (c) => {
    const auth = c.get("auth");
    const id = Number(c.req.param("id"));
    const body = (await c.req.json()) as { reason?: string };
    const reason = body.reason?.trim();
    if (!reason) {
      return c.json({ success: false, error: { message: "reason is required" } }, 400);
    }

    const application = await c.env.DB.prepare(
      "SELECT id, status, application_no, applicant_userid FROM fuel_quota_application WHERE id = ?"
    )
      .bind(id)
      .first<{
        id: number;
        status: FuelApplicationStatus;
        application_no: string;
        applicant_userid: string;
      }>();
    if (!application) {
      return c.json({ success: false, error: { message: "application not found" } }, 404);
    }

    assertFuelApplicationTransition(application.status, "needs_info");
    const ts = nowIso();
    await c.env.DB.prepare(
      `UPDATE fuel_quota_application SET
        status = 'needs_info',
        needs_info_reason = ?,
        processed_by_userid = ?,
        processed_at = ?,
        office_remark = ?,
        updated_at = ?
       WHERE id = ?`
    )
      .bind(reason, auth.sub, ts, reason, ts, id)
      .run();

    await createFleetNotificationRecord(c.env, {
      application_id: id,
      notification_type: "needs_info",
      target_userids_json: JSON.stringify([application.applicant_userid]),
      message_summary: `油卡申请 ${application.application_no} 需要补充资料：${reason}`
    });

    await appendApiAuditLog(c.env, {
      actor_userid: auth.sub,
      actor_roles_json: JSON.stringify(auth.roles ?? []),
      action: "fuel_application_request_info",
      target_type: "fuel_quota_application",
      target_id: String(id),
      detail_json: JSON.stringify({ reason })
    });

    return c.json({ success: true });
  }
);
```

- [ ] **Step 5: Add resubmit endpoint**

Add this route after `request-info`:

```ts
fleetRoutes.post(
  "/fuel-applications/:id/resubmit",
  requireRoles(["super_admin", "manager", "site_manager", "finance", "operator"]),
  async (c) => {
    const auth = c.get("auth");
    const id = Number(c.req.param("id"));
    const body = (await c.req.json()) as {
      requested_amount?: number;
      vehicle_mileage_km?: number;
      photo_keys_json?: string;
    };

    const application = await c.env.DB.prepare(
      `SELECT id, status, application_no, applicant_userid, vehicle_id, fuel_card_id,
              requested_amount, vehicle_mileage_km, photo_keys_json, supplement_count
         FROM fuel_quota_application
        WHERE id = ?`
    )
      .bind(id)
      .first<{
        id: number;
        status: FuelApplicationStatus;
        application_no: string;
        applicant_userid: string;
        vehicle_id: number;
        fuel_card_id: number;
        requested_amount: number;
        vehicle_mileage_km: number;
        photo_keys_json: string | null;
        supplement_count: number;
      }>();
    if (!application) {
      return c.json({ success: false, error: { message: "application not found" } }, 404);
    }
    if (application.applicant_userid !== auth.sub && !(auth.roles ?? []).includes("super_admin")) {
      return c.json({ success: false, error: { message: "Only applicant can resubmit" } }, 403);
    }

    assertFuelApplicationTransition(application.status, "pending");
    const ts = nowIso();
    const requestedAmount =
      typeof body.requested_amount === "number" ? body.requested_amount : application.requested_amount;
    const mileage =
      typeof body.vehicle_mileage_km === "number"
        ? body.vehicle_mileage_km
        : application.vehicle_mileage_km;
    const photoKeysJson = body.photo_keys_json ?? application.photo_keys_json;

    await c.env.DB.prepare(
      `UPDATE fuel_quota_application SET
        requested_amount = ?,
        vehicle_mileage_km = ?,
        photo_keys_json = ?,
        status = 'pending',
        needs_info_reason = NULL,
        resubmitted_at = ?,
        supplement_count = supplement_count + 1,
        updated_at = ?
       WHERE id = ?`
    )
      .bind(requestedAmount, mileage, photoKeysJson, ts, ts, id)
      .run();

    await evaluateAndPersistFuelRisk(c.env, {
      applicationId: id,
      applicantUserid: auth.sub,
      vehicleId: application.vehicle_id,
      fuelCardId: application.fuel_card_id,
      requestedAt: ts,
      requestedAmount,
      vehicleMileageKm: mileage,
      photoKeysJson
    });

    await createFleetNotificationRecord(c.env, {
      application_id: id,
      notification_type: "submitted",
      target_group_key: "finance_office",
      message_summary: `油卡申请 ${application.application_no} 已补充并重新提交`
    });

    await appendApiAuditLog(c.env, {
      actor_userid: auth.sub,
      actor_roles_json: JSON.stringify(auth.roles ?? []),
      action: "fuel_application_resubmit",
      target_type: "fuel_quota_application",
      target_id: String(id),
      detail_json: JSON.stringify({ requested_amount: requestedAmount, vehicle_mileage_km: mileage })
    });

    return c.json({ success: true });
  }
);
```

- [ ] **Step 6: Add list endpoints for rule hits, policies, notifications, and audit**

Add these routes after pending summary:

```ts
fleetRoutes.get("/fuel-applications/:id/rule-hits", async (c) => {
  const id = Number(c.req.param("id"));
  const rows = await c.env.DB.prepare(
    `SELECT id, application_id, policy_id, policy_type, severity, hit_message, suggested_action, created_at
       FROM fuel_quota_rule_hit
      WHERE application_id = ?
      ORDER BY id ASC`
  )
    .bind(id)
    .all();
  return c.json({ success: true, data: rows.results ?? [] });
});

fleetRoutes.get(
  "/rule-policies",
  requireRoles(["super_admin", "manager", "finance"]),
  async (c) => {
    const rows = await c.env.DB.prepare(
      `SELECT id, policy_name, policy_type, config_json, severity, enabled, created_by, created_at, updated_at
         FROM fleet_fuel_rule_policy
        ORDER BY id ASC`
    ).all();
    return c.json({ success: true, data: rows.results ?? [] });
  }
);

fleetRoutes.post("/rule-policies", requireRoles(["super_admin"]), async (c) => {
  const auth = c.get("auth");
  const body = (await c.req.json()) as {
    policy_name?: string;
    policy_type?: string;
    config_json?: string;
    severity?: string;
    enabled?: number;
  };
  if (!body.policy_name?.trim() || !body.policy_type?.trim() || !body.config_json?.trim()) {
    return c.json({ success: false, error: { message: "policy_name, policy_type, config_json are required" } }, 400);
  }
  const ts = nowIso();
  const result = await c.env.DB.prepare(
    `INSERT INTO fleet_fuel_rule_policy
      (policy_name, policy_type, config_json, severity, enabled, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      body.policy_name.trim(),
      body.policy_type.trim(),
      body.config_json.trim(),
      body.severity ?? "warning",
      body.enabled === 0 ? 0 : 1,
      auth.sub,
      ts,
      ts
    )
    .run();
  return c.json({ success: true, data: { id: result.meta.last_row_id } }, 201);
});

fleetRoutes.put("/rule-policies/:id", requireRoles(["super_admin"]), async (c) => {
  const id = Number(c.req.param("id"));
  const body = (await c.req.json()) as {
    policy_name?: string;
    config_json?: string;
    severity?: string;
    enabled?: number;
  };
  await c.env.DB.prepare(
    `UPDATE fleet_fuel_rule_policy SET
      policy_name = COALESCE(?, policy_name),
      config_json = COALESCE(?, config_json),
      severity = COALESCE(?, severity),
      enabled = COALESCE(?, enabled),
      updated_at = ?
     WHERE id = ?`
  )
    .bind(
      body.policy_name?.trim() || null,
      body.config_json?.trim() || null,
      body.severity ?? null,
      typeof body.enabled === "number" ? body.enabled : null,
      nowIso(),
      id
    )
    .run();
  return c.json({ success: true });
});

fleetRoutes.post("/rule-policies/:id/toggle", requireRoles(["super_admin"]), async (c) => {
  const id = Number(c.req.param("id"));
  const body = (await c.req.json()) as { enabled?: number };
  const enabled = body.enabled === 0 ? 0 : 1;
  await c.env.DB.prepare(
    "UPDATE fleet_fuel_rule_policy SET enabled = ?, updated_at = ? WHERE id = ?"
  )
    .bind(enabled, nowIso(), id)
    .run();
  return c.json({ success: true });
});

fleetRoutes.get(
  "/notifications",
  requireRoles(["super_admin", "finance", "manager"]),
  async (c) => {
    const status = c.req.query("status");
    const params: string[] = [];
    let sql = `SELECT * FROM fleet_wecom_notification WHERE 1=1`;
    if (status) {
      sql += " AND status = ?";
      params.push(status);
    }
    sql += " ORDER BY id DESC LIMIT 200";
    const rows = await c.env.DB.prepare(sql).bind(...params).all();
    return c.json({ success: true, data: rows.results ?? [] });
  }
);

fleetRoutes.get("/audit", requireRoles(["super_admin", "manager", "finance"]), async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT *
       FROM api_audit_log
      WHERE target_type IN ('fuel_quota_application', 'fuel_card', 'fleet_fuel_rule_policy')
      ORDER BY id DESC
      LIMIT 200`
  ).all();
  return c.json({ success: true, data: rows.results ?? [] });
});
```

- [ ] **Step 7: Extend `FuelQuotaApplication` query fields**

In `GET /fuel-applications`, include new columns already selected by `a.*`. Ensure the frontend type receives:

```ts
risk_level: string;
risk_summary: string | null;
needs_info_reason: string | null;
resubmitted_at: string | null;
supplement_count: number;
```

No SQL change is needed if `a.*` remains in the SELECT list.

- [ ] **Step 8: Run backend checks**

Run:

```bash
cd packages/api && npm run typecheck
cd packages/api && npm run lint
cd packages/api && npm test -- src/services/fleet-governance.test.ts
```

Expected: all pass. If lint reports line-length formatting, run `cd packages/api && npm run format` to see the exact files and fix only touched files.

- [ ] **Step 9: Checkpoint**

Run:

```bash
git diff -- packages/api/src/routes/fleet.ts packages/api/src/services/fleet-governance.ts packages/api/src/services/fleet-governance.test.ts
```

Expected: Diff shows route integration, new endpoints, and helper exports.

---

## Task 4: Fleet WeCom Notification Delivery And Timeout Scan

**Files:**
- Create: `packages/api/src/services/fleet-notification.ts`
- Create: `packages/api/src/services/fleet-notification.test.ts`
- Modify: `packages/api/src/services/wecom-approval-push.ts`
- Modify: `packages/api/src/scheduled.ts`
- Modify: `packages/api/src/routes/fleet.ts`

- [ ] **Step 1: Add unit tests for notification message building**

Create `packages/api/src/services/fleet-notification.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { buildFleetNotificationCard, resolveFleetNotificationTitle } from "./fleet-notification";

describe("fleet notification", () => {
  it("builds submitted notification cards for office users", () => {
    expect(resolveFleetNotificationTitle("submitted")).toBe("油卡申请待处理");
    const card = buildFleetNotificationCard({
      notification_type: "submitted",
      application_no: "FQ-260529-001",
      applicant_name: "张三",
      amount_text: "1,200.00",
      risk_summary: "命中 1 条规则：单次申请额度超过 1000 元",
      detail_url: "https://example.test/finance/fleet/processing"
    });
    expect(card.main_title.title).toBe("油卡申请待处理");
    expect(card.emphasis_content.title).toBe("1,200.00");
    expect(card.jump_list).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Export reusable WeCom sender**

In `packages/api/src/services/wecom-approval-push.ts`, export a generic sender below `sendApprovalResultTemplateCard`:

```ts
export const sendWeComTemplateCard = async (
  env: Env,
  input: {
    touser: string;
    template_card: Record<string, unknown>;
    enable_duplicate_check?: 0 | 1;
  }
): Promise<{
  msgid: string | null;
  invaliduser: string | null;
  unlicenseduser: string | null;
}> => {
  if (!env.WECHAT_AGENT_ID) {
    throw new Error("WECHAT_AGENT_ID is not configured");
  }

  const accessToken = await fetchWeComAccessToken(env);
  const json = await fetchViaBridgeStrict<WeComSendResponse>(
    env,
    `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${encodeURIComponent(accessToken)}`,
    {
      method: "POST",
      body: {
        touser: input.touser,
        msgtype: "template_card",
        agentid: Number(env.WECHAT_AGENT_ID),
        template_card: input.template_card,
        enable_duplicate_check: input.enable_duplicate_check ?? 1,
        duplicate_check_interval: 600
      }
    }
  );

  if (json.errcode !== 0) {
    throw new Error(weComErrorMessage(json.errmsg, "Failed to send WeCom template card"));
  }

  return {
    msgid: json.msgid ?? null,
    invaliduser: json.invaliduser ?? null,
    unlicenseduser: json.unlicenseduser ?? null
  };
};
```

- [ ] **Step 3: Implement fleet notification service**

Create `packages/api/src/services/fleet-notification.ts`:

```ts
import type { Env } from "../types/env";
import { sendWeComTemplateCard } from "./wecom-approval-push";
import { createFleetNotificationRecord } from "./fleet-governance";

export type FleetNotificationType =
  | "submitted"
  | "timeout"
  | "processed"
  | "needs_info"
  | "balance_warning";

export type FleetNotificationCardInput = {
  notification_type: FleetNotificationType;
  application_no: string;
  applicant_name: string;
  amount_text: string;
  risk_summary: string | null;
  detail_url: string;
};

type PendingFleetNotification = {
  id: number;
  application_id: number | null;
  notification_type: FleetNotificationType;
  target_userids_json: string | null;
  target_group_key: string | null;
  message_summary: string;
  retry_count: number;
};

const nowIso = () => new Date().toISOString();

export const resolveFleetNotificationTitle = (type: FleetNotificationType): string => {
  if (type === "submitted") return "油卡申请待处理";
  if (type === "timeout") return "油卡申请超时提醒";
  if (type === "processed") return "油卡申请已处理";
  if (type === "needs_info") return "油卡申请需补充资料";
  return "油卡余额预警";
};

export const buildFleetNotificationCard = (input: FleetNotificationCardInput) => ({
  card_type: "text_notice",
  source: {
    desc: "车辆油卡",
    desc_color: 0
  },
  main_title: {
    title: resolveFleetNotificationTitle(input.notification_type),
    desc: `${input.applicant_name} / ${input.application_no}`
  },
  emphasis_content: {
    title: input.amount_text,
    desc: "申请额度"
  },
  sub_title_text: input.risk_summary || "请查看申请详情并处理。",
  jump_list: [
    {
      type: 1,
      title: "打开Web处理",
      url: input.detail_url
    }
  ],
  card_action: {
    type: 1,
    url: input.detail_url
  }
});

const parseTargetUserids = (raw: string | null): string[] => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : [];
  } catch {
    return [];
  }
};

const financeOfficeTargets = async (env: Env): Promise<string[]> => {
  const raw = await env.KV.get("fleet:fuel:finance-office-targets");
  return parseTargetUserids(raw);
};

const resolveDetailUrl = (env: Env, applicationId: number | null): string => {
  const base =
    env.WECOM_APPROVAL_WEB_BASE_URL?.replace(/\/$/, "") ||
    env.WECHAT_REDIRECT_URI?.replace(/\/$/, "") ||
    "";
  const path = applicationId
    ? `/finance/fleet/processing?application_id=${applicationId}`
    : "/finance/fleet/processing";
  return base ? `${base}${path}` : path;
};

const loadCardInput = async (
  env: Env,
  notification: PendingFleetNotification
): Promise<FleetNotificationCardInput> => {
  if (!notification.application_id) {
    return {
      notification_type: notification.notification_type,
      application_no: "-",
      applicant_name: "-",
      amount_text: "-",
      risk_summary: notification.message_summary,
      detail_url: resolveDetailUrl(env, null)
    };
  }

  const row = await env.DB.prepare(
    `SELECT a.application_no, a.applicant_userid, a.requested_amount, a.risk_summary
       FROM fuel_quota_application a
      WHERE a.id = ?`
  )
    .bind(notification.application_id)
    .first<{
      application_no: string;
      applicant_userid: string;
      requested_amount: number;
      risk_summary: string | null;
    }>();

  return {
    notification_type: notification.notification_type,
    application_no: row?.application_no ?? "-",
    applicant_name: row?.applicant_userid ?? "-",
    amount_text:
      typeof row?.requested_amount === "number"
        ? row.requested_amount.toLocaleString("zh-CN", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
          })
        : "-",
    risk_summary: row?.risk_summary ?? notification.message_summary,
    detail_url: resolveDetailUrl(env, notification.application_id)
  };
};

export const deliverPendingFleetNotifications = async (
  env: Env,
  options: { limit?: number } = {}
): Promise<{ sent: number; failed: number; skipped: number }> => {
  const rows = await env.DB.prepare(
    `SELECT *
       FROM fleet_wecom_notification
      WHERE status = 'pending'
      ORDER BY id ASC
      LIMIT ?`
  )
    .bind(options.limit ?? 20)
    .all<PendingFleetNotification>();

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const notification of rows.results ?? []) {
    const explicitTargets = parseTargetUserids(notification.target_userids_json);
    const targets =
      explicitTargets.length > 0
        ? explicitTargets
        : notification.target_group_key === "finance_office"
          ? await financeOfficeTargets(env)
          : [];

    if (targets.length === 0) {
      skipped += 1;
      await env.DB.prepare(
        "UPDATE fleet_wecom_notification SET status = 'skipped', error_message = ?, updated_at = ? WHERE id = ?"
      )
        .bind("No target users configured", nowIso(), notification.id)
        .run();
      continue;
    }

    try {
      const cardInput = await loadCardInput(env, notification);
      await sendWeComTemplateCard(env, {
        touser: targets.join("|"),
        template_card: buildFleetNotificationCard(cardInput)
      });
      sent += 1;
      await env.DB.prepare(
        "UPDATE fleet_wecom_notification SET status = 'sent', sent_at = ?, updated_at = ? WHERE id = ?"
      )
        .bind(nowIso(), nowIso(), notification.id)
        .run();
    } catch (error) {
      failed += 1;
      await env.DB.prepare(
        `UPDATE fleet_wecom_notification SET
          status = 'failed',
          error_message = ?,
          retry_count = retry_count + 1,
          updated_at = ?
         WHERE id = ?`
      )
        .bind(error instanceof Error ? error.message : "Fleet notification failed", nowIso(), notification.id)
        .run();
    }
  }

  return { sent, failed, skipped };
};

export const createFleetTimeoutNotifications = async (env: Env): Promise<number> => {
  const rows = await env.DB.prepare(
    `SELECT id, application_no, requested_at
       FROM fuel_quota_application
      WHERE status = 'pending'
        AND requested_at < datetime('now', '-4 hours')
        AND id NOT IN (
          SELECT application_id
            FROM fleet_wecom_notification
           WHERE notification_type = 'timeout'
             AND created_at >= datetime('now', '-1 day')
        )
      ORDER BY requested_at ASC
      LIMIT 50`
  ).all<{ id: number; application_no: string; requested_at: string }>();

  for (const row of rows.results ?? []) {
    await createFleetNotificationRecord(env, {
      application_id: row.id,
      notification_type: "timeout",
      target_group_key: "finance_office",
      message_summary: `油卡申请 ${row.application_no} 已超过 4 小时未处理`
    });
  }

  return rows.results?.length ?? 0;
};
```

- [ ] **Step 4: Connect scheduled job**

In `packages/api/src/scheduled.ts`, add import:

```ts
import {
  createFleetTimeoutNotifications,
  deliverPendingFleetNotifications
} from "./services/fleet-notification";
```

In the `cron === "0 * * * *"` block, include both functions:

```ts
await Promise.all([
  checkApprovalTimeouts(env),
  refreshWeComContactsCache(env),
  markOverdueRentalTerms(env),
  createFleetTimeoutNotifications(env),
  deliverPendingFleetNotifications(env)
]);
```

In the final fallback block, add `deliverPendingFleetNotifications(env)`:

```ts
await Promise.all([
  checkNodeHeartbeat(env),
  checkTimeouts(env),
  checkApprovalTimeouts(env),
  deliverPendingFleetNotifications(env)
]);
```

- [ ] **Step 5: Add notification retry endpoint**

In `packages/api/src/routes/fleet.ts`, add import:

```ts
import { deliverPendingFleetNotifications } from "../services/fleet-notification";
```

Add route after `GET /notifications`:

```ts
fleetRoutes.post(
  "/notifications/:id/retry",
  requireRoles(["super_admin", "finance"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    await c.env.DB.prepare(
      "UPDATE fleet_wecom_notification SET status = 'pending', error_message = NULL, updated_at = ? WHERE id = ?"
    )
      .bind(nowIso(), id)
      .run();
    await deliverPendingFleetNotifications(c.env, { limit: 5 });
    return c.json({ success: true });
  }
);
```

- [ ] **Step 6: Run notification tests and typecheck**

Run:

```bash
cd packages/api && npm test -- src/services/fleet-notification.test.ts
cd packages/api && npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Checkpoint**

Run:

```bash
git diff -- packages/api/src/services/fleet-notification.ts packages/api/src/services/wecom-approval-push.ts packages/api/src/scheduled.ts packages/api/src/routes/fleet.ts
```

Expected: Diff shows notification service, reusable sender export, scheduled delivery, and retry endpoint.

---

## Task 5: Management Dashboard Aggregation

**Files:**
- Modify: `packages/api/src/routes/dashboard.ts`
- Modify: `packages/web/src/api/dashboard.ts`
- Modify: `packages/web/src/views/finance/fleet/dashboard.vue`

- [ ] **Step 1: Extend dashboard SQL aggregation**

In `packages/api/src/routes/dashboard.ts`, inside `/vehicle-fuel-overview`, add these queries after `fuelRows`:

```ts
const approvedFuelRows = await c.env.DB.prepare(
  `SELECT
    COUNT(*) as approved_count,
    IFNULL(SUM(requested_amount), 0) as approved_amount_total
   FROM fuel_quota_application
   WHERE status = 'processed' AND requested_at >= ? AND requested_at < ?`
)
  .bind(range.start, range.end)
  .first<{ approved_count: number; approved_amount_total: number }>();

const activeFuelVehicleRows = await c.env.DB.prepare(
  `SELECT COUNT(DISTINCT vehicle_id) as active_fuel_vehicle_count
   FROM fuel_quota_application
   WHERE requested_at >= ? AND requested_at < ?`
)
  .bind(range.start, range.end)
  .first<{ active_fuel_vehicle_count: number }>();

const lowBalanceRows = await c.env.DB.prepare(
  `SELECT COUNT(*) as low_balance_card_count
   FROM fuel_card
   WHERE status = 'active' AND latest_balance < 300`
).first<{ low_balance_card_count: number }>();

const processingRows = await c.env.DB.prepare(
  `SELECT
    COUNT(*) as handled_count,
    IFNULL(AVG((julianday(processed_at) - julianday(requested_at)) * 24), 0) as avg_handle_hours
   FROM fuel_quota_application
   WHERE processed_at IS NOT NULL AND requested_at >= ? AND requested_at < ?`
)
  .bind(range.start, range.end)
  .first<{ handled_count: number; avg_handle_hours: number }>();
```

Before returning JSON, compute health:

```ts
const activeVehicleTotal = vehicleCountRow?.active_total ?? 0;
const lowBalanceCardCount = lowBalanceRows?.low_balance_card_count ?? 0;
const pendingCount = fuelRows?.pending_count ?? 0;
const healthStatus =
  lowBalanceCardCount > 0 || pendingCount > 10
    ? "risk"
    : pendingCount > 0
      ? "watch"
      : "healthy";
const healthSummary =
  healthStatus === "risk"
    ? `存在 ${lowBalanceCardCount} 张低余额油卡，待处理 ${pendingCount} 单`
    : healthStatus === "watch"
      ? `待处理 ${pendingCount} 单，余额整体正常`
      : "油卡余额与处理状态正常";
```

Add to `summary`:

```ts
fuel_processed_amount_total: approvedFuelRows?.approved_amount_total ?? 0,
active_fuel_vehicle_count: activeFuelVehicleRows?.active_fuel_vehicle_count ?? 0,
fuel_vehicle_coverage_rate:
  activeVehicleTotal > 0
    ? Number(((activeFuelVehicleRows?.active_fuel_vehicle_count ?? 0) / activeVehicleTotal).toFixed(4))
    : 0,
low_balance_card_count: lowBalanceCardCount,
avg_handle_hours: processingRows?.avg_handle_hours ?? 0,
health_status: healthStatus,
health_summary: healthSummary
```

- [ ] **Step 2: Update Web dashboard type**

In `packages/web/src/api/dashboard.ts`, add fields to `summary`:

```ts
fuel_processed_amount_total: number;
active_fuel_vehicle_count: number;
fuel_vehicle_coverage_rate: number;
low_balance_card_count: number;
avg_handle_hours: number;
health_status: "healthy" | "watch" | "risk";
health_summary: string;
```

- [ ] **Step 3: Refactor dashboard view around health-first cards**

In `packages/web/src/views/finance/fleet/dashboard.vue`, update `summary` default object with the new fields and replace the first two metric rows with cards for:

```vue
<el-row :gutter="12" style="margin-top: 12px">
  <el-col :md="6" :xs="24">
    <el-card shadow="never">本期申请总额：¥{{ amountFormatter(summary.fuel_requested_amount_total) }}</el-card>
  </el-col>
  <el-col :md="6" :xs="24">
    <el-card shadow="never">本期通过金额：¥{{ amountFormatter(summary.fuel_processed_amount_total) }}</el-card>
  </el-col>
  <el-col :md="6" :xs="24">
    <el-card shadow="never">活跃油卡余额：¥{{ amountFormatter(summary.active_card_balance_total) }}</el-card>
  </el-col>
  <el-col :md="6" :xs="24">
    <el-card shadow="never">低余额油卡：{{ summary.low_balance_card_count }}</el-card>
  </el-col>
</el-row>
<el-alert
  :type="summary.health_status === 'risk' ? 'error' : summary.health_status === 'watch' ? 'warning' : 'success'"
  :title="summary.health_summary"
  show-icon
  style="margin-top: 12px"
/>
```

Keep the trend chart and top vehicle table, but move processing status below them.

- [ ] **Step 4: Run checks**

Run:

```bash
cd packages/api && npm run typecheck
cd packages/web && npm run typecheck
```

Expected: both pass.

- [ ] **Step 5: Checkpoint**

Run:

```bash
git diff -- packages/api/src/routes/dashboard.ts packages/web/src/api/dashboard.ts packages/web/src/views/finance/fleet/dashboard.vue
```

Expected: Diff shows enhanced health metrics and dashboard layout updates.

---

## Task 6: Web API Types And Labels

**Files:**
- Modify: `packages/web/src/api/fleet.ts`
- Modify: `packages/web/src/utils/enum-labels.ts`

- [ ] **Step 1: Extend fleet API types**

In `packages/web/src/api/fleet.ts`, update `FuelQuotaApplication.status`:

```ts
status: "pending" | "needs_info" | "processed" | "rejected" | "cancelled";
```

Add fields to `FuelQuotaApplication`:

```ts
risk_level: "normal" | "warning" | "high";
risk_summary: string | null;
needs_info_reason: string | null;
resubmitted_at: string | null;
supplement_count: number;
```

Add types:

```ts
export type FleetFuelRulePolicy = {
  id: number;
  policy_name: string;
  policy_type:
    | "amount_limit"
    | "monthly_frequency"
    | "mileage_delta"
    | "card_balance"
    | "photo_required";
  config_json: string;
  severity: "info" | "warning" | "high";
  enabled: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type FuelQuotaRuleHit = {
  id: number;
  application_id: number;
  policy_id: number;
  policy_type: FleetFuelRulePolicy["policy_type"];
  severity: "info" | "warning" | "high";
  hit_message: string;
  suggested_action: "review" | "verify_balance" | "request_info";
  created_at: string;
};

export type FleetWecomNotification = {
  id: number;
  application_id: number | null;
  notification_type:
    | "submitted"
    | "timeout"
    | "processed"
    | "needs_info"
    | "balance_warning";
  target_userids_json: string | null;
  target_group_key: string | null;
  message_summary: string;
  status: "pending" | "sent" | "failed" | "skipped";
  error_message: string | null;
  retry_count: number;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
};

export type FleetAuditLog = {
  id: number;
  actor_userid: string | null;
  actor_roles_json: string | null;
  action: string;
  target_type: string;
  target_id: string;
  status: string;
  detail_json: string | null;
  created_at: string;
};
```

Add API functions:

```ts
export const requestFuelQuotaApplicationInfo = (
  id: number,
  data: { reason: string }
) => {
  return http.request<{ success: boolean }>(
    "post",
    `/api/v1/fleet/fuel-applications/${id}/request-info`,
    { data }
  );
};

export const resubmitFuelQuotaApplication = (
  id: number,
  data: {
    requested_amount?: number;
    vehicle_mileage_km?: number;
    photo_keys_json?: string;
  }
) => {
  return http.request<{ success: boolean }>(
    "post",
    `/api/v1/fleet/fuel-applications/${id}/resubmit`,
    { data }
  );
};

export const listFuelQuotaRuleHits = (applicationId: number) => {
  return http.request<{ success: boolean; data: FuelQuotaRuleHit[] }>(
    "get",
    `/api/v1/fleet/fuel-applications/${applicationId}/rule-hits`
  );
};

export const listFleetFuelRulePolicies = () => {
  return http.request<{ success: boolean; data: FleetFuelRulePolicy[] }>(
    "get",
    "/api/v1/fleet/rule-policies"
  );
};

export const createFleetFuelRulePolicy = (
  data: Pick<
    FleetFuelRulePolicy,
    "policy_name" | "policy_type" | "config_json" | "severity"
  > & { enabled?: number }
) => {
  return http.request<{ success: boolean; data: { id: number } }>(
    "post",
    "/api/v1/fleet/rule-policies",
    { data }
  );
};

export const updateFleetFuelRulePolicy = (
  id: number,
  data: Partial<
    Pick<FleetFuelRulePolicy, "policy_name" | "config_json" | "severity" | "enabled">
  >
) => {
  return http.request<{ success: boolean }>(
    "put",
    `/api/v1/fleet/rule-policies/${id}`,
    { data }
  );
};

export const toggleFleetFuelRulePolicy = (
  id: number,
  data: { enabled: number }
) => {
  return http.request<{ success: boolean }>(
    "post",
    `/api/v1/fleet/rule-policies/${id}/toggle`,
    { data }
  );
};

export const listFleetWecomNotifications = (params?: { status?: string }) => {
  return http.request<{ success: boolean; data: FleetWecomNotification[] }>(
    "get",
    "/api/v1/fleet/notifications",
    { params }
  );
};

export const retryFleetWecomNotification = (id: number) => {
  return http.request<{ success: boolean }>(
    "post",
    `/api/v1/fleet/notifications/${id}/retry`
  );
};

export const listFleetAuditLogs = () => {
  return http.request<{ success: boolean; data: FleetAuditLog[] }>(
    "get",
    "/api/v1/fleet/audit"
  );
};
```

- [ ] **Step 2: Add labels**

In `packages/web/src/utils/enum-labels.ts`, add or extend exported label functions:

```ts
export const fuelApplicationStatusLabel = (value: string) => {
  if (value === "pending") return "待办公室处理";
  if (value === "needs_info") return "待补充资料";
  if (value === "processed") return "已通过";
  if (value === "rejected") return "已拒绝";
  if (value === "cancelled") return "已废除";
  return value;
};

export const fuelRiskLabel = (value: string) => {
  if (value === "high") return "高风险";
  if (value === "warning") return "需关注";
  if (value === "normal") return "正常";
  return value;
};

export const fuelRiskTagType = (
  value: string
): "success" | "warning" | "danger" | "info" => {
  if (value === "high") return "danger";
  if (value === "warning") return "warning";
  if (value === "normal") return "success";
  return "info";
};

export const fleetNotificationStatusLabel = (value: string) => {
  if (value === "pending") return "待发送";
  if (value === "sent") return "已发送";
  if (value === "failed") return "发送失败";
  if (value === "skipped") return "已跳过";
  return value;
};
```

- [ ] **Step 3: Run Web typecheck**

Run:

```bash
cd packages/web && npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Checkpoint**

Run:

```bash
git diff -- packages/web/src/api/fleet.ts packages/web/src/utils/enum-labels.ts
```

Expected: Diff contains API contracts and labels only.

---

## Task 7: Web Employee Application And Office Processing Workbench

**Files:**
- Modify: `packages/web/src/views/finance/fleet/application.vue`
- Create: `packages/web/src/views/finance/fleet/processing-workbench.vue`
- Modify: `packages/web/src/router/modules/finance.ts`

- [ ] **Step 1: Refocus employee application page**

In `packages/web/src/views/finance/fleet/application.vue`:

1. Import `resubmitFuelQuotaApplication`.
2. Add computed `needsInfoApplications`:

```ts
const needsInfoApplications = computed(() =>
  myApplications.value.filter(item => item.status === "needs_info")
);
```

3. Add resubmit function:

```ts
const resubmitApplication = async (row: FuelQuotaApplication) => {
  if (photoKeys.value.length === 0 && !row.photo_keys_json) {
    message("请先上传补充照片", { type: "warning" });
    return;
  }
  await resubmitFuelQuotaApplication(row.id, {
    requested_amount: form.value.requested_amount || row.requested_amount,
    vehicle_mileage_km: form.value.vehicle_mileage_km || row.vehicle_mileage_km,
    photo_keys_json: JSON.stringify(photoKeys.value)
  });
  photoKeys.value = [];
  await loadData();
  message("补充资料已重新提交", { type: "success" });
};
```

4. Add a top alert block above the form:

```vue
<el-alert
  v-if="needsInfoApplications.length > 0"
  type="warning"
  show-icon
  :closable="false"
  style="margin-bottom: 12px"
  title="有油卡申请需要补充资料，请查看下方记录中的退回原因。"
/>
```

5. In the table, add risk and returned reason columns:

```vue
<el-table-column label="风险" width="120">
  <template #default="scope">
    <el-tag :type="fuelRiskTagType(scope.row.risk_level)" size="small">
      {{ fuelRiskLabel(scope.row.risk_level) }}
    </el-tag>
  </template>
</el-table-column>
<el-table-column prop="risk_summary" label="风险摘要" min-width="220" />
<el-table-column prop="needs_info_reason" label="补充说明" min-width="220" />
<el-table-column label="操作" width="140" fixed="right">
  <template #default="scope">
    <el-button
      v-if="scope.row.status === 'needs_info'"
      link
      type="primary"
      @click="resubmitApplication(scope.row)"
    >
      补充后提交
    </el-button>
    <span v-else>-</span>
  </template>
</el-table-column>
```

- [ ] **Step 2: Create processing workbench page**

Create `packages/web/src/views/finance/fleet/processing-workbench.vue` with this structure:

```vue
<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { ElMessageBox } from "element-plus";
import { message } from "@/utils/message";
import {
  fuelApplicationStatusLabel,
  fuelRiskLabel,
  fuelRiskTagType
} from "@/utils/enum-labels";
import {
  listFuelQuotaApplications,
  listFuelQuotaRuleHits,
  processFuelQuotaApplication,
  requestFuelQuotaApplicationInfo,
  type FuelQuotaApplication,
  type FuelQuotaRuleHit
} from "@/api/fleet";
import { useWecomUserOptions } from "@/composables/useWecomUserOptions";

defineOptions({ name: "FleetFuelProcessingWorkbench" });

const loading = ref(false);
const activeQueue = ref<"pending" | "needs_info" | "processed" | "rejected">("pending");
const rows = ref<FuelQuotaApplication[]>([]);
const selected = ref<FuelQuotaApplication | null>(null);
const ruleHits = ref<FuelQuotaRuleHit[]>([]);
const { wecomUsers, loadWecomUsers } = useWecomUserOptions();

const processForm = ref({
  latest_card_balance: 0,
  office_remark: ""
});

const queueRows = computed(() => rows.value.filter(item => item.status === activeQueue.value));

const resolveUserName = (userid: string | null | undefined) => {
  if (!userid) return "-";
  const matched = wecomUsers.value.find(item => item.userid === userid);
  return matched?.name?.trim() ? `${matched.name} (${userid})` : userid;
};

const loadData = async () => {
  loading.value = true;
  try {
    const [appResult] = await Promise.all([listFuelQuotaApplications(), loadWecomUsers()]);
    rows.value = appResult.data;
    if (!selected.value && queueRows.value.length > 0) {
      await selectRow(queueRows.value[0]);
    }
  } finally {
    loading.value = false;
  }
};

const selectRow = async (row: FuelQuotaApplication) => {
  selected.value = row;
  processForm.value = {
    latest_card_balance: row.card_latest_balance || row.latest_card_balance || 0,
    office_remark: row.office_remark || ""
  };
  const hitResult = await listFuelQuotaRuleHits(row.id);
  ruleHits.value = hitResult.data;
};

const approveSelected = async () => {
  if (!selected.value) return;
  await processFuelQuotaApplication(selected.value.id, {
    status: "processed",
    fuel_card_id: selected.value.fuel_card_id || undefined,
    latest_card_balance: processForm.value.latest_card_balance,
    office_remark: processForm.value.office_remark
  });
  message("油卡申请已通过", { type: "success" });
  selected.value = null;
  await loadData();
};

const rejectSelected = async () => {
  if (!selected.value) return;
  await processFuelQuotaApplication(selected.value.id, {
    status: "rejected",
    fuel_card_id: selected.value.fuel_card_id || undefined,
    office_remark: processForm.value.office_remark
  });
  message("油卡申请已拒绝", { type: "success" });
  selected.value = null;
  await loadData();
};

const requestInfoSelected = async () => {
  if (!selected.value) return;
  const result = await ElMessageBox.prompt("请输入需要申请人补充的资料说明", "退回补充", {
    confirmButtonText: "退回补充",
    cancelButtonText: "取消",
    inputType: "textarea",
    inputPattern: /\S+/,
    inputErrorMessage: "请填写补充说明"
  });
  await requestFuelQuotaApplicationInfo(selected.value.id, {
    reason: String(result.value)
  });
  message("已退回补充", { type: "success" });
  selected.value = null;
  await loadData();
};

onMounted(loadData);
</script>

<template>
  <el-card shadow="never" :loading="loading">
    <template #header>
      <div style="display: flex; justify-content: space-between; align-items: center">
        <div>
          <div style="font-size: 18px; font-weight: 700">油卡处理工作台</div>
          <div style="font-size: 13px; color: #6b7280">办公室处理待办、核对风险、回写余额</div>
        </div>
        <el-button type="primary" @click="loadData">刷新</el-button>
      </div>
    </template>

    <el-tabs v-model="activeQueue" @tab-change="selected = null">
      <el-tab-pane label="待处理" name="pending" />
      <el-tab-pane label="待补充" name="needs_info" />
      <el-tab-pane label="已通过" name="processed" />
      <el-tab-pane label="已拒绝" name="rejected" />
    </el-tabs>

    <el-row :gutter="12">
      <el-col :md="16" :xs="24">
        <el-table :data="queueRows" stripe height="560" @row-click="selectRow">
          <el-table-column prop="application_no" label="申请单号" min-width="170" />
          <el-table-column label="申请人" width="180">
            <template #default="scope">{{ resolveUserName(scope.row.applicant_userid) }}</template>
          </el-table-column>
          <el-table-column prop="current_plate_no" label="车辆" width="120" />
          <el-table-column prop="requested_amount" label="额度" width="110" />
          <el-table-column label="风险" width="110">
            <template #default="scope">
              <el-tag :type="fuelRiskTagType(scope.row.risk_level)" size="small">
                {{ fuelRiskLabel(scope.row.risk_level) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="130">
            <template #default="scope">{{ fuelApplicationStatusLabel(scope.row.status) }}</template>
          </el-table-column>
          <el-table-column prop="requested_at" label="申请时间" width="180" />
        </el-table>
      </el-col>
      <el-col :md="8" :xs="24">
        <el-empty v-if="!selected" description="选择一条申请查看详情" />
        <div v-else>
          <el-descriptions :column="1" border>
            <el-descriptions-item label="申请单">{{ selected.application_no }}</el-descriptions-item>
            <el-descriptions-item label="申请人">{{ resolveUserName(selected.applicant_userid) }}</el-descriptions-item>
            <el-descriptions-item label="车辆">{{ selected.current_plate_no }}</el-descriptions-item>
            <el-descriptions-item label="油卡">{{ selected.card_no || "-" }}</el-descriptions-item>
            <el-descriptions-item label="申请额度">{{ selected.requested_amount }}</el-descriptions-item>
            <el-descriptions-item label="里程">{{ selected.vehicle_mileage_km }}</el-descriptions-item>
            <el-descriptions-item label="风险摘要">{{ selected.risk_summary || "未命中风险规则" }}</el-descriptions-item>
          </el-descriptions>

          <el-divider>规则命中</el-divider>
          <el-tag
            v-for="hit in ruleHits"
            :key="hit.id"
            :type="fuelRiskTagType(hit.severity)"
            style="margin: 0 6px 6px 0"
          >
            {{ hit.hit_message }}
          </el-tag>
          <el-empty v-if="ruleHits.length === 0" description="无规则命中" :image-size="60" />

          <el-form label-width="100px" style="margin-top: 12px">
            <el-form-item label="处理后余额">
              <el-input-number v-model="processForm.latest_card_balance" :min="0" />
            </el-form-item>
            <el-form-item label="处理备注">
              <el-input v-model="processForm.office_remark" type="textarea" :rows="3" />
            </el-form-item>
          </el-form>

          <el-space v-if="selected.status === 'pending'">
            <el-button type="success" @click="approveSelected">通过</el-button>
            <el-button type="warning" @click="requestInfoSelected">退回补充</el-button>
            <el-button type="danger" @click="rejectSelected">拒绝</el-button>
          </el-space>
        </div>
      </el-col>
    </el-row>
  </el-card>
</template>
```

- [ ] **Step 3: Add route**

In `packages/web/src/router/modules/finance.ts`, under `/finance/fleet-center`, add:

```ts
{
  path: "/finance/fleet/processing",
  name: "FleetFuelProcessingWorkbench",
  component: () => import("@/views/finance/fleet/processing-workbench.vue"),
  meta: {
    title: "油卡处理工作台",
    roles: ["super_admin", "finance"]
  }
}
```

Change `/finance/fleet-center` redirect to `/finance/fleet/dashboard` so managers land on the health view.

- [ ] **Step 4: Run Web checks**

Run:

```bash
cd packages/web && npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Checkpoint**

Run:

```bash
git diff -- packages/web/src/views/finance/fleet/application.vue packages/web/src/views/finance/fleet/processing-workbench.vue packages/web/src/router/modules/finance.ts
```

Expected: Employee page has status/risk/resubmit, and processing workbench is a new focused page.

---

## Task 8: Fleet Archive, Rules/Audit Center, And Route Cleanup

**Files:**
- Modify: `packages/web/src/views/finance/fleet/vehicles.vue`
- Create: `packages/web/src/views/finance/fleet/rules-audit.vue`
- Modify: `packages/web/src/views/finance/fleet/applications-list.vue`
- Modify: `packages/web/src/router/modules/finance.ts`

- [ ] **Step 1: Remove office processing from `vehicles.vue`**

In `packages/web/src/views/finance/fleet/vehicles.vue`:

1. Remove `pendingApplications`, `allApplications`, `pendingSummary`, `processDialogVisible`, `processTarget`, `processForm`, `pendingCount`, `openProcess`, `submitProcess`.
2. Remove `listFuelQuotaApplications`, `getFuelQuotaPendingSummary`, and `processFuelQuotaApplication` imports.
3. Remove the tabs labeled `办公室处理` and `额度申请全量记录`.
4. Rename header title to `车辆油卡档案`.
5. Keep tabs `车辆档案` and `油卡管理`.

This page remains responsible for vehicle CRUD, fuel card creation, user binding, and balance logs.

- [ ] **Step 2: Create rules and audit page**

Create `packages/web/src/views/finance/fleet/rules-audit.vue`:

```vue
<script setup lang="ts">
import { onMounted, ref } from "vue";
import { ElMessage } from "element-plus";
import {
  createFleetFuelRulePolicy,
  listFleetAuditLogs,
  listFleetFuelRulePolicies,
  listFleetWecomNotifications,
  retryFleetWecomNotification,
  toggleFleetFuelRulePolicy,
  type FleetAuditLog,
  type FleetFuelRulePolicy,
  type FleetWecomNotification
} from "@/api/fleet";
import { fleetNotificationStatusLabel } from "@/utils/enum-labels";

defineOptions({ name: "FleetRulesAuditCenter" });

const loading = ref(false);
const policies = ref<FleetFuelRulePolicy[]>([]);
const notifications = ref<FleetWecomNotification[]>([]);
const auditLogs = ref<FleetAuditLog[]>([]);
const policyForm = ref({
  policy_name: "",
  policy_type: "amount_limit" as FleetFuelRulePolicy["policy_type"],
  severity: "warning" as FleetFuelRulePolicy["severity"],
  config_json: "{\"max_amount\":1000}"
});

const loadData = async () => {
  loading.value = true;
  try {
    const [policyResult, notificationResult, auditResult] = await Promise.all([
      listFleetFuelRulePolicies(),
      listFleetWecomNotifications(),
      listFleetAuditLogs()
    ]);
    policies.value = policyResult.data;
    notifications.value = notificationResult.data;
    auditLogs.value = auditResult.data;
  } finally {
    loading.value = false;
  }
};

const createPolicy = async () => {
  JSON.parse(policyForm.value.config_json);
  await createFleetFuelRulePolicy({
    policy_name: policyForm.value.policy_name,
    policy_type: policyForm.value.policy_type,
    severity: policyForm.value.severity,
    config_json: policyForm.value.config_json,
    enabled: 1
  });
  policyForm.value.policy_name = "";
  await loadData();
  ElMessage.success("规则已创建");
};

const togglePolicy = async (row: FleetFuelRulePolicy) => {
  await toggleFleetFuelRulePolicy(row.id, { enabled: row.enabled === 1 ? 0 : 1 });
  await loadData();
};

const retryNotification = async (row: FleetWecomNotification) => {
  await retryFleetWecomNotification(row.id);
  await loadData();
};

onMounted(loadData);
</script>

<template>
  <el-card shadow="never" :loading="loading">
    <template #header>
      <div style="display: flex; justify-content: space-between; align-items: center">
        <div>
          <div style="font-size: 18px; font-weight: 700">规则与审计中心</div>
          <div style="font-size: 13px; color: #6b7280">油卡规则、企微通知、操作审计</div>
        </div>
        <el-button type="primary" @click="loadData">刷新</el-button>
      </div>
    </template>

    <el-tabs>
      <el-tab-pane label="规则配置">
        <el-form inline>
          <el-form-item label="规则名称">
            <el-input v-model="policyForm.policy_name" style="width: 220px" />
          </el-form-item>
          <el-form-item label="类型">
            <el-select v-model="policyForm.policy_type" style="width: 180px">
              <el-option label="单次额度" value="amount_limit" />
              <el-option label="月度频次" value="monthly_frequency" />
              <el-option label="里程差" value="mileage_delta" />
              <el-option label="油卡余额" value="card_balance" />
              <el-option label="照片必填" value="photo_required" />
            </el-select>
          </el-form-item>
          <el-form-item label="风险">
            <el-select v-model="policyForm.severity" style="width: 140px">
              <el-option label="提示" value="info" />
              <el-option label="需关注" value="warning" />
              <el-option label="高风险" value="high" />
            </el-select>
          </el-form-item>
          <el-form-item label="配置 JSON">
            <el-input v-model="policyForm.config_json" style="width: 260px" />
          </el-form-item>
          <el-button type="primary" @click="createPolicy">新增规则</el-button>
        </el-form>

        <el-table :data="policies" stripe>
          <el-table-column prop="policy_name" label="规则名称" min-width="220" />
          <el-table-column prop="policy_type" label="类型" width="160" />
          <el-table-column prop="severity" label="风险" width="120" />
          <el-table-column prop="config_json" label="配置" min-width="260" />
          <el-table-column label="状态" width="100">
            <template #default="scope">{{ scope.row.enabled === 1 ? "启用" : "停用" }}</template>
          </el-table-column>
          <el-table-column label="操作" width="100" fixed="right">
            <template #default="scope">
              <el-button link type="primary" @click="togglePolicy(scope.row)">
                {{ scope.row.enabled === 1 ? "停用" : "启用" }}
              </el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <el-tab-pane label="企微通知">
        <el-table :data="notifications" stripe>
          <el-table-column prop="notification_type" label="类型" width="130" />
          <el-table-column prop="message_summary" label="摘要" min-width="320" />
          <el-table-column label="状态" width="120">
            <template #default="scope">{{ fleetNotificationStatusLabel(scope.row.status) }}</template>
          </el-table-column>
          <el-table-column prop="error_message" label="失败原因" min-width="220" />
          <el-table-column prop="retry_count" label="重试" width="80" />
          <el-table-column label="操作" width="100" fixed="right">
            <template #default="scope">
              <el-button
                v-if="scope.row.status === 'failed'"
                link
                type="primary"
                @click="retryNotification(scope.row)"
              >
                重试
              </el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <el-tab-pane label="操作审计">
        <el-table :data="auditLogs" stripe>
          <el-table-column prop="created_at" label="时间" width="180" />
          <el-table-column prop="actor_userid" label="操作人" width="160" />
          <el-table-column prop="action" label="动作" width="220" />
          <el-table-column prop="target_type" label="对象" width="180" />
          <el-table-column prop="target_id" label="对象ID" width="120" />
          <el-table-column prop="detail_json" label="详情" min-width="320" />
        </el-table>
      </el-tab-pane>
    </el-tabs>
  </el-card>
</template>
```

- [ ] **Step 3: Add rule/audit route**

In `packages/web/src/router/modules/finance.ts`, add:

```ts
{
  path: "/finance/fleet/rules-audit",
  name: "FleetRulesAuditCenter",
  component: () => import("@/views/finance/fleet/rules-audit.vue"),
  meta: {
    title: "规则与审计",
    roles: ["super_admin"]
  }
}
```

Rename existing route titles:

```ts
title: "车辆油卡档案"
```

for `/finance/fleet/vehicles`, and:

```ts
title: "用油健康总览"
```

for `/finance/fleet/dashboard`.

- [ ] **Step 4: Run Web checks**

Run:

```bash
cd packages/web && npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Checkpoint**

Run:

```bash
git diff -- packages/web/src/views/finance/fleet/vehicles.vue packages/web/src/views/finance/fleet/rules-audit.vue packages/web/src/router/modules/finance.ts
```

Expected: Archive page has no office processing flow, and new rules/audit page is routed.

---

## Task 9: Miniapp Fuel Application Resubmission

**Files:**
- Modify: `packages/miniapp/pages/fuel-apply/index.js`
- Modify: `packages/miniapp/pages/fuel-apply/index.wxml`
- Modify: `packages/miniapp/pages/fuel-apply/index.wxss`

- [ ] **Step 1: Add status helpers and selected resubmit state**

In `packages/miniapp/pages/fuel-apply/index.js`, add to `data`:

```js
resubmitApplicationId: "",
needsInfoCount: 0,
statusTextMap: {
  pending: "待办公室处理",
  needs_info: "待补充资料",
  processed: "已通过",
  rejected: "已拒绝",
  cancelled: "已废除"
}
```

In `loadData`, after `const myApplications = ...`, compute:

```js
const needsInfoCount = myApplications.filter((item) => item.status === "needs_info").length;
```

and include `needsInfoCount` in `setData`.

Add methods:

```js
startResubmit(e) {
  const id = e.currentTarget.dataset.id;
  const target = this.data.myApplications.find((item) => String(item.id) === String(id));
  if (!target) return;
  this.setData({
    resubmitApplicationId: id,
    "form.vehicle_id": target.vehicle_id || "",
    "form.fuel_card_id": target.fuel_card_id || "",
    "form.requested_amount": target.requested_amount || "",
    "form.vehicle_mileage_km": target.vehicle_mileage_km || ""
  });
},

cancelResubmit() {
  this.setData({
    resubmitApplicationId: "",
    photoKeys: []
  });
},

statusText(status) {
  return this.data.statusTextMap[status] || status || "-";
}
```

- [ ] **Step 2: Split submit path into create or resubmit**

In `submit`, replace the request path/action with:

```js
const isResubmit = Boolean(this.data.resubmitApplicationId);
const path = isResubmit
  ? `/api/v1/fleet/fuel-applications/${this.data.resubmitApplicationId}/resubmit`
  : "/api/v1/fleet/fuel-applications";

await request({
  method: "POST",
  path,
  data: {
    vehicle_id: vehicleId,
    fuel_card_id: fuelCardId,
    requested_amount: amount,
    vehicle_mileage_km: mileage,
    photo_keys_json: JSON.stringify(this.data.photoKeys || [])
  }
});
```

After success reset `resubmitApplicationId`:

```js
this.setData({
  resubmitApplicationId: "",
  vehicleIndex: 0,
  fuelCardIndex: 0,
  photoKeys: [],
  form: {
    vehicle_id: "",
    fuel_card_id: "",
    requested_amount: "",
    vehicle_mileage_km: ""
  }
});
```

Set success title based on mode:

```js
wx.showToast({ title: isResubmit ? "补充已提交" : "申请已提交", icon: "success" });
```

- [ ] **Step 3: Update WXML**

In `packages/miniapp/pages/fuel-apply/index.wxml`, add alert near the top:

```xml
<view wx:if="{{needsInfoCount > 0}}" class="notice-warning">
  有 {{needsInfoCount}} 条油卡申请需要补充资料，请在申请记录中点击“补充资料”。
</view>
```

Change submit button text:

```xml
<button class="primary-btn" bindtap="submit">
  {{resubmitApplicationId ? '提交补充资料' : '提交申请'}}
</button>
<button wx:if="{{resubmitApplicationId}}" class="secondary-btn" bindtap="cancelResubmit">
  取消补充
</button>
```

In each record item, display returned reason and action:

```xml
<view class="record-status">状态：{{statusTextMap[item.status] || item.status}}</view>
<view wx:if="{{item.risk_summary}}" class="record-line">风险：{{item.risk_summary}}</view>
<view wx:if="{{item.needs_info_reason}}" class="record-warning">补充说明：{{item.needs_info_reason}}</view>
<button
  wx:if="{{item.status === 'needs_info'}}"
  size="mini"
  data-id="{{item.id}}"
  bindtap="startResubmit"
>
  补充资料
</button>
```

- [ ] **Step 4: Update WXSS**

In `packages/miniapp/pages/fuel-apply/index.wxss`, add:

```css
.notice-warning {
  margin-bottom: 20rpx;
  padding: 20rpx;
  border-radius: 12rpx;
  background: #fff7ed;
  color: #9a3412;
  font-size: 26rpx;
}

.secondary-btn {
  margin-top: 16rpx;
  color: #1f2937;
  background: #f3f4f6;
}

.record-warning {
  margin-top: 8rpx;
  color: #b45309;
  font-size: 24rpx;
}

.record-status {
  margin-top: 8rpx;
  font-weight: 600;
  color: #1f2937;
}
```

- [ ] **Step 5: Run syntax check**

Run:

```bash
node --check packages/miniapp/pages/fuel-apply/index.js
```

Expected: no syntax errors.

- [ ] **Step 6: Checkpoint**

Run:

```bash
git diff -- packages/miniapp/pages/fuel-apply/index.js packages/miniapp/pages/fuel-apply/index.wxml packages/miniapp/pages/fuel-apply/index.wxss
```

Expected: Miniapp supports needs-info display and resubmission.

---

## Task 10: Documentation And Final Verification

**Files:**
- Modify: `doc/UI设计文档.md`
- Modify: `doc/开发记录.md`
- Modify: `doc/guide/02-经理手册.md`
- Modify: `doc/guide/04-现场操作员手册.md`
- Modify: `doc/guide/05-财务手册.md`

- [ ] **Step 1: Update UI mapping**

In `doc/UI设计文档.md`, update section `8. 车辆油卡与公司实体增强` with these bullets:

```md
- 油卡处理工作台：`/finance/fleet/processing` → `packages/web/src/views/finance/fleet/processing-workbench.vue`
  - 财务/办公室使用，按待处理、待补充、已通过、已拒绝分队列处理。
  - 详情侧栏展示规则命中、风险摘要、历史处理信息，并提供通过、退回补充、拒绝动作。
- 规则与审计中心：`/finance/fleet/rules-audit` → `packages/web/src/views/finance/fleet/rules-audit.vue`
  - 超级管理员使用，维护油卡规则、查看企微通知记录和操作审计。
- 车辆油卡档案：`/finance/fleet/vehicles` → `packages/web/src/views/finance/fleet/vehicles.vue`
  - 聚焦车辆档案、油卡、员工绑定、余额变动记录，不再承载办公室处理队列。
- 小程序员工加油申请：`packages/miniapp/pages/fuel-apply/index.{js,wxml,wxss,json}`
  - 支持 `needs_info` 退回补充，申请人可更新里程、照片后重新提交。
```

- [ ] **Step 2: Update guides**

Append concise sections:

`doc/guide/02-经理手册.md`:

```md
## 车辆用油健康总览

经理进入“车辆油卡 / 用油健康总览”后，先查看本期申请金额、通过金额、活跃油卡余额、低余额油卡数量和综合健康判断。逐单处理由财务/办公室完成，经理仅在需要时钻取车辆排行、余额健康和处理效率。
```

`doc/guide/04-现场操作员手册.md`:

```md
## 油卡额度申请与补充

现场操作员可在小程序“油卡额度申请”中选择车辆、本人绑定油卡、填写额度和里程并上传现场照片。若状态变为“待补充资料”，按页面提示补充照片或修正里程后重新提交。
```

`doc/guide/05-财务手册.md`:

```md
## 油卡处理工作台

财务/办公室进入“车辆油卡 / 油卡处理工作台”，按待处理队列处理申请。处理前查看风险摘要、规则命中、车辆、油卡和照片信息；可选择通过并回写余额、退回补充或拒绝。处理结果会通知申请人并进入审计记录。
```

- [ ] **Step 3: Append development log**

Append to `doc/开发记录.md` using Melbourne timezone:

```md
## 2026-05-29 HH:mm (Australia/Melbourne)

### 目标

完成车辆与油卡治理闭环：Web、小程序、企微通知、规则配置、审计和管理驾驶舱。

### 变更

1. 后端新增车辆油卡治理数据模型、规则命中、退回补充、补充后重新提交、通知记录和审计写入。
2. Web 拆分油卡申请、油卡处理工作台、车辆油卡档案、用油健康总览、规则与审计中心。
3. 小程序油卡申请支持待补充资料状态和重新提交。
4. 企微通知覆盖提交、超时、处理结果和余额预警，并保留发送记录。
5. 文档同步车辆油卡页面映射和角色使用手册。

### 影响范围

- 员工/现场操作员、财务/办公室、经理、超级管理员的车辆油卡使用链路。
- `packages/api`、`packages/web`、`packages/miniapp` 与车辆油卡相关页面和接口。

### 下一步

1. 联调企微通知目标用户配置 `fleet:fuel:finance-office-targets`。
2. 用 operator、finance、manager、super_admin 四类账号跑通端到端流程。
```

Replace `HH:mm` with the actual local time from `date '+%H:%M'`.

- [ ] **Step 4: Run full verification**

Run:

```bash
cd packages/api && npm test -- src/services/fleet-governance.test.ts src/services/fleet-notification.test.ts
cd packages/api && npm run typecheck
cd packages/api && npm run lint
cd packages/web && npm run typecheck
node --check packages/miniapp/pages/fuel-apply/index.js
```

Expected: all pass.

- [ ] **Step 5: Optional browser verification**

If a Web dev server is needed, run:

```bash
cd packages/web && npm run dev
```

Open the served URL and verify:

- `/workspace/fuel-application` displays risk and returned-material state.
- `/finance/fleet/processing` loads the processing workbench.
- `/finance/fleet/dashboard` emphasizes cost and card balance health.
- `/finance/fleet/rules-audit` loads for super-admin roles.

- [ ] **Step 6: Final checkpoint**

Run:

```bash
git status --short
git diff --stat
```

Expected: Changes match this plan. No unrelated files are modified.

---

## Self-Review Checklist

- Spec coverage:
  - Role chain: Tasks 7 and 8 split Web by role; Task 9 covers miniapp operator flow.
  - State machine: Tasks 1 and 3 implement `needs_info` and resubmit.
  - Rules: Tasks 1, 2, 3, and 8 implement policies, hits, and UI.
  - Notifications: Tasks 2, 3, and 4 implement records, delivery, retry, and timeout scan.
  - Audit: Tasks 1, 3, and 8 write and display audit logs.
  - Management dashboard: Task 5 implements health metrics and UI.
  - Docs: Task 10 updates UI mapping, dev log, and role guides.
- Placeholder scan:
  - No placeholder markers or unspecified deferred-work steps.
  - Each code-changing step names exact files and concrete code.
- Type consistency:
  - `needs_info` is used consistently in API, Web, and miniapp.
  - Rule policy types match across backend and frontend.
  - Notification statuses match D1, API, and Web.
