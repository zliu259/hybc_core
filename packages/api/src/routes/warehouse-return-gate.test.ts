import { describe, expect, it } from "vitest";

import {
  reviewWarehouseTask,
  startWarehouseTask,
  submitWarehouseTask
} from "../services/warehouse-task";
import type { TrackedAsset } from "../types/asset";
import type { Env } from "../types/env";
import type { StockOrder, StockOrderItem } from "../types/warehouse";
import type { WarehouseAssetWorkOrder, WarehouseTaskEvidence } from "../types/work-order";
import { applyStockOrderExecution, evaluateStockOrderGate } from "./warehouse";

type D1RunResult = {
  meta: {
    last_row_id: number;
  };
};

class WarehouseFlowStatement {
  private params: unknown[] = [];

  constructor(
    private readonly db: WarehouseFlowDb,
    private readonly sql: string
  ) {}

  bind(...params: unknown[]) {
    this.params = params;
    return this;
  }

  async first<T>(): Promise<T | null> {
    return this.db.first<T>(this.sql, this.params);
  }

  async all<T>(): Promise<{ results: T[] }> {
    return this.db.all<T>(this.sql, this.params);
  }

  async run(): Promise<D1RunResult> {
    return this.db.run(this.sql, this.params);
  }
}

class WarehouseFlowDb {
  readonly assets = new Map<number, TrackedAsset>();
  readonly stockItems: StockOrderItem[] = [];
  readonly workOrders: WarehouseAssetWorkOrder[] = [];
  readonly evidence: WarehouseTaskEvidence[] = [];
  readonly events: Array<{ sql: string; params: unknown[] }> = [];

  private nextWorkOrderId = 1;
  private nextEvidenceId = 1;

  prepare(sql: string) {
    return new WarehouseFlowStatement(this, sql);
  }

  async first<T>(sql: string, params: unknown[]): Promise<T | null> {
    if (sql.includes("SELECT COUNT(*) as cnt FROM warehouse_asset_work_order")) {
      return { cnt: this.workOrders.length } as T;
    }

    if (
      sql.includes("FROM warehouse_asset_work_order") &&
      sql.includes("tracked_asset_id = ?") &&
      sql.includes("work_order_type = 'maintenance'")
    ) {
      const trackedAssetId = Number(params[0]);
      return (
        (this.workOrders
          .filter(
            (item) =>
              item.tracked_asset_id === trackedAssetId &&
              item.source === "return_receipt" &&
              item.work_order_type === "maintenance" &&
              !["completed", "cancelled"].includes(item.status)
          )
          .sort((left, right) => right.id - left.id)[0] as T | undefined) ?? null
      );
    }

    if (
      sql.includes("FROM warehouse_asset_work_order") &&
      sql.includes("tracked_asset_id = ?") &&
      sql.includes("stock_order_id = ?") &&
      sql.includes("source = 'return_receipt'")
    ) {
      const trackedAssetId = Number(params[0]);
      const stockOrderId = Number(params[1]);
      return (
        (this.workOrders
          .filter(
            (item) =>
              item.tracked_asset_id === trackedAssetId &&
              item.stock_order_id === stockOrderId &&
              item.source === "return_receipt" &&
              !["completed", "cancelled"].includes(item.status)
          )
          .sort((left, right) => right.id - left.id)[0] as T | undefined) ?? null
      );
    }

    if (sql.includes("FROM warehouse_asset_work_order") && sql.includes("blocking_flag = 1")) {
      const trackedAssetId = Number(params[0]);
      return (
        (this.workOrders
          .filter(
            (item) =>
              item.tracked_asset_id === trackedAssetId &&
              item.blocking_flag === 1 &&
              [
                "draft",
                "pending_assignment",
                "assigned",
                "pending_approval",
                "approved",
                "in_progress",
                "submitted",
                "rejected"
              ].includes(item.status)
          )
          .sort((left, right) => right.id - left.id)[0] as T | undefined) ?? null
      );
    }

    if (sql.includes("FROM warehouse_asset_work_order WHERE id = ?")) {
      return (
        (this.workOrders.find((item) => item.id === Number(params[0])) as T | undefined) ?? null
      );
    }

    if (sql.includes("FROM tracked_asset WHERE id = ?")) {
      return (this.assets.get(Number(params[0])) as T | undefined) ?? null;
    }

    if (sql.includes("FROM stock_order_item") && sql.includes("configuration_role")) {
      const stockOrderId = Number(params[0]);
      const trackedAssetId = Number(params[1]);
      return (
        (this.stockItems.find(
          (item) =>
            item.stock_order_id === stockOrderId &&
            item.tracked_asset_id === trackedAssetId &&
            item.status === "active"
        ) as T | undefined) ?? null
      );
    }

    throw new Error(`Unhandled first SQL: ${sql}`);
  }

