import { describe, expect, it } from "vitest";

import { applyAiGateDecision, applyAiGateReturn } from "./ai-gate-apply";
import { executorFactory } from "./executors";
import { advanceWorkflow } from "./engine";
import type { ParsedAiGateResult } from "./ai-gate-result";
import type { Env } from "../../types/env";

/**
 * 内存 D1 假件：跟踪 AI 关卡落地涉及的
 * approval_node_instance / approval_instance / approval_task / 业务表 / 事件。
 * UPDATE 语句按 SQL 字面量 status 应用（与库内写法一致），INSERT 记录绑定参数。
 */
interface FakeNode {
  id: number;
  instance_id: number;
  node_key: string;
  node_type: string;
  round: number;
  status: string;
}

interface FakeInstance {
  id: number;
  instance_no: string;
  template_id: number;
  biz_type: string;
  biz_id: number;
  initiator_userid: string;
  current_node_key: string | null;
  current_round: number;
  status: string;
}

interface InsertedTask {
  node_instance_id: number;
  instance_id: number;
  assignee_userid: string;
  action: string;
  comment: string;
}

interface FakeState {
  node: FakeNode;
  instance: FakeInstance;
  decisionTask: { action: string } | null;
  insertedTasks: InsertedTask[];
  bizDraftTables: string[];
  events: Array<{ type: string; payload: Record<string, unknown> }>;
}

const STATUS_LITERAL = /SET\s+status\s*=\s*'([a-z_]+)'/i;
const CLEARS_CURRENT_NODE = /current_node_key\s*=\s*NULL/i;
const BIZ_DRAFT = /UPDATE\s+(contract|payment_request|reimbursement_batch|invoice_request|stock_order|warehouse_asset_work_order)\s+SET\s+status\s*=\s*'draft'/i;

const createFakeEnv = (state: FakeState): Env => {
  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async run() {
              const bizMatch = sql.match(BIZ_DRAFT);
              if (bizMatch) {
                state.bizDraftTables.push(bizMatch[1]);
                return { success: true, meta: {} };
              }
              if (/UPDATE\s+approval_node_instance/i.test(sql)) {
                const match = sql.match(STATUS_LITERAL);
                if (match) state.node.status = match[1];
                return { success: true, meta: {} };
              }
              if (/UPDATE\s+approval_instance/i.test(sql)) {
                const match = sql.match(STATUS_LITERAL);
                if (match) state.instance.status = match[1];
                if (CLEARS_CURRENT_NODE.test(sql)) state.instance.current_node_key = null;
                return { success: true, meta: {} };
              }
              if (/INSERT\s+INTO\s+approval_task/i.test(sql)) {
                state.insertedTasks.push({
                  node_instance_id: args[0] as number,
                  instance_id: args[1] as number,
                  assignee_userid: args[2] as string,
                  action: args[3] as string,
                  comment: args[4] as string
                });
                return { success: true, meta: {} };
              }
              // event_log 等其余写入直接吞掉
              return { success: true, meta: {} };
            },
            async first<T>() {
              if (/FROM\s+approval_instance/i.test(sql)) {
                return { ...state.instance } as unknown as T;
              }
              if (/FROM\s+approval_node_instance/i.test(sql)) {
                return { ...state.node } as unknown as T;
              }
              if (/SELECT\s+action[\s\S]*FROM\s+approval_task/i.test(sql)) {
                return (state.decisionTask ? { ...state.decisionTask } : null) as unknown as T;
              }
              return null as unknown as T;
            },
            async all<T>() {
              return { results: [] as T[] };
            }
          };
        }
      };
    }
  };

  return {
    DB: db as unknown as D1Database,
    EVENT_QUEUE: {
      async send(event: { type: string; payload: Record<string, unknown> }) {
        state.events.push({ type: event.type, payload: event.payload });
      }
    } as unknown as Queue
  } as unknown as Env;
};

const baseState = (): FakeState => ({
  node: {
    id: 5,
    instance_id: 1,
    node_key: "ai_gate_x",
    node_type: "ai_gate",
    round: 1,
    status: "in_progress"
  },
  instance: {
    id: 1,
    instance_no: "SP-20260814-0001",
    template_id: 2,
    biz_type: "outbound_contract",
    biz_id: 700,
    initiator_userid: "UserA",
    current_node_key: "ai_gate_x",
    current_round: 1,
    status: "in_progress"
  },
  decisionTask: null,
  insertedTasks: [],
  bizDraftTables: [],
  events: []
});

const parsedResult = (overrides: Partial<ParsedAiGateResult>): ParsedAiGateResult => ({
  outcome: "approve",
  explicitOutcome: true,
  decision: "pass",
  riskLevel: "low",
  summary: "s",
  comment: "AI审查通过：s",
  recommendations: [],
  needsHumanReview: false,
  manualOverride: false,
  downgraded: false,
  ...overrides
});

