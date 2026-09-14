import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthTokenPayload } from "../types/auth";
import type { Env } from "../types/env";
import { adminRoutes } from "./admin";

// 背景（2026-09-13，SP-20260913-0007）：AI 关卡自主拦截后实例已是 returned（08-14 分级拦截：
// 拦截走退回非终态），超管随后在「AI关卡任务」页对同一任务点了「放行」。路由把节点从
// returned 覆写成 completed、补了一条 AI_GATE approve 任务，然后 advanceWorkflow 因实例
// 不是 in_progress 静默返回——流程没有任何推进，节点状态却与实例状态自相矛盾，
// 操作者以为放行成功。放行/驳回只对 in_progress 的实例有意义，其余状态必须明确拒绝；
// 「补充意见」只是追加记录，任何状态都允许。

const mockAuthState = vi.hoisted(() => ({
  payload: {
    sub: "boss-a",
    username: "boss-a",
    nickname: "Boss A",
    avatar: "",
    roles: ["super_admin"],
    permissions: [],
    tokenId: "token-a",
    type: "access",
    auth_method: "wecom_oauth",
    wecom_verified_at: "2026-07-01T00:00:00.000Z",
    exp: 4102444800,
    iat: 1770000000
  } as AuthTokenPayload
}));

vi.mock("../services/auth", () => ({
  verifyToken: async (): Promise<AuthTokenPayload> => mockAuthState.payload
}));

const engineMock = vi.hoisted(() => ({
  advanceWorkflow: vi.fn<(env: unknown, instanceId: number, handler?: unknown) => Promise<void>>(
    async () => {}
  )
}));

vi.mock("../services/approval/engine", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/approval/engine")>()),
  advanceWorkflow: engineMock.advanceWorkflow
}));

type FakeDbOptions = {
  /** null = 实例行不存在 */
  instanceStatus?: string | null;
  nodeStatus?: string;
  /** 关卡节点所在轮次；与任务 payload 的轮次不一致时路由必须拒绝 */
  nodeRound?: number;
  /** 任务 payload 的轮次；null = 存量任务没有该字段（按第 1 轮处理） */
  payloadRound?: number | null;
};

class GateStatement {
  private params: unknown[] = [];

  constructor(
    private readonly db: GateDb,
    private readonly sql: string
  ) {}

  bind(...params: unknown[]) {
    this.params = params;
    return this;
  }

  async first<T>(): Promise<T | null> {
    return this.db.first<T>(this.sql, this.params);
  }

  async all<T>(): Promise<{ results: T[] }> {
    return { results: [] as T[] };
  }

  async run(): Promise<{ meta: { last_row_id: number; changes: number } }> {
    return this.db.run(this.sql, this.params);
  }
}

class GateDb {
  readonly runs: Array<{ sql: string; params: unknown[] }> = [];

  constructor(private readonly options: FakeDbOptions = {}) {}

  prepare(sql: string) {
    return new GateStatement(this, sql);
  }

  async first<T>(sql: string, _params: unknown[]): Promise<T | null> {
    void _params;
    if (sql.includes("FROM task_queue WHERE id = ?")) {
      const payloadRound = this.options.payloadRound === undefined ? 1 : this.options.payloadRound;
      return {
        id: 1583,
        status: "completed",
        biz_id: 362,
        payload_json: JSON.stringify({
          node_key: "ai_gate_1",
          instance_id: 362,
          ...(payloadRound === null ? {} : { round: payloadRound })
        }),
        result_json: JSON.stringify({
          output: '{"decision":"reject","summary":"附件费用对象与收款方不一致"}',
          metadata: { outcome: "reject", decision: "reject" }
        })
      } as T;
    }
    if (sql.includes("FROM approval_node_instance")) {
      const nodeStatus = this.options.nodeStatus ?? "returned";
      const nodeRound = this.options.nodeRound ?? 1;
      if (sql.includes("status = 'in_progress'")) {
        return nodeStatus === "in_progress"
          ? ({ id: 1931, round: nodeRound, status: nodeStatus } as T)
          : null;
      }
      return { id: 1931, round: nodeRound, status: nodeStatus } as T;
    }
    if (sql.includes("FROM approval_instance WHERE id = ?")) {
      const status =
        this.options.instanceStatus === undefined ? "returned" : this.options.instanceStatus;
      return status === null ? null : ({ id: 362, instance_no: "SP-20260913-0007", status } as T);
    }
    return null;
  }

  async run(sql: string, params: unknown[]) {
    this.runs.push({ sql, params });
    return { meta: { last_row_id: this.runs.length, changes: 1 } };
  }
}

const createApp = () => {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/admin", adminRoutes);
  return app;
};

const createEnv = (db: GateDb) =>
  ({
    DB: db,
    KV: {
      async get() {
        return "session";
      }
    },
    EVENT_QUEUE: {
      async send() {}
    }
  }) as unknown as Env & { DB: GateDb };

const handleTask = (env: Env, body: Record<string, unknown>) =>
  createApp().request(
    "/admin/approval-ai-gate/tasks/1583/handle",
    {
      method: "POST",
      headers: { authorization: "Bearer test-token", "content-type": "application/json" },
      body: JSON.stringify(body)
    },
    env
  );