  async all<T>(sql: string, params: unknown[]): Promise<{ results: T[] }> {
    if (sql.includes("FROM warehouse_manual_binding")) {
      return { results: [] };
    }

    if (sql.includes("FROM warehouse_task_evidence") && sql.includes("GROUP BY evidence_type")) {
      const workOrderId = Number(params[0]);
      const counts = new Map<string, number>();
      for (const item of this.evidence.filter(
        (evidence) => evidence.work_order_id === workOrderId
      )) {
        counts.set(item.evidence_type, (counts.get(item.evidence_type) ?? 0) + 1);
      }
      return {
        results: [...counts.entries()].map(([evidence_type, evidence_count]) => ({
          evidence_type,
          evidence_count
        })) as T[]
      };
    }

    if (sql.includes("FROM stock_order_item WHERE stock_order_id = ?")) {
      const stockOrderId = Number(params[0]);
      return {
        results: this.stockItems.filter(
          (item) => item.stock_order_id === stockOrderId && item.status === "active"
        ) as T[]
      };
    }

    throw new Error(`Unhandled all SQL: ${sql}`);
  }

  async run(sql: string, params: unknown[]): Promise<D1RunResult> {
    if (sql.includes("UPDATE tracked_asset SET current_project_id = ?")) {
      const id = Number(params[2]);
      const asset = this.requireAsset(id);
      this.assets.set(id, {
        ...asset,
        current_project_id: params[0] as number | null,
        current_warehouse_id: null,
        current_location: "project",
        status: "using",
        updated_at: params[1] as string
      });
      return { meta: { last_row_id: 0 } };
    }

    if (sql.includes("UPDATE tracked_asset SET current_project_id = NULL")) {
      const id = Number(params[3]);
      const asset = this.requireAsset(id);
      this.assets.set(id, {
        ...asset,
        current_project_id: null,
        current_warehouse_id: params[0] as number | null,
        current_location: "warehouse",
        status: params[1] as string,
        updated_at: params[2] as string
      });
      return { meta: { last_row_id: 0 } };
    }

    if (sql.includes("UPDATE tracked_asset SET status = ?")) {
      const id = Number(params[2]);
      const asset = this.requireAsset(id);
      this.assets.set(id, {
        ...asset,
        status: params[0] as string,
        updated_at: params[1] as string
      });
      return { meta: { last_row_id: 0 } };
    }

    if (sql.includes("INSERT INTO warehouse_asset_work_order")) {
      const id = this.nextWorkOrderId;
      this.nextWorkOrderId += 1;
      this.workOrders.push({
        id,
        work_order_no: params[0] as string,
        work_order_type: params[1] as WarehouseAssetWorkOrder["work_order_type"],
        tracked_asset_id: params[2] as number | null,
        tracked_asset_configuration_id: params[3] as number | null,
        stock_order_id: params[4] as number | null,
        project_id: params[5] as number | null,
        warehouse_id: params[6] as number | null,
        applicant_userid: params[7] as string,
        assignee_userid: params[8] as string | null,
        blocking_flag: params[9] as number,
        status: params[10] as WarehouseAssetWorkOrder["status"],
        approval_instance_id: null,
        source: params[11] as WarehouseAssetWorkOrder["source"],
        priority: params[12] as WarehouseAssetWorkOrder["priority"],
        package_id: params[13] as number | null,
        assigned_by_userid: null,
        reviewer_userid: null,
        submitted_at: null,
        reviewed_at: null,
        manual_version_id: params[14] as number | null,
        mobile_enabled: params[15] as number,
        required_photo_count: params[16] as number,
        completion_summary_json: null,
        scheduled_date: params[17] as string | null,
        started_at: null,
        completed_at: null,
        result_summary: null,
        remark: params[18] as string | null,
        created_at: params[19] as string,
        updated_at: params[20] as string
      });
      return { meta: { last_row_id: id } };
    }

    if (sql.includes("UPDATE warehouse_asset_work_order SET") && sql.includes("reviewer_userid")) {
      const id = Number(params[7]);
      this.updateWorkOrder(id, {
        status: params[0] as WarehouseAssetWorkOrder["status"],
        reviewer_userid: params[1] as string,
        reviewed_at: params[2] as string,
        completed_at:
          params[3] === "completed"
            ? (params[4] as string)
            : this.requireWorkOrder(id).completed_at,
        result_summary: (params[5] as string | null) ?? this.requireWorkOrder(id).result_summary,
        updated_at: params[6] as string
      });
      return { meta: { last_row_id: 0 } };
    }

    if (sql.includes("UPDATE warehouse_asset_work_order SET blocking_flag = 0")) {
      this.updateWorkOrder(Number(params[1]), {
        blocking_flag: 0,
        updated_at: params[0] as string
      });
      return { meta: { last_row_id: 0 } };
    }

    if (sql.includes("UPDATE warehouse_asset_work_order SET status = 'in_progress'")) {
      const id = Number(params[2]);
      this.updateWorkOrder(id, {
        status: "in_progress",
        started_at: this.requireWorkOrder(id).started_at ?? (params[0] as string),
        updated_at: params[1] as string
      });
      return { meta: { last_row_id: 0 } };
    }

    if (sql.includes("INSERT INTO warehouse_task_evidence")) {
      const id = this.nextEvidenceId;
      this.nextEvidenceId += 1;
      this.evidence.push({
        id,
        work_order_id: params[0] as number,
        step_id: params[1] as number | null,
        tracked_asset_id: params[2] as number | null,
        evidence_type: params[3] as WarehouseTaskEvidence["evidence_type"],
        file_key: params[4] as string | null,
        file_name: params[5] as string | null,
        summary: params[6] as string | null,
        operator_userid: params[7] as string,
        captured_at: params[8] as string,
        created_at: params[9] as string
      });
      return { meta: { last_row_id: id } };
    }

    if (sql.includes("UPDATE warehouse_asset_work_order SET") && sql.includes("submitted_at")) {
      const id = Number(params[4]);
      this.updateWorkOrder(id, {
        status: "submitted",
        submitted_at: params[0] as string,
        result_summary: (params[1] as string | null) ?? this.requireWorkOrder(id).result_summary,
        completion_summary_json:
          (params[2] as string | null) ?? this.requireWorkOrder(id).completion_summary_json,
        updated_at: params[3] as string
      });
      return { meta: { last_row_id: 0 } };
    }

    if (sql.includes("INSERT INTO tracked_asset_event")) {
      this.events.push({ sql, params });
      return { meta: { last_row_id: this.events.length } };
    }

    throw new Error(`Unhandled run SQL: ${sql}`);
  }

