import { describe, expect, it } from "vitest";

import { summarizeBatchTitles, validateMixedTitleReason } from "./reimbursement-batch-title-policy";

describe("summarizeBatchTitles", () => {
  it("空集合 → empty", () => {
    expect(summarizeBatchTitles([])).toEqual({ kind: "empty", entityId: null, counts: [] });
  });

  it("全部同一主体 → uniform，带该主体 id", () => {
    const summary = summarizeBatchTitles([
      { invoice_title_entity_id: 11, invoice_title_name: "北京鑫丰畅建设有限公司" },
      { invoice_title_entity_id: 11, invoice_title_name: "北京鑫丰畅建设有限公司" }
    ]);
    expect(summary.kind).toBe("uniform");
    expect(summary.entityId).toBe(11);
    expect(summary.counts).toEqual([{ entity_id: 11, name: "北京鑫丰畅建设有限公司", count: 2 }]);
  });

  it("全部未识别 → unknown，不算混合", () => {
    const summary = summarizeBatchTitles([
      { invoice_title_entity_id: null, invoice_title_name: null },
      { invoice_title_entity_id: null, invoice_title_name: "刘相余" }
    ]);
    expect(summary.kind).toBe("unknown");
    expect(summary.entityId).toBeNull();
    expect(summary.counts).toEqual([{ entity_id: null, name: "刘相余", count: 2 }]);
  });

  it("两个主体 → mixed，计数按数量降序", () => {
    const summary = summarizeBatchTitles([
      { invoice_title_entity_id: 6, invoice_title_name: "廊坊市丰畅市政工程有限公司" },
      { invoice_title_entity_id: 11, invoice_title_name: "北京鑫丰畅建设有限公司" },
      { invoice_title_entity_id: 11, invoice_title_name: "北京鑫丰畅建设有限公司" }
    ]);
    expect(summary.kind).toBe("mixed");
    expect(summary.entityId).toBeNull();
    expect(summary.counts.map((c) => [c.entity_id, c.count])).toEqual([
      [11, 2],
      [6, 1]
    ]);
  });

  it("已识别 + 未识别 → mixed", () => {
    expect(
      summarizeBatchTitles([
        { invoice_title_entity_id: 11, invoice_title_name: "北京鑫丰畅建设有限公司" },
        { invoice_title_entity_id: null, invoice_title_name: null }
      ]).kind
    ).toBe("mixed");
  });
});

describe("validateMixedTitleReason", () => {
  it("2–200 字（去空白后）有效并返回裁剪值", () => {
    expect(validateMixedTitleReason("  两家公司  ")).toBe("两家公司");
  });

  it("过短、过长、非字符串无效", () => {
    expect(validateMixedTitleReason("短")).toBeNull();
    expect(validateMixedTitleReason("长".repeat(201))).toBeNull();
    expect(validateMixedTitleReason(undefined)).toBeNull();
    expect(validateMixedTitleReason(12)).toBeNull();
  });
});
