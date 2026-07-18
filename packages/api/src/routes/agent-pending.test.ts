/**
 * pending 动作的「确认 / 拒绝 / 查询」三端点与【服务端全栈重放】的安全契约（P2a T9）。
 *
 * 这是人在环链路的最后一环：动作已被闸门 park，员工在企业微信里点确认，服务端把当初那个
 * 请求原样重放一遍。它同时是整条链路上最危险的一环 —— 走通这里意味着一次真实的审批写入。
 *
 * 六条必须为真的性质：
 * 1.【本人且仅本人】确认/拒绝须是人类网页会话，且会话身份 === 动作归属人。
 *    确认链接只回答「确认哪一件」，绝不回答「你是谁」—— 持有链接永远不等于有权确认。
 * 2.【至多执行一次】confirm 与 claim 两道乐观锁串联，重复确认绝不重复重放。
 * 3.【绝不卡死在 executing】重放抛异常也必须落到 failed，否则那行的 request_snapshot
 *    （内含 agent bearer 令牌）会永久驻留 D1。
 * 4.【逐字节重放】body 必须与快照完全一致 —— 任何再序列化都会让签名与实际请求对不上。
 * 5.【重放头由服务端自签】绝不回用快照里可能被攻击者塞入的重放头。
 * 6.【陌生人得 404 而非 403】404 不泄漏「这个动作存在」。
 */

import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";

import { agentRoutes } from "./agent";
import { REPLAY_PENDING_HEADER } from "../middleware/agent-high-risk-gate";
import { authMiddleware, type AuthVariables } from "../middleware/auth";
import { createAgentGrant } from "../services/agent-grant";
import { parkPendingAction } from "../services/agent-pending";
import { REPLAY_HEADER } from "../services/agent-replay";
import { resetAppFetcher, setAppFetcher } from "../services/app-ref";
import { createSessionPayload, issueTokens } from "../services/auth";
import { createFakeD1, createFakeKV, type FakeD1 } from "../test-support/agent-fakes";
import type { RequestSnapshot } from "../types/agent";
import type { Env } from "../types/env";

const SECRET = "p2a-pending-test-replay-secret-32ch!!";

/** 刻意的不规则空白 + 非 ASCII：任何 JSON.parse→stringify 都会改变字节，从而暴露再序列化。 */
const SNAPSHOT_BODY = '{ "comment":  "同意 ✅",  "note":"  空白很重要  " }';
const SNAPSHOT_PATH = "/api/v1/approval/7/reject";

interface ReplayCall {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: string;
}

interface Harness {
  readonly app: Hono<{ Bindings: Env; Variables: AuthVariables }>;
  readonly env: Env;
  readonly fake: FakeD1;
  readonly calls: ReplayCall[];
  /** 让单个用例决定重放的结局（默认业务成功）。 */
  setReplayResponse: (fn: () => Promise<Response>) => void;
}

const buildHarness = (): Harness => {
  const fake = createFakeD1();
  const { kv } = createFakeKV();

  const env = {
    DB: fake.db,
    KV: kv,
    JWT_SECRET: "test-secret",
    APP_ENV: "production",
    AGENT_REPLAY_SECRET: SECRET,
    AGENT_API_BASE_URL: "https://api.hybcdg.com",
    AGENT_WEB_BASE_URL: "https://web.hybcdg.com"
  } as unknown as Env;

  // 生产形态：agentRoutes 挂在 /api/v1/agent 下，闸门看到的才是真实路径
  // （只读白名单认的是 /agent/pending/<uuid>，相对路径会被误 403）。
  const app = new Hono<{ Bindings: Env; Variables: AuthVariables }>();
  app.route("/api/v1/agent", agentRoutes);

  const calls: ReplayCall[] = [];
  let replayResponse = async (): Promise<Response> =>
    new Response(JSON.stringify({ success: true, data: { rejected: 7 } }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });

  setAppFetcher(async (request) => {
    calls.push({
      url: request.url,
      method: request.method,
      headers: Object.fromEntries(request.headers),
      body: await request.text()
    });
    return replayResponse();
  });

  return {
    app,
    env,
    fake,
    calls,
    setReplayResponse: (fn) => {
      replayResponse = fn;
    }
  };
};

