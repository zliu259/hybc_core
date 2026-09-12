import { describe, expect, it } from "vitest";

import {
  describeTitleCounts,
  distinctUnknownTitleNames,
  invoiceTitleDisplay,
  summarizeTitles
} from "./reimbursement-title";

describe("summarizeTitles", () => {
  it("空 → empty", () => {
    expect(summarizeTitles([]).kind).toBe("empty");
  });

  it("同一主体 → uniform", () => {
    const summary = summarizeTitles([
      {
        invoice_title_entity_id: 11,
        invoice_title_name: "北京鑫丰畅建设有限公司"
      },
      {
        invoice_title_entity_id: 11,
        invoice_title_name: "北京鑫丰畅建设有限公司"
      }
    ]);
    expect(summary.kind).toBe("uniform");
    expect(summary.entityId).toBe(11);
  });

  it("全部未识别 → unknown", () => {
    expect(
      summarizeTitles([
        { invoice_title_entity_id: null, invoice_title_name: null }
      ]).kind
    ).toBe("unknown");
  });

  it("两个不同的未识别原文仍算 unknown，名称取第一条", () => {
    const summary = summarizeTitles([
      { invoice_title_entity_id: null, invoice_title_name: "刘相余" },
      { invoice_title_entity_id: null, invoice_title_name: "张三" }
    ]);
    expect(summary.kind).toBe("unknown");
    expect(summary.counts).toEqual([
      { entity_id: null, name: "刘相余", count: 2 }
    ]);
  });

  it("已识别 + 未识别 → mixed，计数降序", () => {
    const summary = summarizeTitles([
      { invoice_title_entity_id: null, invoice_title_name: "刘相余" },
      {
        invoice_title_entity_id: 11,
        invoice_title_name: "北京鑫丰畅建设有限公司"
      },
      {
        invoice_title_entity_id: 11,
        invoice_title_name: "北京鑫丰畅建设有限公司"
      }
    ]);
    expect(summary.kind).toBe("mixed");
    expect(summary.counts.map(c => c.count)).toEqual([2, 1]);
  });
});

describe("invoiceTitleDisplay", () => {
  it("匹配主体：优先主体名", () => {
    expect(
      invoiceTitleDisplay(
        {
          invoice_title_entity_id: 11,
          invoice_title_name: "北京鑫丰畅建设有限公司"
        },
        "北京鑫丰畅建设有限公司"
      )
    ).toEqual({ text: "北京鑫丰畅建设有限公司", tag: "matched" });
  });

  it("只有原文：未匹配", () => {
    expect(
      invoiceTitleDisplay({
        invoice_title_entity_id: null,
        invoice_title_name: "刘相余"
      })
    ).toEqual({ text: "刘相余", tag: "unmatched" });
  });

  it("都没有：未识别", () => {
    expect(
      invoiceTitleDisplay({
        invoice_title_entity_id: null,
        invoice_title_name: null
      })
    ).toEqual({ text: "未识别", tag: "unknown" });
  });
});

describe("describeTitleCounts", () => {
  it("拼成可读的中文摘要", () => {
    const text = describeTitleCounts(
      [
        { entity_id: 11, name: "北京鑫丰畅建设有限公司", count: 2 },
        { entity_id: null, name: "刘相余", count: 1 },
        { entity_id: null, name: null, count: 1 }
      ],
      id => (id === 11 ? "北京鑫丰畅建设有限公司" : undefined)
    );
    expect(text).toBe(
      "北京鑫丰畅建设有限公司 × 2；刘相余（未匹配）× 1；未识别 × 1"
    );
  });
});

describe("distinctUnknownTitleNames", () => {
  it("全部未识别且原文不同 → 返回去重原文", () => {
    expect(
      distinctUnknownTitleNames([
        { invoice_title_entity_id: null, invoice_title_name: "刘相余" },
        { invoice_title_entity_id: null, invoice_title_name: "张三" },
        { invoice_title_entity_id: null, invoice_title_name: "刘 相余" }
      ])
    ).toEqual(["刘相余", "张三"]);
  });

  it("有任一已匹配主体、或原文只有一种/全空 → 空数组", () => {
    expect(
      distinctUnknownTitleNames([
        {
          invoice_title_entity_id: 11,
          invoice_title_name: "北京鑫丰畅建设有限公司"
        },
        { invoice_title_entity_id: null, invoice_title_name: "张三" }
      ])
    ).toEqual([]);
    expect(
      distinctUnknownTitleNames([
        { invoice_title_entity_id: null, invoice_title_name: "刘相余" },
        { invoice_title_entity_id: null, invoice_title_name: "刘相余" }
      ])
    ).toEqual([]);
    expect(
      distinctUnknownTitleNames([
        { invoice_title_entity_id: null, invoice_title_name: null }
      ])
    ).toEqual([]);
  });
});
