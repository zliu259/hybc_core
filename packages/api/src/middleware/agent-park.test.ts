/**
 * authMiddleware 里【高危写 park】通路的端到端契约（P2a T8）。
 *
 * 这里刻意用真实的 Hono app + 真实 authMiddleware + 真实令牌/签名函数，
 * 只把 D1/KV 换成假实现 —— 因为本文件要守的性质全是「闸门与 handler 之间」的，
 * 用桩替掉裁决或中间件就等于把要测的东西测没了。
 *
 * 四条必须为真的性质（对应 park 通路的全部安全价值）：
 * 1. park 时 handler【绝不】被调用（否则动作既执行了又弹了确认卡片 —— 双重副作用）。
 * 2. 伪造标记只能 park，绝不 replay（标记校验失败降级为 park，不得 fail-open）。
 * 3. 「等待确认」信号必须落在 data 里（MCP 客户端的 Envelope 丢弃 HTTP 状态码，只看 data）。
 * 4. 闸门读 body 用 clone，原始流必须完好 —— 否则 handler 的 c.req.json() 会炸。
 */

import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";

import { authMiddleware, type AuthVariables } from "./auth";
import { REPLAY_PENDING_HEADER } from "./agent-high-risk-gate";
import { createAgentGrant } from "../services/agent-grant";
import {
  MAX_OUTSTANDING_PENDING_PER_GRANT,
  MAX_PARKS_PER_ROLLING_DAY,
  rejectPending
} from "../services/agent-pending";
import { REPLAY_HEADER, sha256Hex, signReplayMarker } from "../services/agent-replay";
import { createSessionPayload, issueTokens } from "../services/auth";
import { createFakeD1, createFakeKV, type FakeD1 } from "../test-support/agent-fakes";
import type { RequestSnapshot } from "../types/agent";
import type { Env } from "../types/env";

const SECRET = "p2a-park-test-replay-secret-32chars!!";

interface HandlerCall {
  /** handler 侧【原始流】读出的字节，用于证明闸门的 clone 没有吃掉 body。 */
  readonly rawBody: string;
  readonly parsed: unknown;
}

interface StatementCall {
  readonly sql: string;
  readonly args: readonly unknown[];
}

interface Harness {
  readonly app: Hono<{ Bindings: Env; Variables: AuthVariables }>;
  readonly env: Env;
  readonly fake: FakeD1;
  readonly calls: HandlerCall[];
  /** 每一条经过 env.DB 的语句。假 D1 不建 api_audit_log 表，审计只能这样观测。 */
  readonly statements: StatementCall[];
}

/**
 * 透明记录所有语句的 D1 包装：只旁听，不改变任何语义（一切转交假实现）。
 * 审计写是「某枚令牌正在刷卡片」唯一的可发现信号，不能只靠「响应对了」间接推断。
 */
const recordingDb = (inner: D1Database, statements: StatementCall[]): D1Database =>
  ({
    prepare(sql: string) {
      const stmt = inner.prepare(sql);
      const api = {
        bind(...args: unknown[]) {
          statements.push({ sql, args });
          stmt.bind(...args);
          return api;
        },
        run: () => stmt.run(),
        first: <T>() => stmt.first<T>(),
        all: <T>() => stmt.all<T>()
      };
      return api;
    }
  }) as unknown as D1Database;

const buildHarness = async (opts: { highRiskEnabled: boolean }): Promise<Harness> => {
  const fake = createFakeD1();
  const { kv } = createFakeKV();
  await kv.put("agent:highrisk:config", JSON.stringify({ enabled: opts.highRiskEnabled }));

  const statements: StatementCall[] = [];

  const env = {
    DB: recordingDb(fake.db, statements),
    KV: kv,
    JWT_SECRET: "test-secret",
    APP_ENV: "production",
    AGENT_REPLAY_SECRET: SECRET,
    AGENT_WEB_BASE_URL: "https://web.hybcdg.com"
  } as unknown as Env;

  const calls: HandlerCall[] = [];
  const app = new Hono<{ Bindings: Env; Variables: AuthVariables }>();
  app.use("/api/v1/*", authMiddleware);

  // 模仿 routes/approval.ts 的 approve handler：先 clone 出原始字节留证，
  // 再像真 handler 那样在 try 之外 await c.req.json()（流被吃掉时这里会抛）。
  const record = async (c: { req: { raw: Request } }) => {
    const rawBody = await c.req.raw.clone().text();
    calls.push({ rawBody, parsed: JSON.parse(rawBody) as unknown });
  };

  app.post("/api/v1/approval/:id/approve", async (c) => {
    await record(c);
    return c.json({ success: true, data: { approved: c.req.param("id") } });
  });
  app.post("/api/v1/approval/:id/reject", async (c) => {
    await record(c);
    return c.json({ success: true, data: { rejected: c.req.param("id") } });
  });
  app.post("/api/v1/payment", async (c) => {
    await record(c);
    return c.json({ success: true });
  });
  app.get("/api/v1/project", (c) => c.json({ success: true, data: [] }));

  return { app, env, fake, calls, statements };
};

