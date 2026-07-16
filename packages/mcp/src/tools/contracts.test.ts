import { describe, expect, it, vi } from "vitest";

import type { HybcApiClient } from "../api-client";
import { contractTools } from "./contracts";

const fakeClient = (get: ReturnType<typeof vi.fn>) =>
  ({ get } as unknown as HybcApiClient);
const byName = (c: HybcApiClient, n: string) =>
  contractTools(c).find((t) => t.name === n)!;

describe("contractTools", () => {
  it("list_contracts passes direction/project filters to GET /contract", async () => {
    const get = vi.fn(async () => ({
      data: [{ id: 1, contract_no: "C-1" }],
      pagination: { page: 1, pageSize: 20, total: 1 }
    }));
    await byName(fakeClient(get), "list_contracts").handler({
      direction: "outbound",
      project_id: 5
    });
    expect(get).toHaveBeenCalledWith("/contract", {
      direction: "outbound",
      project_id: 5
    });
  });

  it("get_contract calls GET /contract/:id", async () => {
    const get = vi.fn(async () => ({ data: { id: 3 } }));
    await byName(fakeClient(get), "get_contract").handler({ id: 3 });
    expect(get).toHaveBeenCalledWith("/contract/3");
  });
});
