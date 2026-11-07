import { describe, expect, it } from "vitest";

import type {
  AttachmentReviewState,
  AttachmentReviewView,
  Guidance,
  ReimbursementEnvelopeDetail,
  ReviewTotals
} from "@/api/reimbursement";
import {
  declaredAmountDefault,
  defaultSelection,
  formatYuan,
  pickerGroupTitle,
  resolveGuidance,
  sortAttachmentViews,
  totalsDisplay
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
  ...fields
});

const duplicate = {
  match_type: "invoice_no_date",
  risk_level: "high",
  summary: "重复",
  matched_envelope_id: 9
};

const guidance = (headline: string, actions: Guidance["actions"] = []): Guidance => ({
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
    expect(sorted.map(item => item.attachment_id)).toEqual([5, 4, 7, 6, 3, 2, 1, 8]);
  });

  it("低风险重复不算有问题", () => {
    const sorted = sortAttachmentViews([
      view(1, "recognized", { amount: 100 }),
      view(2, "recognized", { amount: 1, duplicates: [{ ...duplicate, risk_level: "low" }] })
    ]);
    expect(sorted.map(item => item.attachment_id)).toEqual([1, 2]);
  });

  it("不改原数组", () => {
    const input = [view(1, "recognized", { amount: 1 }), view(2, "recognized", { amount: 2 })];
    sortAttachmentViews(input);
    expect(input[0].attachment_id).toBe(1);
  });
});

describe("defaultSelection", () => {
  it("办公室默认选有问题的；没有问题选金额最大的", () => {
    expect(
      defaultSelection([view(1, "recognized", { amount: 100 }), view(2, "failed")], true, false)
    ).toEqual({ kind: "attachment", attachmentId: 2 });
    expect(
      defaultSelection(
        [view(1, "recognized", { amount: 100 }), view(2, "recognized", { amount: 200 })],
        true,
        false
      )
    ).toEqual({ kind: "attachment", attachmentId: 2 });
  });

  it("草稿默认选报销信息", () => {
    expect(defaultSelection([view(1, "failed")], false, true)).toEqual({ kind: "info" });
    expect(defaultSelection([view(1, "failed")], true, true)).toEqual({ kind: "info" });
  });

  it("没有附件选报销信息", () => {
    expect(defaultSelection([], true, false)).toEqual({ kind: "info" });
  });

  it("申请人看已提交的单默认选报销信息", () => {
    expect(defaultSelection([view(1, "recognized")], false, false)).toEqual({ kind: "info" });
  });
});

describe("resolveGuidance", () => {
  const both = detail({
    guidance: { applicant: guidance("申请人的话"), office: guidance("办公室的话") }
  });
  const context = { workspaceView: false, uploadingCount: 0, isCreate: false };

  it("工作台用 applicant；其他入口有 office 用 office；office 为 null 用 applicant", () => {
    expect(resolveGuidance(both, { ...context, workspaceView: true }).headline).toBe("申请人的话");
    expect(resolveGuidance(both, context).headline).toBe("办公室的话");
    expect(
      resolveGuidance(detail({ guidance: { applicant: guidance("申请人的话"), office: null } }), context)
        .headline
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
    expect(result.actions).toEqual([{ key: "submit", label: "提交报销", disabled: true }]);
  });

  it("新建时传文件也提示没传完", () => {
    expect(resolveGuidance(null, { ...context, isCreate: true, uploadingCount: 1 }).headline).toBe(
      "还有 1 张发票没传完"
    );
  });

  it("接口没有 guidance 时给中性文案", () => {
    const result = resolveGuidance(detail({}), context);
    expect(result.headline).toBe("请核对报销信息");
    expect(result.actions).toEqual([]);
  });
});

describe("declaredAmountDefault", () => {
  it("金额没改过时跟着识别合计，改过不覆盖", () => {
    expect(
      declaredAmountDefault({ storedAmount: 0, extractedTotal: 120, touched: false, currentValue: 0 })
    ).toBe(120);
    expect(
      declaredAmountDefault({ storedAmount: 0, extractedTotal: 120, touched: true, currentValue: 88 })
    ).toBe(88);
  });

  it("已保存的金额优先于识别合计", () => {
    expect(
      declaredAmountDefault({ storedAmount: 100, extractedTotal: 120, touched: false, currentValue: 100 })
    ).toBe(100);
  });
});

describe("totalsDisplay", () => {
  it("没读全显示「算不出」", () => {
    expect(
      totalsDisplay(totals({ recognized_count: 0, extracted_total: 0, complete: false, delta: null }))
    ).toMatchObject({ extracted: "算不出", delta: null, tone: "none" });
  });

  it("部分读出显示合计和缺几个", () => {
    const result = totalsDisplay(
      totals({ attachment_count: 3, recognized_count: 2, extracted_total: 50, complete: false, delta: null })
    );
    expect(result.extracted).toBe("¥50.00，另有 1 个没有金额");
    expect(result.tone).toBe("none");
  });

  it("有差额显示多或少", () => {
    expect(totalsDisplay(totals({ delta: 0.04, mismatch: true }))).toMatchObject({
      delta: "多 ¥0.04",
      tone: "warn"
    });
    expect(totalsDisplay(totals({ delta: -1, mismatch: true }))).toMatchObject({
      delta: "少 ¥1.00",
      tone: "warn"
    });
  });

  it("一致时是绿色", () => {
    expect(totalsDisplay(totals())).toMatchObject({ extracted: "¥100.00", delta: "一致", tone: "ok" });
  });

  it("申报金额总是显示", () => {
    expect(totalsDisplay(totals({ declared_amount: 1568.91 })).declared).toBe("¥1,568.91");
  });
});

describe("pickerGroupTitle", () => {
  it("分组标题", () => {
    expect(pickerGroupTitle([view(1, "recognized"), view(2, "failed"), view(3, "no_amount")])).toBe(
      "发票 3 张"
    );
    expect(pickerGroupTitle([view(1, "recognized"), view(2, "not_invoice"), view(3, "failed")])).toBe(
      "附件 3 个"
    );
    expect(pickerGroupTitle([])).toBe("发票 0 张");
  });
});

describe("formatYuan", () => {
  it("两位小数加千分位", () => {
    expect(formatYuan(1568.95)).toBe("¥1,568.95");
    expect(formatYuan(2300)).toBe("¥2,300.00");
  });
});
