import { describe, it, expect } from "vitest";
import { buildRenderSegments, fillPlaceholders } from "../segments";
import type { RiskAnnotation } from "@/api/contract-draft";

const risk = (text: string, level: "red" | "yellow"): RiskAnnotation => ({
  text,
  level,
  reason: "测试原因",
  legal_basis: "《民法典》",
  source: "rule"
});

describe("fillPlaceholders", () => {
  it("已知键替换、未知键保留", () => {
    expect(
      fillPlaceholders("甲方{{party_a}}与{{unknown}}", { party_a: "某公司" })
    ).toBe("甲方某公司与{{unknown}}");
  });
});

describe("buildRenderSegments", () => {
  it("占位符切成 keyword 段并带填充值", () => {
    const segs = buildRenderSegments("甲方{{party_a}}付款", [], {
      party_a: "某公司"
    });
    expect(segs).toEqual([
      { text: "甲方", kind: "plain" },
      { text: "某公司", kind: "keyword", key: "party_a" },
      { text: "付款", kind: "plain" }
    ]);
  });

  it("无填充值的占位符原样展示", () => {
    const segs = buildRenderSegments("{{amount}}元", [], {});
    expect(segs[0]).toEqual({
      text: "{{amount}}",
      kind: "keyword",
      key: "amount"
    });
  });

  it("风险片段切成 risk 段并带原因", () => {
    const segs = buildRenderSegments(
      "每日千分之三违约金条款。",
      [risk("每日千分之三", "yellow")],
      {}
    );
    const riskSeg = segs.find(s => s.kind === "risk-yellow");
    expect(riskSeg?.text).toBe("每日千分之三");
    expect(riskSeg?.reason).toBe("测试原因");
  });

  it("风险文本不存在于正文时忽略", () => {
    const segs = buildRenderSegments(
      "正常条款。",
      [risk("不存在的片段", "red")],
      {}
    );
    expect(segs.every(s => s.kind === "plain" || s.kind === "keyword")).toBe(
      true
    );
  });

  it("风险段与占位符共存", () => {
    const segs = buildRenderSegments(
      "{{party_a}}免除人身损害责任。",
      [risk("免除人身损害责任", "red")],
      { party_a: "某公司" }
    );
    expect(segs.map(s => s.kind)).toEqual(["keyword", "risk-red", "plain"]);
  });
});
