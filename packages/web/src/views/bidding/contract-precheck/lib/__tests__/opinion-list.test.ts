import { describe, expect, it } from "vitest";

import { buildOpinionList } from "../opinion-list";
import type {
  PrecheckIssue,
  PrecheckRuleFinding
} from "@/api/contract-precheck";

const issues: PrecheckIssue[] = [
  {
    dimension: "liability_balance",
    severity: "major",
    quote: "每日按合同总价的1%支付违约金",
    problem: "违约金费率畸高",
    suggestion: "按日万分之五计，累计不超过合同总价的10%。"
  },
  {
    dimension: "clause_completeness",
    severity: "minor",
    quote: "",
    problem: "缺少争议解决条款",
    suggestion: "增加诉讼管辖条款。"
  }
];

const ruleFindings: PrecheckRuleFinding[] = [
  {
    text: "收到业主付款后再支付",
    level: "red",
    reason: "背靠背付款条款对中小企业无效",
    legal_basis: "法释〔2024〕11号",
    source: "rule"
  }
];

describe("buildOpinionList", () => {
  it("全部输出：AI 问题 + 规则红线，编号连续", () => {
    const text = buildOpinionList("设备租赁合同", issues, null, ruleFindings);
    expect(text).toContain("《设备租赁合同》合同修改意见清单");
    expect(text).toContain("1. 【重要】违约金费率畸高");
    expect(text).toContain("原文：每日按合同总价的1%支付违约金");
    expect(text).toContain("建议修改为：按日万分之五计");
    expect(text).toContain("2. 【提示】缺少争议解决条款");
    expect(text).toContain(
      "3. 【明显错误】背靠背付款条款对中小企业无效（依据：法释〔2024〕11号）"
    );
  });

  it("仅采纳的 issue 输出，规则红线始终保留", () => {
    const text = buildOpinionList("合同", issues, new Set([1]), ruleFindings);
    expect(text).not.toContain("违约金费率畸高");
    expect(text).toContain("1. 【提示】缺少争议解决条款");
    expect(text).toContain("2. 【明显错误】背靠背付款条款");
  });

  it("quote 为空时不输出原文行", () => {
    const text = buildOpinionList("合同", [issues[1]], null, []);
    expect(text).not.toContain("原文：");
  });

  it("空清单输出占位说明", () => {
    const text = buildOpinionList("合同", [], new Set(), []);
    expect(text).toContain("（无修改意见）");
  });
});
