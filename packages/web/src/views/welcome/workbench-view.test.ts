import { describe, expect, it } from "vitest";
import type { ApprovalInstance, PendingApprovalItem } from "@/api/approval";
import type { ReimbursementEnvelope } from "@/api/reimbursement";
import {
  buildApprovalItem,
  buildCommonEntries,
  buildFuelItem,
  buildGreeting,
  buildHeadline,
  buildReimbursementRow,
  buildReturnedItem,
  buildStartActions,
  fuelDeskPath,
  mergeQueue,
  queueMoreLink,
  toRoleLabel
} from "./workbench-view";

const NOW = new Date("2026-11-06T06:00:00.000Z");
const toName = (userid: string) =>
  ({ LiuPeng: "刘鹏" })[userid as "LiuPeng"] ?? userid;

const pending = (patch: Partial<PendingApprovalItem> = {}) =>
  ({
    id: 7,
    instance_no: "SP-20261102-0001",
    biz_type: "payment_request",
    biz_id: 3,
    biz_summary: "PM-20261102-0002 | 2026.9月份员工工资",
    biz_amount: 107750.91,
    project_name: "黄土岗顶管",
    initiator_userid: "LiuPeng",
    current_node_name: "财务审核",
    current_node_key: "finance",
    status: "in_progress",
    submitted_at: "2026-11-05T06:00:00.000Z",
    task_id: 1,
    task_status: "pending",
    ...patch
  }) as PendingApprovalItem;

const returned = (patch: Partial<ApprovalInstance> = {}) =>
  ({
    id: 9,
    instance_no: "SP-20261101-0002",
    biz_type: "payment_request",
    biz_id: 5,
    biz_summary: "PM-20261101-0005 | 材料款",
    status: "returned",
    submitted_at: "2026-10-20T06:00:00.000Z",
    updated_at: "2026-11-02T06:00:00.000Z",
    ...patch
  }) as ApprovalInstance;

describe("buildApprovalItem", () => {
  it("一行说清是什么、多少钱、谁发起、等了多久", () => {
    const item = buildApprovalItem(pending(), { toName, now: NOW });

    expect(item).toMatchObject({
      key: "approval-1",
      kind: "approval",
      kindLabel: "审批",
      title: "2026.9月份员工工资",
      amountText: "¥107,750.91",
      waitDays: 1,
      waitText: "等了 1 天",
      waitTone: "normal",
      actionText: "审批",
      to: "/approval/detail/7"
    });
    expect(item.metaText).toBe("付款审批  黄土岗顶管  刘鹏  财务审核");
  });

  it("等待天数决定颜色：3 天提醒，7 天告急", () => {
    const at = (iso: string) =>
      buildApprovalItem(pending({ submitted_at: iso }), { toName, now: NOW });

    expect(at("2026-11-06T01:00:00.000Z")).toMatchObject({
      waitDays: 0,
      waitText: "今天",
      waitTone: "normal"
    });
    expect(at("2026-11-04T06:00:00.000Z").waitTone).toBe("normal");
    expect(at("2026-11-03T06:00:00.000Z").waitTone).toBe("warn");
    expect(at("2026-10-30T06:00:00.000Z").waitTone).toBe("late");
  });

  it("没有摘要时用业务类型；没有金额和时间时不显示", () => {
    const item = buildApprovalItem(
      pending({
        biz_summary: "",
        biz_amount: null,
        project_name: null,
        initiator_userid: "",
        current_node_name: null,
        submitted_at: ""
      }),
      { toName, now: NOW }
    );

    expect(item.title).toBe("付款审批");
    expect(item.amountText).toBe("");
    expect(item.waitText).toBe("");
    expect(item.waitDays).toBe(0);
    expect(item.metaText).toBe("付款审批");
  });

  it("不是「单号 | 内容」的摘要原样显示", () => {
    const item = buildApprovalItem(pending({ biz_summary: "合同 A | 甲方" }), {
      toName,
      now: NOW
    });

    expect(item.title).toBe("合同 A | 甲方");
  });
});

