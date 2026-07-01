# 车辆保养记录 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为公司车辆新增"保养记录"台账，员工通过网页与小程序填写（里程、保养内容、时间、保养人、费用、附件），与现有车辆主档挂钩。

**Architecture:** 纯记录台账（无审批/无工作台/无通知）。复用车队模块模式：新表 `vehicle_maintenance_record` 挂钩 `company_vehicle`；后端独立 Hono 路由 `vehicle-maintenance.ts` + 纯函数策略模块 `vehicle-maintenance-policy.ts`（vitest 单测）；Web 独立顶层菜单页 + 小程序新页面；附件走现有 `/api/v1/upload/sign` 直传 R2。

**Tech Stack:** Hono + Cloudflare D1（后端）、Vue 3 + Element Plus + PureAdmin（Web）、原生微信小程序 + TDesign（小程序）、vitest（测试）。

**参照规范：** [`docs/superpowers/specs/2026-06-24-vehicle-maintenance-record-design.md`](../specs/2026-06-24-vehicle-maintenance-record-design.md)

**权限口径：** 管理层 = `super_admin / manager / finance / site_manager`（看全部、可编辑/作废）；`operator` 仅见本人记录、仅可新增。

---

## Task 1: 数据库迁移与字典播种

**Files:**
- Create: `packages/api/migrations/0052_vehicle_maintenance_record.sql`

- [ ] **Step 1: 写迁移文件**

创建 `packages/api/migrations/0052_vehicle_maintenance_record.sql`：

```sql
-- 车辆保养记录：纯记录台账，挂钩 company_vehicle，支持多附件、软删除。
CREATE TABLE IF NOT EXISTS vehicle_maintenance_record (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_no TEXT NOT NULL UNIQUE,
  vehicle_id INTEGER NOT NULL,
  maintenance_type TEXT NOT NULL,
  content TEXT NOT NULL,
  mileage_km REAL NOT NULL,
  service_provider TEXT,
  cost REAL,
  serviced_at TEXT NOT NULL,
  attachments_json TEXT,
  remark TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_by_userid TEXT NOT NULL,
  voided_by_userid TEXT,
  voided_at TEXT,
  void_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (vehicle_id) REFERENCES company_vehicle(id)
);

CREATE INDEX IF NOT EXISTS idx_vehicle_maintenance_record_vehicle_id ON vehicle_maintenance_record(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_maintenance_record_serviced_at ON vehicle_maintenance_record(serviced_at);
CREATE INDEX IF NOT EXISTS idx_vehicle_maintenance_record_created_by ON vehicle_maintenance_record(created_by_userid);
CREATE INDEX IF NOT EXISTS idx_vehicle_maintenance_record_status ON vehicle_maintenance_record(status);
CREATE INDEX IF NOT EXISTS idx_vehicle_maintenance_record_type ON vehicle_maintenance_record(maintenance_type);

INSERT OR IGNORE INTO sys_dict (dict_type, dict_label, dict_value, sort_order, status, created_at, updated_at) VALUES
  ('vehicle_maintenance_type', '常规保养', 'routine', 10, 'active', datetime('now'), datetime('now')),
  ('vehicle_maintenance_type', '维修', 'repair', 20, 'active', datetime('now'), datetime('now')),
  ('vehicle_maintenance_type', '轮胎', 'tire', 30, 'active', datetime('now'), datetime('now')),
  ('vehicle_maintenance_type', '保险年检', 'inspection', 40, 'active', datetime('now'), datetime('now')),
  ('vehicle_maintenance_type', '事故处理', 'accident', 50, 'active', datetime('now'), datetime('now')),
  ('vehicle_maintenance_type', '其他', 'other', 90, 'active', datetime('now'), datetime('now'));
```

- [ ] **Step 2: 本地应用迁移**

Run: `cd packages/api && npm run db:migrate:local`
Expected: 输出包含 `0052_vehicle_maintenance_record.sql` 应用成功，无报错。

- [ ] **Step 3: 验证表与字典已创建**

Run: `cd packages/api && npx wrangler d1 execute hybcdg-prod-db --local --command "SELECT name FROM sqlite_master WHERE type='table' AND name='vehicle_maintenance_record'; SELECT dict_value FROM sys_dict WHERE dict_type='vehicle_maintenance_type';"`
Expected: 返回表名 `vehicle_maintenance_record`，以及 6 个字典值 routine/repair/tire/inspection/accident/other。

- [ ] **Step 4: Commit**

```bash
git add packages/api/migrations/0052_vehicle_maintenance_record.sql
git commit -m "feat(maintenance): 新增车辆保养记录表与保养类型字典"
```

---

## Task 2: 纯函数策略模块（TDD）

把校验与权限范围抽成纯函数，便于单测。先写测试。

**Files:**
- Create: `packages/api/src/routes/vehicle-maintenance-policy.ts`
- Test: `packages/api/src/routes/vehicle-maintenance-policy.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `packages/api/src/routes/vehicle-maintenance-policy.test.ts`：

```ts
import { describe, expect, it } from "vitest";

import {
  canManageMaintenance,
  resolveMaintenanceListScope,
  validateMaintenanceCreateInput
} from "./vehicle-maintenance-policy";

const allowedTypes = ["routine", "repair", "tire", "inspection", "accident", "other"];
const fallbackDate = "2026-06-24T00:00:00.000Z";

const validRaw = {
  vehicle_id: 7,
  maintenance_type: "routine",
  content: "更换机油机滤",
  mileage_km: 45000,
  service_provider: "城东修理厂",
  cost: 480,
  serviced_at: "2026-06-20",
  attachments_json: JSON.stringify([{ file_key: "k1", file_name: "f.pdf", file_size: 10 }])
};

describe("canManageMaintenance", () => {
  it("returns true for manager-tier roles", () => {
    expect(canManageMaintenance(["operator", "manager"])).toBe(true);
    expect(canManageMaintenance(["super_admin"])).toBe(true);
    expect(canManageMaintenance(["finance"])).toBe(true);
    expect(canManageMaintenance(["site_manager"])).toBe(true);
  });

  it("returns false for operator-only", () => {
    expect(canManageMaintenance(["operator"])).toBe(false);
  });
});

describe("resolveMaintenanceListScope", () => {
  it("restricts operators to their own records", () => {
    const scope = resolveMaintenanceListScope({ roles: ["operator"], authSub: "op.1" });
    expect(scope).toEqual({ restrictToUserid: "op.1" });
  });

  it("lets managers see all by default", () => {
    const scope = resolveMaintenanceListScope({ roles: ["manager"], authSub: "mgr.1" });
    expect(scope).toEqual({ restrictToUserid: null });
  });

  it("restricts managers to own when mine=true", () => {
    const scope = resolveMaintenanceListScope({
      roles: ["manager"],
      authSub: "mgr.1",
      requestedMine: true
    });
    expect(scope).toEqual({ restrictToUserid: "mgr.1" });
  });
});

