import { describe, expect, it } from "vitest";

import {
  PENDING_TTL_SECONDS,
  STALE_EXECUTING_GRACE_SECONDS,
  claimForExecution,
  confirmPending,
  finishPending,
  getPendingByConfirmToken,
  getPendingById,
  parkPendingAction,
  rejectPending,
  sweepStalePendingActions,
  toPublicView
} from "./agent-pending";
import { createFakeD1, type FakeD1 } from "../test-support/agent-fakes";

const park = async (db: D1Database) =>
  parkPendingAction(db, {
    grantId: "g1",
    wecomUserid: "MaxLiu",
    actionKind: "approval.approve",
    riskReason: "智能体请求批准审批单",
    summary: "批准审批单 #42",
    snapshot: {
      method: "POST",
      path: "/api/v1/approval/42/approve",
      headers: { authorization: "Bearer hybc_agent_x", "content-type": "application/json" },
      body: '{"comment":"ok"}'
    }
  });

describe("parkPendingAction", () => {
  it("stores a pending row and returns a one-time confirm token", async () => {
    const { db } = createFakeD1();
    const parked = await park(db);
    expect(parked.id).toBeTruthy();
    expect(parked.confirmToken).toBeTruthy();
    const row = await getPendingById(db, parked.id);
    expect(row?.status).toBe("pending");
    expect(row?.wecom_userid).toBe("MaxLiu");
    expect(row?.confirm_token_hash).not.toBe(parked.confirmToken);
  });

  it("generates a uuid id with no ':' (the replay signing payload is id:bodyHash)", async () => {
    const { db } = createFakeD1();
    const parked = await park(db);
    expect(parked.id).not.toContain(":");
    expect(parked.id).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("is findable by confirm token and not by a wrong one", async () => {
    const { db } = createFakeD1();
    const parked = await park(db);
    expect((await getPendingByConfirmToken(db, parked.confirmToken))?.id).toBe(parked.id);
    expect(await getPendingByConfirmToken(db, "wrong-token")).toBeNull();
  });

  it("issues a distinct token per park", async () => {
    const { db } = createFakeD1();
    const a = await park(db);
    const b = await park(db);
    expect(a.confirmToken).not.toBe(b.confirmToken);
    expect(a.id).not.toBe(b.id);
  });
});

describe("state machine (optimistic locking)", () => {
  it("confirms once; a second confirm is a no-op", async () => {
    const { db } = createFakeD1();
    const parked = await park(db);
    expect(await confirmPending(db, parked.id)).toBe(true);
    expect(await confirmPending(db, parked.id)).toBe(false);
    expect((await getPendingById(db, parked.id))?.status).toBe("confirmed");
  });

  it("rejects once, clears the snapshot, and cannot then be confirmed", async () => {
    const { db } = createFakeD1();
    const parked = await park(db);
    expect(await rejectPending(db, parked.id)).toBe(true);
    expect(await rejectPending(db, parked.id)).toBe(false);
    expect(await confirmPending(db, parked.id)).toBe(false);
    const row = await getPendingById(db, parked.id);
    expect(row?.status).toBe("rejected");
    expect(row?.request_snapshot).toBe("");
  });

  it("claims execution exactly once", async () => {
    const { db } = createFakeD1();
    const parked = await park(db);
    await confirmPending(db, parked.id);
    expect(await claimForExecution(db, parked.id)).toBe(true);
    expect(await claimForExecution(db, parked.id)).toBe(false);
    expect((await getPendingById(db, parked.id))?.status).toBe("executing");
  });

  it("cannot claim without confirming first", async () => {
    const { db } = createFakeD1();
    const parked = await park(db);
    expect(await claimForExecution(db, parked.id)).toBe(false);
  });

  it("finishes with done, stores the result, and clears the bearer-token snapshot", async () => {
    const { db } = createFakeD1();
    const parked = await park(db);
    await confirmPending(db, parked.id);
    await claimForExecution(db, parked.id);
    expect(await finishPending(db, parked.id, "done", { status: 200, body: { success: true } })).toBe(true);
    const row = await getPendingById(db, parked.id);
    expect(row?.status).toBe("done");
    expect(JSON.parse(row?.result_snapshot as string)).toMatchObject({ status: 200 });
    expect(row?.request_snapshot).toBe("");
  });

  it("finishes with failed for a business error", async () => {
    const { db } = createFakeD1();
    const parked = await park(db);
    await confirmPending(db, parked.id);
    await claimForExecution(db, parked.id);
    await finishPending(db, parked.id, "failed", { status: 400, body: { success: false } });
    expect((await getPendingById(db, parked.id))?.status).toBe("failed");
  });

  it("cannot finish without claiming", async () => {
    const { db } = createFakeD1();
    const parked = await park(db);
    await confirmPending(db, parked.id);
    expect(await finishPending(db, parked.id, "done", { status: 200, body: {} })).toBe(false);
  });
});

describe("toPublicView", () => {
  it("never leaks the request snapshot or the token hash", async () => {
    const { db } = createFakeD1();
    const parked = await park(db);
    const row = await getPendingById(db, parked.id);
    const view = toPublicView(row!);
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain("Bearer");
    expect(serialized).not.toContain("authorization");
    expect(serialized).not.toContain(row!.confirm_token_hash);
    expect(serialized).not.toContain(row!.grant_id);
    expect(serialized).not.toContain(row!.wecom_userid);
    expect(view).toMatchObject({ id: parked.id, status: "pending", summary: "批准审批单 #42" });
  });

  it("reports expired for a past-due row still awaiting confirmation", async () => {
    const { db } = createFakeD1();
    const parked = await park(db);
    const row = await getPendingById(db, parked.id);
    expect(toPublicView({ ...row!, expires_at: "2000-01-01T00:00:00.000Z" }).status).toBe("expired");
  });

  // expires_at 只界定「确认窗口」。已确认的动作仍可被 claim 执行（claimForExecution 刻意不看过期），
  // 若因超时把它显示成 expired，就是先告诉用户「没发生」、随后它却执行了。
  it("does NOT relabel a past-due confirmed row as expired (it can still execute)", async () => {
    const { db } = createFakeD1();
    const parked = await park(db);
    await confirmPending(db, parked.id);
    const row = await getPendingById(db, parked.id);
    expect(toPublicView({ ...row!, expires_at: "2000-01-01T00:00:00.000Z" }).status).toBe(
      "confirmed"
    );
  });

  // 最危险的一档：executing 意味着写可能已经落库。谎报 expired = 谎报「什么都没发生」。
  it("does NOT relabel a past-due executing row as expired (the write may already have landed)", async () => {
    const { db } = createFakeD1();
    const parked = await park(db);
    await confirmPending(db, parked.id);
    await claimForExecution(db, parked.id);
    const row = await getPendingById(db, parked.id);
    expect(toPublicView({ ...row!, expires_at: "2000-01-01T00:00:00.000Z" }).status).toBe(
      "executing"
    );
  });

  it.each(["done", "failed", "rejected"] as const)(
    "does NOT relabel a settled %s row as expired even when past due",
    async (status) => {
      const { db } = createFakeD1();
      const parked = await park(db);
      const row = await getPendingById(db, parked.id);
      const settled = { ...row!, expires_at: "2000-01-01T00:00:00.000Z", status };
      expect(toPublicView(settled).status).toBe(status);
    }
  );
});

describe("sweepStalePendingActions", () => {
  /**
   * 把行的 created_at 往前拨。不用 graceSeconds=0 来制造「已过期」：
   * park→confirm→claim→sweep 可能落在同一毫秒内，`created_at < cutoff` 会因相等而不成立，
   * 使测试偶发失败。直接伪造一个确实很旧的行既确定，又更贴近真实场景。
   */
  const backdate = (pendings: FakeD1["pendings"], id: string, secondsAgo: number) => {
    const row = pendings.get(id);
    if (!row) throw new Error(`no such pending row: ${id}`);
    pendings.set(id, {
      ...row,
      created_at: new Date(Date.now() - secondsAgo * 1000).toISOString()
    });
  };

  const claimed = async (db: D1Database) => {
    const parked = await park(db);
    await confirmPending(db, parked.id);
    await claimForExecution(db, parked.id);
    return parked;
  };

  it("sweeps a stale executing row and clears the bearer-token snapshot", async () => {
    const { db, pendings } = createFakeD1();
    const parked = await claimed(db);
    backdate(pendings, parked.id, 7200);

    expect(await sweepStalePendingActions(db)).toBe(1);
    const row = await getPendingById(db, parked.id);
    expect(row?.status).toBe("failed");
    expect(row?.request_snapshot).toBe("");
    expect(JSON.parse(row?.result_snapshot as string)).toMatchObject({ swept: true });
  });

  it("leaves a fresh executing row alone", async () => {
    const { db } = createFakeD1();
    const parked = await claimed(db);
    expect(await sweepStalePendingActions(db)).toBe(0);
    expect((await getPendingById(db, parked.id))?.status).toBe("executing");
  });

  it("honours the grace period argument", async () => {
    const { db, pendings } = createFakeD1();
    const parked = await claimed(db);
    backdate(pendings, parked.id, 100);

    expect(await sweepStalePendingActions(db, 3600)).toBe(0);
    expect(await sweepStalePendingActions(db, 50)).toBe(1);
  });

  it("is idempotent — a swept row is not swept again", async () => {
    const { db, pendings } = createFakeD1();
    const parked = await claimed(db);
    backdate(pendings, parked.id, 7200);

    expect(await sweepStalePendingActions(db)).toBe(1);
    expect(await sweepStalePendingActions(db)).toBe(0);
  });

  it("never touches pending, confirmed, or already-finished rows however old", async () => {
    const { db, pendings } = createFakeD1();
    const stalePending = await park(db);
    const confirmed = await park(db);
    await confirmPending(db, confirmed.id);
    const finished = await claimed(db);
    await finishPending(db, finished.id, "done", { status: 200, body: {} });
    for (const id of [stalePending.id, confirmed.id, finished.id]) {
      backdate(pendings, id, 7200);
    }

    expect(await sweepStalePendingActions(db)).toBe(0);
    expect((await getPendingById(db, stalePending.id))?.status).toBe("pending");
    expect((await getPendingById(db, confirmed.id))?.status).toBe("confirmed");
    expect((await getPendingById(db, finished.id))?.status).toBe("done");
  });

  it("counts every stale row it sweeps, and only those", async () => {
    const { db, pendings } = createFakeD1();
    const first = await claimed(db);
    const second = await claimed(db);
    await claimed(db); // fresh — must not be swept
    backdate(pendings, first.id, 7200);
    backdate(pendings, second.id, 7200);

    expect(await sweepStalePendingActions(db)).toBe(2);
  });

  it("has a one-hour default grace period", () => {
    expect(STALE_EXECUTING_GRACE_SECONDS).toBe(3600);
  });
});

describe("TTL", () => {
  it("is ten minutes", () => {
    expect(PENDING_TTL_SECONDS).toBe(600);
  });
});
