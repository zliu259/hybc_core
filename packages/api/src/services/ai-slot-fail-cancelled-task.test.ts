import { describe, expect, it, vi } from "vitest";

import type { Env } from "../types/env";
import { FakeTaskQueue, createTaskQueueD1 } from "../test-support/task-queue-fakes";

// 节点对一个已被业务作废撤回（cancelled）的任务回报执行失败时，failTask 不能再按
// 「重试」把它改回 pending——否则刚撤回的毒丸任务下一轮又被认领（2026-10-27 事故里
// 1898 正是靠 retry 一再复活）。

vi.mock("./event-bus", () => ({
  publishEvent: vi.fn(async () => {})
}));

import { failTask } from "./ai-slot";

const createEnv = (queue: FakeTaskQueue): Env =>
  ({
    DB: createTaskQueueD1(queue),
    KV: {
      async get() {
        return null;
      },
      async put() {}
    },
    EVENT_QUEUE: {
      async send() {}
    }
  }) as unknown as Env;

describe("failTask on a cancelled task", () => {
  it("does not resurrect the task as pending", async () => {
    const queue = new FakeTaskQueue();
    queue.seed({
      id: 1898,
      task_type: "approval_ai_gate",
      biz_type: "approval_ai_gate",
      biz_id: 463,
      status: "cancelled",
      assigned_node_id: "node-old",
      retry_count: 1,
      max_retries: 3,
      error_message: "审批已取消，任务撤回"
    });
    const env = createEnv(queue);

    await failTask(env, 1898, "node-old", "worker killed (OOM)");

    expect(queue.get(1898)).toMatchObject({
      status: "cancelled",
      retry_count: 1,
      error_message: "审批已取消，任务撤回"
    });
    expect(queue.taskQueueUpdates).toHaveLength(0);
  });

  it("still requeues a live assigned task that failed under its retry budget (control)", async () => {
    const queue = new FakeTaskQueue();
    queue.seed({
      id: 1898,
      task_type: "approval_ai_gate",
      biz_type: "approval_ai_gate",
      biz_id: 463,
      status: "assigned",
      assigned_node_id: "node-1",
      retry_count: 0,
      max_retries: 3
    });
    const env = createEnv(queue);

    await failTask(env, 1898, "node-1", "transient");

    expect(queue.get(1898)).toMatchObject({
      status: "pending",
      retry_count: 1,
      error_message: "transient",
      assigned_node_id: null
    });
  });
});
