import { describe, expect, it } from "vitest";

import type { AttachmentReviewState, AttachmentReviewView } from "./attachment-state";
import { computeReviewTotals } from "./attachment-state";
import { buildEnvelopeGuidance, formatYuan, type Guidance } from "./guidance";

const VALID_UUID = "6a96f901-2c4b-4b65-8bcb-8a50d72b276c";

type EnvelopeFields = Parameters<typeof buildEnvelopeGuidance>[0]["envelope"];

const envelope = (fields: Partial<EnvelopeFields> = {}): EnvelopeFields => ({
  status: "submitted",
  channel: "electronic",
  amount: 100,
  envelope_uuid: VALID_UUID,
  precheck_status: "pending",
  precheck_comment: null,
  verification_status: "pending",
  verification_note: null,
  batch_id: null,
  duplicate_check_status: "completed",
  void_reason: null,
  ...fields
});

const view = (
  state: AttachmentReviewState,
  amount: number | null = null,
  extra: Partial<AttachmentReviewView> = {}
): AttachmentReviewView => ({
  attachment_id: 1,
  file_key: "k",
  file_name: "a.pdf",
  file_size: 1,
  state,
  display_name: "a.pdf",
  amount,
  invoice_no: null,
  invoice_date: null,
  seller_name: null,
  raw_text_summary: null,
  duplicates: [],
  attention: null,
  merged_label: null,
  ...extra
});

const duplicateView = (riskLevel = "high") =>
  view("recognized", 100, {
    duplicates: [{ match_type: "invoice_no_date", risk_level: riskLevel, summary: "重复", matched_envelope_id: 9 }]
  });

const mergedView = (label = "含 11 张发票") => view("recognized", 100, { merged_label: label });

interface Scenario {
  fields?: Partial<EnvelopeFields>;
  views?: AttachmentReviewView[];
  envelopeDuplicateCount?: number;
  einvoiceDetected?: boolean;
  batchStatus?: string | null;
  canOfficeAudit?: boolean;
}

const run = (scenario: Scenario = {}) => {
  const fields = envelope(scenario.fields);
  const views = scenario.views ?? [view("recognized", 100)];
  return buildEnvelopeGuidance({
    envelope: fields,
    views,
    totals: computeReviewTotals(views, fields.amount),
    envelopeDuplicateCount: scenario.envelopeDuplicateCount ?? 0,
    einvoiceDetected: scenario.einvoiceDetected ?? false,
    batchStatus: scenario.batchStatus ?? null,
    canOfficeAudit: scenario.canOfficeAudit ?? true
  });
};

const keys = (guidance: Guidance | null) => guidance?.actions.map((action) => action.key);

type Row = [string, Scenario, string, string, string[]];

const expectRow = (guidance: Guidance | null, headline: string, nextStep: string, actionKeys: string[]) => {
  expect(guidance?.headline).toBe(headline);
  expect(guidance?.next_step).toBe(nextStep);
  expect(keys(guidance)).toEqual(actionKeys);
};

