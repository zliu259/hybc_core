import { describe, expect, it, vi } from "vitest";

import type { HybcApiClient } from "../api-client";
import { approvalTools } from "./approvals";

const fakeClient = (get: ReturnType<typeof vi.fn>) =>
  ({ get } as unknown as HybcApiClient);
const byName = (c: HybcApiClient, n: string) =>
  approvalTools(c).find((t) => t.name === n)!;

describe("approvalTools", () => {
  it("list_my_approvals hits GET /approval with filters", async () => {
    const get = vi.fn(async () => ({
      data: [{ id: 1 }],
      pagination: { page: 1, pageSize: 20, total: 1 }
    }));
    await byName(fakeClient(get), "list_my_approvals").handler({
      biz_type: "payment",
      initiator: "me"
    });
    expect(get).toHaveBeenCalledWith("/approval", {
      biz_type: "payment",
      initiator: "me"
    });
  });

  it("list_pending_approvals hits GET /approval/pending", async () => {
    const get = vi.fn(async () => ({
      data: [],
      pagination: { page: 1, pageSize: 20, total: 0 }
    }));
    await byName(fakeClient(get), "list_pending_approvals").handler({});
    expect(get).toHaveBeenCalledWith("/approval/pending", {});
  });

  it("get_approval hits GET /approval/:id", async () => {
    const get = vi.fn(async () => ({ data: { instance: { id: 4 } } }));
    await byName(fakeClient(get), "get_approval").handler({ id: 4 });
    expect(get).toHaveBeenCalledWith("/approval/4");
  });
});
