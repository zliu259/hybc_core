import { Hono } from "hono";

import { authMiddleware, type AuthVariables } from "../middleware/auth";
import { requireRoles } from "../middleware/rbac";
import { createAiGateHandler, createTask } from "../services/ai-slot";
import { submitForApproval } from "../services/approval/engine";
import { resubmit as resubmitOp } from "../services/approval/operations";
import { getExistingApprovalSubmissionDecision } from "../services/approval/status";
import { generateSerial } from "../services/serial";
import {
  createReturnInspectionTaskForStockOrderItem,
  isAssetBlockedByWarehouseTasks,
  normalizeReturnedAssetStatus
} from "../services/warehouse-task";
import type { Env } from "../types/env";
import type { TrackedAsset } from "../types/asset";
import type {
  AddStocktakeLineRequest,
  CreateStocktakeTaskRequest,
  ConfirmEquipmentPlanRequest,
  CreateEquipmentPlanRequest,
  CreateStockOrderRequest,
  CreateWarehouseRequest,
  InventoryRow,
  ProjectEquipmentPlan,
  ReviewStockOrderOverrideRequest,
  StocktakeLine,
  StocktakeTask,
  StockOrder,
  StockOrderItem,
  SubmitStockOrderApprovalRequest,
  UpdateStocktakeLineRequest,
  UpdateWarehouseRequest,
  Warehouse
} from "../types/warehouse";

const nowIso = () => new Date().toISOString();

const parseTaskResult = (resultJson: string | null): Record<string, unknown> | null => {
  if (!resultJson) return null;
  try {
    const raw = JSON.parse(resultJson) as { output?: string } & Record<string, unknown>;
    if (typeof raw.output === "string") {
      try {
        return JSON.parse(raw.output) as Record<string, unknown>;
      } catch {
        return { output: raw.output };
      }
    }
    return raw;
  } catch {
    return null;
  }
};

const STOCKTAKE_LINE_STATUS = new Set(["normal", "new", "damaged", "lost"]);
const BLOCKED_TRACKED_ASSET_STATUSES = new Set([
  "quarantine",
  "returned_quarantine",
  "inspection",
  "maintenance",
  "servicing",
  "modification",
  "scrapped",
  "using"
]);

const ensureStocktakeLineStatus = (value?: string): "normal" | "new" | "damaged" | "lost" => {
  if (!value) return "normal";
  if (!STOCKTAKE_LINE_STATUS.has(value)) {
    throw new Error("line_status must be one of normal/new/damaged/lost");
  }
  return value as "normal" | "new" | "damaged" | "lost";
};

const buildInitialStocktakeLines = async (
  env: Env,
  scope: "company" | "warehouse",
  warehouseId?: number
): Promise<
  Array<{
    warehouse_id: number;
    item_kind: "asset" | "consumable";
    asset_type_id: number;
    tracked_asset_id: number | null;
    item_name: string;
    unit: string;
    expected_qty: number;
    counted_qty: number | null;
    diff_qty: number;
    line_status: "normal" | "new" | "damaged" | "lost";
    note: string | null;
  }>
> => {
  const params: number[] = [];
  const warehouseFilter = scope === "warehouse" && warehouseId ? " AND i.warehouse_id = ?" : "";
  if (scope === "warehouse" && warehouseId) params.push(warehouseId);

  const consumableRows = await env.DB.prepare(
    `SELECT i.warehouse_id, i.asset_type_id, at.type_name, at.unit, i.quantity
     FROM inventory i
     JOIN asset_type at ON at.id = i.asset_type_id
     WHERE i.status = 'active' AND at.status != 'deleted' AND at.tracked_flag = 0${warehouseFilter}`
  )
    .bind(...params)
    .all<{
      warehouse_id: number;
      asset_type_id: number;
      type_name: string;
      unit: string | null;
      quantity: number;
    }>();

  const trackedParams: number[] = [];
  const trackedFilter =
    scope === "warehouse" && warehouseId ? " AND ta.current_warehouse_id = ?" : "";
  if (scope === "warehouse" && warehouseId) trackedParams.push(warehouseId);

  const trackedRows = await env.DB.prepare(
    `SELECT ta.current_warehouse_id as warehouse_id,
            ta.asset_type_id,
            at.type_name,
            at.unit,
            COUNT(*) as asset_count
     FROM tracked_asset ta
     JOIN asset_type at ON at.id = ta.asset_type_id
     WHERE ta.current_warehouse_id IS NOT NULL
       AND ta.status != 'scrapped'
       AND at.status != 'deleted'
       AND at.tracked_flag = 1${trackedFilter}
     GROUP BY ta.current_warehouse_id, ta.asset_type_id`
  )
    .bind(...trackedParams)
    .all<{
      warehouse_id: number;
      asset_type_id: number;
      type_name: string;
      unit: string | null;
      asset_count: number;
    }>();

  const lines = [
    ...(consumableRows.results ?? []).map((row) => ({
      warehouse_id: row.warehouse_id,
      item_kind: "consumable" as const,
      asset_type_id: row.asset_type_id,
      tracked_asset_id: null,
      item_name: row.type_name,
      unit: row.unit ?? "件",
      expected_qty: Number(row.quantity ?? 0),
      counted_qty: null,
      diff_qty: 0,
      line_status: "normal" as const,
      note: null
    })),
    ...(trackedRows.results ?? []).map((row) => ({
      warehouse_id: row.warehouse_id,
      item_kind: "asset" as const,
      asset_type_id: row.asset_type_id,
      tracked_asset_id: null,
      item_name: row.type_name,
      unit: row.unit ?? "件",
      expected_qty: Number(row.asset_count ?? 0),
      counted_qty: null,
      diff_qty: 0,
      line_status: "normal" as const,
      note: null
    }))
  ];

  return lines;
};

const upsertInventory = async (
  db: D1Database,
  warehouseId: number,
  assetTypeId: number,
  deltaQty: number
) => {
  const row = await db
    .prepare("SELECT * FROM inventory WHERE warehouse_id = ? AND asset_type_id = ?")
    .bind(warehouseId, assetTypeId)
    .first<InventoryRow>();

  if (!row) {
    const qty = Math.max(deltaQty, 0);
    await db
      .prepare(
        "INSERT INTO inventory (warehouse_id, asset_type_id, quantity, min_stock, status, updated_at) VALUES (?, ?, ?, NULL, 'active', ?)"
      )
      .bind(warehouseId, assetTypeId, qty, nowIso())
      .run();
    return qty;
  }

  const next = row.quantity + deltaQty;
  if (next < 0) {
    throw new Error(
      `Inventory insufficient for warehouse=${warehouseId}, asset_type=${assetTypeId}`
    );
  }

  await db
    .prepare("UPDATE inventory SET quantity = ?, updated_at = ? WHERE id = ?")
    .bind(next, nowIso(), row.id)
    .run();
  return next;
};

