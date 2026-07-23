import { describe, it, expect } from "vitest";
import {
  completenessModelShortName,
  parseCompletenessReport
} from "../completeness-report";

describe("completenessModelShortName", () => {
  it("terra/sonnet 简名映射", () => {
    expect(completenessModelShortName("openai/gpt-5.6-terra")).toBe("terra");
    expect(completenessModelShortName("anthropic/claude-sonnet-5")).toBe(
      "sonnet"
    );
  });

  it("未知模型取路径末段", () => {
    expect(completenessModelShortName("vendor/some-model")).toBe("some-model");
    expect(completenessModelShortName("bare-model")).toBe("bare-model");
  });
});

describe("parseCompletenessReport", () => {
  const fullJson = JSON.stringify({
    initial: {
      model: "openai/gpt-5.6-terra",
      result: {
        missing: [
          {
            section_key: "service_notice",
            title: "送达条款",
            level: "recommended",
            reason: "缺失送达条款"
          }
        ],
        section_issues: [
          {
            section_key: "payment",
            title: "价款结算与支付",
            issues: [
              {
                text: "{{late_fee_rate}}",
                severity: "yellow",
                reason: "占位符未填写",
                suggestion: "填日万分之五"
              }
            ]
          }
        ],
        overall_summary: "初版总评",
        ready_to_finalize: false
      }
    },
    audit: {
      model: "anthropic/claude-sonnet-5",
      result: {
        missing: [
          {
            section_key: "service_notice",
            title: "送达条款",
            level: "recommended",
            reason: "缺失送达条款",
            verdict: "confirmed",
            audit_note: ""
          }
        ],
        section_issues: [
          {
            section_key: "breach",
            title: "违约责任",
            issues: [
              {
                text: "违约金比例过高",
                severity: "red",
                reason: "畸高",
                suggestion: "下调至合理区间",
                verdict: "confirmed",
                audit_note: "同意初版"
              }
            ],
            fixable: true
          },
          {
            section_key: "payment",
            title: "价款结算与支付",
            issues: [
              {
                text: "{{late_fee_rate}}",
                severity: "yellow",
                reason: "占位符未填写",
                verdict: "confirmed"
              }
            ],
            fixable: false
          }
        ],
        overall_summary: "复核总评",
        ready_to_finalize: false
      }
    }
  });

  it("完整解析 initial/audit 双阶段结果（含 fixable 透传）", () => {
    const report = parseCompletenessReport(fullJson);
    expect(report).not.toBeNull();
    expect(report?.initial.model).toBe("openai/gpt-5.6-terra");
    expect(report?.audit.model).toBe("anthropic/claude-sonnet-5");
    expect(report?.audit.result.missing?.[0].verdict).toBe("confirmed");
    const auditGroups = report?.audit.result.section_issues ?? [];
    const breach = auditGroups.find(g => g.section_key === "breach");
    const payment = auditGroups.find(g => g.section_key === "payment");
    // 实质缺陷可 AI 修正、占位符类不可 AI 修正
    expect(breach?.fixable).toBe(true);
    expect(payment?.fixable).toBe(false);
    expect(breach?.issues[0].verdict).toBe("confirmed");
    expect(breach?.issues[0].audit_note).toBe("同意初版");
  });

  it("fixable 缺省视为 undefined（不显示 AI 修正按钮的口径）", () => {
    const report = parseCompletenessReport(
      JSON.stringify({
        audit: {
          model: "y",
          result: {
            section_issues: [
              {
                section_key: "scope",
                title: "工程范围",
                issues: [{ text: "范围不清", severity: "yellow", reason: "" }]
              }
            ]
          }
        }
      })
    );
    expect(report?.audit.result.section_issues?.[0].fixable).toBeUndefined();
  });

  it("剥 markdown 围栏后解析", () => {
    const fenced = "```json\n" + fullJson + "\n```";
    expect(parseCompletenessReport(fenced)?.audit.model).toBe(
      "anthropic/claude-sonnet-5"
    );
  });

  it("非法 verdict / 缺 section_key 被过滤或置空", () => {
    const report = parseCompletenessReport(
      JSON.stringify({
        initial: { model: "x", result: {} },
        audit: {
          model: "y",
          result: {
            missing: [
              { section_key: "", title: "空", level: "core", reason: "丢弃" },
              {
                section_key: "dispute",
                title: "争议",
                level: "core",
                reason: "保留",
                verdict: "bogus"
              }
            ],
            section_issues: [
              { section_key: "empty", title: "空组", issues: [] },
              {
                section_key: "ok",
                title: "有效",
                issues: [
                  { text: "", severity: "red", reason: "text空丢弃" },
                  { text: "有效问题", severity: "red", reason: "保留" }
                ]
              }
            ]
          }
        }
      })
    );
    expect(report?.audit.result.missing).toHaveLength(1);
    expect(report?.audit.result.missing?.[0].section_key).toBe("dispute");
    expect(report?.audit.result.missing?.[0].verdict).toBe("bogus"); // missing.verdict 宽松为 string
    expect(report?.audit.result.section_issues).toHaveLength(1);
    expect(report?.audit.result.section_issues?.[0].section_key).toBe("ok");
    expect(report?.audit.result.section_issues?.[0].issues).toHaveLength(1);
  });

  // 向后兼容：旧历史版本数据仍带 revised_content/revision_approved，需继续解析
  it("旧数据：空节但有修正稿仍保留且 revision_approved 透传", () => {
    const report = parseCompletenessReport(
      JSON.stringify({
        audit: {
          model: "y",
          result: {
            section_issues: [
              {
                section_key: "payment",
                title: "付款",
                issues: [],
                revised_content: "仅修正稿无问题项",
                revision_approved: true
              }
            ]
          }
        }
      })
    );
    expect(report?.audit.result.section_issues).toHaveLength(1);
    expect(report?.audit.result.section_issues?.[0].revision_approved).toBe(
      true
    );
    expect(report?.audit.result.section_issues?.[0].revised_content).toBe(
      "仅修正稿无问题项"
    );
  });

  it("非 JSON / 空串 / 无 initial 无 audit 返回 null", () => {
    expect(parseCompletenessReport(null)).toBeNull();
    expect(parseCompletenessReport("")).toBeNull();
    expect(parseCompletenessReport("非结构化输出")).toBeNull();
    expect(parseCompletenessReport(JSON.stringify({ runs: [] }))).toBeNull();
  });
});