interface Parked {
  readonly id: string;
  readonly grantId: string;
  readonly agentToken: string;
}

/** 直接落一条 pending 行（不走闸门：本文件只测确认侧）。 */
const park = async (h: Harness, wecomUserid = "MaxLiu"): Promise<Parked> => {
  const { token, grant } = await createAgentGrant(h.fake.db, {
    wecomUserid,
    role: "manager",
    deviceName: "Max MBP"
  });
  const snapshot: RequestSnapshot = {
    method: "POST",
    path: SNAPSHOT_PATH,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: SNAPSHOT_BODY
  };
  const parked = await parkPendingAction(h.fake.db, {
    grantId: grant.id,
    wecomUserid,
    actionKind: "approval.reject",
    summary: "拒绝审批单 #7",
    snapshot
  });
  if (parked.kind !== "parked") {
    throw new Error(`expected park to succeed, got ${parked.kind}`);
  }
  return { id: parked.id, grantId: grant.id, agentToken: token };
};

const humanJwt = async (env: Env, userId: string): Promise<string> => {
  const issued = await issueTokens(
    env,
    createSessionPayload({ userId, username: userId, role: "manager" })
  );
  return issued.accessToken;
};

const rowOf = (h: Harness, id: string) => h.fake.pendings.get(id) as Record<string, unknown>;

/** 把确认窗口拨到过去，模拟员工几小时后才点开卡片。 */
const expirePending = (h: Harness, id: string): void => {
  h.fake.pendings.set(id, {
    ...rowOf(h, id),
    expires_at: new Date(Date.now() - 1000).toISOString()
  });
};

const call = async (
  h: Harness,
  path: string,
  token: string,
  method: "GET" | "POST" = "POST"
): Promise<Response> =>
  h.app.request(
    `/api/v1/agent${path}`,
    { method, headers: { authorization: `Bearer ${token}` } },
    h.env
  );

