import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthTokenPayload, UserRole } from "../types/auth";
import type { Env } from "../types/env";
import { systemRoutes } from "./system";

// 一致性巡检端点（GET /api/v1/system/integrity/reimbursement）目前是唯一直接
// 暴露报销数据（含金额）不一致情况的只读端点，`routes/system.ts` 用
// `systemRoutes.use("/integrity/*", authMiddleware, requireRoles(["super_admin"]))`
// 把它锁在超管角色下。这个测试驱动真实的 authMiddleware + requireRoles 中间件
// 链路（而不是只读源码断言"看起来锁住了"），确认非 super_admin 确实拿不到数据、
// 缺失鉴权头也拿不到数据，super_admin 才能拿到。

const mockAuthState = vi.hoisted(() => ({
  payload: {
    sub: "someone",
    username: "someone",
    nickname: "Someone",
    avatar: "",
    roles: ["operator"],
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

// findReimbursementIntegrityIssues 本身在 reimbursement-integrity.test.ts 里已经
// 单独覆盖；这里只关心鉴权链路是否放行/拦截，因此假 D1 对所有五类检查一律
// 返回空结果集，不构造具体不一致数据。
const createIntegrityDb = (): D1Database => {
  const stmt = {
    bind: () => stmt,
    all: async () => ({ results: [] })
  };
  return { prepare: () => stmt } as unknown as D1Database;
};

const createEnv = () =>
  ({
    DB: createIntegrityDb(),
    KV: {
      async get() {
        return "session";
      }
    }
  }) as unknown as Env;

const requestIntegrity = (headers: Record<string, string> = { authorization: "Bearer test-token" }) => {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/api/v1/system", systemRoutes);
  return app.request("/api/v1/system/integrity/reimbursement", { headers }, createEnv());
};

const setAuth = (roles: UserRole[]) => {
  mockAuthState.payload = { ...mockAuthState.payload, roles };
};

describe("GET /api/v1/system/integrity/reimbursement authorization", () => {
  beforeEach(() => {
    setAuth(["operator"]);
  });

  it("allows super_admin", async () => {
    setAuth(["super_admin"]);
    const res = await requestIntegrity();
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      success: boolean;
      data: { issues: unknown[]; summary: { total: number; bySeverity: Record<string, number> } };
    };
    expect(body.success).toBe(true);
    expect(body.data.issues).toEqual([]);
    expect(body.data.summary).toEqual({ total: 0, bySeverity: {} });
  });

  it.each<UserRole>(["operator", "manager", "site_manager", "finance"])(
    "rejects %s with 403",
    async (role) => {
      setAuth([role]);
      const res = await requestIntegrity();
      expect(res.status).toBe(403);

      const body = (await res.json()) as { success: boolean; error: { message: string } };
      expect(body.success).toBe(false);
    }
  );

  it("rejects a request with no authorization header with 401 before RBAC even runs", async () => {
    const res = await requestIntegrity({});
    expect(res.status).toBe(401);
  });
});
