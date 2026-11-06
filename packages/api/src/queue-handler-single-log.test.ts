import { afterEach, describe, expect, it, vi } from "vitest";

import { queue } from "./queue-handler";
import { publishEvent, type DomainEvent } from "./services/event-bus";
import type { Env } from "./types/env";

/**
 * 同一事件在 event_log 只留一行（2026-11-06）。
 *
 * publishEvent 已经写过 event_log，消费者 queue() 以前又无条件写一遍，所以所有事件都是两行，
 * 消息每重试一次还多一行。直接发队列的 system.* 消息没有 source、payload、timestamp，
 * 那次写入必定报错，消息白白重试到用尽次数。
 */

const createHarness = () => {
  let loggedTypes: string[] = [];
  let sent: DomainEvent[] = [];
  let failNextTaskLookup = false;

  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          // 真实 D1 拒绝 undefined，2026-11-06 在本地 workerd 上核实过同样的报错。
          if (args.includes(undefined)) {
            throw new Error("D1_TYPE_ERROR: Type 'undefined' not supported for value 'undefined'");
          }
          return {
            async first<T>() {
              if (failNextTaskLookup && /FROM\s+task_queue/i.test(sql)) {
                failNextTaskLookup = false;
                throw new Error("D1 overloaded");
              }
              return null as T;
            },
            async run() {
              if (/INSERT\s+INTO\s+event_log/i.test(sql)) {
                loggedTypes = [...loggedTypes, String(args[0])];
              }
              return { success: true, meta: { changes: 1 } };
            }
          };
        }
      };
    }
  };

  const env = {
    DB: db,
    EVENT_QUEUE: {
      async send(event: DomainEvent) {
        sent = [...sent, event];
      }
    }
  } as unknown as Env;

  /** 把一条消息交给真实消费者，返回它被确认和要求重试的次数。 */
  const deliver = async (body: unknown) => {
    let acks = 0;
    let retries = 0;
    const message = {
      body,
      ack: () => {
        acks += 1;
      },
      retry: () => {
        retries += 1;
      }
    };
    await queue({ messages: [message] } as unknown as MessageBatch<DomainEvent>, env);
    return { acks, retries };
  };

  return {
    env,
    deliver,
    failNextTaskLookup: () => {
      failNextTaskLookup = true;
    },
    loggedTypes: () => loggedTypes,
    sent: () => sent
  };
};

describe("queue() 不重复写 event_log", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("publishEvent 发出的事件经过消费者后只有一行", async () => {
    const harness = createHarness();

    await publishEvent(harness.env, "CONTRACT_CREATED", "contract", { contract_id: 1 });
    const [message] = harness.sent();
    const outcome = await harness.deliver(message);

    expect(harness.loggedTypes()).toEqual(["CONTRACT_CREATED"]);
    expect(outcome).toEqual({ acks: 1, retries: 0 });
  });

  it("处理失败后重试不会多写行，重试成功就确认", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const harness = createHarness();

    await publishEvent(harness.env, "TASK_COMPLETED", "task-runner", { task_id: 7 });
    const [message] = harness.sent();

    harness.failNextTaskLookup();
    const first = await harness.deliver(message);
    const second = await harness.deliver(message);

    expect(first).toEqual({ acks: 0, retries: 1 });
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(second).toEqual({ acks: 1, retries: 0 });
    expect(harness.loggedTypes()).toEqual(["TASK_COMPLETED"]);
  });

  it.each([
    ["system.ops.health_ping", { type: "system.ops.health_ping", at: "2026-11-06T00:00:00.000Z" }],
    [
      "system.storage_check",
      { type: "system.storage_check", marker: "ping-1", at: "2026-11-06T00:00:00.000Z" }
    ]
  ])("直接发队列的 %s 被正常确认，不重试也不报错", async (_name, body) => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const harness = createHarness();

    const outcome = await harness.deliver(body);

    expect(outcome).toEqual({ acks: 1, retries: 0 });
    expect(consoleError).not.toHaveBeenCalled();
    expect(harness.loggedTypes()).toEqual([]);
  });
});
