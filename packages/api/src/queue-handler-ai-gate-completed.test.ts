import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Env } from "./types/env";

/**
 * AI 关卡任务完成的实时路径必须按轮次匹配节点（2026-09-14）。
 *
 * 退回/撤回后重提交会为新一轮建全新的 node_instance；上一轮那条仍在 running 的任务
 * 晚到才完成时，若只按 node_key + in_progress 取最新节点，旧轮结论就会写到新一轮节点上
 *（新一轮自己的任务还没回来）。假件只在 SQL 绑定的轮次与节点轮次一致时才返回节点，
 * 实现若丢掉 round 谓词，第一个用例立刻失败。
 */

const applyMock = vi.hoisted(() => ({
  applyAiGateDecision: vi.fn(async () => {})
}));

vi.mock("./services/approval/ai-gate-apply", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./services/approval/ai-gate-apply")>()),
  applyAiGateDecision: applyMock.applyAiGateDecision
}));

const engineMock = vi.hoisted(() => ({
  advanceWorkflow: vi.fn<(env: unknown, instanceId: number, handler?: unknown) => Promise<void>>(
    async () => {}
  )
}));

vi.mock("./services/approval/engine", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./services/approval/engine")>()),
  advanceWorkflow: engineMock.advanceWorkflow
}));

import { handleAiGateTaskCompleted } from "./queue-handler";

type FakeOptions = {
  /** 关卡节点所在轮次 */
  nodeRound: number;
  /** 任务 payload 的轮次；null = 存量任务没有该字段 */
  payloadRound?: number | null;
};

const createFakeEnv = ({ nodeRound, payloadRound = 1 }: FakeOptions) => {
  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async first<T>() {
              if (/FROM\s+task_queue\s+WHERE\s+id\s*=\s*\?/i.test(sql)) {
                return {
                  id: 1583,
                  task_type: "approval_ai_gate",
                  biz_id: 362,
                  payload_json: JSON.stringify({
                    node_key: "ai_gate_1",
                    instance_id: 362,
                    ...(payloadRound === null ? {} : { round: payloadRound })
                  }),
                  result_json: JSON.stringify({
                    output: JSON.stringify({
                      decision: "reject",
                      findings: [
                        {
                          dimension: "duplicate_payment",
                          status: "fail",
                          detail: "与上月同额付款重复"
                        }
                      ]
                    }),
                    metadata: { outcome: "reject", summary: "疑似重复付款" }
                  })
                } as unknown as T;
              }
              if (/FROM\s+approval_node_instance/i.test(sql)) {
                // 只在 SQL 真的带了轮次谓词、且绑定轮次与节点轮次一致时才命中
                if (!/AND\s+round\s*=\s*\?/i.test(sql)) {
                  return { id: 1931, round: nodeRound } as unknown as T;
                }
                const boundRound = args[args.length - 1] as number;
                return (boundRound === nodeRound
                  ? { id: 1931, round: nodeRound }
                  : null) as unknown as T;
              }
              if (/FROM\s+approval_instance/i.test(sql)) {
                return { biz_type: "payment_request" } as unknown as T;
              }
              return null as unknown as T;
            },
            async all<T>() {
              return { results: [] as T[] };
            },
            async run() {
              return { success: true, meta: {} };
            }
          };
        }
      };
    }
  };
  return { DB: db } as unknown as Env;
};

describe("handleAiGateTaskCompleted — 按轮次匹配关卡节点", () => {
  beforeEach(() => {
    applyMock.applyAiGateDecision.mockClear();
    engineMock.advanceWorkflow.mockClear();
  });

  it("第 1 轮的任务迟到完成时，不落到已进入第 2 轮的节点上", async () => {
    await handleAiGateTaskCompleted(createFakeEnv({ nodeRound: 2, payloadRound: 1 }), 1583);

    expect(applyMock.applyAiGateDecision).not.toHaveBeenCalled();
    expect(engineMock.advanceWorkflow).not.toHaveBeenCalled();
  });

  it("本轮任务完成：结论落地并推进流程", async () => {
    await handleAiGateTaskCompleted(createFakeEnv({ nodeRound: 1, payloadRound: 1 }), 1583);

    expect(applyMock.applyAiGateDecision).toHaveBeenCalledTimes(1);
    expect(engineMock.advanceWorkflow).toHaveBeenCalledTimes(1);
    expect(engineMock.advanceWorkflow.mock.calls[0][1]).toBe(362);
  });

  it("存量任务 payload 无 round：按第 1 轮匹配", async () => {
    await handleAiGateTaskCompleted(createFakeEnv({ nodeRound: 1, payloadRound: null }), 1583);

    expect(applyMock.applyAiGateDecision).toHaveBeenCalledTimes(1);
    expect(engineMock.advanceWorkflow).toHaveBeenCalledTimes(1);
  });
});
