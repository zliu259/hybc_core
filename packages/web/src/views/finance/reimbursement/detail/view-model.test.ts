import { describe, expect, it } from "vitest";

import type {
  AttachmentReviewState,
  AttachmentReviewView,
  Guidance,
  ReimbursementEnvelopeDetail,
  ReviewTotals
} from "@/api/reimbursement";
import {
  buildEnvelopeForm,
  buildEnvelopeUpdatePayload,
  buildInfoSummary,
  declaredAmountDefault,
  defaultSelection,
  formatYuan,
  isEnvelopeFormDirty,
  isProblemView,
  pickerGroupTitle,
  refreshForm,
  resolveGuidance,
  sortAttachmentViews,
  totalsDisplay,
  wholeEnvelopeDuplicates,
  withDeclaredAmount
} from "./view-model";

const view = (
  id: number,
  state: AttachmentReviewState,
  fields: Partial<AttachmentReviewView> = {}
): AttachmentReviewView => ({
  attachment_id: id,
  file_key: `reimbursement/${id}.pdf`,
  file_name: `${id}.pdf`,
  file_size: 100,
  state,
  display_name: `${id}.pdf`,
  amount: null,
  invoice_no: null,
  invoice_date: null,
  seller_name: null,
  raw_text_summary: null,
  duplicates: [],
  attention: null,
  merged_label: null,
  ...fields
});

const duplicate = {
  match_type: "invoice_no_date",
  risk_level: "high",
  summary: "重复",
  matched_envelope_id: 9
};

const guidance = (
  headline: string,
  actions: Guidance["actions"] = []
): Guidance => ({
  tone: "normal",
  headline,
  next_step: "该做什么",
  note: null,
  actions
});

const totals = (fields: Partial<ReviewTotals> = {}): ReviewTotals => ({
  attachment_count: 2,
  recognized_count: 2,
  recognizing_count: 0,
  failed_count: 0,
  no_amount_count: 0,
  not_invoice_count: 0,
  extracted_total: 100,
  declared_amount: 100,
  complete: true,
  delta: 0,
  mismatch: false,
  ...fields
});

const detail = (fields: Partial<ReimbursementEnvelopeDetail>) =>
  fields as ReimbursementEnvelopeDetail;

describe("sortAttachmentViews", () => {
  it("排序：有问题的在前，然后留意，再按金额从大到小", () => {
    const sorted = sortAttachmentViews([
      view(1, "recognized", { amount: 10 }),
      view(2, "recognized", { amount: 500 }),
      view(3, "recognized", { amount: 20, attention: "日期偏早" }),
      view(4, "failed"),
      view(5, "recognized", { amount: 1, duplicates: [duplicate] }),
      view(6, "no_amount"),
      view(7, "not_invoice"),
      view(8, "recognizing")
    ]);
    expect(sorted.map(item => item.attachment_id)).toEqual([
      5, 4, 7, 6, 3, 2, 1, 8
    ]);
  });

  it("合并文件排在有问题的后面、留意的前面", () => {
    const sorted = sortAttachmentViews([
      view(1, "recognized", { amount: 10, attention: "日期偏早" }),
      view(2, "recognized", { amount: 1, merged_label: "含 2 张发票" }),
      view(3, "no_amount"),
      view(4, "recognized", { amount: 500 })
    ]);
    expect(sorted.map(item => item.attachment_id)).toEqual([3, 2, 1, 4]);
  });

  it("低风险重复不算有问题", () => {
    const sorted = sortAttachmentViews([
      view(1, "recognized", { amount: 100 }),
      view(2, "recognized", {
        amount: 1,
        duplicates: [{ ...duplicate, risk_level: "low" }]
      })
    ]);
    expect(sorted.map(item => item.attachment_id)).toEqual([1, 2]);
  });

  it("不改原数组", () => {
    const input = [
      view(1, "recognized", { amount: 1 }),
      view(2, "recognized", { amount: 2 })
    ];
    sortAttachmentViews(input);
    expect(input[0].attachment_id).toBe(1);
  });
});

describe("defaultSelection", () => {
  it("办公室默认选有问题的；没有问题选金额最大的", () => {
    expect(
      defaultSelection(
        [view(1, "recognized", { amount: 100 }), view(2, "failed")],
        true,
        false
      )
    ).toEqual({ kind: "attachment", attachmentId: 2 });
    expect(
      defaultSelection(
        [
          view(1, "recognized", { amount: 100 }),
          view(2, "recognized", { amount: 200 })
        ],
        true,
        false
      )
    ).toEqual({ kind: "attachment", attachmentId: 2 });
  });

  it("草稿默认选报销信息", () => {
    expect(defaultSelection([view(1, "failed")], false, true)).toEqual({
      kind: "info"
    });
    expect(defaultSelection([view(1, "failed")], true, true)).toEqual({
      kind: "info"
    });
  });

  it("没有附件选报销信息", () => {
    expect(defaultSelection([], true, false)).toEqual({ kind: "info" });
  });

  it("申请人看已提交的单默认选报销信息", () => {
    expect(defaultSelection([view(1, "recognized")], false, false)).toEqual({
      kind: "info"
    });
  });
});

