import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Env } from "../types/env";
import { FakeTaskQueue, createTaskQueueD1 } from "../test-support/task-queue-fakes";

// 背景（2026-10-27 / 10-28 生产事故）：付款 PM-20261027-0001 作废后，其审批实例的
// approval_ai_gate 任务（1898）和付款自身的 payment_risk_assessment 任务（1899）仍是
// pending，被 runner 节点反复认领；1898 的超大扫描件把 256 MiB 容器 OOM 打死，队列停摆
// 28 小时。作废/取消动作必须顺带把该业务尚未执行的 AI 任务置为终态，让 pollForNode
// 再也认领不到，节点迟到的结果也不能再产生副作用。

const eventBusMock = vi.hoisted(() => ({
  publishEvent: vi.fn(async () => {})
}));

vi.mock("./event-bus", () => ({
  publishEvent: eventBusMock.publishEvent
}));

vi.mock("./runner-runtime", () => ({
  loadRunnerRuntimeMap: async () => ({})
}));

import {
  cancelPendingAiGateTasksForInstance,
  cancelPendingTasksForBiz,
  pollForNode,
  submitResult
} from "./task-queue";

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

const PAYMENT = { biz_type: "payment_request", biz_id: 2899 };

const seedPaymentTasks = (queue: FakeTaskQueue) => {
  queue.seed(
    { id: 1899, task_type: "payment_risk_assessment", ...PAYMENT, status: "pending", priority: 3 },
    {
      id: 1900,
      task_type: "payment_risk_assessment",
      ...PAYMENT,
      status: "assigned",
      assigned_node_id: "node-old",
      assigned_at: "2026-10-27T02:00:00.000Z",
      started_at: "2026-10-27T02:00:00.000Z"
    },
    {
      id: 1901,
      task_type: "payment_risk_assessment",
      ...PAYMENT,
      status: "timeout",
      retry_count: 1,
      max_retries: 3,
      error_message: "Task timed out"
    },
    {
      id: 1902,
      task_type: "payment_risk_assessment",
      ...PAYMENT,
      status: "timeout",
      retry_count: 3,
      max_retries: 3,
      error_message: "Task timed out"
    },
    { id: 1903, task_type: "payment_risk_assessment", ...PAYMENT, status: "completed" },
    {
      id: 1950,
      task_type: "payment_risk_assessment",
      biz_type: "payment_request",
      biz_id: 2900,
      status: "pending"
    }
  );
};

beforeEach(() => {
  eventBusMock.publishEvent.mockClear();
});

describe("cancelPendingTasksForBiz", () => {
  it("moves pending, assigned and still-retryable timeout tasks of the business to cancelled", async () => {
    const queue = new FakeTaskQueue();
    seedPaymentTasks(queue);
    const env = createEnv(queue);

    const result = await cancelPendingTasksForBiz(env, {
      ...PAYMENT,
      reason: "付款申请 PM-20261027-0001 已作废，任务撤回",
      source: "payment_request"
    });

    expect(result.cancelled.map((task) => task.id).sort()).toEqual([1899, 1900, 1901]);
    for (const id of [1899, 1900, 1901]) {
      expect(queue.get(id).status).toBe("cancelled");
      expect(queue.get(id).error_message).toBe("付款申请 PM-20261027-0001 已作废，任务撤回");
    }
    // 已派发的任务保留节点归属：节点迟到提交结果时服务端还能认出它、静默丢弃
    expect(queue.get(1900).assigned_node_id).toBe("node-old");
  });

  it("leaves terminal rows and other businesses untouched", async () => {
    const queue = new FakeTaskQueue();
    seedPaymentTasks(queue);
    const env = createEnv(queue);

    await cancelPendingTasksForBiz(env, { ...PAYMENT, reason: "作废", source: "test" });

    expect(queue.get(1902)).toMatchObject({ status: "timeout", error_message: "Task timed out" });
    expect(queue.get(1903).status).toBe("completed");
    expect(queue.get(1950).status).toBe("pending");
  });

  it("publishes one TASK_CANCELLED event per withdrawn task", async () => {
    const queue = new FakeTaskQueue();
    seedPaymentTasks(queue);
    const env = createEnv(queue);

    await cancelPendingTasksForBiz(env, { ...PAYMENT, reason: "作废", source: "payment_request" });

    expect(eventBusMock.publishEvent).toHaveBeenCalledTimes(3);
    const calls = eventBusMock.publishEvent.mock.calls as unknown as Array<
      [Env, string, string, Record<string, unknown>]
    >;
    expect(calls.every(([, type]) => type === "TASK_CANCELLED")).toBe(true);
    expect(calls.every(([, , source]) => source === "payment_request")).toBe(true);
    const assigned = calls.find(([, , , payload]) => payload.task_id === 1900);
    expect(assigned?.[3]).toMatchObject({
      task_id: 1900,
      task_type: "payment_risk_assessment",
      biz_type: "payment_request",
      biz_id: 2899,
      previous_status: "assigned",
      reason: "作废"
    });
  });

  it("is a no-op when the business has no live task", async () => {
    const queue = new FakeTaskQueue();
    queue.seed({ id: 1903, task_type: "payment_risk_assessment", ...PAYMENT, status: "completed" });
    const env = createEnv(queue);

    const result = await cancelPendingTasksForBiz(env, { ...PAYMENT, reason: "作废", source: "test" });

    expect(result.cancelled).toEqual([]);
    expect(eventBusMock.publishEvent).not.toHaveBeenCalled();
    expect(queue.taskQueueUpdates).toHaveLength(0);
    expect(queue.get(1903).status).toBe("completed");
  });

  it("narrows to one task_type when asked", async () => {
    const queue = new FakeTaskQueue();
    queue.seed(
      { id: 1, task_type: "payment_risk_assessment", ...PAYMENT, status: "pending" },
      { id: 2, task_type: "payment_attachment_ocr", ...PAYMENT, status: "pending" }
    );
    const env = createEnv(queue);

    await cancelPendingTasksForBiz(env, {
      ...PAYMENT,
      task_type: "payment_risk_assessment",
      reason: "作废",
      source: "test"
    });

    expect(queue.get(1).status).toBe("cancelled");
    expect(queue.get(2).status).toBe("pending");
  });
});

