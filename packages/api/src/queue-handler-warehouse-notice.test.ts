import { afterEach, describe, expect, it, vi } from "vitest";

import { queue } from "./queue-handler";
import type { DomainEvent } from "./services/event-bus";
import { deliverWarehouseNotice } from "./services/warehouse/notice-deliver";
import type { Env } from "./types/env";

// 库房通知在队列消费者里：发出去就确认，发不出去就重试。

vi.mock("./services/warehouse/notice-deliver", () => ({ deliverWarehouseNotice: vi.fn() }));

const event: DomainEvent = {
  type: "WAREHOUSE_NOTICE",
  source: "warehouse",
  payload: { kind: "kit_submitted", kit_id: 1, actor_userid: "a" },
  timestamp: "2026-11-12T00:00:00.000Z"
};

const env = {} as unknown as Env;

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

describe("queue() 处理库房通知", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(deliverWarehouseNotice).mockReset();
  });

  it("发送成功就确认消息，把 payload 原样交给投递函数", async () => {
    vi.mocked(deliverWarehouseNotice).mockResolvedValue({ sent: 1, skipped: null });
    expect(await deliver(event)).toEqual({ acks: 1, retries: 0 });
    expect(deliverWarehouseNotice).toHaveBeenCalledWith(env, event.payload);
  });

  it("不用发的情况也确认，不会一直重试", async () => {
    vi.mocked(deliverWarehouseNotice).mockResolvedValue({ sent: 0, skipped: "no_recipient" });
    expect(await deliver(event)).toEqual({ acks: 1, retries: 0 });
  });

  it("发送失败就重试", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(deliverWarehouseNotice).mockRejectedValue(new Error("bridge down"));
    expect(await deliver(event)).toEqual({ acks: 0, retries: 1 });
  });
});
