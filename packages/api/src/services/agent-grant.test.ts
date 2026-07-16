import { describe, expect, it } from "vitest";

import { createFakeD1 } from "../test-support/agent-fakes";
import {
  createAgentGrant,
  getGrantById,
  listAllGrants,
  listGrantsForUser,
  resolveAgentByToken,
  revokeGrant,
  touchGrantLastUsed
} from "./agent-grant";

describe("agent-grant", () => {
  it("creates a grant and resolves it by the plaintext token", async () => {
    const { db } = createFakeD1();
    const { grant, token } = await createAgentGrant(db, {
      wecomUserid: "MaxLiu",
      role: "finance",
      deviceName: "Max MacBook",
      agentType: "claude_code"
    });
    expect(grant.status).toBe("active");
    expect(new Date(grant.expires_at).getTime()).toBeGreaterThan(Date.now());

    const identity = await resolveAgentByToken(db, token);
    expect(identity).not.toBeNull();
    expect(identity?.wecomUserid).toBe("MaxLiu");
    expect(identity?.roles).toEqual(["finance"]);
    expect(identity?.permissions).toContain("payment:write");
    expect(identity?.grantId).toBe(grant.id);
  });

  it("returns null for unknown or revoked tokens", async () => {
    const { db } = createFakeD1();
    const { grant, token } = await createAgentGrant(db, {
      wecomUserid: "MaxLiu",
      role: "operator"
    });
    expect(await resolveAgentByToken(db, "hybc_agent_nope")).toBeNull();

    await revokeGrant(db, grant.id, "super_admin");
    expect(await resolveAgentByToken(db, token)).toBeNull();
  });

  it("expires grants past expires_at", async () => {
    const { db, grants } = createFakeD1();
    const { grant, token } = await createAgentGrant(db, {
      wecomUserid: "MaxLiu",
      role: "operator"
    });
    grants.set(grant.id, {
      ...grants.get(grant.id)!,
      expires_at: new Date(Date.now() - 1000).toISOString()
    });
    expect(await resolveAgentByToken(db, token)).toBeNull();
    expect(grants.get(grant.id)?.status).toBe("expired");
  });

  it("lists a user's grants without leaking token_hash", async () => {
    const { db } = createFakeD1();
    await createAgentGrant(db, { wecomUserid: "MaxLiu", role: "manager" });
    const views = await listGrantsForUser(db, "MaxLiu");
    expect(views).toHaveLength(1);
    expect(views[0]).not.toHaveProperty("token_hash");
    expect(views[0]).toHaveProperty("token_prefix");
  });

  it("throttles last_used_at updates", async () => {
    const { db, grants } = createFakeD1();
    const { grant } = await createAgentGrant(db, {
      wecomUserid: "MaxLiu",
      role: "operator"
    });
    await touchGrantLastUsed(db, grant.id);
    const first = grants.get(grant.id)?.last_used_at;
    expect(first).toBeTruthy();
    await touchGrantLastUsed(db, grant.id); // within threshold -> no change
    expect(grants.get(grant.id)?.last_used_at).toBe(first);
  });

  it("persists only the SHA-256 hash, never the plaintext token", async () => {
    const { db, grants } = createFakeD1();
    const { grant, token } = await createAgentGrant(db, {
      wecomUserid: "MaxLiu",
      role: "operator"
    });
    const stored = grants.get(grant.id)!;
    expect(stored.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.token_hash).not.toBe(token);
    expect(JSON.stringify(stored)).not.toContain(token);
  });

  it("scopes listGrantsForUser to the owner; listAllGrants returns every grant", async () => {
    const { db } = createFakeD1();
    await createAgentGrant(db, { wecomUserid: "MaxLiu", role: "manager" });
    await createAgentGrant(db, { wecomUserid: "OtherStaff", role: "operator" });
    const mine = await listGrantsForUser(db, "MaxLiu");
    expect(mine).toHaveLength(1);
    const all = await listAllGrants(db);
    expect(all).toHaveLength(2);
  });

  it("fetches a grant by id and returns null for an unknown id", async () => {
    const { db } = createFakeD1();
    const { grant } = await createAgentGrant(db, {
      wecomUserid: "MaxLiu",
      role: "operator"
    });
    expect((await getGrantById(db, grant.id))?.id).toBe(grant.id);
    expect(await getGrantById(db, "nope")).toBeNull();
  });

  it("revocation is idempotent and preserves the first revoker", async () => {
    const { db, grants } = createFakeD1();
    const { grant } = await createAgentGrant(db, {
      wecomUserid: "MaxLiu",
      role: "operator"
    });
    await revokeGrant(db, grant.id, "admin_one");
    await revokeGrant(db, grant.id, "admin_two"); // no-op: WHERE status='active'
    const stored = grants.get(grant.id)!;
    expect(stored.status).toBe("revoked");
    expect(stored.revoked_by).toBe("admin_one");
  });
});