describe("申请人的结论和提醒", () => {
  const draft: Partial<EnvelopeFields> = { status: "draft", precheck_status: "none" };
  const rows: Row[] = [
    ["unregistered", { fields: { status: "unregistered", precheck_status: "none" } }, "这个信封还没登记", "扫码绑定填报人后就能填写。", ["scan_register"]],
    ["草稿，没有附件", { fields: draft, views: [] }, "还差发票，传完就能提交", "把发票传上来，可以一次传多张。", ["submit"]],
    ["实物信封未绑定识别号", { fields: { ...draft, channel: "physical", envelope_uuid: "bad" } }, "还没绑定信封识别号", "扫码或填入识别号后才能提交。", ["scan_register"]],
    ["实物信封混入电子发票", { fields: { ...draft, channel: "physical" }, einvoiceDetected: true }, "这个实物信封里有电子发票", "请新建一张电子发票报销，或联系财务切换通道。", ["submit"]],
    ["草稿，有疑似重复", { fields: draft, views: [duplicateView(), view("recognized", 1)] }, "1 张发票疑似重复报销", "先看标出的那张，确认不是重复再提交。", ["submit"]],
    ["草稿，有识别失败", { fields: draft, views: [view("failed"), view("failed"), view("recognized", 1)] }, "2 张发票没读出来", "可以重新识别，或自己填写报销金额。", ["rerecognize_failed", "submit"]],
    ["草稿，还在识别", { fields: draft, views: [view("recognizing"), view("recognized", 1)] }, "还有 1 张发票在识别", "可以等识别完再确认金额，也可以自己填好直接提交。", ["submit"]],
    ["草稿，多张疑似重复", { fields: draft, views: [duplicateView(), duplicateView()] }, "2 张发票疑似重复报销", "先看标出的这几张，确认不是重复再提交。", ["submit"]],
    ["草稿，有附件没金额，还没填金额", { fields: { ...draft, amount: 0 }, views: [view("no_amount"), view("not_invoice"), view("recognized", 1)] }, "2 个附件没读出金额", "请自己填写报销金额，办公室会核对原件。", ["submit"]],
    ["草稿，有附件没金额，已经填了金额", { fields: { ...draft, amount: 2300 }, views: [view("no_amount"), view("no_amount")] }, "2 个附件没读出金额", "请确认报销金额 ¥2,300.00，办公室会核对原件。", ["submit"]],
    ["草稿，一个文件合并了多张发票", { fields: draft, views: [mergedView()] }, "1 个文件含 11 张发票，系统没法逐张查重", "请拆成单张重新上传，这样才能查重。", ["submit"]],
    ["草稿，多个文件合并了多张发票", { fields: draft, views: [mergedView(), mergedView("含多张发票")] }, "2 个文件各含多张发票，系统没法逐张查重", "请拆成单张重新上传，这样才能查重。", ["submit"]],
    ["草稿，全部读出", { fields: draft, views: [view("recognized", 1000), view("recognized", 568.95)] }, "2 张发票都识别了，票面合计 ¥1,568.95", "确认金额，就可以提交了。", ["submit"]],
    ["supplement", { fields: { precheck_status: "supplement", precheck_comment: "请补餐费发票。" } }, "办公室要求补充材料", "请补餐费发票，补完重新提交。", ["resubmit"]],
    ["supplement 没有原话", { fields: { precheck_status: "supplement" } }, "办公室要求补充材料", "补完重新提交。", ["resubmit"]],
    ["precheck rejected", { fields: { precheck_status: "rejected", precheck_comment: "金额不对" } }, "办公室驳回了这张报销", "金额不对，改好后可以重新提交。", ["resubmit"]],
    ["precheck rejected 没有原因", { fields: { precheck_status: "rejected" } }, "办公室驳回了这张报销", "改好后可以重新提交。", ["resubmit"]],
    ["mismatch", { fields: { verification_status: "mismatch", verification_note: "原件少一张" } }, "办公室核查发现问题", "原件少一张。等办公室联系你。", []],
    ["mismatch 没有备注", { fields: { verification_status: "mismatch" } }, "办公室核查发现问题", "等办公室联系你。", []],
    ["submitted 实物", { fields: { channel: "physical" } }, "已提交，等办公室核查", "现在不用做什么。实物信封记得寄给办公室。", []],
    ["submitted 电子发票只显示前一句", {}, "已提交，等办公室核查", "现在不用做什么。", []],
    ["received，已复核通过", { fields: { status: "received", precheck_status: "approved" } }, "办公室已复核，等待成批", "现在不用做什么。", []],
    ["received", { fields: { status: "received" } }, "办公室已签收，正在复核", "现在不用做什么。", []]
  ];

  it.each(rows)("%s", (_name, scenario, headline, nextStep, actionKeys) => {
    expectRow(run(scenario).applicant, headline, nextStep, actionKeys);
  });

  it("草稿没有附件时提交不可点", () => {
    const { applicant } = run({ fields: draft, views: [] });
    expect(applicant.actions[0].disabled).toBe(true);
  });

  it("按钮文字固定", () => {
    expect(run({ fields: draft, views: [view("failed")] }).applicant.actions).toEqual([
      { key: "rerecognize_failed", label: "重新识别" },
      { key: "submit", label: "提交报销" }
    ]);
    expect(run({ fields: { precheck_status: "supplement" } }).applicant.actions[0].label).toBe("重新提交");
    expect(run({ fields: { status: "unregistered" } }).applicant.actions[0].label).toBe("扫码登记");
  });

  it("没有被退回的单不看混入电子发票和未绑定", () => {
    expect(run({ fields: { channel: "physical" }, einvoiceDetected: true }).applicant.headline).toBe("已提交，等办公室核查");
  });
});

