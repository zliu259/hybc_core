import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthTokenPayload } from "../types/auth";
import type { Env } from "../types/env";
import { approvalRoutes } from "./approval";

const mockAuthState = vi.hoisted(() => ({
  payload: {
    sub: "mgr-a",
    username: "mgr-a",
    nickname: "Manager A",
    avatar: "",
    roles: ["manager"],
    permissions: [],
    tokenId: "token-a",
    type: "access",
    auth_method: "wecom_oauth",
    wecom_verified_at: "2026-07-01T00:00:00.000Z",
    exp: 4102444800,
    iat: 1770000000
  } as AuthTokenPayload
}));

vi.mock("../services/auth", () => ({
  verifyToken: async (): Promise<AuthTokenPayload> => mockAuthState.payload
}));

class Stmt {
  constructor(private readonly sql: string) {}
  bind() {
    return this;
  }
  async first<T>(): Promise<T | null> {
    if (this.sql.includes("COUNT(*)")) return { total: 0 } as T;
    return null;
  }
  async all<T>(): Promise<{ results: T[] }> {
    return { results: [] as T[] };
  }
  async run() {
    return { meta: { last_row_id: 1, changes: 1 } };
  }
}

const createEnv = () =>
  ({
    DB: { prepare: (sql: string) => new Stmt(sql) },
    KV: { async get() { return "session"; } }
  }) as unknown as Env;

const requestAll = () => {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/approval", approvalRoutes);
  return app.request(
    "/approval/admin/all?page=1&pageSize=30",
    { headers: { authorization: "Bearer test-token" } },
    createEnv()
  );
};

describe("approval admin/all role access", () => {
  beforeEach(() => {
    mockAuthState.payload = { ...mockAuthState.payload, roles: ["manager"] };
  });

  it("allows manager (read-only monitoring)", async () => {
    const response = await requestAll();
    expect(response.status).toBe(200);
  });

  it("allows super_admin", async () => {
    mockAuthState.payload = { ...mockAuthState.payload, roles: ["super_admin"] };
    const response = await requestAll();
    expect(response.status).toBe(200);
  });

  it("rejects operator", async () => {
    mockAuthState.payload = { ...mockAuthState.payload, roles: ["operator"] };
    const response = await requestAll();
    expect(response.status).toBe(403);
  });
});
