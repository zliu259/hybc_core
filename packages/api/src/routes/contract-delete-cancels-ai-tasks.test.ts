import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import type { AuthTokenPayload } from "../types/auth";
import type { Env } from "../types/env";
import { FakeTaskQueue, createTaskQueueD1 } from "../test-support/task-queue-fakes";
import { contractRoutes } from "./contract";

// 合同没有「终止/作废」路由，DELETE 把 status 置 deleted 就是它的作废动作。
// 已删除合同的 contract_review 任务不该再占用 runner（结果只会写回一条已删除的合同）。
// 2026-11-11 起 DELETE 会终止合同上还没结束的审批（SP-20261013-0005），
// 被终止审批的 AI 关卡任务也一起撤回。真实 SQL 下的完整场景见
// test/contract-delete-open-approval.test.ts；那份测试在 CI（Node 20）上跳过，这里守住路由层。

const mockAuthState = vi.hoisted(() => ({
  payload: {
    sub: "finance-a",
    username: "finance-a",
    nickname: "Finance A",
    avatar: "",
    roles: ["finance"],
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

const CONTRACT_ID = 675;

type FakeEnvOptions = {
  /** 合同上还没结束的审批实例 id */
  openInstanceIds?: number[];
};

const createEnv = (queue: FakeTaskQueue, { openInstanceIds = [] }: FakeEnvOptions = {}) => {
  const runs: Array<{ sql: string; params: unknown[] }> = [];
  const db = createTaskQueueD1(queue, {
    first(sql) {
      if (/FROM contract WHERE id = \?/.test(sql)) {
        return { id: CONTRACT_ID, contract_no: "CT-20260913-0001", status: "pending_approval" };
      }
      return null;
    },
    all(sql) {
      if (/FROM approval_instance/.test(sql)) {
        return openInstanceIds.map((id) => ({ id }));
      }
      return [];
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

const deleteContract = (env: Env) => {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/contract", contractRoutes);
  return app.request(
    `/contract/${CONTRACT_ID}`,
    { method: "DELETE", headers: { authorization: "Bearer test-token" } },
    env
  );
};

const indexOfRun = (runs: Array<{ sql: string }>, pattern: RegExp) =>
  runs.findIndex((call) => pattern.test(call.sql));

describe("deleting a contract withdraws its unexecuted review tasks", () => {
  it("moves the contract's live contract_review task to cancelled and leaves others alone", async () => {
    const queue = new FakeTaskQueue();
    queue.seed(
      { id: 1960, task_type: "contract_review", biz_type: "contract", biz_id: CONTRACT_ID, status: "pending" },
      { id: 1961, task_type: "contract_review", biz_type: "contract", biz_id: CONTRACT_ID, status: "completed" },
      { id: 1962, task_type: "contract_review", biz_type: "contract", biz_id: 676, status: "pending" },
      // 这份合同没有未结束的审批：别的实例的 AI 关卡任务不撤回
      { id: 1963, task_type: "approval_ai_gate", biz_type: "approval_ai_gate", biz_id: 500, status: "pending" }
    );
    const { env, runs } = createEnv(queue);

    const response = await deleteContract(env);

    expect(response.status).toBe(200);
    expect(queue.get(1960).status).toBe("cancelled");
    expect(queue.get(1960).error_message).toContain("删除");
    expect(queue.get(1961).status).toBe("completed");
    expect(queue.get(1962).status).toBe("pending");
    expect(queue.get(1963).status).toBe("pending");
    expect(runs.some((call) => /UPDATE contract SET status = 'deleted'/.test(call.sql))).toBe(true);
    expect(runs.some((call) => /UPDATE approval_instance/.test(call.sql))).toBe(false);
  });

  it("still deletes a contract that has no live task", async () => {
    const queue = new FakeTaskQueue();
    const { env, runs } = createEnv(queue);

    const response = await deleteContract(env);

    expect(response.status).toBe(200);
    expect(queue.taskQueueUpdates).toHaveLength(0);
    expect(runs.some((call) => /UPDATE contract SET status = 'deleted'/.test(call.sql))).toBe(true);
  });
});

describe("deleting a contract closes its still-open approval", () => {
  it("先终止审批、记下是谁终止的，再删合同", async () => {
    const queue = new FakeTaskQueue();
    const { env, runs } = createEnv(queue, { openInstanceIds: [500] });

    const response = await deleteContract(env);

    expect(response.status).toBe(200);
    const closeInstance = indexOfRun(runs, /UPDATE approval_instance\s+SET status = 'cancelled'/);
    const deleteRow = indexOfRun(runs, /UPDATE contract SET status = 'deleted'/);
    expect(closeInstance).toBeGreaterThanOrEqual(0);
    expect(runs[closeInstance].params).toContain(500);
    expect(deleteRow).toBeGreaterThan(closeInstance);

    const tasks = runs.find((call) => /UPDATE approval_task/.test(call.sql));
    expect(tasks?.params).toContain(500);
    const nodes = runs.find((call) => /UPDATE approval_node_instance/.test(call.sql));
    expect(nodes?.params).toContain(500);
    const action = runs.find((call) => /INSERT INTO approval_initiator_action/.test(call.sql));
    expect(action?.sql).toContain("'cancel'");
    expect(action?.params.slice(0, 2)).toEqual([500, "finance-a"]);
    expect(String(action?.params[2])).toContain("合同已删除");
  });

  it("撤回被终止审批的 AI 关卡任务，别的实例的不动", async () => {
    const queue = new FakeTaskQueue();
    queue.seed(
      { id: 1963, task_type: "approval_ai_gate", biz_type: "approval_ai_gate", biz_id: 500, status: "pending" },
      { id: 1964, task_type: "approval_ai_gate", biz_type: "approval_ai_gate", biz_id: 501, status: "pending" }
    );
    const { env } = createEnv(queue, { openInstanceIds: [500] });

    const response = await deleteContract(env);

    expect(response.status).toBe(200);
    expect(queue.get(1963).status).toBe("cancelled");
    expect(queue.get(1964).status).toBe("pending");
  });

  it("记一条删除审计，带上被终止的审批", async () => {
    const queue = new FakeTaskQueue();
    const { env, runs } = createEnv(queue, { openInstanceIds: [500] });

    await deleteContract(env);

    const audit = runs.find((call) => /INSERT INTO api_audit_log/.test(call.sql));
    expect(audit?.params.slice(0, 5)).toEqual([
      "finance-a",
      JSON.stringify(["finance"]),
      "contract.delete",
      "contract",
      String(CONTRACT_ID)
    ]);
    expect(JSON.parse(String(audit?.params[6]))).toEqual({
      contract_no: "CT-20260913-0001",
      previous_status: "pending_approval",
      closed_approval_instance_ids: [500]
    });
  });
});
