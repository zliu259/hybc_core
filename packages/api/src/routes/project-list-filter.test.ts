import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import type { AuthTokenPayload } from "../types/auth";
import type { Env } from "../types/env";
import { projectRoutes } from "./project";

vi.mock("../services/auth", () => ({
  verifyToken: async (): Promise<AuthTokenPayload> =>
    ({
      sub: "user-a",
      username: "user-a",
      nickname: "User A",
      avatar: "",
      roles: ["operator"],
      permissions: [],
      tokenId: "token-a",
      type: "access",
      auth_method: "wecom_oauth",
      wecom_verified_at: "2026-07-01T00:00:00.000Z",
      exp: 4102444800,
      iat: 1770000000
    }) as AuthTokenPayload
}));

const requestList = async (query: string) => {
  const seen: { sql: string; params: unknown[] }[] = [];
  const statement = (sql: string, params: unknown[]) => ({
    bind: (...next: unknown[]) => statement(sql, next),
    run: async () => ({ meta: { changes: 0 } }),
    first: async () => {
      seen.push({ sql, params });
      return { total: 0 };
    },
    all: async () => {
      seen.push({ sql, params });
      return { results: [] };
    }
  });
  const app = new Hono<{ Bindings: Env }>();
  app.route("/project", projectRoutes);
  const response = await app.request(
    `/project?${query}`,
    { headers: { authorization: "Bearer test-token" } },
    {
      DB: { prepare: (sql: string) => statement(sql, []) },
      KV: { get: async () => "session" }
    } as unknown as Env
  );
  return { status: response.status, seen };
};

describe("GET /project 按负责人筛选", () => {
  it("列表和计数都按负责人过滤，账号作为绑定参数传入", async () => {
    const { status, seen } = await requestList("manager_userid=XiaoLianZhong&status=active&page=2");

    expect(status).toBe(200);
    const [list, count] = seen;
    expect(list.sql).toContain("manager_userid = ?");
    expect(count.sql).toContain("manager_userid = ?");
    expect(list.params).toEqual(["active", "XiaoLianZhong", 20, 20]);
    expect(count.params).toEqual(["active", "XiaoLianZhong"]);
  });

  it("不传时不加这个条件，其他页面的下拉框不受影响", async () => {
    const { seen } = await requestList("page=1");

    expect(seen[0].sql).not.toContain("manager_userid = ?");
  });
});
