import { describe, expect, it } from "vitest";

import { agentRoutes } from "./agent";
import { createAgentGrant, getGrantById } from "../services/agent-grant";
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

describe("agent routes auth, ownership, and injection", () => {
  it("GET /grants returns only the caller's own grants", async () => {
    const { db } = createFakeD1();
    const { kv } = createFakeKV();
    const env = fakeEnv(db, kv);
    await createAgentGrant(db, { wecomUserid: "MaxLiu", role: "manager" });
    const { token } = await createAgentGrant(db, { wecomUserid: "MaxLiu", role: "manager" });
    await createAgentGrant(db, { wecomUserid: "OtherStaff", role: "operator" });
    const res = await agentRoutes.request(
      "/grants",
      { headers: { authorization: `Bearer ${token}` } },
      env
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data).toHaveLength(2); // only MaxLiu's grants, not OtherStaff's
  });

  it("POST /grants/:id/revoke 404s on another user's grant and leaves it active", async () => {
    const { db } = createFakeD1();
    const { kv } = createFakeKV();
    const env = fakeEnv(db, kv);
    const { token } = await createAgentGrant(db, { wecomUserid: "MaxLiu", role: "manager" });
    const { grant: other } = await createAgentGrant(db, {
      wecomUserid: "OtherStaff",
      role: "operator"
    });
    const res = await agentRoutes.request(
      `/grants/${other.id}/revoke`,
      { method: "POST", headers: { authorization: `Bearer ${token}` } },
      env
    );
    expect(res.status).toBe(404);
    expect((await getGrantById(db, other.id))?.status).toBe("active");
  });

  it("rejects agent tokens on /setup/provision and /device/approve with 403", async () => {
    const { db } = createFakeD1();
    const { kv } = createFakeKV();
    const env = fakeEnv(db, kv);
    const { token } = await createAgentGrant(db, {
      wecomUserid: "MaxLiu",
      role: "super_admin"
    });
    const prov = await agentRoutes.request(
      "/setup/provision",
      {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: "{}"
      },
      env
    );
    expect(prov.status).toBe(403);
    const appr = await agentRoutes.request(
      "/device/approve",
      {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ user_code: "AAAA-BBBB" })
      },
      env
    );
    expect(appr.status).toBe(403);
  });

  it("does not allow shell injection via install.sh boot param", async () => {
    const { db } = createFakeD1();
    const { kv } = createFakeKV();
    const env = fakeEnv(db, kv);
    const res = await agentRoutes.request(
      "/install.sh?boot=x%22%3B%20touch%20%2Ftmp%2Fpwned%20%3B%20%22",
      {},
      env
    );
    const text = await res.text();
    expect(text).not.toContain("touch /tmp/pwned");
    expect(text).toContain('HYBC_BOOT=""');
  });
});
