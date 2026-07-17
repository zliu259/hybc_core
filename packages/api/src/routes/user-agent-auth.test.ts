import { describe, expect, it } from "vitest";

import { userRoutes } from "./user";
import { AGENT_READONLY_MESSAGE } from "../middleware/agent-readonly";
import { createFakeD1, createFakeKV } from "../test-support/agent-fakes";
import { createAgentGrant } from "../services/agent-grant";
import { createSessionPayload, issueTokens } from "../services/auth";
import type { Env } from "../types/env";

const fakeEnv = (db: D1Database, kv: KVNamespace): Env =>
  ({ DB: db, KV: kv, JWT_SECRET: "test-secret" } as unknown as Env);

// /user/me 与 /user/routes 是人类网页面向的端点，@hybc/mcp 客户端从不调用它们
// （whoami 读本地凭证文件，不打 API）。deny-by-default 只读白名单下，agent 令牌访问它们
// 应被拦成 403 —— 这正是安全评审要求的收敛行为。人类 JWT 会话不受闸门影响。
describe("userRoutes deny-by-default for agent tokens (not in @hybc/mcp read surface)", () => {
  it("GET /me is BLOCKED (403 read-only) for an agent token", async () => {
    const { db } = createFakeD1();
    const { kv } = createFakeKV();
    const { token } = await createAgentGrant(db, {
      wecomUserid: "MaxLiu",
      role: "finance"
    });
    const env = fakeEnv(db, kv);

    const res = await userRoutes.request(
      "/me",
      { headers: { authorization: `Bearer ${token}` } },
      env
    );

    expect(res.status).toBe(403);
    const body = (await res.json()) as { success: boolean; error: { message: string } };
    expect(body.success).toBe(false);
    expect(body.error.message).toBe(AGENT_READONLY_MESSAGE);
  });

  it("GET /routes is BLOCKED (403 read-only) for an agent token", async () => {
    const { db } = createFakeD1();
    const { kv } = createFakeKV();
    const { token } = await createAgentGrant(db, {
      wecomUserid: "MaxLiu",
      role: "finance"
    });
    const env = fakeEnv(db, kv);

    const res = await userRoutes.request(
      "/routes",
      { headers: { authorization: `Bearer ${token}` } },
      env
    );

    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toBe(AGENT_READONLY_MESSAGE);
  });

  it("GET /me still works (200) for a human JWT session — gate is agent-only", async () => {
    const { db } = createFakeD1();
    const { kv } = createFakeKV();
    const env = fakeEnv(db, kv);
    const session = createSessionPayload({
      userId: "MaxLiu",
      username: "MaxLiu",
      role: "finance"
    });
    const issued = await issueTokens(env, session);

    const res = await userRoutes.request(
      "/me",
      { headers: { authorization: `Bearer ${issued.accessToken}` } },
      env
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: { auth_method: string; username: string };
    };
    expect(body.success).toBe(true);
    expect(body.data.auth_method).toBe("wecom_oauth");
    expect(body.data.username).toBe("MaxLiu");
  });
});
