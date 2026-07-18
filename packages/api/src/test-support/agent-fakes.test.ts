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

  it("still supports the existing agent_grant behaviour", async () => {
    const { createAgentGrant, getGrantById } = await import("../services/agent-grant");
    const { db } = createFakeD1();
    const { grant } = await createAgentGrant(db, { wecomUserid: "MaxLiu", role: "manager" });
    expect((await getGrantById(db, grant.id))?.status).toBe("active");
  });
});
