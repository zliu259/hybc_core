import { describe, expect, it } from "vitest";

import { buildAssetManualReferenceHistory } from "./asset-manual-history";

describe("asset manual reference history", () => {
  it("keeps task-level manual references and sorts the latest reference first", () => {
    const rows = buildAssetManualReferenceHistory([
      {
        work_order_id: 1,
        work_order_no: "WO-1",
        work_order_type: "inspection",
        work_order_status: "completed",
        manual_version_id: 10,
        manual_id: 2,
        manual_title: "返库检查手册",
        manual_version_no: 1,
        referenced_at: "2026-05-04T01:00:00.000Z"
      },
      {
        work_order_id: 2,
        work_order_no: "WO-2",
        work_order_type: "maintenance",
        work_order_status: "submitted",
        manual_version_id: null,
        manual_id: null,
        manual_title: null,
        manual_version_no: null,
        referenced_at: "2026-05-05T01:00:00.000Z"
      },
      {
        work_order_id: 3,
        work_order_no: "WO-3",
        work_order_type: "maintenance",
        work_order_status: "completed",
        manual_version_id: 11,
        manual_id: 2,
        manual_title: "返库检查手册",
        manual_version_no: 2,
        referenced_at: "2026-05-05T02:00:00.000Z"
      }
    ]);

    expect(rows).toEqual([
      {
        work_order_id: 3,
        work_order_no: "WO-3",
        work_order_type: "maintenance",
        work_order_status: "completed",
        manual_version_id: 11,
        manual_id: 2,
        manual_title: "返库检查手册",
        manual_version_no: 2,
        referenced_at: "2026-05-05T02:00:00.000Z"
      },
      {
        work_order_id: 1,
        work_order_no: "WO-1",
        work_order_type: "inspection",
        work_order_status: "completed",
        manual_version_id: 10,
        manual_id: 2,
        manual_title: "返库检查手册",
        manual_version_no: 1,
        referenced_at: "2026-05-04T01:00:00.000Z"
      }
    ]);
  });
});
