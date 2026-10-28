import { describe, expect, it, vi } from "vitest";

import type { Env } from "../../types/env";
import { FakeTaskQueue, createTaskQueueD1 } from "../../test-support/task-queue-fakes";

// 背景（2026-10-28）：PM-20261028-0002 被 AI 关卡 reject 后，财务先撤销审批再作废付款；
// 撤销只收口 approval_task / approval_instance，实例的 approval_ai_gate 任务 1945 仍被
// runner 执行，结果写回已作废单据。cancel()/withdraw() 必须顺带把该实例尚未执行的
// AI 关卡任务置为终态。

vi.mock("../event-bus", () => ({
  publishEvent: vi.fn(async () => {})
}));

import { cancel, withdraw } from "./operations";

const INSTANCE_ID = 463;

const instanceRow = (status: string) => ({
  id: INSTANCE_ID,
  instance_no: "SP-20261027-0001",
  template_id: 1,
  biz_type: "payment_request",
  biz_id: 2899,
  biz_summary: "首笔预付款",
  initiator_userid: "initiator-a",
  status,
  current_round: 1,
  current_node_key: "ai_gate",
  instance_config_json: null,
  created_at: "2026-10-27T01:00:00.000Z",
  updated_at: "2026-10-27T01:00:00.000Z"
});

const createEnv = (queue: FakeTaskQueue, instanceStatus = "in_progress") => {
  const runs: Array<{ sql: string; params: unknown[] }> = [];
  const db = createTaskQueueD1(queue, {
    first(sql) {
      if (/FROM approval_instance WHERE id = \?/.test(sql)) return instanceRow(instanceStatus);
      return null;
    },
    run(sql, params) {
      runs.push({ sql, params });
      return 1;
    }
  });
  const env = {
    DB: db,
    EVENT_QUEUE: {
      async send() {}
    }
  } as unknown as Env;
  return { env, runs };
};

const seedGateTasks = (queue: FakeTaskQueue) => {
  queue.seed(
    {
      id: 1945,
      task_type: "approval_ai_gate",
      biz_type: "approval_ai_gate",
      biz_id: INSTANCE_ID,
      priority: 8,
      status: "pending",
      payload_json: JSON.stringify({ node_key: "ai_gate", round: 2 })
    },
    {
      id: 1944,
      task_type: "approval_ai_gate",
      biz_type: "approval_ai_gate",
      biz_id: INSTANCE_ID,
      priority: 8,
      status: "completed",
      payload_json: JSON.stringify({ node_key: "ai_gate", round: 1 })
    },
    {
      id: 1946,
      task_type: "approval_ai_gate",
      biz_type: "approval_ai_gate",
      biz_id: 464,
      priority: 8,
      status: "pending"
    }
  );
};

describe("cancel() withdraws the instance's pending ai_gate tasks", () => {
  it("moves the live task to cancelled and leaves the finished round and other instances alone", async () => {
    const queue = new FakeTaskQueue();
    seedGateTasks(queue);
    const { env, runs } = createEnv(queue);

    await cancel(env, INSTANCE_ID, "finance-a", ["finance", "super_admin"], "重复提交，作废重提");

    expect(queue.get(1945).status).toBe("cancelled");
    expect(queue.get(1945).error_message).toContain("SP-20261027-0001");
    expect(queue.get(1944).status).toBe("completed");
    expect(queue.get(1946).status).toBe("pending");
    // 原有收口动作不变
    expect(runs.some((call) => /UPDATE approval_instance SET status = 'cancelled'/.test(call.sql))).toBe(
      true
    );
  });

  it("is a no-op for an instance without live ai_gate tasks", async () => {
    const queue = new FakeTaskQueue();
    queue.seed({
      id: 1944,
      task_type: "approval_ai_gate",
      biz_type: "approval_ai_gate",
      biz_id: INSTANCE_ID,
      status: "completed"
    });
    const { env } = createEnv(queue);

    await cancel(env, INSTANCE_ID, "initiator-a", ["manager"]);

    expect(queue.get(1944).status).toBe("completed");
    expect(queue.taskQueueUpdates).toHaveLength(0);
  });
});

describe("withdraw() withdraws the instance's pending ai_gate tasks", () => {
  it("moves the live task to cancelled", async () => {
    const queue = new FakeTaskQueue();
    seedGateTasks(queue);
    const { env } = createEnv(queue);

    await withdraw(env, INSTANCE_ID, "initiator-a", "先撤回改附件");

    expect(queue.get(1945).status).toBe("cancelled");
    expect(queue.get(1945).error_message).toContain("撤回");
    expect(queue.get(1944).status).toBe("completed");
    expect(queue.get(1946).status).toBe("pending");
  });
});
