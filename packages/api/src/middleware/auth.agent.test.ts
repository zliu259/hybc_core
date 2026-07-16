import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { authMiddleware, type AuthVariables } from "./auth";
import { createFakeD1, createFakeKV } from "../test-support/agent-fakes";
import { createAgentGrant } from "../services/agent-grant";
import type { Env } from "../types/env";

const buildApp = (env: Env) => {
  const app = new Hono<{ Bindings: Env; Variables: AuthVariables }>();
  app.use("/protected", authMiddleware);
  app.get("/protected", (c) => {
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

    const res = await app.request("/protected", {
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
    const res = await app.request("/protected", {
      headers: { authorization: "Bearer hybc_agent_bogus" }
    }, env);
    expect(res.status).toBe(401);
  });
});
