import { describe, expect, it } from "vitest";

import {
  MAX_AMOUNT_CHANGE_ATTACHMENTS,
  MAX_AMOUNT_CHANGE_REASON_LENGTH,
  parseAmountChangeRequest,
  readAmountChangeAttachments,
  serializeAmountChangeAttachments
} from "./contract-amount-change-request";

const validBody = {
  change_type: "adjust",
  new_amount: 260000,
  reason: "  增加二期土方量，补充协议已签  ",
  attachments: [
    {
      file_key: "contract/1760000000000-uuid-supplement.pdf",
      file_name: "补充协议.pdf",
      file_size: 20480
    }
  ]
};

const attachmentAt = (index: number) => ({
  file_key: `contract/${index}-file.pdf`,
  file_name: `附件${index}.pdf`,
  file_size: 100
});

describe("parseAmountChangeRequest", () => {
  it("trims the reason and keeps the attachments", () => {
    const result = parseAmountChangeRequest(validBody);
    expect(result).toEqual({
      ok: true,
      value: {
        change_type: "adjust",
        new_amount: 260000,
        reason: "增加二期土方量，补充协议已签",
        attachments: [
          {
            file_key: "contract/1760000000000-uuid-supplement.pdf",
            file_name: "补充协议.pdf",
            file_size: 20480
          }
        ]
      }
    });
  });

  it("treats attachments as optional", () => {
    const result = parseAmountChangeRequest({ ...validBody, attachments: undefined });
    expect(result.ok && result.value.attachments).toEqual([]);
  });

  it("rejects a blank reason", () => {
    const result = parseAmountChangeRequest({ ...validBody, reason: "   " });
    expect(result).toEqual({ ok: false, message: "请填写变更缘由" });
  });

  it("rejects a reason longer than the limit", () => {
    const result = parseAmountChangeRequest({
      ...validBody,
      reason: "长".repeat(MAX_AMOUNT_CHANGE_REASON_LENGTH + 1)
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a non-numeric new amount", () => {
    expect(parseAmountChangeRequest({ ...validBody, new_amount: "260000" }).ok).toBe(false);
    expect(parseAmountChangeRequest({ ...validBody, new_amount: Number.NaN }).ok).toBe(false);
    expect(parseAmountChangeRequest({ ...validBody, new_amount: -1 }).ok).toBe(false);
  });

  it("rejects an unknown change type", () => {
    const result = parseAmountChangeRequest({ ...validBody, change_type: "cancel" });
    expect(result.ok).toBe(false);
  });

  it("rejects a non-object body", () => {
    expect(parseAmountChangeRequest(null).ok).toBe(false);
    expect(parseAmountChangeRequest("reason").ok).toBe(false);
  });

  it("rejects attachments that are not an array", () => {
    const result = parseAmountChangeRequest({ ...validBody, attachments: "contract/a.pdf" });
    expect(result.ok).toBe(false);
  });

  it("rejects attachment keys outside the contract upload folder", () => {
    // 附件只能引用合同类目下的上传件，不能借审批页去引用 AI 文书、历史财务件等受保护目录
    for (const fileKey of [
      "legacy/fin/voucher.pdf",
      "contract-draft/a.docx",
      "contract/../legacy/a.pdf"
    ]) {
      const result = parseAmountChangeRequest({
        ...validBody,
        attachments: [{ file_key: fileKey, file_name: "a.pdf" }]
      });
      expect(result.ok).toBe(false);
    }
  });

  it("rejects an attachment without a file name", () => {
    const result = parseAmountChangeRequest({
      ...validBody,
      attachments: [{ file_key: "contract/a.pdf", file_name: "  " }]
    });
    expect(result.ok).toBe(false);
  });

  it("rejects more attachments than the limit", () => {
    const attachments = Array.from({ length: MAX_AMOUNT_CHANGE_ATTACHMENTS + 1 }, (_, index) =>
      attachmentAt(index)
    );
    const result = parseAmountChangeRequest({ ...validBody, attachments });
    expect(result.ok).toBe(false);
  });

  it("drops a duplicated file key and a missing or invalid file size", () => {
    const result = parseAmountChangeRequest({
      ...validBody,
      attachments: [
        { file_key: "contract/a.pdf", file_name: "a.pdf", file_size: -5 },
        { file_key: "contract/a.pdf", file_name: "a-again.pdf", file_size: 10 }
      ]
    });
    expect(result.ok && result.value.attachments).toEqual([
      { file_key: "contract/a.pdf", file_name: "a.pdf", file_size: null }
    ]);
  });
});

describe("amount change attachment storage", () => {
  it("stores no attachments as NULL", () => {
    expect(serializeAmountChangeAttachments([])).toBeNull();
  });

  it("round-trips stored attachments with a download path", () => {
    const stored = serializeAmountChangeAttachments([
      { file_key: "contract/a b.pdf", file_name: "补充协议.pdf", file_size: 12 }
    ]);
    expect(readAmountChangeAttachments(stored)).toEqual([
      {
        file_key: "contract/a b.pdf",
        file_name: "补充协议.pdf",
        file_size: 12,
        file_url: "/api/v1/upload/object/contract%2Fa%20b.pdf"
      }
    ]);
  });

  it("reads NULL or malformed storage as no attachments", () => {
    expect(readAmountChangeAttachments(null)).toEqual([]);
    expect(readAmountChangeAttachments("not json")).toEqual([]);
    expect(readAmountChangeAttachments('{"file_key":"contract/a.pdf"}')).toEqual([]);
  });
});
