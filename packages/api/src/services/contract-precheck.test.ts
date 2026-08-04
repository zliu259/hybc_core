import { describe, expect, it } from "vitest";

import { buildPrecheckResult } from "./contract-precheck";

const CLEAN_TEXT = "甲乙双方经协商一致，依据《中华人民共和国民法典》订立本合同。";

describe("buildPrecheckResult — AI 输出规范化与明显错误判定", () => {
  it("无问题输出 → passed 语义（无阻断）", () => {
    const output = JSON.stringify({ summary: "未见明显问题", overall: "pass", issues: [] });
    const result = buildPrecheckResult(output, CLEAN_TEXT, "anthropic/claude-sonnet-5");
    expect(result.has_blocking).toBe(false);
    expect(result.overall).toBe("pass");
    expect(result.issues).toEqual([]);
    expect(result.rule_findings).toEqual([]);
    expect(result.unparsed).toBe(false);
  });

  it("AI critical issue → 阻断（明显错误）", () => {
    const output = JSON.stringify({
      summary: "存在无效免责条款",
      issues: [
        {
          dimension: "invalid_terms",
          severity: "critical",
          quote: "一切事故均与甲方无关",
          problem: "绝对免责条款无效",
          suggestion: "按过错责任划分事故责任。"
        }
      ]
    });
    const result = buildPrecheckResult(output, CLEAN_TEXT, null);
    expect(result.has_blocking).toBe(true);
    expect(result.overall).toBe("critical");
  });

  it("规则层 red 命中即阻断（即使 AI 没发现）", () => {
    const textWithBackToBack = "甲方在收到业主付款后再向乙方支付本合同款项。";
    const output = JSON.stringify({ summary: "未见明显问题", issues: [] });
    const result = buildPrecheckResult(output, textWithBackToBack, null);
    expect(result.rule_findings.length).toBeGreaterThan(0);
    expect(result.rule_findings.some(f => f.level === "red")).toBe(true);
    expect(result.has_blocking).toBe(true);
    expect(result.overall).toBe("critical");
  });

  it("仅 major/minor issue 不阻断", () => {
    const output = JSON.stringify({
      summary: "违约金约定不对等",
      issues: [
        { dimension: "liability_balance", severity: "major", quote: "q", problem: "p", suggestion: "s" },
        { dimension: "clause_completeness", severity: "minor", quote: "", problem: "p2", suggestion: "s2" }
      ]
    });
    const result = buildPrecheckResult(output, CLEAN_TEXT, null);
    expect(result.has_blocking).toBe(false);
    expect(result.overall).toBe("major");
    expect(result.issues[0].severity).toBe("major");
  });

  it("issues 按严重度排序且截断到 20 条", () => {
    const issues = [
      { dimension: "a", severity: "minor", quote: "", problem: "p", suggestion: "s" },
      { dimension: "b", severity: "critical", quote: "", problem: "p", suggestion: "s" },
      ...Array.from({ length: 25 }, (_, i) => ({
        dimension: `x${i}`,
        severity: "major",
        quote: "",
        problem: "p",
        suggestion: "s"
      }))
    ];
    const result = buildPrecheckResult(JSON.stringify({ summary: "s", issues }), CLEAN_TEXT, null);
    expect(result.issues.length).toBe(20);
    expect(result.issues[0].severity).toBe("critical");
  });

  it("markdown 围栏包裹的 JSON 可解析", () => {
    const output = '```json\n{"summary":"ok","issues":[]}\n```';
    const result = buildPrecheckResult(output, CLEAN_TEXT, null);
    expect(result.unparsed).toBe(false);
    expect(result.summary).toBe("ok");
  });

  it("完全无法解析的输出 → 阻断并保留原文", () => {
    const result = buildPrecheckResult("模型输出了散文，不是JSON", CLEAN_TEXT, null);
    expect(result.unparsed).toBe(true);
    expect(result.has_blocking).toBe(true);
    expect(result.raw_output).toContain("散文");
    expect(result.summary).toContain("人工复核");
  });

  it("severity 同义词归一（red/high→critical，low→minor，未知→major）", () => {
    const output = JSON.stringify({
      summary: "s",
      issues: [
        { dimension: "a", severity: "red", quote: "", problem: "p", suggestion: "s" },
        { dimension: "b", severity: "low", quote: "", problem: "p", suggestion: "s" },
        { dimension: "c", severity: "weird", quote: "", problem: "p", suggestion: "s" }
      ]
    });
    const result = buildPrecheckResult(output, CLEAN_TEXT, null);
    expect(result.issues.map(i => i.severity)).toEqual(["critical", "major", "minor"]);
  });
});