describe("manual AI-gate handling on an instance that is no longer in progress", () => {
  beforeEach(() => {
    engineMock.advanceWorkflow.mockClear();
    mockAuthState.payload = { ...mockAuthState.payload, sub: "boss-a", roles: ["super_admin"] };
  });

  it.each(["approve", "reject"])(
    "refuses to %s once the AI gate has returned the instance to the initiator, writing nothing",
    async (action) => {
      const env = createEnv(new GateDb({ instanceStatus: "returned", nodeStatus: "returned" }));

      const response = await handleTask(env, { action, comment: "手动核查，批准通过" });

      expect(response.status).toBe(409);
      const payload = (await response.json()) as { success: boolean; error: { message: string } };
      expect(payload.success).toBe(false);
      expect(payload.error.message).toContain("returned");
      expect(env.DB.runs).toHaveLength(0);
      expect(engineMock.advanceWorkflow).not.toHaveBeenCalled();
    }
  );

  it.each(["approved", "rejected", "cancelled"])(
    "refuses to approve a %s (terminal) instance",
    async (instanceStatus) => {
      const env = createEnv(new GateDb({ instanceStatus, nodeStatus: "completed" }));

      const response = await handleTask(env, { action: "approve", comment: "放行" });

      expect(response.status).toBe(409);
      expect(env.DB.runs).toHaveLength(0);
      expect(engineMock.advanceWorkflow).not.toHaveBeenCalled();
    }
  );

  it("still accepts a comment on a returned instance", async () => {
    const env = createEnv(new GateDb({ instanceStatus: "returned", nodeStatus: "returned" }));

    const response = await handleTask(env, { action: "comment", comment: "已电话核实附件对象" });

    expect(response.status).toBe(200);
    expect(env.DB.runs.some((call) => call.sql.includes("INSERT INTO approval_task"))).toBe(true);
    expect(engineMock.advanceWorkflow).not.toHaveBeenCalled();
    // 补充意见只是追加记录，绝不能顺手把兜底审核人的待办收掉
    expect(env.DB.runs.some((call) => /status\s*=\s*'cancelled'/i.test(call.sql))).toBe(false);
  });

  it.each(["approve", "reject"])(
    "refuses to %s from an older round's task row, writing nothing",
    async (action) => {
      // 重提交后同一 node_key 每轮各有一条任务行；在第 1 轮那条上点放行，
      // 节点查找取到的是当前（第 2）轮节点——旧轮结论绝不能写进新一轮（2026-09-14）
      const env = createEnv(
        new GateDb({
          instanceStatus: "in_progress",
          nodeStatus: "in_progress",
          nodeRound: 2,
          payloadRound: 1
        })
      );

      const response = await handleTask(env, { action, comment: "手动处理" });

      expect(response.status).toBe(409);
      const payload = (await response.json()) as { success: boolean; error: { message: string } };
      expect(payload.success).toBe(false);
      expect(payload.error.message).toContain("第 1 轮");
      expect(payload.error.message).toContain("第 2 轮");
      expect(env.DB.runs).toHaveLength(0);
      expect(engineMock.advanceWorkflow).not.toHaveBeenCalled();
    }
  );

  it("still accepts a comment on an older round's task row", async () => {
    const env = createEnv(
      new GateDb({
        instanceStatus: "in_progress",
        nodeStatus: "in_progress",
        nodeRound: 2,
        payloadRound: 1
      })
    );

    const response = await handleTask(env, { action: "comment", comment: "补充说明" });

    expect(response.status).toBe(200);
    expect(env.DB.runs.some((call) => call.sql.includes("INSERT INTO approval_task"))).toBe(true);
  });

  it("treats a legacy payload without round as round 1", async () => {
    const env = createEnv(
      new GateDb({
        instanceStatus: "in_progress",
        nodeStatus: "in_progress",
        nodeRound: 1,
        payloadRound: null
      })
    );

    const response = await handleTask(env, { action: "approve", comment: "放行" });

    expect(response.status).toBe(200);
    expect(engineMock.advanceWorkflow).toHaveBeenCalledTimes(1);
  });

  it.each(["approve", "reject"])(
    "still lets a super admin %s an in_progress gate and advances the workflow",
    async (action) => {
      const env = createEnv(
        new GateDb({ instanceStatus: "in_progress", nodeStatus: "in_progress" })
      );

      const response = await handleTask(env, { action, comment: "手动处理" });

      expect(response.status).toBe(200);
      expect(env.DB.runs.some((call) => call.sql.includes("UPDATE task_queue"))).toBe(true);
      expect(env.DB.runs.some((call) => call.sql.includes("UPDATE approval_node_instance"))).toBe(
        true
      );
      expect(env.DB.runs.some((call) => call.sql.includes("INSERT INTO approval_task"))).toBe(true);
      expect(engineMock.advanceWorkflow).toHaveBeenCalledTimes(1);
      expect(engineMock.advanceWorkflow.mock.calls[0][1]).toBe(362);

      // 转人工兜底后，节点上可能还挂着兜底审核人的 pending 任务；超管在控制台直接放行/驳回时
      // 必须把它一并收掉，否则会作为悬空待办留在审核人列表里（2026-09-13）。
      const cancelHuman = env.DB.runs.find(
        (call) =>
          /UPDATE\s+approval_task\s+SET\s+status\s*=\s*'cancelled'/i.test(call.sql) &&
          /assignee_userid\s*<>\s*'AI_GATE'/i.test(call.sql)
      );
      expect(cancelHuman).toBeDefined();
      expect(cancelHuman?.params[1]).toBe(1931);
    }
  );
});
