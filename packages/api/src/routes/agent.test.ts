import { describe, expect, it } from "vitest";

import { agentRoutes } from "./agent";
import { createFakeD1, createFakeKV } from "../test-support/agent-fakes";
import type { Env } from "../types/env";

const fakeEnv = (db: D1Database, kv: KVNamespace): Env =>
  ({
    DB: db,
    KV: kv,
    JWT_SECRET: "test-secret",
    AGENT_WEB_BASE_URL: "https://web.hybcdg.com",
    AGENT_API_BASE_URL: "https://api.hybcdg.com"
  }) as unknown as Env;

describe("agent routes device flow", () => {
  it("POST /device/code returns codes and verification uri", async () => {
    const { db } = createFakeD1();
    const { kv } = createFakeKV();
    const res = await agentRoutes.request(
      "/device/code",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ device_name: "Max MacBook", agent_type: "claude_code" })
      },
      fakeEnv(db, kv)
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: { user_code: string } };
    expect(body.success).toBe(true);
    expect(body.data.user_code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  });

  it("POST /device/token pending before approval", async () => {
    const { db } = createFakeD1();
    const { kv } = createFakeKV();
    const start = await agentRoutes.request(
      "/device/code",
      { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
      fakeEnv(db, kv)
    );
    const { data } = (await start.json()) as { data: { device_code: string } };
    const poll = await agentRoutes.request(
      "/device/token",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ device_code: data.device_code })
      },
      fakeEnv(db, kv)
    );
    const pollBody = (await poll.json()) as { data: { status: string } };
    expect(pollBody.data.status).toBe("authorization_pending");
  });
});
