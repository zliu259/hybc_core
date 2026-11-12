import { describe, expect, it, vi } from "vitest";

import type { HybcApiClient } from "../api-client";
import { warehouseTools } from "./warehouse";

const fakeClient = (get: ReturnType<typeof vi.fn>) =>
  ({ get } as unknown as HybcApiClient);
const byName = (c: HybcApiClient, n: string) =>
  warehouseTools(c).find((t) => t.name === n)!;

describe("warehouseTools", () => {
  it("只有这三个工具：库存、低库存、设备查询（没有出入库单了）", () => {
    expect(warehouseTools(fakeClient(vi.fn())).map((t) => t.name)).toEqual([
      "warehouse_inventory",
      "warehouse_low_stock",
      "list_devices"
    ]);
  });

  it("warehouse_inventory 调 GET /warehouse/inventory，不再接受库房和资产类型两个参数", async () => {
    const get = vi.fn(async () => ({ data: [{ id: 1, quantity: 3 }] }));
    const tool = byName(fakeClient(get), "warehouse_inventory");
    expect(Object.keys(tool.inputSchema)).toEqual([]);
    const res = await tool.handler({});
    expect(get).toHaveBeenCalledWith("/warehouse/inventory", {});
    expect(JSON.parse(res.content[0].text)).toEqual([{ id: 1, quantity: 3 }]);
  });

  it("warehouse_low_stock hits GET /warehouse/inventory/alert", async () => {
    const get = vi.fn(async () => ({ data: [] }));
    const tool = byName(fakeClient(get), "warehouse_low_stock");
    expect(Object.keys(tool.inputSchema)).toEqual([]);
    await tool.handler({});
    expect(get).toHaveBeenCalledWith("/warehouse/inventory/alert", {});
  });

  it("list_devices 调 GET /warehouse/device，带筛选，返回 items 和 pagination", async () => {
    const get = vi.fn(async () => ({
      data: [{ device_code: "SB-0001" }],
      pagination: { page: 1, pageSize: 20, total: 1 }
    }));
    const res = await byName(fakeClient(get), "list_devices").handler({
      state: "available",
      keyword: "1200"
    });
    expect(get).toHaveBeenCalledWith("/warehouse/device", { state: "available", keyword: "1200" });
    expect(JSON.parse(res.content[0].text)).toEqual({
      items: [{ device_code: "SB-0001" }],
      pagination: { page: 1, pageSize: 20, total: 1 }
    });
  });

  it("list_devices 的状态只认设备的六种状态", () => {
    const schema = byName(fakeClient(vi.fn()), "list_devices").inputSchema;
    expect(Object.keys(schema).sort()).toEqual(
      ["category_id", "keyword", "page", "pageSize", "project_id", "state"].sort()
    );
    expect(schema.state.safeParse("available").success).toBe(true);
    expect(schema.state.safeParse("on_project").success).toBe(true);
    expect(schema.state.safeParse("in_stock").success).toBe(false);
    expect(schema.pageSize.safeParse(201).success).toBe(false);
  });
});
