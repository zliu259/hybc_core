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

interface Harness {
  readonly app: Hono<{ Bindings: Env; Variables: AuthVariables }>;
  readonly env: Env;
  readonly fake: FakeD1;
  readonly calls: HandlerCall[];
}

const buildHarness = async (opts: { highRiskEnabled: boolean }): Promise<Harness> => {
  const fake = createFakeD1();
  const { kv } = createFakeKV();
  await kv.put("agent:highrisk:config", JSON.stringify({ enabled: opts.highRiskEnabled }));

  const env = {
    DB: fake.db,
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

  return { app, env, fake, calls };
};

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
