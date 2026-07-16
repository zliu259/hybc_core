import { describe, expect, it, vi } from "vitest";

import type { HybcApiClient } from "../api-client";
import { warehouseTools } from "./warehouse";

const fakeClient = (get: ReturnType<typeof vi.fn>) =>
  ({ get } as unknown as HybcApiClient);
const byName = (c: HybcApiClient, n: string) =>
  warehouseTools(c).find((t) => t.name === n)!;

describe("warehouseTools", () => {
  it("warehouse_inventory hits GET /warehouse/inventory with filters", async () => {
    const get = vi.fn(async () => ({ data: [{ id: 1, quantity: 3 }] }));
    const res = await byName(fakeClient(get), "warehouse_inventory").handler({
      warehouse_id: 2
    });
    expect(get).toHaveBeenCalledWith("/warehouse/inventory", { warehouse_id: 2 });
    expect(JSON.parse(res.content[0].text)).toEqual([{ id: 1, quantity: 3 }]);
  });

  it("warehouse_low_stock hits GET /warehouse/inventory/alert", async () => {
    const get = vi.fn(async () => ({ data: [] }));
    await byName(fakeClient(get), "warehouse_low_stock").handler({});
    expect(get).toHaveBeenCalledWith("/warehouse/inventory/alert", {});
  });

  it("list_stock_orders hits GET /warehouse/stock-order", async () => {
    const get = vi.fn(async () => ({ data: [] }));
    await byName(fakeClient(get), "list_stock_orders").handler({ status: "pending" });
    expect(get).toHaveBeenCalledWith("/warehouse/stock-order", { status: "pending" });
  });
});
