/**
 * rank5：高危审批【重放期】只批钉住的那一条任务，且它必须仍 pending —— 否则拒绝整次重放、不改任何状态。
 *
 * 背景：agent 的 approve/reject 在闸门处被 park，几分钟后由服务端带 HMAC 标记重放。park 与重放之间
 * 待办可能流转（退回+重提生成一条【新】task 行、id 不同；或签推进），旧 findPendingTask 无 ORDER BY、
 * 不认 task_id，会把员工的确认落到「当前恰好 pending 的那一条」——可能已不是他在卡片上看到的那件事。
 *
 * 修复：park 时把解析出的 task 身份钉进 pending 行；重放时 authMiddleware 把它放进 c.get("agentReplay")，
 * handler 只按钉住的 target_task_id 取任务，并校验 instance/assignee/status='pending'/node_instance_id/round
 * 全部吻合，任一不符即 409、绝不回退 findPendingTask、绝不批别的任务。
 *
 * 这里【不】走 authMiddleware（它属另一条测试链路，见 middleware/agent-park.test.ts 的重放用例），
 * 而是直接把 agentReplay 注入上下文，专测 handler 的「按钉校验或拒绝」逻辑；approve/reject 打桩成
 * 间谍，断言它们是否被调用、以及被调用时拿到的是哪一条 task.id。
 */

import { Hono } from "hono";
import type { Context, Next } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthTokenPayload } from "../types/auth";
import type { Env } from "../types/env";
import { createFakeD1, type FakeApprovalTask, type FakeD1 } from "../test-support/agent-fakes";

interface ReplayCtx {
  readonly pendingId: string;
  readonly targetTaskId: number | null;
  readonly targetNodeInstanceId: number | null;
  readonly targetRound: number | null;
}

// authMiddleware 打桩：直接把测试控制的 auth 与 agentReplay 放进上下文，绕开令牌/标记校验，
// 专注 handler 的钉校验分支。auth_method 用 wecom_oauth：人类通路即「无 agentReplay」那一支。
const authState = vi.hoisted(() => ({
  payload: {
    sub: "bob",
    username: "bob",
    nickname: "Bob",
    avatar: "",
    roles: ["operator"],
    permissions: [],
    tokenId: "t1",
    type: "access",
    auth_method: "wecom_oauth",
    wecom_verified_at: "2026-07-19T00:00:00.000Z",
    exp: 4102444800,
    iat: 1770000000
  } as AuthTokenPayload,
  replay: undefined as ReplayCtx | undefined
}));

type MockCtx = Context<{
  Bindings: Env;
  Variables: { auth: AuthTokenPayload; agentReplay?: ReplayCtx };
}>;

vi.mock("../middleware/auth", () => ({
  authMiddleware: async (c: MockCtx, next: Next) => {
    c.set("auth", authState.payload);
    if (authState.replay !== undefined) {
      c.set("agentReplay", authState.replay);
    }
    await next();
  }
}));

// approve / reject 打桩成间谍：本文件只关心「是否执行、执行在哪一条 task 上」，
// 不驱动真实审批引擎。其余 operations 导出保留真实实现，让 approval.ts 正常加载。
const ops = vi.hoisted(() => ({ approve: vi.fn(), reject: vi.fn() }));
vi.mock("../services/approval/operations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/approval/operations")>();
  return { ...actual, approve: ops.approve, reject: ops.reject };
});

// 必须在 mock 之后再导入被测路由，确保它绑定到打桩后的依赖。
const { approvalRoutes } = await import("./approval");

let fake: FakeD1;

const seedTask = (t: Partial<FakeApprovalTask> & { id: number }): FakeApprovalTask => {
  const task: FakeApprovalTask = {
    id: t.id,
    node_instance_id: t.node_instance_id ?? 10,
    instance_id: t.instance_id ?? 42,
    assignee_userid: t.assignee_userid ?? "bob",
    round: t.round ?? 1,
    status: t.status ?? "pending"
  };
  fake.tasks.set(task.id, task);
  return task;
};

const env = (): Env => ({ DB: fake.db } as unknown as Env);

const app = () => {
  const a = new Hono<{ Bindings: Env }>();
  a.route("/approval", approvalRoutes);
  return a;
};

const approve = (instanceId: number, body: unknown = { comment: "ok" }) =>
  app().request(
    `/approval/${instanceId}/approve`,
    {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer x" },
      body: JSON.stringify(body)
    },
    env()
  );

const reject = (instanceId: number, body: unknown = { comment: "no" }) =>
  app().request(
    `/approval/${instanceId}/reject`,
    {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer x" },
      body: JSON.stringify(body)
    },
    env()
  );

const pinnedReplay = (over: Partial<ReplayCtx> = {}): ReplayCtx => ({
  pendingId: "pend-1",
  targetTaskId: 1,
  targetNodeInstanceId: 10,
  targetRound: 1,
  ...over
});

beforeEach(() => {
  fake = createFakeD1();
  authState.replay = undefined;
  authState.payload = { ...authState.payload, sub: "bob", roles: ["operator"] };
  ops.approve.mockReset();
  ops.reject.mockReset();
});

