import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import type { AuthTokenPayload } from "../types/auth";
import type { Env } from "../types/env";
import { reimbursementRoutes } from "./reimbursement";

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

const request = async (query: string) => {
  const seen: { sql: string; params: unknown[] }[] = [];
  const statement = (sql: string, params: unknown[]) => ({
    bind: (...next: unknown[]) => statement(sql, next),
    first: async () => {
      seen.push({ sql, params });
      return { total: 1 };
    },
    all: async () => {
      seen.push({ sql, params });
      return { results: [{ id: 5, project_id: 7, project_name: "顶管一期" }] };
    }
  });
  const app = new Hono<{ Bindings: Env }>();
  app.route("/reimbursement", reimbursementRoutes);
  const response = await app.request(
    `/reimbursement?${query}`,
    { headers: { authorization: "Bearer test-token" } },
    {
      DB: { prepare: (sql: string) => statement(sql, []) },
      KV: { get: async () => "session" }
    } as unknown as Env
  );
  const body = (await response.json()) as { data: { project_name: string }[] };
  return { status: response.status, body, seen };
};

describe("GET /reimbursement 列表", () => {
  it("每行带项目名，工作台不用再把全部项目取一遍", async () => {
    const { status, body, seen } = await request("creator_id=me&status=draft,submitted");

    expect(status).toBe(200);
    expect(body.data[0].project_name).toBe("顶管一期");
    const list = seen.find((item) => item.sql.includes("FROM reimbursement_envelope e\n"));
    expect(list?.sql).toContain("AS project_name");
    expect(list?.params.slice(0, 2)).toEqual(["draft", "submitted"]);
  });
});
