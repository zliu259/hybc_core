import { describe, expect, it } from "vitest";

import {
  buildAttachmentViews,
  computeReviewTotals,
  type AttachmentReviewState,
  type AttachmentReviewView
} from "./attachment-state";
import type { InvoiceReviewRow } from "./review-helpers";
import type { EnvelopeAttachment, ReimbursementDuplicateCheck } from "../../types/reimbursement";

const attachment = (id: number, fields: Partial<EnvelopeAttachment> = {}): EnvelopeAttachment => ({
  id,
  envelope_id: 1,
  attachment_type: "invoice",
  file_key: `reimbursement/${id}.pdf`,
  file_name: `${id}.pdf`,
  file_size: 100,
  invoice_no: null,
  amount: null,
  issue_date: null,
  status: "active",
  created_at: "2026-11-06T00:00:00.000Z",
  ...fields
});

const review = (id: number, attachmentId: number, fields: Partial<InvoiceReviewRow> = {}): InvoiceReviewRow => ({
  id,
  attachment_id: attachmentId,
  review_round: 1,
  task_id: id + 100,
  task_status: "completed",
  extraction_json: null,
  qr_text: null,
  qr_hash: null,
  invoice_unique_no: null,
  invoice_no: null,
  invoice_date: null,
  invoice_amount: null,
  source: "ocr_text",
  risk_level: "low",
  risk_hint: null,
  ...fields
});

const duplicate = (fields: Partial<ReimbursementDuplicateCheck>): ReimbursementDuplicateCheck => ({
  id: 1,
  envelope_id: 1,
  matched_envelope_id: 9,
  matched_invoice_no: null,
  match_type: "invoice_no_date",
  match_score: 1,
  risk_level: "high",
  summary: "重复",
  evidence_json: null,
  created_at: "2026-11-06T00:00:00.000Z",
  ...fields
});

const build = (
  attachments: EnvelopeAttachment[],
  reviews: InvoiceReviewRow[],
  overrides: Partial<Parameters<typeof buildAttachmentViews>[0]> = {}
) =>
  buildAttachmentViews({
    attachments,
    reviews,
    duplicates: [],
    anomalies: [],
    envelopeStatus: "submitted",
    ...overrides
  });

const viewOf = (state: AttachmentReviewState, amount: number | null = null): AttachmentReviewView => ({
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
  attention: null
});

const viewsWithAmounts = (amounts: number[]) => amounts.map((amount) => viewOf("recognized", amount));
const viewsWithStates = (states: AttachmentReviewState[]) => states.map((state) => viewOf(state));

describe("computeReviewTotals", () => {
  it("322：全部读出，票面比申报多 0.04", () => {
    const totals = computeReviewTotals(viewsWithAmounts([1000, 568.95]), 1568.91);
    expect(totals).toMatchObject({
      complete: true,
      delta: 0.04,
      mismatch: true,
      extracted_total: 1568.95,
      declared_amount: 1568.91,
      recognized_count: 2,
      attachment_count: 2
    });
  });

  it("327：没读全时不比差额", () => {
    const totals = computeReviewTotals(viewsWithStates(["not_invoice", "not_invoice"]), 2300);
    expect(totals).toMatchObject({
      complete: false,
      delta: null,
      mismatch: false,
      extracted_total: 0,
      not_invoice_count: 2
    });
  });

  it("金额一致时没有差额", () => {
    expect(computeReviewTotals(viewsWithAmounts([0.1, 0.2]), 0.3)).toMatchObject({
      complete: true,
      delta: 0,
      mismatch: false
    });
  });

  it("差额在 0.01 以内不算不一致", () => {
    expect(computeReviewTotals(viewsWithAmounts([100.01]), 100)).toMatchObject({ delta: 0.01, mismatch: false });
  });

  it("没有附件不算读全", () => {
    expect(computeReviewTotals([], 100)).toMatchObject({ complete: false, delta: null, attachment_count: 0 });
  });

  it("各状态分别计数，合计只加已识别", () => {
    const totals = computeReviewTotals(
      [
        viewOf("recognized", 10),
        viewOf("recognizing"),
        viewOf("failed"),
        viewOf("no_amount"),
        viewOf("not_invoice")
      ],
      10
    );
    expect(totals).toMatchObject({
      recognized_count: 1,
      recognizing_count: 1,
      failed_count: 1,
      no_amount_count: 1,
      not_invoice_count: 1,
      extracted_total: 10,
      complete: false,
      mismatch: false
    });
  });
});

