import { describe, expect, it } from "vitest";

import {
  buildReturnInspectionTaskDefaults,
  isWarehouseTaskOpenBlockingStatus,
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
});