describe("resolveGuidance", () => {
  const both = detail({
    guidance: {
      applicant: guidance("申请人的话"),
      office: guidance("办公室的话")
    }
  });
  const context = { workspaceView: false, uploadingCount: 0, isCreate: false };

  it("工作台用 applicant；其他入口有 office 用 office；office 为 null 用 applicant", () => {
    expect(
      resolveGuidance(both, { ...context, workspaceView: true }).headline
    ).toBe("申请人的话");
    expect(resolveGuidance(both, context).headline).toBe("办公室的话");
    expect(
      resolveGuidance(
        detail({
          guidance: { applicant: guidance("申请人的话"), office: null }
        }),
        context
      ).headline
    ).toBe("申请人的话");
  });

  it("上传中覆盖结论", () => {
    const result = resolveGuidance(
      detail({
        guidance: {
          applicant: guidance("x", [
            { key: "submit", label: "提交报销" },
            { key: "rerecognize_failed", label: "重新识别" }
          ]),
          office: null
        }
      }),
      { ...context, uploadingCount: 2 }
    );
    expect(result.headline).toBe("还有 2 张发票没传完");
    expect(result.next_step).toBe("传完确认金额，就可以提交了。");
    expect(result.actions[0]).toMatchObject({ key: "submit", disabled: true });
    expect(result.actions[1].disabled).toBeUndefined();
  });

  it("新建时结论", () => {
    const result = resolveGuidance(null, { ...context, isCreate: true });
    expect(result.headline).toBe("先选项目，再把发票传上来");
    expect(result.next_step).toBe("可以一次传多张。");
    expect(result.actions).toEqual([
      { key: "submit", label: "提交报销", disabled: true }
    ]);
  });

  it("新建时传文件也提示没传完", () => {
    expect(
      resolveGuidance(null, { ...context, isCreate: true, uploadingCount: 1 })
        .headline
    ).toBe("还有 1 张发票没传完");
  });

  it("接口没有 guidance 时给中性文案", () => {
    const result = resolveGuidance(detail({}), context);
    expect(result.headline).toBe("请核对报销信息");
    expect(result.actions).toEqual([]);
  });

  it("打开已有的单、数据还没到时不说新建的话", () => {
    const result = resolveGuidance(null, context);
    expect(result.headline).toBe("正在加载…");
    expect(result.next_step).toBe("");
    expect(result.actions).toEqual([]);
  });

  it("打开已有的单失败时说清楚", () => {
    const result = resolveGuidance(null, { ...context, loadFailed: true });
    expect(result.headline).toBe("这张报销没有加载出来");
    expect(result.next_step).toBe("请刷新页面重试。");
    expect(result.tone).toBe("warn");
    expect(result.actions).toEqual([]);
  });

  it("已经有数据时后续刷新失败不改结论", () => {
    expect(
      resolveGuidance(both, { ...context, loadFailed: true }).headline
    ).toBe("办公室的话");
  });
});

describe("isProblemView", () => {
  it("合并文件算有问题", () => {
    expect(
      isProblemView(
        view(1, "recognized", { amount: 10, merged_label: "含 2 张发票" })
      )
    ).toBe(true);
    expect(isProblemView(view(1, "recognized", { amount: 10 }))).toBe(false);
  });
});

describe("declaredAmountDefault", () => {
  it("金额没改过时跟着识别合计，改过不覆盖", () => {
    expect(
      declaredAmountDefault({
        storedAmount: 0,
        extractedTotal: 120,
        touched: false,
        currentValue: 0
      })
    ).toBe(120);
    expect(
      declaredAmountDefault({
        storedAmount: 0,
        extractedTotal: 120,
        touched: true,
        currentValue: 88
      })
    ).toBe(88);
  });

  it("已保存的金额优先于识别合计", () => {
    expect(
      declaredAmountDefault({
        storedAmount: 100,
        extractedTotal: 120,
        touched: false,
        currentValue: 100
      })
    ).toBe(100);
  });
});

