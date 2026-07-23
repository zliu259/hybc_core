import { describe, it, expect } from "vitest";
import { parseReviewResult } from "../review-result";

describe("parseReviewResult", () => {
  it("新结构：overall + issues + revised_content 全解析", () => {
    const parsed = parseReviewResult(
      JSON.stringify({
        overall: "warn",
        issues: [
          {
            text: "验收合格后30日内",
            severity: "yellow",
            reason: "期限偏长",
            suggestion: "改为15日"
          }
        ],
        revised_content: "【修正稿】甲方应于验收合格后15日内付款。"
      })
    );
    expect(parsed).toEqual({
      overall: "warn",
      issues: [
        {
          text: "验收合格后30日内",
          severity: "yellow",
          reason: "期限偏长",
          suggestion: "改为15日"
        }
      ],
      revisedContent: "【修正稿】甲方应于验收合格后15日内付款。"
    });
  });

  it("旧结构（仅 issues、无 overall/revised_content）容错可用", () => {
    const parsed = parseReviewResult(
      JSON.stringify({
        issues: [
          {
            text: "每逾期一日按每日千分之三支付违约金",
            severity: "yellow",
            reason: "违约金费率畸高",
            legal_basis: "《民法典》第585条",
            suggestion: "建议调整为每日万分之五以内"
          }
        ]
      })
    );
    expect(parsed?.overall).toBeNull();
    expect(parsed?.revisedContent).toBe("");
    expect(parsed?.issues).toHaveLength(1);
    expect(parsed?.issues[0].suggestion).toBe("建议调整为每日万分之五以内");
  });

  it("markdown 围栏剥除后可解析", () => {
    const parsed = parseReviewResult(
      '```json\n{"overall":"pass","issues":[],"revised_content":""}\n```'
    );
    expect(parsed?.overall).toBe("pass");
    expect(parsed?.issues).toEqual([]);
  });

  it("pass 且无问题时仍返回结果（用于展示通过标签）", () => {
    const parsed = parseReviewResult(
      JSON.stringify({ overall: "pass", issues: [], revised_content: "" })
    );
    expect(parsed).toEqual({ overall: "pass", issues: [], revisedContent: "" });
  });

  it("畸形 issue 条目被过滤、字段缺失兜底", () => {
    const parsed = parseReviewResult(
      JSON.stringify({
        overall: "fail",
        issues: [
          null,
          "字符串条目",
          { severity: "red", reason: "无text跳过" },
          { text: "有效问题" }
        ],
        revised_content: "修正稿"
      })
    );
    expect(parsed?.issues).toEqual([
      {
        text: "有效问题",
        severity: "yellow",
        reason: "",
        suggestion: undefined
      }
    ]);
  });

  it("null/空串/非JSON/无内容对象返回 null", () => {
    expect(parseReviewResult(null)).toBeNull();
    expect(parseReviewResult("")).toBeNull();
    expect(parseReviewResult("not json")).toBeNull();
    expect(parseReviewResult('"字符串"')).toBeNull();
    expect(parseReviewResult("{}")).toBeNull();
    expect(
      parseReviewResult(JSON.stringify({ issues: [], revised_content: "" }))
    ).toBeNull();
  });
});
