import { Hono } from "hono";

import { authMiddleware, type AuthVariables } from "../middleware/auth";
import { requireRoles } from "../middleware/rbac";
import {
  buildAssetManualReferenceHistory,
  type AssetManualReferenceHistoryRow
} from "../services/asset-manual-history";
import { collectConfigurationParticipants, emitTrackedAssetEvents } from "../services/asset-event";
import {
  buildTbmCompositionCandidate,
  inferTbmComponentRole,
  type TbmCompositionAssetInput,
  type TbmCompatibilityRuleInput
} from "../services/asset-composition";
import { generateSerial } from "../services/serial";
import { createWarehouseTask } from "../services/warehouse-task";
import type { Env } from "../types/env";
import type {
  AssetCompatibilityRule,
  AssetRentalTerm,
  AssetType,
  CreateAssetCompatibilityRuleRequest,
  CreateAssetRentalTermRequest,
  CreateTrackedAssetConfigurationRequest,
  CreateTrackedAssetConfigurationTaskPackageRequest,
  CreateAssetTypeRequest,
  CreateTrackedAssetRequest,
  ReturnAssetRentalTermRequest,
  TrackedAssetConfiguration,
  TrackedAsset,
  TrackedAssetDocument,
  TrackedAssetEvent,
  UpdateAssetCompatibilityRuleRequest,
  UpdateTrackedAssetConfigurationRequest,
  UpdateAssetTypeRequest,
  UpdateTrackedAssetRequest
} from "../types/asset";
import type { WarehouseAssetWorkOrder, WarehouseTaskEvidence } from "../types/work-order";

const nowIso = () => new Date().toISOString();
const todayIso = () => new Date().toISOString().slice(0, 10);
const CONFIGURATION_STATUSES = new Set([
  "planned",
  "assembling",
  "active",
  "disassembling",
  "closed"
]);
const COMPATIBILITY_RELATIONS = new Set(["shell_core", "core_console"]);
const DISPATCH_BLOCKED_ASSET_STATUSES = new Set([
  "quarantine",
  "returned_quarantine",
  "inspection",
  "maintenance",
  "servicing",
  "modification",
  "scrapped"
]);

const ensureJsonText = (value?: string): string | null => {
  if (!value || !value.trim()) return null;
  JSON.parse(value);
  return value;
};

const ensureCompatibilityRelation = (value: string): "shell_core" | "core_console" => {
  if (!COMPATIBILITY_RELATIONS.has(value)) {
    throw new Error("relation_type must be shell_core or core_console");
  }
  return value as "shell_core" | "core_console";
};

const ensureConfigurationStatus = (value?: string): TrackedAssetConfiguration["status"] => {
  const next = value ?? "planned";
  if (!CONFIGURATION_STATUSES.has(next)) {
    throw new Error("status must be planned/assembling/active/disassembling/closed");
  }
  return next as TrackedAssetConfiguration["status"];
};

const generateAssetCode = async (db: D1Database, typeCode: string): Promise<string> => {
  const prefix = `HY-${typeCode.toUpperCase()}-`;
  const row = await db
    .prepare("SELECT IFNULL(COUNT(*), 0) as cnt FROM tracked_asset WHERE asset_code LIKE ?")
    .bind(`${prefix}%`)
    .first<{ cnt: number }>();
  const seq = (row?.cnt ?? 0) + 1;
  return `${prefix}${String(seq).padStart(4, "0")}`;
};

const generateConfigurationCode = async (db: D1Database): Promise<string> => {
  return generateSerial(db, "CFG", "tracked_asset_configuration", "configuration_code");
};

const generateTaskPackageNo = async (db: D1Database): Promise<string> => {
  return generateSerial(db, "TP", "warehouse_task_package", "package_no");
};

type DispatchBoardState =
  | "available_now"
  | "available_after_modification"
  | "blocked"
  | "reserved"
  | "in_transit"
  | "on_project"
  | "scrapped";