export const evaluateStockOrderGate = async (
  env: Env,
  order: StockOrder,
  items: StockOrderItem[]
): Promise<{ pass: boolean; issues: string[] }> => {
  const issues: string[] = [];
  const overrideApproved = isStockOrderOverrideEffective(order);
  if (order.override_status === "approved" && !overrideApproved) {
    issues.push(
      "override audit incomplete: reason, approver and risk acknowledgement are required"
    );
  }

  for (const item of items) {
    if (item.requires_modification === 1) {
      issues.push(`item ${item.id} requires modification before execution`);
    }
    if (!item.tracked_asset_id) continue;
    const asset = await env.DB.prepare("SELECT * FROM tracked_asset WHERE id = ?")
      .bind(item.tracked_asset_id)
      .first<TrackedAsset>();
    if (!asset) {
      issues.push(`tracked asset ${item.tracked_asset_id} not found`);
      continue;
    }
    if (
      order.order_type === "outbound" &&
      BLOCKED_TRACKED_ASSET_STATUSES.has(asset.status) &&
      !overrideApproved
    ) {
      issues.push(`tracked asset ${asset.asset_code} blocked by status=${asset.status}`);
    }

    const blockingTask = await isAssetBlockedByWarehouseTasks(env, asset.id);
    if (blockingTask.blocked && !overrideApproved) {
      issues.push(
        `tracked asset ${asset.asset_code} blocked by task ${blockingTask.work_order_no}`
      );
    }
  }

  return { pass: issues.length === 0, issues };
};

const isStockOrderOverrideEffective = (order: StockOrder): boolean =>
  order.override_status === "approved" &&
  Boolean(order.override_reason?.trim()) &&
  Boolean(order.override_approver_userid?.trim()) &&
  order.override_risk_acknowledged === 1;

const buildStockOrderExecutionDetail = (order: StockOrder): string => {
  let detail = `Stock order ${order.order_no} executed`;
  if (isStockOrderOverrideEffective(order)) {
    detail += ` with override; reason=${order.override_reason?.trim()}; approver=${order.override_approver_userid}; risk_acknowledged=1`;
  }
  return detail;
};

