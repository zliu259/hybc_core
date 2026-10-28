import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import type { AuthTokenPayload } from "../types/auth";
import type { Env } from "../types/env";
import { FakeTaskQueue, createTaskQueueD1 } from "../test-support/task-queue-fakes";
import { contractRoutes } from "./contract";

// 合同没有「终止/作废」路由，DELETE 把 status 置 deleted 就是它的作废动作。
// 已删除合同的 contract_review 任务不该再占用 runner（结果只会写回一条已删除的合同）。
// DELETE 不级联审批实例（历史行为），因此这里只撤回挂在合同自身上的任务，不碰 ai_gate。

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

const createEnv = (queue: FakeTaskQueue) => {
  const runs: Array<{ sql: string; params: unknown[] }> = [];
  const db = createTaskQueueD1(queue, {
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

describe("deleting a contract withdraws its unexecuted review tasks", () => {
  it("moves the contract's live contract_review task to cancelled and leaves others alone", async () => {
    const queue = new FakeTaskQueue();
    queue.seed(
      { id: 1960, task_type: "contract_review", biz_type: "contract", biz_id: CONTRACT_ID, status: "pending" },
      { id: 1961, task_type: "contract_review", biz_type: "contract", biz_id: CONTRACT_ID, status: "completed" },
      { id: 1962, task_type: "contract_review", biz_type: "contract", biz_id: 676, status: "pending" },
      // 合同审批实例的 AI 关卡任务：DELETE 不级联实例，这里也不撤回它
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