describe("totalsDisplay", () => {
  it("没读全显示「算不出」", () => {
    expect(
      totalsDisplay(
        totals({
          recognized_count: 0,
          extracted_total: 0,
          complete: false,
          delta: null
        })
      )
    ).toMatchObject({ extracted: "算不出", delta: null, tone: "none" });
  });

  it("部分读出显示合计和缺几个", () => {
    const result = totalsDisplay(
      totals({
        attachment_count: 3,
        recognized_count: 2,
        extracted_total: 50,
        complete: false,
        delta: null
      })
    );
    expect(result.extracted).toBe("¥50.00，另有 1 个没有金额");
    expect(result.tone).toBe("none");
  });

  it("有差额显示多或少", () => {
    expect(
      totalsDisplay(totals({ delta: 0.04, mismatch: true }))
    ).toMatchObject({
      delta: "多 ¥0.04",
      tone: "warn"
    });
    expect(totalsDisplay(totals({ delta: -1, mismatch: true }))).toMatchObject({
      delta: "少 ¥1.00",
      tone: "warn"
    });
  });

  it("一致时是绿色", () => {
    expect(totalsDisplay(totals())).toMatchObject({
      extracted: "¥100.00",
      delta: "一致",
      tone: "ok"
    });
  });

  it("申报金额总是显示", () => {
    expect(totalsDisplay(totals({ declared_amount: 1568.91 })).declared).toBe(
      "¥1,568.91"
    );
  });
});

describe("pickerGroupTitle", () => {
  it("分组标题", () => {
    expect(pickerGroupTitle([view(1, "recognized"), view(2, "failed")])).toBe(
      "发票 2 张"
    );
    expect(
      pickerGroupTitle([
        view(1, "recognized"),
        view(2, "not_invoice"),
        view(3, "failed")
      ])
    ).toBe("附件 3 个");
    expect(pickerGroupTitle([])).toBe("发票 0 张");
  });

  it("没读出金额的不一定是发票，标题说附件", () => {
    expect(pickerGroupTitle([view(1, "no_amount"), view(2, "no_amount")])).toBe(
      "附件 2 个"
    );
  });

  it("合并文件不止一张发票，标题说附件", () => {
    expect(
      pickerGroupTitle([
        view(1, "recognized", { amount: 1, merged_label: "含 11 张发票" })
      ])
    ).toBe("附件 1 个");
  });
});

describe("formatYuan", () => {
  it("两位小数加千分位", () => {
    expect(formatYuan(1568.95)).toBe("¥1,568.95");
    expect(formatYuan(2300)).toBe("¥2,300.00");
  });
});

describe("表单和轮询", () => {
  const server = detail({
    project_id: 5,
    applicant_userid: "u1",
    channel: "electronic",
    expense_date: "2026-10-01",
    amount: 0,
    category: "差旅",
    description: "出差",
    review_totals: totals({ extracted_total: 120 })
  });

  it("从详情生成表单，金额默认等于已识别合计", () => {
    expect(buildEnvelopeForm(server)).toEqual({
      project_id: 5,
      applicant_userid: "u1",
      channel: "electronic",
      bind_envelope_uuid: "",
      expense_date: "2026-10-01",
      amount: 120,
      category: "差旅",
      description: "出差"
    });
  });

  it("没动过时不算改动，自动带出的金额也不算", () => {
    const form = buildEnvelopeForm(server);
    expect(isEnvelopeFormDirty(form, form, false)).toBe(false);
    expect(isEnvelopeFormDirty({ ...form, amount: 999 }, form, false)).toBe(
      false
    );
  });

  it("改了字段算改动，手动改的金额算改动", () => {
    const form = buildEnvelopeForm(server);
    expect(
      isEnvelopeFormDirty({ ...form, category: "办公" }, form, false)
    ).toBe(true);
    expect(isEnvelopeFormDirty({ ...form, amount: 99 }, form, true)).toBe(true);
    expect(
      isEnvelopeFormDirty({ ...form, amount: form.amount }, form, true)
    ).toBe(false);
  });

  it("轮询回来没改过的表单跟着服务端", () => {
    const baseline = buildEnvelopeForm(server);
    const next = refreshForm({
      current: baseline,
      baseline,
      server: detail({ ...server, category: "办公" }),
      amountTouched: false
    });
    expect(next.category).toBe("办公");
  });

  it("轮询回来不冲掉正在填的内容", () => {
    const baseline = buildEnvelopeForm(server);
    const current = { ...baseline, description: "正在写" };
    const next = refreshForm({
      current,
      baseline,
      server: detail({ ...server, description: "服务端" }),
      amountTouched: false
    });
    expect(next.description).toBe("正在写");
  });

  it("正在填别的字段时，金额没改过仍跟着识别合计", () => {
    const baseline = buildEnvelopeForm(server);
    const next = refreshForm({
      current: { ...baseline, description: "正在写" },
      baseline,
      server: detail({
        ...server,
        review_totals: totals({ extracted_total: 200 })
      }),
      amountTouched: false
    });
    expect(next.amount).toBe(200);
    expect(next.description).toBe("正在写");
  });

  it("手动改过金额，识别结果回来不覆盖", () => {
    const baseline = buildEnvelopeForm(server);
    const next = refreshForm({
      current: { ...baseline, amount: 88 },
      baseline,
      server: detail({
        ...server,
        review_totals: totals({ extracted_total: 200 })
      }),
      amountTouched: true
    });
    expect(next.amount).toBe(88);
  });
});

