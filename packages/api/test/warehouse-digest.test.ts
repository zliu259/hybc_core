import { describe, expect, it } from "vitest";

import {
  collectDigest,
  isEmptyDigest,
  publishDailyDigestIfDue
} from "../src/services/warehouse/digest";
import { NOTICE_PAGES } from "../src/services/warehouse/notice-cards";
import { deliverWarehouseNotice, type NoticeDeps } from "../src/services/warehouse/notice-deliver";
import { saveWarehouseSettings } from "../src/services/warehouse/settings";
import type { Env } from "../src/types/env";
import { createWarehouseHarness } from "./helpers/warehouse-harness";
import { hasSqlite } from "./helpers/sqlite-d1";

// 每日摘要：内容怎么算、定时任务什么时候发、卡片长什么样。

type Harness = ReturnType<typeof createWarehouseHarness>;
type Sent = { touser: string; template_card: Record<string, unknown> };
interface Card {
  main_title: { title: string; desc: string };
  horizontal_content_list: { keyname: string; value: string }[];
  card_action: { type: number; pagepath?: string; url?: string };
}

const at = (iso: string): Date => new Date(iso);
/** 北京时间 2026-11-13 08:00:10 */
const EIGHT = at("2026-11-13T00:00:10.000Z");
const envOf = (h: Harness): Env => h.env as unknown as Env;

/** 四项各有东西的一个库 */
const seedBusy = (h: Harness) => {
  h.seed.material({ name: "水泥", spec: "P.O42.5", quantity: 1, min_stock: 5 });
  h.seed.material({ name: "膨润土", spec: "", quantity: 0, min_stock: 2 });
  h.seed.material({ name: "扳手", quantity: 10, min_stock: 5 });
  h.seed.material({ name: "没设下限的", quantity: 0 });
  h.seed.material({ name: "停用的", quantity: 0, min_stock: 5, status: "disabled" });

  const stale = h.seed.device({ device_code: "SB-0003" });
  h.seed.task({
    device_id: stale,
    kind: "inspection",
    title: "返库检查 SB-0003",
    due_date: "2026-11-12",
    created_at: "2026-11-09T00:00:00.000Z"
  });
  h.seed.task({ kind: "other", blocking: 0, title: "今天到期的", due_date: "2026-11-13" });
  h.seed.task({ kind: "other", blocking: 0, title: "早就做完的", due_date: "2026-11-01", status: "done" });
  h.seed.task({ kind: "other", blocking: 0, title: "没有期限的", due_date: null });

  const device = h.seed.device({ device_code: "SB-0001" });
  h.seed.docFile({ title: "SB-0001 合格证", doc_category: "cert", device_id: device, valid_until: "2026-11-20" });
  h.seed.docFile({ title: "泥浆泵检测报告", doc_category: "report", valid_until: "2026-11-01" });
  h.seed.docFile({ title: "没填有效期的说明书" });
};