export const applyStockOrderExecution = async (env: Env, order: StockOrder): Promise<void> => {
  if (order.rental_term_id) {
    const term = await env.DB.prepare("SELECT * FROM asset_rental_term WHERE id = ?")
      .bind(order.rental_term_id)
      .first<{
        id: number;
        status: string;
        due_date: string;
        returned_date: string | null;
      }>();
    if (!term) {
      throw new Error("Rental term not found");
    }
    if (order.order_type === "outbound" && term.status === "overdue") {
      throw new Error("Rental term is overdue, outbound is blocked");
    }
  }

  const items = await env.DB.prepare(
    "SELECT * FROM stock_order_item WHERE stock_order_id = ? AND status = 'active'"
  )
    .bind(order.id)
    .all<StockOrderItem>();

  const gate = await evaluateStockOrderGate(env, order, items.results ?? []);
  if (!gate.pass) {
    throw new Error(`stock order gate blocked: ${gate.issues.join("; ")}`);
  }

  for (const item of items.results ?? []) {
    if (item.tracked_asset_id) {
      const asset = await env.DB.prepare("SELECT * FROM tracked_asset WHERE id = ?")
        .bind(item.tracked_asset_id)
        .first<TrackedAsset>();
      if (!asset) continue;

      if (order.order_type === "outbound") {
        await env.DB.prepare(
          "UPDATE tracked_asset SET current_project_id = ?, current_warehouse_id = NULL, current_location = 'project', status = 'using', updated_at = ? WHERE id = ?"
        )
          .bind(order.project_id ?? null, nowIso(), asset.id)
          .run();
      } else if (order.order_type === "inbound") {
        const targetWarehouse = order.to_warehouse_id ?? order.from_warehouse_id ?? null;
        const inboundStatus = order.project_id
          ? "returned_quarantine"
          : normalizeReturnedAssetStatus("idle");
        await env.DB.prepare(
          "UPDATE tracked_asset SET current_project_id = NULL, current_warehouse_id = ?, current_location = 'warehouse', status = ?, updated_at = ? WHERE id = ?"
        )
          .bind(targetWarehouse, inboundStatus, nowIso(), asset.id)
          .run();
        if (order.project_id) {
          await createReturnInspectionTaskForStockOrderItem(env, {
            order_id: order.id,
            order_no: order.order_no,
            project_id: order.project_id,
            warehouse_id: targetWarehouse,
            tracked_asset_id: asset.id,
            applicant_userid: order.applicant_userid
          });
        }
      } else if (order.order_type === "transfer") {
        await env.DB.prepare(
          "UPDATE tracked_asset SET current_warehouse_id = ?, current_location = 'warehouse', status = 'idle', updated_at = ? WHERE id = ?"
        )
          .bind(order.to_warehouse_id ?? null, nowIso(), asset.id)
          .run();
      }

      await env.DB.prepare(
        `INSERT INTO tracked_asset_event
          (tracked_asset_id, event_type, event_time, operator_userid, project_id, warehouse_id, detail, created_at)
         VALUES (?, 'stock_order_execute', ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          asset.id,
          nowIso(),
          order.applicant_userid,
          order.project_id ?? null,
          order.to_warehouse_id ?? order.from_warehouse_id ?? null,
          buildStockOrderExecutionDetail(order),
          nowIso()
        )
        .run();
      continue;
    }

    if (!item.asset_type_id) continue;
    if (order.order_type === "outbound") {
      if (!order.from_warehouse_id) throw new Error("from_warehouse_id required for outbound");
      await upsertInventory(env.DB, order.from_warehouse_id, item.asset_type_id, -item.quantity);
    } else if (order.order_type === "inbound") {
      const targetWarehouse = order.to_warehouse_id ?? order.from_warehouse_id;
      if (!targetWarehouse) throw new Error("target warehouse required for inbound");
      await upsertInventory(env.DB, targetWarehouse, item.asset_type_id, item.quantity);
    } else if (order.order_type === "transfer") {
      if (!order.from_warehouse_id || !order.to_warehouse_id) {
        throw new Error("from_warehouse_id and to_warehouse_id required for transfer");
      }
      await upsertInventory(env.DB, order.from_warehouse_id, item.asset_type_id, -item.quantity);
      await upsertInventory(env.DB, order.to_warehouse_id, item.asset_type_id, item.quantity);
    }
  }

  if (order.rental_term_id && order.order_type === "inbound") {
    await env.DB.prepare(
      "UPDATE asset_rental_term SET returned_date = COALESCE(returned_date, ?), status = 'returned', updated_at = ? WHERE id = ?"
    )
      .bind(nowIso().slice(0, 10), nowIso(), order.rental_term_id)
      .run();
  }
};

export const warehouseRoutes = new Hono<{
  Bindings: Env;
  Variables: AuthVariables;
}>();

warehouseRoutes.use("*", authMiddleware);

warehouseRoutes.get(
  "/",
  requireRoles(["super_admin", "manager", "site_manager", "operator"]),
  async (c) => {
    const keyword = c.req.query("keyword");
    let sql = "SELECT * FROM warehouse WHERE status != 'deleted'";
    const params: string[] = [];
    if (keyword) {
      sql += " AND (warehouse_code LIKE ? OR warehouse_name LIKE ? OR IFNULL(location, '') LIKE ?)";
      params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
    }
    sql += " ORDER BY id DESC";
    const rows = await c.env.DB.prepare(sql)
      .bind(...params)
      .all<Warehouse>();
    return c.json({ success: true, data: rows.results ?? [] });
  }
);

warehouseRoutes.post("/", requireRoles(["super_admin", "manager"]), async (c) => {
  const body = (await c.req.json()) as CreateWarehouseRequest;
  if (!body.warehouse_code?.trim() || !body.warehouse_name?.trim()) {
    return c.json(
      { success: false, error: { message: "warehouse_code and warehouse_name are required" } },
      400
    );
  }
  const result = await c.env.DB.prepare(
    `INSERT INTO warehouse
        (warehouse_code, warehouse_name, location, manager_userid, status, remark, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', ?, ?, ?)`
  )
    .bind(
      body.warehouse_code.trim().toUpperCase(),
      body.warehouse_name.trim(),
      body.location ?? null,
      body.manager_userid ?? null,
      body.remark ?? null,
      nowIso(),
      nowIso()
    )
    .run();
  return c.json({ success: true, data: { id: result.meta.last_row_id } }, 201);
});

warehouseRoutes.put("/:id", requireRoles(["super_admin", "manager"]), async (c) => {
  const id = Number(c.req.param("id"));
  const body = (await c.req.json()) as UpdateWarehouseRequest;
  await c.env.DB.prepare(
    `UPDATE warehouse SET
         warehouse_name = COALESCE(?, warehouse_name),
         location = COALESCE(?, location),
         manager_userid = COALESCE(?, manager_userid),
         status = COALESCE(?, status),
         remark = COALESCE(?, remark),
         updated_at = ?
       WHERE id = ?`
  )
    .bind(
      body.warehouse_name ?? null,
      body.location ?? null,
      body.manager_userid ?? null,
      body.status ?? null,
      body.remark ?? null,
      nowIso(),
      id
    )
    .run();
  return c.json({ success: true });
});

warehouseRoutes.delete("/:id", requireRoles(["super_admin", "manager"]), async (c) => {
  const id = Number(c.req.param("id"));
  await c.env.DB.prepare("UPDATE warehouse SET status = 'deleted', updated_at = ? WHERE id = ?")
    .bind(nowIso(), id)
    .run();
  return c.json({ success: true });
});

warehouseRoutes.get(
  "/inventory",
  requireRoles(["super_admin", "manager", "site_manager", "operator"]),
  async (c) => {
    const warehouseId = c.req.query("warehouse_id");
    const assetTypeId = c.req.query("asset_type_id");

    let sql =
      "SELECT i.*, w.warehouse_name, at.type_code, at.type_name, at.unit FROM inventory i JOIN warehouse w ON w.id = i.warehouse_id JOIN asset_type at ON at.id = i.asset_type_id WHERE i.status = 'active'";
    const params: (string | number)[] = [];
    if (warehouseId) {
      sql += " AND i.warehouse_id = ?";
      params.push(Number(warehouseId));
    }
    if (assetTypeId) {
      sql += " AND i.asset_type_id = ?";
      params.push(Number(assetTypeId));
    }
    sql += " ORDER BY i.id DESC";

    const rows = await c.env.DB.prepare(sql)
      .bind(...params)
      .all();
    return c.json({ success: true, data: rows.results ?? [] });
  }
);

warehouseRoutes.get(
  "/inventory/alert",
  requireRoles(["super_admin", "manager", "site_manager", "operator"]),
  async (c) => {
    const rows = await c.env.DB.prepare(
      `SELECT i.*, w.warehouse_name, at.type_code, at.type_name,
              COALESCE(i.min_stock, at.min_stock, 0) as threshold
       FROM inventory i
       JOIN warehouse w ON w.id = i.warehouse_id
       JOIN asset_type at ON at.id = i.asset_type_id
       WHERE i.status = 'active' AND i.quantity < COALESCE(i.min_stock, at.min_stock, 0)
       ORDER BY i.quantity ASC`
    ).all();
    return c.json({ success: true, data: rows.results ?? [] });
  }
);

warehouseRoutes.post(
  "/inventory/alert/:inventoryId/analyze",
  requireRoles(["super_admin", "manager", "site_manager"]),
  async (c) => {
    const inventoryId = Number(c.req.param("inventoryId"));
    const inventory = await c.env.DB.prepare("SELECT * FROM inventory WHERE id = ?")
      .bind(inventoryId)
      .first<InventoryRow>();
    if (!inventory)
      return c.json({ success: false, error: { message: "Inventory row not found" } }, 404);

    const task = await createTask(c.env, {
      task_type: "inventory_alert_analysis",
      biz_type: "inventory",
      biz_id: inventoryId,
      priority: 5,
      payload: {
        inventory_id: inventoryId,
        warehouse_id: inventory.warehouse_id,
        asset_type_id: inventory.asset_type_id,
        quantity: inventory.quantity,
        min_stock: inventory.min_stock
      },
      timeout_seconds: 300
    });
    return c.json({ success: true, data: { task_id: task.id } });
  }
);

warehouseRoutes.get(
  "/consumption",
  requireRoles(["super_admin", "manager", "site_manager", "operator"]),
  async (c) => {
    const projectId = c.req.query("project_id");
    const rows = await c.env.DB.prepare(
      `SELECT ic.*, w.warehouse_name, at.type_name
       FROM inventory_consumption ic
       JOIN warehouse w ON w.id = ic.warehouse_id
       JOIN asset_type at ON at.id = ic.asset_type_id
       WHERE (? IS NULL OR ic.project_id = ?)
       ORDER BY ic.id DESC`
    )
      .bind(projectId ? Number(projectId) : null, projectId ? Number(projectId) : null)
      .all();
    return c.json({ success: true, data: rows.results ?? [] });
  }
);

warehouseRoutes.post(
  "/consumption",
  requireRoles(["super_admin", "manager", "site_manager", "operator"]),
  async (c) => {
    const auth = c.get("auth");
    const body = (await c.req.json()) as {
      warehouse_id: number;
      project_id?: number;
      asset_type_id: number;
      quantity: number;
      consumed_date: string;
      remark?: string;
    };

    if (!body.warehouse_id || !body.asset_type_id || !body.quantity || body.quantity <= 0) {
      return c.json(
        {
          success: false,
          error: { message: "warehouse_id, asset_type_id, quantity are required" }
        },
        400
      );
    }

    await upsertInventory(c.env.DB, body.warehouse_id, body.asset_type_id, -body.quantity);

    const result = await c.env.DB.prepare(
      `INSERT INTO inventory_consumption
        (warehouse_id, project_id, asset_type_id, quantity, consumed_date, recorder_userid, remark, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        body.warehouse_id,
        body.project_id ?? null,
        body.asset_type_id,
        body.quantity,
        body.consumed_date,
        auth.sub,
        body.remark ?? null,
        nowIso()
      )
      .run();

    await createTask(c.env, {
      task_type: "consumption_anomaly",
      biz_type: "inventory_consumption",
      biz_id: result.meta.last_row_id as number,
      priority: 5,
      payload: {
        warehouse_id: body.warehouse_id,
        project_id: body.project_id,
        asset_type_id: body.asset_type_id,
        quantity: body.quantity,
        consumed_date: body.consumed_date
      },
      timeout_seconds: 300
    });

    return c.json({ success: true, data: { id: result.meta.last_row_id } }, 201);
  }
);

warehouseRoutes.get(
  "/stock-order",
  requireRoles(["super_admin", "manager", "site_manager", "operator"]),
  async (c) => {
    const status = c.req.query("status");
    const orderType = c.req.query("order_type");
    let sql = "SELECT * FROM stock_order WHERE 1=1";
    const params: (string | number)[] = [];
    if (status) {
      sql += " AND status = ?";
      params.push(status);
    }
    if (orderType) {
      sql += " AND order_type = ?";
      params.push(orderType);
    }
    sql += " ORDER BY id DESC";
    const rows = await c.env.DB.prepare(sql)
      .bind(...params)
      .all<StockOrder>();
    return c.json({ success: true, data: rows.results ?? [] });
  }
);

warehouseRoutes.get(
  "/stock-order/:id",
  requireRoles(["super_admin", "manager", "site_manager", "operator"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const order = await c.env.DB.prepare("SELECT * FROM stock_order WHERE id = ?")
      .bind(id)
      .first<StockOrder>();
    if (!order) return c.json({ success: false, error: { message: "Stock order not found" } }, 404);

    const items = await c.env.DB.prepare("SELECT * FROM stock_order_item WHERE stock_order_id = ?")
      .bind(id)
      .all();
    return c.json({ success: true, data: { ...order, items: items.results ?? [] } });
  }
);

warehouseRoutes.post(
  "/stock-order",
  requireRoles(["super_admin", "manager", "site_manager", "operator"]),
  async (c) => {
    const auth = c.get("auth");
    const body = (await c.req.json()) as CreateStockOrderRequest;
    if (!body.order_type || !body.items || body.items.length === 0) {
      return c.json(
        { success: false, error: { message: "order_type and items are required" } },
        400
      );
    }

    if (body.rental_term_id) {
      const term = await c.env.DB.prepare("SELECT * FROM asset_rental_term WHERE id = ?")
        .bind(body.rental_term_id)
        .first<{
          id: number;
          status: string;
          due_date: string;
          returned_date: string | null;
        }>();
      if (!term) {
        return c.json({ success: false, error: { message: "rental_term_id not found" } }, 404);
      }
      if (body.order_type === "outbound" && term.status === "overdue") {
        return c.json(
          { success: false, error: { message: "rental term overdue; outbound blocked" } },
          400
        );
      }
    }

    const orderNo = await generateSerial(c.env.DB, "RK", "stock_order", "order_no");
    const now = nowIso();
    const overrideStatus = body.override_status ?? "none";
    if (!["none", "requested", "approved"].includes(overrideStatus)) {
      return c.json(
        { success: false, error: { message: "override_status must be none/requested/approved" } },
        400
      );
    }
    const result = await c.env.DB.prepare(
      `INSERT INTO stock_order
        (order_no, order_type, project_id, from_warehouse_id, to_warehouse_id,
         applicant_userid, status, approval_instance_id, rental_term_id,
         override_status, override_reason, override_approver_userid, override_risk_acknowledged,
         executed_at, remark, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'draft', NULL, ?, ?, ?, NULL, ?, NULL, ?, ?, ?)`
    )
      .bind(
        orderNo,
        body.order_type,
        body.project_id ?? null,
        body.from_warehouse_id ?? null,
        body.to_warehouse_id ?? null,
        auth.sub,
        body.rental_term_id ?? null,
        overrideStatus,
        body.override_reason ?? null,
        body.override_risk_acknowledged ?? 0,
        body.remark ?? null,
        now,
        now
      )
      .run();
    const orderId = result.meta.last_row_id as number;

    for (const item of body.items) {
      await c.env.DB.prepare(
        `INSERT INTO stock_order_item
          (stock_order_id, asset_type_id, tracked_asset_id, configuration_role, configuration_group_key,
           requires_modification, quantity, unit, remark, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`
      )
        .bind(
          orderId,
          item.asset_type_id ?? null,
          item.tracked_asset_id ?? null,
          item.configuration_role ?? null,
          item.configuration_group_key ?? null,
          item.requires_modification ?? 0,
          item.quantity,
          item.unit ?? null,
          item.remark ?? null,
          now
        )
        .run();
    }

    return c.json({ success: true, data: { id: orderId, order_no: orderNo } }, 201);
  }
);

warehouseRoutes.put(
  "/stock-order/:id",
  requireRoles(["super_admin", "manager", "site_manager", "operator"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const body = (await c.req.json()) as Partial<CreateStockOrderRequest>;
    const order = await c.env.DB.prepare("SELECT * FROM stock_order WHERE id = ?")
      .bind(id)
      .first<StockOrder>();

    if (!order) return c.json({ success: false, error: { message: "Stock order not found" } }, 404);
    if (order.status !== "draft") {
      return c.json(
        { success: false, error: { message: "Only draft stock order can be edited" } },
        400
      );
    }

    if (body.items !== undefined) {
      if (!Array.isArray(body.items) || body.items.length === 0) {
        return c.json({ success: false, error: { message: "items must not be empty" } }, 400);
      }
      if (body.items.some(item => Number(item.quantity || 0) <= 0)) {
        return c.json({ success: false, error: { message: "item quantity must be > 0" } }, 400);
      }
    }

    const now = nowIso();
    await c.env.DB.prepare(
      `UPDATE stock_order SET
         order_type = COALESCE(?, order_type),
         project_id = CASE WHEN ? IS NULL THEN project_id ELSE ? END,
         from_warehouse_id = CASE WHEN ? IS NULL THEN from_warehouse_id ELSE ? END,
         to_warehouse_id = CASE WHEN ? IS NULL THEN to_warehouse_id ELSE ? END,
         rental_term_id = CASE WHEN ? IS NULL THEN rental_term_id ELSE ? END,
         override_status = COALESCE(?, override_status),
         override_reason = CASE WHEN ? IS NULL THEN override_reason ELSE ? END,
         override_risk_acknowledged = COALESCE(?, override_risk_acknowledged),
         remark = CASE WHEN ? IS NULL THEN remark ELSE ? END,
         updated_at = ?
       WHERE id = ?`
    )
      .bind(
        body.order_type ?? null,
        body.project_id === undefined ? null : body.project_id,
        body.project_id ?? null,
        body.from_warehouse_id === undefined ? null : body.from_warehouse_id,
        body.from_warehouse_id ?? null,
        body.to_warehouse_id === undefined ? null : body.to_warehouse_id,
        body.to_warehouse_id ?? null,
        body.rental_term_id === undefined ? null : body.rental_term_id,
        body.rental_term_id ?? null,
        body.override_status ?? null,
        body.override_reason === undefined ? null : body.override_reason,
        body.override_reason ?? null,
        body.override_risk_acknowledged ?? null,
        body.remark === undefined ? null : body.remark,
        body.remark ?? null,
        now,
        id
      )
      .run();

    if (body.items !== undefined) {
      await c.env.DB.prepare("DELETE FROM stock_order_item WHERE stock_order_id = ?")
        .bind(id)
        .run();

      for (const item of body.items) {
        await c.env.DB.prepare(
          `INSERT INTO stock_order_item
            (stock_order_id, asset_type_id, tracked_asset_id, configuration_role, configuration_group_key,
             requires_modification, quantity, unit, remark, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`
        )
          .bind(
            id,
            item.asset_type_id ?? null,
            item.tracked_asset_id ?? null,
            item.configuration_role ?? null,
            item.configuration_group_key ?? null,
            item.requires_modification ?? 0,
            item.quantity,
            item.unit ?? null,
            item.remark ?? null,
            now
          )
          .run();
      }
    }

    return c.json({ success: true });
  }
);

warehouseRoutes.get(
  "/stock-order/:id/gate-check",
  requireRoles(["super_admin", "manager", "site_manager", "operator"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const order = await c.env.DB.prepare("SELECT * FROM stock_order WHERE id = ?")
      .bind(id)
      .first<StockOrder>();
    if (!order) return c.json({ success: false, error: { message: "Stock order not found" } }, 404);
    const items = await c.env.DB.prepare(
      "SELECT * FROM stock_order_item WHERE stock_order_id = ? AND status = 'active'"
    )
      .bind(id)
      .all<StockOrderItem>();
    const gate = await evaluateStockOrderGate(c.env, order, items.results ?? []);
    return c.json({ success: true, data: gate });
  }
);

warehouseRoutes.post(
  "/stock-order/:id/submit-approval",
  requireRoles(["super_admin", "manager", "site_manager"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const auth = c.get("auth");
    const body = (await c.req.json().catch(() => ({}))) as SubmitStockOrderApprovalRequest;

    const order = await c.env.DB.prepare("SELECT * FROM stock_order WHERE id = ?")
      .bind(id)
      .first<StockOrder>();
    if (!order) return c.json({ success: false, error: { message: "Stock order not found" } }, 404);
    if (order.status !== "draft") {
      return c.json(
        { success: false, error: { message: "Only draft stock order can submit approval" } },
        400
      );
    }

    if (order.approval_instance_id) {
      const existing = await c.env.DB.prepare("SELECT status FROM approval_instance WHERE id = ?")
        .bind(order.approval_instance_id)
        .first<{ status: string }>();
      const decision = existing
        ? getExistingApprovalSubmissionDecision(existing.status)
        : "new";

      if (decision === "active") {
        return c.json(
          { success: false, error: { message: "Approval instance already in progress" } },
          400
        );
      }

      if (decision === "resubmit") {
        await resubmitOp(c.env, order.approval_instance_id, auth.sub, body.biz_summary);
        await c.env.DB.prepare(
          "UPDATE stock_order SET status = 'pending_approval', approval_instance_id = ?, updated_at = ? WHERE id = ?"
        )
          .bind(order.approval_instance_id, nowIso(), id)
          .run();
        return c.json({
          success: true,
          data: {
            approval_instance_id: order.approval_instance_id,
            instance_no: "",
            resubmitted: true
          }
        });
      }
    }

    const instance = await submitForApproval(
      c.env,
      {
        biz_type: "stock_order",
        biz_id: id,
        biz_summary: body.biz_summary?.trim() || `${order.order_no} | ${order.order_type}`,
        context: {
          biz_type: "stock_order",
          biz_id: id,
          project_id: order.project_id ?? undefined
        },
        instance_config: body.instance_config
      },
      auth.sub,
      createAiGateHandler()
    );

    await c.env.DB.prepare(
      "UPDATE stock_order SET status = 'pending_approval', approval_instance_id = ?, updated_at = ? WHERE id = ?"
    )
      .bind(instance.id, nowIso(), id)
      .run();

    return c.json({
      success: true,
      data: { approval_instance_id: instance.id, instance_no: instance.instance_no }
    });
  }
);

warehouseRoutes.post(
  "/stock-order/:id/execute",
  requireRoles(["super_admin", "manager", "site_manager"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const order = await c.env.DB.prepare("SELECT * FROM stock_order WHERE id = ?")
      .bind(id)
      .first<StockOrder>();
    if (!order) return c.json({ success: false, error: { message: "Stock order not found" } }, 404);
    if (order.status !== "approved") {
      return c.json(
        { success: false, error: { message: "Only approved stock order can execute" } },
        400
      );
    }

    await applyStockOrderExecution(c.env, order);
    await c.env.DB.prepare(
      "UPDATE stock_order SET status = 'executed', executed_at = ?, updated_at = ? WHERE id = ?"
    )
      .bind(nowIso(), nowIso(), id)
      .run();

    return c.json({ success: true });
  }
);

warehouseRoutes.post(
  "/stock-order/:id/override",
  requireRoles(["super_admin", "manager"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const auth = c.get("auth");
    const body = (await c.req.json()) as ReviewStockOrderOverrideRequest;
    if (!["request", "approve", "reject"].includes(body.action)) {
      return c.json(
        { success: false, error: { message: "action must be request/approve/reject" } },
        400
      );
    }

    const order = await c.env.DB.prepare("SELECT * FROM stock_order WHERE id = ?")
      .bind(id)
      .first<StockOrder>();
    if (!order) return c.json({ success: false, error: { message: "Stock order not found" } }, 404);

    const nextStatus =
      body.action === "request" ? "requested" : body.action === "approve" ? "approved" : "rejected";
    const nextReason = body.override_reason?.trim() || order.override_reason;
    const nextRiskAcknowledged =
      body.override_risk_acknowledged === undefined
        ? order.override_risk_acknowledged
        : body.override_risk_acknowledged;
    if (body.action === "approve" && (!nextReason?.trim() || nextRiskAcknowledged !== 1)) {
      return c.json(
        {
          success: false,
          error: {
            message: "override approve requires override_reason and override_risk_acknowledged=1"
          }
        },
        400
      );
    }

    await c.env.DB.prepare(
      `UPDATE stock_order SET
         override_status = ?,
         override_reason = ?,
         override_approver_userid = ?,
         override_risk_acknowledged = ?,
         updated_at = ?
       WHERE id = ?`
    )
      .bind(nextStatus, nextReason ?? null, auth.sub, nextRiskAcknowledged, nowIso(), id)
      .run();
    return c.json({ success: true, data: { override_status: nextStatus } });
  }
);

warehouseRoutes.post(
  "/stock-order/:id/cancel",
  requireRoles(["super_admin", "manager"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    await c.env.DB.prepare(
      "UPDATE stock_order SET status = 'cancelled', updated_at = ? WHERE id = ?"
    )
      .bind(nowIso(), id)
      .run();
    return c.json({ success: true });
  }
);

warehouseRoutes.get(
  "/stocktake",
  requireRoles(["super_admin", "manager", "site_manager", "operator"]),
  async (c) => {
    const status = c.req.query("status");
    const warehouseId = c.req.query("warehouse_id");
    let sql =
      "SELECT st.*, w.warehouse_name FROM stocktake_task st LEFT JOIN warehouse w ON w.id = st.warehouse_id WHERE 1=1";
    const params: Array<string | number> = [];
    if (status) {
      sql += " AND st.status = ?";
      params.push(status);
    }
    if (warehouseId) {
      sql += " AND st.warehouse_id = ?";
      params.push(Number(warehouseId));
    }
    sql += " ORDER BY st.id DESC";
    const rows = await c.env.DB.prepare(sql)
      .bind(...params)
      .all<StocktakeTask & { warehouse_name: string | null }>();
    return c.json({ success: true, data: rows.results ?? [] });
  }
);

warehouseRoutes.get(
  "/stocktake/:id",
  requireRoles(["super_admin", "manager", "site_manager", "operator"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const task = await c.env.DB.prepare(
      "SELECT st.*, w.warehouse_name FROM stocktake_task st LEFT JOIN warehouse w ON w.id = st.warehouse_id WHERE st.id = ?"
    )
      .bind(id)
      .first<StocktakeTask & { warehouse_name: string | null }>();
    if (!task)
      return c.json({ success: false, error: { message: "Stocktake task not found" } }, 404);

    const lines = await c.env.DB.prepare(
      `SELECT sl.*, w.warehouse_name
       FROM stocktake_line sl
       LEFT JOIN warehouse w ON w.id = sl.warehouse_id
       WHERE sl.stocktake_task_id = ?
       ORDER BY sl.id DESC`
    )
      .bind(id)
      .all<StocktakeLine & { warehouse_name: string | null }>();

    return c.json({ success: true, data: { ...task, lines: lines.results ?? [] } });
  }
);

warehouseRoutes.post(
  "/stocktake",
  requireRoles(["super_admin", "manager", "site_manager", "operator"]),
  async (c) => {
    const auth = c.get("auth");
    const body = (await c.req.json()) as CreateStocktakeTaskRequest;

    if (!body.task_title?.trim() || !body.planned_date) {
      return c.json(
        { success: false, error: { message: "task_title and planned_date are required" } },
        400
      );
    }
    if (body.scope !== "company" && body.scope !== "warehouse") {
      return c.json(
        { success: false, error: { message: "scope must be company or warehouse" } },
        400
      );
    }
    if (body.scope === "warehouse" && !body.warehouse_id) {
      return c.json(
        { success: false, error: { message: "warehouse scope requires warehouse_id" } },
        400
      );
    }

    const taskNo = await generateSerial(c.env.DB, "PK", "stocktake_task", "task_no");
    const now = nowIso();
    const result = await c.env.DB.prepare(
      `INSERT INTO stocktake_task
       (task_no, task_title, scope, warehouse_id, planned_date, status, creator_userid, completed_at, remark, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'counting', ?, NULL, ?, ?, ?)`
    )
      .bind(
        taskNo,
        body.task_title.trim(),
        body.scope,
        body.scope === "warehouse" ? (body.warehouse_id ?? null) : null,
        body.planned_date,
        auth.sub,
        body.remark ?? null,
        now,
        now
      )
      .run();

    const taskId = result.meta.last_row_id as number;
    const initialLines = await buildInitialStocktakeLines(
      c.env,
      body.scope,
      body.scope === "warehouse" ? body.warehouse_id : undefined
    );

    for (const line of initialLines) {
      await c.env.DB.prepare(
        `INSERT INTO stocktake_line
         (stocktake_task_id, warehouse_id, item_kind, asset_type_id, tracked_asset_id, item_name, unit,
          expected_qty, counted_qty, diff_qty, line_status, note, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          taskId,
          line.warehouse_id,
          line.item_kind,
          line.asset_type_id,
          line.tracked_asset_id,
          line.item_name,
          line.unit,
          line.expected_qty,
          line.counted_qty,
          line.diff_qty,
          line.line_status,
          line.note,
          now,
          now
        )
        .run();
    }

    return c.json({ success: true, data: { id: taskId, task_no: taskNo } }, 201);
  }
);

warehouseRoutes.post(
  "/stocktake/:id/line",
  requireRoles(["super_admin", "manager", "site_manager", "operator"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const body = (await c.req.json()) as AddStocktakeLineRequest;
    const task = await c.env.DB.prepare("SELECT * FROM stocktake_task WHERE id = ?")
      .bind(id)
      .first<StocktakeTask>();
    if (!task)
      return c.json({ success: false, error: { message: "Stocktake task not found" } }, 404);
    if (task.status === "completed") {
      return c.json(
        { success: false, error: { message: "Completed stocktake cannot add new lines" } },
        400
      );
    }
    if (!body.warehouse_id || !body.item_kind || Number(body.counted_qty) <= 0) {
      return c.json(
        { success: false, error: { message: "warehouse_id, item_kind, counted_qty are required" } },
        400
      );
    }
    if (body.item_kind !== "asset" && body.item_kind !== "consumable") {
      return c.json(
        { success: false, error: { message: "item_kind must be asset or consumable" } },
        400
      );
    }

    let lineStatus: "normal" | "new" | "damaged" | "lost";
    try {
      lineStatus = ensureStocktakeLineStatus(body.line_status ?? "new");
    } catch (error) {
      return c.json({ success: false, error: { message: (error as Error).message } }, 400);
    }

    let itemName = body.item_name?.trim() ?? "";
    let unit = body.unit?.trim() || "件";
    let assetTypeId: number | null = null;
    let trackedAssetId: number | null = null;

    if (body.asset_type_id) {
      const type = await c.env.DB.prepare(
        "SELECT * FROM asset_type WHERE id = ? AND status != 'deleted'"
      )
        .bind(body.asset_type_id)
        .first<{ id: number; type_name: string; unit: string | null; tracked_flag: number }>();
      if (!type)
        return c.json({ success: false, error: { message: "asset_type_id not found" } }, 404);
      if (body.item_kind === "asset" && type.tracked_flag !== 1) {
        return c.json(
          { success: false, error: { message: "asset lines require tracked asset type" } },
          400
        );
      }
      if (body.item_kind === "consumable" && type.tracked_flag !== 0) {
        return c.json(
          { success: false, error: { message: "consumable lines require untracked asset type" } },
          400
        );
      }
      assetTypeId = type.id;
      if (!itemName) itemName = type.type_name;
      if (type.unit) unit = type.unit;
    }

    if (body.tracked_asset_id) {
      const asset = await c.env.DB.prepare("SELECT id, asset_name FROM tracked_asset WHERE id = ?")
        .bind(body.tracked_asset_id)
        .first<{ id: number; asset_name: string }>();
      if (!asset)
        return c.json({ success: false, error: { message: "tracked_asset_id not found" } }, 404);
      trackedAssetId = asset.id;
      if (!itemName) itemName = asset.asset_name;
    }

    if (!itemName) {
      return c.json(
        { success: false, error: { message: "item_name or asset_type_id is required" } },
        400
      );
    }

    const countedQty = Number(body.counted_qty);
    const now = nowIso();
    const result = await c.env.DB.prepare(
      `INSERT INTO stocktake_line
       (stocktake_task_id, warehouse_id, item_kind, asset_type_id, tracked_asset_id, item_name, unit,
        expected_qty, counted_qty, diff_qty, line_status, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        id,
        body.warehouse_id,
        body.item_kind,
        assetTypeId,
        trackedAssetId,
        itemName,
        unit,
        countedQty,
        countedQty,
        lineStatus,
        body.note ?? null,
        now,
        now
      )
      .run();

    await c.env.DB.prepare("UPDATE stocktake_task SET updated_at = ? WHERE id = ?")
      .bind(now, id)
      .run();

    return c.json({ success: true, data: { id: result.meta.last_row_id } }, 201);
  }
);

warehouseRoutes.put(
  "/stocktake/:id/line/:lineId",
  requireRoles(["super_admin", "manager", "site_manager", "operator"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const lineId = Number(c.req.param("lineId"));
    const body = (await c.req.json()) as UpdateStocktakeLineRequest;

    const line = await c.env.DB.prepare(
      "SELECT * FROM stocktake_line WHERE id = ? AND stocktake_task_id = ?"
    )
      .bind(lineId, id)
      .first<StocktakeLine>();
    if (!line)
      return c.json({ success: false, error: { message: "Stocktake line not found" } }, 404);

    let lineStatus: "normal" | "new" | "damaged" | "lost";
    try {
      lineStatus = ensureStocktakeLineStatus(body.line_status ?? line.line_status);
    } catch (error) {
      return c.json({ success: false, error: { message: (error as Error).message } }, 400);
    }

    const countedQty =
      body.counted_qty === undefined
        ? line.counted_qty
        : body.counted_qty === null
          ? null
          : Number(body.counted_qty);

    if (countedQty !== null && countedQty < 0) {
      return c.json({ success: false, error: { message: "counted_qty must be >= 0" } }, 400);
    }

    const diffQty = countedQty === null ? 0 : Number((countedQty - line.expected_qty).toFixed(2));
    const now = nowIso();

    await c.env.DB.prepare(
      `UPDATE stocktake_line SET
         counted_qty = ?,
         diff_qty = ?,
         line_status = ?,
         note = COALESCE(?, note),
         updated_at = ?
       WHERE id = ? AND stocktake_task_id = ?`
    )
      .bind(countedQty, diffQty, lineStatus, body.note ?? null, now, lineId, id)
      .run();

    await c.env.DB.prepare("UPDATE stocktake_task SET updated_at = ? WHERE id = ?")
      .bind(now, id)
      .run();

    return c.json({ success: true });
  }
);

warehouseRoutes.post(
  "/stocktake/:id/complete",
  requireRoles(["super_admin", "manager", "site_manager", "operator"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const task = await c.env.DB.prepare("SELECT * FROM stocktake_task WHERE id = ?")
      .bind(id)
      .first<StocktakeTask>();
    if (!task)
      return c.json({ success: false, error: { message: "Stocktake task not found" } }, 404);
    if (task.status === "completed") {
      return c.json(
        { success: false, error: { message: "Stocktake task already completed" } },
        400
      );
    }

    const pending = await c.env.DB.prepare(
      "SELECT COUNT(*) as cnt FROM stocktake_line WHERE stocktake_task_id = ? AND counted_qty IS NULL"
    )
      .bind(id)
      .first<{ cnt: number }>();
    if ((pending?.cnt ?? 0) > 0) {
      return c.json(
        { success: false, error: { message: "All stocktake lines must have counted_qty" } },
        400
      );
    }

    const now = nowIso();
    await c.env.DB.prepare(
      "UPDATE stocktake_task SET status = 'completed', completed_at = ?, updated_at = ? WHERE id = ?"
    )
      .bind(now, now, id)
      .run();

    const summary = await c.env.DB.prepare(
      `SELECT COUNT(*) as total,
              SUM(CASE WHEN diff_qty != 0 THEN 1 ELSE 0 END) as diff_count,
              SUM(diff_qty) as diff_total
       FROM stocktake_line WHERE stocktake_task_id = ?`
    )
      .bind(id)
      .first<{ total: number; diff_count: number; diff_total: number }>();

    return c.json({
      success: true,
      data: {
        status: "completed",
        completed_at: now,
        total: summary?.total ?? 0,
        diff_count: summary?.diff_count ?? 0,
        diff_total: Number(summary?.diff_total ?? 0)
      }
    });
  }
);

warehouseRoutes.get(
  "/equipment-plan",
  requireRoles(["super_admin", "manager", "site_manager", "operator"]),
  async (c) => {
    const projectId = c.req.query("project_id");
    let sql = "SELECT * FROM project_equipment_plan WHERE 1=1";
    const params: (string | number)[] = [];
    if (projectId) {
      sql += " AND project_id = ?";
      params.push(Number(projectId));
    }
    sql += " ORDER BY id DESC";
    const rows = await c.env.DB.prepare(sql)
      .bind(...params)
      .all<ProjectEquipmentPlan>();
    return c.json({ success: true, data: rows.results ?? [] });
  }
);

warehouseRoutes.get(
  "/equipment-plan/:id",
  requireRoles(["super_admin", "manager", "site_manager", "operator"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const plan = await c.env.DB.prepare("SELECT * FROM project_equipment_plan WHERE id = ?")
      .bind(id)
      .first<ProjectEquipmentPlan>();
    if (!plan) return c.json({ success: false, error: { message: "Plan not found" } }, 404);

    const items = await c.env.DB.prepare(
      "SELECT * FROM project_equipment_plan_item WHERE plan_id = ? ORDER BY id ASC"
    )
      .bind(id)
      .all();
    return c.json({ success: true, data: { ...plan, items: items.results ?? [] } });
  }
);

warehouseRoutes.post(
  "/equipment-plan",
  requireRoles(["super_admin", "manager", "site_manager", "operator"]),
  async (c) => {
    const auth = c.get("auth");
    const body = (await c.req.json()) as CreateEquipmentPlanRequest;

    if (!body.project_id || !body.items || body.items.length === 0) {
      return c.json(
        { success: false, error: { message: "project_id and items are required" } },
        400
      );
    }

    const planNo = await generateSerial(c.env.DB, "EP", "project_equipment_plan", "plan_no");
    const now = nowIso();
    const result = await c.env.DB.prepare(
      `INSERT INTO project_equipment_plan
        (plan_no, project_id, applicant_userid, plan_status, ai_status, ai_task_id,
         recommendation_result_json, stock_order_id, remark, created_at, updated_at)
       VALUES (?, ?, ?, 'draft', 'none', NULL, NULL, NULL, ?, ?, ?)`
    )
      .bind(planNo, body.project_id, auth.sub, body.remark ?? null, now, now)
      .run();
    const planId = result.meta.last_row_id as number;

    for (const item of body.items) {
      await c.env.DB.prepare(
        `INSERT INTO project_equipment_plan_item
          (plan_id, asset_type_id, planned_qty, recommended_qty, source, note, created_at)
         VALUES (?, ?, ?, NULL, NULL, ?, ?)`
      )
        .bind(planId, item.asset_type_id, item.planned_qty, item.note ?? null, now)
        .run();
    }

    return c.json({ success: true, data: { id: planId, plan_no: planNo } }, 201);
  }
);

warehouseRoutes.post(
  "/equipment-plan/:id/trigger-recommend",
  requireRoles(["super_admin", "manager", "site_manager"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const plan = await c.env.DB.prepare("SELECT * FROM project_equipment_plan WHERE id = ?")
      .bind(id)
      .first<ProjectEquipmentPlan>();
    if (!plan) return c.json({ success: false, error: { message: "Plan not found" } }, 404);

    const items = await c.env.DB.prepare(
      "SELECT * FROM project_equipment_plan_item WHERE plan_id = ? ORDER BY id ASC"
    )
      .bind(id)
      .all();

    const task = await createTask(c.env, {
      task_type: "equipment_recommend",
      biz_type: "project_equipment_plan",
      biz_id: id,
      priority: 4,
      payload: {
        plan_id: id,
        plan_no: plan.plan_no,
        project_id: plan.project_id,
        items: items.results ?? []
      },
      timeout_seconds: 600
    });

    await c.env.DB.prepare(
      "UPDATE project_equipment_plan SET ai_status = 'pending', ai_task_id = ?, updated_at = ? WHERE id = ?"
    )
      .bind(task.id, nowIso(), id)
      .run();

    return c.json({ success: true, data: { task_id: task.id, ai_status: "pending" } });
  }
);

warehouseRoutes.get(
  "/equipment-plan/:id/recommendation",
  requireRoles(["super_admin", "manager", "site_manager", "operator"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const plan = await c.env.DB.prepare("SELECT * FROM project_equipment_plan WHERE id = ?")
      .bind(id)
      .first<ProjectEquipmentPlan>();
    if (!plan) return c.json({ success: false, error: { message: "Plan not found" } }, 404);

    if (!plan.ai_task_id) {
      return c.json({
        success: true,
        data: { status: plan.ai_status, task_id: null, result: null }
      });
    }

    const task = await c.env.DB.prepare("SELECT status, result_json FROM task_queue WHERE id = ?")
      .bind(plan.ai_task_id)
      .first<{ status: string; result_json: string | null }>();
    const result = parseTaskResult(task?.result_json ?? null);

    if (task?.status === "completed" && plan.ai_status !== "completed") {
      await c.env.DB.prepare(
        "UPDATE project_equipment_plan SET ai_status = 'completed', recommendation_result_json = ?, updated_at = ? WHERE id = ?"
      )
        .bind(result ? JSON.stringify(result) : null, nowIso(), id)
        .run();
    }

    if ((task?.status === "failed" || task?.status === "timeout") && plan.ai_status !== "failed") {
      await c.env.DB.prepare(
        "UPDATE project_equipment_plan SET ai_status = 'failed', updated_at = ? WHERE id = ?"
      )
        .bind(nowIso(), id)
        .run();
    }

    return c.json({
      success: true,
      data: {
        status:
          task?.status === "completed"
            ? "completed"
            : task?.status === "failed" || task?.status === "timeout"
              ? "failed"
              : plan.ai_status,
        task_id: plan.ai_task_id,
        result
      }
    });
  }
);

warehouseRoutes.post(
  "/equipment-plan/:id/confirm",
  requireRoles(["super_admin", "manager", "site_manager"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const auth = c.get("auth");
    const body = (await c.req.json()) as ConfirmEquipmentPlanRequest;

    const plan = await c.env.DB.prepare("SELECT * FROM project_equipment_plan WHERE id = ?")
      .bind(id)
      .first<ProjectEquipmentPlan>();
    if (!plan) return c.json({ success: false, error: { message: "Plan not found" } }, 404);
    if (!body.from_warehouse_id) {
      return c.json({ success: false, error: { message: "from_warehouse_id is required" } }, 400);
    }

    const items = await c.env.DB.prepare(
      "SELECT * FROM project_equipment_plan_item WHERE plan_id = ? ORDER BY id ASC"
    )
      .bind(id)
      .all<{
        asset_type_id: number;
        planned_qty: number;
        recommended_qty: number | null;
      }>();
    if ((items.results ?? []).length === 0) {
      return c.json({ success: false, error: { message: "Plan has no items" } }, 400);
    }

    const orderNo = await generateSerial(c.env.DB, "RK", "stock_order", "order_no");
    const orderResult = await c.env.DB.prepare(
      `INSERT INTO stock_order
        (order_no, order_type, project_id, from_warehouse_id, to_warehouse_id, applicant_userid,
         status, approval_instance_id, executed_at, remark, created_at, updated_at)
       VALUES (?, 'outbound', ?, ?, NULL, ?, 'draft', NULL, NULL, ?, ?, ?)`
    )
      .bind(
        orderNo,
        plan.project_id,
        body.from_warehouse_id,
        auth.sub,
        body.note ?? null,
        nowIso(),
        nowIso()
      )
      .run();
    const stockOrderId = orderResult.meta.last_row_id as number;

    for (const item of items.results ?? []) {
      const qty = item.recommended_qty ?? item.planned_qty;
      await c.env.DB.prepare(
        `INSERT INTO stock_order_item
          (stock_order_id, asset_type_id, tracked_asset_id, quantity, unit, remark, status, created_at)
         VALUES (?, ?, NULL, ?, NULL, NULL, 'active', ?)`
      )
        .bind(stockOrderId, item.asset_type_id, qty, nowIso())
        .run();
    }

    await c.env.DB.prepare(
      "UPDATE project_equipment_plan SET plan_status = 'confirmed', stock_order_id = ?, updated_at = ? WHERE id = ?"
    )
      .bind(stockOrderId, nowIso(), id)
      .run();

    return c.json({ success: true, data: { stock_order_id: stockOrderId, order_no: orderNo } });
  }
);