const countBy = <T>(items: T[], keyFn: (item: T) => string | number) => {
  const map = new Map<string | number, number>();
  for (const item of items) {
    const key = keyFn(item);
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return map;
};

const emitConfigurationTimelineEvent = async (
  db: D1Database,
  payload: {
    shell_asset_id?: number | null;
    core_asset_id?: number | null;
    console_asset_id?: number | null;
    configuration_code: string;
    whole_machine_code?: string | null;
    status: TrackedAssetConfiguration["status"];
    project_id?: number | null;
    warehouse_id?: number | null;
    note?: string | null;
  },
  operatorUserid: string,
  eventType: "configuration_created" | "configuration_updated",
  previousStatus?: string | null
) => {
  const participants = collectConfigurationParticipants(payload);
  if (participants.length === 0) return;
  const eventTime = nowIso();
  await emitTrackedAssetEvents(
    db,
    participants.map((participant) => ({
      tracked_asset_id: participant.tracked_asset_id,
      event_type: eventType,
      event_time: eventTime,
      operator_userid: operatorUserid,
      project_id: payload.project_id ?? null,
      warehouse_id: payload.warehouse_id ?? null,
      detail:
        `configuration_code=${payload.configuration_code}; role=${participant.role}; status=${payload.status}` +
        `${payload.whole_machine_code ? `; whole_machine_code=${payload.whole_machine_code}` : ""}` +
        `${previousStatus ? `; previous_status=${previousStatus}` : ""}` +
        `${payload.note ? `; note=${payload.note}` : ""}`
    }))
  );
};

const validateTrackedAssetIds = async (
  db: D1Database,
  ids: Array<number | null | undefined>
): Promise<Map<number, TrackedAsset>> => {
  const validIds = [
    ...new Set(ids.filter((id): id is number => typeof id === "number" && Number.isFinite(id)))
  ];
  const map = new Map<number, TrackedAsset>();
  for (const id of validIds) {
    const asset = await db
      .prepare("SELECT * FROM tracked_asset WHERE id = ?")
      .bind(id)
      .first<TrackedAsset>();
    if (!asset) {
      throw new Error(`tracked asset not found: ${id}`);
    }
    map.set(id, asset);
  }
  return map;
};

const ensureNoActiveConfigurationConflict = async (
  db: D1Database,
  payload: {
    id?: number;
    shell_asset_id?: number | null;
    core_asset_id?: number | null;
    console_asset_id?: number | null;
    status: TrackedAssetConfiguration["status"];
  }
) => {
  if (payload.status !== "active") return;
  const checks = [
    { field: "shell_asset_id", value: payload.shell_asset_id },
    { field: "core_asset_id", value: payload.core_asset_id },
    { field: "console_asset_id", value: payload.console_asset_id }
  ];
  for (const check of checks) {
    if (!check.value) continue;
    const row = await db
      .prepare(
        `SELECT id FROM tracked_asset_configuration
         WHERE status = 'active' AND ${check.field} = ? AND (? IS NULL OR id != ?)
         LIMIT 1`
      )
      .bind(check.value, payload.id ?? null, payload.id ?? null)
      .first<{ id: number }>();
    if (row) {
      throw new Error(`${check.field} already belongs to another active configuration`);
    }
  }
};

export const assetRoutes = new Hono<{
  Bindings: Env;
  Variables: AuthVariables;
}>();

assetRoutes.use("*", authMiddleware);

assetRoutes.get(
  "/type",
  requireRoles(["super_admin", "manager", "site_manager", "operator"]),
  async (c) => {
    const keyword = c.req.query("keyword");
    const trackedFlag = c.req.query("tracked_flag");
    let sql = "SELECT * FROM asset_type WHERE status != 'deleted'";
    const params: (string | number)[] = [];

    if (trackedFlag) {
      sql += " AND tracked_flag = ?";
      params.push(Number(trackedFlag));
    }
    if (keyword) {
      sql += " AND (type_code LIKE ? OR type_name LIKE ?)";
      params.push(`%${keyword}%`, `%${keyword}%`);
    }
    sql += " ORDER BY id DESC";

    const rows = await c.env.DB.prepare(sql)
      .bind(...params)
      .all<AssetType>();
    return c.json({ success: true, data: rows.results ?? [] });
  }
);

assetRoutes.post("/type", requireRoles(["super_admin", "manager"]), async (c) => {
  const body = (await c.req.json()) as CreateAssetTypeRequest;
  if (!body.type_code?.trim() || !body.type_name?.trim()) {
    return c.json(
      { success: false, error: { message: "type_code and type_name are required" } },
      400
    );
  }

  let propertySchema: string | null = null;
  try {
    propertySchema = ensureJsonText(body.property_schema);
  } catch {
    return c.json(
      { success: false, error: { message: "property_schema must be valid JSON" } },
      400
    );
  }

  const now = nowIso();
  const result = await c.env.DB.prepare(
    `INSERT INTO asset_type
        (type_code, type_name, tracked_flag, unit, property_schema, min_stock, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`
  )
    .bind(
      body.type_code.trim().toUpperCase(),
      body.type_name.trim(),
      body.tracked_flag ? 1 : 0,
      body.unit?.trim() || "件",
      propertySchema,
      body.min_stock ?? null,
      now,
      now
    )
    .run();

  return c.json({ success: true, data: { id: result.meta.last_row_id } }, 201);
});

assetRoutes.put("/type/:id", requireRoles(["super_admin", "manager"]), async (c) => {
  const id = Number(c.req.param("id"));
  const body = (await c.req.json()) as UpdateAssetTypeRequest;

  let propertySchema: string | null = null;
  try {
    propertySchema =
      body.property_schema === undefined ? null : ensureJsonText(body.property_schema);
  } catch {
    return c.json(
      { success: false, error: { message: "property_schema must be valid JSON" } },
      400
    );
  }

  await c.env.DB.prepare(
    `UPDATE asset_type SET
         type_name = COALESCE(?, type_name),
         tracked_flag = COALESCE(?, tracked_flag),
         unit = COALESCE(?, unit),
         property_schema = CASE WHEN ? IS NULL THEN property_schema ELSE ? END,
         min_stock = COALESCE(?, min_stock),
         status = COALESCE(?, status),
         updated_at = ?
       WHERE id = ?`
  )
    .bind(
      body.type_name ?? null,
      body.tracked_flag === undefined ? null : body.tracked_flag ? 1 : 0,
      body.unit ?? null,
      body.property_schema === undefined ? null : propertySchema,
      propertySchema,
      body.min_stock ?? null,
      body.status ?? null,
      nowIso(),
      id
    )
    .run();

  return c.json({ success: true });
});

assetRoutes.delete("/type/:id", requireRoles(["super_admin", "manager"]), async (c) => {
  const id = Number(c.req.param("id"));
  await c.env.DB.prepare("UPDATE asset_type SET status = 'deleted', updated_at = ? WHERE id = ?")
    .bind(nowIso(), id)
    .run();
  return c.json({ success: true });
});

assetRoutes.get(
  "/compatibility",
  requireRoles(["super_admin", "manager", "site_manager", "operator"]),
  async (c) => {
    const relationType = c.req.query("relation_type");
    const assetTypeId = c.req.query("asset_type_id");
    let sql = "SELECT * FROM asset_compatibility_rule WHERE status != 'deleted'";
    const params: Array<string | number> = [];

    if (relationType) {
      sql += " AND relation_type = ?";
      params.push(relationType);
    }
    if (assetTypeId) {
      sql += " AND (left_asset_type_id = ? OR right_asset_type_id = ?)";
      params.push(Number(assetTypeId), Number(assetTypeId));
    }
    sql += " ORDER BY id DESC";

    const rows = await c.env.DB.prepare(sql)
      .bind(...params)
      .all<AssetCompatibilityRule>();
    return c.json({ success: true, data: rows.results ?? [] });
  }
);

assetRoutes.post("/compatibility", requireRoles(["super_admin", "manager"]), async (c) => {
  const body = (await c.req.json()) as CreateAssetCompatibilityRuleRequest;
  if (!body.left_asset_type_id || !body.right_asset_type_id || !body.relation_type) {
    return c.json(
      {
        success: false,
        error: { message: "left_asset_type_id, right_asset_type_id and relation_type are required" }
      },
      400
    );
  }

  let relationType: AssetCompatibilityRule["relation_type"];
  try {
    relationType = ensureCompatibilityRelation(body.relation_type);
  } catch (error) {
    return c.json({ success: false, error: { message: (error as Error).message } }, 400);
  }

  const now = nowIso();
  const result = await c.env.DB.prepare(
    `INSERT INTO asset_compatibility_rule
        (left_asset_type_id, right_asset_type_id, relation_type, status, note, created_at, updated_at)
       VALUES (?, ?, ?, 'active', ?, ?, ?)`
  )
    .bind(
      body.left_asset_type_id,
      body.right_asset_type_id,
      relationType,
      body.note ?? null,
      now,
      now
    )
    .run();

  return c.json({ success: true, data: { id: result.meta.last_row_id } }, 201);
});

assetRoutes.put("/compatibility/:id", requireRoles(["super_admin", "manager"]), async (c) => {
  const id = Number(c.req.param("id"));
  const body = (await c.req.json()) as UpdateAssetCompatibilityRuleRequest;
  await c.env.DB.prepare(
    `UPDATE asset_compatibility_rule SET
         status = COALESCE(?, status),
         note = COALESCE(?, note),
         updated_at = ?
       WHERE id = ?`
  )
    .bind(body.status ?? null, body.note ?? null, nowIso(), id)
    .run();
  return c.json({ success: true });
});

assetRoutes.get(
  "/configuration",
  requireRoles(["super_admin", "manager", "site_manager", "operator"]),
  async (c) => {
    const status = c.req.query("status");
    const assetId = c.req.query("tracked_asset_id");
    const wholeMachineCode = c.req.query("whole_machine_code");
    let sql = "SELECT * FROM tracked_asset_configuration WHERE 1=1";
    const params: Array<string | number> = [];
    if (status) {
      sql += " AND status = ?";
      params.push(status);
    }
    if (assetId) {
      sql += " AND (shell_asset_id = ? OR core_asset_id = ? OR console_asset_id = ?)";
      params.push(Number(assetId), Number(assetId), Number(assetId));
    }
    if (wholeMachineCode) {
      sql += " AND whole_machine_code = ?";
      params.push(wholeMachineCode);
    }
    sql += " ORDER BY id DESC";

    const rows = await c.env.DB.prepare(sql)
      .bind(...params)
      .all<TrackedAssetConfiguration>();
    return c.json({ success: true, data: rows.results ?? [] });
  }
);

assetRoutes.get(
  "/configuration/candidate",
  requireRoles(["super_admin", "manager", "site_manager", "operator"]),
  async (c) => {
    const coreAssetId = Number(c.req.query("core_asset_id"));
    if (!coreAssetId) {
      return c.json({ success: false, error: { message: "core_asset_id is required" } }, 400);
    }

    const core = await c.env.DB.prepare(
      `SELECT ta.*,
              at.type_code AS asset_type_code,
              at.type_name AS asset_type_name
       FROM tracked_asset ta
       JOIN asset_type at ON at.id = ta.asset_type_id
       WHERE ta.id = ?`
    )
      .bind(coreAssetId)
      .first<TrackedAsset & { asset_type_code: string | null; asset_type_name: string | null }>();
    if (!core) {
      return c.json({ success: false, error: { message: "core asset not found" } }, 404);
    }

    const assetRows = await c.env.DB.prepare(
      `SELECT ta.*,
              at.type_code AS asset_type_code,
              at.type_name AS asset_type_name
       FROM tracked_asset ta
       JOIN asset_type at ON at.id = ta.asset_type_id
       WHERE ta.id != ?
       ORDER BY ta.id DESC`
    )
      .bind(coreAssetId)
      .all<TrackedAsset & { asset_type_code: string | null; asset_type_name: string | null }>();

    const rules = await c.env.DB.prepare(
      "SELECT left_asset_type_id, right_asset_type_id, relation_type FROM asset_compatibility_rule WHERE status = 'active'"
    ).all<TbmCompatibilityRuleInput>();
    const selectedCore: TbmCompositionAssetInput = {
      id: core.id,
      asset_code: core.asset_code,
      asset_name: core.asset_name,
      asset_type_id: core.asset_type_id,
      asset_type_code: core.asset_type_code,
      asset_type_name: core.asset_type_name,
      status: core.status,
      current_warehouse_id: core.current_warehouse_id
    };

    const candidates = (assetRows.results ?? [])
      .map((asset) => {
        const role = inferTbmComponentRole(asset);
        if (role !== "shell" && role !== "console") return null;
        return buildTbmCompositionCandidate({
          candidate: {
            id: asset.id,
            asset_code: asset.asset_code,
            asset_name: asset.asset_name,
            asset_type_id: asset.asset_type_id,
            asset_type_code: asset.asset_type_code,
            asset_type_name: asset.asset_type_name,
            status: asset.status,
            current_warehouse_id: asset.current_warehouse_id
          },
          selectedCore,
          role,
          compatibilityRules: rules.results ?? []
        });
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item));

    return c.json({
      success: true,
      data: {
        core: selectedCore,
        shells: candidates.filter((item) => item.role === "shell"),
        consoles: candidates.filter((item) => item.role === "console")
      }
    });
  }
);

assetRoutes.post(
  "/configuration",
  requireRoles(["super_admin", "manager", "site_manager"]),
  async (c) => {
    const auth = c.get("auth");
    const body = (await c.req.json()) as CreateTrackedAssetConfigurationRequest;
    let status: TrackedAssetConfiguration["status"];
    try {
      status = ensureConfigurationStatus(body.status);
      await validateTrackedAssetIds(c.env.DB, [
        body.shell_asset_id,
        body.core_asset_id,
        body.console_asset_id
      ]);
      await ensureNoActiveConfigurationConflict(c.env.DB, {
        shell_asset_id: body.shell_asset_id ?? null,
        core_asset_id: body.core_asset_id ?? null,
        console_asset_id: body.console_asset_id ?? null,
        status
      });
    } catch (error) {
      return c.json({ success: false, error: { message: (error as Error).message } }, 400);
    }

    const now = nowIso();
    const configurationCode = await generateConfigurationCode(c.env.DB);
    const result = await c.env.DB.prepare(
      `INSERT INTO tracked_asset_configuration
        (configuration_code, whole_machine_code, shell_asset_id, core_asset_id, console_asset_id,
         status, project_id, warehouse_id, effective_from, effective_to, note, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        configurationCode,
        body.whole_machine_code ?? null,
        body.shell_asset_id ?? null,
        body.core_asset_id ?? null,
        body.console_asset_id ?? null,
        status,
        body.project_id ?? null,
        body.warehouse_id ?? null,
        body.effective_from ?? null,
        body.effective_to ?? null,
        body.note ?? null,
        auth.sub,
        now,
        now
      )
      .run();

    await emitConfigurationTimelineEvent(
      c.env.DB,
      {
        configuration_code: configurationCode,
        whole_machine_code: body.whole_machine_code ?? null,
        shell_asset_id: body.shell_asset_id ?? null,
        core_asset_id: body.core_asset_id ?? null,
        console_asset_id: body.console_asset_id ?? null,
        status,
        project_id: body.project_id ?? null,
        warehouse_id: body.warehouse_id ?? null,
        note: body.note ?? null
      },
      auth.sub,
      "configuration_created"
    );

    return c.json(
      {
        success: true,
        data: { id: result.meta.last_row_id, configuration_code: configurationCode }
      },
      201
    );
  }
);

assetRoutes.put(
  "/configuration/:id",
  requireRoles(["super_admin", "manager", "site_manager"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const body = (await c.req.json()) as UpdateTrackedAssetConfigurationRequest;
    const existing = await c.env.DB.prepare(
      "SELECT * FROM tracked_asset_configuration WHERE id = ?"
    )
      .bind(id)
      .first<TrackedAssetConfiguration>();
    if (!existing) {
      return c.json({ success: false, error: { message: "configuration not found" } }, 404);
    }

    let status: TrackedAssetConfiguration["status"];
    try {
      status = ensureConfigurationStatus(body.status ?? existing.status);
      await validateTrackedAssetIds(c.env.DB, [
        body.shell_asset_id,
        body.core_asset_id,
        body.console_asset_id
      ]);
      await ensureNoActiveConfigurationConflict(c.env.DB, {
        id,
        shell_asset_id:
          body.shell_asset_id === undefined ? existing.shell_asset_id : body.shell_asset_id,
        core_asset_id:
          body.core_asset_id === undefined ? existing.core_asset_id : body.core_asset_id,
        console_asset_id:
          body.console_asset_id === undefined ? existing.console_asset_id : body.console_asset_id,
        status
      });
    } catch (error) {
      return c.json({ success: false, error: { message: (error as Error).message } }, 400);
    }

    await c.env.DB.prepare(
      `UPDATE tracked_asset_configuration SET
         whole_machine_code = COALESCE(?, whole_machine_code),
         shell_asset_id = CASE WHEN ? IS NULL THEN shell_asset_id ELSE ? END,
         core_asset_id = CASE WHEN ? IS NULL THEN core_asset_id ELSE ? END,
         console_asset_id = CASE WHEN ? IS NULL THEN console_asset_id ELSE ? END,
         status = ?,
         project_id = CASE WHEN ? IS NULL THEN project_id ELSE ? END,
         warehouse_id = CASE WHEN ? IS NULL THEN warehouse_id ELSE ? END,
         effective_from = CASE WHEN ? IS NULL THEN effective_from ELSE ? END,
         effective_to = CASE WHEN ? IS NULL THEN effective_to ELSE ? END,
         note = CASE WHEN ? IS NULL THEN note ELSE ? END,
         updated_at = ?
       WHERE id = ?`
    )
      .bind(
        body.whole_machine_code ?? null,
        body.shell_asset_id === undefined ? null : body.shell_asset_id,
        body.shell_asset_id ?? null,
        body.core_asset_id === undefined ? null : body.core_asset_id,
        body.core_asset_id ?? null,
        body.console_asset_id === undefined ? null : body.console_asset_id,
        body.console_asset_id ?? null,
        status,
        body.project_id === undefined ? null : body.project_id,
        body.project_id ?? null,
        body.warehouse_id === undefined ? null : body.warehouse_id,
        body.warehouse_id ?? null,
        body.effective_from === undefined ? null : body.effective_from,
        body.effective_from ?? null,
        body.effective_to === undefined ? null : body.effective_to,
        body.effective_to ?? null,
        body.note === undefined ? null : body.note,
        body.note ?? null,
        nowIso(),
        id
      )
      .run();

    await emitConfigurationTimelineEvent(
      c.env.DB,
      {
        configuration_code: existing.configuration_code,
        whole_machine_code: body.whole_machine_code ?? existing.whole_machine_code,
        shell_asset_id:
          body.shell_asset_id === undefined ? existing.shell_asset_id : body.shell_asset_id,
        core_asset_id:
          body.core_asset_id === undefined ? existing.core_asset_id : body.core_asset_id,
        console_asset_id:
          body.console_asset_id === undefined ? existing.console_asset_id : body.console_asset_id,
        status,
        project_id: body.project_id === undefined ? existing.project_id : body.project_id,
        warehouse_id: body.warehouse_id === undefined ? existing.warehouse_id : body.warehouse_id,
        note: body.note === undefined ? existing.note : body.note
      },
      c.get("auth").sub,
      "configuration_updated",
      existing.status
    );

    return c.json({ success: true });
  }
);

assetRoutes.post(
  "/configuration/:id/task-package",
  requireRoles(["super_admin", "manager", "site_manager"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const auth = c.get("auth");
    const body = (await c.req
      .json()
      .catch(() => ({}))) as CreateTrackedAssetConfigurationTaskPackageRequest;
    const configuration = await c.env.DB.prepare(
      "SELECT * FROM tracked_asset_configuration WHERE id = ?"
    )
      .bind(id)
      .first<TrackedAssetConfiguration>();
    if (!configuration) {
      return c.json({ success: false, error: { message: "configuration not found" } }, 404);
    }

    const packageNo = await generateTaskPackageNo(c.env.DB);
    const now = nowIso();
    const title = `顶管机组合任务：${configuration.whole_machine_code || configuration.configuration_code}`;
    const packageResult = await c.env.DB.prepare(
      `INSERT INTO warehouse_task_package
        (package_no, package_title, package_type, warehouse_id, project_id, priority, status,
         assignee_userid, assigned_by_userid, planned_start_date, due_date, source,
         source_biz_type, source_biz_id, remark, created_at, updated_at)
       VALUES (?, ?, 'tbm_composition', ?, ?, 'high', 'open', ?, ?, NULL, ?, 'manual',
               'tracked_asset_configuration', ?, ?, ?, ?)`
    )
      .bind(
        packageNo,
        title,
        configuration.warehouse_id ?? null,
        configuration.project_id ?? null,
        body.assignee_userid ?? null,
        auth.sub,
        body.scheduled_date ?? null,
        configuration.id,
        "组合方案生成任务包：检查组件状态，必要时完成改装并提交照片简报。",
        now,
        now
      )
      .run();

    const packageId = packageResult.meta.last_row_id as number;
    const taskContext = {
      tracked_asset_configuration_id: configuration.id,
      project_id: configuration.project_id ?? undefined,
      warehouse_id: configuration.warehouse_id ?? undefined,
      package_id: packageId,
      assignee_userid: body.assignee_userid ?? undefined,
      scheduled_date: body.scheduled_date ?? undefined,
      manual_version_id: body.manual_version_id ?? undefined,
      mobile_enabled: 1,
      required_photo_count: 3,
      applicant_userid: auth.sub
    };

    const inspectionTask = await createWarehouseTask(c.env, {
      ...taskContext,
      work_order_type: "inspection",
      source: "manual",
      priority: "high",
      status: body.assignee_userid ? "assigned" : "pending_assignment",
      blocking_flag: 1,
      remark: "顶管机组合前检查：核对壳体、机芯、操作台状态并提交照片与检查简报。"
    });
    const modificationTask = await createWarehouseTask(c.env, {
      ...taskContext,
      work_order_type: "modification",
      source: "manual",
      priority: "high",
      status: body.assignee_userid ? "assigned" : "pending_assignment",
      blocking_flag: 1,
      remark: "顶管机组合改装：按组合方案完成组件搭配、改装确认和照片简报。"
    });

    return c.json(
      {
        success: true,
        data: {
          package_id: packageId,
          package_no: packageNo,
          task_ids: [inspectionTask.id, modificationTask.id],
          work_order_nos: [inspectionTask.work_order_no, modificationTask.work_order_no]
        }
      },
      201
    );
  }
);

assetRoutes.get(
  "/",
  requireRoles(["super_admin", "manager", "site_manager", "operator"]),
  async (c) => {
    const assetTypeId = c.req.query("asset_type_id");
    const status = c.req.query("status");
    const projectId = c.req.query("project_id");
    const warehouseId = c.req.query("warehouse_id");
    const ownershipType = c.req.query("ownership_type");
    const keyword = c.req.query("keyword");
    const page = Number(c.req.query("page") ?? "1");
    const pageSize = Number(c.req.query("pageSize") ?? "20");
    const offset = (page - 1) * pageSize;

    let sql = "SELECT * FROM tracked_asset WHERE 1=1";
    let countSql = "SELECT COUNT(*) as total FROM tracked_asset WHERE 1=1";
    const params: (string | number)[] = [];

    if (assetTypeId) {
      sql += " AND asset_type_id = ?";
      countSql += " AND asset_type_id = ?";
      params.push(Number(assetTypeId));
    }
    if (status) {
      sql += " AND status = ?";
      countSql += " AND status = ?";
      params.push(status);
    }
    if (projectId) {
      sql += " AND current_project_id = ?";
      countSql += " AND current_project_id = ?";
      params.push(Number(projectId));
    }
    if (warehouseId) {
      sql += " AND current_warehouse_id = ?";
      countSql += " AND current_warehouse_id = ?";
      params.push(Number(warehouseId));
    }
    if (ownershipType) {
      sql += " AND ownership_type = ?";
      countSql += " AND ownership_type = ?";
      params.push(ownershipType);
    }
    if (keyword) {
      sql += " AND (asset_code LIKE ? OR asset_name LIKE ? OR IFNULL(serial_no, '') LIKE ?)";
      countSql += " AND (asset_code LIKE ? OR asset_name LIKE ? OR IFNULL(serial_no, '') LIKE ?)";
      params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
    }

    sql += " ORDER BY id DESC LIMIT ? OFFSET ?";

    const totalRow = await c.env.DB.prepare(countSql)
      .bind(...params)
      .first<{ total: number }>();
    const rows = await c.env.DB.prepare(sql)
      .bind(...params, pageSize, offset)
      .all<TrackedAsset>();

    return c.json({
      success: true,
      data: rows.results ?? [],
      pagination: { page, pageSize, total: totalRow?.total ?? 0 }
    });
  }
);

assetRoutes.get(
  "/dashboard/overview",
  requireRoles(["super_admin", "manager", "site_manager", "operator"]),
  async (c) => {
    const byType = await c.env.DB.prepare(
      `SELECT at.type_code, at.type_name, COUNT(*) as cnt
       FROM tracked_asset ta
       JOIN asset_type at ON at.id = ta.asset_type_id
       GROUP BY at.id
       ORDER BY cnt DESC`
    ).all();

    const byStatus = await c.env.DB.prepare(
      "SELECT status, COUNT(*) as cnt FROM tracked_asset GROUP BY status"
    ).all();

    const byLocation = await c.env.DB.prepare(
      "SELECT IFNULL(current_location, '-') as location, COUNT(*) as cnt FROM tracked_asset GROUP BY current_location"
    ).all();

    return c.json({
      success: true,
      data: {
        by_type: byType.results ?? [],
        by_status: byStatus.results ?? [],
        by_location: byLocation.results ?? []
      }
    });
  }
);

assetRoutes.get(
  "/dashboard/dispatch-board",
  requireRoles(["super_admin", "manager", "site_manager", "operator"]),
  async (c) => {
    const warehouseId = c.req.query("warehouse_id");
    const assetTypeId = c.req.query("asset_type_id");
    const projectId = c.req.query("project_id");
    const dispatchStateFilter = c.req.query("dispatch_state");

    let sql = "SELECT * FROM tracked_asset WHERE 1=1";
    const params: Array<string | number> = [];
    if (warehouseId) {
      sql += " AND current_warehouse_id = ?";
      params.push(Number(warehouseId));
    }
    if (assetTypeId) {
      sql += " AND asset_type_id = ?";
      params.push(Number(assetTypeId));
    }
    if (projectId) {
      sql += " AND current_project_id = ?";
      params.push(Number(projectId));
    }
    sql += " ORDER BY id DESC";

    const assetRows = await c.env.DB.prepare(sql)
      .bind(...params)
      .all<TrackedAsset>();
    const assets = assetRows.results ?? [];
    const assetIds = new Set(assets.map((item) => item.id));

    const activeConfigurations = await c.env.DB.prepare(
      `SELECT * FROM tracked_asset_configuration
       WHERE status IN ('planned', 'assembling', 'active', 'disassembling')`
    ).all<TrackedAssetConfiguration>();

    const activeWorkOrders = await c.env.DB.prepare(
      `SELECT * FROM warehouse_asset_work_order
       WHERE blocking_flag = 1 AND status IN ('pending_approval', 'approved', 'in_progress')`
    ).all<{
      id: number;
      work_order_no: string;
      tracked_asset_id: number | null;
      tracked_asset_configuration_id: number | null;
      status: string;
    }>();

    const stockReservations = await c.env.DB.prepare(
      `SELECT soi.tracked_asset_id, soi.requires_modification, so.order_no, so.order_type, so.status
       FROM stock_order_item soi
       JOIN stock_order so ON so.id = soi.stock_order_id
       WHERE soi.tracked_asset_id IS NOT NULL
         AND soi.status = 'active'
         AND so.order_type IN ('outbound', 'transfer')
         AND so.status IN ('draft', 'pending_approval', 'approved')`
    ).all<{
      tracked_asset_id: number;
      requires_modification: number;
      order_no: string;
      order_type: string;
      status: string;
    }>();

    const typeRows = await c.env.DB.prepare(
      "SELECT id, type_code, type_name FROM asset_type WHERE status != 'deleted'"
    ).all<Pick<AssetType, "id" | "type_code" | "type_name">>();
    const typeMap = new Map((typeRows.results ?? []).map((item) => [item.id, item]));

    const configurationMap = new Map<number, Array<TrackedAssetConfiguration>>();
    for (const config of activeConfigurations.results ?? []) {
      const candidateIds = [
        config.shell_asset_id,
        config.core_asset_id,
        config.console_asset_id
      ].filter((id): id is number => typeof id === "number" && assetIds.has(id));
      for (const assetIdValue of candidateIds) {
        const list = configurationMap.get(assetIdValue) ?? [];
        list.push(config);
        configurationMap.set(assetIdValue, list);
      }
    }

    const blockingWorkOrderMap = new Map<
      number,
      Array<{ work_order_no: string; status: string }>
    >();
    for (const workOrder of activeWorkOrders.results ?? []) {
      if (workOrder.tracked_asset_id && assetIds.has(workOrder.tracked_asset_id)) {
        const list = blockingWorkOrderMap.get(workOrder.tracked_asset_id) ?? [];
        list.push({ work_order_no: workOrder.work_order_no, status: workOrder.status });
        blockingWorkOrderMap.set(workOrder.tracked_asset_id, list);
      }
    }

    const reservationMap = new Map<
      number,
      Array<{ order_no: string; status: string; requires_modification: number }>
    >();
    for (const reservation of stockReservations.results ?? []) {
      if (!assetIds.has(reservation.tracked_asset_id)) continue;
      const list = reservationMap.get(reservation.tracked_asset_id) ?? [];
      list.push({
        order_no: reservation.order_no,
        status: reservation.status,
        requires_modification: reservation.requires_modification
      });
      reservationMap.set(reservation.tracked_asset_id, list);
    }

    const items = assets.map((asset) => {
      const configurations = configurationMap.get(asset.id) ?? [];
      const blockingWorkOrders = blockingWorkOrderMap.get(asset.id) ?? [];
      const reservations = reservationMap.get(asset.id) ?? [];
      const hasApprovedReservation = reservations.some((item) => item.status === "approved");
      const hasPendingReservation = reservations.some(
        (item) => item.status === "draft" || item.status === "pending_approval"
      );
      const hasModificationReservation = reservations.some(
        (item) => item.requires_modification === 1
      );
      const hasModificationConfiguration = configurations.some((item) =>
        ["planned", "assembling", "disassembling"].includes(item.status)
      );

      let dispatchState: DispatchBoardState;
      const reasons: string[] = [];
      if (asset.status === "scrapped") {
        dispatchState = "scrapped";
        reasons.push("asset status is scrapped");
      } else if (asset.current_project_id) {
        dispatchState = "on_project";
        reasons.push("asset is currently assigned to a project");
      } else if (
        DISPATCH_BLOCKED_ASSET_STATUSES.has(asset.status) ||
        blockingWorkOrders.length > 0
      ) {
        dispatchState = "blocked";
        if (DISPATCH_BLOCKED_ASSET_STATUSES.has(asset.status)) {
          reasons.push(`asset status is ${asset.status}`);
        }
        if (blockingWorkOrders.length > 0) {
          reasons.push(
            `blocking work orders: ${blockingWorkOrders.map((item) => item.work_order_no).join(", ")}`
          );
        }
      } else if (hasApprovedReservation) {
        dispatchState = "in_transit";
        reasons.push(
          `approved stock order: ${reservations
            .filter((item) => item.status === "approved")
            .map((item) => item.order_no)
            .join(", ")}`
        );
      } else if (hasPendingReservation) {
        dispatchState = "reserved";
        reasons.push(
          `reserved by stock order: ${reservations.map((item) => item.order_no).join(", ")}`
        );
      } else if (hasModificationReservation || hasModificationConfiguration) {
        dispatchState = "available_after_modification";
        if (hasModificationReservation) {
          reasons.push("stock order requires modification");
        }
        if (hasModificationConfiguration) {
          reasons.push(
            `configuration status: ${configurations.map((item) => item.status).join(", ")}`
          );
        }
      } else {
        dispatchState = "available_now";
      }

      return {
        id: asset.id,
        asset_code: asset.asset_code,
        asset_name: asset.asset_name,
        asset_type_id: asset.asset_type_id,
        asset_type_code: typeMap.get(asset.asset_type_id)?.type_code ?? null,
        asset_type_name: typeMap.get(asset.asset_type_id)?.type_name ?? null,
        status: asset.status,
        current_project_id: asset.current_project_id,
        current_warehouse_id: asset.current_warehouse_id,
        current_location: asset.current_location,
        dispatch_state: dispatchState,
        reasons,
        configurations: configurations.map((item) => ({
          id: item.id,
          configuration_code: item.configuration_code,
          whole_machine_code: item.whole_machine_code,
          status: item.status
        })),
        blocking_work_orders: blockingWorkOrders,
        reservations
      };
    });

    const filteredItems = dispatchStateFilter
      ? items.filter((item) => item.dispatch_state === dispatchStateFilter)
      : items;

    const summary = {
      available_now: filteredItems.filter((item) => item.dispatch_state === "available_now").length,
      available_after_modification: filteredItems.filter(
        (item) => item.dispatch_state === "available_after_modification"
      ).length,
      blocked: filteredItems.filter((item) => item.dispatch_state === "blocked").length,
      reserved: filteredItems.filter((item) => item.dispatch_state === "reserved").length,
      in_transit: filteredItems.filter((item) => item.dispatch_state === "in_transit").length,
      on_project: filteredItems.filter((item) => item.dispatch_state === "on_project").length,
      scrapped: filteredItems.filter((item) => item.dispatch_state === "scrapped").length
    };

    const byType = Array.from(countBy(filteredItems, (item) => item.asset_type_id).entries()).map(
      ([typeId, count]) => ({
        asset_type_id: Number(typeId),
        type_code: typeMap.get(Number(typeId))?.type_code ?? null,
        type_name: typeMap.get(Number(typeId))?.type_name ?? null,
        count
      })
    );

    const byWarehouse = Array.from(
      countBy(
        filteredItems.filter((item) => item.current_warehouse_id !== null),
        (item) => item.current_warehouse_id ?? 0
      ).entries()
    ).map(([currentWarehouseId, count]) => ({
      warehouse_id: Number(currentWarehouseId),
      count
    }));

    return c.json({
      success: true,
      data: {
        summary,
        by_type: byType,
        by_warehouse: byWarehouse,
        items: filteredItems
      }
    });
  }
);

assetRoutes.get(
  "/dashboard/project/:projectId",
  requireRoles(["super_admin", "manager", "site_manager", "operator"]),
  async (c) => {
    const projectId = Number(c.req.param("projectId"));

    const assets = await c.env.DB.prepare(
      "SELECT * FROM tracked_asset WHERE current_project_id = ? ORDER BY id DESC"
    )
      .bind(projectId)
      .all<TrackedAsset>();

    const activeRentalTerms = await c.env.DB.prepare(
      `SELECT tracked_asset_id, rental_mode, due_date, status,
              CASE
                WHEN returned_date IS NOT NULL THEN 0
                WHEN date(due_date) < date(?) THEN CAST(julianday(date(?)) - julianday(date(due_date)) AS INTEGER)
                ELSE 0
              END AS overdue_days
       FROM asset_rental_term
       WHERE project_id = ? AND status IN ('active', 'overdue') AND returned_date IS NULL`
    )
      .bind(todayIso(), todayIso(), projectId)
      .all<{
        tracked_asset_id: number;
        rental_mode: string;
        due_date: string;
        status: string;
        overdue_days: number;
      }>();
    const rentalMap = new Map(
      (activeRentalTerms.results ?? []).map((item) => [item.tracked_asset_id, item])
    );

    const consumptions = await c.env.DB.prepare(
      `SELECT ic.asset_type_id, at.type_name, IFNULL(SUM(ic.quantity), 0) as total_qty
       FROM inventory_consumption ic
       JOIN asset_type at ON at.id = ic.asset_type_id
       WHERE ic.project_id = ?
       GROUP BY ic.asset_type_id
       ORDER BY total_qty DESC`
    )
      .bind(projectId)
      .all();

    return c.json({
      success: true,
      data: {
        tracked_assets: (assets.results ?? []).map((item) => {
          const rental = rentalMap.get(item.id);
          return {
            ...item,
            rental_mode: rental?.rental_mode ?? null,
            rental_due_date: rental?.due_date ?? null,
            rental_status: rental?.status ?? null,
            rental_overdue_days: rental?.overdue_days ?? 0
          };
        }),
        consumptions: consumptions.results ?? [],
        rental_alert: {
          active_count: (activeRentalTerms.results ?? []).length,
          overdue_count: (activeRentalTerms.results ?? []).filter((item) => item.overdue_days > 0)
            .length
        }
      }
    });
  }
);

assetRoutes.get(
  "/:id",
  requireRoles(["super_admin", "manager", "site_manager", "operator"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const eventType = c.req.query("event_type");
    const workOrderType = c.req.query("work_order_type");
    const evidenceType = c.req.query("evidence_type");
    const asset = await c.env.DB.prepare("SELECT * FROM tracked_asset WHERE id = ?")
      .bind(id)
      .first<TrackedAsset>();

    if (!asset) {
      return c.json({ success: false, error: { message: "Asset not found" } }, 404);
    }

    const docs = await c.env.DB.prepare(
      "SELECT * FROM tracked_asset_document WHERE tracked_asset_id = ? AND status = 'active' ORDER BY id DESC"
    )
      .bind(id)
      .all<TrackedAssetDocument>();

    let eventSql = "SELECT * FROM tracked_asset_event WHERE tracked_asset_id = ?";
    const eventParams: Array<string | number> = [id];
    if (eventType) {
      eventSql += " AND event_type = ?";
      eventParams.push(eventType);
    }
    eventSql += " ORDER BY event_time DESC";
    const events = await c.env.DB.prepare(eventSql)
      .bind(...eventParams)
      .all<TrackedAssetEvent>();

    const configurations = await c.env.DB.prepare(
      `SELECT * FROM tracked_asset_configuration
       WHERE shell_asset_id = ? OR core_asset_id = ? OR console_asset_id = ?
       ORDER BY id DESC`
    )
      .bind(id, id, id)
      .all<TrackedAssetConfiguration>();

    let taskSql = `
      SELECT wao.*,
              wm.manual_title,
              wmv.manual_id,
              wmv.version_no AS manual_version_no
       FROM warehouse_asset_work_order wao
       LEFT JOIN warehouse_manual_version wmv ON wmv.id = wao.manual_version_id
       LEFT JOIN warehouse_manual wm ON wm.id = wmv.manual_id
       WHERE wao.tracked_asset_id = ?`;
    const taskParams: Array<string | number> = [id];
    if (workOrderType) {
      taskSql += " AND wao.work_order_type = ?";
      taskParams.push(workOrderType);
    }
    taskSql += " ORDER BY wao.id DESC";
    const warehouseTasks = await c.env.DB.prepare(taskSql)
      .bind(...taskParams)
      .all<
        WarehouseAssetWorkOrder & {
          manual_title: string | null;
          manual_id: number | null;
          manual_version_no: number | null;
        }
      >();

    let evidenceSql = `
      SELECT wte.*,
              wao.work_order_no,
              wao.work_order_type,
              wao.status AS work_order_status,
              wao.result_summary,
              wm.manual_title,
              wmv.version_no AS manual_version_no
       FROM warehouse_task_evidence wte
       JOIN warehouse_asset_work_order wao ON wao.id = wte.work_order_id
       LEFT JOIN warehouse_manual_version wmv ON wmv.id = wao.manual_version_id
       LEFT JOIN warehouse_manual wm ON wm.id = wmv.manual_id
       WHERE (wte.tracked_asset_id = ?
          OR (wte.tracked_asset_id IS NULL AND wao.tracked_asset_id = ?))`;
    const evidenceParams: Array<string | number> = [id, id];
    if (workOrderType) {
      evidenceSql += " AND wao.work_order_type = ?";
      evidenceParams.push(workOrderType);
    }
    if (evidenceType) {
      evidenceSql += " AND wte.evidence_type = ?";
      evidenceParams.push(evidenceType);
    }
    evidenceSql += " ORDER BY wte.captured_at DESC, wte.id DESC";
    const taskEvidence = await c.env.DB.prepare(evidenceSql)
      .bind(...evidenceParams)
      .all<
        WarehouseTaskEvidence & {
          work_order_no: string;
          work_order_type: string;
          work_order_status: string;
          result_summary: string | null;
          manual_title: string | null;
          manual_version_no: number | null;
        }
      >();

    const manualHistory = buildAssetManualReferenceHistory(
      (warehouseTasks.results ?? []).map(
        (item): AssetManualReferenceHistoryRow => ({
          work_order_id: item.id,
          work_order_no: item.work_order_no,
          work_order_type: item.work_order_type,
          work_order_status: item.status,
          manual_version_id: item.manual_version_id,
          manual_id: item.manual_id,
          manual_title: item.manual_title,
          manual_version_no: item.manual_version_no,
          referenced_at: item.reviewed_at ?? item.completed_at ?? item.updated_at ?? item.created_at
        })
      )
    );

    return c.json({
      success: true,
      data: {
        ...asset,
        documents: docs.results ?? [],
        events: events.results ?? [],
        configurations: configurations.results ?? [],
        warehouse_tasks: warehouseTasks.results ?? [],
        task_evidence: taskEvidence.results ?? [],
        manual_history: manualHistory
      }
    });
  }
);

assetRoutes.post("/", requireRoles(["super_admin", "manager", "site_manager"]), async (c) => {
  const auth = c.get("auth");
  const body = (await c.req.json()) as CreateTrackedAssetRequest;
  if (!body.asset_type_id || !body.asset_name?.trim()) {
    return c.json(
      { success: false, error: { message: "asset_type_id and asset_name are required" } },
      400
    );
  }

  const type = await c.env.DB.prepare(
    "SELECT * FROM asset_type WHERE id = ? AND status != 'deleted'"
  )
    .bind(body.asset_type_id)
    .first<AssetType>();
  if (!type) {
    return c.json({ success: false, error: { message: "Asset type not found" } }, 404);
  }
  if (type.tracked_flag !== 1) {
    return c.json(
      { success: false, error: { message: "Only tracked asset type can create tracked asset" } },
      400
    );
  }

  let propertiesJson: string | null = null;
  try {
    propertiesJson = ensureJsonText(body.properties_json);
  } catch {
    return c.json(
      { success: false, error: { message: "properties_json must be valid JSON" } },
      400
    );
  }

  const assetCode = await generateAssetCode(c.env.DB, type.type_code);
  const now = nowIso();
  const ownershipType = body.ownership_type ?? "owned";
  if (ownershipType !== "owned" && ownershipType !== "leased_in") {
    return c.json(
      { success: false, error: { message: "ownership_type must be owned or leased_in" } },
      400
    );
  }
  const result = await c.env.DB.prepare(
    `INSERT INTO tracked_asset
        (asset_code, asset_type_id, asset_name, brand, model, serial_no, status,
         current_project_id, current_warehouse_id, current_location, properties_json,
         purchased_date, ownership_type, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'idle', ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      assetCode,
      body.asset_type_id,
      body.asset_name.trim(),
      body.brand ?? null,
      body.model ?? null,
      body.serial_no ?? null,
      body.current_project_id ?? null,
      body.current_warehouse_id ?? null,
      body.current_location ?? null,
      propertiesJson,
      body.purchased_date ?? null,
      ownershipType,
      now,
      now
    )
    .run();

  const assetId = result.meta.last_row_id as number;
  await c.env.DB.prepare(
    `INSERT INTO tracked_asset_event
        (tracked_asset_id, event_type, event_time, operator_userid, project_id, warehouse_id, detail, created_at)
       VALUES (?, 'create', ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      assetId,
      now,
      auth.sub,
      body.current_project_id ?? null,
      body.current_warehouse_id ?? null,
      "资产建档",
      now
    )
    .run();

  return c.json({ success: true, data: { id: assetId, asset_code: assetCode } }, 201);
});

assetRoutes.put("/:id", requireRoles(["super_admin", "manager", "site_manager"]), async (c) => {
  const id = Number(c.req.param("id"));
  const auth = c.get("auth");
  const body = (await c.req.json()) as UpdateTrackedAssetRequest;

  if (
    body.ownership_type !== undefined &&
    body.ownership_type !== "owned" &&
    body.ownership_type !== "leased_in"
  ) {
    return c.json(
      { success: false, error: { message: "ownership_type must be owned or leased_in" } },
      400
    );
  }

  let propertiesJson: string | null = null;
  try {
    propertiesJson =
      body.properties_json === undefined ? null : ensureJsonText(body.properties_json);
  } catch {
    return c.json(
      { success: false, error: { message: "properties_json must be valid JSON" } },
      400
    );
  }

  await c.env.DB.prepare(
    `UPDATE tracked_asset SET
         asset_name = COALESCE(?, asset_name),
         brand = COALESCE(?, brand),
         model = COALESCE(?, model),
         serial_no = COALESCE(?, serial_no),
         status = COALESCE(?, status),
         current_project_id = COALESCE(?, current_project_id),
         current_warehouse_id = COALESCE(?, current_warehouse_id),
         current_location = COALESCE(?, current_location),
         properties_json = CASE WHEN ? IS NULL THEN properties_json ELSE ? END,
         purchased_date = COALESCE(?, purchased_date),
         ownership_type = COALESCE(?, ownership_type),
         updated_at = ?
       WHERE id = ?`
  )
    .bind(
      body.asset_name ?? null,
      body.brand ?? null,
      body.model ?? null,
      body.serial_no ?? null,
      body.status ?? null,
      body.current_project_id ?? null,
      body.current_warehouse_id ?? null,
      body.current_location ?? null,
      body.properties_json === undefined ? null : propertiesJson,
      propertiesJson,
      body.purchased_date ?? null,
      body.ownership_type ?? null,
      nowIso(),
      id
    )
    .run();

  await c.env.DB.prepare(
    `INSERT INTO tracked_asset_event
        (tracked_asset_id, event_type, event_time, operator_userid, project_id, warehouse_id, detail, created_at)
       VALUES (?, 'update', ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      nowIso(),
      auth.sub,
      body.current_project_id ?? null,
      body.current_warehouse_id ?? null,
      "资产更新",
      nowIso()
    )
    .run();

  return c.json({ success: true });
});

assetRoutes.post(
  "/:id/document",
  requireRoles(["super_admin", "manager", "site_manager", "operator"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const body = (await c.req.json()) as {
      doc_type: string;
      file_key: string;
      file_name?: string;
      remark?: string;
    };

    if (!body.doc_type?.trim() || !body.file_key?.trim()) {
      return c.json(
        { success: false, error: { message: "doc_type and file_key are required" } },
        400
      );
    }

    const result = await c.env.DB.prepare(
      `INSERT INTO tracked_asset_document
        (tracked_asset_id, doc_type, file_key, file_name, remark, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?)`
    )
      .bind(id, body.doc_type, body.file_key, body.file_name ?? null, body.remark ?? null, nowIso())
      .run();

    return c.json({ success: true, data: { id: result.meta.last_row_id } }, 201);
  }
);

assetRoutes.get(
  "/:id/document",
  requireRoles(["super_admin", "manager", "site_manager", "operator"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const rows = await c.env.DB.prepare(
      "SELECT * FROM tracked_asset_document WHERE tracked_asset_id = ? AND status = 'active' ORDER BY id DESC"
    )
      .bind(id)
      .all<TrackedAssetDocument>();
    return c.json({ success: true, data: rows.results ?? [] });
  }
);

assetRoutes.delete(
  "/:id/document/:docId",
  requireRoles(["super_admin", "manager", "site_manager"]),
  async (c) => {
    const docId = Number(c.req.param("docId"));
    await c.env.DB.prepare("UPDATE tracked_asset_document SET status = 'deleted' WHERE id = ?")
      .bind(docId)
      .run();
    return c.json({ success: true });
  }
);

assetRoutes.post(
  "/:id/event",
  requireRoles(["super_admin", "manager", "site_manager", "operator"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const auth = c.get("auth");
    const body = (await c.req.json()) as {
      event_type: string;
      event_time?: string;
      project_id?: number;
      warehouse_id?: number;
      detail?: string;
    };

    if (!body.event_type?.trim()) {
      return c.json({ success: false, error: { message: "event_type is required" } }, 400);
    }

    const result = await c.env.DB.prepare(
      `INSERT INTO tracked_asset_event
        (tracked_asset_id, event_type, event_time, operator_userid, project_id, warehouse_id, detail, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        id,
        body.event_type,
        body.event_time ?? nowIso(),
        auth.sub,
        body.project_id ?? null,
        body.warehouse_id ?? null,
        body.detail ?? null,
        nowIso()
      )
      .run();

    return c.json({ success: true, data: { id: result.meta.last_row_id } }, 201);
  }
);

assetRoutes.get(
  "/:id/event",
  requireRoles(["super_admin", "manager", "site_manager", "operator"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const rows = await c.env.DB.prepare(
      "SELECT * FROM tracked_asset_event WHERE tracked_asset_id = ? ORDER BY event_time DESC"
    )
      .bind(id)
      .all<TrackedAssetEvent>();
    return c.json({ success: true, data: rows.results ?? [] });
  }
);

assetRoutes.put(
  "/:id/event/:eventId",
  requireRoles(["super_admin", "manager", "site_manager", "operator"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const eventId = Number(c.req.param("eventId"));
    const body = (await c.req.json()) as { detail?: string };
    if (!body.detail?.trim()) {
      return c.json({ success: false, error: { message: "detail is required" } }, 400);
    }

    const result = await c.env.DB.prepare(
      "UPDATE tracked_asset_event SET detail = ? WHERE id = ? AND tracked_asset_id = ?"
    )
      .bind(body.detail.trim(), eventId, id)
      .run();

    if (!(result.meta.changes && result.meta.changes > 0)) {
      return c.json({ success: false, error: { message: "event not found" } }, 404);
    }

    return c.json({ success: true });
  }
);

assetRoutes.get(
  "/rental/term",
  requireRoles(["super_admin", "manager", "site_manager", "finance", "operator"]),
  async (c) => {
    const status = c.req.query("status");
    const rentalMode = c.req.query("rental_mode");
    const projectId = c.req.query("project_id");
    const overdueOnly = c.req.query("overdue_only") === "1";

    let sql =
      "SELECT t.*, ta.asset_code, ta.asset_name, ta.ownership_type, p.project_name FROM asset_rental_term t JOIN tracked_asset ta ON ta.id = t.tracked_asset_id LEFT JOIN project p ON p.id = t.project_id WHERE 1=1";
    const params: Array<string | number> = [];
    if (status) {
      sql += " AND t.status = ?";
      params.push(status);
    }
    if (rentalMode) {
      sql += " AND t.rental_mode = ?";
      params.push(rentalMode);
    }
    if (projectId) {
      sql += " AND t.project_id = ?";
      params.push(Number(projectId));
    }
    if (overdueOnly) {
      sql +=
        " AND t.status IN ('active', 'overdue') AND t.returned_date IS NULL AND date(t.due_date) < date(?)";
      params.push(todayIso());
    }
    sql += " ORDER BY t.id DESC";

    const rows = await c.env.DB.prepare(sql)
      .bind(...params)
      .all<AssetRentalTerm>();
    const data = (rows.results ?? []).map((item) => {
      const overdueDays =
        item.returned_date || !item.due_date
          ? 0
          : Math.max(
              0,
              Math.floor(
                (Date.parse(todayIso()) - Date.parse(item.due_date.slice(0, 10))) /
                  (24 * 60 * 60 * 1000)
              )
            );
      return {
        ...item,
        overdue_days: overdueDays
      };
    });

    return c.json({ success: true, data });
  }
);

assetRoutes.post(
  "/rental/term",
  requireRoles(["super_admin", "manager", "site_manager", "finance"]),
  async (c) => {
    const auth = c.get("auth");
    const body = (await c.req.json()) as CreateAssetRentalTermRequest;

    if (!body.tracked_asset_id || !body.start_date || !body.due_date) {
      return c.json(
        {
          success: false,
          error: { message: "tracked_asset_id, start_date and due_date are required" }
        },
        400
      );
    }
    if (!["lease_in", "lease_out"].includes(body.rental_mode)) {
      return c.json(
        { success: false, error: { message: "rental_mode must be lease_in or lease_out" } },
        400
      );
    }

    const activeTerm = await c.env.DB.prepare(
      "SELECT id FROM asset_rental_term WHERE tracked_asset_id = ? AND status IN ('active', 'overdue') AND returned_date IS NULL LIMIT 1"
    )
      .bind(body.tracked_asset_id)
      .first<{ id: number }>();
    if (activeTerm) {
      return c.json(
        { success: false, error: { message: "asset already has active rental term" } },
        400
      );
    }

    const rentalNo = await generateSerial(c.env.DB, "RL", "asset_rental_term", "rental_no");
    const now = nowIso();
    const status = Date.parse(body.due_date) < Date.parse(todayIso()) ? "overdue" : "active";

    const result = await c.env.DB.prepare(
      `INSERT INTO asset_rental_term
        (rental_no, tracked_asset_id, rental_mode, project_id, contract_id, finance_mode,
         start_date, due_date, returned_date, status, note, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`
    )
      .bind(
        rentalNo,
        body.tracked_asset_id,
        body.rental_mode,
        body.project_id ?? null,
        body.contract_id ?? null,
        body.finance_mode ?? "contract",
        body.start_date,
        body.due_date,
        status,
        body.note ?? null,
        auth.sub,
        now,
        now
      )
      .run();

    return c.json(
      { success: true, data: { id: result.meta.last_row_id, rental_no: rentalNo, status } },
      201
    );
  }
);

assetRoutes.post(
  "/rental/term/:id/return",
  requireRoles(["super_admin", "manager", "site_manager", "finance"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const body = (await c.req.json().catch(() => ({}))) as ReturnAssetRentalTermRequest;
    const returnedDate = body.returned_date ?? todayIso();

    const term = await c.env.DB.prepare("SELECT * FROM asset_rental_term WHERE id = ?")
      .bind(id)
      .first<AssetRentalTerm>();
    if (!term) {
      return c.json({ success: false, error: { message: "rental term not found" } }, 404);
    }
    if (term.returned_date) {
      return c.json({ success: false, error: { message: "rental term already returned" } }, 400);
    }

    await c.env.DB.prepare(
      "UPDATE asset_rental_term SET returned_date = ?, status = 'returned', note = COALESCE(?, note), updated_at = ? WHERE id = ?"
    )
      .bind(returnedDate, body.note ?? null, nowIso(), id)
      .run();

    return c.json({ success: true });
  }
);

assetRoutes.post(
  "/rental/term/scan-overdue",
  requireRoles(["super_admin", "manager", "finance"]),
  async (c) => {
    const now = nowIso();
    const due = todayIso();
    const result = await c.env.DB.prepare(
      "UPDATE asset_rental_term SET status = 'overdue', updated_at = ? WHERE status = 'active' AND returned_date IS NULL AND date(due_date) < date(?)"
    )
      .bind(now, due)
      .run();

    return c.json({ success: true, data: { updated: result.meta.changes ?? 0 } });
  }
);
