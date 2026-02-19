import { Hono } from "hono";

import { authMiddleware, type AuthVariables } from "../middleware/auth";
import { requireRoles } from "../middleware/rbac";
import { createTask } from "../services/ai-slot";
import { submitForApproval } from "../services/approval/engine";
import { generateSerial } from "../services/serial";
import type { Env } from "../types/env";
import type { TrackedAsset } from "../types/asset";
import type {
  ConfirmEquipmentPlanRequest,
  CreateEquipmentPlanRequest,
  CreateStockOrderRequest,
  CreateWarehouseRequest,
  InventoryRow,
  ProjectEquipmentPlan,
  StockOrder,
  SubmitStockOrderApprovalRequest,
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
    throw new Error(`Inventory insufficient for warehouse=${warehouseId}, asset_type=${assetTypeId}`);
  }

  await db
    .prepare("UPDATE inventory SET quantity = ?, updated_at = ? WHERE id = ?")
    .bind(next, nowIso(), row.id)
    .run();
  return next;
};

const applyStockOrderExecution = async (env: Env, order: StockOrder): Promise<void> => {
  const items = await env.DB.prepare("SELECT * FROM stock_order_item WHERE stock_order_id = ? AND status = 'active'")
    .bind(order.id)
    .all<{
      id: number;
      asset_type_id: number | null;
      tracked_asset_id: number | null;
      quantity: number;
    }>();

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
        await env.DB.prepare(
          "UPDATE tracked_asset SET current_project_id = NULL, current_warehouse_id = ?, current_location = 'warehouse', status = 'idle', updated_at = ? WHERE id = ?"
        )
          .bind(order.to_warehouse_id ?? order.from_warehouse_id ?? null, nowIso(), asset.id)
          .run();
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
          `Stock order ${order.order_no} executed`,
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
    const rows = await c.env.DB.prepare(sql).bind(...params).all<Warehouse>();
    return c.json({ success: true, data: rows.results ?? [] });
  }
);

warehouseRoutes.post(
  "/",
  requireRoles(["super_admin", "manager"]),
  async (c) => {
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
  }
);

warehouseRoutes.put(
  "/:id",
  requireRoles(["super_admin", "manager"]),
  async (c) => {
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
  }
);

warehouseRoutes.delete(
  "/:id",
  requireRoles(["super_admin", "manager"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    await c.env.DB.prepare("UPDATE warehouse SET status = 'deleted', updated_at = ? WHERE id = ?")
      .bind(nowIso(), id)
      .run();
    return c.json({ success: true });
  }
);

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

    const rows = await c.env.DB.prepare(sql).bind(...params).all();
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
    if (!inventory) return c.json({ success: false, error: { message: "Inventory row not found" } }, 404);

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
        { success: false, error: { message: "warehouse_id, asset_type_id, quantity are required" } },
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
    const rows = await c.env.DB.prepare(sql).bind(...params).all<StockOrder>();
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
      return c.json({ success: false, error: { message: "order_type and items are required" } }, 400);
    }

    const orderNo = await generateSerial(c.env.DB, "RK", "stock_order", "order_no");
    const now = nowIso();
    const result = await c.env.DB.prepare(
      `INSERT INTO stock_order
        (order_no, order_type, project_id, from_warehouse_id, to_warehouse_id,
         applicant_userid, status, approval_instance_id, executed_at, remark, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'draft', NULL, NULL, ?, ?, ?)`
    )
      .bind(
        orderNo,
        body.order_type,
        body.project_id ?? null,
        body.from_warehouse_id ?? null,
        body.to_warehouse_id ?? null,
        auth.sub,
        body.remark ?? null,
        now,
        now
      )
      .run();
    const orderId = result.meta.last_row_id as number;

    for (const item of body.items) {
      await c.env.DB.prepare(
        `INSERT INTO stock_order_item
          (stock_order_id, asset_type_id, tracked_asset_id, quantity, unit, remark, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'active', ?)`
      )
        .bind(
          orderId,
          item.asset_type_id ?? null,
          item.tracked_asset_id ?? null,
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
      return c.json({ success: false, error: { message: "Only draft stock order can submit approval" } }, 400);
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
      auth.sub
    );

    await c.env.DB.prepare(
      "UPDATE stock_order SET status = 'pending_approval', approval_instance_id = ?, updated_at = ? WHERE id = ?"
    )
      .bind(instance.id, nowIso(), id)
      .run();

    return c.json({ success: true, data: { approval_instance_id: instance.id, instance_no: instance.instance_no } });
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
      return c.json({ success: false, error: { message: "Only approved stock order can execute" } }, 400);
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
  "/stock-order/:id/cancel",
  requireRoles(["super_admin", "manager"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    await c.env.DB.prepare("UPDATE stock_order SET status = 'cancelled', updated_at = ? WHERE id = ?")
      .bind(nowIso(), id)
      .run();
    return c.json({ success: true });
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
    const rows = await c.env.DB.prepare(sql).bind(...params).all<ProjectEquipmentPlan>();
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

    const items = await c.env.DB.prepare("SELECT * FROM project_equipment_plan_item WHERE plan_id = ? ORDER BY id ASC")
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
      return c.json({ success: false, error: { message: "project_id and items are required" } }, 400);
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

    const items = await c.env.DB.prepare("SELECT * FROM project_equipment_plan_item WHERE plan_id = ? ORDER BY id ASC")
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
      return c.json({ success: true, data: { status: plan.ai_status, task_id: null, result: null } });
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
      .bind(orderNo, plan.project_id, body.from_warehouse_id, auth.sub, body.note ?? null, nowIso(), nowIso())
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
