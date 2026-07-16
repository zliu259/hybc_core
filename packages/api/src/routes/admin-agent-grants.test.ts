import { describe, expect, it } from "vitest";

import { createFakeD1, createFakeKV } from "../test-support/agent-fakes";
import { createAgentGrant, getGrantById } from "../services/agent-grant";
import { adminRevokeAgentGrant, adminRoutes } from "./admin";
import type { Env } from "../types/env";

const fakeEnv = (db: D1Database, kv: KVNamespace): Env =>
  ({ DB: db, KV: kv, JWT_SECRET: "test-secret" } as unknown as Env);

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
  it("403 for a non-super_admin caller on GET /agent/grants", async () => {
    const { db } = createFakeD1();
    const { kv } = createFakeKV();
    const { token } = await createAgentGrant(db, {
      wecomUserid: "MaxLiu",
      role: "operator"
    });
    const res = await adminRoutes.request(
      "/agent/grants",
      { headers: { authorization: `Bearer ${token}` } },
      fakeEnv(db, kv)
    );
    expect(res.status).toBe(403);
  });

  it("200 for super_admin, rows tagged with owner and no token_hash", async () => {
    const { db } = createFakeD1();
    const { kv } = createFakeKV();
    const { token } = await createAgentGrant(db, {
      wecomUserid: "Boss",
      role: "super_admin"
    });
    await createAgentGrant(db, { wecomUserid: "SomeStaff", role: "operator" });
    const res = await adminRoutes.request(
      "/agent/grants",
      { headers: { authorization: `Bearer ${token}` } },
      fakeEnv(db, kv)
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

  it("404 on revoking a missing grant; revokes an existing one", async () => {
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
    const miss = await adminRoutes.request(
      "/agent/grants/does-not-exist/revoke",
      { method: "POST", headers: { authorization: `Bearer ${token}` } },
      fakeEnv(db, kv)
    );
    expect(miss.status).toBe(404);
    const okRes = await adminRoutes.request(
      `/agent/grants/${target.id}/revoke`,
      { method: "POST", headers: { authorization: `Bearer ${token}` } },
      fakeEnv(db, kv)
    );
    expect(okRes.status).toBe(200);
    expect((await getGrantById(db, target.id))?.status).toBe("revoked");
  });
});
