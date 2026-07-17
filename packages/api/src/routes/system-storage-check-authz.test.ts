import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthTokenPayload, UserRole } from "../types/auth";
import type { Env } from "../types/env";
import { systemRoutes } from "./system";

// 存储自检端点(GET /api/v1/system/storage-check)不是纯只读探针:它会
// INSERT event_log、写 R2、写 KV、向 EVENT_QUEUE 投递消息。若无鉴权,任何
// 匿名请求都能触发这四类写操作,构成滥用/资源耗尽风险。本测试驱动真实的
// authMiddleware + requireRoles 链路,确认:匿名请求 401 且零写入、低权限
// 角色 403 且零写入、仅 super_admin/manager(与 /ops/* 同口径)可触发自检。

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

type WriteCounters = {
  d1Runs: number;
  r2Puts: number;
  kvPuts: number;
  queueSends: number;
};

const createEnv = (counters: WriteCounters) => {
  const r2Store = new Map<string, string>();
  const kvStore = new Map<string, string>();

  const stmt = {
    bind: () => stmt,
    run: async () => {
      counters.d1Runs += 1;
      return { success: true };
    },
    all: async () => ({ results: [] })
  };

  return {
    DB: { prepare: () => stmt },
    KV: {
      async get(key: string) {
        // authMiddleware 的会话检查与 storage-check 的回读共用 KV
        return kvStore.get(key) ?? "session";
      },
      async put(key: string, value: string) {
        counters.kvPuts += 1;
        kvStore.set(key, value);
      }
    },
    FILES: {
      async put(key: string, value: string) {
        counters.r2Puts += 1;
        r2Store.set(key, value);
      },
      async get(key: string) {
        const value = r2Store.get(key);
        if (value === undefined) return null;
        return { text: async () => value };
      }
    },
    EVENT_QUEUE: {
      async send() {
        counters.queueSends += 1;
      }
    }
  } as unknown as Env;
};

const newCounters = (): WriteCounters => ({ d1Runs: 0, r2Puts: 0, kvPuts: 0, queueSends: 0 });

const requestStorageCheck = (
  counters: WriteCounters,
  headers: Record<string, string> = { authorization: "Bearer test-token" }
) => {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/api/v1/system", systemRoutes);
  return app.request("/api/v1/system/storage-check", { headers }, createEnv(counters));
};

const setAuth = (roles: UserRole[]) => {
  mockAuthState.payload = { ...mockAuthState.payload, roles };
};

describe("GET /api/v1/system/storage-check authorization", () => {
  beforeEach(() => {
    setAuth(["operator"]);
  });

  it("rejects a request with no authorization header with 401 and performs zero writes", async () => {
    const counters = newCounters();
    const res = await requestStorageCheck(counters, {});
    expect(res.status).toBe(401);
    expect(counters).toEqual({ d1Runs: 0, r2Puts: 0, kvPuts: 0, queueSends: 0 });
  });

  it.each<UserRole>(["operator", "site_manager", "finance"])(
    "rejects %s with 403 and performs zero writes",
    async (role) => {
      setAuth([role]);
      const counters = newCounters();
      const res = await requestStorageCheck(counters);
      expect(res.status).toBe(403);
      expect(counters).toEqual({ d1Runs: 0, r2Puts: 0, kvPuts: 0, queueSends: 0 });
    }
  );

  it.each<UserRole>(["super_admin", "manager"])("allows %s to run the check", async (role) => {
    setAuth([role]);
    const counters = newCounters();
    const res = await requestStorageCheck(counters);
    expect(res.status).toBe(200);

    const body = (await res.json()) as { ok: boolean; kvValue: string | null };
    expect(body.ok).toBe(true);
    expect(counters.d1Runs).toBe(1);
    expect(counters.r2Puts).toBe(1);
    expect(counters.kvPuts).toBe(1);
    expect(counters.queueSends).toBe(1);
  });
});
