import { describe, expect, it, vi } from "vitest";

import type { Env } from "../../types/env";

// 背景（SP-20261014-0010）：付款被作废后实例已 cancelled，节点却还停在 in_progress，
// 详情页显示「进行中」，超时巡检每小时为它写一条 APPROVAL_TIMEOUT，持续 22 天。
// 流程被取消、撤回时必须把正在进行的节点一并收口；巡检只看还在跑的实例的当前轮。

vi.mock("../event-bus", () => ({
  publishEvent: vi.fn(async () => {}),
  logEvent: vi.fn(async () => {})
}));
vi.mock("../task-queue", () => ({
  cancelPendingAiGateTasksForInstance: vi.fn(async () => {})
}));

import { logEvent } from "../event-bus";
import { checkApprovalTimeouts } from "./engine";
import { cancel, withdraw } from "./operations";

const instanceRow = {
  id: 435,
  instance_no: "SP-20261014-0010",
  biz_type: "payment_request",
  biz_id: 2931,
  initiator_userid: "initiator-a",
  status: "in_progress",
  current_round: 1,
  current_node_key: "countersign"
};

const createEnv = () => {
  const runs: Array<{ sql: string; params: unknown[] }> = [];
  const selects: string[] = [];
  const statement = (sql: string) => {
    let params: unknown[] = [];
    const api = {
      bind(...values: unknown[]) {
        params = values;
        return api;
      },
      async first<T>() {
        return (sql.includes("FROM approval_instance") ? instanceRow : null) as T | null;
      },
      async all<T>() {
        selects.push(sql);
        return { results: [] as T[] };
      },
      async run() {
        runs.push({ sql, params });
        return { meta: { last_row_id: runs.length, changes: 1 } };
      }
    };
    return api;
  };
  const env = {
    DB: { prepare: statement },
    EVENT_QUEUE: { async send() {} }
  } as unknown as Env;
  return { env, runs, selects };
};

const nodeClose = (runs: Array<{ sql: string; params: unknown[] }>) =>
  runs.find(
    call =>
      call.sql.includes("UPDATE approval_node_instance") &&
      call.sql.includes("'cancelled'") &&
      call.sql.includes("'in_progress'")
  );

describe("取消、撤回时收口正在进行的节点", () => {
  it("cancel 收口节点", async () => {
    const { env, runs } = createEnv();
    await cancel(env, 435, "initiator-a", ["manager"], "不做了");
    expect(nodeClose(runs)?.params).toContain(435);
  });

  it("withdraw 收口节点", async () => {
    const { env, runs } = createEnv();
    await withdraw(env, 435, "initiator-a", "要改");
    expect(nodeClose(runs)?.params).toContain(435);
  });
});

describe("checkApprovalTimeouts", () => {
  it("只查还在跑的实例的当前轮，已结束的单子不再产生超时事件", async () => {
    vi.mocked(logEvent).mockClear();
    const { env, selects } = createEnv();
    const count = await checkApprovalTimeouts(env);

    expect(count).toBe(0);
    expect(logEvent).not.toHaveBeenCalled();
    const sql = selects.find(item => item.includes("approval_node_instance")) ?? "";
    expect(sql).toContain("JOIN approval_instance");
    expect(sql).toContain("i.status = 'in_progress'");
    expect(sql).toContain("n.round = i.current_round");
  });
});