describe("整单级重复", () => {
  const check = (id: number, riskLevel: string, evidence: unknown) => ({
    id,
    match_type: "fuzzy",
    risk_level: riskLevel,
    summary: "金额接近",
    matched_invoice_no: null,
    matched_envelope_id: 9,
    evidence_json:
      typeof evidence === "string" ? evidence : JSON.stringify(evidence)
  });

  it("只留阻断级且没有 attachment_id 的", () => {
    const result = wholeEnvelopeDuplicates([
      check(1, "medium", { amount: 1 }),
      check(2, "low", { amount: 1 }),
      check(3, "high", { attachment_id: 5 }),
      check(4, "high", "不是 JSON")
    ]);
    expect(result.map(item => item.id)).toEqual([1, 4]);
  });
});

describe("buildEnvelopeUpdatePayload", () => {
  const form = {
    project_id: 5,
    applicant_userid: "u1",
    channel: "electronic" as const,
    bind_envelope_uuid: "",
    expense_date: "",
    amount: 300,
    category: "差旅",
    description: ""
  };

  it("没改过的金额不写回，否则之后加发票不再跟着合计变", () => {
    expect(
      buildEnvelopeUpdatePayload(form, { includeAmount: false }).amount
    ).toBeUndefined();
  });

  it("手动改过或提交时写回", () => {
    expect(
      buildEnvelopeUpdatePayload(form, { includeAmount: true }).amount
    ).toBe(300);
  });

  it("空字段不写", () => {
    const payload = buildEnvelopeUpdatePayload(form, { includeAmount: true });
    expect(payload).toMatchObject({
      project_id: 5,
      applicant_userid: "u1",
      category: "差旅"
    });
    expect(payload.expense_date).toBeUndefined();
    expect(payload.description).toBeUndefined();
  });
});

describe("withDeclaredAmount", () => {
  it("草稿按表单里的金额比，不按还没保存的 0", () => {
    const result = withDeclaredAmount(
      totals({
        extracted_total: 450,
        declared_amount: 0,
        delta: 450,
        mismatch: true
      }),
      450
    );
    expect(result).toMatchObject({
      declared_amount: 450,
      delta: 0,
      mismatch: false
    });
    expect(totalsDisplay(result)).toMatchObject({ delta: "一致", tone: "ok" });
  });

  it("手动改过的金额和票面不同时还是显示差额", () => {
    expect(
      withDeclaredAmount(totals({ extracted_total: 100 }), 90)
    ).toMatchObject({
      declared_amount: 90,
      delta: 10,
      mismatch: true
    });
  });

  it("没读全时不比差额", () => {
    expect(
      withDeclaredAmount(
        totals({ complete: false, delta: null, extracted_total: 50 }),
        500
      )
    ).toMatchObject({ declared_amount: 500, delta: null, mismatch: false });
  });

  it("差额算到分，不留浮点尾巴", () => {
    expect(
      withDeclaredAmount(totals({ extracted_total: 1568.95 }), 1568.91).delta
    ).toBe(0.04);
  });
});

describe("buildInfoSummary", () => {
  it("金额一行，项目和填报人一行", () => {
    expect(
      buildInfoSummary({
        amount: 1568.91,
        projectName: "东莞厂房",
        applicantName: "李震"
      })
    ).toEqual({ amount: "¥1,568.91", meta: "东莞厂房 · 填报人 李震" });
  });

  it("缺项目只显示填报人", () => {
    expect(
      buildInfoSummary({ amount: 10, projectName: null, applicantName: "李震" })
        .meta
    ).toBe("填报人 李震");
  });

  it("什么都没填时提示里面有什么", () => {
    expect(
      buildInfoSummary({ amount: 0, projectName: null, applicantName: null })
    ).toEqual({ amount: "还没填金额", meta: "项目、填报人、说明" });
  });
});
