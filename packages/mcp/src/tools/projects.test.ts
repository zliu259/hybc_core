import { describe, expect, it, vi } from "vitest";

import type { HybcApiClient } from "../api-client";
import { projectTools } from "./projects";

const fakeClient = (get: ReturnType<typeof vi.fn>) =>
  ({ get } as unknown as HybcApiClient);

const byName = (client: HybcApiClient, name: string) =>
  projectTools(client).find((t) => t.name === name)!;

describe("projectTools", () => {
  it("search_projects calls GET /project with filters and returns items+pagination", async () => {
    const get = vi.fn(async () => ({
      data: [{ id: 1, project_name: "road" }],
      pagination: { page: 1, pageSize: 20, total: 1 }
    }));
    const tool = byName(fakeClient(get), "search_projects");
    const res = await tool.handler({ keyword: "road", page: 1 });
    expect(get).toHaveBeenCalledWith("/project", { keyword: "road", page: 1 });
    const parsed = JSON.parse(res.content[0].text);
    expect(parsed.items).toHaveLength(1);
    expect(parsed.pagination.total).toBe(1);
  });

  it("get_project calls GET /project/:id", async () => {
    const get = vi.fn(async () => ({ data: { id: 7, project_name: "x" } }));
    const tool = byName(fakeClient(get), "get_project");
    const res = await tool.handler({ id: 7 });
    expect(get).toHaveBeenCalledWith("/project/7");
    expect(JSON.parse(res.content[0].text).id).toBe(7);
  });

  it("exposes exactly the expected project tools", () => {
    const names = projectTools(fakeClient(vi.fn())).map((t) => t.name).sort();
    expect(names).toEqual(
      ["get_project", "get_project_financial_summary", "search_projects"].sort()
    );
  });
});