describe("agent pending 确认 / 拒绝 / 查询", () => {
  let h: Harness;

  beforeEach(() => {
    resetAppFetcher();
    h = buildHarness();
  });

  it("rejects a confirm from a different human (403), leaving the row pending", async () => {
    const parked = await park(h);
    const stranger = await humanJwt(h.env, "SomeoneElse");

    const res = await call(h, `/pending/${parked.id}/confirm`, stranger);

    expect(res.status).toBe(403);
    expect(h.calls).toHaveLength(0);
    expect(rowOf(h, parked.id).status).toBe("pending");
  });

  it("rejects a confirm from an agent token (403) — 人在环不得自助", async () => {
    const parked = await park(h);

    const res = await call(h, `/pending/${parked.id}/confirm`, parked.agentToken);

    expect(res.status).toBe(403);
    expect(h.calls).toHaveLength(0);
    expect(rowOf(h, parked.id).status).toBe("pending");
  });

  it("replays the original request byte-for-byte when the owner confirms", async () => {
    const parked = await park(h);
    const owner = await humanJwt(h.env, "MaxLiu");

    const res = await call(h, `/pending/${parked.id}/confirm`, owner);
    expect(res.status).toBe(200);

    expect(h.calls).toHaveLength(1);
    const replayed = h.calls[0];
    expect(replayed.method).toBe("POST");
    expect(new URL(replayed.url).pathname).toBe(SNAPSHOT_PATH);
    // 性质 4：逐字节 —— 空白与非 ASCII 原样保留。
    expect(replayed.body).toBe(SNAPSHOT_BODY);
    // 性质 5：两个重放头由服务端自签自设。
    expect(replayed.headers[REPLAY_HEADER]).toBeTruthy();
    expect(replayed.headers[REPLAY_PENDING_HEADER]).toBe(parked.id);
    // 快照里的 agent 凭据必须原样带回，重放才能走完整鉴权栈。
    expect(replayed.headers.authorization).toBe(`Bearer ${parked.agentToken}`);

    const row = rowOf(h, parked.id);
    expect(row.status).toBe("done");
    expect(JSON.parse(row.result_snapshot as string)).toMatchObject({ status: 200 });
    // 终态必须抹掉含 Bearer 的请求快照。
    expect(row.request_snapshot).toBe("");
  });

  it("is idempotent: confirming twice replays exactly once", async () => {
    const parked = await park(h);
    const owner = await humanJwt(h.env, "MaxLiu");

    const first = await call(h, `/pending/${parked.id}/confirm`, owner);
    const second = await call(h, `/pending/${parked.id}/confirm`, owner);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    // 性质 2：至多一次。
    expect(h.calls).toHaveLength(1);
    expect(rowOf(h, parked.id).status).toBe("done");
  });

  /**
   * 【确认了却没执行】不能是一个黑洞。
   *
   * 确认路由在 confirmPending 与 claimForExecution 之间隔着一次 await（审计写）。worker 若
   * 正好在这里被回收（CPU 超时、实例驱逐），行就停在 confirmed。原先的写法是「confirm 没赢
   * 就直接返回当前视图」，于是员工的重试永远走不到 claim：他点了同意、页面显示「已确认」，
   * 而那笔审批永远不会被执行，且没有任何地方报错——这正是最糟糕的失败模式，静默。
   *
   * 修复后 confirm 输了也继续尝试 claim。claim 的 WHERE 只匹配 confirmed，故这次重试
   * 既能救回卡住的行，又不可能让别的状态被重复执行（见下面两个用例）。
   */
  it("recovers a row stranded at confirmed: a retried confirm still executes it", async () => {
    const parked = await park(h);
    const owner = await humanJwt(h.env, "MaxLiu");
    // 模拟 worker 在两道锁之间被回收：行已 confirmed，但从未被 claim。
    h.fake.pendings.set(parked.id, {
      ...rowOf(h, parked.id),
      status: "confirmed",
      confirmed_at: new Date().toISOString()
    });

    const res = await call(h, `/pending/${parked.id}/confirm`, owner);

    expect(res.status).toBe(200);
    // 重试必须真的把它执行掉，而不是回一句「已确认」然后什么都不做。
    expect(h.calls).toHaveLength(1);
    const row = rowOf(h, parked.id);
    expect(row.status).toBe("done");
    expect(row.request_snapshot).toBe("");
  });

  /**
   * 「confirm 输了继续尝试 claim」绝不能变成「已执行的动作可以被再执行一次」。
   * 守这条的是 claimForExecution 的 `AND status = 'confirmed'`——done 行抢不到。
   */
  it("does not re-execute a row that already reached done", async () => {
    const parked = await park(h);
    const owner = await humanJwt(h.env, "MaxLiu");
    await call(h, `/pending/${parked.id}/confirm`, owner);
    expect(rowOf(h, parked.id).status).toBe("done");

    await call(h, `/pending/${parked.id}/confirm`, owner);
    await call(h, `/pending/${parked.id}/confirm`, owner);

    expect(h.calls).toHaveLength(1);
    expect(rowOf(h, parked.id).status).toBe("done");
  });

  it("marks the row failed when the replay returns a business error", async () => {
    const parked = await park(h);
    const owner = await humanJwt(h.env, "MaxLiu");
    h.setReplayResponse(async () =>
      new Response(JSON.stringify({ success: false, error: { message: "审批单状态已变更" } }), {
        status: 400,
        headers: { "content-type": "application/json" }
      })
    );

    const res = await call(h, `/pending/${parked.id}/confirm`, owner);

    // 端点本身成功地完成了「确认并尝试执行」，业务结局在 public view 的 result 里。
    expect(res.status).toBe(200);
    const row = rowOf(h, parked.id);
    expect(row.status).toBe("failed");
    expect(JSON.parse(row.result_snapshot as string)).toMatchObject({ status: 400 });
  });

  it("never strands a row in executing when the replay throws", async () => {
    const parked = await park(h);
    const owner = await humanJwt(h.env, "MaxLiu");
    h.setReplayResponse(async () => {
      throw new Error("worker exploded");
    });

    await call(h, `/pending/${parked.id}/confirm`, owner);

    // 性质 3：executing 是死状态 —— 没有任何后续路径能推动它，令牌会永久留在库里。
    const row = rowOf(h, parked.id);
    expect(row.status).toBe("failed");
    expect(row.request_snapshot).toBe("");
  });

  it("rejects the action without replaying when the owner rejects", async () => {
    const parked = await park(h);
    const owner = await humanJwt(h.env, "MaxLiu");

    const res = await call(h, `/pending/${parked.id}/reject`, owner);

    expect(res.status).toBe(200);
    expect(h.calls).toHaveLength(0);
    expect(rowOf(h, parked.id).status).toBe("rejected");
  });

  /**
   * 员工点「拒绝」时，动作可能刚刚被执行掉（他的确认与另一路的执行赛跑，或他误点了旧卡片）。
   * 此时 rejectPending 的 WHERE 不匹配、什么都没发生，但端点原先照样回 200 + ok 信封，
   * 员工会以为自己成功拦下了一笔付款——实际它已经批了。必须如实告知「没拦住」。
   */
  it("reports rejected:false when the action was already executed", async () => {
    const parked = await park(h);
    const owner = await humanJwt(h.env, "MaxLiu");
    await call(h, `/pending/${parked.id}/confirm`, owner);
    expect(rowOf(h, parked.id).status).toBe("done");

    const res = await call(h, `/pending/${parked.id}/reject`, owner);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { rejected: boolean; status: string } };
    expect(body.data.rejected).toBe(false);
    // 真实现状必须一并回传，好让确认页显示「这单已经批了」而不是一句干巴巴的失败。
    expect(body.data.status).toBe("done");
  });

  it("reports rejected:true when it actually won the transition", async () => {
    const parked = await park(h);
    const owner = await humanJwt(h.env, "MaxLiu");

    const res = await call(h, `/pending/${parked.id}/reject`, owner);

    const body = (await res.json()) as { data: { rejected: boolean; status: string } };
    expect(body.data.rejected).toBe(true);
    expect(body.data.status).toBe("rejected");
  });

  it("reports rejected:false on a second reject (only the first wins)", async () => {
    const parked = await park(h);
    const owner = await humanJwt(h.env, "MaxLiu");

    await call(h, `/pending/${parked.id}/reject`, owner);
    const second = await call(h, `/pending/${parked.id}/reject`, owner);

    const body = (await second.json()) as { data: { rejected: boolean; status: string } };
    expect(body.data.rejected).toBe(false);
    expect(body.data.status).toBe("rejected");
  });

  /**
   * 确认与拒绝赛跑：拒绝先落地后，确认【绝不能】还把动作执行掉。
   * 守这条的是 confirmPending 的 `AND status = 'pending'`——它同时排掉了 rejected。
   */
  it("does not replay when a reject won the race first", async () => {
    const parked = await park(h);
    const owner = await humanJwt(h.env, "MaxLiu");

    await call(h, `/pending/${parked.id}/reject`, owner);
    const res = await call(h, `/pending/${parked.id}/confirm`, owner);

    expect(res.status).toBe(200);
    expect(h.calls).toHaveLength(0);
    expect(rowOf(h, parked.id).status).toBe("rejected");
  });

  /**
   * 过期后确认必须无效——守这条的是 confirmPending 的 `AND expires_at > ?`。
   * 缺了它，一张躺在聊天记录里几个月的旧卡片仍能批准付款，10 分钟的确认窗口形同虚设。
   */
  it("does not replay when the confirmation window has expired", async () => {
    const parked = await park(h);
    const owner = await humanJwt(h.env, "MaxLiu");
    expirePending(h, parked.id);

    const res = await call(h, `/pending/${parked.id}/confirm`, owner);

    expect(res.status).toBe(200);
    expect(h.calls).toHaveLength(0);
    const row = rowOf(h, parked.id);
    expect(row.status).toBe("pending");
    const body = (await res.json()) as { data: { status: string } };
    expect(body.data.status).toBe("expired");
  });

  it("refuses a reject from a different human (403)", async () => {
    const parked = await park(h);
    const stranger = await humanJwt(h.env, "SomeoneElse");

    const res = await call(h, `/pending/${parked.id}/reject`, stranger);

    expect(res.status).toBe(403);
    expect(rowOf(h, parked.id).status).toBe("pending");
  });

  it("lets the owning agent grant poll status, leaking nothing sensitive", async () => {
    const parked = await park(h);

    const res = await call(h, `/pending/${parked.id}`, parked.agentToken, "GET");
    expect(res.status).toBe(200);

    const text = await res.text();
    expect(text).not.toContain("authorization");
    expect(text).not.toContain("Bearer");
    expect(text).not.toContain(parked.agentToken);
    expect(text.toLowerCase()).not.toContain("confirm_token");
    expect(text).not.toContain(rowOf(h, parked.id).confirm_token_hash as string);

    const body = JSON.parse(text) as { success: boolean; data: { id: string; status: string } };
    expect(body.success).toBe(true);
    expect(body.data.id).toBe(parked.id);
    expect(body.data.status).toBe("pending");
  });

  it("lets the owning human poll status", async () => {
    const parked = await park(h);
    const owner = await humanJwt(h.env, "MaxLiu");

    const res = await call(h, `/pending/${parked.id}`, owner, "GET");

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { id: string } };
    expect(body.data.id).toBe(parked.id);
  });

  it("returns 404 (not 403) to an agent grant that does not own the action", async () => {
    const parked = await park(h);
    // 另一位员工的另一个 grant —— 既非归属 grant，也非归属人。
    const other = await createAgentGrant(h.fake.db, {
      wecomUserid: "SomeoneElse",
      role: "manager",
      deviceName: "Other MBP"
    });

    const res = await call(h, `/pending/${parked.id}`, other.token, "GET");

    // 性质 6：404 不向陌生人确认「这个动作存在」。
    expect(res.status).toBe(404);
    expect(parked.grantId).not.toBe(other.grant.id);
  });

  it("returns 404 to a human who does not own the action", async () => {
    const parked = await park(h);
    const stranger = await humanJwt(h.env, "SomeoneElse");

    const res = await call(h, `/pending/${parked.id}`, stranger, "GET");

    expect(res.status).toBe(404);
  });

  it("returns 404 for an unknown pending id", async () => {
    const owner = await humanJwt(h.env, "MaxLiu");

    const res = await call(h, `/pending/${crypto.randomUUID()}`, owner, "GET");

    expect(res.status).toBe(404);
  });
});

