import { describe, expect, it, vi } from "vitest";

import { resolveWeComLinkTargets } from "../src/services/wecom-approval-push";
import { createWhDoc } from "../src/services/warehouse/doc";
import { reverseWhDoc } from "../src/services/warehouse/doc-reverse";
import { publishWarehouseNotice } from "../src/services/warehouse/notice";
import { NOTICE_PAGES } from "../src/services/warehouse/notice-cards";
import { deliverWarehouseNotice, type NoticeDeps } from "../src/services/warehouse/notice-deliver";
import { saveWarehouseSettings } from "../src/services/warehouse/settings";
import type { Env } from "../src/types/env";
import { createWarehouseHarness } from "./helpers/warehouse-harness";
import { hasSqlite } from "./helpers/sqlite-d1";

// 库房通知的投递：开关、收件人、卡片内容、失败留痕。

type Harness = ReturnType<typeof createWarehouseHarness>;
type Sent = { touser: string; template_card: Record<string, unknown> };

interface Card {
  main_title: { title: string; desc: string };
  horizontal_content_list: { keyname: string; value: string }[];
  card_action: { type: number; pagepath?: string; url?: string };
}

const setup = async (enabled = true) => {
  const h = createWarehouseHarness();
  if (enabled)
    await saveWarehouseSettings(h.env as unknown as Env, { notify_enabled: true }, "seed");
  const sent: Sent[] = [];
  const deps: NoticeDeps = {
    send: async (_env, message) => {
      sent.push({ touser: message.touser, template_card: message.template_card });
      return { msgid: "m", invaliduser: null, unlicenseduser: null };
    },
    loadNames: async () =>
      new Map([
        ["lz", "李震"],
        ["zhang", "张工"],
        ["wang", "王师傅"]
      ]),
    resolveLinks: async () => ({ miniAppId: "wx-test", webBaseUrl: null })
  };
  const deliver = (payload: unknown, overrides: Partial<NoticeDeps> = {}) =>
    deliverWarehouseNotice(h.env as unknown as Env, payload, { ...deps, ...overrides });
  return { h, sent, deliver };
};

const card = (message: Sent): Card => message.template_card as unknown as Card;
const lineOf = (message: Sent, keyname: string): string | undefined =>
  card(message).horizontal_content_list.find((line) => line.keyname === keyname)?.value;

const seedKit = (h: Harness, overrides: Record<string, unknown> = {}) => {
  const project = h.seed.project("一号工程", "zhang");
  return h.seed.kit(
    {
      project_id: project,
      title: "主清单",
      status: "submitted",
      submitted_by_userid: "zhang",
      confirmed_at: null,
      confirmed_by_userid: null,
      ...overrides
    },
    [{ name_text: "排泥钢管" }, { name_text: "注浆管" }]
  );
};

