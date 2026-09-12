import { describe, expect, it } from "vitest";

import {
  matchInvoiceTitleEntity,
  normalizeInvoiceTitle,
  pickBuyerNameFromReviews,
  readInvoiceExtractionText,
  resolveOcrTitleUpdate
} from "./reimbursement-invoice-title-policy";

const entities = [
  { id: 6, entity_name: "廊坊市丰畅市政工程有限公司", status: "active" },
  { id: 11, entity_name: "北京鑫丰畅建设有限公司", status: "active" },
  { id: 12, entity_name: "恒越百川（北京）建设科技有限公司", status: "active" },
  { id: 5, entity_name: "test", status: "deleted" }
];

describe("normalizeInvoiceTitle", () => {
  it("去掉半角/全角空白并把半角括号转成全角", () => {
    expect(normalizeInvoiceTitle(" 恒越百川(北京) 建设科技　有限公司 ")).toBe(
      "恒越百川（北京）建设科技有限公司"
    );
  });

  it("空值与非字符串返回 null", () => {
    expect(normalizeInvoiceTitle("   ")).toBeNull();
    expect(normalizeInvoiceTitle(null)).toBeNull();
    expect(normalizeInvoiceTitle(12)).toBeNull();
  });
});

describe("matchInvoiceTitleEntity", () => {
  it("归一化后唯一命中 active 主体", () => {
    expect(matchInvoiceTitleEntity("恒越百川(北京)建设科技有限公司", entities)).toEqual({
      entityId: 12,
      name: "恒越百川(北京)建设科技有限公司"
    });
  });

  it("未命中时保留原文、id 为 null", () => {
    expect(matchInvoiceTitleEntity("刘相余", entities)).toEqual({ entityId: null, name: "刘相余" });
  });

  it("非 active 主体不参与匹配", () => {
    expect(matchInvoiceTitleEntity("test", entities).entityId).toBeNull();
  });

  it("多主体同名时不写 id", () => {
    const dup = [...entities, { id: 99, entity_name: "北京鑫丰畅建设有限公司", status: "active" }];
    expect(matchInvoiceTitleEntity("北京鑫丰畅建设有限公司", dup).entityId).toBeNull();
  });

  it("空输入返回全 null", () => {
    expect(matchInvoiceTitleEntity(null, entities)).toEqual({ entityId: null, name: null });
  });

  it("英文抬头不匹配任何主体", () => {
    const en = "Hengyuebaichuan (Beijing) Construction Technology Co., Ltd.";
    expect(matchInvoiceTitleEntity(en, entities)).toEqual({ entityId: null, name: en });
  });

  it("廊坊丰畅精确命中主体 6", () => {
    expect(matchInvoiceTitleEntity("廊坊市丰畅市政工程有限公司", entities).entityId).toBe(6);
  });
});

describe("readInvoiceExtractionText / pickBuyerNameFromReviews", () => {
  const rows = [
    { task_status: "completed", extraction_json: JSON.stringify({ buyer_name: "  " }) },
    { task_status: "failed", extraction_json: JSON.stringify({ buyer_name: "失败行不算" }) },
    {
      task_status: "completed",
      extraction_json: JSON.stringify({ buyer_name: "北京鑫丰畅建设有限公司" })
    },
    { task_status: "completed", extraction_json: "not json" }
  ];

  it("readInvoiceExtractionText 只返回非空字符串字段", () => {
    expect(readInvoiceExtractionText(rows[2].extraction_json, "buyer_name")).toBe(
      "北京鑫丰畅建设有限公司"
    );
    expect(readInvoiceExtractionText(rows[0].extraction_json, "buyer_name")).toBeNull();
    expect(readInvoiceExtractionText("not json", "buyer_name")).toBeNull();
    expect(readInvoiceExtractionText(null, "buyer_name")).toBeNull();
  });

  it("优先取指定的 bestRow（仅当其为完成行），其次取第一条有抬头的完成行", () => {
    const preferredRow = {
      task_status: "completed",
      extraction_json: JSON.stringify({ buyer_name: "廊坊市丰畅市政工程有限公司" })
    };
    expect(pickBuyerNameFromReviews([...rows, preferredRow], preferredRow)).toBe(
      "廊坊市丰畅市政工程有限公司"
    );
    // preferred 无抬头 → 回退到第一条有抬头的完成行
    expect(pickBuyerNameFromReviews(rows, rows[0])).toBe("北京鑫丰畅建设有限公司");
    // preferred 不是完成行 → 忽略它
    const failedPreferred = {
      task_status: "failed",
      extraction_json: JSON.stringify({ buyer_name: "失败行不算" })
    };
    expect(pickBuyerNameFromReviews([...rows, failedPreferred], failedPreferred)).toBe(
      "北京鑫丰畅建设有限公司"
    );
    expect(pickBuyerNameFromReviews(rows, null)).toBe("北京鑫丰畅建设有限公司");
  });

  it("没有任何抬头时返回 null", () => {
    expect(pickBuyerNameFromReviews([rows[0], rows[1], rows[3]], null)).toBeNull();
  });
});

describe("resolveOcrTitleUpdate", () => {
  const matched = { entityId: 11, name: "北京鑫丰畅建设有限公司" };

  it("手工指定过的信封永不被 OCR 覆盖", () => {
    expect(
      resolveOcrTitleUpdate(
        { invoice_title_source: "manual" },
        { buyerName: "x", pendingCount: 0 },
        matched
      )
    ).toBeNull();
  });

  it("仍有识别任务进行中时不动", () => {
    expect(
      resolveOcrTitleUpdate(
        { invoice_title_source: null },
        { buyerName: null, pendingCount: 2 },
        matched
      )
    ).toBeNull();
  });

  it("本轮全部完成但没有抬头 → 清空", () => {
    expect(
      resolveOcrTitleUpdate(
        { invoice_title_source: "ocr" },
        { buyerName: null, pendingCount: 0 },
        { entityId: null, name: null }
      )
    ).toEqual({ entityId: null, name: null, source: null });
  });

  it("有抬头 → 写入匹配结果，来源 ocr", () => {
    expect(
      resolveOcrTitleUpdate(
        { invoice_title_source: null },
        { buyerName: "北京鑫丰畅建设有限公司", pendingCount: 0 },
        matched
      )
    ).toEqual({ entityId: 11, name: "北京鑫丰畅建设有限公司", source: "ocr" });
  });

  it("识别未完成时即使已有抬头也不写", () => {
    expect(
      resolveOcrTitleUpdate(
        { invoice_title_source: null },
        { buyerName: "北京鑫丰畅建设有限公司", pendingCount: 1 },
        matched
      )
    ).toBeNull();
  });

  it("识别到个人名/第三方：保留原文、不绑主体，来源仍是 ocr（区别于清空）", () => {
    expect(
      resolveOcrTitleUpdate(
        { invoice_title_source: null },
        { buyerName: "刘相余", pendingCount: 0 },
        matchInvoiceTitleEntity("刘相余", entities)
      )
    ).toEqual({ entityId: null, name: "刘相余", source: "ocr" });
  });
});
