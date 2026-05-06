import { describe, expect, it } from "vitest";

import {
  buildWarehouseTaskTimelineSummaryDetail,
  buildWarehouseTaskPackageStatusSummary,
  chooseWarehouseManualBinding,
  buildWarehouseTaskWorkloadSummary,
  buildFollowupMaintenanceTaskDefaults,
  buildReturnInspectionTaskDefaults,
  buildWarehouseMobileTaskConfig,
  canAttachTaskToPackage,
  canSubmitWarehouseTaskFromMobile,
  isWarehouseTaskOpenBlockingStatus,
  isWarehouseTaskVisibleInMobile,
  normalizeReturnedAssetStatus
} from "./warehouse-task";

describe("warehouse task queue rules", () => {
  it("blocks outbound while a blocking task is still operationally open", () => {
    expect(isWarehouseTaskOpenBlockingStatus("pending_assignment")).toBe(true);
    expect(isWarehouseTaskOpenBlockingStatus("assigned")).toBe(true);
    expect(isWarehouseTaskOpenBlockingStatus("in_progress")).toBe(true);
    expect(isWarehouseTaskOpenBlockingStatus("submitted")).toBe(true);
    expect(isWarehouseTaskOpenBlockingStatus("rejected")).toBe(true);
    expect(isWarehouseTaskOpenBlockingStatus("completed")).toBe(false);
    expect(isWarehouseTaskOpenBlockingStatus("cancelled")).toBe(false);
  });

  it("normalizes legacy quarantine status for returned tracked assets", () => {
    expect(normalizeReturnedAssetStatus("quarantine")).toBe("returned_quarantine");
    expect(normalizeReturnedAssetStatus("returned_quarantine")).toBe("returned_quarantine");
    expect(normalizeReturnedAssetStatus("idle")).toBe("idle");
  });

  it("creates strong default requirements for return inspection tasks", () => {
    const defaults = buildReturnInspectionTaskDefaults({
      order_no: "RK-260504-001",
      asset_code: "HY-TBM-001"
    });

    expect(defaults.work_order_type).toBe("inspection");
    expect(defaults.source).toBe("return_receipt");
    expect(defaults.priority).toBe("urgent");
    expect(defaults.blocking_flag).toBe(1);
    expect(defaults.mobile_enabled).toBe(1);
    expect(defaults.required_photo_count).toBeGreaterThanOrEqual(3);
    expect(defaults.remark).toContain("RK-260504-001");
    expect(defaults.remark).toContain("HY-TBM-001");
  });

  it("only exposes executable mobile task statuses", () => {
    expect(isWarehouseTaskVisibleInMobile("pending_assignment")).toBe(false);
    expect(isWarehouseTaskVisibleInMobile("assigned")).toBe(true);
    expect(isWarehouseTaskVisibleInMobile("in_progress")).toBe(true);
    expect(isWarehouseTaskVisibleInMobile("rejected")).toBe(true);
    expect(isWarehouseTaskVisibleInMobile("submitted")).toBe(false);
    expect(isWarehouseTaskVisibleInMobile("completed")).toBe(false);
  });

  it("allows only the assignee or super admin to submit mobile tasks", () => {
    const task = {
      assignee_userid: "worker-a",
      status: "assigned",
      mobile_enabled: 1
    };

    expect(canSubmitWarehouseTaskFromMobile(task, "worker-a", ["operator"])).toBe(true);
    expect(canSubmitWarehouseTaskFromMobile(task, "worker-b", ["operator"])).toBe(false);
    expect(canSubmitWarehouseTaskFromMobile(task, "admin", ["super_admin"])).toBe(true);
    expect(
      canSubmitWarehouseTaskFromMobile({ ...task, status: "submitted" }, "worker-a", ["operator"])
    ).toBe(false);
  });

  it("publishes a stable miniapp task execution config", () => {
    const config = buildWarehouseMobileTaskConfig();

    expect(config.contract_version).toBe(1);
    expect(config.visible_statuses).toContain("assigned");
    expect(config.visible_statuses).toContain("in_progress");
    expect(config.evidence_types).toContain("photo");
    expect(config.evidence_types).toContain("brief");
    expect(config.actions).toContain("submit");
  });

  it("creates blocking maintenance follow-up defaults when return inspection is rejected", () => {
    const defaults = buildFollowupMaintenanceTaskDefaults({
      source_work_order_no: "WO-260505-001",
      result_summary: "液压管路漏油，需维护后复检"
    });

    expect(defaults.work_order_type).toBe("maintenance");
    expect(defaults.source).toBe("return_receipt");
    expect(defaults.priority).toBe("urgent");
    expect(defaults.blocking_flag).toBe(1);
    expect(defaults.mobile_enabled).toBe(1);
    expect(defaults.required_photo_count).toBeGreaterThanOrEqual(3);
    expect(defaults.remark).toContain("WO-260505-001");
    expect(defaults.remark).toContain("液压管路漏油");
  });

  it("summarizes open workload by assignee for dispatch decisions", () => {
    const summary = buildWarehouseTaskWorkloadSummary([
      { assignee_userid: "worker-a", status: "assigned", priority: "urgent" },
      { assignee_userid: "worker-a", status: "in_progress", priority: "normal" },
      { assignee_userid: "worker-b", status: "submitted", priority: "high" },
      { assignee_userid: null, status: "pending_assignment", priority: "normal" },
      { assignee_userid: "worker-a", status: "completed", priority: "normal" }
    ]);

    expect(summary).toEqual([
      {
        assignee_userid: "worker-a",
        open_count: 2,
        urgent_count: 1,
        submitted_count: 0
      },
      {
        assignee_userid: "worker-b",
        open_count: 1,
        urgent_count: 0,
        submitted_count: 1
      },
      {
        assignee_userid: null,
        open_count: 1,
        urgent_count: 0,
        submitted_count: 0
      }
    ]);
  });

  it("keeps terminal tasks out of task package attachment", () => {
    expect(canAttachTaskToPackage({ status: "pending_assignment" })).toBe(true);
    expect(canAttachTaskToPackage({ status: "assigned" })).toBe(true);
    expect(canAttachTaskToPackage({ status: "completed" })).toBe(false);
    expect(canAttachTaskToPackage({ status: "cancelled" })).toBe(false);
  });

  it("chooses the most specific published manual binding for a task", () => {
    const binding = chooseWarehouseManualBinding(
      [
        {
          manual_version_id: 10,
          asset_type_id: null,
          work_order_type: "inspection",
          configuration_role: null,
          asset_model: null
        },
        {
          manual_version_id: 11,
          asset_type_id: 3,
          work_order_type: "inspection",
          configuration_role: null,
          asset_model: null
        },
        {
          manual_version_id: 12,
          asset_type_id: 3,
          work_order_type: "inspection",
          configuration_role: "core",
          asset_model: null
        },
        {
          manual_version_id: 13,
          asset_type_id: 3,
          work_order_type: "maintenance",
          configuration_role: "core",
          asset_model: null
        }
      ],
      {
        asset_type_id: 3,
        work_order_type: "inspection",
        configuration_role: "core"
      }
    );

    expect(binding?.manual_version_id).toBe(12);
  });

  it("prefers a matching asset model manual binding over generic role bindings", () => {
    const binding = chooseWarehouseManualBinding(
      [
        {
          manual_version_id: 20,
          asset_type_id: 3,
          work_order_type: "inspection",
          configuration_role: "core",
          asset_model: null
        },
        {
          manual_version_id: 21,
          asset_type_id: 3,
          work_order_type: "inspection",
          configuration_role: null,
          asset_model: "DN1200"
        },
        {
          manual_version_id: 22,
          asset_type_id: 3,
          work_order_type: "inspection",
          configuration_role: null,
          asset_model: "DN1000"
        }
      ],
      {
        asset_type_id: 3,
        work_order_type: "inspection",
        configuration_role: "core",
        asset_model: "DN1200"
      }
    );

    expect(binding?.manual_version_id).toBe(21);
  });

  it("builds a traceable task completion timeline summary", () => {
    const detail = buildWarehouseTaskTimelineSummaryDetail({
      status: "completed",
      result_summary: "维护复核通过",
      manual_version_id: 12,
      evidence_counts: [
        { evidence_type: "photo", evidence_count: 3 },
        { evidence_type: "brief", evidence_count: 1 }
      ]
    });

    expect(detail).toContain("status=completed");
    expect(detail).toContain("result=维护复核通过");
    expect(detail).toContain("manual_version_id=12");
    expect(detail).toContain("evidence=photo:3,brief:1");
  });

  it("summarizes task package status from child tasks", () => {
    expect(
      buildWarehouseTaskPackageStatusSummary({
        due_date: null,
        tasks: [
          { status: "completed", scheduled_date: "2026-05-05" },
          { status: "completed", scheduled_date: "2026-05-05" }
        ],
        now: "2026-05-06T00:00:00.000Z"
      })
    ).toMatchObject({
      status: "completed",
      task_count: 2,
      completed_count: 2,
      exception_count: 0
    });

    expect(
      buildWarehouseTaskPackageStatusSummary({
        due_date: "2026-05-05",
        tasks: [{ status: "assigned", scheduled_date: "2026-05-04" }],
        now: "2026-05-06T00:00:00.000Z"
      })
    ).toMatchObject({
      status: "exception",
      overdue_count: 1,
      exception_count: 1
    });

    expect(
      buildWarehouseTaskPackageStatusSummary({
        due_date: null,
        tasks: [
          { status: "pending_assignment", scheduled_date: null },
          { status: "assigned", scheduled_date: null }
        ],
        now: "2026-05-06T00:00:00.000Z"
      }).status
    ).toBe("in_progress");
  });
});