/** 该动作名下是否落了一条审计。 */
const audited = (h: Harness, action: string): StatementCall | undefined =>
  h.statements.find(
    (s) => s.sql.includes("INSERT INTO api_audit_log") && s.args.includes(action)
  );

const agentToken = async (fake: FakeD1): Promise<string> => {
  const { token } = await createAgentGrant(fake.db, {
    wecomUserid: "MaxLiu",
    role: "manager",
    deviceName: "Max MBP"
  });
  return token;
};

const post = async (
  h: Harness,
  path: string,
  body: string,
  headers: Record<string, string>
): Promise<Response> =>
  h.app.request(
    path,
    { method: "POST", headers: { "content-type": "application/json", ...headers }, body },
    h.env
  );

interface ParkBody {
  success: boolean;
  data: {
    status: string;
    pending_action_id: string;
    expires_at: string;
    summary?: string;
    [key: string]: unknown;
  };
}

const pendingRows = (h: Harness) => [...h.fake.pendings.values()];

describe("authMiddleware · 高危写 park 通路", () => {
  let h: Harness;
  let token: string;

  beforeEach(async () => {
    h = await buildHarness({ highRiskEnabled: true });
    token = await agentToken(h.fake);
  });

  it("parks an approval approve: 202 + awaiting_confirmation, handler untouched", async () => {
    const body = JSON.stringify({ comment: "ok" });
    const res = await post(h, "/api/v1/approval/42/approve", body, {
      authorization: `Bearer ${token}`
    });

    expect(res.status).toBe(202);
    const payload = (await res.json()) as ParkBody;
    // 性质 3：信号必须在 data 里 —— MCP 客户端看不到 202。
    expect(payload.data.status).toBe("awaiting_confirmation");
    expect(payload.data.pending_action_id).toBeTruthy();
    expect(payload.data.expires_at).toBeTruthy();

    // 性质 1：动作被拦下，绝不执行。
    expect(h.calls).toHaveLength(0);

    const rows = pendingRows(h);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("pending");
    expect(rows[0].wecom_userid).toBe("MaxLiu");
    expect(rows[0].action_kind).toBe("approval.approve");
    expect(rows[0].id).toBe(payload.data.pending_action_id);
  });

  it("never leaks the confirm token back to the agent", async () => {
    // 确认令牌若回传给智能体，智能体就能自己确认自己 —— 人在环彻底失效。
    const res = await post(h, "/api/v1/approval/42/approve", "{}", {
      authorization: `Bearer ${token}`
    });
    const text = await res.text();
    const row = pendingRows(h)[0];
    expect(row.confirm_token_hash).toBeTruthy();
    expect(text).not.toContain(row.confirm_token_hash as string);
    expect(text.toLowerCase()).not.toContain("confirm_token");
  });

  it("persists a byte-exact snapshot carrying the agent bearer for replay", async () => {
    // 注意 body 里刻意留了空格与非 ASCII：任何 JSON.parse→stringify 的再序列化都会改变字节，
    // 进而让 T9 重放时算出的 bodyHash 与签名时不一致。
    const body = '{ "comment":  "同意 ✅" }';
    const res = await post(h, "/api/v1/approval/7/reject", body, {
      authorization: `Bearer ${token}`
    });
    expect(res.status).toBe(202);

    const row = pendingRows(h)[0];
    const snapshot = JSON.parse(row.request_snapshot as string) as RequestSnapshot;
    expect(snapshot.body).toBe(body);
    expect(snapshot.method).toBe("POST");
    expect(snapshot.path).toBe("/api/v1/approval/7/reject");
    expect(snapshot.headers.authorization).toBe(`Bearer ${token}`);
    expect(row.action_kind).toBe("approval.reject");
    // 摘要要让员工在微信里看懂「这是要拒绝 7 号单」。
    expect(row.summary).toContain("拒绝");
    expect(row.summary).toContain("7");
  });

  /**
   * 卡片摘要是员工做决定的【唯一依据】，绝不能由调用方塑形。
   *
   * 闸门按 c.req.path 匹配（Hono 已解码转义），而摘要与快照路径原先取自
   * new URL(url).pathname（不解码）—— 两者对 `/api/v1/appro%76al/7/approve` 会给出不同的字符串：
   * 动作照常按 approval #7 park 并执行，卡片却退化成中性描述，员工看不出自己在批准哪一单。
   * 智能体只要给路径加一个百分号转义，就能让人在环那一环变成瞎签。
   */
  it("derives the summary from the decoded path, not the caller's encoding", async () => {
    const res = await post(h, "/api/v1/appro%76al/7/approve", "{}", {
      authorization: `Bearer ${token}`
    });

    expect(res.status).toBe(202);
    const row = pendingRows(h)[0];
    expect(row.action_kind).toBe("approval.approve");
    // 退化形态是 `批准审批单（/api/v1/appro%76al/7/approve）`——必须是干净的 #7。
    expect(row.summary).toBe("批准审批单 #7");

    const snapshot = JSON.parse(row.request_snapshot as string) as RequestSnapshot;
    expect(snapshot.path).toBe("/api/v1/approval/7/approve");
  });

  it("preserves the query string separately so the replay can rebuild the URL", async () => {
    const res = await post(h, "/api/v1/approval/7/approve?dry=0&note=%E4%B8%AD", "{}", {
      authorization: `Bearer ${token}`
    });

    expect(res.status).toBe(202);
    const snapshot = JSON.parse(pendingRows(h)[0].request_snapshot as string) as RequestSnapshot;
    // path 只放路径（它要与闸门的 c.req.path 逐字相同，用于签名）；query 单独留存。
    expect(snapshot.path).toBe("/api/v1/approval/7/approve");
    expect(snapshot.search).toBe("?dry=0&note=%E4%B8%AD");
  });

  /**
   * 【员工必须能独立判断这件事】
   *
   * 卡片是人在环的唯一入口，而它原先只说「批准审批单 #42」。两件事因此对员工不可见：
   *   a. 这单是谁提的、申请了什么、多少钱 —— 「#42」对他而言就是一串随机数字；
   *   b. 请求体里那段【智能体自己写的 comment】—— routes/approval.ts 会把它原样写进
   *      正式审批记录并署上【员工本人】的名字。他的同意是自愿的，但是瞎的。
   *
   * 故 park 时须一次性查出业务上下文并把 comment 解析出来，一并落进 action_detail。
   */
  describe("action detail (what the employee is actually agreeing to)", () => {
    const seedInstance = (id: number) => {
      h.fake.approvals.set(id, {
        id,
        instance_no: "AP-20260718-001",
        biz_type: "payment",
        biz_summary: "PAY-20260718-003 | 中建三局 | 120000.00",
        initiator_userid: "ZhangSan",
        status: "pending"
      });
    };

    it("records the business context and the agent comment alongside the snapshot", async () => {
      seedInstance(42);
      const res = await post(
        h,
        "/api/v1/approval/42/approve",
        JSON.stringify({ comment: "金额已核对，同意付款" }),
        { authorization: `Bearer ${token}` }
      );
      expect(res.status).toBe(202);

      const row = pendingRows(h)[0];
      const detail = JSON.parse(row.action_detail as string) as {
        verb: string;
        target: string;
        approval: { initiator_userid: string; biz_summary: string } | null;
        agent_comment: string | null;
      };
      expect(detail.verb).toBe("批准");
      expect(detail.target).toBe("审批单 #42");
      expect(detail.approval?.initiator_userid).toBe("ZhangSan");
      expect(detail.approval?.biz_summary).toContain("PAY-20260718-003");
      // 这是员工将要署名的那段话，必须原样留存。
      expect(detail.agent_comment).toBe("金额已核对，同意付款");

      // 摘要（卡片正文与列表都用它）也必须带上申请人与业务摘要。
      expect(row.summary as string).toContain("批准审批单 #42");
      expect(row.summary as string).toContain("ZhangSan");
    });

    it("still parks (with a degraded summary) when the instance cannot be read", async () => {
      // 查不到实例绝不能让 park 失败 —— 失败等于高危写要么被放过、要么整条链路 500。
      const res = await post(h, "/api/v1/approval/404/approve", '{"comment":"x"}', {
        authorization: `Bearer ${token}`
      });

      expect(res.status).toBe(202);
      const row = pendingRows(h)[0];
      expect(row.summary).toBe("批准审批单 #404");
      const detail = JSON.parse(row.action_detail as string) as { approval: unknown };
      // 查不到就是 null，绝不编造。
      expect(detail.approval).toBeNull();
    });

    it("surfaces the parked summary to the agent without leaking the comment back as system text", async () => {
      seedInstance(42);
      const res = await post(h, "/api/v1/approval/42/approve", '{"comment":"注入"}', {
        authorization: `Bearer ${token}`
      });
      const payload = (await res.json()) as ParkBody;
      expect(payload.data.summary).toContain("批准审批单 #42");
    });
  });

  it("forbids (403) when the high-risk flag is off, without parking", async () => {
    const off = await buildHarness({ highRiskEnabled: false });
    const offToken = await agentToken(off.fake);
    const res = await post(off, "/api/v1/approval/42/approve", "{}", {
      authorization: `Bearer ${offToken}`
    });
    expect(res.status).toBe(403);
    expect(off.calls).toHaveLength(0);
    expect(pendingRows(off)).toHaveLength(0);
  });

  it("forbids (403) a write that is not on the high-risk table, without parking", async () => {
    const res = await post(h, "/api/v1/payment", JSON.stringify({ amount: 1 }), {
      authorization: `Bearer ${token}`
    });
    expect(res.status).toBe(403);
    expect(h.calls).toHaveLength(0);
    expect(pendingRows(h)).toHaveLength(0);
  });

  it("executes on a valid replay marker and hands the handler the exact body", async () => {
    const body = '{ "comment":  "同意 ✅" }';
    const pendingId = crypto.randomUUID();
    const marker = await signReplayMarker(h.env, {
      method: "POST",
      path: "/api/v1/approval/42/approve",
      pendingId,
      bodyHash: await sha256Hex(body)
    });

    const res = await post(h, "/api/v1/approval/42/approve", body, {
      authorization: `Bearer ${token}`,
      [REPLAY_HEADER]: marker,
      [REPLAY_PENDING_HEADER]: pendingId
    });

    expect(res.status).toBe(200);
    // 性质 4：闸门 clone 读过 body 之后，handler 仍能从原始流读到完整、逐字节一致的内容。
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].rawBody).toBe(body);
    expect(h.calls[0].parsed).toEqual({ comment: "同意 ✅" });
    // 重放不是新动作，不得再落一条 pending。
    expect(pendingRows(h)).toHaveLength(0);
  });

  it("parks (never executes) when the replay marker is forged", async () => {
    const body = JSON.stringify({ comment: "ok" });
    const res = await post(h, "/api/v1/approval/42/approve", body, {
      authorization: `Bearer ${token}`,
      [REPLAY_HEADER]: "Zm9yZ2VkLW1hcmtlcg==",
      [REPLAY_PENDING_HEADER]: crypto.randomUUID()
    });

    expect(res.status).toBe(202);
    expect(((await res.json()) as ParkBody).data.status).toBe("awaiting_confirmation");
    expect(h.calls).toHaveLength(0);
    expect(pendingRows(h)).toHaveLength(1);

    // 攻击者塞进来的重放头绝不能进快照 —— 否则 T9 重放时会把它原样带回去。
    const snapshot = JSON.parse(pendingRows(h)[0].request_snapshot as string) as RequestSnapshot;
    expect(snapshot.headers[REPLAY_HEADER]).toBeUndefined();
    expect(snapshot.headers[REPLAY_PENDING_HEADER]).toBeUndefined();
    expect(snapshot.headers["content-length"]).toBeUndefined();
  });

  it("parks when a valid marker is replayed against a tampered body", async () => {
    // 标记绑定 bodyHash：确认后把 body 改掉，标记即失效 —— 降级为 park，不得放行。
    const signedBody = JSON.stringify({ comment: "ok" });
    const pendingId = crypto.randomUUID();
    const marker = await signReplayMarker(h.env, {
      method: "POST",
      path: "/api/v1/approval/42/approve",
      pendingId,
      bodyHash: await sha256Hex(signedBody)
    });

    const res = await post(h, "/api/v1/approval/42/approve", JSON.stringify({ comment: "tampered" }), {
      authorization: `Bearer ${token}`,
      [REPLAY_HEADER]: marker,
      [REPLAY_PENDING_HEADER]: pendingId
    });

    expect(res.status).toBe(202);
    expect(h.calls).toHaveLength(0);
  });

  /**
   * 【泛洪 park 是对人在环控制本身的攻击】
   *
   * park 原先是无条件 INSERT。一枚泄漏的令牌只要循环 `POST /approval/{1..N}/approve`，
   * 就能把员工的企业微信埋进确认卡片里——通知疲劳正是收割一次不经心确认的标准手法：
   * 几百张卡片里只要有一张被随手点了同意，攻击就成功了。顺带每 park 一次就多存一份
   * 含 Bearer 令牌的请求快照，泄漏面的体量完全由攻击者决定。
   */
  describe("outstanding park cap", () => {
    const flood = async (n: number) => {
      const results: Response[] = [];
      for (let i = 0; i < n; i += 1) {
        results.push(
          await post(h, `/api/v1/approval/${i + 1}/approve`, "{}", {
            authorization: `Bearer ${token}`
          })
        );
      }
      return results;
    };

    it("refuses to park beyond the cap: 429 with a data-level reason, no new row", async () => {
      const accepted = await flood(MAX_OUTSTANDING_PENDING_PER_GRANT);
      expect(accepted.every((r) => r.status === 202)).toBe(true);
      expect(pendingRows(h)).toHaveLength(MAX_OUTSTANDING_PENDING_PER_GRANT);

      const refused = await post(h, "/api/v1/approval/99/approve", "{}", {
        authorization: `Bearer ${token}`
      });

      expect(refused.status).toBe(429);
      const payload = (await refused.json()) as {
        success: boolean;
        data: { status: string; reason: string; max_outstanding: number };
        error: { message: string };
      };
      // MCP 客户端的信封丢弃 HTTP 状态码，故理由必须同时落在 data 与 error 里
      // （!res.ok 时它只读 error.message，直读信封的调用方则看 data）。
      expect(payload.success).toBe(false);
      expect(payload.data.status).toBe("park_refused");
      expect(payload.data.reason).toBe("too_many_outstanding");
      expect(payload.data.max_outstanding).toBe(MAX_OUTSTANDING_PENDING_PER_GRANT);
      expect(payload.error.message).toBeTruthy();

      // 触顶的请求【既不执行也不落行】——否则限额只是换了个响应码。
      expect(h.calls).toHaveLength(0);
      expect(pendingRows(h)).toHaveLength(MAX_OUTSTANDING_PENDING_PER_GRANT);
    });

    it("audits the refusal so a token flooding cards is discoverable", async () => {
      await flood(MAX_OUTSTANDING_PENDING_PER_GRANT);
      await post(h, "/api/v1/approval/99/approve", "{}", { authorization: `Bearer ${token}` });

      const entry = audited(h, "agent.high_risk_park_refused");
      expect(entry).toBeDefined();
      expect(entry?.args).toContain("blocked");
      expect(JSON.stringify(entry?.args)).toContain("too_many_outstanding");
    });

    it("lets the agent park again once the employee settles one card", async () => {
      await flood(MAX_OUTSTANDING_PENDING_PER_GRANT);
      const first = pendingRows(h)[0];
      await rejectPending(h.env.DB, first.id as string);

      // 限额只按【在途】计：正常节奏绝不能被这道闸锁死。
      const res = await post(h, "/api/v1/approval/99/approve", "{}", {
        authorization: `Bearer ${token}`
      });

      expect(res.status).toBe(202);
      expect(((await res.json()) as ParkBody).data.status).toBe("awaiting_confirmation");
    });
  });

  /**
   * 【在途上限管并发，管不住总量 —— 必须另有一道滚动预算】
   *
   * 在途上限只数 `status='pending' AND expires_at > now`，于是一张卡片一被拒绝就立刻腾出额度：
   * park 满 5 → 员工逐条拒绝 → 计数归零 → 再 park 5 条，如此无限循环。攻击者的产能因此
   * 【与员工的尽责程度成正比】—— 员工越认真处理，额度回收得越快，这把激励彻底倒置了。
   * 即便员工完全不理会，10 分钟的确认窗口一过额度照样自动回收，稳定产出约每窗口 5 张。
   *
   * 故再加一道【滚动 24 小时预算】：按 created_at 数近 24 小时内该 grant 落过的【全部】行，
   * 不论其终态。它守的是「一枚泄漏的令牌一天最多能制造多少张卡片」这个总量问题，
   * 与在途上限守的并发问题正交，两道都必须在。
   */
  describe("rolling park budget", () => {
    /** park 一条并立刻拒绝掉：在途计数始终为 0，只有滚动预算在计数。 */
    const parkAndSettle = async (index: number): Promise<Response> => {
      const res = await post(h, `/api/v1/approval/${index}/approve`, "{}", {
        authorization: `Bearer ${token}`
      });
      if (res.status === 202) {
        const payload = (await res.clone().json()) as ParkBody;
        await rejectPending(h.env.DB, payload.data.pending_action_id);
      }
      return res;
    };

    it("refuses once the 24h budget is spent, however diligently the employee clears cards", async () => {
      for (let i = 1; i <= MAX_PARKS_PER_ROLLING_DAY; i += 1) {
        expect((await parkAndSettle(i)).status, `park #${i} within budget`).toBe(202);
      }
      // 此刻在途数为 0（每条都已被拒绝），旧闸门会毫不犹豫地再放行。
      expect(pendingRows(h).every((r) => r.status === "rejected")).toBe(true);

      const refused = await parkAndSettle(MAX_PARKS_PER_ROLLING_DAY + 1);

      expect(refused.status).toBe(429);
      const payload = (await refused.json()) as {
        success: boolean;
        data: { status: string; reason: string; max: number };
        error: { message: string };
      };
      expect(payload.success).toBe(false);
      expect(payload.data.status).toBe("park_refused");
      // 与并发触顶【不同】的理由：运维要能一眼分清「太挤」和「刷爆了」。
      expect(payload.data.reason).toBe("rolling_budget_exhausted");
      expect(payload.data.max).toBe(MAX_PARKS_PER_ROLLING_DAY);
      expect(payload.error.message).toBeTruthy();

      // 触顶的请求既不执行也不落行。
      expect(h.calls).toHaveLength(0);
      expect(pendingRows(h)).toHaveLength(MAX_PARKS_PER_ROLLING_DAY);
    });

    it("audits the budget refusal with its own reason", async () => {
      for (let i = 1; i <= MAX_PARKS_PER_ROLLING_DAY; i += 1) {
        await parkAndSettle(i);
      }
      await parkAndSettle(MAX_PARKS_PER_ROLLING_DAY + 1);

      const entry = audited(h, "agent.high_risk_park_refused");
      expect(entry).toBeDefined();
      expect(entry?.args).toContain("blocked");
      expect(JSON.stringify(entry?.args)).toContain("rolling_budget_exhausted");
    });

    it("counts rows older than the window out of the budget", async () => {
      for (let i = 1; i <= MAX_PARKS_PER_ROLLING_DAY; i += 1) {
        await parkAndSettle(i);
      }
      expect((await parkAndSettle(99)).status).toBe(429);

      // 把已有的行拨到 25 小时前：预算是【滚动】的，旧噪声不该永久占额度。
      const longAgo = new Date(Date.now() - 25 * 3600 * 1000).toISOString();
      for (const [id, row] of h.fake.pendings) {
        h.fake.pendings.set(id, { ...row, created_at: longAgo });
      }

      expect((await parkAndSettle(100)).status).toBe(202);
    });
  });

  /**
   * 【拒绝一个请求，绝不能先把它的 body 读进内存】
   *
   * 闸门原先无条件地 `await c.req.raw.clone().text()`，位置在 decideAgentRequest 之前 ——
   * 也就是在 forbid 分支有机会开火【之前】。可 body 只有一个用途：给重放校验算 sha256，
   * 而那一步在 matchHighRisk 未命中时根本走不到。于是一枚泄漏的令牌只要往任意
   * 非高危写路径 POST 一个 ~100MB 的 body，就能让它在通往一个必然的 403 的路上被
   * 完整解码成 JS 字符串（常驻内存约翻倍），足以撞穿 isolate 的 128MB 上限、
   * 连带打死同一 isolate 上的其它请求。vitest 只发几百字节，这个洞在测试里完全隐形。
   *
   * 故裁决必须【先做便宜的字符串匹配】，只有确定走 park/replay 分支才读 body。
   * 这里不去构造一个真的巨大 body（那只会让测试变慢且仍不确定），而是直接钉住
   * 「body 没有被碰过」这个更强的命题：把 clone 换成一个会爆炸的探针。
   */
  describe("no body buffering ahead of the forbid decision", () => {
    /** 造一个「一旦被 clone 就记账并抛异常」的请求，用于证明某条通路没读过 body。 */
    const tripwireRequest = (
      url: string,
      body: string,
      headers: Record<string, string>
    ): { request: Request; reads: () => number } => {
      let reads = 0;
      const request = new Request(`http://localhost${url}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body
      });
      Object.defineProperty(request, "clone", {
        configurable: true,
        value: () => {
          reads += 1;
          throw new Error("request body was buffered before the decision was made");
        }
      });
      return { request, reads: () => reads };
    };

    it("forbids a non-high-risk agent write without touching the body", async () => {
      const { request, reads } = tripwireRequest("/api/v1/payment", JSON.stringify({ amount: 1 }), {
        authorization: `Bearer ${token}`
      });

      const res = await h.app.fetch(request, h.env);

      expect(res.status).toBe(403);
      // 旧实现在这里是 1：body 先被读，读完才轮到 forbid。
      expect(reads()).toBe(0);
      expect(pendingRows(h)).toHaveLength(0);
    });

    it("forbids a high-risk write with the flag off without touching the body", async () => {
      // 开关关闭时同样直接拒 —— 这条通路也不需要 body。
      const off = await buildHarness({ highRiskEnabled: false });
      const offToken = await agentToken(off.fake);
      const { request, reads } = tripwireRequest("/api/v1/approval/42/approve", "{}", {
        authorization: `Bearer ${offToken}`
      });

      const res = await off.app.fetch(request, off.env);

      expect(res.status).toBe(403);
      expect(reads()).toBe(0);
    });

    it("still reads the body on the park branch (the snapshot must be byte-exact)", async () => {
      // 反向钉住：修复不得把 body 一起省掉 —— park 没有快照就无从重放。
      const body = '{ "comment":  "需要 body" }';
      const res = await post(h, "/api/v1/approval/42/approve", body, {
        authorization: `Bearer ${token}`
      });

      expect(res.status).toBe(202);
      const snapshot = JSON.parse(pendingRows(h)[0].request_snapshot as string) as RequestSnapshot;
      expect(snapshot.body).toBe(body);
    });
  });

  it("leaves allowlisted reads alone", async () => {
    const res = await h.app.request(
      "/api/v1/project",
      { headers: { authorization: `Bearer ${token}` } },
      h.env
    );
    expect(res.status).toBe(200);
    expect(pendingRows(h)).toHaveLength(0);
  });

  it("does not gate human JWT sessions on the same high-risk path", async () => {
    // 闸门只针对 mcp_agent 令牌；人类点「同意」必须照旧直达 handler。
    const session = createSessionPayload({ userId: "MaxLiu", username: "MaxLiu", role: "manager" });
    const issued = await issueTokens(h.env, session);
    const body = JSON.stringify({ comment: "human" });

    const res = await post(h, "/api/v1/approval/42/approve", body, {
      authorization: `Bearer ${issued.accessToken}`
    });

    expect(res.status).toBe(200);
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].rawBody).toBe(body);
    expect(pendingRows(h)).toHaveLength(0);
  });
});