describe("buildReturnedItem", () => {
  it("被退回的直达业务单修改页，从退回那天算等待", () => {
    const item = buildReturnedItem(returned(), {
      now: NOW,
      resolveEditRoute: () => "/workspace/payment/detail/5"
    });

    expect(item).toMatchObject({
      key: "returned-9",
      kind: "returned",
      kindLabel: "退回",
      title: "材料款",
      waitDays: 4,
      waitTone: "warn",
      actionText: "去修改",
      to: "/workspace/payment/detail/5"
    });
  });

  it("优先用最后更新时间；没有修改页时去审批详情", () => {
    const item = buildReturnedItem(
      returned({ last_updated_at: "2026-11-05T06:00:00.000Z" }),
      { now: NOW, resolveEditRoute: () => null }
    );

    expect(item.waitDays).toBe(1);
    expect(item.actionText).toBe("查看");
    expect(item.to).toBe("/approval/detail/9");
  });
});

describe("mergeQueue", () => {
  it("油卡待办排在退回之后、审批之前，只占一行", () => {
    const a = buildApprovalItem(pending(), { toName, now: NOW });
    const c = buildReturnedItem(returned(), {
      now: NOW,
      resolveEditRoute: () => null
    });
    const fuel = buildFuelItem(3, "/finance/fleet/processing");

    expect(mergeQueue([a], [c], fuel).map(item => item.kind)).toEqual([
      "returned",
      "fuel",
      "approval"
    ]);
    expect(fuel).toMatchObject({
      title: "油卡额度申请待处理",
      waitText: "3 条",
      to: "/finance/fleet/processing"
    });
  });

  it("退回的排最前（要我动手），同类里等得最久的在前", () => {
    const options = { toName, now: NOW };
    const a = buildApprovalItem(
      pending({ task_id: 1, submitted_at: "2026-11-05T06:00:00.000Z" }),
      options
    );
    const b = buildApprovalItem(
      pending({ task_id: 2, submitted_at: "2026-10-20T06:00:00.000Z" }),
      options
    );
    const c = buildReturnedItem(returned(), {
      now: NOW,
      resolveEditRoute: () => null
    });

    expect(mergeQueue([a, b], [c]).map(item => item.key)).toEqual([
      "returned-9",
      "approval-2",
      "approval-1"
    ]);
    // 不改原数组
    expect([a, b].map(item => item.key)).toEqual(["approval-1", "approval-2"]);
  });
});

describe("queueMoreLink", () => {
  const counts = { approval: 4, returned: 1, fuel: 4 };

  it("全都显示了就不提示，油卡不管几条只占一行", () => {
    expect(queueMoreLink("all", counts, 6)).toBeNull();
    expect(queueMoreLink("fuel", counts, 1)).toBeNull();
    expect(queueMoreLink("approval", counts, 4)).toBeNull();
  });

  it("还有没显示的才提示，退回的去我的申请，其他去审批中心", () => {
    expect(
      queueMoreLink("all", { approval: 20, returned: 1, fuel: 4 }, 8)
    ).toEqual({ text: "查看全部 25 条", path: "/approval/index" });
    expect(
      queueMoreLink("returned", { approval: 0, returned: 12, fuel: 0 }, 8)
    ).toEqual({ text: "查看全部 12 条", path: "/workspace/my-applications" });
  });
});

describe("buildHeadline", () => {
  it("说有几件事、最久的等了多久", () => {
    expect(buildHeadline({ total: 14, oldestDays: 10, failed: false })).toBe(
      "14 件事等你处理，最久的等了 10 天"
    );
    expect(buildHeadline({ total: 2, oldestDays: 0, failed: false })).toBe(
      "2 件事等你处理"
    );
  });

  it("没有事时直接说；没取到时不能说成没有事", () => {
    expect(buildHeadline({ total: 0, oldestDays: 0, failed: false })).toBe(
      "现在没有要你处理的事"
    );
    expect(buildHeadline({ total: 0, oldestDays: 0, failed: true })).toBe(
      "待办没有取到，请刷新重试"
    );
    expect(buildHeadline({ total: 3, oldestDays: 1, failed: true })).toBe(
      "至少 3 件事等你处理，最久的等了 1 天"
    );
  });
});

