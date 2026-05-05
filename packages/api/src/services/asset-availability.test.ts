import { describe, expect, it } from "vitest";

import { buildAssetAvailabilityStatus } from "./asset-availability";

const baseAsset = {
  status: "idle",
  current_project_id: null as number | null
};

describe("asset availability status", () => {
  it("marks idle assets without blockers as dispatchable", () => {
    expect(
      buildAssetAvailabilityStatus({
        asset: baseAsset,
        blockingWorkOrders: [],
        configurations: []
      })
    ).toEqual({
      state: "available_now",
      label: "可出库",
      severity: "success",
      can_dispatch: true,
      reasons: ["设备当前在库且没有阻塞任务"]
    });
  });

  it("uses explicit operational states before generic blockers", () => {
    expect(
      buildAssetAvailabilityStatus({
        asset: { ...baseAsset, status: "returned_quarantine" },
        blockingWorkOrders: [],
        configurations: []
      }).state
    ).toBe("returned_quarantine");

    expect(
      buildAssetAvailabilityStatus({
        asset: { ...baseAsset, status: "scrapped" },
        blockingWorkOrders: [],
        configurations: []
      }).state
    ).toBe("scrapped");

    expect(
      buildAssetAvailabilityStatus({
        asset: { ...baseAsset, current_project_id: 12 },
        blockingWorkOrders: [],
        configurations: []
      }).state
    ).toBe("on_project");
  });

  it("shows blocking work orders when asset status itself is otherwise dispatchable", () => {
    const result = buildAssetAvailabilityStatus({
      asset: baseAsset,
      blockingWorkOrders: [{ work_order_no: "WO-1", status: "assigned" }],
      configurations: []
    });

    expect(result.can_dispatch).toBe(false);
    expect(result.state).toBe("blocked");
    expect(result.reasons).toContain("存在未完成阻塞任务：WO-1");
  });

  it("marks pending configuration work as available only after modification", () => {
    const result = buildAssetAvailabilityStatus({
      asset: baseAsset,
      blockingWorkOrders: [],
      configurations: [{ configuration_code: "CFG-1", status: "assembling" }]
    });

    expect(result.state).toBe("available_after_modification");
    expect(result.can_dispatch).toBe(false);
  });
});