/**
 * 全链路真跑：闸门 park → 本人确认 → 服务端重放 → 【同一个闸门】验签放行 → 业务 handler 执行。
 *
 * 上面那组用例把 app fetcher 换成了间谍，测的是确认端点自身的行为；这一组【不打桩】，
 * 重放真的回到整包 app 里走一遍 authMiddleware。它要证明的是签名方与验签方的路径归一化
 * 确实一致——这件事无法靠任何单侧单测证明：
 *   签名方取 request_snapshot.path（park 时存的 c.req.path）
 *   验签方取重放请求的 c.req.path
 * 两者只要有一个字符不同，标记就验不过，动作会被静默降级成【再 park 一次】——
 * 员工点了同意，系统却只是又弹了一张卡片。故意用百分号编码的路径发起，正是因为它是两侧
 * 唯一会分叉的地方（Hono 解码，new URL().pathname 不解码）。
 */
describe("agent pending 确认 → 全栈重放（不打桩）", () => {
  interface E2E {
    readonly app: Hono<{ Bindings: Env; Variables: AuthVariables }>;
    readonly env: Env;
    readonly fake: FakeD1;
    readonly executed: { id: string; body: string }[];
  }

  const buildE2E = async (): Promise<E2E> => {
    const fake = createFakeD1();
    const { kv } = createFakeKV();
    await kv.put("agent:highrisk:config", JSON.stringify({ enabled: true }));

    const env = {
      DB: fake.db,
      KV: kv,
      JWT_SECRET: "test-secret",
      APP_ENV: "production",
      AGENT_REPLAY_SECRET: SECRET,
      AGENT_API_BASE_URL: "https://api.hybcdg.com",
      AGENT_WEB_BASE_URL: "https://web.hybcdg.com"
    } as unknown as Env;

    const executed: { id: string; body: string }[] = [];
    const app = new Hono<{ Bindings: Env; Variables: AuthVariables }>();
    app.use("/api/v1/*", authMiddleware);
    app.post("/api/v1/approval/:id/approve", async (c) => {
      executed.push({ id: c.req.param("id"), body: await c.req.raw.clone().text() });
      return c.json({ success: true, data: { approved: c.req.param("id") } });
    });
    app.route("/api/v1/agent", agentRoutes);

    // 重放回到【同一个 app】：与人类点「同意」完全同一条代码路径。
    setAppFetcher(async (request, e, ctx) => app.fetch(request, e, ctx));
    return { app, env, fake, executed };
  };

  beforeEach(() => {
    resetAppFetcher();
  });

  it("parks a percent-encoded high-risk write and replays it end to end on confirm", async () => {
    const e2e = await buildE2E();
    const { token } = await createAgentGrant(e2e.fake.db, {
      wecomUserid: "MaxLiu",
      role: "manager",
      deviceName: "Max MBP"
    });
    const body = '{ "comment":  "同意 ✅" }';

    // 1. 智能体用【百分号编码】的路径发起高危写 → 被闸门 park。
    const parked = await e2e.app.request(
      "/api/v1/appro%76al/7/approve",
      {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body
      },
      e2e.env
    );
    expect(parked.status).toBe(202);
    const parkBody = (await parked.json()) as { data: { pending_action_id: string } };
    const pendingId = parkBody.data.pending_action_id;
    expect(e2e.executed).toHaveLength(0);

    // 卡片摘要必须是干净的 #7，而不是被编码扭曲的路径。
    expect(e2e.fake.pendings.get(pendingId)?.summary).toBe("批准审批单 #7");

    // 2. 本人确认 → 服务端签名重放 → 闸门验签放行 → handler 真的执行。
    const owner = await humanJwt(e2e.env, "MaxLiu");
    const confirmed = await e2e.app.request(
      `/api/v1/agent/pending/${pendingId}/confirm`,
      { method: "POST", headers: { authorization: `Bearer ${owner}` } },
      e2e.env
    );
    expect(confirmed.status).toBe(200);

    // 这一条就是「两侧路径归一化一致」的证据：验签若失败，动作会再 park 一次，
    // executed 保持为空且库里会多出一行 pending。
    expect(e2e.executed).toEqual([{ id: "7", body }]);
    expect([...e2e.fake.pendings.values()]).toHaveLength(1);
    expect(e2e.fake.pendings.get(pendingId)?.status).toBe("done");
    // 终态抹掉快照，agent bearer 不再驻留。
    expect(e2e.fake.pendings.get(pendingId)?.request_snapshot).toBe("");
  });

  it("executes exactly once even though the replay re-enters the same gate", async () => {
    const e2e = await buildE2E();
    const { token } = await createAgentGrant(e2e.fake.db, {
      wecomUserid: "MaxLiu",
      role: "manager",
      deviceName: "Max MBP"
    });
    const parked = await e2e.app.request(
      "/api/v1/approval/9/approve",
      {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: "{}"
      },
      e2e.env
    );
    const pendingId = ((await parked.json()) as { data: { pending_action_id: string } }).data
      .pending_action_id;

    const owner = await humanJwt(e2e.env, "MaxLiu");
    const confirm = () =>
      e2e.app.request(
        `/api/v1/agent/pending/${pendingId}/confirm`,
        { method: "POST", headers: { authorization: `Bearer ${owner}` } },
        e2e.env
      );
    await confirm();
    await confirm();

    expect(e2e.executed).toHaveLength(1);
  });
});
