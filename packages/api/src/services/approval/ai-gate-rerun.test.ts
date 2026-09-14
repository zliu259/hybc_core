import { describe, expect, it, vi } from "vitest";

import { executorFactory, setAiGateHandler } from "./executors";
import type { AiGateHandler, ApprovalNodeInstance, TemplateNodeConfig } from "../../types/approval";
import type { Env } from "../../types/env";

/**
 * 钉住「重提交后 AI 关卡必须重新审查」（2026-09-14）。
 *
 * 重提交会为新一轮建全新的 node_instance，节点上没有任何任务，
 * hasAiDecisionTaskOnNode 因此为 false；若 findAiGateTask 不按轮次过滤，
 * 就会取到上一轮那条 completed 的拦截任务并原样重放旧结论 —— 改过的单据
 * 没被重新审查，未配置兜底审核人时还会「拦截→退回→重提→再拦截」死循环。
 *
 * 假件按 SQL 是否带轮次谓词决定过滤行为：实现若丢掉 '$.round'，
 * 假件立刻把上一轮结论喂回去，本文件第一个用例随即失败。
 */

interface FakeTaskQueueRow {
  id: number;
  /** null = 存量任务的 payload 没有 round 字段，实现侧靠 COALESCE 当作第 1 轮 */
  round: number | null;
  status: string;
  result_json: string | null;
  error_message: string | null;
}

interface FakeState {
  taskQueueRows: FakeTaskQueueRow[];
  /** 实现取任务时 SQL 是否真的带了轮次谓词 */
  roundPredicateSeen: boolean;
  insertedTasks: Array<{ assignee_userid: string; action: string; comment: string }>;
  nodeStatusUpdates: string[];
  eventLogTypes: string[];
  systemConfig: Record<string, string>;
}

const STATUS_LITERAL = /SET\s+status\s*=\s*'([a-z_]+)'/i;

const baseState = (): FakeState => ({
  taskQueueRows: [],
  roundPredicateSeen: false,
  insertedTasks: [],
  nodeStatusUpdates: [],
  eventLogTypes: [],
  systemConfig: {}
});