describe("buildGreeting", () => {
  it("按北京时间问候，日期跨天也按北京时间", () => {
    const at = (iso: string) => buildGreeting(new Date(iso));

    expect(at("2026-11-06T00:30:00.000Z").text).toBe("早上好");
    expect(at("2026-11-06T03:00:00.000Z").text).toBe("上午好");
    expect(at("2026-11-06T06:00:00.000Z")).toEqual({
      text: "下午好",
      dateText: "11月6日 周五"
    });
    expect(at("2026-11-06T12:00:00.000Z").text).toBe("晚上好");
    expect(at("2026-11-06T17:00:00.000Z").dateText).toBe("11月7日 周六");
  });
});

describe("入口按角色", () => {
  const keysOf = (items: { key: string }[]) => items.map(item => item.key);

  it("发起动作人人都有，报销排第一", () => {
    expect(keysOf(buildStartActions())).toEqual([
      "reimbursement",
      "payment",
      "fuel"
    ]);
  });

  it("各角色的常用入口不同，每个角色都是 8 个", () => {
    expect(buildCommonEntries(["manager"])[0].key).toBe("projects");
    expect(buildCommonEntries(["site_manager"])[0].key).toBe("managerLog");
    expect(buildCommonEntries(["finance"])[0].key).toBe("payment");
    expect(buildCommonEntries(["operator"])[0].key).toBe("operatorLog");
    ["super_admin", "manager", "site_manager", "finance", "operator"].forEach(
      role => expect(buildCommonEntries([role])).toHaveLength(8)
    );
  });

  it("只放这个角色进得去的页面，和路由的 roles 一致", () => {
    const financeKeys = keysOf(buildCommonEntries(["finance"]));
    expect(financeKeys).not.toContain("projects");
    expect(financeKeys).not.toContain("managerLog");
    expect(financeKeys).not.toContain("approvalMonitor");

    const operatorKeys = keysOf(buildCommonEntries(["operator"]));
    ["projects", "contract", "payment", "managerLog", "ledger"].forEach(key =>
      expect(operatorKeys).not.toContain(key)
    );

    const siteKeys = keysOf(buildCommonEntries(["site_manager"]));
    expect(siteKeys).not.toContain("contract");
  });

  it("多角色按权限最高的给默认顺序，没有角色时只给人人能用的", () => {
    expect(buildCommonEntries(["operator", "manager"])[0].key).toBe("projects");
    const none = keysOf(buildCommonEntries([]));
    expect(none).toContain("myApplications");
    expect(none).not.toContain("contract");
  });

  it("油卡待办去有权限的页面，看不了的角色不显示", () => {
    expect(fuelDeskPath(["finance"])).toBe("/finance/fleet/processing");
    expect(fuelDeskPath(["super_admin"])).toBe("/finance/fleet/processing");
    expect(fuelDeskPath(["manager"])).toBe("/finance/fleet/applications-all");
    expect(fuelDeskPath(["operator"])).toBeNull();
    expect(fuelDeskPath([])).toBeNull();
  });

  it("角色显示中文", () => {
    expect(toRoleLabel(["super_admin"])).toBe("超级管理员");
    expect(toRoleLabel(["manager", "finance"])).toBe("项目经理、财务人员");
    expect(toRoleLabel(["unknown"])).toBe("");
  });
});

describe("buildReimbursementRow", () => {
  const envelope = (patch: Partial<ReimbursementEnvelope> = {}) =>
    ({
      id: 5,
      project_id: 45219,
      project_name: "通州区顶管项目",
      amount: 1234.5,
      status: "submitted",
      expense_date: "2026-11-03",
      created_at: "2026-11-04T00:00:00.000Z",
      updated_at: "2026-11-04T00:00:00.000Z",
      ...patch
    }) as ReimbursementEnvelope;

  it("显示项目名、金额、日期和进度", () => {
    expect(buildReimbursementRow(envelope())).toEqual({
      id: 5,
      projectText: "通州区顶管项目",
      amountText: "¥1,234.50",
      dateText: "2026-11-03",
      statusText: "审核中",
      statusType: "primary"
    });
  });

  it("草稿是待我处理；接口没带项目名时退回项目编号", () => {
    const row = buildReimbursementRow(
      envelope({ status: "draft", project_name: null, expense_date: null })
    );

    expect(row.statusText).toBe("待提交");
    expect(row.statusType).toBe("warning");
    expect(row.projectText).toBe("项目#45219");
    expect(row.dateText).toBe("2026-11-04");
  });
});
