import { describe, expect, it } from "vitest";

import {
  buildTbmCompositionRecommendationPayload,
  buildWarehouseDispatchRecommendationPayload
} from "./warehouse-ai";

describe("warehouse ai helpers", () => {
  it("builds a traceable dispatch recommendation payload that cannot auto dispatch", () => {
    const payload = buildWarehouseDispatchRecommendationPayload({
      filters: { warehouse_id: 2, source: "return_receipt" },
      tasks: [
        {
          id: 11,
          work_order_no: "WO-260507-001",
          work_order_type: "inspection",
          priority: "urgent",
          status: "pending_assignment",
          warehouse_id: 2,
          project_id: null,
          assignee_userid: null,
          package_id: null,
          scheduled_date: null,
          blocking_flag: 1,
          required_photo_count: 3,
          remark: "返库检查"
        }
      ],
      workload_summary: [
        {
          assignee_userid: "worker-a",
          open_count: 2,
          urgent_count: 1,
          submitted_count: 0
        }
      ]
    });

    expect(payload.task_type).toBe("warehouse_task_dispatch_recommendation");
    expect(payload.no_auto_dispatch).toBe(true);
    expect(payload.filters).toEqual({ warehouse_id: 2, source: "return_receipt" });
    expect(payload.task_count).toBe(1);
    expect(payload.tasks[0]).toMatchObject({
      id: 11,
      work_order_no: "WO-260507-001",
      blocking_flag: 1
    });
    expect(payload.output_contract.recommendations[0]).toMatchObject({
      work_order_id: "number",
      recommended_assignee_userid: "string|null",
      reason: "string"
    });
  });

  it("builds a tbm composition recommendation payload without auto applying it", () => {
    const payload = buildTbmCompositionRecommendationPayload({
      core: {
        id: 1,
        asset_code: "HY-CORE-001",
        asset_name: "DN1200 机芯",
        asset_type_id: 10,
        asset_type_code: "CORE",
        asset_type_name: "顶管机机芯",
        brand: "厂家A",
        model: "DN1200",
        status: "idle",
        current_warehouse_id: 7
      },
      shells: [
        {
          id: 2,
          asset_code: "HY-SHELL-001",
          asset_name: "DN1200 壳体",
          asset_type_id: 11,
          asset_type_code: "SHELL",
          asset_type_name: "顶管机壳体",
          brand: "厂家A",
          model: "DN1200",
          role: "shell",
          status: "idle",
          current_warehouse_id: 7,
          available: true,
          requires_modification: false,
          reasons: []
        }
      ],
      consoles: []
    });

    expect(payload.task_type).toBe("tbm_composition_recommendation");
    expect(payload.no_auto_apply).toBe(true);
    expect(payload.core.asset_code).toBe("HY-CORE-001");
    expect(payload.shell_count).toBe(1);
    expect(payload.output_contract).toMatchObject({
      recommended_shell_asset_id: "number|null",
      recommended_console_asset_id: "number|null",
      reason: "string"
    });
  });
});
