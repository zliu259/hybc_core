// packages/api/test/contract-draft-rules.test.ts
import { describe, it, expect } from "vitest";
import {
  checkClauseText,
  checkDraftDates,
  parseContractSectionOutput
} from "../src/services/contract-draft-rules";

describe("checkClauseText", () => {
  it("拦截已废止法律引用", () => {
    const findings = checkClauseText("根据《中华人民共和国合同法》签订本协议。");
    expect(findings.some(f => f.level === "red" && f.reason.includes("废止"))).toBe(true);
  });

  it("拦截背靠背付款条款", () => {
    const findings = checkClauseText("甲方在收到业主付款后向乙方支付工程款。");
    expect(findings.some(f => f.level === "red" && f.legal_basis?.includes("2024"))).toBe(true);
  });

  it("拦截身份证号明文", () => {
    const findings = checkClauseText("收款代理人身份证号：131002198808111213。");
    expect(findings.some(f => f.level === "red" && f.reason.includes("个人信息"))).toBe(true);
  });

  it("质保金超过3%红标", () => {
    const findings = checkClauseText("质量保证金为结算总额的5%。");
    expect(findings.some(f => f.level === "red" && f.reason.includes("3%"))).toBe(true);
  });

  it("质保金3%以内不报", () => {
    expect(checkClauseText("质量保证金为结算总额的3%。")).toEqual([]);
  });

  it("日千分之三违约金黄标", () => {
    const findings = checkClauseText("每逾期一日按每日千分之三收取违约金。");
    expect(findings.some(f => f.level === "yellow")).toBe(true);
  });

  it("免除人身损害责任红标", () => {
    const findings = checkClauseText("乙方免除甲方造成的人身损害赔偿责任。");
    expect(findings.some(f => f.level === "red" && f.legal_basis?.includes("506"))).toBe(true);
  });

  it("正常条款零命中", () => {
    expect(checkClauseText("甲方应于验收合格后30日内支付工程款。")).toEqual([]);
  });
});

describe("checkDraftDates", () => {
  it("竣工早于开工红标", () => {
    const findings = checkDraftDates("2023-10-20", "2022-12-19");
    expect(findings).toHaveLength(1);
    expect(findings[0].level).toBe("red");
  });
  it("正常或缺省不报", () => {
    expect(checkDraftDates("2026-01-01", "2026-06-01")).toEqual([]);
    expect(checkDraftDates(undefined, "2026-06-01")).toEqual([]);
  });
});

describe("parseContractSectionOutput", () => {
  it("解析规范JSON", () => {
    const out = parseContractSectionOutput(
      JSON.stringify({ content: "正文A", risk_spans: [{ text: "正文A", level: "red", reason: "r" }] })
    );
    expect(out.content).toBe("正文A");
    expect(out.risk_spans).toHaveLength(1);
    expect(out.risk_spans[0].source).toBe("ai");
  });
  it("剥离markdown代码块围栏", () => {
    const out = parseContractSectionOutput('```json\n{"content":"B","risk_spans":[]}\n```');
    expect(out.content).toBe("B");
  });
  it("非JSON输出降级为纯文本content", () => {
    const out = parseContractSectionOutput("这不是JSON");
    expect(out.content).toBe("这不是JSON");
    expect(out.risk_spans).toEqual([]);
  });
});
