import { describe, it, expect } from "vitest";
import type { CompletenessRun } from "@/api/contract-draft";
import {
  completenessModelShortName,
  mergeMissingHints,
  mergeSectionIssueGroups
} from "../completeness-merge";

const run = (
  model: string,
  result: CompletenessRun["result"]
): CompletenessRun => ({ model, result });

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

describe("mergeMissingHints", () => {
  it("并集去重：双模型同 key 合并且累计提出者", () => {
    const merged = mergeMissingHints([
      run("openai/gpt-5.6-terra", {
        missing: [
          {
            section_key: "geology_risk",
            title: "地质风险",
            level: "recommended",
            reason: "terra理由"
          },
          {
            section_key: "warranty",
            title: "质保",
            level: "core",
            reason: "仅terra提出"
          }
        ]
      }),
      run("anthropic/claude-sonnet-5", {
        missing: [
          {
            section_key: "geology_risk",
            title: "地质风险",
            level: "recommended",
            reason: "sonnet理由"
          }
        ]
      })
    ]);
    expect(merged).toHaveLength(2);
    const geology = merged.find(m => m.section_key === "geology_risk");
    expect(geology?.models).toEqual(["terra", "sonnet"]);
    expect(geology?.reason).toBe("terra理由"); // 先到先得
    const warranty = merged.find(m => m.section_key === "warranty");
    expect(warranty?.models).toEqual(["terra"]);
  });

  it("缺 missing 字段或畸形条目不报错", () => {
    const malformed = [
      run("openai/gpt-5.6-terra", { raw: "非结构化输出" }),
      run("anthropic/claude-sonnet-5", {
        missing: [
          { section_key: "", title: "", level: "", reason: "" },
          {
            section_key: "dispute",
            title: "争议解决",
            level: "core",
            reason: "缺争议条款"
          }
        ]
      })
    ];
    const merged = mergeMissingHints(malformed);
    expect(merged).toHaveLength(1);
    expect(merged[0].section_key).toBe("dispute");
    expect(merged[0].models).toEqual(["sonnet"]);
  });

  it("空 runs 返回空数组", () => {
    expect(mergeMissingHints([])).toEqual([]);
  });
});

describe("mergeSectionIssueGroups", () => {
  it("同 section_key 分组合并，issue 带提出者简名", () => {
    const groups = mergeSectionIssueGroups([
      run("openai/gpt-5.6-terra", {
        section_issues: [
          {
            section_key: "payment",
            title: "付款条款",
            issues: [
              {
                text: "验收合格后30日内",
                severity: "yellow",
                reason: "期限偏长",
                suggestion: "改为15日"
              }
            ]
          }
        ]
      }),
      run("anthropic/claude-sonnet-5", {
        section_issues: [
          {
            section_key: "payment",
            title: "付款条款",
            issues: [
              {
                text: "背靠背付款",
                severity: "red",
                reason: "无效条款"
              }
            ]
          },
          {
            section_key: "duration",
            title: "工期",
            issues: [
              { text: "开工日期未定", severity: "yellow", reason: "要素缺失" }
            ]
          }
        ]
      })
    ]);
    expect(groups).toHaveLength(2);
    const payment = groups.find(g => g.section_key === "payment");
    expect(payment?.issues).toHaveLength(2);
    expect(payment?.issues[0].model).toBe("terra");
    expect(payment?.issues[1].model).toBe("sonnet");
    expect(payment?.issues[1].suggestion).toBeUndefined();
  });

  it("无 issues 的节与畸形条目被过滤", () => {
    const groups = mergeSectionIssueGroups([
      run("openai/gpt-5.6-terra", {
        section_issues: [
          { section_key: "empty", title: "空节", issues: [] },
          {
            section_key: "ok",
            title: "有效节",
            issues: [
              { text: "", severity: "red", reason: "text为空该条跳过" },
              { text: "有效问题", severity: "red", reason: "保留" }
            ]
          }
        ]
      })
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].section_key).toBe("ok");
    expect(groups[0].issues).toHaveLength(1);
    expect(groups[0].issues[0].severity).toBe("red");
  });

  it("旧单模型结构（无 section_issues）返回空数组", () => {
    expect(
      mergeSectionIssueGroups([
        run("openai/gpt-5.6-terra", {
          missing: [
            { section_key: "a", title: "a", level: "core", reason: "r" }
          ]
        })
      ])
    ).toEqual([]);
  });
});