describe("buildAttachmentViews", () => {
  it("金额大于 0 算已识别，并带上发票字段", () => {
    const [view] = build(
      [attachment(1)],
      [
        review(1, 1, {
          invoice_amount: 88.5,
          invoice_no: "123",
          invoice_date: "2026-10-01",
          extraction_json: JSON.stringify({ seller_name: "某酒店" })
        })
      ]
    );
    expect(view).toMatchObject({
      state: "recognized",
      amount: 88.5,
      invoice_no: "123",
      invoice_date: "2026-10-01",
      seller_name: "某酒店",
      display_name: "某酒店"
    });
  });

  it("金额 0 算没读到", () => {
    const [view] = build([attachment(1)], [review(1, 1, { invoice_amount: 0 })]);
    expect(view.state).toBe("no_amount");
    expect(view.amount).toBeNull();
  });

  it("document_type 是 receipt 算 not_invoice，并带 raw_text_summary", () => {
    const [view] = build(
      [attachment(1)],
      [
        review(1, 1, {
          extraction_json: JSON.stringify({ document_type: "receipt", raw_text_summary: "手写收据 300 元" })
        })
      ]
    );
    expect(view.state).toBe("not_invoice");
    expect(view.raw_text_summary).toBe("手写收据 300 元");
  });

  it("document_type 是 invoice 但没有金额算 no_amount", () => {
    const [view] = build(
      [attachment(1)],
      [review(1, 1, { extraction_json: JSON.stringify({ document_type: "invoice" }) })]
    );
    expect(view.state).toBe("no_amount");
  });

  it("有金额的收据也算已识别", () => {
    const [view] = build(
      [attachment(1)],
      [review(1, 1, { invoice_amount: 300, extraction_json: JSON.stringify({ document_type: "receipt" }) })]
    );
    expect(view.state).toBe("recognized");
  });

  it("没有识别行：已过 received 是 not_recognized，否则 recognizing", () => {
    expect(build([attachment(1)], [], { envelopeStatus: "paid" })[0].state).toBe("not_recognized");
    expect(build([attachment(1)], [], { envelopeStatus: "approved" })[0].state).toBe("not_recognized");
    expect(build([attachment(1)], [], { envelopeStatus: "submitted" })[0].state).toBe("recognizing");
    expect(build([attachment(1)], [], { envelopeStatus: "draft" })[0].state).toBe("recognizing");
  });

  it("识别还没结束算 recognizing", () => {
    for (const task_status of ["pending", "assigned", "running"]) {
      expect(build([attachment(1)], [review(1, 1, { task_status })])[0].state).toBe("recognizing");
    }
  });

  it("failed 和 timeout 行都显示 failed", () => {
    expect(build([attachment(1)], [review(1, 1, { task_status: "failed" })])[0].state).toBe("failed");
    expect(build([attachment(1)], [review(1, 1, { task_status: "timeout" })])[0].state).toBe("failed");
  });

  it("每个附件只取一行，不把负轮次算进来", () => {
    const views = build(
      [attachment(1)],
      [
        review(1, 1, { review_round: -1, invoice_amount: 999 }),
        review(2, 1, { review_round: 1, invoice_amount: 10 }),
        review(3, 1, { review_round: 2, invoice_amount: 20 })
      ]
    );
    expect(views).toHaveLength(1);
    expect(views[0].amount).toBe(20);
  });

  it("新一轮还没有这个附件的行时算 recognizing，不用旧轮结果", () => {
    const views = build(
      [attachment(1), attachment(2)],
      [
        review(1, 1, { review_round: 1, invoice_amount: 10 }),
        review(2, 2, { review_round: 2, invoice_amount: 20 })
      ]
    );
    expect(views[0].state).toBe("recognizing");
    expect(views[1].state).toBe("recognized");
  });

  it("已删附件不在列表里", () => {
    const views = build([attachment(1)], [review(1, 1, { invoice_amount: 10 }), review(2, 2, { invoice_amount: 20 })]);
    expect(views.map((view) => view.attachment_id)).toEqual([1]);
  });

  it("历史数据 extraction_json 为空或不是 JSON 不抛错", () => {
    expect(build([attachment(1)], [review(1, 1, { extraction_json: null })])[0].state).toBe("no_amount");
    expect(build([attachment(1)], [review(1, 1, { extraction_json: "not json" })])[0].state).toBe("no_amount");
  });

  it("显示名依次用销售方、文件名、附件编号", () => {
    expect(build([attachment(1, { file_name: "票.pdf" })], [])[0].display_name).toBe("票.pdf");
    expect(build([attachment(1, { file_name: null })], [])[0].display_name).toBe("附件 1");
  });

  it("重复记录按 evidence 归到对应附件，同单重复两张都标，整单级的不归", () => {
    const views = build([attachment(1), attachment(2), attachment(3)], [], {
      duplicates: [
        duplicate({ id: 1, evidence_json: JSON.stringify({ attachment_id: 1 }), summary: "和别单重复" }),
        duplicate({
          id: 2,
          match_type: "same_envelope",
          evidence_json: JSON.stringify({ attachment_id: 2, other_attachment_id: 3 }),
          summary: "同单重复"
        }),
        duplicate({ id: 3, match_type: "fuzzy", evidence_json: JSON.stringify({ amount: 10 }), summary: "金额接近" }),
        duplicate({ id: 4, evidence_json: "not json" })
      ]
    });
    expect(views[0].duplicates.map((item) => item.summary)).toEqual(["和别单重复"]);
    expect(views[1].duplicates.map((item) => item.match_type)).toEqual(["same_envelope"]);
    expect(views[2].duplicates.map((item) => item.match_type)).toEqual(["same_envelope"]);
  });

  it("只有 medium、high 且带附件编号的 AI 提醒才打留意", () => {
    const views = build([attachment(1), attachment(2), attachment(3)], [], {
      anomalies: [
        { attachment_id: 1, level: "low", reason: "轻微" },
        { attachment_id: 2, level: "medium", reason: "日期异常" },
        { attachment_id: null, level: "high", reason: "整单" }
      ]
    });
    expect(views.map((view) => view.attention)).toEqual([null, "日期异常", null]);
  });
});
