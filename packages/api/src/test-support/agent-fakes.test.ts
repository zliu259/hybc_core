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

  /**
   * 假实现的【保真度】本身要被钉住:过期守卫必须按传入的 SQL 施加,不能硬编码。
   *
   * 硬编码时,假实现断言的是自己的模型而非生产语句 —— 把 `AND expires_at > ?` 从
   * confirmPending 里删掉,过期确认在测试里【依然】会被挡住,于是整套测试全绿,
   * 而生产中一张躺了几个月的旧卡片已经能批准付款了。这正是本轮变异测试抓到的漏洞。
   *
   * 故:SQL 带该合取项 → 过期行 0 行受影响(上一个用例);不带 → 必须真的 1 行受影响。
   */
  it("applies the expires_at guard on confirm ONLY when the SQL carries the conjunct", async () => {
    const { db } = createFakeD1();
    await insertPending(db, "p1");
    const res = await db
      .prepare(
        // 刻意缺失 `AND expires_at > ?` —— 模拟生产 SQL 丢掉守卫的那次变异。
        `UPDATE agent_pending_action SET status = 'confirmed', confirmed_at = ?
         WHERE id = ? AND status = 'pending'`
      )
      .bind("2026-07-18T00:00:00.000Z", "p1", "2026-07-18T00:00:00.000Z")
      .run();
    // 无守卫的语句就该毫无阻拦地改掉早已过期的行 —— 假实现必须如实反映这件事,
    // 才能让上层测试把「守卫消失」看成失败。
    expect(res.meta.changes).toBe(1);
  });

  it("counts outstanding pending rows per grant, honouring both conjuncts", async () => {
    const { db, pendings } = createFakeD1();
    await insertPending(db, "p1");
    await insertPending(db, "p2");
    await insertPending(db, "p3", "confirmed"); // 已确认:不在途
    await insertPending(db, "p4");
    pendings.set("p4", { ...pendings.get("p4"), grant_id: "g2" }); // 另一个 grant
    pendings.set("p2", { ...pendings.get("p2"), expires_at: "2026-07-17T00:00:01.000Z" }); // 已过期

    const count = async (grantId: string, now: string) =>
      (
        await db
          .prepare(
            `SELECT COUNT(*) AS n FROM agent_pending_action WHERE grant_id = ? AND status = 'pending' AND expires_at > ?`
          )
          .bind(grantId, now)
          .first<{ n: number }>()
      )?.n;

    expect(await count("g1", "2026-07-17T00:05:00.000Z")).toBe(1); // 只有 p1
    expect(await count("g2", "2026-07-17T00:05:00.000Z")).toBe(1); // 只有 p4
    expect(await count("g1", "2026-07-17T23:00:00.000Z")).toBe(0); // 全部过期
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
