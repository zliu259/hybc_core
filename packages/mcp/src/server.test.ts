import { describe, expect, it, vi } from "vitest";

import type { HybcApiClient } from "./api-client";
import { allToolDefs } from "./tools/index";
import { buildServer } from "./server";

const fakeClient = () => ({ get: vi.fn() } as unknown as HybcApiClient);

describe("server wiring", () => {
  it("allToolDefs exposes a curated, unique, non-empty tool set", () => {
    const defs = allToolDefs(fakeClient());
    const names = defs.map((d) => d.name);
    expect(names.length).toBeGreaterThanOrEqual(12);
    expect(new Set(names).size).toBe(names.length); // no dup names
    for (const d of defs) {
      expect(d.name).toMatch(/^[a-z_]+$/);
      expect(d.description.length).toBeGreaterThan(0);
    }
  });

  it("buildServer constructs an McpServer without throwing", () => {
    const server = buildServer(fakeClient());
    expect(server).toBeDefined();
  });
});
