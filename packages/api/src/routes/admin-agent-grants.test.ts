import { describe, expect, it } from "vitest";

import { createFakeD1, createFakeKV } from "../test-support/agent-fakes";
import { AGENT_READONLY_MESSAGE } from "../middleware/agent-readonly";
import { createAgentGrant, getGrantById } from "../services/agent-grant";
import { createSessionPayload, issueTokens } from "../services/auth";
import { adminRevokeAgentGrant, adminRoutes } from "./admin";
import type { UserRole } from "../types/auth";
import type { Env } from "../types/env";

const fakeEnv = (db: D1Database, kv: KVNamespace): Env =>
  ({ DB: db, KV: kv, JWT_SECRET: "test-secret" } as unknown as Env);

const humanJwt = async (env: Env, userId: string, role: UserRole): Promise<string> => {
  const session = createSessionPayload({ userId, username: userId, role });
  const issued = await issueTokens(env, session);
  return issued.accessToken;
};

const superAdminJwt = (env: Env, userId = "Boss"): Promise<string> =>
  humanJwt(env, userId, "super_admin");

describe("admin revoke agent grant (service-level)", () => {
  it("super_admin can revoke any grant", async () => {
    const { db } = createFakeD1();
    const { grant } = await createAgentGrant(db, {
      wecomUserid: "SomeStaff",
      role: "operator"
    });
    await adminRevokeAgentGrant(db, grant.id, "super_admin_user");
    const after = await getGrantById(db, grant.id);
    expect(after?.status).toBe("revoked");
    expect(after?.revoked_by).toBe("super_admin_user");
  });
});

describe("admin agent-grant routes (authz + owner visibility)", () => {
  // 保留 RBAC 归属校验：非 super_admin 的【本人网页 JWT】访问被 403。
  // （agent 令牌无论角色都会先被只读闸门 403，另有专门用例覆盖。）
  it("403 for a non-super_admin human caller on GET /agent/grants", async () => {
    const { db } = createFakeD1();
    const { kv } = createFakeKV();
    const env = fakeEnv(db, kv);
    const jwt = await humanJwt(env, "MaxLiu", "operator");
    const res = await adminRoutes.request(
      "/agent/grants",
      { headers: { authorization: `Bearer ${jwt}` } },
      env
    );
    expect(res.status).toBe(403);
  });

  // super_admin 只能通过【本人网页 JWT】访问（agent 令牌即便 super_admin 也被只读闸门拦截）。
  it("200 for super_admin (human session), rows tagged with owner and no token_hash", async () => {
    const { db } = createFakeD1();
    const { kv } = createFakeKV();
    const env = fakeEnv(db, kv);
    const jwt = await superAdminJwt(env);
    await createAgentGrant(db, { wecomUserid: "SomeStaff", role: "operator" });
    await createAgentGrant(db, { wecomUserid: "OtherStaff", role: "operator" });
    const res = await adminRoutes.request(
      "/agent/grants",
      { headers: { authorization: `Bearer ${jwt}` } },
      env
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<Record<string, unknown>>;
    };
    expect(body.data.length).toBe(2);
    for (const row of body.data) {
      expect(row).toHaveProperty("wecom_userid");
      expect(row).not.toHaveProperty("token_hash");
    }
  });

  // 撤销走 POST；只读闸门后 agent 令牌(含 super_admin)不能发起写操作，管理员撤销须走本人网页会话。
  it("404 on revoking a missing grant; revokes an existing one (human super_admin session)", async () => {
    const { db } = createFakeD1();
    const { kv } = createFakeKV();
    const env = fakeEnv(db, kv);
    const jwt = await superAdminJwt(env);
    const { grant: target } = await createAgentGrant(db, {
      wecomUserid: "SomeStaff",
      role: "operator"
    });
    const miss = await adminRoutes.request(
      "/agent/grants/does-not-exist/revoke",
      { method: "POST", headers: { authorization: `Bearer ${jwt}` } },
      env
    );
    expect(miss.status).toBe(404);
    const okRes = await adminRoutes.request(
      `/agent/grants/${target.id}/revoke`,
      { method: "POST", headers: { authorization: `Bearer ${jwt}` } },
      env
    );
    expect(okRes.status).toBe(200);
    expect((await getGrantById(db, target.id))?.status).toBe("revoked");
  });

  // 只读闸门：即便是 super_admin 的 agent 令牌，也不能经 POST 撤销授权 —— 403，且目标保持 active。
  it("blocks a super_admin agent-token from POST-revoking with 403 read-only", async () => {
    const { db } = createFakeD1();
    const { kv } = createFakeKV();
    const { token } = await createAgentGrant(db, {
      wecomUserid: "Boss",
      role: "super_admin"
    });
    const { grant: target } = await createAgentGrant(db, {
      wecomUserid: "SomeStaff",
      role: "operator"
    });
    const res = await adminRoutes.request(
      `/agent/grants/${target.id}/revoke`,
      { method: "POST", headers: { authorization: `Bearer ${token}` } },
      fakeEnv(db, kv)
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toBe(AGENT_READONLY_MESSAGE);
    expect((await getGrantById(db, target.id))?.status).toBe("active");
  });
});
