import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthTokenPayload } from "../types/auth";
import type { Env } from "../types/env";
import { FakeTaskQueue, createTaskQueueD1 } from "../test-support/task-queue-fakes";
import { pollForNode } from "../services/task-queue";
import { paymentRoutes } from "./payment";

// 背景（2026-10-27 生产事故）：PM-20261027-0001 于 03:08 作废，但 void 路由只收口审批
// 实例/人工任务，不管 task_queue：该实例的 approval_ai_gate 任务 1898（priority 8，附件
// 是超大扫描件）与付款自身的 payment_risk_assessment 任务 1899 仍是 pending，被节点
// 反复认领，1898 把 runner 容器 OOM 打死，队列停摆 28 小时。
//
// 本文件驱动真实 Hono 路由：payment_request / approval_instance 用最小假行，task_queue
// 交给 FakeTaskQueue 按生产 SQL 语义执行，作废后再用真实 pollForNode 证明认领不到。

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

vi.mock("../services/runner-runtime", () => ({
  loadRunnerRuntimeMap: async () => ({})
}));

const PAYMENT_ID = 2899;
const INSTANCE_ID = 362;

const paymentRow = (status: string, approvalInstanceId: number | null) => ({
  id: PAYMENT_ID,
  serial_no: "PM-20261027-0001",
  project_id: 65,
  contract_id: 675,
  payee_id: 701,
  amount: 20000,
  amount_cn: "贰万元整",
  content: "首笔预付款",
  category: "其他费用",
  expected_payment_date: "2026-10-30",
  payment_method: "对公转账",
  payment_entity_id: 18,
  payment_entity_bank_account_id: null,
  payment_account: null,
  attachments_json: null,
  remark: null,
  status,
  approval_instance_id: approvalInstanceId,
  applicant_userid: "initiator-a",
  created_at: "2026-10-27T01:02:55.751Z",
  updated_at: "2026-10-27T01:03:52.078Z"
});

const createEnv = (
  queue: FakeTaskQueue,
  options: { paymentStatus?: string; approvalInstanceId?: number | null } = {}
) => {
  const runs: Array<{ sql: string; params: unknown[] }> = [];
  const db = createTaskQueueD1(queue, {
    first(sql) {
      if (sql.includes("FROM payment_request WHERE id = ?")) {
        return paymentRow(
          options.paymentStatus ?? "pending_approval",
          options.approvalInstanceId === undefined ? INSTANCE_ID : options.approvalInstanceId
        );
      }
      return null;
    },
    run(sql, params) {
      runs.push({ sql, params });
      return 1;
    }
  });
  const env = {
    DB: db,
    KV: {
      async get(key: string) {
        return key.startsWith("session:") ? "session" : null;
      },
      async put() {}
    },
    EVENT_QUEUE: {
      async send() {}
    }
  } as unknown as Env;
  return { env, runs };
};

const seedTasks = (queue: FakeTaskQueue) => {
  queue.seed(
    {
      id: 1898,
      task_type: "approval_ai_gate",
      biz_type: "approval_ai_gate",
      biz_id: INSTANCE_ID,
      priority: 8,
      status: "pending",
      payload_json: JSON.stringify({ node_key: "ai_gate", round: 1, biz_type: "payment_request" })
    },
    {
      id: 1899,
      task_type: "payment_risk_assessment",
      biz_type: "payment_request",
      biz_id: PAYMENT_ID,
      priority: 3,
      status: "assigned",
      assigned_node_id: "node-old",
      assigned_at: "2026-10-27T02:00:00.000Z",
      started_at: "2026-10-27T02:00:00.000Z"
    },
    // 另一笔付款的风控任务：作废 2899 不得波及
    {
      id: 1905,
      task_type: "payment_risk_assessment",
      biz_type: "payment_request",
      biz_id: 2900,
      priority: 3,
      status: "pending",
      created_at: "2026-10-27T03:00:00.000Z"
    }
  );
};

const createApp = () => {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/payment", paymentRoutes);
  return app;
};

const voidPayment = (env: Env, body: Record<string, unknown> = {}) =>
  createApp().request(
    `/payment/${PAYMENT_ID}/void`,
    {
      method: "POST",
      headers: { authorization: "Bearer test-token", "content-type": "application/json" },
      body: JSON.stringify(body)
    },
    env
  );

const CAPABILITIES = ["approval_ai_gate", "payment_risk_assessment"];

describe("voiding a payment withdraws its unexecuted AI tasks", () => {
  beforeEach(() => {
    mockAuthState.payload = { ...mockAuthState.payload, sub: "boss-a", roles: ["super_admin"] };
  });

  it("moves the risk-assessment task and the instance's ai_gate task to cancelled", async () => {
    const queue = new FakeTaskQueue();
    seedTasks(queue);
    const { env } = createEnv(queue);

    const response = await voidPayment(env, { reason: "附件对象不符" });

    expect(response.status).toBe(200);
    expect(queue.get(1898).status).toBe("cancelled");
    expect(queue.get(1899).status).toBe("cancelled");
    expect(queue.get(1898).error_message).toContain("PM-20261027-0001");
    expect(queue.get(1898).error_message).toContain("作废");
    expect(queue.get(1905).status).toBe("pending");
  });

  it("leaves nothing for a runner node to claim from the voided payment", async () => {
    const queue = new FakeTaskQueue();
    seedTasks(queue);
    const { env } = createEnv(queue);

    await voidPayment(env);

    // 剩下可领的只有另一笔付款的任务；再 poll 一次就空了
    const first = await pollForNode(env, "node-1", CAPABILITIES);
    expect(first.task?.id).toBe(1905);
    const second = await pollForNode(env, "node-1", CAPABILITIES);
    expect(second.task).toBeNull();
  });

  it("without the void, the poison ai_gate task would be the first thing claimed (control)", async () => {
    const queue = new FakeTaskQueue();
    seedTasks(queue);
    const { env } = createEnv(queue);

    const polled = await pollForNode(env, "node-1", CAPABILITIES);

    expect(polled.task?.id).toBe(1898);
  });

  it("only withdraws the payment's own task when there is no approval instance", async () => {
    const queue = new FakeTaskQueue();
    seedTasks(queue);
    const { env } = createEnv(queue, { paymentStatus: "draft", approvalInstanceId: null });

    const response = await voidPayment(env);

    expect(response.status).toBe(200);
    expect(queue.get(1899).status).toBe("cancelled");
    // 没有关联实例就不该去碰任何 ai_gate 任务
    expect(queue.get(1898).status).toBe("pending");
  });

  it("still voids a payment that has no live AI task at all", async () => {
    const queue = new FakeTaskQueue();
    queue.seed({
      id: 1903,
      task_type: "payment_risk_assessment",
      biz_type: "payment_request",
      biz_id: PAYMENT_ID,
      status: "completed"
    });
    const { env, runs } = createEnv(queue);

    const response = await voidPayment(env);

    expect(response.status).toBe(200);
    expect(queue.get(1903).status).toBe("completed");
    expect(queue.taskQueueUpdates).toHaveLength(0);
    expect(runs.some((call) => call.sql.includes("UPDATE payment_request"))).toBe(true);
  });
});