describe.skipIf(!hasSqlite)("每日摘要的内容", () => {
  it("四项各有东西时的数字和例子", async () => {
    const h = createWarehouseHarness();
    seedBusy(h);
    const digest = await collectDigest(envOf(h), EIGHT);
    expect(digest).toEqual({
      date: "2026-11-13",
      low_stock: { count: 2, examples: ["水泥 P.O42.5", "膨润土"] },
      overdue_tasks: { count: 1, examples: ["返库检查 SB-0003"] },
      stale_inspections: { count: 1, examples: ["SB-0003"] },
      certs_soon: { count: 1, examples: ["SB-0001 合格证"] },
      certs_expired: { count: 1, examples: ["泥浆泵检测报告"] }
    });
    expect(isEmptyDigest(digest)).toBe(false);
  });

  it("空库：都是 0", async () => {
    const h = createWarehouseHarness();
    const digest = await collectDigest(envOf(h), EIGHT);
    expect(isEmptyDigest(digest)).toBe(true);
    expect(digest.low_stock).toEqual({ count: 0, examples: [] });
  });

  it("日期按北京时间算：UTC 16 点以后已经是第二天", async () => {
    const h = createWarehouseHarness();
    expect((await collectDigest(envOf(h), at("2026-11-13T15:59:59.000Z"))).date).toBe("2026-11-13");
    expect((await collectDigest(envOf(h), at("2026-11-13T16:00:00.000Z"))).date).toBe("2026-11-14");
  });

  it("待检超过 3 天：不到 3 天的、已经发往项目的、维修任务、检查已做完的都不算", async () => {
    const h = createWarehouseHarness();
    const project = h.seed.project("临河 DN1200");
    const old = "2026-11-09T00:00:00.000Z";
    const recent = h.seed.device({ device_code: "A-RECENT" });
    h.seed.task({ device_id: recent, kind: "inspection", created_at: "2026-11-10T00:00:11.000Z" });
    const edge = h.seed.device({ device_code: "B-EDGE" });
    h.seed.task({ device_id: edge, kind: "inspection", created_at: "2026-11-10T00:00:09.000Z" });
    const away = h.seed.device({ device_code: "C-AWAY", location: "project", current_project_id: project });
    h.seed.task({ device_id: away, kind: "inspection", created_at: old });
    const repair = h.seed.device({ device_code: "D-REPAIR" });
    h.seed.task({ device_id: repair, kind: "maintenance", created_at: old });
    const finished = h.seed.device({ device_code: "E-DONE" });
    h.seed.task({ device_id: finished, kind: "inspection", status: "done", created_at: old });
    const submitted = h.seed.device({ device_code: "F-SUBMITTED" });
    h.seed.task({ device_id: submitted, kind: "inspection", status: "submitted", created_at: old });

    expect((await collectDigest(envOf(h), EIGHT)).stale_inspections).toEqual({
      count: 2,
      examples: ["B-EDGE", "F-SUBMITTED"]
    });
  });

  it("证书：被替换掉的旧版、已删除的、没填有效期的不算", async () => {
    const h = createWarehouseHarness();
    const oldVersion = h.seed.docFile({ title: "旧版合格证", doc_category: "cert", valid_until: "2026-10-01" });
    h.seed.docFile({
      title: "新版合格证",
      doc_category: "cert",
      valid_until: "2027-10-01",
      supersedes_id: oldVersion
    });
    h.seed.docFile({
      title: "删掉的报告",
      doc_category: "report",
      valid_until: "2026-10-01",
      deleted_at: "2026-11-01T00:00:00.000Z"
    });
    h.seed.docFile({ title: "没填有效期" });
    const digest = await collectDigest(envOf(h), EIGHT);
    expect(digest.certs_soon.count).toBe(0);
    expect(digest.certs_expired.count).toBe(0);
  });

  it("证书：今天到期算快到期，昨天到期算已过期，第 30 天算、第 31 天不算", async () => {
    const h = createWarehouseHarness();
    h.seed.docFile({ title: "今天到期", valid_until: "2026-11-13" });
    h.seed.docFile({ title: "昨天到期", valid_until: "2026-11-12" });
    h.seed.docFile({ title: "第 30 天", valid_until: "2026-12-13" });
    h.seed.docFile({ title: "第 31 天", valid_until: "2026-12-14" });
    const digest = await collectDigest(envOf(h), EIGHT);
    expect(digest.certs_soon).toEqual({ count: 2, examples: ["今天到期", "第 30 天"] });
    expect(digest.certs_expired).toEqual({ count: 1, examples: ["昨天到期"] });
  });

  it("例子最多 3 个，数字是全部", async () => {
    const h = createWarehouseHarness();
    for (let index = 1; index <= 5; index += 1) {
      h.seed.material({ name: `缺货${index}`, quantity: 0, min_stock: 1 });
    }
    expect((await collectDigest(envOf(h), EIGHT)).low_stock).toEqual({
      count: 5,
      examples: ["缺货1", "缺货2", "缺货3"]
    });
  });
});

