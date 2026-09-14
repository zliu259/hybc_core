import { describe, expect, it } from "vitest";

import { executorFactory, setAiGateHandler } from "./executors";
import { AI_GATE_FALLBACK_REVIEWER_KEY } from "./ai-gate-fallback";
import type { ApprovalNodeInstance, ApprovalTask, TemplateNodeConfig } from "../../types/approval";
import type { Env } from "../../types/env";

/**
 * AI 拦截 → 转人工 → 人工放行 的贯通用例（2026-09-13 转人工设计）。
 *
 * 驱动真实的 AiGateExecutor.initializeNode / processAction / isNodeComplete
 * 与 settleAiGateBlock，只把 D1 换成内存假件（approval_task 是真表：INSERT 进去的
 * 人工任务，后面就是 isNodeComplete 读到的那一条）。
 *
 * 边界：到 isNodeComplete 的结论为止，不驱动 advanceWorkflow 的后续节点初始化
 *（那需要模板解析 + 下一节点建任务，与本用例要钉的关卡内状态机无关）。
 */

interface FakeTaskRow {
  id: number;
  node_instance_id: number;
  instance_id: number;
  assignee_userid: string;
  action: string | null;
  comment: string | null;
  round: number;
  status: string;
}

interface FlowState {
  node: { id: number; status: string; round: number; node_type: string };
  tasks: FakeTaskRow[];
  taskQueue: Array<{
    id: number;
    round: number;
    status: string;
    result_json: string | null;
    error_message: string | null;
  }>;
  systemConfig: Record<string, string>;
  events: Array<{ type: string; payload: Record<string, unknown> }>;
}

