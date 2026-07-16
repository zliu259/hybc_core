import { describe, expect, it } from "vitest";

import { userRoutes } from "./user";
import { createFakeD1, createFakeKV } from "../test-support/agent-fakes";
import { createAgentGrant } from "../services/agent-grant";
import type { Env } from "../types/env";

const fakeEnv = (db: D1Database, kv: KVNamespace): Env =>
  ({ DB: db, KV: kv, JWT_SECRET: "test-secret" } as unknown as Env);

describe("userRoutes with agent token", () => {
  it("GET /me returns 200 with mcp_agent auth_method and roles", async () => {
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

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: { auth_method: string; roles: string[]; username: string };
    };
    expect(body.success).toBe(true);
    expect(body.data.auth_method).toBe("mcp_agent");
    expect(body.data.roles).toEqual(["finance"]);
    expect(body.data.username).toBe("MaxLiu");
  });

  it("GET /routes returns 200 for a valid agent token", async () => {
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

    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: unknown[] };
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });
});