  private requireAsset(id: number): TrackedAsset {
    const asset = this.assets.get(id);
    if (!asset) throw new Error(`asset ${id} not found`);
    return asset;
  }

  private requireWorkOrder(id: number): WarehouseAssetWorkOrder {
    const workOrder = this.workOrders.find((item) => item.id === id);
    if (!workOrder) throw new Error(`work order ${id} not found`);
    return workOrder;
  }

  private updateWorkOrder(id: number, patch: Partial<WarehouseAssetWorkOrder>) {
    const index = this.workOrders.findIndex((item) => item.id === id);
    if (index < 0) throw new Error(`work order ${id} not found`);
    this.workOrders[index] = {
      ...this.workOrders[index],
      ...patch
    };
  }
}

const buildEnv = (db: WarehouseFlowDb): Env => {
  return {
    DB: db
  } as unknown as Env;
};

const buildTrackedAsset = (patch?: Partial<TrackedAsset>): TrackedAsset => {
  return {
    id: 1,
    asset_code: "HY-TBM-001",
    asset_type_id: 1,
    asset_name: "顶管机 001",
    brand: null,
    model: null,
    serial_no: null,
    status: "using",
    current_project_id: 21,
    current_warehouse_id: null,
    current_location: "project",
    properties_json: null,
    purchased_date: null,
    ownership_type: "owned",
    created_at: "2026-05-05T00:00:00.000Z",
    updated_at: "2026-05-05T00:00:00.000Z",
    ...patch
  };
};

const buildStockOrder = (patch: Partial<StockOrder>): StockOrder => {
  return {
    id: 1,
    order_no: "RK-20260505-0001",
    order_type: "inbound",
    project_id: 21,
    from_warehouse_id: null,
    to_warehouse_id: 7,
    applicant_userid: "manager.1",
    status: "approved",
    approval_instance_id: null,
    rental_term_id: null,
    override_status: "none",
    override_reason: null,
    override_approver_userid: null,
    override_risk_acknowledged: 0,
    executed_at: null,
    remark: null,
    created_at: "2026-05-05T00:00:00.000Z",
    updated_at: "2026-05-05T00:00:00.000Z",
    ...patch
  };
};

