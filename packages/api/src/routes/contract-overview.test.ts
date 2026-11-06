import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthTokenPayload } from "../types/auth";
import type { Env } from "../types/env";
import { contractRoutes } from "./contract";
import type { ContractOverview } from "./contract-overview";

// 参数校验、权限和结果组装。分档 SQL 本身由 test/contract-overview-sql.test.ts 用真实 SQLite 验证。

const mockAuthState = vi.hoisted(() => ({
  roles: ["finance"]
}));

vi.mock("../services/auth", () => ({
  verifyToken: async (): Promise<AuthTokenPayload> =>
    ({
      sub: "user-a",
      username: "user-a",
      nickname: "User A",
      avatar: "",
      roles: mockAuthState.roles,
      permissions: [],
      tokenId: "token-a",
      type: "access",
      auth_method: "wecom_oauth",
      wecom_verified_at: "2026-07-01T00:00:00.000Z",
      exp: 4102444800,
      iat: 1770000000
    }) as AuthTokenPayload
}));

type Seen = { sql: string; params: unknown[] };

type OverviewResponse = {
  data: ContractOverview;
  error: { message: string };
};

const createDb = (rowsFor: (sql: string) => unknown[]) => {
  const seen: Seen[] = [];
  const statement = (sql: string, params: unknown[]) => ({
    bind: (...next: unknown[]) => statement(sql, next),
    first: async () => {
      seen.push({ sql, params });
      return /COUNT\(\*\) as total/.test(sql) ? { total: 0 } : (rowsFor(sql)[0] ?? null);
    },
    all: async () => {
      seen.push({ sql, params });
      return { results: rowsFor(sql) };
    }
  });
  return { db: { prepare: (sql: string) => statement(sql, []) }, seen };
};

const request = async (path: string, rowsFor: (sql: string) => unknown[] = () => []) => {
  const { db, seen } = createDb(rowsFor);
  const app = new Hono<{ Bindings: Env }>();
  app.route("/contract", contractRoutes);
  const response = await app.request(path, { headers: { authorization: "Bearer test-token" } }, {
    DB: db,
    KV: { get: async () => "session" }
  } as unknown as Env);
  const body = (await response.json()) as OverviewResponse;
  return { status: response.status, body, seen };
};

describe("GET /contract 按进度筛选", () => {
  beforeEach(() => {
    mockAuthState.roles = ["finance"];
  });

  it("拒绝不认识的档位", async () => {
    const { status, body, seen } = await request("/contract?band=whatever");

    expect(status).toBe(400);
    expect(body.error.message).toContain("进度");
    expect(seen).toEqual([]);
  });

  it("档位作为绑定参数传入，列表和计数用同一组条件", async () => {
    const { status, seen } = await request("/contract?direction=outbound&band=warning&page=2");

    expect(status).toBe(200);
    const [count, list] = seen;
    expect(count.params).toEqual(["outbound", "warning"]);
    expect(list.params).toEqual(["outbound", "warning", 20, 20]);
    expect(list.sql).not.toContain("'warning' =");
  });

  it("不传档位时仍按最新合同排序", async () => {
    const { seen } = await request("/contract?direction=outbound");

    expect(seen[1].sql).toMatch(/ORDER BY id DESC LIMIT/);
  });
});

describe("GET /contract/overview-summary", () => {
  beforeEach(() => {
    mockAuthState.roles = ["finance"];
  });

  it("页面看不到的角色不能取汇总", async () => {
    mockAuthState.roles = ["site_manager"];

    const { status } = await request("/contract/overview-summary");

    expect(status).toBe(403);
  });

  it("不会被 /:id 路由吃掉，缺省方向是付款合同", async () => {
    const { status, body } = await request("/contract/overview-summary");

    expect(status).toBe(200);
    expect(body.data.direction).toBe("outbound");
    expect(body.data.total_count).toBe(0);
    expect(body.data.execution).toEqual({
      count: 0,
      total_amount: 0,
      done_amount: 0,
      remaining_amount: 0,
      invoiced_amount: 0,
      bands: []
    });
  });

  it.each([
    ["direction=sideways", "方向"],
    ["project_id=abc", "项目"],
    ["project_id=-1", "项目"]
  ])("拒绝非法参数 %s", async (query, hint) => {
    const { status, body, seen } = await request(`/contract/overview-summary?${query}`);

    expect(status).toBe(400);
    expect(body.error.message).toContain(hint);
    expect(seen).toEqual([]);
  });

  it("把分档结果合计成总数，金额字段为空时按 0", async () => {
    const { body } = await request("/contract/overview-summary", (sql) => {
      if (sql.includes("GROUP BY status")) {
        return [
          { status: "active", count: 3 },
          { status: "draft", count: 1 }
        ];
      }
      if (sql.includes("GROUP BY band")) {
        return [
          {
            band: "normal",
            count: 2,
            total_amount: 3000,
            done_amount: 500,
            remaining_amount: 2500
          },
          { band: "over", count: 1, total_amount: 100, done_amount: 150, remaining_amount: null }
        ];
      }
      return [];
    });

    expect(body.data.total_count).toBe(4);
    expect(body.data.status_counts).toEqual({ active: 3, draft: 1 });
    expect(body.data.execution.count).toBe(3);
    expect(body.data.execution.total_amount).toBe(3100);
    expect(body.data.execution.done_amount).toBe(650);
    expect(body.data.execution.remaining_amount).toBe(2500);
    expect(body.data.execution.bands).toEqual([
      { band: "normal", count: 2, total_amount: 3000, done_amount: 500 },
      { band: "over", count: 1, total_amount: 100, done_amount: 150 }
    ]);
  });

  it("付款合同不查发票，收款合同才查", async () => {
    const outbound = await request("/contract/overview-summary?direction=outbound");
    const inbound = await request("/contract/overview-summary?direction=inbound");

    expect(outbound.seen.some(({ sql }) => sql.includes("FROM invoice"))).toBe(false);
    expect(inbound.seen.some(({ sql }) => sql.includes("FROM invoice"))).toBe(true);
  });
});
