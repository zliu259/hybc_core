import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { authMiddleware, type AuthVariables } from "./auth";
import { createFakeD1, createFakeKV } from "../test-support/agent-fakes";
import { createAgentGrant } from "../services/agent-grant";
import type { Env } from "../types/env";

// 挂在一个白名单内的只读端点上（GET /api/v1/project），这样有效 agent 令牌能通过只读闸门，
// 从而可验证解析出的 auth 上下文（via=mcp、roles）。非白名单路径会被 deny-by-default 拦成 403。
const buildApp = (env: Env) => {
  const app = new Hono<{ Bindings: Env; Variables: AuthVariables }>();
  app.use("/api/v1/project", authMiddleware);
  app.get("/api/v1/project", (c) => {
    const auth = c.get("auth");
    return c.json({ sub: auth.sub, via: auth.via, roles: auth.roles });
  });
  return { app, env };
};

const fakeEnv = (db: D1Database, kv: KVNamespace): Env =>
  ({ DB: db, KV: kv, JWT_SECRET: "test-secret" } as unknown as Env);

describe("authMiddleware agent-token branch", () => {
  it("authenticates a valid agent token and sets via=mcp", async () => {
    const { db } = createFakeD1();
    const { kv } = createFakeKV();
    const { token } = await createAgentGrant(db, {
      wecomUserid: "MaxLiu",
      role: "finance"
    });
    const { app, env } = buildApp(fakeEnv(db, kv));

    const res = await app.request("/api/v1/project", {
      headers: { authorization: `Bearer ${token}` }
    }, env);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { sub: string; via: string; roles: string[] };
    expect(body.sub).toBe("MaxLiu");
    expect(body.via).toBe("mcp");
    expect(body.roles).toEqual(["finance"]);
  });

  it("rejects a revoked/unknown agent token with 401", async () => {
    const { db } = createFakeD1();
    const { kv } = createFakeKV();
    const { app, env } = buildApp(fakeEnv(db, kv));
    const res = await app.request("/api/v1/project", {
      headers: { authorization: "Bearer hybc_agent_bogus" }
    }, env);
    expect(res.status).toBe(401);
  });

  it("returns 401 (not 500) when the grant lookup throws", async () => {
    const throwingDb = {
      prepare() {
        return {
          bind() {
            return this;
          },
          first(): Promise<never> {
            return Promise.reject(new Error("D1 infra failure"));
          }
        };
      }
    } as unknown as D1Database;
    const { kv } = createFakeKV();
    const { app, env } = buildApp(fakeEnv(throwingDb, kv));

    const res = await app.request("/api/v1/project", {
      headers: { authorization: "Bearer hybc_agent_anything" }
    }, env);

    expect(res.status).toBe(401);
  });
});
