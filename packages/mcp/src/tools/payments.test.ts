import { describe, expect, it, vi } from "vitest";

import type { HybcApiClient } from "../api-client";
import { paymentTools } from "./payments";

const fakeClient = (get: ReturnType<typeof vi.fn>) =>
  ({ get } as unknown as HybcApiClient);
const byName = (c: HybcApiClient, n: string) =>
  paymentTools(c).find((t) => t.name === n)!;

describe("paymentTools", () => {
  it("list_payments passes filters to GET /payment", async () => {
    const get = vi.fn(async () => ({
      data: [{ id: 1, serial_no: "PT-1" }],
      pagination: { page: 1, pageSize: 20, total: 1 }
    }));
    const res = await byName(fakeClient(get), "list_payments").handler({
      status: "pending_approval",
      project_id: 5,
      mine: true
    });
    expect(get).toHaveBeenCalledWith("/payment", {
      status: "pending_approval",
      project_id: 5,
      mine: true
    });
    expect(JSON.parse(res.content[0].text).items[0].serial_no).toBe("PT-1");
  });

  it("get_payment calls GET /payment/:id", async () => {
    const get = vi.fn(async () => ({ data: { id: 9 } }));
    await byName(fakeClient(get), "get_payment").handler({ id: 9 });
    expect(get).toHaveBeenCalledWith("/payment/9");
  });

  it("exposes list_payments + get_payment", () => {
    expect(paymentTools(fakeClient(vi.fn())).map((t) => t.name).sort()).toEqual([
      "get_payment",
      "list_payments"
    ]);
  });
});