const STATUS_LITERAL = /SET\s+status\s*=\s*'([a-z_]+)'/i;
const HUMAN_TASK_COLUMNS =
  /\(node_instance_id,\s*instance_id,\s*assignee_userid,\s*round,\s*status/i;

const lastAiDecisionId = (state: FlowState): number =>
  state.tasks
    .filter(
      (t) =>
        t.assignee_userid === "AI_GATE" &&
        t.status === "completed" &&
        (t.action === "approve" || t.action === "reject")
    )
    .reduce((max, t) => (t.id > max ? t.id : max), 0);

const createFakeEnv = (state: FlowState): Env => {
  let nextId = 100;
  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async run() {
              if (/INSERT\s+INTO\s+approval_task/i.test(sql)) {
                const human = HUMAN_TASK_COLUMNS.test(sql);
                state.tasks.push({
                  id: nextId++,
                  node_instance_id: args[0] as number,
                  instance_id: args[1] as number,
                  assignee_userid: args[2] as string,
                  action: human ? null : (args[3] as string),
                  comment: human ? null : (args[4] as string),
                  round: human ? (args[3] as number) : (args[5] as number),
                  status: human ? "pending" : "completed"
                });
              } else if (/UPDATE\s+approval_task\s+SET\s+action\s*=\s*\?/i.test(sql)) {
                const target = state.tasks.find((t) => t.id === args[args.length - 1]);
                if (target) {
                  target.action = args[0] as string;
                  target.comment = args[1] as string | null;
                  target.status = "completed";
                }
              } else if (/UPDATE\s+approval_node_instance/i.test(sql)) {
                const match = sql.match(STATUS_LITERAL);
                if (match) state.node.status = match[1];
              }
              return { success: true, meta: {} };
            },
            async first<T>() {
              if (/FROM\s+task_queue/i.test(sql)) {
                const round = args[2] as number;
                const row = [...state.taskQueue]
                  .filter((r) => r.round === round)
                  .sort((a, b) => b.id - a.id)[0];
                return (row ?? null) as unknown as T;
              }
              if (/FROM\s+system_config/i.test(sql)) {
                const value = state.systemConfig[String(args[0])];
                return (value === undefined
                  ? null
                  : { config_value: value, updated_by: null, updated_at: "" }) as unknown as T;
              }
              if (/FROM\s+approval_task/i.test(sql)) {
                if (/SELECT\s+action/i.test(sql)) {
                  const ai = [...state.tasks]
                    .reverse()
                    .find(
                      (t) =>
                        t.assignee_userid === "AI_GATE" &&
                        t.status === "completed" &&
                        (t.action === "approve" || t.action === "reject")
                    );
                  return (ai ? { action: ai.action } : null) as unknown as T;
                }
                const pendingHuman = /<>\s*'AI_GATE'/.test(sql);
                const hit = [...state.tasks]
                  .reverse()
                  .find((t) =>
                    pendingHuman
                      ? t.assignee_userid !== "AI_GATE" && t.status === "pending"
                      : t.assignee_userid === "AI_GATE" && t.status === "completed"
                  );
                return (hit ? { id: hit.id } : null) as unknown as T;
              }
              if (/FROM\s+approval_node_instance/i.test(sql)) {
                return { ...state.node } as unknown as T;
              }
              if (/FROM\s+approval_instance/i.test(sql)) {
                return {
                  id: 1,
                  instance_no: "SP-20260914-0002",
                  biz_type: "payment_request",
                  biz_id: 900,
                  biz_summary: "付款申请 90 万",
                  instance_config_json: null
                } as unknown as T;
              }
              return null as unknown as T;
            },
            async all<T>() {
              if (/FROM\s+approval_task[\s\S]*<>\s*'AI_GATE'/i.test(sql)) {
                const floor = /id\s*>\s*COALESCE\(/i.test(sql) ? lastAiDecisionId(state) : 0;
                return {
                  results: state.tasks.filter(
                    (t) => t.assignee_userid !== "AI_GATE" && t.id > floor
                  ) as unknown as T[]
                };
              }
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

const gateNode: ApprovalNodeInstance = {
  id: 5,
  instance_id: 1,
  node_key: "ai_gate_risk",
  node_type: "ai_gate",
  node_name: "AI风险关卡",
  assignee_userids: null,
  status: "in_progress",
  round: 1,
  sort_order: 1,
  started_at: null,
  completed_at: null,
  created_at: "",
  updated_at: ""
};

const gateConfig: TemplateNodeConfig = {
  key: "ai_gate_risk",
  type: "ai_gate",
  name: "AI风险关卡",
  ai_slot_id: "payment_request"
};

/** metadata.outcome 形态（ai-gate-result 路径 1），白名单内维度 fail → 有拦截资格 */
const rejectResult = JSON.stringify({
  output: JSON.stringify({
    decision: "reject",
    risk_level: "high",
    summary: "疑似重复付款",
    findings: [{ dimension: "duplicate_payment", status: "fail", detail: "与上月同额付款重复" }]
  }),
  metadata: { outcome: "reject", summary: "疑似重复付款" }
});

/** 走到「AI 拦截已转人工、审核人任务 pending」的状态 */
const escalate = async () => {
  const state: FlowState = {
    node: { id: 5, status: "in_progress", round: 1, node_type: "ai_gate" },
    tasks: [],
    taskQueue: [
      { id: 9, round: 1, status: "completed", result_json: rejectResult, error_message: null }
    ],
    systemConfig: { [AI_GATE_FALLBACK_REVIEWER_KEY]: "Boss" },
    events: []
  };
  const env = createFakeEnv(state);
  setAiGateHandler({
    createAiTask: async () => ({ task_id: 0 }),
    getTaskResult: async () => null
  });
  await executorFactory("ai_gate").initializeNode(env, gateNode, gateConfig, 1);
  return { state, env, executor: executorFactory("ai_gate") };
};

describe("AI 关卡拦截转人工 — 关卡内贯通", () => {
  it("拦截落地：节点保持 in_progress，审核人 pending 任务 + 转人工事件，关卡未完成", async () => {
    const { state, env, executor } = await escalate();

    expect(state.node.status).toBe("in_progress");

    const aiRows = state.tasks.filter((t) => t.assignee_userid === "AI_GATE");
    expect(aiRows).toHaveLength(1);
    expect(aiRows[0].action).toBe("reject");

    const humanRows = state.tasks.filter((t) => t.assignee_userid === "Boss");
    expect(humanRows).toHaveLength(1);
    expect(humanRows[0]).toMatchObject({
      node_instance_id: 5,
      instance_id: 1,
      round: 1,
      status: "pending"
    });

    const escalated = state.events.find((e) => e.type === "APPROVAL_AI_ESCALATED");
    expect(escalated).toBeDefined();
    expect(escalated?.payload).toMatchObject({
      instance_id: 1,
      node_instance_id: 5,
      reviewer_userid: "Boss"
    });

    expect(await executor.isNodeComplete(env, 5)).toEqual({ complete: false, outcome: null });
  });

  it("审核人放行后关卡通过：isNodeComplete → approved", async () => {
    const { state, env, executor } = await escalate();
    const humanTask = state.tasks.find((t) => t.assignee_userid === "Boss");
    expect(humanTask).toBeDefined();

    await executor.processAction(
      env,
      humanTask as unknown as ApprovalTask,
      "approve",
      "已核实无误"
    );

    expect(humanTask?.status).toBe("completed");
    expect(humanTask?.action).toBe("approve");
    expect(await executor.isNodeComplete(env, 5)).toEqual({ complete: true, outcome: "approved" });
  });

  it("审核人驳回后关卡判驳回：isNodeComplete → rejected", async () => {
    const { state, env, executor } = await escalate();
    const humanTask = state.tasks.find((t) => t.assignee_userid === "Boss");

    await executor.processAction(
      env,
      humanTask as unknown as ApprovalTask,
      "reject",
      "确属重复付款"
    );

    expect(await executor.isNodeComplete(env, 5)).toEqual({ complete: true, outcome: "rejected" });
  });
});