describe("cancelPendingAiGateTasksForInstance", () => {
  it("withdraws every approval_ai_gate task of the instance regardless of its slot route", async () => {
    const queue = new FakeTaskQueue();
    queue.seed(
      // 默认槽位路由：biz_type 与 task_type 同名
      { id: 1898, task_type: "approval_ai_gate", biz_type: "approval_ai_gate", biz_id: 463, priority: 8 },
      // 模板 ai_slot_id 自定义时 biz_type 是槽位名，仍属于同一实例
      { id: 1897, task_type: "approval_ai_gate", biz_type: "contract_gate_v2", biz_id: 463, priority: 8 },
      // 另一实例
      { id: 1910, task_type: "approval_ai_gate", biz_type: "approval_ai_gate", biz_id: 464, priority: 8 },
      // biz_id 撞号的付款风控任务：id 空间不同，绝不能被实例撤回误伤
      { id: 1911, task_type: "payment_risk_assessment", biz_type: "payment_request", biz_id: 463 }
    );
    const env = createEnv(queue);

    const result = await cancelPendingAiGateTasksForInstance(env, {
      instance_id: 463,
      reason: "审批 SP-20261027-0001 已取消，任务撤回",
      source: "approval-operations"
    });

    expect(result.cancelled.map((task) => task.id).sort()).toEqual([1897, 1898]);
    expect(queue.get(1898).status).toBe("cancelled");
    expect(queue.get(1897).status).toBe("cancelled");
    expect(queue.get(1910).status).toBe("pending");
    expect(queue.get(1911).status).toBe("pending");
  });

  it("is idempotent on an instance whose tasks are already terminal", async () => {
    const queue = new FakeTaskQueue();
    queue.seed(
      { id: 1898, task_type: "approval_ai_gate", biz_type: "approval_ai_gate", biz_id: 463, status: "cancelled" },
      { id: 1899, task_type: "approval_ai_gate", biz_type: "approval_ai_gate", biz_id: 463, status: "completed" }
    );
    const env = createEnv(queue);

    const result = await cancelPendingAiGateTasksForInstance(env, {
      instance_id: 463,
      reason: "再次取消",
      source: "test"
    });

    expect(result.cancelled).toEqual([]);
    expect(eventBusMock.publishEvent).not.toHaveBeenCalled();
    expect(queue.taskQueueUpdates).toHaveLength(0);
  });
});

describe("pollForNode after cancellation", () => {
  it("claims the highest-priority pending task when nothing was cancelled (control)", async () => {
    const queue = new FakeTaskQueue();
    queue.seed(
      { id: 1898, task_type: "approval_ai_gate", biz_type: "approval_ai_gate", biz_id: 463, priority: 8 },
      { id: 1899, task_type: "payment_risk_assessment", ...PAYMENT, priority: 3 }
    );
    const env = createEnv(queue);

    const polled = await pollForNode(env, "node-1", ["approval_ai_gate", "payment_risk_assessment"]);

    expect(polled.task?.id).toBe(1898);
    expect(queue.get(1898)).toMatchObject({ status: "assigned", assigned_node_id: "node-1" });
  });

  it("can no longer claim tasks that were cancelled by the void of their business", async () => {
    const queue = new FakeTaskQueue();
    queue.seed(
      { id: 1898, task_type: "approval_ai_gate", biz_type: "approval_ai_gate", biz_id: 463, priority: 8 },
      { id: 1899, task_type: "payment_risk_assessment", ...PAYMENT, priority: 3 }
    );
    const env = createEnv(queue);

    await cancelPendingTasksForBiz(env, { ...PAYMENT, reason: "作废", source: "test" });
    await cancelPendingAiGateTasksForInstance(env, { instance_id: 463, reason: "作废", source: "test" });

    const polled = await pollForNode(env, "node-1", ["approval_ai_gate", "payment_risk_assessment"]);

    expect(polled.task).toBeNull();
    expect(queue.get(1898).status).toBe("cancelled");
    expect(queue.get(1899).status).toBe("cancelled");
  });
});

describe("submitResult on a cancelled task", () => {
  it("accepts the node's late result but writes nothing", async () => {
    const queue = new FakeTaskQueue();
    queue.seed({
      id: 1900,
      task_type: "payment_risk_assessment",
      ...PAYMENT,
      status: "cancelled",
      assigned_node_id: "node-old",
      error_message: "付款申请已作废，任务撤回"
    });
    const env = createEnv(queue);

    await expect(
      submitResult(env, 1900, "node-old", { output: '{"summary":"late"}' })
    ).resolves.toBeUndefined();

    expect(queue.get(1900)).toMatchObject({
      status: "cancelled",
      result_json: null,
      error_message: "付款申请已作废，任务撤回"
    });
    expect(queue.taskQueueUpdates).toHaveLength(0);
  });

  it("still rejects a result from a node that does not hold the task", async () => {
    const queue = new FakeTaskQueue();
    queue.seed({
      id: 1900,
      task_type: "payment_risk_assessment",
      ...PAYMENT,
      status: "assigned",
      assigned_node_id: "node-old"
    });
    const env = createEnv(queue);

    await expect(submitResult(env, 1900, "node-other", { output: "x" })).rejects.toThrow(
      /not assigned to node/
    );
  });
});
