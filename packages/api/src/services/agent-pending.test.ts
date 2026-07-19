import { describe, expect, it } from "vitest";

import {
  MAX_OUTSTANDING_PENDING_PER_GRANT,
  MAX_PARKS_PER_ROLLING_DAY,
  PARK_BUDGET_WINDOW_SECONDS,
  PENDING_TTL_SECONDS,
  STALE_EXECUTING_GRACE_SECONDS,
  claimForExecution,
  confirmPending,
  countOutstandingPending,
  countParksInWindow,
  finishPending,
  getPendingByConfirmToken,
  getPendingById,
  parkPendingAction,
  rejectPending,
  sweepStalePendingActions,
  toPublicView,
  type ParkOutcome
} from "./agent-pending";
import { createFakeD1, type FakeD1 } from "../test-support/agent-fakes";

const attemptPark = async (db: D1Database, grantId = "g1"): Promise<ParkOutcome> =>
  parkPendingAction(db, {
    grantId,
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

/** 断言这次 park 确实落库了，并把结果收窄成 parked 分支（绝大多数用例的前置条件）。 */
const park = async (db: D1Database, grantId = "g1") => {
  const outcome = await attemptPark(db, grantId);
  if (outcome.kind !== "parked") {
    throw new Error(`expected park to succeed, got ${outcome.kind}`);
  }
  return outcome;
};

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

  /**
   * 确认令牌是【企微卡片链接里的持有型凭据】：拿到它就能确认那一件高危写。
   * 「truthy 且两次不相同」这种断言对熵一无所知——把 32 字节缩到 4 字节，它照样全绿，
   * 而令牌就此进入可离线爆破的量级。故必须钉死形状：32 字节 = 64 位十六进制。
   */
  it("mints a full 32-byte (64 hex char) confirm token", async () => {
    const { db } = createFakeD1();
    const parked = await park(db);
    expect(parked.confirmToken).toMatch(/^[0-9a-f]{64}$/);
  });
});

/**
 * rank5：park 时钉住解析出的审批任务身份，存进新的三列。
 *
 * 这是重放期「只认这一条、且必须仍 pending」的存储支撑：parkPendingAction 必须把
 * target_task_id / target_node_instance_id / target_round 原样落库，getPendingById 读回。
 * 未传时三列一律为 NULL（非审批 kind、历史行）——绝不臆造 0。
 */
describe("parkPendingAction · pinned approval task columns", () => {
  it("persists target_task_id / node_instance_id / round when provided", async () => {
    const { db } = createFakeD1();
    const outcome = await parkPendingAction(db, {
      grantId: "g1",
      wecomUserid: "MaxLiu",
      actionKind: "approval.approve",
      summary: "批准审批单 #42",
      snapshot: {
        method: "POST",
        path: "/api/v1/approval/42/approve",
        headers: { authorization: "Bearer x" },
        body: "{}"
      },
      target_task_id: 501,
      target_node_instance_id: 77,
      target_round: 2
    });
    if (outcome.kind !== "parked") throw new Error(`expected parked, got ${outcome.kind}`);

    const row = await getPendingById(db, outcome.id);
    expect(row?.target_task_id).toBe(501);
    expect(row?.target_node_instance_id).toBe(77);
    expect(row?.target_round).toBe(2);
  });

  it("leaves the pin columns NULL when not provided (non-approval / historical)", async () => {
    const { db } = createFakeD1();
    const parked = await park(db);
    const row = await getPendingById(db, parked.id);
    expect(row?.target_task_id ?? null).toBeNull();
    expect(row?.target_node_instance_id ?? null).toBeNull();
    expect(row?.target_round ?? null).toBeNull();
  });
});

/**
 * 每个 grant 的在途 park 上限。
 *
 * 没有它，一枚泄漏的令牌可以循环高危写把员工埋进确认卡片里——通知疲劳正是收割
 * 一次不经心确认的标准手法，而这恰好是「人在环」这道控制本身的攻击面。
 * 顺带每 park 一次就多存一份含 Bearer 的请求快照。
 */
