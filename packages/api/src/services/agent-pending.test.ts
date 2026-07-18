import { describe, expect, it } from "vitest";

import {
  PENDING_TTL_SECONDS,
  claimForExecution,
  confirmPending,
  finishPending,
  getPendingByConfirmToken,
  getPendingById,
  parkPendingAction,
  rejectPending,
  toPublicView
} from "./agent-pending";
import { createFakeD1 } from "../test-support/agent-fakes";

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
    expect(view).toMatchObject({ id: parked.id, status: "pending", summary: "批准审批单 #42" });
  });

  it("reports expired for a past-due row that never settled", async () => {
    const { db } = createFakeD1();
    const parked = await park(db);
    const row = await getPendingById(db, parked.id);
    expect(toPublicView({ ...row!, expires_at: "2000-01-01T00:00:00.000Z" }).status).toBe("expired");
  });

  it("does NOT relabel a settled row as expired even when past due", async () => {
    const { db } = createFakeD1();
    const parked = await park(db);
    const row = await getPendingById(db, parked.id);
    const settled = { ...row!, expires_at: "2000-01-01T00:00:00.000Z", status: "done" as const };
    expect(toPublicView(settled).status).toBe("done");
  });
});

describe("TTL", () => {
  it("is ten minutes", () => {
    expect(PENDING_TTL_SECONDS).toBe(600);
  });
});