describe("approval approve/reject · rank5 pinned-task replay verification", () => {
  // ── Case 6: human (no agentReplay) path is unchanged ──
  it("human path (no agentReplay): resolves via findPendingTask and approves it", async () => {
    seedTask({ id: 7, instance_id: 42, assignee_userid: "bob", status: "pending" });

    const res = await approve(42);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(ops.approve).toHaveBeenCalledTimes(1);
    // findPendingTask 解析到 task 7，approveOp 就作用在它上面。
    expect(ops.approve.mock.calls[0][1]).toBe(7);
    expect(ops.approve.mock.calls[0][2]).toBe("bob");
  });

  // ── Case 3: replay happy path — pinned task still pending ──
  it("replay happy path: approves ONLY the pinned task, not a re-resolved one", async () => {
    // 钉住 task 1；另放一条同实例同人的在办任务 2 当诱饵：绝不能因「当前 pending」而批到它。
    seedTask({ id: 1, instance_id: 42, assignee_userid: "bob", node_instance_id: 10, round: 1 });
    seedTask({ id: 2, instance_id: 42, assignee_userid: "bob", node_instance_id: 99, round: 1 });
    authState.replay = pinnedReplay();

    const res = await approve(42);

    expect(res.status).toBe(200);
    expect(ops.approve).toHaveBeenCalledTimes(1);
    expect(ops.approve.mock.calls[0][1]).toBe(1);
  });

  // ── Case 4 / Case 8: pinned task moved off 'pending' → reject replay, change nothing ──
  // 这是 status==='pending' 校验的变异哨兵：删掉那一条 AND，本用例立刻变绿（错误地批准），必须为红。
  it("replay rejects (409) when the pinned task is no longer pending, everything else matching", async () => {
    seedTask({
      id: 1,
      instance_id: 42,
      assignee_userid: "bob",
      node_instance_id: 10,
      round: 1,
      status: "approved" // 已被处理，其余字段仍与钉住值完全一致
    });
    authState.replay = pinnedReplay();

    const res = await approve(42);

    expect(res.status).toBe(409);
    const payload = (await res.json()) as { success: boolean; error: { message: string } };
    expect(payload.success).toBe(false);
    expect(payload.error.message).toContain("审批状态已在你确认前发生了变化");
    expect(ops.approve).not.toHaveBeenCalled();
  });

  // ── Case 5: resubmit created a NEW pending task; the pinned id moved off pending ──
  it("replay rejects (409) on resubmit and does NOT fall back to the new pending task", async () => {
    // 钉住的旧任务 1 已被退回；重提生成了全新的在办任务 2（id 不同）。
    seedTask({ id: 1, instance_id: 42, assignee_userid: "bob", node_instance_id: 10, round: 1, status: "returned" });
    seedTask({ id: 2, instance_id: 42, assignee_userid: "bob", node_instance_id: 20, round: 2, status: "pending" });
    authState.replay = pinnedReplay();

    const res = await approve(42);

    expect(res.status).toBe(409);
    // 绝不回退 findPendingTask 去批任务 2 —— 那正是本 bug 的核心。
    expect(ops.approve).not.toHaveBeenCalled();
  });

  it("replay rejects (409) when targetTaskId is null", async () => {
    seedTask({ id: 1, instance_id: 42, assignee_userid: "bob", status: "pending" });
    authState.replay = pinnedReplay({ targetTaskId: null });

    const res = await approve(42);

    expect(res.status).toBe(409);
    expect(ops.approve).not.toHaveBeenCalled();
  });

  it("replay rejects (409) on node_instance_id / round drift (belt-and-suspenders)", async () => {
    seedTask({ id: 1, instance_id: 42, assignee_userid: "bob", node_instance_id: 10, round: 1 });
    // 钉住时记录的是 round 1 / node 10；现库里任务虽仍 pending，但 round 已推进。
    authState.replay = pinnedReplay({ targetRound: 2 });

    const res = await approve(42);

    expect(res.status).toBe(409);
    expect(ops.approve).not.toHaveBeenCalled();
  });

  it("replay rejects (409) when the pinned task belongs to a different assignee", async () => {
    // 任务确实 pending，但 assignee 不是当前确认人 —— 绝不允许越权批准。
    seedTask({ id: 1, instance_id: 42, assignee_userid: "carol", node_instance_id: 10, round: 1 });
    authState.replay = pinnedReplay();

    const res = await approve(42);

    expect(res.status).toBe(409);
    expect(ops.approve).not.toHaveBeenCalled();
  });

  // ── Case 7: reject mirrors approve ──
  describe("reject mirrors the approve pin path", () => {
    it("replay happy path: rejects ONLY the pinned task", async () => {
      seedTask({ id: 1, instance_id: 42, assignee_userid: "bob", node_instance_id: 10, round: 1 });
      authState.replay = pinnedReplay();

      const res = await reject(42);

      expect(res.status).toBe(200);
      expect(ops.reject).toHaveBeenCalledTimes(1);
      expect(ops.reject.mock.calls[0][1]).toBe(1);
    });

    it("replay rejects (409) when the pinned task moved off pending", async () => {
      seedTask({ id: 1, instance_id: 42, assignee_userid: "bob", node_instance_id: 10, round: 1, status: "rejected" });
      authState.replay = pinnedReplay();

      const res = await reject(42);

      expect(res.status).toBe(409);
      expect(ops.reject).not.toHaveBeenCalled();
    });

    it("human path (no agentReplay): resolves via findPendingTask and rejects it", async () => {
      seedTask({ id: 7, instance_id: 42, assignee_userid: "bob", status: "pending" });

      const res = await reject(42);

      expect(res.status).toBe(200);
      expect(ops.reject).toHaveBeenCalledTimes(1);
      expect(ops.reject.mock.calls[0][1]).toBe(7);
    });
  });
});