const createFakeEnv = (state: FakeState): Env => {
  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async run() {
              if (/INSERT\s+INTO\s+approval_task/i.test(sql)) {
                state.insertedTasks.push({
                  assignee_userid: String(args[2]),
                  action: String(args[3]),
                  comment: String(args[4])
                });
              } else if (/UPDATE\s+approval_node_instance/i.test(sql)) {
                const match = sql.match(STATUS_LITERAL);
                if (match) state.nodeStatusUpdates.push(match[1]);
              } else if (/INSERT\s+INTO\s+event_log/i.test(sql)) {
                state.eventLogTypes.push(String(args[0]));
              }
              return { success: true, meta: {} };
            },
            async first<T>() {
              if (/FROM\s+task_queue/i.test(sql)) {
                // 复刻实现的轮次谓词：带 '$.round' 才按轮次过滤，
                // 存量任务（round=null）按 COALESCE 当第 1 轮
                const scoped = /\$\.round/.test(sql);
                state.roundPredicateSeen = scoped;
                const wanted = args[2] as number;
                const rows = scoped
                  ? state.taskQueueRows.filter((r) => (r.round ?? 1) === wanted)
                  : state.taskQueueRows;
                const latest = [...rows].sort((a, b) => b.id - a.id)[0];
                return (latest ?? null) as unknown as T;
              }
              if (/FROM\s+system_config/i.test(sql)) {
                const value = state.systemConfig[String(args[0])];
                return (value === undefined
                  ? null
                  : { config_value: value, updated_by: null, updated_at: "" }) as unknown as T;
              }
              if (/FROM\s+approval_task/i.test(sql)) {
                // 新一轮节点上没有任何任务：AI 决策记录与 pending 人工任务都查不到
                return null as unknown as T;
              }
              if (/FROM\s+approval_instance/i.test(sql)) {
                return {
                  id: 1,
                  instance_no: "SP-20260914-0001",
                  biz_type: "payment_request",
                  biz_id: 900,
                  biz_summary: "付款申请 90 万",
                  instance_config_json: null
                } as unknown as T;
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
  return { DB: db as unknown as D1Database } as unknown as Env;
};

type AiTaskRequest = Parameters<AiGateHandler["createAiTask"]>[1];

const installHandler = () => {
  const createAiTask = vi.fn<(env: Env, request: AiTaskRequest) => Promise<{ task_id: number }>>(
    async () => ({
      task_id: 77
    })
  );
  setAiGateHandler({
    createAiTask,
    getTaskResult: async () => null
  });
  return createAiTask;
};

const gateNode = (round: number): ApprovalNodeInstance => ({
  id: round === 1 ? 5 : 15,
  instance_id: 1,
  node_key: "ai_gate_risk",
  node_type: "ai_gate",
  node_name: "AI风险关卡",
  assignee_userids: null,
  status: "in_progress",
  round,
  sort_order: 1,
  started_at: null,
  completed_at: null,
  created_at: "",
  updated_at: ""
});

const gateConfig: TemplateNodeConfig = {
  key: "ai_gate_risk",
  type: "ai_gate",
  name: "AI风险关卡",
  ai_slot_id: "payment_request"
};

/** 第 1 轮的拦截结论：白名单内维度 duplicate_payment 判 fail，reject 有拦截资格 */
const round1RejectResult = JSON.stringify({
  output: JSON.stringify({
    decision: "reject",
    risk_level: "high",
    summary: "疑似重复付款",
    findings: [{ dimension: "duplicate_payment", status: "fail", detail: "与上月同额付款重复" }]
  }),
  metadata: { outcome: "reject", summary: "疑似重复付款" }
});

const executor = () => executorFactory("ai_gate");

describe("AI 关卡按轮次取任务", () => {
  it("第 2 轮新节点不复用第 1 轮的拦截结论，重新派发任务且 payload 带 round=2", async () => {
    const state = baseState();
    state.taskQueueRows = [
      { id: 9, round: 1, status: "completed", result_json: round1RejectResult, error_message: null }
    ];
    const env = createFakeEnv(state);
    const createAiTask = installHandler();

    await executor().initializeNode(env, gateNode(2), gateConfig, 1);

    expect(state.roundPredicateSeen).toBe(true);
    expect(createAiTask).toHaveBeenCalledTimes(1);
    expect(createAiTask.mock.calls[0][1].payload).toMatchObject({
      node_key: "ai_gate_risk",
      instance_id: 1,
      node_instance_id: 15,
      round: 2
    });
    // 旧结论没有被重放：既没写 AI_GATE 决策记录，也没动节点状态
    expect(state.insertedTasks).toHaveLength(0);
    expect(state.nodeStatusUpdates).toHaveLength(0);
    expect(state.eventLogTypes).toHaveLength(0);
  });

  it("第 1 轮：本轮已完成任务的结论照常落地，不重复派发", async () => {
    const state = baseState();
    state.taskQueueRows = [
      { id: 9, round: 1, status: "completed", result_json: round1RejectResult, error_message: null }
    ];
    const env = createFakeEnv(state);
    const createAiTask = installHandler();

    await executor().initializeNode(env, gateNode(1), gateConfig, 1);

    expect(createAiTask).not.toHaveBeenCalled();
    expect(state.insertedTasks).toHaveLength(1);
    expect(state.insertedTasks[0].assignee_userid).toBe("AI_GATE");
    expect(state.insertedTasks[0].action).toBe("reject");
    // 未配置兜底审核人 → 旧退回路径
    expect(state.nodeStatusUpdates).toEqual(["returned"]);
    expect(state.eventLogTypes).toContain("ai_gate_fallback_reviewer_missing");
  });

  it("存量任务 payload 无 round：COALESCE 当第 1 轮，仍能被第 1 轮取到", async () => {
    const state = baseState();
    state.taskQueueRows = [
      {
        id: 9,
        round: null,
        status: "completed",
        result_json: round1RejectResult,
        error_message: null
      }
    ];
    const env = createFakeEnv(state);
    const createAiTask = installHandler();

    await executor().initializeNode(env, gateNode(1), gateConfig, 1);

    expect(createAiTask).not.toHaveBeenCalled();
    expect(state.insertedTasks[0].action).toBe("reject");
  });

  it("第 2 轮取不到本轮任务时不误判为失败放行：节点不被置 completed", async () => {
    const state = baseState();
    state.taskQueueRows = [
      { id: 9, round: 1, status: "failed", result_json: null, error_message: "runner 超时" }
    ];
    const env = createFakeEnv(state);
    const createAiTask = installHandler();

    await executor().initializeNode(env, gateNode(2), gateConfig, 1);

    expect(createAiTask).toHaveBeenCalledTimes(1);
    expect(state.nodeStatusUpdates).toHaveLength(0);
    expect(state.insertedTasks).toHaveLength(0);
  });
});
