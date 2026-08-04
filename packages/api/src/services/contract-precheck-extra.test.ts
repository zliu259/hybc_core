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

describe("buildPrecheckResult — 红线规则预审语境适配", () => {
  it("身份证号规则降级为提示（case-by-case 合同自然人签约属正常），不阻断", () => {
    const textWithIdNumber =
      "乙方（自然人）：张某，身份证号 11010119900101123X，依据《中华人民共和国民法典》订立本合同。";
    const output = JSON.stringify({ summary: "未见明显问题", issues: [] });
    const result = buildPrecheckResult(output, textWithIdNumber, null);
    const idFinding = result.rule_findings.find(f => f.reason.includes("身份证号"));
    expect(idFinding).toBeDefined();
    expect(idFinding?.level).toBe("yellow");
    expect(idFinding?.reason).toContain("自然人签约");
    expect(idFinding?.reason).not.toContain("模板");
    expect(result.has_blocking).toBe(false);
  });

  it("其他 red 红线不受适配影响（背靠背仍阻断）", () => {
    const text = "甲方在收到业主付款后再向乙方支付本合同款项。";
    const result = buildPrecheckResult(JSON.stringify({ summary: "ok", issues: [] }), text, null);
    expect(result.rule_findings.some(f => f.level === "red")).toBe(true);
    expect(result.has_blocking).toBe(true);
  });
});
