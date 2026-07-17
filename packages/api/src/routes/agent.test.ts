import { describe, expect, it } from "vitest";

import { agentRoutes } from "./agent";
import { AGENT_READONLY_MESSAGE } from "../middleware/agent-readonly";
import { createAgentGrant, getGrantById } from "../services/agent-grant";
import { createSessionPayload, issueTokens } from "../services/auth";
import { createFakeD1, createFakeKV } from "../test-support/agent-fakes";
import type { Env } from "../types/env";

const humanJwt = async (env: Env, userId = "MaxLiu"): Promise<string> => {
  const session = createSessionPayload({ userId, username: userId, role: "manager" });
  const issued = await issueTokens(env, session);
  return issued.accessToken;
};

const fakeFiles = (files: Record<string, string>) =>
  ({
    async get(key: string) {
      if (!(key in files)) return null;
      return {
        body: files[key],
        httpEtag: '"etag"',
        writeHttpMetadata: () => undefined,
        async text() {
          return files[key];
        }
      };
    }
  }) as unknown as Env["FILES"];

const fakeEnv = (db: D1Database, kv: KVNamespace): Env =>
  ({
    DB: db,
    KV: kv,
    JWT_SECRET: "test-secret",
    AGENT_WEB_BASE_URL: "https://web.hybcdg.com",
    AGENT_API_BASE_URL: "https://api.hybcdg.com",
    FILES: fakeFiles({
      "agent-dist/install.sh": 'HYBC_API="__HYBC_API__"\nHYBC_BOOT="__HYBC_BOOT__"\n'
    })
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

  // 撤销走 POST；只读闸门后 agent 令牌已不能自助撤销（须本人网页操作），
  // 因此本用例改由「本人网页 JWT」发起，仍覆盖归属校验：不能撤销他人授权。
  it("POST /grants/:id/revoke 404s on another user's grant and leaves it active (human session)", async () => {
    const { db } = createFakeD1();
    const { kv } = createFakeKV();
    const env = fakeEnv(db, kv);
    const jwt = await humanJwt(env, "MaxLiu");
    const { grant: other } = await createAgentGrant(db, {
      wecomUserid: "OtherStaff",
      role: "operator"
    });
    const res = await agentRoutes.request(
      `/grants/${other.id}/revoke`,
      { method: "POST", headers: { authorization: `Bearer ${jwt}` } },
      env
    );
    expect(res.status).toBe(404);
    expect((await getGrantById(db, other.id))?.status).toBe("active");
  });

  // 只读闸门：agent 令牌对撤销端点(POST)一律 403，连自己的授权也不能自助撤销 —— 承接
  // P1c「只读」承诺。撤销须走本人网页会话。
  it("blocks agent-token self-revoke with 403 read-only and leaves the grant active", async () => {
    const { db } = createFakeD1();
    const { kv } = createFakeKV();
    const env = fakeEnv(db, kv);
    const { token, grant } = await createAgentGrant(db, {
      wecomUserid: "MaxLiu",
      role: "manager"
    });
    const res = await agentRoutes.request(
      `/grants/${grant.id}/revoke`,
      { method: "POST", headers: { authorization: `Bearer ${token}` } },
      env
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toBe(AGENT_READONLY_MESSAGE);
    expect((await getGrantById(db, grant.id))?.status).toBe("active");
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