describe("办公室的结论和提醒", () => {
  const received: Partial<EnvelopeFields> = { status: "received" };
  const rows: Row[] = [
    ["已退回等申请人 supplement", { fields: { precheck_status: "supplement" } }, "已退回申请人，等对方补充", "现在不用做什么。", []],
    ["已退回等申请人 rejected", { fields: { precheck_status: "rejected" } }, "已退回申请人，等对方补充", "现在不用做什么。", []],
    ["mismatch", { fields: { verification_status: "mismatch", verification_note: "原件少一张" } }, "已标记核查异常", "原件少一张。和申请人核对后，可以重新签收或要求补充。", ["verify", "precheck_supplement", "precheck_reject"]],
    ["mismatch 没有备注", { fields: { verification_status: "mismatch" } }, "已标记核查异常", "和申请人核对后，可以重新签收或要求补充。", ["verify", "precheck_supplement", "precheck_reject"]],
    ["submitted，疑似重复", { views: [duplicateView(), view("recognized", 1)] }, "1 张发票疑似重复报销", "先看标出的那张，确认后再签收。", ["verify", "mark_mismatch"]],
    ["submitted，多张疑似重复", { views: [duplicateView(), duplicateView()] }, "2 张发票疑似重复报销", "先看标出的这几张，确认后再签收。", ["verify", "mark_mismatch"]],
    ["submitted，一个文件合并了多张发票", { views: [mergedView()] }, "1 个文件含 11 张发票，系统没法逐张查重", "请逐张核对原件，确认没有重复就签收，不对就标记异常。", ["verify", "mark_mismatch"]],
    ["submitted，合并文件数不出张数", { views: [mergedView("含多张发票")] }, "1 个文件含多张发票，系统没法逐张查重", "请逐张核对原件，确认没有重复就签收，不对就标记异常。", ["verify", "mark_mismatch"]],
    ["submitted，混入电子发票", { fields: { channel: "physical" }, einvoiceDetected: true }, "实物信封里有电子发票", "复核时会被拦下。可以驳回让申请人改走电子通道，财务可填理由放行。", ["verify", "mark_mismatch"]],
    ["submitted，有识别失败", { views: [view("failed"), view("failed")] }, "2 张发票没读出来", "请直接看原件，或重新识别这 2 张。", ["rerecognize_failed", "verify"]],
    ["submitted，还在识别", { views: [view("recognizing"), view("recognized", 1)] }, "还有 1 张发票在识别", "可以先看原件，识别完会自动更新。", ["verify", "mark_mismatch"]],
    ["submitted，全部没金额，有 document_type", { fields: { amount: 2300 }, views: [view("not_invoice"), view("not_invoice")] }, "2 个附件是手写收据，系统算不出合计", "请按原件核对 ¥2,300.00，没问题就签收。", ["verify", "mark_mismatch"]],
    ["submitted，全部没金额，没有 document_type", { fields: { amount: 2300 }, views: [view("no_amount"), view("not_invoice")] }, "2 个附件没读出金额，系统算不出合计", "请按原件核对 ¥2,300.00，没问题就签收。", ["verify", "mark_mismatch"]],
    ["submitted，部分没金额", { views: [view("no_amount"), view("recognized", 50)] }, "1 个附件没有金额，合计可能不全", "请按原件核对 ¥100.00，没问题就签收。", ["verify", "mark_mismatch"]],
    ["submitted，有差额，多", { fields: { amount: 1568.91 }, views: [view("recognized", 1000), view("recognized", 568.95)] }, "2 张发票都识别了，但票面合计比申报多 ¥0.04", "请核对差额，确认没问题就签收，不对就标记异常。", ["verify", "mark_mismatch"]],
    ["submitted，有差额，少", { fields: { amount: 101 }, views: [view("recognized", 100)] }, "1 张发票都识别了，但票面合计比申报少 ¥1.00", "请核对差额，确认没问题就签收，不对就标记异常。", ["verify", "mark_mismatch"]],
    ["submitted，正常", {}, "1 张发票都识别了，金额和申报一致", "核对原件没问题就签收。", ["verify", "mark_mismatch"]],
    ["received，已复核通过", { fields: { status: "received", precheck_status: "approved" } }, "已复核通过，等待成批", "到报销批次里成批送审。", ["open_batching"]],
    ["received，还在识别", { fields: received, views: [view("recognizing")] }, "已签收，还在识别", "识别完才能复核通过。", ["precheck_supplement", "precheck_reject"]],
    ["received，疑似重复", { fields: received, views: [duplicateView()] }, "已签收，但 1 张发票疑似重复", "先看标出的那张，确认不是重复才能通过。", ["precheck_approve", "precheck_supplement", "precheck_reject"]],
    ["received，多张疑似重复", { fields: received, views: [duplicateView(), duplicateView()] }, "已签收，但 2 张发票疑似重复", "先看标出的这几张，确认不是重复才能通过。", ["precheck_approve", "precheck_supplement", "precheck_reject"]],
    ["received，一个文件合并了多张发票", { fields: received, views: [mergedView()] }, "已签收，但 1 个文件含 11 张发票", "请逐张核对原件，确认没有重复再通过。", ["precheck_approve", "precheck_supplement", "precheck_reject"]],
    ["received，多个文件合并了多张发票", { fields: received, views: [mergedView(), mergedView()] }, "已签收，但 2 个文件各含多张发票", "请逐张核对原件，确认没有重复再通过。", ["precheck_approve", "precheck_supplement", "precheck_reject"]],
    ["received，混入电子发票", { fields: { status: "received", channel: "physical" }, einvoiceDetected: true }, "已签收，但实物信封里有电子发票", "驳回让申请人改走电子通道，财务可填理由放行。", ["precheck_reject", "precheck_supplement", "precheck_approve"]],
    ["received", { fields: received }, "已签收，等你复核", "确认无误就通过，缺材料就要求补充。", ["precheck_approve", "precheck_supplement", "precheck_reject"]]
  ];

  it.each(rows)("%s", (_name, scenario, headline, nextStep, actionKeys) => {
    expectRow(run(scenario).office, headline, nextStep, actionKeys);
  });

  it("按钮文字固定", () => {
    expect(run().office?.actions).toEqual([
      { key: "verify", label: "核查签收" },
      { key: "mark_mismatch", label: "标记异常" }
    ]);
    expect(run({ fields: received }).office?.actions).toEqual([
      { key: "precheck_approve", label: "复核通过" },
      { key: "precheck_supplement", label: "要求补充" },
      { key: "precheck_reject", label: "驳回" }
    ]);
    expect(run({ fields: { status: "received", precheck_status: "approved" } }).office?.actions).toEqual([
      { key: "open_batching", label: "去成批" }
    ]);
  });
});