describe("validateMaintenanceCreateInput", () => {
  it("accepts a valid payload and normalizes fields", () => {
    const result = validateMaintenanceCreateInput(validRaw, allowedTypes, fallbackDate);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.vehicleId).toBe(7);
    expect(result.value.maintenanceType).toBe("routine");
    expect(result.value.cost).toBe(480);
    expect(result.value.servicedAt).toBe("2026-06-20");
    expect(result.value.serviceProvider).toBe("城东修理厂");
  });

  it("uses fallback serviced_at when missing", () => {
    const result = validateMaintenanceCreateInput(
      { ...validRaw, serviced_at: undefined },
      allowedTypes,
      fallbackDate
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.servicedAt).toBe(fallbackDate);
  });

  it("treats blank cost as null", () => {
    const result = validateMaintenanceCreateInput(
      { ...validRaw, cost: "" },
      allowedTypes,
      fallbackDate
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.cost).toBeNull();
  });

  it("rejects missing vehicle_id", () => {
    const result = validateMaintenanceCreateInput(
      { ...validRaw, vehicle_id: undefined },
      allowedTypes,
      fallbackDate
    );
    expect(result).toEqual({ ok: false, status: 400, message: "vehicle_id is required" });
  });

  it("rejects unknown maintenance_type", () => {
    const result = validateMaintenanceCreateInput(
      { ...validRaw, maintenance_type: "spaceship" },
      allowedTypes,
      fallbackDate
    );
    expect(result).toEqual({ ok: false, status: 400, message: "maintenance_type is invalid" });
  });

  it("rejects empty content", () => {
    const result = validateMaintenanceCreateInput(
      { ...validRaw, content: "   " },
      allowedTypes,
      fallbackDate
    );
    expect(result).toEqual({ ok: false, status: 400, message: "content is required" });
  });

  it("rejects negative mileage", () => {
    const result = validateMaintenanceCreateInput(
      { ...validRaw, mileage_km: -1 },
      allowedTypes,
      fallbackDate
    );
    expect(result).toEqual({
      ok: false,
      status: 400,
      message: "mileage_km must be a non-negative number"
    });
  });

  it("rejects negative cost", () => {
    const result = validateMaintenanceCreateInput(
      { ...validRaw, cost: -5 },
      allowedTypes,
      fallbackDate
    );
    expect(result).toEqual({
      ok: false,
      status: 400,
      message: "cost must be a non-negative number"
    });
  });

  it("rejects malformed attachments_json", () => {
    const result = validateMaintenanceCreateInput(
      { ...validRaw, attachments_json: "{not-an-array}" },
      allowedTypes,
      fallbackDate
    );
    expect(result).toEqual({
      ok: false,
      status: 400,
      message: "attachments_json must be a JSON array"
    });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/api && npx vitest run src/routes/vehicle-maintenance-policy.test.ts`
Expected: FAIL，报 `Failed to resolve import "./vehicle-maintenance-policy"`（模块尚未创建）。

- [ ] **Step 3: 写最小实现**

创建 `packages/api/src/routes/vehicle-maintenance-policy.ts`：

```ts
import type { UserRole } from "../types/auth";

export const MAINTENANCE_MANAGER_ROLES: UserRole[] = [
  "super_admin",
  "manager",
  "finance",
  "site_manager"
];

export const canManageMaintenance = (roles: UserRole[]): boolean =>
  roles.some((role) => MAINTENANCE_MANAGER_ROLES.includes(role));

export type MaintenanceListScopeInput = {
  roles: UserRole[];
  authSub: string;
  requestedMine?: boolean;
};

export const resolveMaintenanceListScope = (
  input: MaintenanceListScopeInput
): { restrictToUserid: string | null } => {
  // 非管理层（operator）强制只看本人；管理层默认看全部，除非显式 mine=true
  if (!canManageMaintenance(input.roles)) {
    return { restrictToUserid: input.authSub };
  }
  if (input.requestedMine) {
    return { restrictToUserid: input.authSub };
  }
  return { restrictToUserid: null };
};

export type MaintenanceCreateRawInput = {
  vehicle_id?: unknown;
  maintenance_type?: unknown;
  content?: unknown;
  mileage_km?: unknown;
  service_provider?: unknown;
  cost?: unknown;
  serviced_at?: unknown;
  attachments_json?: unknown;
  remark?: unknown;
};

export type MaintenanceCreateValue = {
  vehicleId: number;
  maintenanceType: string;
  content: string;
  mileageKm: number;
  serviceProvider: string | null;
  cost: number | null;
  servicedAt: string;
  attachmentsJson: string | null;
  remark: string | null;
};

export type MaintenanceValidation =
  | { ok: true; value: MaintenanceCreateValue }
  | { ok: false; status: 400; message: string };

const isJsonArray = (raw: string): boolean => {
  try {
    return Array.isArray(JSON.parse(raw));
  } catch {
    return false;
  }
};

export const validateMaintenanceCreateInput = (
  input: MaintenanceCreateRawInput,
  allowedTypes: string[],
  fallbackServicedAt: string
): MaintenanceValidation => {
  const vehicleId = Number(input.vehicle_id);
  if (!Number.isInteger(vehicleId) || vehicleId <= 0) {
    return { ok: false, status: 400, message: "vehicle_id is required" };
  }

  const maintenanceType =
    typeof input.maintenance_type === "string" ? input.maintenance_type.trim() : "";
  if (!maintenanceType || !allowedTypes.includes(maintenanceType)) {
    return { ok: false, status: 400, message: "maintenance_type is invalid" };
  }

  const content = typeof input.content === "string" ? input.content.trim() : "";
  if (!content) {
    return { ok: false, status: 400, message: "content is required" };
  }

  const mileageKm = Number(input.mileage_km);
  if (!Number.isFinite(mileageKm) || mileageKm < 0) {
    return {
      ok: false,
      status: 400,
      message: "mileage_km must be a non-negative number"
    };
  }

  let cost: number | null = null;
  if (input.cost !== undefined && input.cost !== null && input.cost !== "") {
    const parsedCost = Number(input.cost);
    if (!Number.isFinite(parsedCost) || parsedCost < 0) {
      return {
        ok: false,
        status: 400,
        message: "cost must be a non-negative number"
      };
    }
    cost = parsedCost;
  }

  let attachmentsJson: string | null = null;
  if (typeof input.attachments_json === "string" && input.attachments_json.trim()) {
    if (!isJsonArray(input.attachments_json)) {
      return {
        ok: false,
        status: 400,
        message: "attachments_json must be a JSON array"
      };
    }
    attachmentsJson = input.attachments_json;
  }

  const servicedAt =
    typeof input.serviced_at === "string" && input.serviced_at.trim()
      ? input.serviced_at.trim()
      : fallbackServicedAt;

  const serviceProvider =
    typeof input.service_provider === "string" && input.service_provider.trim()
      ? input.service_provider.trim()
      : null;

  const remark =
    typeof input.remark === "string" && input.remark.trim() ? input.remark.trim() : null;

  return {
    ok: true,
    value: {
      vehicleId,
      maintenanceType,
      content,
      mileageKm,
      serviceProvider,
      cost,
      servicedAt,
      attachmentsJson,
      remark
    }
  };
};
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/api && npx vitest run src/routes/vehicle-maintenance-policy.test.ts`
Expected: PASS，全部用例通过。

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/routes/vehicle-maintenance-policy.ts packages/api/src/routes/vehicle-maintenance-policy.test.ts
git commit -m "feat(maintenance): 新增保养记录校验与权限范围纯函数及单测"
```

---

## Task 3: 后端路由与挂载

**Files:**
- Create: `packages/api/src/routes/vehicle-maintenance.ts`
- Modify: `packages/api/src/index.ts`（新增 import 与挂载，须在 `/api/v1/fleet` 之前）

- [ ] **Step 1: 写路由处理器**

创建 `packages/api/src/routes/vehicle-maintenance.ts`：

```ts
import { Hono } from "hono";

import { authMiddleware, type AuthVariables } from "../middleware/auth";
import { requireRoles } from "../middleware/rbac";
import { appendApiAuditLog } from "../services/fleet-governance";
import { generateSerial } from "../services/serial";
import type { UserRole } from "../types/auth";
import type { Env } from "../types/env";
import {
  canManageMaintenance,
  resolveMaintenanceListScope,
  validateMaintenanceCreateInput
} from "./vehicle-maintenance-policy";

const nowIso = () => new Date().toISOString();
const maxPageSize = 100;
const managerRoles: UserRole[] = ["super_admin", "manager", "finance", "site_manager"];

type MaintenanceRow = {
  id: number;
  record_no: string;
  vehicle_id: number;
  maintenance_type: string;
  content: string;
  mileage_km: number;
  service_provider: string | null;
  cost: number | null;
  serviced_at: string;
  attachments_json: string | null;
  remark: string | null;
  status: string;
  created_by_userid: string;
  voided_by_userid: string | null;
  voided_at: string | null;
  void_reason: string | null;
  created_at: string;
  updated_at: string;
  current_plate_no?: string | null;
  vehicle_model?: string | null;
};

const parsePositiveInteger = (value: string | undefined): number | null => {
  if (!value || !/^[1-9]\d*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
};

const loadAllowedMaintenanceTypes = async (env: Env): Promise<string[]> => {
  const rows = await env.DB.prepare(
    "SELECT dict_value FROM sys_dict WHERE dict_type = 'vehicle_maintenance_type' AND status = 'active'"
  ).all<{ dict_value: string }>();
  return (rows.results ?? []).map((row) => row.dict_value);
};

export const vehicleMaintenanceRoutes = new Hono<{
  Bindings: Env;
  Variables: AuthVariables;
}>();

vehicleMaintenanceRoutes.use("*", authMiddleware);

// GET 列表（分页 + 筛选 + 角色范围）
vehicleMaintenanceRoutes.get("/", async (c) => {
  const auth = c.get("auth");
  const scope = resolveMaintenanceListScope({
    roles: auth.roles,
    authSub: auth.sub,
    requestedMine: c.req.query("mine") === "true"
  });

  const page = parsePositiveInteger(c.req.query("page")) ?? 1;
  const pageSize = Math.min(parsePositiveInteger(c.req.query("pageSize")) ?? 20, maxPageSize);
  const offset = (page - 1) * pageSize;

  const filters: string[] = [];
  const params: Array<string | number> = [];

  if (scope.restrictToUserid) {
    filters.push("m.created_by_userid = ?");
    params.push(scope.restrictToUserid);
  }

  const vehicleId = c.req.query("vehicle_id");
  if (vehicleId) {
    filters.push("m.vehicle_id = ?");
    params.push(Number(vehicleId));
  }

  const maintenanceType = c.req.query("maintenance_type");
  if (maintenanceType) {
    filters.push("m.maintenance_type = ?");
    params.push(maintenanceType);
  }

  const status = c.req.query("status");
  if (status) {
    filters.push("m.status = ?");
    params.push(status);
  }

  const dateFrom = c.req.query("date_from");
  if (dateFrom) {
    filters.push("m.serviced_at >= ?");
    params.push(dateFrom);
  }

  const dateTo = c.req.query("date_to");
  if (dateTo) {
    filters.push("m.serviced_at <= ?");
    params.push(dateTo);
  }

  const whereClause = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

  const countRow = await c.env.DB.prepare(
    `SELECT COUNT(*) AS total FROM vehicle_maintenance_record m ${whereClause}`
  )
    .bind(...params)
    .first<{ total: number }>();

  const rows = await c.env.DB.prepare(
    `SELECT m.*, v.current_plate_no, v.vehicle_model
       FROM vehicle_maintenance_record m
       LEFT JOIN company_vehicle v ON v.id = m.vehicle_id
       ${whereClause}
       ORDER BY m.serviced_at DESC, m.id DESC
       LIMIT ? OFFSET ?`
  )
    .bind(...params, pageSize, offset)
    .all<MaintenanceRow>();

  return c.json({
    success: true,
    data: rows.results ?? [],
    pagination: { page, pageSize, total: countRow?.total ?? 0 }
  });
});

// GET 详情
vehicleMaintenanceRoutes.get("/:id", async (c) => {
  const auth = c.get("auth");
  const id = Number(c.req.param("id"));

  const row = await c.env.DB.prepare(
    `SELECT m.*, v.current_plate_no, v.vehicle_model
       FROM vehicle_maintenance_record m
       LEFT JOIN company_vehicle v ON v.id = m.vehicle_id
       WHERE m.id = ?`
  )
    .bind(id)
    .first<MaintenanceRow>();

  if (!row) {
    return c.json({ success: false, error: { message: "Record not found" } }, 404);
  }

  if (!canManageMaintenance(auth.roles) && row.created_by_userid !== auth.sub) {
    return c.json({ success: false, error: { message: "Forbidden" } }, 403);
  }

  return c.json({ success: true, data: row });
});

// POST 新增（全员）
vehicleMaintenanceRoutes.post("/", async (c) => {
  const auth = c.get("auth");
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const allowedTypes = await loadAllowedMaintenanceTypes(c.env);

  const validation = validateMaintenanceCreateInput(body, allowedTypes, nowIso());
  if (!validation.ok) {
    return c.json({ success: false, error: { message: validation.message } }, validation.status);
  }
  const value = validation.value;

  const vehicle = await c.env.DB.prepare("SELECT id FROM company_vehicle WHERE id = ?")
    .bind(value.vehicleId)
    .first<{ id: number }>();
  if (!vehicle) {
    return c.json({ success: false, error: { message: "Vehicle not found" } }, 404);
  }

  const recordNo = await generateSerial(
    c.env.DB,
    "BY",
    "vehicle_maintenance_record",
    "record_no"
  );
  const ts = nowIso();

  const result = await c.env.DB.prepare(
    `INSERT INTO vehicle_maintenance_record (
      record_no, vehicle_id, maintenance_type, content, mileage_km,
      service_provider, cost, serviced_at, attachments_json, remark,
      status, created_by_userid, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`
  )
    .bind(
      recordNo,
      value.vehicleId,
      value.maintenanceType,
      value.content,
      value.mileageKm,
      value.serviceProvider,
      value.cost,
      value.servicedAt,
      value.attachmentsJson,
      value.remark,
      auth.sub,
      ts,
      ts
    )
    .run();

  await appendApiAuditLog(c.env, {
    actor_userid: auth.sub,
    actor_roles_json: JSON.stringify(auth.roles),
    action: "vehicle_maintenance_create",
    target_type: "vehicle_maintenance_record",
    target_id: String(result.meta.last_row_id),
    detail_json: JSON.stringify({ record_no: recordNo, vehicle_id: value.vehicleId })
  });

  return c.json(
    { success: true, data: { id: result.meta.last_row_id, record_no: recordNo } },
    201
  );
});

// PUT 编辑（管理层）
vehicleMaintenanceRoutes.put("/:id", requireRoles(managerRoles), async (c) => {
  const auth = c.get("auth");
  const id = Number(c.req.param("id"));
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const allowedTypes = await loadAllowedMaintenanceTypes(c.env);

  const existing = await c.env.DB.prepare(
    "SELECT id, status FROM vehicle_maintenance_record WHERE id = ?"
  )
    .bind(id)
    .first<{ id: number; status: string }>();
  if (!existing) {
    return c.json({ success: false, error: { message: "Record not found" } }, 404);
  }
  if (existing.status === "voided") {
    return c.json({ success: false, error: { message: "Cannot edit a voided record" } }, 400);
  }

  const validation = validateMaintenanceCreateInput(body, allowedTypes, nowIso());
  if (!validation.ok) {
    return c.json({ success: false, error: { message: validation.message } }, validation.status);
  }
  const value = validation.value;

  const vehicle = await c.env.DB.prepare("SELECT id FROM company_vehicle WHERE id = ?")
    .bind(value.vehicleId)
    .first<{ id: number }>();
  if (!vehicle) {
    return c.json({ success: false, error: { message: "Vehicle not found" } }, 404);
  }

  await c.env.DB.prepare(
    `UPDATE vehicle_maintenance_record SET
      vehicle_id = ?, maintenance_type = ?, content = ?, mileage_km = ?,
      service_provider = ?, cost = ?, serviced_at = ?, attachments_json = ?,
      remark = ?, updated_at = ?
     WHERE id = ?`
  )
    .bind(
      value.vehicleId,
      value.maintenanceType,
      value.content,
      value.mileageKm,
      value.serviceProvider,
      value.cost,
      value.servicedAt,
      value.attachmentsJson,
      value.remark,
      nowIso(),
      id
    )
    .run();

  await appendApiAuditLog(c.env, {
    actor_userid: auth.sub,
    actor_roles_json: JSON.stringify(auth.roles),
    action: "vehicle_maintenance_update",
    target_type: "vehicle_maintenance_record",
    target_id: String(id),
    detail_json: null
  });

  return c.json({ success: true });
});

// POST 作废（管理层，软删除）
vehicleMaintenanceRoutes.post("/:id/void", requireRoles(managerRoles), async (c) => {
  const auth = c.get("auth");
  const id = Number(c.req.param("id"));
  const body = (await c.req.json().catch(() => ({}))) as { reason?: string };

  const existing = await c.env.DB.prepare(
    "SELECT id, status FROM vehicle_maintenance_record WHERE id = ?"
  )
    .bind(id)
    .first<{ id: number; status: string }>();
  if (!existing) {
    return c.json({ success: false, error: { message: "Record not found" } }, 404);
  }
  if (existing.status === "voided") {
    return c.json({ success: false, error: { message: "Already voided" } }, 400);
  }

  const reason = typeof body.reason === "string" && body.reason.trim() ? body.reason.trim() : null;
  const ts = nowIso();
  await c.env.DB.prepare(
    `UPDATE vehicle_maintenance_record SET
      status = 'voided', voided_by_userid = ?, voided_at = ?, void_reason = ?, updated_at = ?
     WHERE id = ?`
  )
    .bind(auth.sub, ts, reason, ts, id)
    .run();

  await appendApiAuditLog(c.env, {
    actor_userid: auth.sub,
    actor_roles_json: JSON.stringify(auth.roles),
    action: "vehicle_maintenance_void",
    target_type: "vehicle_maintenance_record",
    target_id: String(id),
    detail_json: JSON.stringify({ reason })
  });

  return c.json({ success: true });
});
```

- [ ] **Step 2: 在 index.ts 挂载路由（须在 `/api/v1/fleet` 之前）**

在 `packages/api/src/index.ts` 的 import 区，紧随 `import { fleetRoutes } from "./routes/fleet";`（约第 14 行）之后新增：

```ts
import { vehicleMaintenanceRoutes } from "./routes/vehicle-maintenance";
```

在路由挂载区，将保养路由挂在 fleet 之前。把原有这一行：

```ts
app.route("/api/v1/fleet", fleetRoutes);
```

替换为：

```ts
app.route("/api/v1/fleet/maintenance", vehicleMaintenanceRoutes);
app.route("/api/v1/fleet", fleetRoutes);
```

- [ ] **Step 3: 类型检查**

Run: `cd packages/api && npm run typecheck`
Expected: 无错误（exit 0）。

- [ ] **Step 4: 回归运行已有单测**

Run: `cd packages/api && npx vitest run src/routes/vehicle-maintenance-policy.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/routes/vehicle-maintenance.ts packages/api/src/index.ts
git commit -m "feat(maintenance): 新增保养记录后端路由（列表/详情/新增/编辑/作废）"
```

---

## Task 4: Web API 封装

**Files:**
- Create: `packages/web/src/api/vehicle-maintenance.ts`

- [ ] **Step 1: 写 API 封装**

创建 `packages/web/src/api/vehicle-maintenance.ts`：

```ts
import { http } from "@/utils/http";

export type VehicleMaintenanceRecord = {
  id: number;
  record_no: string;
  vehicle_id: number;
  maintenance_type: string;
  content: string;
  mileage_km: number;
  service_provider: string | null;
  cost: number | null;
  serviced_at: string;
  attachments_json: string | null;
  remark: string | null;
  status: "active" | "voided";
  created_by_userid: string;
  voided_by_userid: string | null;
  voided_at: string | null;
  void_reason: string | null;
  created_at: string;
  updated_at: string;
  current_plate_no?: string | null;
  vehicle_model?: string | null;
};

export type MaintenanceAttachment = {
  file_key: string;
  file_name: string;
  file_size?: number;
};

export type MaintenancePagination = {
  page: number;
  pageSize: number;
  total: number;
};

export type MaintenanceTypeOption = {
  dict_label: string;
  dict_value: string;
};

export type MaintenanceCreatePayload = {
  vehicle_id: number;
  maintenance_type: string;
  content: string;
  mileage_km: number;
  service_provider?: string | null;
  cost?: number | null;
  serviced_at?: string;
  attachments_json?: string | null;
  remark?: string | null;
};

export const listMaintenanceRecords = (params?: {
  vehicle_id?: number;
  maintenance_type?: string;
  status?: string;
  mine?: boolean;
  date_from?: string;
  date_to?: string;
  page?: number;
  pageSize?: number;
}) => {
  return http.request<{
    success: boolean;
    data: VehicleMaintenanceRecord[];
    pagination: MaintenancePagination;
  }>("get", "/api/v1/fleet/maintenance", { params });
};

export const getMaintenanceRecord = (id: number) => {
  return http.request<{ success: boolean; data: VehicleMaintenanceRecord }>(
    "get",
    `/api/v1/fleet/maintenance/${id}`
  );
};

export const createMaintenanceRecord = (data: MaintenanceCreatePayload) => {
  return http.request<{ success: boolean; data: { id: number; record_no: string } }>(
    "post",
    "/api/v1/fleet/maintenance",
    { data }
  );
};

export const updateMaintenanceRecord = (id: number, data: MaintenanceCreatePayload) => {
  return http.request<{ success: boolean }>(
    "put",
    `/api/v1/fleet/maintenance/${id}`,
    { data }
  );
};

export const voidMaintenanceRecord = (id: number, data?: { reason?: string }) => {
  return http.request<{ success: boolean }>(
    "post",
    `/api/v1/fleet/maintenance/${id}/void`,
    { data: data ?? {} }
  );
};

export const listMaintenanceTypes = () => {
  return http.request<{ success: boolean; data: MaintenanceTypeOption[] }>(
    "get",
    "/api/v1/dict",
    { params: { dict_type: "vehicle_maintenance_type" } }
  );
};
```

- [ ] **Step 2: 类型检查**

Run: `cd packages/web && npm run typecheck`
Expected: 无错误（exit 0）。

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/api/vehicle-maintenance.ts
git commit -m "feat(maintenance): 新增 Web 保养记录 API 封装"
```

---

## Task 5: Web 页面与路由菜单

**Files:**
- Create: `packages/web/src/router/modules/vehicle-maintenance.ts`
- Create: `packages/web/src/views/vehicle-maintenance/index.vue`

- [ ] **Step 1: 写路由模块（独立顶层菜单，全员可见）**

创建 `packages/web/src/router/modules/vehicle-maintenance.ts`：

```ts
const Layout = () => import("@/layout/index.vue");

export default {
  path: "/vehicle-maintenance",
  name: "VehicleMaintenance",
  component: Layout,
  redirect: "/vehicle-maintenance/index",
  meta: {
    icon: "ep/tools",
    title: "车辆保养",
    rank: 18
  },
  children: [
    {
      path: "/vehicle-maintenance/index",
      name: "VehicleMaintenanceIndex",
      component: () => import("@/views/vehicle-maintenance/index.vue"),
      meta: {
        title: "车辆保养记录",
        roles: ["super_admin", "manager", "finance", "site_manager", "operator"]
      }
    }
  ]
} satisfies RouteConfigsTable;
```

- [ ] **Step 2: 写页面**

创建 `packages/web/src/views/vehicle-maintenance/index.vue`：

```vue
<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import type { UploadRequestOptions } from "element-plus";
import { message } from "@/utils/message";
import { statusLabel } from "@/utils/enum-labels";
import { useUserStoreHook } from "@/store/modules/user";
import { createUploadSignature, resolveUploadUrl } from "@/api/upload";
import { listFleetVehicles, type FleetVehicle } from "@/api/fleet";
import {
  createMaintenanceRecord,
  getMaintenanceRecord,
  listMaintenanceRecords,
  listMaintenanceTypes,
  updateMaintenanceRecord,
  voidMaintenanceRecord,
  type MaintenanceAttachment,
  type MaintenanceCreatePayload,
  type MaintenanceTypeOption,
  type VehicleMaintenanceRecord
} from "@/api/vehicle-maintenance";

const userStore = useUserStoreHook();
const canManage = computed(() =>
  (userStore.roles ?? []).some(role =>
    ["super_admin", "manager", "finance", "site_manager"].includes(role)
  )
);

const loading = ref(false);
const records = ref<VehicleMaintenanceRecord[]>([]);
const vehicles = ref<FleetVehicle[]>([]);
const maintenanceTypes = ref<MaintenanceTypeOption[]>([]);
const pagination = reactive({ page: 1, pageSize: 20, total: 0 });

const filters = reactive<{
  vehicle_id: number | undefined;
  maintenance_type: string | undefined;
  status: string | undefined;
  date_from: string | undefined;
  date_to: string | undefined;
}>({
  vehicle_id: undefined,
  maintenance_type: undefined,
  status: undefined,
  date_from: undefined,
  date_to: undefined
});

const typeLabel = (value: string) =>
  maintenanceTypes.value.find(item => item.dict_value === value)?.dict_label ?? value;

const vehicleLabel = (row: VehicleMaintenanceRecord) =>
  row.current_plate_no ? `${row.current_plate_no}` : `车辆#${row.vehicle_id}`;

const loadVehicles = async () => {
  const res = await listFleetVehicles({ status: "active" });
  vehicles.value = res.data ?? [];
};

const loadTypes = async () => {
  const res = await listMaintenanceTypes();
  maintenanceTypes.value = res.data ?? [];
};

const loadRecords = async () => {
  loading.value = true;
  try {
    const res = await listMaintenanceRecords({
      vehicle_id: filters.vehicle_id,
      maintenance_type: filters.maintenance_type,
      status: filters.status,
      date_from: filters.date_from,
      date_to: filters.date_to,
      page: pagination.page,
      pageSize: pagination.pageSize
    });
    records.value = res.data ?? [];
    pagination.total = res.pagination?.total ?? 0;
  } finally {
    loading.value = false;
  }
};

const onSearch = () => {
  pagination.page = 1;
  loadRecords();
};

const onPageChange = (page: number) => {
  pagination.page = page;
  loadRecords();
};

// ---- 新增/编辑对话框 ----
const dialogVisible = ref(false);
const editingId = ref<number | null>(null);
const submitting = ref(false);
const form = reactive<{
  vehicle_id: number | undefined;
  maintenance_type: string | undefined;
  content: string;
  mileage_km: number | undefined;
  service_provider: string;
  cost: number | undefined;
  serviced_at: string;
  remark: string;
  attachments: MaintenanceAttachment[];
}>({
  vehicle_id: undefined,
  maintenance_type: undefined,
  content: "",
  mileage_km: undefined,
  service_provider: "",
  cost: undefined,
  serviced_at: "",
  remark: "",
  attachments: []
});

const resetForm = () => {
  editingId.value = null;
  form.vehicle_id = undefined;
  form.maintenance_type = undefined;
  form.content = "";
  form.mileage_km = undefined;
  form.service_provider = "";
  form.cost = undefined;
  form.serviced_at = "";
  form.remark = "";
  form.attachments = [];
};

const openCreate = () => {
  resetForm();
  dialogVisible.value = true;
};

const openEdit = async (row: VehicleMaintenanceRecord) => {
  resetForm();
  editingId.value = row.id;
  form.vehicle_id = row.vehicle_id;
  form.maintenance_type = row.maintenance_type;
  form.content = row.content;
  form.mileage_km = row.mileage_km;
  form.service_provider = row.service_provider ?? "";
  form.cost = row.cost ?? undefined;
  form.serviced_at = row.serviced_at?.slice(0, 10) ?? "";
  form.remark = row.remark ?? "";
  form.attachments = parseAttachments(row.attachments_json);
  dialogVisible.value = true;
};

const parseAttachments = (raw: string | null): MaintenanceAttachment[] => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as MaintenanceAttachment[]) : [];
  } catch {
    return [];
  }
};

const uploadAttachment = async (options: UploadRequestOptions) => {
  try {
    const signResult = await createUploadSignature({
      fileName: options.file.name,
      contentType: options.file.type || undefined,
      category: "vehicle-maintenance"
    });
    const uploadResp = await fetch(resolveUploadUrl(signResult.data.uploadUrl), {
      method: "PUT",
      headers: {
        "content-type": options.file.type || "application/octet-stream"
      },
      body: options.file
    });
    if (!uploadResp.ok) {
      throw new Error(`upload_failed_${uploadResp.status}`);
    }
    form.attachments.push({
      file_key: signResult.data.key,
      file_name: options.file.name,
      file_size: options.file.size
    });
    options.onSuccess?.({} as never);
    message("附件上传成功", { type: "success" });
  } catch {
    options.onError?.(new Error("upload_failed") as never);
    message("附件上传失败", { type: "error" });
  }
};

const removeFormAttachment = (index: number) => {
  form.attachments.splice(index, 1);
};

const buildPayload = (): MaintenanceCreatePayload | null => {
  if (!form.vehicle_id) {
    message("请选择车辆", { type: "warning" });
    return null;
  }
  if (!form.maintenance_type) {
    message("请选择保养类型", { type: "warning" });
    return null;
  }
  if (!form.content.trim()) {
    message("请填写保养内容", { type: "warning" });
    return null;
  }
  if (form.mileage_km === undefined || Number(form.mileage_km) < 0) {
    message("请填写有效里程", { type: "warning" });
    return null;
  }
  return {
    vehicle_id: form.vehicle_id,
    maintenance_type: form.maintenance_type,
    content: form.content.trim(),
    mileage_km: Number(form.mileage_km),
    service_provider: form.service_provider.trim() || null,
    cost: form.cost === undefined || form.cost === null ? null : Number(form.cost),
    serviced_at: form.serviced_at || undefined,
    attachments_json: JSON.stringify(form.attachments),
    remark: form.remark.trim() || null
  };
};

const submitForm = async () => {
  const payload = buildPayload();
  if (!payload) return;
  submitting.value = true;
  try {
    if (editingId.value) {
      await updateMaintenanceRecord(editingId.value, payload);
      message("保养记录已更新", { type: "success" });
    } else {
      await createMaintenanceRecord(payload);
      message("保养记录已新增", { type: "success" });
    }
    dialogVisible.value = false;
    await loadRecords();
  } catch (error) {
    message((error as Error)?.message || "提交失败", { type: "error" });
  } finally {
    submitting.value = false;
  }
};

const voidRecord = async (row: VehicleMaintenanceRecord) => {
  await voidMaintenanceRecord(row.id, { reason: "管理层作废" });
  message("记录已作废", { type: "success" });
  await loadRecords();
};

// ---- 详情抽屉 ----
const drawerVisible = ref(false);
const detail = ref<VehicleMaintenanceRecord | null>(null);
const detailAttachments = computed(() => parseAttachments(detail.value?.attachments_json ?? null));

const openDetail = async (row: VehicleMaintenanceRecord) => {
  const res = await getMaintenanceRecord(row.id);
  detail.value = res.data;
  drawerVisible.value = true;
};

const downloadAttachment = (att: MaintenanceAttachment) => {
  const url = resolveUploadUrl(`/api/v1/upload/object/${encodeURIComponent(att.file_key)}`);
  window.open(url, "_blank", "noopener,noreferrer");
};

onMounted(async () => {
  await Promise.all([loadVehicles(), loadTypes()]);
  await loadRecords();
});
</script>

<template>
  <el-card shadow="never" :loading="loading">
    <template #header>
      <div style="display: flex; justify-content: space-between; align-items: center">
        <span>车辆保养记录</span>
        <el-button type="primary" @click="openCreate">新增保养记录</el-button>
      </div>
    </template>

    <el-form inline>
      <el-form-item label="车辆">
        <el-select
          v-model="filters.vehicle_id"
          clearable
          filterable
          placeholder="全部车辆"
          style="width: 200px"
          @change="onSearch"
        >
          <el-option
            v-for="v in vehicles"
            :key="v.id"
            :label="v.current_plate_no"
            :value="v.id"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="保养类型">
        <el-select
          v-model="filters.maintenance_type"
          clearable
          placeholder="全部类型"
          style="width: 160px"
          @change="onSearch"
        >
          <el-option
            v-for="t in maintenanceTypes"
            :key="t.dict_value"
            :label="t.dict_label"
            :value="t.dict_value"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="状态">
        <el-select
          v-model="filters.status"
          clearable
          placeholder="全部"
          style="width: 120px"
          @change="onSearch"
        >
          <el-option label="有效" value="active" />
          <el-option label="已作废" value="voided" />
        </el-select>
      </el-form-item>
      <el-form-item label="保养日期">
        <el-date-picker
          v-model="filters.date_from"
          type="date"
          value-format="YYYY-MM-DD"
          placeholder="起"
          style="width: 150px"
          @change="onSearch"
        />
        <span style="margin: 0 6px">至</span>
        <el-date-picker
          v-model="filters.date_to"
          type="date"
          value-format="YYYY-MM-DD"
          placeholder="止"
          style="width: 150px"
          @change="onSearch"
        />
      </el-form-item>
    </el-form>

    <el-table :data="records" style="margin-top: 12px">
      <el-table-column prop="record_no" label="保养单号" min-width="150" />
      <el-table-column label="车辆" width="120">
        <template #default="scope">{{ vehicleLabel(scope.row) }}</template>
      </el-table-column>
      <el-table-column label="类型" width="110">
        <template #default="scope">{{ typeLabel(scope.row.maintenance_type) }}</template>
      </el-table-column>
      <el-table-column prop="mileage_km" label="里程(km)" width="110" />
      <el-table-column prop="cost" label="费用(元)" width="110" />
      <el-table-column prop="serviced_at" label="保养时间" width="120">
        <template #default="scope">{{ scope.row.serviced_at?.slice(0, 10) }}</template>
      </el-table-column>
      <el-table-column prop="created_by_userid" label="登记人" width="120" />
      <el-table-column label="状态" width="90">
        <template #default="scope">
          <el-tag :type="scope.row.status === 'active' ? 'success' : 'info'">
            {{ statusLabel(scope.row.status) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="200" fixed="right">
        <template #default="scope">
          <el-button link type="primary" @click="openDetail(scope.row)">详情</el-button>
          <el-button
            v-if="canManage && scope.row.status === 'active'"
            link
            type="primary"
            @click="openEdit(scope.row)"
          >
            编辑
          </el-button>
          <el-popconfirm
            v-if="canManage && scope.row.status === 'active'"
            title="确认作废该记录？"
            @confirm="voidRecord(scope.row)"
          >
            <template #reference>
              <el-button link type="danger">作废</el-button>
            </template>
          </el-popconfirm>
        </template>
      </el-table-column>
    </el-table>

    <el-pagination
      style="margin-top: 12px; justify-content: flex-end"
      layout="total, prev, pager, next"
      :total="pagination.total"
      :page-size="pagination.pageSize"
      :current-page="pagination.page"
      @current-change="onPageChange"
    />
  </el-card>

  <!-- 新增/编辑对话框 -->
  <el-dialog
    v-model="dialogVisible"
    :title="editingId ? '编辑保养记录' : '新增保养记录'"
    width="640px"
  >
    <el-form label-width="90px">
      <el-form-item label="车辆" required>
        <el-select v-model="form.vehicle_id" filterable placeholder="请选择车辆" style="width: 100%">
          <el-option v-for="v in vehicles" :key="v.id" :label="v.current_plate_no" :value="v.id" />
        </el-select>
      </el-form-item>
      <el-form-item label="保养类型" required>
        <el-select v-model="form.maintenance_type" placeholder="请选择类型" style="width: 100%">
          <el-option
            v-for="t in maintenanceTypes"
            :key="t.dict_value"
            :label="t.dict_label"
            :value="t.dict_value"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="保养内容" required>
        <el-input v-model="form.content" type="textarea" :rows="3" placeholder="保养/维修内容" />
      </el-form-item>
      <el-form-item label="里程(km)" required>
        <el-input-number v-model="form.mileage_km" :min="0" :controls="false" style="width: 100%" />
      </el-form-item>
      <el-form-item label="保养人">
        <el-input v-model="form.service_provider" placeholder="修理厂/4S店/保养人姓名" />
      </el-form-item>
      <el-form-item label="费用(元)">
        <el-input-number v-model="form.cost" :min="0" :controls="false" style="width: 100%" />
      </el-form-item>
      <el-form-item label="保养时间">
        <el-date-picker
          v-model="form.serviced_at"
          type="date"
          value-format="YYYY-MM-DD"
          placeholder="默认今天"
          style="width: 100%"
        />
      </el-form-item>
      <el-form-item label="备注">
        <el-input v-model="form.remark" placeholder="可选" />
      </el-form-item>
      <el-form-item label="附件">
        <el-upload :http-request="uploadAttachment" :show-file-list="false" multiple>
          <el-button>上传附件</el-button>
        </el-upload>
        <div style="width: 100%; margin-top: 8px">
          <div
            v-for="(att, index) in form.attachments"
            :key="att.file_key"
            style="display: flex; align-items: center; gap: 8px"
          >
            <span>{{ att.file_name }}</span>
            <el-button link type="danger" @click="removeFormAttachment(index)">移除</el-button>
          </div>
        </div>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="dialogVisible = false">取消</el-button>
      <el-button type="primary" :loading="submitting" @click="submitForm">保存</el-button>
    </template>
  </el-dialog>

  <!-- 详情抽屉 -->
  <el-drawer v-model="drawerVisible" title="保养记录详情" size="420px">
    <template v-if="detail">
      <el-descriptions :column="1" border>
        <el-descriptions-item label="保养单号">{{ detail.record_no }}</el-descriptions-item>
        <el-descriptions-item label="车辆">
          {{ detail.current_plate_no || `车辆#${detail.vehicle_id}` }}
        </el-descriptions-item>
        <el-descriptions-item label="类型">{{ typeLabel(detail.maintenance_type) }}</el-descriptions-item>
        <el-descriptions-item label="里程(km)">{{ detail.mileage_km }}</el-descriptions-item>
        <el-descriptions-item label="保养人">{{ detail.service_provider || "-" }}</el-descriptions-item>
        <el-descriptions-item label="费用(元)">{{ detail.cost ?? "-" }}</el-descriptions-item>
        <el-descriptions-item label="保养时间">{{ detail.serviced_at?.slice(0, 10) }}</el-descriptions-item>
        <el-descriptions-item label="登记人">{{ detail.created_by_userid }}</el-descriptions-item>
        <el-descriptions-item label="状态">{{ statusLabel(detail.status) }}</el-descriptions-item>
        <el-descriptions-item label="内容">{{ detail.content }}</el-descriptions-item>
        <el-descriptions-item label="备注">{{ detail.remark || "-" }}</el-descriptions-item>
      </el-descriptions>
      <div style="margin-top: 16px">
        <div style="font-weight: 600; margin-bottom: 8px">附件</div>
        <el-empty v-if="detailAttachments.length === 0" description="无附件" :image-size="60" />
        <div
          v-for="att in detailAttachments"
          :key="att.file_key"
          style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px"
        >
          <span>{{ att.file_name }}</span>
          <el-button link type="primary" @click="downloadAttachment(att)">下载</el-button>
        </div>
      </div>
    </template>
  </el-drawer>
</template>
```

- [ ] **Step 3: 类型检查**

Run: `cd packages/web && npm run typecheck`
Expected: 无错误（exit 0）。如报 `ep/tools` 图标不存在，改用 `ep/setting`。

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/router/modules/vehicle-maintenance.ts packages/web/src/views/vehicle-maintenance/index.vue
git commit -m "feat(maintenance): 新增 Web 车辆保养记录页面与菜单"
```

---

## Task 6: 小程序页面

**Files:**
- Create: `packages/miniapp/pages/vehicle-maintenance/index.js`
- Create: `packages/miniapp/pages/vehicle-maintenance/index.wxml`
- Create: `packages/miniapp/pages/vehicle-maintenance/index.wxss`
- Create: `packages/miniapp/pages/vehicle-maintenance/index.json`
- Modify: `packages/miniapp/app.json`（注册页面）
- Modify: `packages/miniapp/pages/finance/index.js`（`applyActions` 加入口卡片）

- [ ] **Step 1: 写页面 JS**

创建 `packages/miniapp/pages/vehicle-maintenance/index.js`：

```js
const { request } = require("../../utils/request");
const { uploadFileToR2 } = require("../../utils/upload");
const { wxChooseMediaImage } = require("../../utils/wx");

const STATUS_LABELS = {
  active: "有效",
  voided: "已作废"
};

const todayStr = () => {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
};

Page({
  data: {
    loading: false,
    submitting: false,
    vehicles: [],
    vehicleLabels: ["请选择车辆"],
    vehicleIndex: 0,
    types: [],
    typeLabels: ["请选择类型"],
    typeIndex: 0,
    statusTextMap: STATUS_LABELS,
    form: {
      vehicle_id: "",
      maintenance_type: "",
      content: "",
      mileage_km: "",
      service_provider: "",
      cost: "",
      serviced_at: todayStr()
    },
    attachmentList: [],
    myRecords: []
  },

  onShow() {
    this.loadData();
  },

  async loadData() {
    if (this.data.loading) return;
    this.setData({ loading: true });
    try {
      const [vehicleRes, typeRes, myRes] = await Promise.all([
        request({ method: "GET", path: "/api/v1/fleet/vehicles?status=active" }).catch(() => null),
        request({
          method: "GET",
          path: "/api/v1/dict?dict_type=vehicle_maintenance_type"
        }).catch(() => null),
        request({
          method: "GET",
          path: "/api/v1/fleet/maintenance?mine=true&pageSize=50"
        }).catch(() => null)
      ]);

      const vehicles = vehicleRes && Array.isArray(vehicleRes.data) ? vehicleRes.data : [];
      const types = typeRes && Array.isArray(typeRes.data) ? typeRes.data : [];
      const myRecords = (myRes && Array.isArray(myRes.data) ? myRes.data : []).map((item) => ({
        ...item,
        statusLabel: STATUS_LABELS[item.status] || item.status,
        typeLabel: (types.find((t) => t.dict_value === item.maintenance_type) || {}).dict_label ||
          item.maintenance_type
      }));

      this.setData({
        vehicles,
        types,
        vehicleLabels: ["请选择车辆"].concat(
          vehicles.map((item) => `${item.current_plate_no || "-"}`)
        ),
        typeLabels: ["请选择类型"].concat(types.map((item) => item.dict_label)),
        myRecords
      });
    } finally {
      this.setData({ loading: false });
    }
  },

  onVehicleChange(e) {
    const index = Number(e.detail.value || 0);
    const vehicle = this.data.vehicles[index - 1] || null;
    this.setData({
      vehicleIndex: index,
      "form.vehicle_id": vehicle ? vehicle.id : ""
    });
  },

  onTypeChange(e) {
    const index = Number(e.detail.value || 0);
    const type = this.data.types[index - 1] || null;
    this.setData({
      typeIndex: index,
      "form.maintenance_type": type ? type.dict_value : ""
    });
  },

  onDateChange(e) {
    this.setData({ "form.serviced_at": e.detail.value });
  },

  onInput(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ [`form.${key}`]: e.detail.value });
  },

  async chooseAttachments() {
    if (this.data.submitting) return;
    try {
      const res = await wxChooseMediaImage({ count: 9 });
      const files = (res && res.tempFiles) || [];
      if (!files.length) return;
      this.setData({ submitting: true });

      const uploaded = [];
      for (const file of files) {
        const filePath = String(file.path || file.tempFilePath || file.tempPath || "");
        if (!filePath) continue;
        const fileName =
          (typeof file.name === "string" && file.name.trim()) ||
          `maintenance-${Date.now()}.jpg`;
        const result = await uploadFileToR2(filePath, {
          category: "vehicle-maintenance",
          fileName
        });
        uploaded.push({
          file_key: result.key,
          file_name: fileName || result.key,
          file_size: file.size || file.fileSize || 0
        });
      }

      if (!uploaded.length) {
        wx.showToast({ title: "未识别到可上传文件", icon: "none" });
        return;
      }
      this.setData({ attachmentList: this.data.attachmentList.concat(uploaded) });
      wx.showToast({ title: "附件上传完成", icon: "success" });
    } catch {
      wx.showToast({ title: "附件上传失败", icon: "none" });
    } finally {
      this.setData({ submitting: false });
    }
  },

  removeAttachment(e) {
    const index = Number(e.currentTarget.dataset.index);
    const next = this.data.attachmentList.slice();
    next.splice(index, 1);
    this.setData({ attachmentList: next });
  },

  resetForm() {
    this.setData({
      vehicleIndex: 0,
      typeIndex: 0,
      form: {
        vehicle_id: "",
        maintenance_type: "",
        content: "",
        mileage_km: "",
        service_provider: "",
        cost: "",
        serviced_at: todayStr()
      },
      attachmentList: []
    });
  },

  async submit() {
    if (this.data.submitting) return;
    const f = this.data.form;
    const vehicleId = Number(f.vehicle_id || 0);
    const mileage = Number(f.mileage_km || 0);

    if (!vehicleId) {
      wx.showToast({ title: "请选择车辆", icon: "none" });
      return;
    }
    if (!f.maintenance_type) {
      wx.showToast({ title: "请选择保养类型", icon: "none" });
      return;
    }
    if (!String(f.content || "").trim()) {
      wx.showToast({ title: "请填写保养内容", icon: "none" });
      return;
    }
    if (!Number.isFinite(mileage) || mileage < 0) {
      wx.showToast({ title: "请填写有效里程", icon: "none" });
      return;
    }

    this.setData({ submitting: true });
    wx.showLoading({ title: "提交中...", mask: true });
    try {
      await request({
        method: "POST",
        path: "/api/v1/fleet/maintenance",
        data: {
          vehicle_id: vehicleId,
          maintenance_type: f.maintenance_type,
          content: String(f.content).trim(),
          mileage_km: mileage,
          service_provider: String(f.service_provider || "").trim() || null,
          cost: f.cost === "" ? null : Number(f.cost),
          serviced_at: f.serviced_at || undefined,
          attachments_json: JSON.stringify(this.data.attachmentList)
        }
      });
      wx.hideLoading();
      wx.showToast({ title: "保养记录已提交", icon: "success" });
      this.resetForm();
      await this.loadData();
    } catch (error) {
      wx.hideLoading();
      wx.showToast({ title: (error && error.message) || "提交失败", icon: "none" });
    } finally {
      this.setData({ submitting: false });
    }
  }
});
```

- [ ] **Step 2: 写页面 WXML**

创建 `packages/miniapp/pages/vehicle-maintenance/index.wxml`：

```xml
<view class="page">
  <hy-panel-card title="🔧 车辆保养记录" subtitle="填写里程、保养内容、保养人、费用并上传附件">
    <view class="label required">车辆</view>
    <picker mode="selector" range="{{vehicleLabels}}" value="{{vehicleIndex}}" bindchange="onVehicleChange">
      <view class="picker-value">{{vehicleLabels[vehicleIndex]}}</view>
    </picker>

    <view class="label required">保养类型</view>
    <picker mode="selector" range="{{typeLabels}}" value="{{typeIndex}}" bindchange="onTypeChange">
      <view class="picker-value">{{typeLabels[typeIndex]}}</view>
    </picker>

    <view class="label required">保养内容</view>
    <textarea class="textarea" value="{{form.content}}" data-key="content" bindinput="onInput" placeholder="保养/维修内容" disabled="{{submitting}}" />

    <view class="label required">里程 (km)</view>
    <input class="input" type="digit" value="{{form.mileage_km}}" data-key="mileage_km" bindinput="onInput" placeholder="请输入保养时里程" disabled="{{submitting}}" />

    <view class="label">保养人</view>
    <input class="input" value="{{form.service_provider}}" data-key="service_provider" bindinput="onInput" placeholder="修理厂/4S店/保养人" disabled="{{submitting}}" />

    <view class="label">费用 (元)</view>
    <input class="input" type="digit" value="{{form.cost}}" data-key="cost" bindinput="onInput" placeholder="可选" disabled="{{submitting}}" />

    <view class="label">保养时间</view>
    <picker mode="date" value="{{form.serviced_at}}" bindchange="onDateChange">
      <view class="picker-value">{{form.serviced_at}}</view>
    </picker>

    <view class="label">附件</view>
    <view class="row">
      <t-button class="btn" variant="outline" bindtap="chooseAttachments" disabled="{{submitting}}">上传附件</t-button>
      <t-button class="btn btn-primary" theme="primary" bindtap="submit" loading="{{submitting}}" disabled="{{submitting}}">提交记录</t-button>
    </view>

    <view wx:if="{{attachmentList.length === 0}}" class="empty-tip">暂无附件</view>
    <view wx:for="{{attachmentList}}" wx:key="file_key" class="photo-item">
      <view class="photo-name">{{item.file_name}}</view>
      <view class="photo-size">{{item.file_size || 0}} bytes</view>
      <t-button class="mini-btn" size="small" variant="outline" data-index="{{index}}" bindtap="removeAttachment" disabled="{{submitting}}">移除</t-button>
    </view>
  </hy-panel-card>

  <hy-panel-card title="📒 我的保养记录" subtitle="展示我提交的保养记录">
    <view wx:if="{{myRecords.length === 0}}" class="empty-tip">暂无记录</view>
    <view wx:for="{{myRecords}}" wx:key="id" class="record-item">
      <view class="record-title">{{item.record_no}}</view>
      <view class="record-line">车辆：{{item.current_plate_no || '-'}} ｜ 类型：{{item.typeLabel}}</view>
      <view class="record-line">里程：{{item.mileage_km}} km ｜ 费用：{{item.cost || '-'}}</view>
      <view class="record-line">保养人：{{item.service_provider || '-'}}</view>
      <view class="record-line">保养时间：{{item.serviced_at}}</view>
      <view class="record-status">状态：{{item.statusLabel}}</view>
    </view>
  </hy-panel-card>
</view>
```

- [ ] **Step 3: 写页面 WXSS**

创建 `packages/miniapp/pages/vehicle-maintenance/index.wxss`：

```css
.label {
  margin-top: 18rpx;
  font-size: 26rpx;
  color: #374151;
}

.label.required::after {
  content: " *";
  color: #dc2626;
}

.input,
.textarea {
  width: 100%;
  margin-top: 8rpx;
  padding: 18rpx 20rpx;
  border: 1rpx solid #d7dbe3;
  border-radius: 12rpx;
  box-sizing: border-box;
  font-size: 28rpx;
  color: #1f2937;
  background: #fff;
}

.textarea {
  min-height: 120rpx;
}

.picker-value {
  width: 100%;
  margin-top: 8rpx;
  background: #fff;
  border: 1rpx solid #d7dbe3;
  border-radius: 12rpx;
  padding: 18rpx 20rpx;
  box-sizing: border-box;
  font-size: 28rpx;
  color: #1f2937;
}

.row {
  display: flex;
  gap: 16rpx;
  margin-top: 20rpx;
}

.btn {
  flex: 1;
}

.empty-tip {
  margin-top: 12rpx;
  color: #7b8494;
  font-size: 24rpx;
}

.photo-item,
.record-item {
  margin-top: 12rpx;
  padding: 14rpx;
  border: 1rpx solid #e5e7eb;
  border-radius: 12rpx;
  background: #fff;
}

.photo-name,
.record-title {
  color: #111827;
  font-size: 26rpx;
  word-break: break-all;
}

.photo-size,
.record-line {
  margin-top: 6rpx;
  color: #6b7280;
  font-size: 22rpx;
}

.mini-btn {
  margin-top: 8rpx;
}

.record-status {
  margin-top: 8rpx;
  font-weight: 600;
  color: #1f2937;
}
```

- [ ] **Step 4: 写页面 JSON**

创建 `packages/miniapp/pages/vehicle-maintenance/index.json`：

```json
{
  "navigationBarTitleText": "车辆保养",
  "usingComponents": {}
}
```

> 注：`hy-panel-card` 与 `t-button` 为全局组件（已在 `app.json` 的 `usingComponents` 注册，参照 `fuel-apply`）。若该项目页面级需显式声明，请对照 `pages/fuel-apply/index.json` 补齐 `usingComponents`。

- [ ] **Step 5: 在 app.json 注册页面**

在 `packages/miniapp/app.json` 的 `pages` 数组中，紧随 `"pages/fuel-apply/index",` 之后新增一行：

```json
    "pages/vehicle-maintenance/index",
```

- [ ] **Step 6: 在财务页加入口卡片**

在 `packages/miniapp/pages/finance/index.js` 的 `applyActions` 数组中（油卡额度申请条目之后），新增：

```js
      {
        title: "🔧 车辆保养记录",
        desc: "填写保养里程、内容、费用并上传附件",
        path: "/pages/vehicle-maintenance/index",
        tone: "blue",
        disabled: false
      },
```

- [ ] **Step 7: 验证小程序构建**

Run: `cd packages/miniapp && ls pages/vehicle-maintenance`
Expected: 列出 `index.js index.json index.wxml index.wxss` 四个文件。

> 进一步验证需在微信开发者工具打开 `packages/miniapp` 编译，确认"车辆保养"入口可进入、可提交。此为人工验证步骤。

- [ ] **Step 8: Commit**

```bash
git add packages/miniapp/pages/vehicle-maintenance packages/miniapp/app.json packages/miniapp/pages/finance/index.js
git commit -m "feat(maintenance): 新增小程序车辆保养记录页面与入口"
```

---

## Task 7: 文档更新

**Files:**
- Modify: `doc/开发记录.md`（追加，勿新建日志文件）
- Modify: `doc/UI设计文档.md`

- [ ] **Step 1: 追加开发记录**

在 `doc/开发记录.md` 末尾追加一段（含日期 2026-06-24），概述：新增车辆保养记录（纯台账）、新表 `vehicle_maintenance_record`、后端 `/api/v1/fleet/maintenance` 路由、Web 独立菜单"车辆保养"、小程序 `vehicle-maintenance` 页面、权限分级（全员新增、管理层管理、operator 仅见本人）。

- [ ] **Step 2: 更新 UI 设计文档**

在 `doc/UI设计文档.md` 增加"车辆保养记录"小节：Web 页面（筛选/新增对话框/列表/详情抽屉）与小程序页面（表单 + 我的记录）布局说明。

- [ ] **Step 3: Commit**

```bash
git add doc/开发记录.md doc/UI设计文档.md
git commit -m "docs(maintenance): 补充车辆保养记录开发记录与 UI 说明"
```

---

## Self-Review 结论

- **Spec 覆盖：** 里程/内容/时间/保养人/费用/附件 → Task 1 表字段 + Task 3 校验 + Task 5/6 表单；挂钩车辆 → `vehicle_id` FK + 创建时校验车辆存在；分类字典 → Task 1 播种 + Task 5/6 拉取；权限分级 → Task 2 纯函数 + Task 3 路由 `requireRoles` + Task 5 按钮 `canManage`；Web 全员可见独立菜单 → Task 5 路由 roles 含 operator；小程序录入 → Task 6；软删除 → `void` 端点；单号 → `generateSerial("BY", ...)`。
- **占位符：** 无 TBD/TODO；各步含完整代码与命令。
- **类型一致：** `MaintenanceCreateValue` / `validateMaintenanceCreateInput` / `resolveMaintenanceListScope` / `canManageMaintenance` 在 Task 2 定义、Task 3 引用一致；Web `MaintenanceCreatePayload` 字段与后端 `validateMaintenanceCreateInput` 接收字段一致；附件结构 `{file_key,file_name,file_size}` 在 Web/小程序/后端校验三处一致。

## 已知人工验证点（非自动化）

1. Web：以 operator 账号登录应只见本人记录且无编辑/作废按钮；以管理层账号应见全部并可编辑/作废。
2. 小程序：财务页"车辆保养记录"入口可进入、可提交、"我的保养记录"刷新。
3. 附件：上传后详情抽屉可下载（Web）。
