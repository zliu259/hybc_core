import { describe, expect, it } from "vitest";

import { executorFactory } from "./executors";
import type { ApprovalTask } from "../../types/approval";
import type { Env } from "../../types/env";

/**
 * 只驱动 AiGateExecutor.isNodeComplete / processAction。
 * 假 D1：节点行 + 本节点的任务行（AI_GATE 与人工都放在 tasks 里）。
 */
type FakeTask = Pick<ApprovalTask, "id" | "assignee_userid" | "action" | "status">;

const createFakeEnv = (nodeStatus: string, tasks: FakeTask[]) => {
  const updates: Array<{ sql: string; args: unknown[] }> = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async first<T>() {
              if (/FROM\s+approval_node_instance/i.test(sql)) {
                return { id: 5, status: nodeStatus, node_type: "ai_gate" } as unknown as T;
              }
              if (
                /SELECT\s+action[\s\S]*FROM\s+approval_task[\s\S]*assignee_userid\s*=\s*'AI_GATE'/i.test(
                  sql
                )
              ) {
                const ai = [...tasks]
                  .reverse()
                  .find(
                    (t) =>
                      t.assignee_userid === "AI_GATE" &&
                      t.status === "completed" &&
                      (t.action === "approve" || t.action === "reject")
                  );
                return (ai ? { action: ai.action } : null) as unknown as T;
              }
              return null as unknown as T;
            },
            async all<T>() {
              if (/FROM\s+approval_task[\s\S]*assignee_userid\s*<>\s*'AI_GATE'/i.test(sql)) {
                return {
                  results: tasks.filter((t) => t.assignee_userid !== "AI_GATE") as unknown as T[]
                };
              }
              return { results: [] as T[] };
            },
            async run() {
              updates.push({ sql, args });
              return { success: true, meta: {} };
            }
          };
        }
      };
    }
  };
  return { env: { DB: db } as unknown as Env, updates };
};

const executor = () => executorFactory("ai_gate");

describe("AiGateExecutor.isNodeComplete — 人工兜底任务优先", () => {
  it("无人工任务：维持旧逻辑，AI approve + 节点 completed → approved", async () => {
    const { env } = createFakeEnv("completed", [
      { id: 1, assignee_userid: "AI_GATE", action: "approve", status: "completed" }
    ]);
    expect(await executor().isNodeComplete(env, 5)).toEqual({
      complete: true,
      outcome: "approved"
    });
  });

  it("无人工任务：AI reject + 节点 returned → returned（未配置审核人的旧路径）", async () => {
    const { env } = createFakeEnv("returned", [
      { id: 1, assignee_userid: "AI_GATE", action: "reject", status: "completed" }
    ]);
    expect(await executor().isNodeComplete(env, 5)).toEqual({
      complete: true,
      outcome: "returned"
    });
  });

  it("AI reject + 人工 pending → 未完成，且不得判 returned/rejected", async () => {
    const { env } = createFakeEnv("in_progress", [
      { id: 1, assignee_userid: "AI_GATE", action: "reject", status: "completed" },
      { id: 2, assignee_userid: "Boss", action: null, status: "pending" }
    ]);
    expect(await executor().isNodeComplete(env, 5)).toEqual({ complete: false, outcome: null });
  });

  it("AI reject + 人工 approve → approved", async () => {
    const { env } = createFakeEnv("in_progress", [
      { id: 1, assignee_userid: "AI_GATE", action: "reject", status: "completed" },
      { id: 2, assignee_userid: "Boss", action: "approve", status: "completed" }
    ]);
    expect(await executor().isNodeComplete(env, 5)).toEqual({
      complete: true,
      outcome: "approved"
    });
  });

  it("人工任务被取消/转签后不计入，回落 AI 判定", async () => {
    const { env } = createFakeEnv("in_progress", [
      { id: 1, assignee_userid: "AI_GATE", action: "reject", status: "completed" },
      { id: 2, assignee_userid: "Boss", action: null, status: "cancelled" },
      { id: 3, assignee_userid: "AI_GATE", action: "approve", status: "completed" }
    ]);
    // 超管在 AI关卡任务页放行：取消了人工任务并补了 AI_GATE approve；节点由路由置 completed
    const { env: env2 } = createFakeEnv("completed", [
      { id: 1, assignee_userid: "AI_GATE", action: "reject", status: "completed" },
      { id: 2, assignee_userid: "Boss", action: null, status: "cancelled" },
      { id: 3, assignee_userid: "AI_GATE", action: "approve", status: "completed" }
    ]);
    expect((await executor().isNodeComplete(env, 5)).complete).toBe(false);
    expect(await executor().isNodeComplete(env2, 5)).toEqual({
      complete: true,
      outcome: "approved"
    });
  });
});

describe("AiGateExecutor.processAction — 人工任务落 completed", () => {
  it("写 action/comment/status=completed", async () => {
    const { env, updates } = createFakeEnv("in_progress", []);
    const task = {
      id: 2,
      node_instance_id: 5,
      instance_id: 1,
      assignee_userid: "Boss",
      action: null,
      comment: null,
      round: 1,
      status: "pending",
      acted_at: null,
      created_at: "",
      updated_at: ""
    } as ApprovalTask;

    await executor().processAction(env, task, "approve", "核实无误，放行");

    expect(updates).toHaveLength(1);
    expect(updates[0].sql).toMatch(/UPDATE\s+approval_task\s+SET\s+action\s*=\s*\?/i);
    expect(updates[0].sql).toMatch(/status\s*=\s*'completed'/i);
    expect(updates[0].args[0]).toBe("approve");
    expect(updates[0].args[1]).toBe("核实无误，放行");
    expect(updates[0].args[updates[0].args.length - 1]).toBe(2);
  });
});