describe.skipIf(!hasSqlite)("每日摘要的定时发布", () => {
  const ready = async () => {
    const h = createWarehouseHarness();
    await saveWarehouseSettings(envOf(h), { notify_enabled: true }, "seed");
    h.seed.member("lz", "keeper");
    seedBusy(h);
    return h;
  };

  it("北京时间 8 点、开关开着、有库管、有内容：发一个事件，记下当天已发", async () => {
    const h = await ready();
    expect(await publishDailyDigestIfDue(envOf(h), EIGHT)).toBe("published");
    expect(h.queued).toHaveLength(1);
    expect(JSON.stringify(h.queued[0])).toContain('"daily_digest"');
    expect(JSON.stringify(h.queued[0])).toContain('"2026-11-13"');
    expect(h.kv.get("warehouse:digest:2026-11-13")).toBeTruthy();
  });

  it("同一小时再跑一次：already，不再发；第二天 8 点可以再发", async () => {
    const h = await ready();
    await publishDailyDigestIfDue(envOf(h), EIGHT);
    expect(await publishDailyDigestIfDue(envOf(h), at("2026-11-13T00:30:00.000Z"))).toBe("already");
    expect(h.queued).toHaveLength(1);
    expect(await publishDailyDigestIfDue(envOf(h), at("2026-11-14T00:00:05.000Z"))).toBe("published");
    expect(h.queued).toHaveLength(2);
  });

  it("不是 8 点：not_due，不查库", async () => {
    const h = await ready();
    let touched = 0;
    h.hooks.beforeStatement = () => {
      touched += 1;
    };
    expect(await publishDailyDigestIfDue(envOf(h), at("2026-11-12T23:59:59.000Z"))).toBe("not_due");
    expect(await publishDailyDigestIfDue(envOf(h), at("2026-11-13T01:00:00.000Z"))).toBe("not_due");
    h.hooks.beforeStatement = null;
    expect(touched).toBe(0);
    expect(h.queued).toHaveLength(0);
  });

  it("开关关着、没有库管、四项都是 0：各自的结果，都不发事件，也不占当天的名额", async () => {
    const off = createWarehouseHarness();
    off.seed.member("lz", "keeper");
    seedBusy(off);
    expect(await publishDailyDigestIfDue(envOf(off), EIGHT)).toBe("disabled");

    const nobody = createWarehouseHarness();
    await saveWarehouseSettings(envOf(nobody), { notify_enabled: true }, "seed");
    seedBusy(nobody);
    expect(await publishDailyDigestIfDue(envOf(nobody), EIGHT)).toBe("no_keeper");

    const quiet = createWarehouseHarness();
    await saveWarehouseSettings(envOf(quiet), { notify_enabled: true }, "seed");
    quiet.seed.member("lz", "keeper");
    expect(await publishDailyDigestIfDue(envOf(quiet), EIGHT)).toBe("empty");

    for (const h of [off, nobody, quiet]) {
      expect(h.queued).toHaveLength(0);
      expect(h.kv.has("warehouse:digest:2026-11-13")).toBe(false);
    }
  });

  it("发布时抛错：返回 error，不抛出，不记当天已发", async () => {
    const h = await ready();
    h.hooks.beforeStatement = (info?: { sql: string }) => {
      if (info?.sql.includes("event_log")) throw new Error("db down");
    };
    expect(await publishDailyDigestIfDue(envOf(h), EIGHT)).toBe("error");
    h.hooks.beforeStatement = null;
    expect(h.queued).toHaveLength(0);
    expect(h.kv.has("warehouse:digest:2026-11-13")).toBe(false);
  });
});