describe("outstanding park cap", () => {
  const fill = async (db: D1Database, n: number, grantId = "g1") => {
    for (let i = 0; i < n; i += 1) {
      await park(db, grantId);
    }
  };

  it("caps a single grant at MAX_OUTSTANDING_PENDING_PER_GRANT outstanding rows", async () => {
    const { db, pendings } = createFakeD1();
    await fill(db, MAX_OUTSTANDING_PENDING_PER_GRANT);

    const refused = await attemptPark(db);

    expect(refused.kind).toBe("refused");
    if (refused.kind !== "refused") throw new Error("unreachable");
    expect(refused.reason).toBe("too_many_outstanding");
    expect(refused.count).toBe(MAX_OUTSTANDING_PENDING_PER_GRANT);
    expect(refused.max).toBe(MAX_OUTSTANDING_PENDING_PER_GRANT);
    // 关键：被拒绝的 park【绝不落行】——否则限额只是换了个返回值，泄漏面照样在涨。
    expect(pendings.size).toBe(MAX_OUTSTANDING_PENDING_PER_GRANT);
  });

  /**
   * 在途上限【只】管并发，它对总量毫无约束 —— 这一组把这件事钉死，并证明滚动预算补上了它。
   *
   * 攻击者只要让卡片进入任一终态（被拒绝、或干脆等它过期），额度就立刻回收。
   * 于是「员工越认真处理，攻击者恢复得越快」，激励彻底倒置。
   */
  describe("rolling 24h budget", () => {
    /** park 一条并立刻拒绝：在途计数恒为 0，只有滚动预算在动。 */
    const parkAndReject = async (db: D1Database, grantId = "g1") => {
      const outcome = await attemptPark(db, grantId);
      if (outcome.kind === "parked") {
        await rejectPending(db, outcome.id);
      }
      return outcome;
    };

    it("counts every row in the window regardless of terminal state", async () => {
      const { db } = createFakeD1();
      await parkAndReject(db);
      await parkAndReject(db);

      // 在途为 0（都已拒绝），但预算已经用掉 2 —— 这正是两道闸的分野。
      expect(await countOutstandingPending(db, "g1")).toBe(0);
      expect(await countParksInWindow(db, "g1")).toBe(2);
    });

    it("refuses with its own reason once the budget is exhausted", async () => {
      const { db } = createFakeD1();
      for (let i = 0; i < MAX_PARKS_PER_ROLLING_DAY; i += 1) {
        expect((await parkAndReject(db)).kind, `park #${i + 1}`).toBe("parked");
      }

      const refused = await attemptPark(db);

      expect(refused.kind).toBe("refused");
      if (refused.kind !== "refused") throw new Error("unreachable");
      // 与并发触顶必须可区分：两者对调用方意味着完全不同的下一步。
      expect(refused.reason).toBe("rolling_budget_exhausted");
      expect(refused.count).toBe(MAX_PARKS_PER_ROLLING_DAY);
      expect(refused.max).toBe(MAX_PARKS_PER_ROLLING_DAY);
    });

    it("is per grant, so one compromised token cannot starve another device", async () => {
      const { db } = createFakeD1();
      for (let i = 0; i < MAX_PARKS_PER_ROLLING_DAY; i += 1) {
        await parkAndReject(db, "g1");
      }
      expect((await attemptPark(db, "g1")).kind).toBe("refused");
      expect((await attemptPark(db, "g2")).kind).toBe("parked");
    });

    it("rolls: rows older than the window stop consuming budget", async () => {
      const { db, pendings } = createFakeD1();
      for (let i = 0; i < MAX_PARKS_PER_ROLLING_DAY; i += 1) {
        await parkAndReject(db);
      }
      expect((await attemptPark(db)).kind).toBe("refused");

      const longAgo = new Date(Date.now() - (PARK_BUDGET_WINDOW_SECONDS + 60) * 1000).toISOString();
      for (const [id, row] of pendings) {
        pendings.set(id, { ...row, created_at: longAgo });
      }

      expect(await countParksInWindow(db, "g1")).toBe(0);
      expect((await attemptPark(db)).kind).toBe("parked");
    });
  });

  it("counts per grant, so one noisy grant cannot starve another", async () => {
    const { db } = createFakeD1();
    await fill(db, MAX_OUTSTANDING_PENDING_PER_GRANT, "g1");

    expect((await attemptPark(db, "g1")).kind).toBe("refused");
    expect((await attemptPark(db, "g2")).kind).toBe("parked");
  });

  it("frees a slot once an action is settled (only outstanding rows count)", async () => {
    const { db } = createFakeD1();
    const first = await park(db);
    await fill(db, MAX_OUTSTANDING_PENDING_PER_GRANT - 1);
    expect((await attemptPark(db)).kind).toBe("refused");

    // 员工处理掉一件 —— 正常节奏必须能继续，限额不该把合法使用锁死。
    await rejectPending(db, first.id);
    expect((await attemptPark(db)).kind).toBe("parked");
  });

  it("does not let expired rows hold slots hostage", async () => {
    const { db, pendings } = createFakeD1();
    await fill(db, MAX_OUTSTANDING_PENDING_PER_GRANT);
    for (const [id, row] of pendings) {
      pendings.set(id, { ...row, expires_at: new Date(Date.now() - 1000).toISOString() });
    }

    // 确认窗口已关的行再也无法被确认，不构成任何噪声，故不占额度。
    expect(await countOutstandingPending(db, "g1")).toBe(0);
    expect((await attemptPark(db)).kind).toBe("parked");
  });

  it("has a cap of five", () => {
    expect(MAX_OUTSTANDING_PENDING_PER_GRANT).toBe(5);
  });
});

