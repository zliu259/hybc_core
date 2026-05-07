import { describe, expect, it } from "vitest";

import {
  buildWarehouseManualDraftContent,
  buildWarehouseManualDraftTaskPayload,
  normalizeWarehouseManualDraftResultContent
} from "./warehouse-manual-ai";

describe("warehouse manual AI draft helpers", () => {
  it("builds a traceable AI draft payload from historical task briefs", () => {
    const payload = buildWarehouseManualDraftTaskPayload({
      manual_id: 7,
      manual_title: "DN1200 机芯返库检查",
      manual_type: "inspection",
      asset_type_id: 3,
      historical_tasks: [
        {
          work_order_no: "WO-1",
          work_order_type: "inspection",
          result_summary: "检查轴承温度正常，补拍铭牌照片",
          completion_summary_json: '{"photo_count":3}'
        }
      ]
    });

    expect(payload).toMatchObject({
      manual_id: 7,
      manual_title: "DN1200 机芯返库检查",
      task_count: 1
    });
    expect(payload.historical_tasks[0]).toMatchObject({
      work_order_no: "WO-1",
      result_summary: "检查轴承温度正常，补拍铭牌照片"
    });
  });

  it("creates an editable ai_draft manual version scaffold without publishing it", () => {
    const content = buildWarehouseManualDraftContent({
      manual_id: 7,
      manual_title: "DN1200 机芯返库检查",
      manual_type: "inspection",
      asset_type_id: 3,
      historical_tasks: []
    });
    const parsed = JSON.parse(content) as {
      source: string;
      manual_title: string;
      status: string;
      steps: unknown[];
    };

    expect(parsed).toMatchObject({
      source: "ai_draft",
      manual_title: "DN1200 机芯返库检查",
      status: "draft"
    });
    expect(parsed.steps.length).toBeGreaterThan(0);
  });

  it("normalizes completed AI draft output into editable version content", () => {
    const content = normalizeWarehouseManualDraftResultContent({
      output: '{"sections":[{"title":"检查步骤","items":["清洁机芯","检查密封"]}]}',
      metadata: { source: "runtime" }
    });
    const parsed = JSON.parse(content) as {
      source: string;
      status: string;
      sections: unknown[];
    };

    expect(parsed.source).toBe("ai_draft");
    expect(parsed.status).toBe("draft");
    expect(parsed.sections).toHaveLength(1);
  });
});