describe("applyAiGateDecision — 三种落地分支", () => {
  it("approve → 节点 completed + AI_GATE 任务 action=approve", async () => {
    const state = baseState();
    const env = createFakeEnv(state);
    await applyAiGateDecision(env, state.node, 1, parsedResult({}));
    expect(state.node.status).toBe("completed");
    expect(state.insertedTasks).toHaveLength(1);
    expect(state.insertedTasks[0].assignee_userid).toBe("AI_GATE");
    expect(state.insertedTasks[0].action).toBe("approve");
  });

  it("AI 自主 reject → 节点 returned + 任务 action=reject，comment 保留原文", async () => {
    const state = baseState();
    const env = createFakeEnv(state);
    await applyAiGateDecision(
      env,
      state.node,
      1,
      parsedResult({
        outcome: "reject",
        decision: "reject",
        comment: "AI审查不通过：附件甲方非我方主体"
      })
    );
    expect(state.node.status).toBe("returned");
    expect(state.insertedTasks[0].action).toBe("reject");
    expect(state.insertedTasks[0].comment).toBe("AI审查不通过：附件甲方非我方主体");
  });

  it("超管覆写 reject → 节点 completed（保留终态刹车路径）", async () => {
    const state = baseState();
    const env = createFakeEnv(state);
    await applyAiGateDecision(
      env,
      state.node,
      1,
      parsedResult({ outcome: "reject", decision: "reject", manualOverride: true, comment: "管理员驳回" })
    );
    expect(state.node.status).toBe("completed");
    expect(state.insertedTasks[0].action).toBe("reject");
  });
});

describe("applyAiGateReturn — 实例退回（镜像人工退回）", () => {
  it("实例置 returned、清 current_node_key、业务表回 draft、发 APPROVAL_RETURNED", async () => {
    const state = baseState();
    const env = createFakeEnv(state);
    await applyAiGateReturn(env, state.instance, state.node.id);
    expect(state.instance.status).toBe("returned");
    expect(state.instance.current_node_key).toBeNull();
    expect(state.bizDraftTables).toEqual(["contract"]);
    const returned = state.events.find((e) => e.type === "APPROVAL_RETURNED");
    expect(returned).toBeDefined();
    expect(returned?.payload.returned_by).toBe("AI_GATE");
    expect(returned?.payload.return_type).toBe("ai_gate");
  });

  it("付款域业务表映射 payment_request", async () => {
    const state = baseState();
    state.instance.biz_type = "payment_request";
    const env = createFakeEnv(state);
    await applyAiGateReturn(env, state.instance, state.node.id);
    expect(state.bizDraftTables).toEqual(["payment_request"]);
  });
});

describe("AiGateExecutor.isNodeComplete — 三态结论", () => {
  const executor = executorFactory("ai_gate");

  it("reject 决策 + 节点 returned → outcome 'returned'", async () => {
    const state = baseState();
    state.node.status = "returned";
    state.decisionTask = { action: "reject" };
    const result = await executor.isNodeComplete(createFakeEnv(state), state.node.id);
    expect(result).toEqual({ complete: true, outcome: "returned" });
  });

  it("reject 决策 + 节点 completed → outcome 'rejected'（超管覆写/存量数据）", async () => {
    const state = baseState();
    state.node.status = "completed";
    state.decisionTask = { action: "reject" };
    const result = await executor.isNodeComplete(createFakeEnv(state), state.node.id);
    expect(result).toEqual({ complete: true, outcome: "rejected" });
  });

  it("节点 completed 无 reject 决策 → approved", async () => {
    const state = baseState();
    state.node.status = "completed";
    state.decisionTask = { action: "approve" };
    const result = await executor.isNodeComplete(createFakeEnv(state), state.node.id);
    expect(result).toEqual({ complete: true, outcome: "approved" });
  });
});

describe("advanceWorkflow — returned 结论走退回而非终态", () => {
  it("AI 拦截后实例 returned（非 rejected），业务表回 draft，节点不被覆写成 completed", async () => {
    const state = baseState();
    state.node.status = "returned";
    state.decisionTask = { action: "reject" };
    const env = createFakeEnv(state);
    await advanceWorkflow(env, 1);
    expect(state.instance.status).toBe("returned");
    expect(state.instance.current_node_key).toBeNull();
    expect(state.node.status).toBe("returned");
    expect(state.bizDraftTables).toEqual(["contract"]);
    expect(state.events.some((e) => e.type === "APPROVAL_RETURNED")).toBe(true);
    expect(state.events.some((e) => e.type === "APPROVAL_REJECTED")).toBe(false);
  });
});