describe("所有人的结论和提醒", () => {
  const rows: Row[] = [
    ["received，所在批次被驳回", { fields: { status: "received", batch_id: 3, precheck_status: "approved" }, batchStatus: "rejected" }, "所在批次被驳回", "办公室到批次详情处理；申请人现在不用做什么。", ["view_batch"]],
    ["batched", { fields: { status: "batched", batch_id: 3 } }, "已进入批次，审批中", "现在不用做什么。", ["view_batch"]],
    ["pending_approval", { fields: { status: "pending_approval", batch_id: 3 } }, "已进入批次，审批中", "现在不用做什么。", ["view_batch"]],
    ["approved", { fields: { status: "approved", batch_id: 3 } }, "审批通过，等待打款", "现在不用做什么。", ["view_batch"]],
    ["paid", { fields: { status: "paid", amount: 5763.75 } }, "已打款 ¥5,763.75", "流程已结束。", []],
    ["cancelled", { fields: { status: "cancelled", void_reason: "重复提交" } }, "这张报销已废止", "重复提交，不再流转。", []],
    ["rejected", { fields: { status: "rejected" } }, "这张报销已驳回", "流程已结束。", []]
  ];

  it.each(rows)("%s", (_name, scenario, headline, nextStep, actionKeys) => {
    const guidance = run(scenario);
    expectRow(guidance.applicant, headline, nextStep, actionKeys);
    expectRow(guidance.office, headline, nextStep, actionKeys);
  });

  it("没有办公室权限时 office 为 null", () => {
    expect(run({ fields: { status: "paid" }, canOfficeAudit: false }).office).toBeNull();
  });
});

