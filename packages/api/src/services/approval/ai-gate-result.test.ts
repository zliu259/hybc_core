import { describe, expect, it } from "vitest";

import { parseAiGateTaskResult } from "./ai-gate-result";

const envelope = (output: unknown, metadata: Record<string, unknown> = {}) =>
  JSON.stringify({ output, metadata, tokens_input: 1, tokens_output: 1 });

describe("parseAiGateTaskResult — metadata 优先路径（新版 runner）", () => {
  it("读取 metadata.outcome=reject 与规范化字段", () => {
    const parsed = parseAiGateTaskResult(
      envelope("{}", {
        outcome: "reject",
        decision: "reject",
        risk_level: "high",
        comment: "AI审查不通过：存在重复支付",
        summary: "存在重复支付",
        recommendations: ["人工核对"],
        needs_human_review: false
      })
    );
    expect(parsed.outcome).toBe("reject");
    expect(parsed.explicitOutcome).toBe(true);
    expect(parsed.decision).toBe("reject");
    expect(parsed.riskLevel).toBe("high");
    expect(parsed.comment).toBe("AI审查不通过：存在重复支付");
    expect(parsed.recommendations).toEqual(["人工核对"]);
  });

  it("warn 判定标记需人工关注", () => {
    const parsed = parseAiGateTaskResult(
      envelope("{}", {
        outcome: "approve",
        decision: "warn",
        comment: "AI审查放行（需人工重点关注）：缺发票",
        needs_human_review: true
      })
    );
    expect(parsed.outcome).toBe("approve");
    expect(parsed.decision).toBe("warn");
    expect(parsed.needsHumanReview).toBe(true);
  });
});

describe("parseAiGateTaskResult — output 兜底路径（旧版 runner 直出模型 JSON）", () => {
  it("解析新契约 decision JSON（含 markdown 围栏）", () => {
    const modelJson =
      '```json\n{"decision":"reject","risk_level":"high","summary":"疑似重复付款","findings":[{"dimension":"duplicate_payment","status":"fail","detail":"两笔同额同日","evidence":"FK-1/FK-2"}],"suggestions":["人工核对"]}\n```';
    const parsed = parseAiGateTaskResult(envelope(modelJson));
    expect(parsed.outcome).toBe("reject");
    expect(parsed.explicitOutcome).toBe(true);
    expect(parsed.comment).toContain("AI审查不通过");
    expect(parsed.comment).toContain("duplicate_payment");
  });

  it("解析旧 DB 模板契约 {outcome, comment}", () => {
    const parsed = parseAiGateTaskResult(
      envelope('{"outcome":"approve","comment":"审查摘要：正常；结论依据：无异常"}')
    );
    expect(parsed.outcome).toBe("approve");
    expect(parsed.explicitOutcome).toBe(true);
    expect(parsed.decision).toBe("pass");
  });

  it("守卫：reject 但 findings 无 fail 级证据 → 降级放行并标注", () => {
    const modelJson =
      '{"decision":"reject","summary":"感觉有问题","findings":[{"dimension":"overpayment","status":"warn","detail":"存疑","evidence":"e"}]}';
    const parsed = parseAiGateTaskResult(envelope(modelJson));
    expect(parsed.outcome).toBe("approve");
    expect(parsed.decision).toBe("warn");
    expect(parsed.needsHumanReview).toBe(true);
    expect(parsed.comment).toContain("降级");
  });

  it("不带 findings 的 reject 不触发守卫（旧契约无法验证证据）", () => {
    const parsed = parseAiGateTaskResult(envelope('{"outcome":"reject","comment":"高风险"}'));
    expect(parsed.outcome).toBe("reject");
    expect(parsed.decision).toBe("reject");
  });

  it("新契约（decision 键）缺 findings 的 reject 降级放行", () => {
    const parsed = parseAiGateTaskResult(
      envelope('{"decision":"reject","summary":"感觉有问题"}')
    );
    expect(parsed.outcome).toBe("approve");
    expect(parsed.decision).toBe("warn");
    expect(parsed.needsHumanReview).toBe(true);
  });
});

describe("parseAiGateTaskResult — metadata 与 outcome 矛盾时以 outcome 为准", () => {
  it("admin 覆写 outcome=reject 但残留 decision=pass 时展示 reject", () => {
    const parsed = parseAiGateTaskResult(
      envelope("{}", { outcome: "reject", decision: "pass", comment: "管理员驳回" })
    );
    expect(parsed.outcome).toBe("reject");
    expect(parsed.decision).toBe("reject");
  });

  it("metadata 无 risk_level 时从 output JSON 兜底", () => {
    const parsed = parseAiGateTaskResult(
      envelope('{"decision":"pass","risk_level":"medium","summary":"s"}', {
        outcome: "approve",
        decision: "pass",
        comment: "AI审查通过：s"
      })
    );
    expect(parsed.riskLevel).toBe("medium");
  });
});

describe("parseAiGateTaskResult — fail-open 路径", () => {
  it("null 输入返回默认放行且 explicitOutcome=false", () => {
    const parsed = parseAiGateTaskResult(null);
    expect(parsed.outcome).toBe("approve");
    expect(parsed.explicitOutcome).toBe(false);
    expect(parsed.needsHumanReview).toBe(true);
  });

  it("散文输出放行但携带可读文本提示人工复核", () => {
    const parsed = parseAiGateTaskResult(envelope("我觉得这个申请没什么问题。"));
    expect(parsed.outcome).toBe("approve");
    expect(parsed.explicitOutcome).toBe(false);
    expect(parsed.comment).toContain("请人工复核");
    expect(parsed.comment).toContain("我觉得这个申请没什么问题");
  });

  it("完全非法 JSON 使用 fallback 文案", () => {
    const parsed = parseAiGateTaskResult("not-json", "AI关卡已执行");
    expect(parsed.outcome).toBe("approve");
    expect(parsed.comment).toBe("AI关卡已执行");
  });

  it("admin 手工覆写的 metadata（仅 outcome/comment/summary）可解析", () => {
    const parsed = parseAiGateTaskResult(
      envelope("原始输出", { outcome: "approve", comment: "管理员放行", summary: "管理员放行" })
    );
    expect(parsed.outcome).toBe("approve");
    expect(parsed.explicitOutcome).toBe(true);
    expect(parsed.comment).toBe("管理员放行");
  });
});