describe.skipIf(!hasSqlite)("库房通知投递", () => {
  it("开关没开不发", async () => {
    const { h, sent, deliver } = await setup(false);
    h.seed.member("lz", "keeper");
    const kitId = seedKit(h);
    expect(await deliver({ kind: "kit_submitted", kit_id: kitId, actor_userid: "zhang" })).toEqual({
      sent: 0,
      skipped: "disabled"
    });
    expect(sent).toEqual([]);
  });

  it("清单待确认发给全体库管，不含操作人", async () => {
    const { h, sent, deliver } = await setup();
    h.seed.member("lz", "keeper");
    h.seed.member("k2", "keeper");
    h.seed.member("zhang", "keeper");
    h.seed.member("docs", "doc_admin");
    const kitId = seedKit(h);
    expect(await deliver({ kind: "kit_submitted", kit_id: kitId, actor_userid: "zhang" })).toEqual({
      sent: 1,
      skipped: null
    });
    expect(sent).toHaveLength(1);
    expect(sent[0].touser).toBe("k2|lz");
    expect(card(sent[0]).main_title).toEqual({ title: "配套清单待确认", desc: "一号工程" });
    expect(card(sent[0]).card_action.pagepath).toBe(NOTICE_PAGES.kit(kitId));
    expect(lineOf(sent[0], "提交人")).toBe("张工");
    expect(lineOf(sent[0], "行数")).toBe("2 行");
    expect(lineOf(sent[0], "清单")).toContain("主清单");
  });

  it("清单已确认发给提交人；提交人就是操作人时不发", async () => {
    const { h, sent, deliver } = await setup();
    const kitId = seedKit(h, { status: "confirmed", confirmed_by_userid: "lz" });
    await deliver({ kind: "kit_confirmed", kit_id: kitId, actor_userid: "lz" });
    expect(sent).toHaveLength(1);
    expect(sent[0].touser).toBe("zhang");
    expect(card(sent[0]).main_title.title).toBe("配套清单已确认");
    expect(lineOf(sent[0], "确认人")).toBe("李震");
    expect(await deliver({ kind: "kit_confirmed", kit_id: kitId, actor_userid: "zhang" })).toEqual({
      sent: 0,
      skipped: "no_recipient"
    });
  });

  it("一个人名下多个新任务只发一张，点开是我的任务", async () => {
    const { h, sent, deliver } = await setup();
    const a = h.seed.device({ device_code: "DG-01" });
    const b = h.seed.device({ device_code: "DG-02" });
    const ids = [
      h.seed.task({ assignee_userid: "wang", device_id: a, due_date: "2026-11-20" }),
      h.seed.task({ assignee_userid: "wang", device_id: b, due_date: "2026-11-15" }),
      h.seed.task({ assignee_userid: "wang", device_id: null, due_date: null })
    ];
    await deliver({ kind: "tasks_assigned", task_ids: ids, actor_userid: "lz" });
    expect(sent).toHaveLength(1);
    expect(sent[0].touser).toBe("wang");
    expect(card(sent[0]).main_title).toEqual({ title: "库房任务：3 个待办", desc: "DG-01、DG-02" });
    expect(card(sent[0]).card_action.pagepath).toBe(NOTICE_PAGES.myTasks);
    expect(lineOf(sent[0], "最早期限")).toBe("2026-11-15");

    h.database.prepare("UPDATE wh_task SET status = 'done' WHERE id = ?").run(ids[2]);
    await deliver({ kind: "tasks_assigned", task_ids: ids, actor_userid: "lz" });
    expect(card(sent[1]).main_title.title).toBe("库房任务：2 个待办");
  });

  it("任务分属两个人各发一张，各自打开自己的任务", async () => {
    const { h, sent, deliver } = await setup();
    const device = h.seed.device({ device_code: "DG-01", name: "顶管机" });
    const first = h.seed.task({
      assignee_userid: "wang",
      device_id: device,
      kind: "inspection",
      title: "返库检查",
      due_date: "2026-11-14",
      required_photo_count: 3
    });
    const second = h.seed.task({ assignee_userid: "zhao", device_id: null, title: "整理库房" });
    await deliver({ kind: "tasks_assigned", task_ids: [first, second], actor_userid: "lz" });
    expect(sent.map((message) => message.touser)).toEqual(["wang", "zhao"]);
    expect(card(sent[0]).main_title).toEqual({ title: "库房任务：返库检查", desc: "DG-01 顶管机" });
    expect(card(sent[0]).card_action.pagepath).toBe(NOTICE_PAGES.task(first));
    expect(lineOf(sent[0], "类型")).toBe("检查");
    expect(lineOf(sent[0], "期限")).toBe("2026-11-14");
    expect(lineOf(sent[0], "照片")).toBe("至少 3 张");
    expect(card(sent[1]).main_title.desc).toBe("无设备");
    expect(lineOf(sent[1], "照片")).toBeUndefined();
    expect(card(sent[1]).card_action.pagepath).toBe(NOTICE_PAGES.task(second));
  });

  it("任务派给操作人自己、或者没有执行人，不发", async () => {
    const { h, sent, deliver } = await setup();
    const own = h.seed.task({ assignee_userid: "lz" });
    const nobody = h.seed.task({ assignee_userid: null });
    expect(
      await deliver({ kind: "tasks_assigned", task_ids: [own, nobody], actor_userid: "lz" })
    ).toEqual({ sent: 0, skipped: "no_recipient" });
    expect(sent).toEqual([]);
  });

  it("任务待确认：库管名单为空时不发也不报错", async () => {
    const { h, sent, deliver } = await setup();
    const taskId = h.seed.task({ status: "submitted", assignee_userid: "wang" });
    expect(
      await deliver({ kind: "task_submitted", task_id: taskId, actor_userid: "wang" })
    ).toEqual({
      sent: 0,
      skipped: "no_recipient"
    });
    expect(sent).toEqual([]);
  });

  it("任务待确认带执行人和检查结果", async () => {
    const { h, sent, deliver } = await setup();
    h.seed.member("lz", "keeper");
    const taskId = h.seed.task({
      status: "submitted",
      assignee_userid: "wang",
      kind: "inspection",
      result: "fail",
      title: "返库检查"
    });
    await deliver({ kind: "task_submitted", task_id: taskId, actor_userid: "wang" });
    expect(sent[0].touser).toBe("lz");
    expect(card(sent[0]).main_title).toEqual({ title: "库房任务待确认", desc: "返库检查" });
    expect(lineOf(sent[0], "执行人")).toBe("王师傅");
    expect(lineOf(sent[0], "结果")).toBe("不合格");
    expect(card(sent[0]).card_action.pagepath).toBe(NOTICE_PAGES.task(taskId));
  });

  it("任务被退回发给执行人，带退回要求", async () => {
    const { h, sent, deliver } = await setup();
    const taskId = h.seed.task({
      assignee_userid: "wang",
      title: "返库检查",
      review_note: "补一张铭牌照片"
    });
    await deliver({ kind: "task_sent_back", task_id: taskId, actor_userid: "lz" });
    expect(sent[0].touser).toBe("wang");
    expect(card(sent[0]).main_title).toEqual({ title: "任务被退回，请补充", desc: "返库检查" });
    expect(lineOf(sent[0], "要求")).toBe("补一张铭牌照片");
  });

  it("检查不合格生成的维修任务发给库管", async () => {
    const { h, sent, deliver } = await setup();
    h.seed.member("lz", "keeper");
    h.seed.member("k2", "keeper");
    const device = h.seed.device({ device_code: "DG-01", name: "顶管机" });
    const repair = h.seed.task({
      kind: "maintenance",
      source: "followup",
      device_id: device,
      description: "主轴漏油",
      assignee_userid: null
    });
    await deliver({ kind: "repair_created", task_id: repair, actor_userid: "lz" });
    expect(sent[0].touser).toBe("k2");
    expect(card(sent[0]).main_title).toEqual({
      title: "检查不合格，已生成维修任务",
      desc: "DG-01 顶管机"
    });
    expect(lineOf(sent[0], "任务")).toContain("KFR-TEST-");
    expect(lineOf(sent[0], "说明")).toBe("主轴漏油");
  });

  it("发货通知项目负责人，入库不通知", async () => {
    const { h, sent, deliver } = await setup();
    const project = h.seed.project("一号工程", "zhang");
    const pipe = h.seed.material({ kind: "turnover", quantity: 10 });
    const device = h.seed.device();
    const out = await createWhDoc(
      h.env as unknown as Env,
      {
        doc_type: "out",
        client_request_id: "notice-out-1",
        project_id: project,
        device_lines: [{ device_id: device }],
        material_lines: [{ material_id: pipe, quantity: 4 }]
      },
      "lz"
    );
    await deliver({ kind: "doc_posted", doc_id: out.id, actor_userid: "lz" });
    expect(sent).toHaveLength(1);
    expect(sent[0].touser).toBe("zhang");
    expect(card(sent[0]).main_title).toEqual({ title: "库房已发货", desc: "一号工程" });
    expect(lineOf(sent[0], "单号")).toBe(out.doc_no);
    expect(lineOf(sent[0], "设备")).toBe("1 台");
    expect(lineOf(sent[0], "物资")).toBe("1 项");
    expect(lineOf(sent[0], "经手人")).toBe("李震");
    expect(card(sent[0]).card_action.pagepath).toBe(NOTICE_PAGES.project(project));

    const inbound = await createWhDoc(
      h.env as unknown as Env,
      {
        doc_type: "inbound",
        client_request_id: "notice-in-1",
        material_lines: [{ material_id: pipe, quantity: 5 }]
      },
      "lz"
    );
    expect(await deliver({ kind: "doc_posted", doc_id: inbound.id, actor_userid: "lz" })).toEqual({
      sent: 0,
      skipped: "no_recipient"
    });
  });

  it("返库通知带报损项数", async () => {
    const { h, sent, deliver } = await setup();
    const project = h.seed.project("一号工程", "zhang");
    const pipe = h.seed.material({ kind: "turnover", quantity: 10 });
    await createWhDoc(
      h.env as unknown as Env,
      {
        doc_type: "out",
        client_request_id: "notice-out-2",
        project_id: project,
        material_lines: [{ material_id: pipe, quantity: 6 }]
      },
      "lz"
    );
    const back = await createWhDoc(
      h.env as unknown as Env,
      {
        doc_type: "back",
        client_request_id: "notice-back-2",
        project_id: project,
        material_lines: [
          { material_id: pipe, quantity: 5, outcome: "returned" },
          { material_id: pipe, quantity: 1, outcome: "lost" }
        ]
      },
      "lz"
    );
    await deliver({ kind: "doc_posted", doc_id: back.id, actor_userid: "lz" });
    expect(card(sent[0]).main_title.title).toBe("项目物资已返库");
    expect(lineOf(sent[0], "物资")).toBe("1 项");
    expect(lineOf(sent[0], "报损")).toBe("1 项");
    expect(lineOf(sent[0], "设备")).toBeUndefined();
  });

  it("转场给两个项目的负责人各发一张，没有负责人的那边不发", async () => {
    const { h, sent, deliver } = await setup();
    const from = h.seed.project("一号工程", "zhang");
    const to = h.seed.project("二号工程", "li");
    const orphan = h.seed.project("三号工程", null);
    const first = h.seed.device({ location: "project", current_project_id: from });
    const second = h.seed.device({ location: "project", current_project_id: orphan });
    const transfer = await createWhDoc(
      h.env as unknown as Env,
      {
        doc_type: "transfer",
        client_request_id: "notice-transfer-1",
        project_id: from,
        to_project_id: to,
        device_lines: [{ device_id: first }]
      },
      "lz"
    );
    await deliver({ kind: "doc_posted", doc_id: transfer.id, actor_userid: "lz" });
    expect(sent.map((message) => message.touser)).toEqual(["zhang", "li"]);
    expect(card(sent[0]).main_title).toEqual({
      title: "设备物资转场",
      desc: "一号工程 → 二号工程"
    });
    expect(card(sent[0]).card_action.pagepath).toBe(NOTICE_PAGES.project(from));
    expect(card(sent[1]).card_action.pagepath).toBe(NOTICE_PAGES.project(to));

    const lonely = await createWhDoc(
      h.env as unknown as Env,
      {
        doc_type: "transfer",
        client_request_id: "notice-transfer-2",
        project_id: orphan,
        to_project_id: to,
        device_lines: [{ device_id: second }]
      },
      "lz"
    );
    await deliver({ kind: "doc_posted", doc_id: lonely.id, actor_userid: "lz" });
    expect(sent.map((message) => message.touser)).toEqual(["zhang", "li", "li"]);
  });

  it("冲销发货单时告诉项目负责人", async () => {
    const { h, sent, deliver } = await setup();
    const project = h.seed.project("一号工程", "zhang");
    const pipe = h.seed.material({ kind: "turnover", quantity: 10 });
    const out = await createWhDoc(
      h.env as unknown as Env,
      {
        doc_type: "out",
        client_request_id: "notice-out-3",
        project_id: project,
        material_lines: [{ material_id: pipe, quantity: 4 }]
      },
      "lz"
    );
    const reversal = await reverseWhDoc(
      h.env as unknown as Env,
      out.id,
      { client_request_id: "notice-reverse-3", reason: "录错了" },
      "lz"
    );
    await deliver({ kind: "doc_posted", doc_id: reversal.id, actor_userid: "lz" });
    expect(sent[0].touser).toBe("zhang");
    expect(card(sent[0]).main_title).toEqual({ title: "库房单已冲销", desc: "一号工程" });
    expect(lineOf(sent[0], "原单")).toBe(out.doc_no);
    expect(lineOf(sent[0], "冲销单")).toBe(reversal.doc_no);
  });

  it("发送失败：留一行失败记录，再把错误抛出去让队列重试", async () => {
    const { h, deliver } = await setup();
    h.seed.member("lz", "keeper");
    const kitId = seedKit(h);
    await expect(
      deliver(
        { kind: "kit_submitted", kit_id: kitId, actor_userid: "zhang" },
        {
          send: async () => {
            throw new Error("bridge down");
          }
        }
      )
    ).rejects.toThrow("bridge down");
    const rows = h.database
      .prepare("SELECT event_source, event_payload FROM event_log WHERE event_type = ?")
      .all("warehouse_notice_failed") as { event_source: string; event_payload: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].event_source).toBe("warehouse-notice");
    expect(JSON.parse(rows[0].event_payload)).toMatchObject({
      kind: "kit_submitted",
      kit_id: kitId,
      error: "bridge down"
    });
  });

  it("不认识的消息不发也不抛", async () => {
    const { sent, deliver } = await setup();
    for (const payload of [
      null,
      "text",
      { kind: "nope", actor_userid: "a" },
      { kind: "kit_submitted", kit_id: "1", actor_userid: "a" },
      { kind: "kit_submitted", kit_id: 1 },
      { kind: "tasks_assigned", task_ids: [], actor_userid: "a" },
      { kind: "tasks_assigned", task_ids: [1, "2"], actor_userid: "a" }
    ]) {
      expect(await deliver(payload)).toEqual({ sent: 0, skipped: "invalid" });
    }
    expect(sent).toEqual([]);
  });

  it("业务行已经不在了就跳过", async () => {
    const { deliver } = await setup();
    expect(await deliver({ kind: "kit_submitted", kit_id: 99999, actor_userid: "a" })).toEqual({
      sent: 0,
      skipped: "gone"
    });
    expect(await deliver({ kind: "task_submitted", task_id: 99999, actor_userid: "a" })).toEqual({
      sent: 0,
      skipped: "gone"
    });
    expect(await deliver({ kind: "doc_posted", doc_id: 99999, actor_userid: "a" })).toEqual({
      sent: 0,
      skipped: "gone"
    });
  });

  it("两种跳转都没配时不发", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { h, sent, deliver } = await setup();
    h.seed.member("lz", "keeper");
    const kitId = seedKit(h);
    expect(
      await deliver(
        { kind: "kit_submitted", kit_id: kitId, actor_userid: "zhang" },
        { resolveLinks: async () => ({ miniAppId: null, webBaseUrl: null }) }
      )
    ).toEqual({ sent: 0, skipped: "no_link" });
    expect(sent).toEqual([]);
    warn.mockRestore();
  });

  it("通讯录取不到时卡片上显示 userid", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { h, sent, deliver } = await setup();
    h.seed.member("lz", "keeper");
    const kitId = seedKit(h);
    await deliver(
      { kind: "kit_submitted", kit_id: kitId, actor_userid: "zhang" },
      {
        loadNames: async () => {
          throw new Error("contacts down");
        }
      }
    );
    expect(lineOf(sent[0], "提交人")).toBe("zhang");
    warn.mockRestore();
  });
});

