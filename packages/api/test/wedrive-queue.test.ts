import { beforeEach, describe, expect, it, vi } from "vitest";

import { queue } from "../src/queue-handler";
import { saveWedriveSetting } from "../src/services/wedrive/settings";
import { createFakeWedrive } from "./helpers/fake-wedrive";
import { createWarehouseHarness } from "./helpers/warehouse-harness";
import { hasSqlite } from "./helpers/sqlite-d1";

// 队列消费者里的微盘镜像：一批消息里只排空一次，而且排在这一批的最后（一趟可能要几分钟，不能挡着同一批里的审批推送）。

const bridge = vi.hoisted(() => ({ call: async () => ({ errcode: 0 }) }));

vi.mock("../src/services/wecom-api", async (original) => ({
  ...(await original()),
  fetchWeComAccessToken: async () => "token-1"
}));

vi.mock("../src/services/wecom-approval-push", async (original) => ({
  ...(await original()),
  fetchViaBridgeStrict: async (_env, url, options) =>
    bridge.call(new URL(url).pathname.split("/").pop(), options.body)
}));

describe.skipIf(!hasSqlite)("队列里的微盘镜像", () => {
  let h;
  let fake;
  let order;

  const message = (type, label = type) => ({
    body: { type, source: "test", payload: {}, timestamp: "2026-11-12T03:00:00.000Z" },
    ack: () => order.push(`ack:${label}`),
    retry: () => order.push(`retry:${label}`)
  });
  const run = (messages) => queue({ messages }, h.env);
  const synced = () =>
    Number(
      h.database.prepare("SELECT COUNT(*) AS n FROM doc_file WHERE mirror_status = 'synced'").get()
        .n
    );

  beforeEach(async () => {
    h = createWarehouseHarness();
    fake = createFakeWedrive();
    bridge.call = fake.call;
    order = [];
    const reply = await fake.call("space_create", { space_name: "设备资料库" });
    await saveWedriveSetting(h.env, { space_id: reply.spaceid, enabled: true }, "test");
  });

  it("一批里有三条镜像消息、60 份待镜像：只排空一次（25 份），三条都确认", async () => {
    for (let index = 0; index < 60; index += 1) h.seed.docFile({});
    await run([
      message("WAREHOUSE_DOC_MIRROR", "m1"),
      message("WAREHOUSE_DOC_MIRROR", "m2"),
      message("WAREHOUSE_DOC_MIRROR", "m3")
    ]);
    expect(synced()).toBe(25);
    expect(order).toEqual(["ack:m1", "ack:m2", "ack:m3"]);
    // 还有剩的：自己又发了一条接着跑
    expect(h.queued.filter((event) => event.type === "WAREHOUSE_DOC_MIRROR")).toHaveLength(1);
  });

  it("镜像的消息排到同一批的最后：别的消息先处理完", async () => {
    h.seed.docFile({});
    await run([
      message("WAREHOUSE_DOC_MIRROR", "mirror"),
      message("SOMETHING_ELSE", "other"),
      message("WAREHOUSE_DOC_MIRROR", "mirror2")
    ]);
    expect(order).toEqual(["ack:other", "ack:mirror", "ack:mirror2"]);
    expect(synced()).toBe(1);
  });

  it("排空抛了意料之外的错：这条消息重试，同一批里别的照常确认", async () => {
    h.seed.docFile({});
    h.hooks.beforeStatement = ({ sql }) => {
      if (sql.includes("mirror_status = 'pending'") && sql.includes("ORDER BY")) {
        throw new Error("D1 掉线");
      }
    };
    await run([message("WAREHOUSE_DOC_MIRROR", "mirror"), message("SOMETHING_ELSE", "other")]);
    expect(order).toEqual(["ack:other", "retry:mirror"]);
  });
});
