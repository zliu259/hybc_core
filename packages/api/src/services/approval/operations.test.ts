import { describe, expect, it } from "vitest";

import { returnToInitiator } from "./operations";
import type { Env } from "../../types/env";

/**
 * Minimal in-memory D1 fake for the approval operations under test.
 *
 * It tracks a single approval_task row and a single approval_instance row,
 * and applies the UPDATE statements that returnToInitiator issues by reading
 * the literal `status = '...'` value out of each UPDATE. This lets us assert on
 * the resulting instance status the same way production D1 would persist it.
 */
type TaskRow = {
  id: number;
  node_instance_id: number;
  instance_id: number;
  assignee_userid: string;
  status: string;
};

type InstanceRow = {
  id: number;
  instance_no: string;
  biz_type: string;
  biz_id: number;
  initiator_userid: string;
  status: string;
  current_node_key: string | null;
};

const STATUS_LITERAL = /SET\s+status\s*=\s*'([a-z_]+)'/i;
const CLEARS_CURRENT_NODE = /current_node_key\s*=\s*NULL/i;

const createFakeEnv = (
  task: TaskRow,
  instance: InstanceRow
): { env: Env; instance: InstanceRow } => {
  const db = {
    prepare(sql: string) {
      return {
        bind(..._args: unknown[]) {
          return {
            async run() {
              if (/UPDATE\s+approval_instance/i.test(sql)) {
                const match = sql.match(STATUS_LITERAL);
                if (match) {
                  instance.status = match[1];
                }
                if (CLEARS_CURRENT_NODE.test(sql)) {
                  instance.current_node_key = null;
                }
              }
              return { success: true, meta: { last_row_id: 1 } };
            },
            async first<T>() {
              if (/FROM\s+approval_task/i.test(sql)) {
                return task as unknown as T;
              }
              if (/FROM\s+approval_instance/i.test(sql)) {
                return { ...instance } as unknown as T;
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

  const env = {
    DB: db as unknown as D1Database,
    EVENT_QUEUE: { async send() {} } as unknown as Queue
  } as unknown as Env;

  return { env, instance };
};

describe("returnToInitiator", () => {
  it("marks the instance status as 'returned' so it enters the initiator's returned bucket", async () => {
    const task: TaskRow = {
      id: 10,
      node_instance_id: 5,
      instance_id: 1,
      assignee_userid: "approver-1",
      status: "pending"
    };
    const instance: InstanceRow = {
      id: 1,
      instance_no: "SP-20260629-0002",
      biz_type: "payment_request",
      biz_id: 99,
      initiator_userid: "initiator-1",
      status: "in_progress",
      current_node_key: "sequential_gm_node"
    };

    const { env } = createFakeEnv(task, instance);

    await returnToInitiator(env, task.id, "approver-1", "请补充材料");

    // The initiator's "退回待处理" bucket keys off instance.status = 'returned'.
    expect(instance.status).toBe("returned");
    // The flow is no longer at any approval node — clearing current_node_key stops
    // every "current node" view from showing it still parked at the returning node.
    expect(instance.current_node_key).toBeNull();
  });
});