const buildStockOrderItem = (patch: Partial<StockOrderItem>): StockOrderItem => {
  return {
    id: 1,
    stock_order_id: 1,
    asset_type_id: null,
    tracked_asset_id: 1,
    configuration_role: null,
    configuration_group_key: null,
    requires_modification: 0,
    quantity: 1,
    unit: "台",
    remark: null,
    status: "active",
    created_at: "2026-05-05T00:00:00.000Z",
    ...patch
  };
};

describe("warehouse return gate flow", () => {
  it("requires complete override audit fields before bypassing return gate blocks", async () => {
    const db = new WarehouseFlowDb();
    db.assets.set(1, buildTrackedAsset({ status: "returned_quarantine" }));
    db.stockItems.push(buildStockOrderItem({ id: 1, stock_order_id: 1, tracked_asset_id: 1 }));
    const env = buildEnv(db);

    const incompleteOverrideGate = await evaluateStockOrderGate(
      env,
      buildStockOrder({
        id: 1,
        order_type: "outbound",
        project_id: 22,
        from_warehouse_id: 7,
        to_warehouse_id: null,
        override_status: "approved",
        override_reason: "现场急需临时出库",
        override_approver_userid: "manager.1",
        override_risk_acknowledged: 0
      }),
      [buildStockOrderItem({ id: 1, stock_order_id: 1, tracked_asset_id: 1 })]
    );
    expect(incompleteOverrideGate.pass).toBe(false);
    expect(incompleteOverrideGate.issues.join("; ")).toContain("override audit incomplete");

    await applyStockOrderExecution(
      env,
      buildStockOrder({
        id: 1,
        order_type: "outbound",
        project_id: 22,
        from_warehouse_id: 7,
        to_warehouse_id: null,
        override_status: "approved",
        override_reason: "现场急需临时出库，库房负责人已确认风险",
        override_approver_userid: "manager.1",
        override_risk_acknowledged: 1
      })
    );

    const eventDetail = db.events[0]?.params?.[5];
    expect(eventDetail).toContain("with override");
    expect(eventDetail).toContain("reason=现场急需临时出库，库房负责人已确认风险");
    expect(eventDetail).toContain("approver=manager.1");
    expect(eventDetail).toContain("risk_acknowledged=1");
  });

  it("releases returned equipment when inspection is approved directly", async () => {
    const db = new WarehouseFlowDb();
    db.assets.set(1, buildTrackedAsset());
    db.stockItems.push(buildStockOrderItem({ stock_order_id: 1, tracked_asset_id: 1 }));
    const env = buildEnv(db);

    await applyStockOrderExecution(
      env,
      buildStockOrder({
        id: 1,
        order_type: "inbound",
        project_id: 21,
        to_warehouse_id: 7
      })
    );

    const inspectionTask = db.workOrders.find((item) => item.work_order_type === "inspection");
    expect(db.assets.get(1)?.status).toBe("returned_quarantine");
    expect(inspectionTask).toMatchObject({
      source: "return_receipt",
      status: "pending_assignment",
      blocking_flag: 1
    });

    if (!inspectionTask) throw new Error("inspection task should exist");
    await startWarehouseTask(env, inspectionTask.id, "worker.1");
    expect(db.assets.get(1)?.status).toBe("inspection");

    await submitWarehouseTask(env, {
      id: inspectionTask.id,
      operator_userid: "worker.1",
      result_summary: "返库检查通过，设备状态正常",
      evidence: [
        { evidence_type: "photo", file_key: "r2://inspection-pass-1.jpg" },
        { evidence_type: "photo", file_key: "r2://inspection-pass-2.jpg" },
        { evidence_type: "photo", file_key: "r2://inspection-pass-3.jpg" }
      ]
    });
    await reviewWarehouseTask(env, {
      id: inspectionTask.id,
      reviewer_userid: "manager.1",
      action: "approve",
      result_summary: "检查复核通过"
    });

    expect(db.assets.get(1)?.status).toBe("idle");
    expect(db.workOrders.find((item) => item.work_order_type === "maintenance")).toBeUndefined();

    const passGate = await evaluateStockOrderGate(
      env,
      buildStockOrder({
        id: 2,
        order_type: "outbound",
        project_id: 22,
        from_warehouse_id: 7,
        to_warehouse_id: null
      }),
      [buildStockOrderItem({ id: 2, stock_order_id: 2, tracked_asset_id: 1 })]
    );
    expect(passGate).toEqual({ pass: true, issues: [] });
  });

  it("keeps returned equipment blocked until rejected inspection follow-up maintenance is completed", async () => {
    const db = new WarehouseFlowDb();
    db.assets.set(1, buildTrackedAsset());
    db.stockItems.push(buildStockOrderItem({ stock_order_id: 1, tracked_asset_id: 1 }));
    const env = buildEnv(db);

    await applyStockOrderExecution(
      env,
      buildStockOrder({
        id: 1,
        order_type: "inbound",
        project_id: 21,
        to_warehouse_id: 7
      })
    );

    const returnedAsset = db.assets.get(1);
    expect(returnedAsset?.status).toBe("returned_quarantine");
    expect(returnedAsset?.current_project_id).toBeNull();
    expect(returnedAsset?.current_warehouse_id).toBe(7);

    const inspectionTask = db.workOrders.find((item) => item.work_order_type === "inspection");
    expect(inspectionTask).toMatchObject({
      source: "return_receipt",
      priority: "urgent",
      status: "pending_assignment",
      blocking_flag: 1,
      mobile_enabled: 1,
      required_photo_count: 3
    });

    const blockedGate = await evaluateStockOrderGate(
      env,
      buildStockOrder({
        id: 2,
        order_type: "outbound",
        project_id: 22,
        from_warehouse_id: 7,
        to_warehouse_id: null
      }),
      [buildStockOrderItem({ id: 2, stock_order_id: 2, tracked_asset_id: 1 })]
    );
    expect(blockedGate.pass).toBe(false);
    expect(blockedGate.issues.join("; ")).toContain("blocked by status=returned_quarantine");
    expect(blockedGate.issues.join("; ")).toContain("blocked by task");

    if (!inspectionTask) throw new Error("inspection task should exist");
    await startWarehouseTask(env, inspectionTask.id, "worker.1");
    await submitWarehouseTask(env, {
      id: inspectionTask.id,
      operator_userid: "worker.1",
      result_summary: "检查发现液压管路漏油",
      evidence: [
        { evidence_type: "photo", file_key: "r2://inspection-1.jpg" },
        { evidence_type: "photo", file_key: "r2://inspection-2.jpg" },
        { evidence_type: "photo", file_key: "r2://inspection-3.jpg" }
      ]
    });
    await reviewWarehouseTask(env, {
      id: inspectionTask.id,
      reviewer_userid: "manager.1",
      action: "reject",
      result_summary: "液压管路漏油，维护后复检"
    });

    const maintenanceTask = db.workOrders.find((item) => item.work_order_type === "maintenance");
    expect(maintenanceTask).toMatchObject({
      source: "return_receipt",
      priority: "urgent",
      status: "pending_assignment",
      blocking_flag: 1,
      mobile_enabled: 1,
      required_photo_count: 3
    });
    expect(db.workOrders.find((item) => item.id === inspectionTask.id)?.blocking_flag).toBe(0);

    if (!maintenanceTask) throw new Error("maintenance task should exist");
    await startWarehouseTask(env, maintenanceTask.id, "worker.1");
    expect(db.assets.get(1)?.status).toBe("maintenance");

    await submitWarehouseTask(env, {
      id: maintenanceTask.id,
      operator_userid: "worker.1",
      result_summary: "已完成维护，空载检查正常",
      evidence: [
        { evidence_type: "photo", file_key: "r2://photo-1.jpg" },
        { evidence_type: "photo", file_key: "r2://photo-2.jpg" },
        { evidence_type: "photo", file_key: "r2://photo-3.jpg" }
      ]
    });
    await reviewWarehouseTask(env, {
      id: maintenanceTask.id,
      reviewer_userid: "manager.1",
      action: "approve",
      result_summary: "维护复核通过"
    });

    expect(db.assets.get(1)?.status).toBe("idle");
    const passGate = await evaluateStockOrderGate(
      env,
      buildStockOrder({
        id: 3,
        order_type: "outbound",
        project_id: 23,
        from_warehouse_id: 7,
        to_warehouse_id: null
      }),
      [buildStockOrderItem({ id: 3, stock_order_id: 3, tracked_asset_id: 1 })]
    );
    expect(passGate).toEqual({ pass: true, issues: [] });
  });
});