describe("库房通知发布", () => {
  it("事件日志和队列都坏了也不抛出", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = {
      DB: {
        prepare() {
          throw new Error("db down");
        }
      },
      EVENT_QUEUE: {
        send: async () => {
          throw new Error("queue down");
        }
      }
    } as unknown as Env;
    await expect(
      publishWarehouseNotice(broken, { kind: "kit_submitted", kit_id: 1 }, "zhang")
    ).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("发进队列的消息带操作人", async () => {
    const queued: unknown[] = [];
    const env = {
      DB: { prepare: () => ({ bind: () => ({ run: async () => ({ success: true }) }) }) },
      EVENT_QUEUE: {
        send: async (message: unknown) => {
          queued.push(message);
        }
      }
    } as unknown as Env;
    await publishWarehouseNotice(env, { kind: "tasks_assigned", task_ids: [3, 4] }, "lz");
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({
      type: "WAREHOUSE_NOTICE",
      source: "warehouse",
      payload: { kind: "tasks_assigned", task_ids: [3, 4], actor_userid: "lz" }
    });
  });
});

describe.skipIf(!hasSqlite)("企微卡片的跳转目标", () => {
  it("小程序取配置，Web 地址没单独配时用登录回调的域名", async () => {
    const h = createWarehouseHarness();
    const env = {
      ...h.env,
      WECOM_MINIAPP_APPID: "wx1",
      WECHAT_REDIRECT_URI: "https://web.hybcdg.com/login/callback"
    } as unknown as Env;
    expect(await resolveWeComLinkTargets(env)).toEqual({
      miniAppId: "wx1",
      webBaseUrl: "https://web.hybcdg.com"
    });
  });

  it("单独配了 Web 地址时用它，去掉结尾的斜杠", async () => {
    const h = createWarehouseHarness();
    const env = {
      ...h.env,
      WECOM_APPROVAL_WEB_BASE_URL: "https://admin.example.com/",
      WECHAT_REDIRECT_URI: "https://web.hybcdg.com/login/callback"
    } as unknown as Env;
    expect(await resolveWeComLinkTargets(env)).toEqual({
      miniAppId: null,
      webBaseUrl: "https://admin.example.com"
    });
  });

  it("都没配时两个都是 null", async () => {
    const h = createWarehouseHarness();
    expect(await resolveWeComLinkTargets(h.env as unknown as Env)).toEqual({
      miniAppId: null,
      webBaseUrl: null
    });
  });
});