describe.skipIf(!hasSqlite)("每日摘要的卡片", () => {
  const setup = async () => {
    const h = createWarehouseHarness();
    await saveWarehouseSettings(envOf(h), { notify_enabled: true }, "seed");
    const sent: Sent[] = [];
    const deps: NoticeDeps = {
      send: async (_env, message) => {
        sent.push({ touser: message.touser, template_card: message.template_card });
        return { msgid: "m", invaliduser: null, unlicenseduser: null };
      },
      loadNames: async () => new Map(),
      resolveLinks: async () => ({ miniAppId: "wx-test", webBaseUrl: null }),
      now: () => EIGHT
    };
    const deliver = (payload: unknown, overrides: Partial<NoticeDeps> = {}) =>
      deliverWarehouseNotice(envOf(h), payload, { ...deps, ...overrides });
    return { h, sent, deliver };
  };
  const card = (message: Sent): Card => message.template_card as unknown as Card;
  const DIGEST = { kind: "daily_digest", date: "2026-11-13", actor_userid: "system" };

  it("发给全体库管一张卡片，四项都有内容，点开是库房首页", async () => {
    const { h, sent, deliver } = await setup();
    h.seed.member("kp1", "keeper");
    h.seed.member("kp2", "keeper");
    h.seed.member("doc1", "doc_admin");
    seedBusy(h);
    expect(await deliver(DIGEST)).toEqual({ sent: 1, skipped: null });
    expect(sent).toHaveLength(1);
    expect(sent[0].touser).toBe("kp1|kp2");
    expect(card(sent[0]).main_title).toEqual({ title: "库房每日摘要", desc: "11-13 有 4 项要处理" });
    expect(card(sent[0]).horizontal_content_list).toEqual([
      { keyname: "低库存", value: "2 种：水泥 P.O42.5、膨润土" },
      { keyname: "超期任务", value: "1 个：返库检查 SB-0003" },
      { keyname: "待检设备", value: "1 台超过 3 天：SB-0003" },
      { keyname: "证书", value: "1 份快到期，1 份已过期" }
    ]);
    expect(card(sent[0]).card_action).toEqual({
      type: 2,
      appid: "wx-test",
      pagepath: "pages/warehouse/index"
    });
    expect(NOTICE_PAGES.home).toBe("pages/warehouse/index");
  });

  it("只有一项有内容：只有那一行；证书只有已过期时只写已过期", async () => {
    const { h, sent, deliver } = await setup();
    h.seed.member("kp1", "keeper");
    h.seed.docFile({ title: "过期的报告", valid_until: "2026-11-01" });
    await deliver(DIGEST);
    expect(card(sent[0]).main_title.desc).toBe("11-13 有 1 项要处理");
    expect(card(sent[0]).horizontal_content_list).toEqual([{ keyname: "证书", value: "1 份已过期" }]);
  });

  it("例子太长时截断，数字留着", async () => {
    const { h, sent, deliver } = await setup();
    h.seed.member("kp1", "keeper");
    for (let index = 1; index <= 3; index += 1) {
      h.seed.material({ name: `名字特别长的物资${index}`, spec: "规格也很长", quantity: 0, min_stock: 1 });
    }
    await deliver(DIGEST);
    const value = card(sent[0]).horizontal_content_list[0].value;
    expect(value.startsWith("3 种：名字特别长的物资1")).toBe(true);
    expect(value.length).toBeLessThanOrEqual(26);
    expect(value.endsWith("…")).toBe(true);
  });

  it("Web 入口：没配小程序时点开是总览", async () => {
    const { h, sent, deliver } = await setup();
    h.seed.member("kp1", "keeper");
    seedBusy(h);
    await deliver(DIGEST, {
      resolveLinks: async () => ({ miniAppId: null, webBaseUrl: "https://web.example.com/" })
    });
    expect(card(sent[0]).card_action).toEqual({
      type: 1,
      url: "https://web.example.com/#/wh/overview"
    });
  });

  it("投递时已经没有内容了：不发，skipped 是 empty", async () => {
    const { h, sent, deliver } = await setup();
    h.seed.member("kp1", "keeper");
    expect(await deliver(DIGEST)).toEqual({ sent: 0, skipped: "empty" });
    expect(sent).toHaveLength(0);
  });

  it("没有库管：no_recipient；开关关了：disabled", async () => {
    const { h, deliver } = await setup();
    seedBusy(h);
    expect(await deliver(DIGEST)).toEqual({ sent: 0, skipped: "no_recipient" });
    await saveWarehouseSettings(envOf(h), { notify_enabled: false }, "seed");
    h.seed.member("kp1", "keeper");
    expect(await deliver(DIGEST)).toEqual({ sent: 0, skipped: "disabled" });
  });

  it("日期格式不对的消息：invalid", async () => {
    const { deliver } = await setup();
    for (const date of ["2026/11/13", "", 20261113, undefined]) {
      expect(await deliver({ kind: "daily_digest", date, actor_userid: "system" })).toEqual({
        sent: 0,
        skipped: "invalid"
      });
    }
  });

  it("发送失败：抛出让队列重试，event_log 里有一行 warehouse_notice_failed", async () => {
    const { h, deliver } = await setup();
    h.seed.member("kp1", "keeper");
    seedBusy(h);
    await expect(
      deliver(DIGEST, {
        send: async () => {
          throw new Error("企微挂了");
        }
      })
    ).rejects.toThrow("企微挂了");
    const rows = h.database
      .prepare("SELECT event_payload FROM event_log WHERE event_type = 'warehouse_notice_failed'")
      .all() as { event_payload: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].event_payload).toContain("daily_digest");
  });
});
