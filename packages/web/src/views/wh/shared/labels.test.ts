import { describe, expect, it } from "vitest";

import {
  DEVICE_STATE_LABELS,
  DEVICE_STATE_TAG,
  DOC_TYPE_LABELS,
  MATERIAL_KIND_LABELS,
  TASK_KIND_LABELS,
  TASK_SYSTEM_LABELS,
  taskStatusLabel
} from "./labels";

describe("库房中文标签", () => {
  it.each([
    [{ status: "todo", assignee_userid: null, photo_count: 0 }, "待派工"],
    [{ status: "todo", assignee_userid: "u1", photo_count: 0 }, "待执行"],
    [{ status: "todo", assignee_userid: "u1", photo_count: 2 }, "进行中"],
    [{ status: "submitted", assignee_userid: "u1", photo_count: 3 }, "待确认"],
    [{ status: "done", assignee_userid: "u1", photo_count: 3 }, "已完成"],
    [{ status: "cancelled", assignee_userid: null, photo_count: 0 }, "已取消"]
  ] as const)("任务状态 %j 显示为 %s", (task, label) => {
    expect(taskStatusLabel(task)).toBe(label);
  });

  it("设备状态、标签颜色、单据类型都有中文", () => {
    expect(DEVICE_STATE_LABELS).toEqual({
      scrapped: "已报废",
      on_project: "在项目",
      repairing: "维修中",
      pending_inspection: "待检",
      blocked: "暂不可用",
      available: "可用"
    });
    expect(DEVICE_STATE_TAG).toEqual({
      available: "success",
      pending_inspection: "warning",
      blocked: "warning",
      repairing: "danger",
      on_project: "info",
      scrapped: "info"
    });
    expect(DOC_TYPE_LABELS).toEqual({
      opening: "期初",
      inbound: "入库",
      out: "发往项目",
      back: "项目返库",
      transfer: "项目间转场",
      adjust: "盘点调整",
      scrap: "报废",
      unscrap: "撤销报废"
    });
    expect(TASK_KIND_LABELS).toEqual({
      inspection: "检查",
      maintenance: "维修",
      servicing: "保养",
      other: "其他"
    });
    expect(TASK_SYSTEM_LABELS).toEqual({
      hydraulic: "液压",
      electric: "电气",
      drive: "传动",
      other: "其他"
    });
    expect(MATERIAL_KIND_LABELS).toEqual({
      turnover: "周转",
      consumable: "消耗"
    });
  });
});
