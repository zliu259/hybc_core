// packages/api/src/routes/agent-device-consent.test.ts
import { describe, expect, it } from "vitest";

import { agentRoutes } from "./agent";
import { createSessionPayload, issueTokens } from "../services/auth";
import { createAgentGrant } from "../services/agent-grant";
import { createFakeD1, createFakeKV } from "../test-support/agent-fakes";
import type { UserRole } from "../types/auth";
import type { Env } from "../types/env";

const fakeEnv = (db: D1Database, kv: KVNamespace): Env =>
  ({
    DB: db,
    KV: kv,
    JWT_SECRET: "test-secret",
    AGENT_WEB_BASE_URL: "https://web.hybcdg.com",
    AGENT_API_BASE_URL: "https://api.hybcdg.com"
  }) as unknown as Env;

const humanJwt = async (env: Env, role: UserRole = "manager"): Promise<string> => {
  const session = createSessionPayload({ userId: "MaxLiu", username: "MaxLiu", role });
  const issued = await issueTokens(env, session);
  return issued.accessToken;
};

const startDevice = async (env: Env) => {
  const res = await agentRoutes.request(
    "/device/code",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ device_name: "Max MBP", agent_type: "claude_code" })
    },
    env
  );
  const body = (await res.json()) as {
    data: { user_code: string; device_code: string };
  };
  return body.data;
};

describe("GET /device/info", () => {
  it("returns device metadata for a logged-in human", async () => {
    const { db } = createFakeD1();
    const { kv } = createFakeKV();
    const env = fakeEnv(db, kv);
    const { user_code } = await startDevice(env);
    const jwt = await humanJwt(env);
    const res = await agentRoutes.request(
      `/device/info?user_code=${encodeURIComponent(user_code)}`,
      { headers: { authorization: `Bearer ${jwt}` } },
      env
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Record<string, unknown> };
    expect(body.data).toMatchObject({
      user_code,
      device_name: "Max MBP",
      agent_type: "claude_code",
      status: "pending"
    });
  });

  it("404s for unknown user_code", async () => {
    const { db } = createFakeD1();
    const { kv } = createFakeKV();
    const env = fakeEnv(db, kv);
    const jwt = await humanJwt(env);
    const res = await agentRoutes.request(
      "/device/info?user_code=ZZZZ-ZZZZ",
      { headers: { authorization: `Bearer ${jwt}` } },
      env
    );
    expect(res.status).toBe(404);
  });

  it("403s for agent tokens (human-only consent surface)", async () => {
    const { db } = createFakeD1();
    const { kv } = createFakeKV();
    const env = fakeEnv(db, kv);
    const { user_code } = await startDevice(env);
    const { token } = await createAgentGrant(db, { wecomUserid: "MaxLiu", role: "manager" });
    const res = await agentRoutes.request(
      `/device/info?user_code=${encodeURIComponent(user_code)}`,
      { headers: { authorization: `Bearer ${token}` } },
      env
    );
    expect(res.status).toBe(403);
  });
});

describe("POST /device/deny", () => {
  it("marks the device denied and the poll reflects it", async () => {
    const { db } = createFakeD1();
    const { kv } = createFakeKV();
    const env = fakeEnv(db, kv);
    const { user_code, device_code } = await startDevice(env);
    const jwt = await humanJwt(env);
    const res = await agentRoutes.request(
      "/device/deny",
      {
        method: "POST",
        headers: { authorization: `Bearer ${jwt}`, "content-type": "application/json" },
        body: JSON.stringify({ user_code })
      },
      env
    );
    expect(res.status).toBe(200);
    const poll = await agentRoutes.request(
      "/device/token",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ device_code })
      },
      env
    );
    const pollBody = (await poll.json()) as { data: { status: string } };
    expect(pollBody.data.status).toBe("denied");
  });

  it("400s when denying an already-resolved request", async () => {
    const { db } = createFakeD1();
    const { kv } = createFakeKV();
    const env = fakeEnv(db, kv);
    const { user_code } = await startDevice(env);
    const jwt = await humanJwt(env);
    const first = await agentRoutes.request(
      "/device/deny",
      {
        method: "POST",
        headers: { authorization: `Bearer ${jwt}`, "content-type": "application/json" },
        body: JSON.stringify({ user_code })
      },
      env
    );
    expect(first.status).toBe(200);
    const second = await agentRoutes.request(
      "/device/deny",
      {
        method: "POST",
        headers: { authorization: `Bearer ${jwt}`, "content-type": "application/json" },
        body: JSON.stringify({ user_code })
      },
      env
    );
    expect(second.status).toBe(400);
  });

  it("403s for agent tokens", async () => {
    const { db } = createFakeD1();
    const { kv } = createFakeKV();
    const env = fakeEnv(db, kv);
    const { user_code } = await startDevice(env);
    const { token } = await createAgentGrant(db, { wecomUserid: "MaxLiu", role: "manager" });
    const res = await agentRoutes.request(
      "/device/deny",
      {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ user_code })
      },
      env
    );
    expect(res.status).toBe(403);
  });
});
