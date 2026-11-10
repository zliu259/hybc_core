import { describe, expect, it } from "vitest";

import type {
  AttachmentReviewState,
  AttachmentReviewView
} from "@/api/reimbursement";
import {
  needsRemovalReason,
  previewAttachmentRemoval,
  removalPreviewText,
  removalSuccessText
} from "./attachment-removal";

const view = (
  state: AttachmentReviewState,
  amount: number | null
): AttachmentReviewView => ({
  attachment_id: 1,
  file_key: "reimbursement/1.pdf",
  file_name: "1.pdf",
  file_size: 100,
  state,
  display_name: "1.pdf",
  amount,
  invoice_no: null,
  invoice_date: null,
  seller_name: null,
  raw_text_summary: null,
  duplicates: [],
  attention: null,
  merged_label: null
});

describe("previewAttachmentRemoval", () => {
  it("识别出金额的从报销金额里扣", () => {
    expect(previewAttachmentRemoval(view("recognized", 48.5), 148.5)).toEqual({
      kind: "deduct",
      deducted: 48.5,
      before: 148.5,
      after: 100
    });
  });

  it("最少扣到 0", () => {
    expect(previewAttachmentRemoval(view("recognized", 80), 50)).toMatchObject({
      kind: "deduct",
      after: 0
    });
  });

  it("小数不出现浮点尾巴", () => {
    expect(
      previewAttachmentRemoval(view("recognized", 0.1), 0.3)
    ).toMatchObject({ after: 0.2 });
  });

  it.each(["failed", "recognizing", "not_invoice", "no_amount"] as const)(
    "%s 的不扣",
    state => {
      expect(previewAttachmentRemoval(view(state, null), 100)).toEqual({
        kind: "no_amount"
      });
    }
  );

  it("没存报销金额的草稿跟着票面合计走", () => {
    expect(previewAttachmentRemoval(view("recognized", 30), 0)).toEqual({
      kind: "follows_total"
    });
  });
});

describe("removalPreviewText", () => {
  it("说清楚从多少改到多少", () => {
    expect(
      removalPreviewText({
        kind: "deduct",
        deducted: 48.5,
        before: 1148.5,
        after: 1100
      })
    ).toBe("报销金额会从 ¥1,148.50 改为 ¥1,100.00（减去这张的 ¥48.50）。");
  });

  it("没识别出金额时提醒去核对", () => {
    expect(removalPreviewText({ kind: "no_amount" })).toContain("不会自动改");
  });

  it("草稿不额外说明", () => {
    expect(removalPreviewText({ kind: "follows_total" })).toBeNull();
  });
});

describe("needsRemovalReason", () => {
  it.each([
    ["draft", false],
    ["unregistered", false],
    ["submitted", true],
    ["received", true]
  ])("%s → %s", (status, expected) => {
    expect(needsRemovalReason(status)).toBe(expected);
  });
});

describe("removalSuccessText", () => {
  it("扣了钱时带上新金额", () => {
    expect(
      removalSuccessText({
        deducted_amount: 40,
        amount: 100,
        precheck_reset: false
      })
    ).toBe("已删除，报销金额改为 ¥100.00");
  });

  it("没扣钱只说已删除", () => {
    expect(
      removalSuccessText({
        deducted_amount: 0,
        amount: 100,
        precheck_reset: false
      })
    ).toBe("已删除");
  });

  it("退回待复核时提醒重新复核", () => {
    expect(
      removalSuccessText({
        deducted_amount: 40,
        amount: 100,
        precheck_reset: true
      })
    ).toBe("已删除，报销金额改为 ¥100.00，需要重新复核");
  });
});
