import { describe, expect, it } from "vitest";

import { buildPrecheckResult } from "./contract-precheck";

const CLEAN_TEXT = "甲乙双方经协商一致，依据《中华人民共和国民法典》订立本合同。";

describe("buildPrecheckResult — 截断输出处理", () => {
  it("被截断抢救的输出（_truncated）即使无 critical 也阻断签署", () => {
    // salvage 需要至少一个已闭合容器：首条 issue 完整、第二条中途截断，
    // tolerantJsonParse 走 salvage 路径并打 _truncated 标记
    const full = JSON.stringify({
      summary: "存在若干问题",
      issues: [
        { dimension: "liability_balance", severity: "minor", quote: "q", problem: "p", suggestion: "s" },
        { dimension: "clause_completeness", severity: "minor", quote: "q2", problem: "p2", suggestion: "s2" }
      ]
    });
    const truncatedRaw = full.slice(0, full.lastIndexOf('"problem"')); // 第二条中途截断
    const result = buildPrecheckResult(truncatedRaw, CLEAN_TEXT, null);
    expect(result.truncated).toBe(true);
    expect(result.has_blocking).toBe(true);
    expect(result.summary).toContain("截断");
  });

  it("串中截断（salvage 失败）走 unparsed 路径，同样阻断", () => {
    const full = JSON.stringify({
      summary: "存在若干问题",
      issues: [
        { dimension: "liability_balance", severity: "minor", quote: "q", problem: "p", suggestion: "s" }
      ]
    });
    const result = buildPrecheckResult(full.slice(0, full.length - 4), CLEAN_TEXT, null);
    expect(result.unparsed).toBe(true);
    expect(result.has_blocking).toBe(true);
  });

  it("完整输出 truncated=false", () => {
    const result = buildPrecheckResult(
      JSON.stringify({ summary: "ok", issues: [] }),
      CLEAN_TEXT,
      null
    );
    expect(result.truncated).toBe(false);
    expect(result.has_blocking).toBe(false);
  });
});