describe("优先级和特殊情况", () => {
  it("优先级：重复优先于差额", () => {
    const { office } = run({ fields: { amount: 1 }, views: [duplicateView()] });
    expect(office?.headline).toBe("1 张发票疑似重复报销");
  });

  it("优先级：重复、电子发票、失败、在识别、没金额、差额", () => {
    const physical = { channel: "physical" as const };
    expect(run({ fields: physical, views: [duplicateView()], einvoiceDetected: true }).office?.headline).toContain("疑似重复");
    expect(run({ fields: physical, views: [view("failed")], einvoiceDetected: true }).office?.headline).toBe("实物信封里有电子发票");
    expect(run({ views: [view("failed"), view("recognizing")] }).office?.headline).toBe("1 张发票没读出来");
    expect(run({ views: [view("recognizing"), view("no_amount")] }).office?.headline).toBe("还有 1 张发票在识别");
    expect(run({ fields: { amount: 1 }, views: [view("no_amount"), view("recognized", 50)] }).office?.headline).toBe("1 个附件没有金额，合计可能不全");
  });

  it("合并文件的优先级：重复、失败、在识别在前，没金额和差额在后", () => {
    expect(run({ views: [duplicateView(), mergedView()] }).office?.headline).toBe("1 张发票疑似重复报销");
    expect(run({ views: [view("failed"), mergedView()] }).office?.headline).toBe("1 张发票没读出来");
    expect(run({ views: [view("recognizing"), mergedView()] }).office?.headline).toBe("还有 1 张发票在识别");
    expect(run({ views: [view("no_amount"), mergedView()] }).office?.headline).toBe("1 个文件含 11 张发票，系统没法逐张查重");
    expect(run({ fields: { amount: 1 }, views: [mergedView()] }).office?.headline).toBe("1 个文件含 11 张发票，系统没法逐张查重");
    expect(
      run({ views: [view("no_amount", null, { merged_label: "含 3 张发票" })] }).office?.headline
    ).toBe("1 个文件含 3 张发票，系统没法逐张查重");
  });

  it("合并文件金额对得上也不说都识别了", () => {
    const { office } = run({ fields: { amount: 1954.9 }, views: [view("recognized", 1954.9, { merged_label: "含 11 张发票" })] });
    expect(office?.headline).not.toContain("都识别了");
    expect(office?.tone).toBe("warn");
    expect(office?.actions.map((action) => action.key)).toEqual(["verify", "mark_mismatch"]);
  });

  it("已提交后申请人不用因为合并文件再做什么", () => {
    expect(run({ views: [mergedView()] }).applicant.headline).toBe("已提交，等办公室核查");
  });

  it("批次被驳回优先于已复核", () => {
    const { applicant, office } = run({
      fields: { status: "received", precheck_status: "approved", batch_id: 3 },
      batchStatus: "rejected"
    });
    expect(applicant.headline).toBe("所在批次被驳回");
    expect(office?.headline).toBe("所在批次被驳回");
  });

  it("批次没有被驳回时按原来的表", () => {
    expect(
      run({ fields: { status: "received", precheck_status: "approved", batch_id: 3 }, batchStatus: "draft" }).office?.headline
    ).toBe("已复核通过，等待成批");
  });

  it("草稿和未登记 office 为 null", () => {
    expect(run({ fields: { status: "draft" } }).office).toBeNull();
    expect(run({ fields: { status: "unregistered" } }).office).toBeNull();
  });

  it("不能自审时 office 为 null", () => {
    expect(run({ canOfficeAudit: false }).office).toBeNull();
  });

  describe("只有整单级重复时说法不同", () => {
    it("办公室已提交", () => {
      const { office } = run({ envelopeDuplicateCount: 1 });
      expect(office?.headline).toBe("这张报销疑似和其他报销重复");
      expect(office?.next_step).toBe("先看报销信息里列出的记录，确认后再签收。");
    });

    it("办公室已签收", () => {
      const { office } = run({ fields: { status: "received" }, envelopeDuplicateCount: 2 });
      expect(office?.headline).toBe("这张报销疑似和其他报销重复");
      expect(office?.next_step).toBe("先看报销信息里列出的记录，确认不是重复才能通过。");
    });

    it("申请人草稿", () => {
      const { applicant } = run({ fields: { status: "draft" }, envelopeDuplicateCount: 1 });
      expect(applicant.headline).toBe("这张报销疑似和其他报销重复");
      expect(applicant.next_step).toBe("先看报销信息里列出的记录，确认不是重复再提交。");
    });

    it("同时有发票级重复时按发票说", () => {
      expect(run({ views: [duplicateView()], envelopeDuplicateCount: 1 }).office?.headline).toBe("1 张发票疑似重复报销");
    });
  });

  it("低风险的重复不算", () => {
    expect(run({ views: [duplicateView("low")] }).office?.headline).toBe("1 张发票都识别了，金额和申报一致");
  });

  it("废止没有原因只显示后一句", () => {
    expect(run({ fields: { status: "cancelled" } }).applicant.next_step).toBe("不再流转。");
  });

  it("留意只进 office.note，不改结论", () => {
    const { applicant, office } = run({
      views: [view("recognized", 100, { attention: "开票日期偏早" }), view("recognized", 0.01, { attention: "销售方不相关" })],
      fields: { amount: 100.01 }
    });
    expect(office?.headline).toBe("2 张发票都识别了，金额和申报一致");
    expect(office?.note).toBe("需要留意：开票日期偏早；销售方不相关");
    expect(applicant.note).toBeNull();
  });

  it("没有留意时 note 是 null", () => {
    expect(run().office?.note).toBeNull();
  });

  it("历史已付款老单没有识别行不报错", () => {
    const { applicant, office } = run({
      fields: { status: "paid", amount: 200 },
      views: [view("not_recognized"), view("not_recognized")]
    });
    expect(applicant.headline).toBe("已打款 ¥200.00");
    expect(office?.headline).toBe("已打款 ¥200.00");
  });

  it("已签收的历史单没有识别行不报错", () => {
    expect(run({ fields: { status: "received" }, views: [] }).office?.headline).toBe("已签收，等你复核");
  });

  it("已提交但没有附件不说金额一致", () => {
    const { office } = run({ views: [] });
    expect(office?.headline).not.toContain("一致");
    expect(office?.headline).toBe("这张报销没有附件");
  });

  describe("tone", () => {
    it.each<[string, Scenario, "normal" | "warn" | "done"]>([
      ["重复", { views: [duplicateView()] }, "warn"],
      ["电子发票", { fields: { channel: "physical" }, einvoiceDetected: true }, "warn"],
      ["失败", { views: [view("failed")] }, "warn"],
      ["没金额", { views: [view("no_amount")] }, "warn"],
      ["差额", { fields: { amount: 1 } }, "warn"],
      ["异常", { fields: { verification_status: "mismatch" } }, "warn"],
      ["批次被驳回", { fields: { status: "received", batch_id: 3 }, batchStatus: "rejected" }, "warn"],
      ["驳回", { fields: { status: "rejected" } }, "warn"],
      ["还在识别", { views: [view("recognizing")] }, "normal"],
      ["正常", {}, "normal"],
      ["已打款", { fields: { status: "paid" } }, "done"],
      ["已废止", { fields: { status: "cancelled" } }, "done"]
    ])("办公室 %s", (_name, scenario, tone) => {
      expect(run(scenario).office?.tone).toBe(tone);
    });

    it("申请人被驳回和核查异常是 warn，已提交是 normal", () => {
      expect(run({ fields: { precheck_status: "rejected" } }).applicant.tone).toBe("warn");
      expect(run({ fields: { verification_status: "mismatch" } }).applicant.tone).toBe("warn");
      expect(run().applicant.tone).toBe("normal");
    });
  });
});

describe("formatYuan", () => {
  it.each([
    [1568.95, "¥1,568.95"],
    [0.04, "¥0.04"],
    [2300, "¥2,300.00"],
    [1234567.5, "¥1,234,567.50"]
  ])("%d → %s", (value, text) => {
    expect(formatYuan(value)).toBe(text);
  });
});
