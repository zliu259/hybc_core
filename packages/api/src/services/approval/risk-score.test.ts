import { describe, expect, it } from "vitest";

import {
  normalizeContractReviewOutput,
  normalizePaymentRiskOutput
} from "./risk-score";

describe("normalizePaymentRiskOutput — 服务端兜底计分（旧 runner + 新模板偏斜窗口）", () => {
  it("带 findings 无 score 的结果被计分并附 score_basis", () => {
    const raw = JSON.stringify({
      summary: "疑似重复付款",
      findings: [
        {
          dimension: "duplicate_payment",
          status: "fail",
          detail: "两笔同额",
          evidence: "e"
        },
        { dimension: "overpayment", status: "pass", detail: "", evidence: "" }
      ],
      recommendations: ["人工复核"]
    });
    const parsed = JSON.parse(normalizePaymentRiskOutput(raw)) as Record<string, unknown>;
    expect(parsed.score).toBe(50);
    expect(parsed.overall_risk).toBe("high");
    expect(parsed.score_basis).toEqual(["+50 重复支付：两笔同额"]);
  });

  it("已带数值 score 的结果原样透传（新 runner 已计分）", () => {
    const raw = JSON.stringify({ score: 70, overall_risk: "high", findings: [] });
    expect(normalizePaymentRiskOutput(raw)).toBe(raw);
  });

  it("旧 schema（无 findings）原样透传", () => {
    const raw = JSON.stringify({ overall_risk: "high", score: 81, checks: {} });
    expect(normalizePaymentRiskOutput(raw)).toBe(raw);
  });

  it("非 JSON 输出原样透传", () => {
    expect(normalizePaymentRiskOutput("散文输出")).toBe("散文输出");
  });

  it("warn 堆叠封顶 40 不进高风险档", () => {
    const raw = JSON.stringify({
      summary: "多条警示",
      findings: [
        { dimension: "duplicate_payment", status: "warn", detail: "w1", evidence: "e" },
        { dimension: "overpayment", status: "warn", detail: "w2", evidence: "e" },
        { dimension: "frequency_anomaly", status: "warn", detail: "w3", evidence: "e" }
      ],
      recommendations: []
    });
    const parsed = JSON.parse(normalizePaymentRiskOutput(raw)) as {
      score: number;
      overall_risk: string;
      score_basis: string[];
    };
    expect(parsed.score).toBe(40);
    expect(parsed.overall_risk).toBe("medium");
    expect(parsed.score_basis.some(line => line.includes("上限 +40"))).toBe(true);
  });

  it("status=low 计为 pass 不加分", () => {
    const raw = JSON.stringify({
      summary: "s",
      findings: [{ dimension: "overpayment", status: "low", detail: "", evidence: "" }]
    });
    const parsed = JSON.parse(normalizePaymentRiskOutput(raw)) as Record<string, unknown>;
    expect(parsed.score).toBe(0);
    expect(parsed.overall_risk).toBe("low");
  });
});

describe("normalizeContractReviewOutput", () => {
  it("带 clause_analysis 无 score 的结果按条款风险计分", () => {
    const raw = JSON.stringify({
      summary: "违约条款缺失",
      clause_analysis: [
        { clause: "违约责任", risk_level: "high", issue: "缺失", suggestion: "补充" },
        { clause: "付款条件", risk_level: "medium", issue: "含糊", suggestion: "明确" }
      ],
      amount_assessment: { reasonableness: "medium", basis: "b", risk_points: [] },
      recommendations: []
    });
    const parsed = JSON.parse(normalizeContractReviewOutput(raw)) as Record<string, unknown>;
    expect(parsed.score).toBe(70);
    expect(parsed.overall_risk).toBe("high");
    expect(parsed.score_basis).toEqual(["+50 违约责任：缺失", "+20 付款条件：含糊"]);
  });

  it("已带数值 score 的结果原样透传", () => {
    const raw = JSON.stringify({ score: 48, overall_risk: "medium", clause_analysis: [] });
    expect(normalizeContractReviewOutput(raw)).toBe(raw);
  });

  it("medium 堆叠封顶 40 不进高风险档，low 条款列出不计分", () => {
    const raw = JSON.stringify({
      summary: "多条关注项",
      clause_analysis: [
        { clause: "条款1", risk_level: "medium", issue: "关注1", suggestion: "s" },
        { clause: "条款2", risk_level: "medium", issue: "关注2", suggestion: "s" },
        { clause: "条款3", risk_level: "medium", issue: "关注3", suggestion: "s" },
        { clause: "送达地址", risk_level: "low", issue: "仅列甲方", suggestion: "补充" }
      ],
      recommendations: []
    });
    const parsed = JSON.parse(normalizeContractReviewOutput(raw)) as {
      score: number;
      overall_risk: string;
      score_basis: string[];
      clause_analysis: unknown[];
    };
    expect(parsed.score).toBe(40);
    expect(parsed.overall_risk).toBe("medium");
    expect(parsed.clause_analysis).toHaveLength(4);
    expect(parsed.score_basis.some(line => line.includes("上限 +40"))).toBe(true);
    expect(parsed.score_basis.some(line => line.includes("送达地址"))).toBe(false);
  });
});
