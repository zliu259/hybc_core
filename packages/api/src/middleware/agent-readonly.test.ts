import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import {
  AGENT_READONLY_MESSAGE,
  agentReadonlyForbidden,
  isReadOnlyMethod
} from "./agent-readonly";
import { authMiddleware, type AuthVariables } from "./auth";
import { createAgentGrant } from "../services/agent-grant";
import { createSessionPayload, issueTokens } from "../services/auth";
import { createFakeD1, createFakeKV } from "../test-support/agent-fakes";
import type { UserRole } from "../types/auth";
import type { Env } from "../types/env";

const fakeEnv = (db: D1Database, kv: KVNamespace): Env =>
  ({ DB: db, KV: kv, JWT_SECRET: "test-secret" } as unknown as Env);

// 极简 app：同一路径挂全部方法，仅由 authMiddleware 守卫。
// 只要请求走到 handler 就返回 200 —— 于是任何 403 都只能来自只读闸门。
const buildApp = () => {
  const app = new Hono<{ Bindings: Env; Variables: AuthVariables }>();
  app.use("/res", authMiddleware);
  app.use("/res/*", authMiddleware);
  app.get("/res", (c) => c.json({ ok: true, method: "GET" }));
  app.post("/res", (c) => c.json({ ok: true, method: "POST" }));
  app.put("/res/1", (c) => c.json({ ok: true, method: "PUT" }));
  app.delete("/res/1", (c) => c.json({ ok: true, method: "DELETE" }));
  return app;
};

const mintAgentToken = async (
  db: D1Database,
  role: UserRole = "finance"
): Promise<string> => {
  const { token } = await createAgentGrant(db, { wecomUserid: "MaxLiu", role });
  return token;
};

const mintHumanJwt = async (env: Env, role: UserRole = "finance"): Promise<string> => {
  const session = createSessionPayload({ userId: "MaxLiu", username: "MaxLiu", role });
  const issued = await issueTokens(env, session);
  return issued.accessToken;
};

interface ForbiddenBody {
  success: boolean;
  error: { message: string };
}

describe("agent-readonly policy helpers", () => {
  it("treats GET/HEAD/OPTIONS as read-only (case-insensitive)", () => {
    expect(isReadOnlyMethod("GET")).toBe(true);
    expect(isReadOnlyMethod("get")).toBe(true);
    expect(isReadOnlyMethod("HEAD")).toBe(true);
    expect(isReadOnlyMethod("OPTIONS")).toBe(true);
    expect(isReadOnlyMethod("options")).toBe(true);
  });

  it("treats mutating methods as NOT read-only", () => {
    expect(isReadOnlyMethod("POST")).toBe(false);
    expect(isReadOnlyMethod("PUT")).toBe(false);
    expect(isReadOnlyMethod("PATCH")).toBe(false);
    expect(isReadOnlyMethod("DELETE")).toBe(false);
    expect(isReadOnlyMethod("post")).toBe(false);
  });

  it("agentReadonlyForbidden returns a 403 JSON envelope with the read-only message", async () => {
    const res = agentReadonlyForbidden();
    expect(res.status).toBe(403);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = (await res.json()) as ForbiddenBody;
    expect(body.success).toBe(false);
    expect(body.error.message).toBe(AGENT_READONLY_MESSAGE);
    expect(AGENT_READONLY_MESSAGE).toBe("智能体令牌为只读，禁止写操作");
  });
});

describe("authMiddleware read-only gate for mcp_agent tokens", () => {
  it("lets an agent token GET a read route (200)", async () => {
    const { db } = createFakeD1();
    const { kv } = createFakeKV();
    const env = fakeEnv(db, kv);
    const token = await mintAgentToken(db);

    const res = await buildApp().request(
      "/res",
      { headers: { authorization: `Bearer ${token}` } },
      env
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; method: string };
    expect(body.ok).toBe(true);
    expect(body.method).toBe("GET");
  });

  it("blocks an agent-token POST with 403 read-only", async () => {
    const { db } = createFakeD1();
    const { kv } = createFakeKV();
    const env = fakeEnv(db, kv);
    const token = await mintAgentToken(db);

    const res = await buildApp().request(
      "/res",
      { method: "POST", headers: { authorization: `Bearer ${token}` } },
      env
    );

    expect(res.status).toBe(403);
    const body = (await res.json()) as ForbiddenBody;
    expect(body.success).toBe(false);
    expect(body.error.message).toBe(AGENT_READONLY_MESSAGE);
  });

  it("blocks an agent-token PUT with 403 read-only", async () => {
    const { db } = createFakeD1();
    const { kv } = createFakeKV();
    const env = fakeEnv(db, kv);
    const token = await mintAgentToken(db);

    const res = await buildApp().request(
      "/res/1",
      { method: "PUT", headers: { authorization: `Bearer ${token}` } },
      env
    );

    expect(res.status).toBe(403);
    const body = (await res.json()) as ForbiddenBody;
    expect(body.error.message).toBe(AGENT_READONLY_MESSAGE);
  });

  it("blocks an agent-token DELETE with 403 read-only", async () => {
    const { db } = createFakeD1();
    const { kv } = createFakeKV();
    const env = fakeEnv(db, kv);
    const token = await mintAgentToken(db);

    const res = await buildApp().request(
      "/res/1",
      { method: "DELETE", headers: { authorization: `Bearer ${token}` } },
      env
    );

    expect(res.status).toBe(403);
    const body = (await res.json()) as ForbiddenBody;
    expect(body.error.message).toBe(AGENT_READONLY_MESSAGE);
  });

  it("does NOT block a human JWT doing the same POST (gate is agent-only)", async () => {
    const { db } = createFakeD1();
    const { kv } = createFakeKV();
    const env = fakeEnv(db, kv);
    const jwt = await mintHumanJwt(env);

    const res = await buildApp().request(
      "/res",
      { method: "POST", headers: { authorization: `Bearer ${jwt}` } },
      env
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; method: string };
    expect(body.ok).toBe(true);
    expect(body.method).toBe("POST");
  });
});