describe("state machine (optimistic locking)", () => {
  /**
   * 【确认窗口就是人在环那道保证本身】——守它的是 confirmPending 的 `AND expires_at > ?`。
   *
   * 缺了这个合取项，一张躺在聊天记录、通知栏截图或转发消息里几个月的旧卡片仍然能批准付款，
   * 10 分钟的 TTL 形同虚设：动作的有效期变成了「链接活多久」。而这条性质此前【无人看守】——
   * 把该合取项从生产 SQL 里删掉，整套测试仍然全绿（假实现硬编码了这道守卫，
   * 于是它断言的是自己的模型而非生产语句；已随本用例一并修正）。
   *
   * 过期行必须【原地不动】：状态仍是 pending，由 toPublicView 惰性呈现为 expired。
   */
  it("refuses to confirm a row whose confirmation window has closed", async () => {
    const { db, pendings } = createFakeD1();
    const parked = await park(db);
    const row = pendings.get(parked.id);
    pendings.set(parked.id, {
      ...row,
      expires_at: new Date(Date.now() - 1000).toISOString()
    });

    expect(await confirmPending(db, parked.id)).toBe(false);

    const after = await getPendingById(db, parked.id);
    expect(after?.status).toBe("pending");
    expect(after?.confirmed_at).toBeNull();
    // 过期后连 claim 都够不到 —— 确认窗口关上意味着这件事永远不会执行。
    expect(await claimForExecution(db, parked.id)).toBe(false);
    expect(toPublicView(after!).status).toBe("expired");
  });

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

  /**
   * 把行的 expires_at 拨到过去。与 backdate 分开：确认窗口（expires_at）与清扫宽限期
   * （created_at + grace）是两把不同的钟，pending 的清扫看前者，confirmed/executing 看后者。
   */
  const expire = (pendings: FakeD1["pendings"], id: string) => {
    const row = pendings.get(id);
    if (!row) throw new Error(`no such pending row: ${id}`);
    pendings.set(id, { ...row, expires_at: new Date(Date.now() - 1000).toISOString() });
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

  it("leaves an unexpired pending row and a finished row alone however old", async () => {
    const { db, pendings } = createFakeD1();
    // created_at 很旧但【尚未过期】的 pending：确认窗口仍开着，快照还有用途，不得清。
    const freshPending = await park(db);
    const finished = await claimed(db);
    await finishPending(db, finished.id, "done", { status: 200, body: {} });
    for (const id of [freshPending.id, finished.id]) {
      backdate(pendings, id, 7200);
    }

    expect(await sweepStalePendingActions(db)).toBe(0);
    expect((await getPendingById(db, freshPending.id))?.status).toBe("pending");
    expect((await getPendingById(db, finished.id))?.status).toBe("done");
  });

  /**
   * 员工【无视】卡片是最常见的结局，于是「pending 且已过期」是最常见的静止状态。
   * confirmPending 的 WHERE 守着 expires_at，这行再也无法被确认；此后没有任何守卫会命中它，
   * 快照里那枚 180 天有效的 agent bearer 会永久驻留 D1。而智能体可以随意 park，
   * 也就是说这条泄漏面的体量由攻击者决定。
   */
  it("clears the bearer snapshot of an expired pending row, keeping it pending", async () => {
    const { db, pendings } = createFakeD1();
    const parked = await park(db);
    expire(pendings, parked.id);

    expect(await sweepStalePendingActions(db)).toBe(1);
    const row = await getPendingById(db, parked.id);
    // 状态刻意不改写：expired 由 toPublicView 惰性呈现，落库改状态会与那套语义打架。
    expect(row?.status).toBe("pending");
    expect(row?.request_snapshot).toBe("");
    expect(toPublicView(row!).status).toBe("expired");
  });

  it("does not re-sweep an already-cleared expired pending row", async () => {
    const { db, pendings } = createFakeD1();
    const parked = await park(db);
    expire(pendings, parked.id);

    expect(await sweepStalePendingActions(db)).toBe(1);
    expect(await sweepStalePendingActions(db)).toBe(0);
  });

  /**
   * confirmed 但从未被 claim：确认路由在 confirmPending 与 claimForExecution 之间 await 了
   * 一次审计写，worker 若在此被回收，行就停在 confirmed —— 所有守卫都不再匹配（confirm 要 pending、
   * claim 已经过、finish 要 executing），令牌同样永久驻留，且员工的确认被静默丢弃。
   */
  it("fails a confirmed row that was never claimed, clearing its snapshot", async () => {
    const { db, pendings } = createFakeD1();
    const parked = await park(db);
    await confirmPending(db, parked.id);
    backdate(pendings, parked.id, 7200);

    expect(await sweepStalePendingActions(db)).toBe(1);
    const row = await getPendingById(db, parked.id);
    // failed 而非 expired：员工确实确认过，只是这次确认再也无法被兑现，必须如实呈现。
    expect(row?.status).toBe("failed");
    expect(row?.request_snapshot).toBe("");
    expect(JSON.parse(row?.result_snapshot as string)).toMatchObject({ swept: true });
  });

  it("leaves a freshly confirmed row alone", async () => {
    const { db } = createFakeD1();
    const parked = await park(db);
    await confirmPending(db, parked.id);

    expect(await sweepStalePendingActions(db)).toBe(0);
    expect((await getPendingById(db, parked.id))?.status).toBe("confirmed");
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
