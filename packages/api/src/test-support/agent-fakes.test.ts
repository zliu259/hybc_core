import { describe, expect, it } from "vitest";

import { createFakeD1 } from "./agent-fakes";

const insertPending = async (db: D1Database, id: string, status = "pending") => {
  await db
    .prepare(
      `INSERT INTO agent_pending_action
        (id, grant_id, wecom_userid, action_kind, request_snapshot, risk_reason, summary,
         status, confirm_token_hash, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      "g1",
      "MaxLiu",
      "approval.approve",
      "{}",
      "r",
      "s",
      status,
      `hash-${id}`,
      "2026-07-17T00:00:00.000Z",
      "2026-07-17T00:10:00.000Z"
    )
    .run();
};

describe("fake D1 · agent_pending_action", () => {
  it("inserts and reads back by id", async () => {
    const { db } = createFakeD1();
    await insertPending(db, "p1");
    const row = await db
      .prepare("SELECT * FROM agent_pending_action WHERE id = ?")
      .bind("p1")
      .first<{ id: string; status: string }>();
    expect(row?.id).toBe("p1");
    expect(row?.status).toBe("pending");
  });

  it("reads back by confirm_token_hash", async () => {
    const { db } = createFakeD1();
    await insertPending(db, "p1");
    const row = await db
      .prepare("SELECT * FROM agent_pending_action WHERE confirm_token_hash = ?")
      .bind("hash-p1")
      .first<{ id: string }>();
    expect(row?.id).toBe("p1");
  });

  it("conditional UPDATE reports meta.changes = 1 on the winner and 0 on the loser", async () => {
    const { db } = createFakeD1();
    await insertPending(db, "p1");
    const first = await db
      .prepare(
        `UPDATE agent_pending_action SET status = 'confirmed', confirmed_at = ?
         WHERE id = ? AND status = 'pending' AND expires_at > ?`
      )
      .bind("2026-07-17T00:01:00.000Z", "p1", "2026-07-17T00:01:00.000Z")
      .run();
    expect(first.meta.changes).toBe(1);

    const second = await db
      .prepare(
        `UPDATE agent_pending_action SET status = 'confirmed', confirmed_at = ?
         WHERE id = ? AND status = 'pending' AND expires_at > ?`
      )
      .bind("2026-07-17T00:01:00.000Z", "p1", "2026-07-17T00:01:00.000Z")
      .run();
    expect(second.meta.changes).toBe(0);
  });

  it("expired rows fail the expires_at guard", async () => {
    const { db } = createFakeD1();
    await insertPending(db, "p1");
    const res = await db
      .prepare(
        `UPDATE agent_pending_action SET status = 'confirmed', confirmed_at = ?
         WHERE id = ? AND status = 'pending' AND expires_at > ?`
      )
      .bind("2026-07-18T00:00:00.000Z", "p1", "2026-07-18T00:00:00.000Z")
      .run();
    expect(res.meta.changes).toBe(0);
  });

  it("claim-for-execution transitions confirmed → executing exactly once", async () => {
    const { db } = createFakeD1();
    await insertPending(db, "p1", "confirmed");
    const a = await db
      .prepare(
        `UPDATE agent_pending_action SET status = 'executing' WHERE id = ? AND status = 'confirmed'`
      )
      .bind("p1")
      .run();
    const b = await db
      .prepare(
        `UPDATE agent_pending_action SET status = 'executing' WHERE id = ? AND status = 'confirmed'`
      )
      .bind("p1")
      .run();
    expect(a.meta.changes).toBe(1);
    expect(b.meta.changes).toBe(0);
  });

  it("finish writes status, result_snapshot and clears the request snapshot", async () => {
    const { db } = createFakeD1();
    await insertPending(db, "p1", "executing");
    const res = await db
      .prepare(
        `UPDATE agent_pending_action SET status = ?, result_snapshot = ?, request_snapshot = '', executed_at = ?
         WHERE id = ? AND status = 'executing'`
      )
      .bind("done", '{"status":200}', "2026-07-17T00:02:00.000Z", "p1")
      .run();
    expect(res.meta.changes).toBe(1);
    const row = await db
      .prepare("SELECT * FROM agent_pending_action WHERE id = ?")
      .bind("p1")
      .first<{ status: string; result_snapshot: string; request_snapshot: string }>();
    expect(row?.status).toBe("done");
    expect(row?.result_snapshot).toBe('{"status":200}');
    expect(row?.request_snapshot).toBe("");
  });

  it("reject only fires from pending", async () => {
    const { db } = createFakeD1();
    await insertPending(db, "p1", "confirmed");
    const res = await db
      .prepare(
        `UPDATE agent_pending_action SET status = 'rejected', request_snapshot = '' WHERE id = ? AND status = 'pending'`
      )
      .bind("p1")
      .run();
    expect(res.meta.changes).toBe(0);
  });

  it("reject fires from pending and clears the request snapshot", async () => {
    const { db } = createFakeD1();
    await insertPending(db, "p1");
    const res = await db
      .prepare(
        `UPDATE agent_pending_action SET status = 'rejected', request_snapshot = '' WHERE id = ? AND status = 'pending'`
      )
      .bind("p1")
      .run();
    expect(res.meta.changes).toBe(1);
    const row = await db
      .prepare("SELECT * FROM agent_pending_action WHERE id = ?")
      .bind("p1")
      .first<{ status: string; request_snapshot: string }>();
    expect(row?.status).toBe("rejected");
    expect(row?.request_snapshot).toBe("");
  });

  it("throws on an unrecognised agent_pending_action UPDATE instead of reporting 0 rows", async () => {
    const { db } = createFakeD1();
    await insertPending(db, "p1");
    await expect(
      db
        .prepare(`UPDATE agent_pending_action SET status='confirmed' WHERE id = ?`)
        .bind("p1")
        .run()
    ).rejects.toThrow(/unhandled agent_pending_action UPDATE/);
  });

  it("rejects a duplicate primary key on insert", async () => {
    const { db } = createFakeD1();
    await insertPending(db, "p1");
    await expect(insertPending(db, "p1")).rejects.toThrow(/UNIQUE constraint failed/);
  });
});

describe("fake D1 · agent_pending_action read fidelity", () => {
  it("applies WHERE conjuncts after the id/hash predicate", async () => {
    const { db } = createFakeD1();
    await insertPending(db, "p1", "rejected");
    const byToken = await db
      .prepare(
        "SELECT * FROM agent_pending_action WHERE confirm_token_hash = ? AND status = 'pending'"
      )
      .bind("hash-p1")
      .first<{ id: string }>();
    expect(byToken).toBeNull();

    const byId = await db
      .prepare("SELECT * FROM agent_pending_action WHERE id = ? AND status = 'pending'")
      .bind("p1")
      .first<{ id: string }>();
    expect(byId).toBeNull();
  });

  it("applies the expires_at conjunct on reads", async () => {
    const { db } = createFakeD1();
    await insertPending(db, "p1");
    const live = await db
      .prepare(
        "SELECT * FROM agent_pending_action WHERE confirm_token_hash = ? AND expires_at > ?"
      )
      .bind("hash-p1", "2026-07-17T00:01:00.000Z")
      .first<{ id: string }>();
    expect(live?.id).toBe("p1");

    const expired = await db
      .prepare(
        "SELECT * FROM agent_pending_action WHERE confirm_token_hash = ? AND expires_at > ?"
      )
      .bind("hash-p1", "2026-07-18T00:00:00.000Z")
      .first<{ id: string }>();
    expect(expired).toBeNull();
  });

  it("all() reads pending rows, not grant rows, and honours its filters", async () => {
    const { createAgentGrant } = await import("../services/agent-grant");
    const { db } = createFakeD1();
    await createAgentGrant(db, { wecomUserid: "MaxLiu", role: "manager" });
    await insertPending(db, "p1");
    await insertPending(db, "p2", "rejected");

    const all = await db
      .prepare("SELECT * FROM agent_pending_action WHERE wecom_userid = ?")
      .bind("MaxLiu")
      .all<{ id: string }>();
    expect(all.results.map((r) => r.id).sort()).toEqual(["p1", "p2"]);

    const onlyPending = await db
      .prepare(
        "SELECT * FROM agent_pending_action WHERE wecom_userid = ? AND status = 'pending'"
      )
      .bind("MaxLiu")
      .all<{ id: string }>();
    expect(onlyPending.results.map((r) => r.id)).toEqual(["p1"]);

    const otherUser = await db
      .prepare("SELECT * FROM agent_pending_action WHERE wecom_userid = ?")
      .bind("SomeoneElse")
      .all<{ id: string }>();
    expect(otherUser.results).toEqual([]);
  });

  it("still supports the existing agent_grant behaviour, including rows-affected on revoke", async () => {
    const { createAgentGrant, getGrantById } = await import("../services/agent-grant");
    const { db } = createFakeD1();
    const { grant } = await createAgentGrant(db, { wecomUserid: "MaxLiu", role: "manager" });
    expect((await getGrantById(db, grant.id))?.status).toBe("active");

    const revokeSql = `UPDATE agent_grant SET status = 'revoked', revoked_at = ?, revoked_by = ?
        WHERE id = ? AND status = 'active'`;
    const first = await db
      .prepare(revokeSql)
      .bind("2026-07-17T00:00:00.000Z", "admin", grant.id)
      .run();
    const second = await db
      .prepare(revokeSql)
      .bind("2026-07-17T00:00:00.000Z", "admin", grant.id)
      .run();
    expect(first.meta.changes).toBe(1);
    expect(second.meta.changes).toBe(0);
    expect((await getGrantById(db, grant.id))?.status).toBe("revoked");
  });
});
