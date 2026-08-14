import { describe, expect, it } from "vitest";

import { parseAiGateTaskResult } from "./ai-gate-result";

const envelope = (output: unknown, metadata: Record<string, unknown> = {}) =>
  JSON.stringify({ output, metadata, tokens_input: 1, tokens_output: 1 });

interface FindingSpec {
  dimension: string;
  status: string;
  detail?: string;
  evidence?: string;
}

/** 构造 runner 规范化后的 output JSON（含 findings） */
const gateOutput = (
  decision: string,
  findings: FindingSpec[],
  summary = "测试摘要"
): string =>
  JSON.stringify({
    decision,
    risk_level: decision === "reject" ? "high" : "low",
    summary,
    findings: findings.map((f) => ({
      dimension: f.dimension,
      status: f.status,
      detail: f.detail ?? "detail",
      evidence: f.evidence ?? "evidence"
    })),
    suggestions: []
  });

/** 构造现行 runner 的完整信封：metadata.outcome + 规范化 output */
const runnerEnvelope = (
  decision: "reject" | "pass" | "warn",
  findings: FindingSpec[],
  summary = "测试摘要",
  extraMetadata: Record<string, unknown> = {}
): string =>
  envelope(gateOutput(decision, findings, summary), {
    outcome: decision === "reject" ? "reject" : "approve",
    decision,
    risk_level: decision === "reject" ? "high" : "low",
    comment:
      decision === "reject" ? `AI审查不通过：${summary}` : `AI审查通过：${summary}`,
    summary,
    recommendations: [],
    needs_human_review: false,
    ...extraMetadata
  });

describe("parseAiGateTaskResult — metadata 优先路径（现行 runner）", () => {
  it("白名单内 fail 的 reject 保留（付款域 duplicate_payment）", () => {
    const parsed = parseAiGateTaskResult(
      runnerEnvelope("reject", [{ dimension: "duplicate_payment", status: "fail" }], "存在重复支付"),
      { bizType: "payment_request" }
    );
    expect(parsed.outcome).toBe("reject");
    expect(parsed.explicitOutcome).toBe(true);
    expect(parsed.decision).toBe("reject");
    expect(parsed.riskLevel).toBe("high");
    expect(parsed.comment).toBe("AI审查不通过：存在重复支付");
    expect(parsed.manualOverride).toBe(false);
    expect(parsed.downgraded).toBe(false);
  });

  it("fail 落在非白名单维度 → 降级 warn 放行，理由保留（路径1，原守卫死区）", () => {
    const parsed = parseAiGateTaskResult(
      runnerEnvelope(
        "reject",
        [
          { dimension: "data_consistency", status: "fail", detail: "合同编号与附件不一致" },
          { dimension: "subject_match", status: "pass" }
        ],
        "申请合同编号与附件编号不一致"
      ),
      { bizType: "outbound_contract" }
    );
    expect(parsed.outcome).toBe("approve");
    expect(parsed.decision).toBe("warn");
    expect(parsed.downgraded).toBe(true);
    expect(parsed.needsHumanReview).toBe(true);
    expect(parsed.comment).toContain("AI审查放行（需人工重点关注）");
    expect(parsed.comment).toContain("data_consistency");
    expect(parsed.comment).toContain("降级");
  });

  it("reject 无任何 fail 级 finding → 降级（路径1守卫生效）", () => {
    const parsed = parseAiGateTaskResult(
      runnerEnvelope("reject", [{ dimension: "overpayment", status: "warn", detail: "存疑" }]),
      { bizType: "payment_request" }
    );
    expect(parsed.outcome).toBe("approve");
    expect(parsed.decision).toBe("warn");
    expect(parsed.downgraded).toBe(true);
    expect(parsed.comment).toContain("降级");
  });

  it("白名单维度但业务域不匹配 → 降级（subject_match 不在付款域白名单）", () => {
    const parsed = parseAiGateTaskResult(
      runnerEnvelope("reject", [{ dimension: "subject_match", status: "fail" }]),
      { bizType: "payment_request" }
    );
    expect(parsed.outcome).toBe("approve");
    expect(parsed.downgraded).toBe(true);
  });

  it("bizType 缺失 → 空白名单，reject 一律降级（fail-open 偏置）", () => {
    const parsed = parseAiGateTaskResult(
      runnerEnvelope("reject", [{ dimension: "duplicate_payment", status: "fail" }])
    );
    expect(parsed.outcome).toBe("approve");
    expect(parsed.downgraded).toBe(true);
  });

  it("manual_override 的 reject 绕过白名单（超管刹车，无 findings 也保留）", () => {
    const parsed = parseAiGateTaskResult(
      envelope("超级管理员手动处理AI关卡", {
        outcome: "reject",
        decision: "reject",
        manual_override: true,
        comment: "管理员驳回"
      }),
      { bizType: "payment_request" }
    );
    expect(parsed.outcome).toBe("reject");
    expect(parsed.decision).toBe("reject");
    expect(parsed.manualOverride).toBe(true);
    expect(parsed.downgraded).toBe(false);
    expect(parsed.comment).toBe("管理员驳回");
  });

  it("manual_override 覆写 reject 但残留 decision=pass 时展示 reject", () => {
    const parsed = parseAiGateTaskResult(
      envelope("{}", {
        outcome: "reject",
        decision: "pass",
        manual_override: true,
        comment: "管理员驳回"
      }),
      { bizType: "outbound_contract" }
    );
    expect(parsed.outcome).toBe("reject");
    expect(parsed.decision).toBe("reject");
  });

  it("approve 结论不做白名单检查，原样通过", () => {
    const parsed = parseAiGateTaskResult(
      runnerEnvelope("pass", [{ dimension: "duplicate_payment", status: "pass" }], "未见异常"),
      { bizType: "payment_request" }
    );
    expect(parsed.outcome).toBe("approve");
    expect(parsed.decision).toBe("pass");
    expect(parsed.downgraded).toBe(false);
  });

  it("warn 判定标记需人工关注", () => {
    const parsed = parseAiGateTaskResult(
      envelope("{}", {
        outcome: "approve",
        decision: "warn",
        comment: "AI审查放行（需人工重点关注）：缺发票",
        needs_human_review: true
      }),
      { bizType: "payment_request" }
    );
    expect(parsed.outcome).toBe("approve");
    expect(parsed.decision).toBe("warn");
    expect(parsed.needsHumanReview).toBe(true);
  });

  it("metadata 无 risk_level 时从 output JSON 兜底", () => {
    const parsed = parseAiGateTaskResult(
      envelope('{"decision":"pass","risk_level":"medium","summary":"s"}', {
        outcome: "approve",
        decision: "pass",
        comment: "AI审查通过：s"
      }),
      { bizType: "payment_request" }
    );
    expect(parsed.riskLevel).toBe("medium");
  });
});

describe("parseAiGateTaskResult — output 兜底路径（旧版 runner 直出模型 JSON）", () => {
  it("白名单内 fail 的 reject 保留（含 markdown 围栏）", () => {
    const modelJson =
      '```json\n{"decision":"reject","risk_level":"high","summary":"疑似重复付款","findings":[{"dimension":"duplicate_payment","status":"fail","detail":"两笔同额同日","evidence":"FK-1/FK-2"}],"suggestions":["人工核对"]}\n```';
    const parsed = parseAiGateTaskResult(envelope(modelJson), {
      bizType: "payment_request"
    });
    expect(parsed.outcome).toBe("reject");
    expect(parsed.explicitOutcome).toBe(true);
    expect(parsed.comment).toContain("AI审查不通过");
    expect(parsed.comment).toContain("duplicate_payment");
  });

  it("非白名单维度 fail 的 reject → 降级", () => {
    const parsed = parseAiGateTaskResult(
      envelope(gateOutput("reject", [{ dimension: "material_consistency", status: "fail" }])),
      { bizType: "payment_request" }
    );
    expect(parsed.outcome).toBe("approve");
    expect(parsed.decision).toBe("warn");
    expect(parsed.downgraded).toBe(true);
  });

  it("解析旧 DB 模板契约 {outcome, comment} 的 approve", () => {
    const parsed = parseAiGateTaskResult(
      envelope('{"outcome":"approve","comment":"审查摘要：正常；结论依据：无异常"}'),
      { bizType: "payment_request" }
    );
    expect(parsed.outcome).toBe("approve");
    expect(parsed.explicitOutcome).toBe(true);
    expect(parsed.decision).toBe("pass");
  });

  it("守卫：reject 但 findings 无 fail 级证据 → 降级放行并标注", () => {
    const modelJson =
      '{"decision":"reject","summary":"感觉有问题","findings":[{"dimension":"overpayment","status":"warn","detail":"存疑","evidence":"e"}]}';
    const parsed = parseAiGateTaskResult(envelope(modelJson), {
      bizType: "payment_request"
    });
    expect(parsed.outcome).toBe("approve");
    expect(parsed.decision).toBe("warn");
    expect(parsed.needsHumanReview).toBe(true);
    expect(parsed.comment).toContain("降级");
  });

  it("旧契约无 findings 的 reject 也降级（无证据即无拦截权，行为收紧）", () => {
    const parsed = parseAiGateTaskResult(envelope('{"outcome":"reject","comment":"高风险"}'), {
      bizType: "payment_request"
    });
    expect(parsed.outcome).toBe("approve");
    expect(parsed.decision).toBe("warn");
    expect(parsed.downgraded).toBe(true);
    expect(parsed.comment).toContain("降级");
  });

  it("新契约（decision 键）缺 findings 的 reject 降级放行", () => {
    const parsed = parseAiGateTaskResult(envelope('{"decision":"reject","summary":"感觉有问题"}'), {
      bizType: "payment_request"
    });
    expect(parsed.outcome).toBe("approve");
    expect(parsed.decision).toBe("warn");
    expect(parsed.needsHumanReview).toBe(true);
  });
});

describe("parseAiGateTaskResult — fail-open 路径", () => {
  it("null 输入返回默认放行且 explicitOutcome=false", () => {
    const parsed = parseAiGateTaskResult(null);
    expect(parsed.outcome).toBe("approve");
    expect(parsed.explicitOutcome).toBe(false);
    expect(parsed.needsHumanReview).toBe(true);
    expect(parsed.manualOverride).toBe(false);
  });

  it("散文输出放行但携带可读文本提示人工复核", () => {
    const parsed = parseAiGateTaskResult(envelope("我觉得这个申请没什么问题。"), {
      bizType: "payment_request"
    });
    expect(parsed.outcome).toBe("approve");
    expect(parsed.explicitOutcome).toBe(false);
    expect(parsed.comment).toContain("请人工复核");
    expect(parsed.comment).toContain("我觉得这个申请没什么问题");
  });

  it("完全非法 JSON 使用 fallback 文案", () => {
    const parsed = parseAiGateTaskResult("not-json", {
      fallbackComment: "AI关卡已执行"
    });
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

/**
 * 回溯 fixture：生产历史 7 次结构化驳回在新规则下的判定
 * （SP-20260708-0003 为旧格式散文"驳回"，走 fail-open 路径，单独测）。
 * 维度/status 取自 task_queue.result_json 实录。
 */
describe("parseAiGateTaskResult — 历史驳回回溯", () => {
  const cases: Array<{
    name: string;
    bizType: string;
    findings: FindingSpec[];
    expected: "reject" | "approve";
  }> = [
    {
      name: "SP-20260811-0003 附件甲方非我方主体（真拦截）",
      bizType: "outbound_contract",
      findings: [
        { dimension: "subject_match", status: "fail", detail: "附件甲方非本合同我方主体" },
        { dimension: "performance_risk", status: "warn" }
      ],
      expected: "reject"
    },
    {
      name: "SP-20260812-0001 柴油串钢材合同（真拦截）",
      bizType: "payment_request",
      findings: [
        { dimension: "counterparty_consistency", status: "fail", detail: "柴油合同供方与收款方不一致" },
        { dimension: "material_consistency", status: "fail", detail: "主合同为钢材，申请为柴油" }
      ],
      expected: "reject"
    },
    {
      name: "SP-20260811-0002 编造维度 contract_identity_consistency（误杀）",
      bizType: "outbound_contract",
      findings: [
        { dimension: "contract_identity_consistency", status: "fail", detail: "附件编号和日期与录入不一致" },
        { dimension: "performance_risk", status: "warn" }
      ],
      expected: "approve"
    },
    {
      name: "SP-20260811-0004 串域维度 data_consistency（误杀）",
      bizType: "outbound_contract",
      findings: [
        { dimension: "data_consistency", status: "fail", detail: "合同编号与附件不一致" },
        { dimension: "clause_completeness", status: "warn" },
        { dimension: "performance_risk", status: "warn" }
      ],
      expected: "approve"
    },
    {
      name: "SP-20260813-0005 material_consistency 名下越权付款节点检查（误杀）",
      bizType: "payment_request",
      findings: [
        { dimension: "material_consistency", status: "fail", detail: "付款金额不符合合同约定付款节点" },
        { dimension: "frequency_anomaly", status: "warn" }
      ],
      expected: "approve"
    },
    {
      name: "SP-20260805-0001 amount_terms（owner 权衡后保留拦截权）",
      bizType: "outbound_contract",
      findings: [
        { dimension: "amount_terms", status: "fail", detail: "合同未载明30000元总额或单价" },
        { dimension: "performance_risk", status: "fail" },
        { dimension: "clause_completeness", status: "warn" }
      ],
      expected: "reject"
    },
    {
      name: "SP-20260805-0002 amount_terms + 串域 material（amount_terms 使其保留拦截）",
      bizType: "outbound_contract",
      findings: [
        { dimension: "amount_terms", status: "fail", detail: "附件无总额或单价" },
        { dimension: "material_consistency", status: "fail", detail: "设备描述不一致" },
        { dimension: "performance_risk", status: "warn" }
      ],
      expected: "reject"
    }
  ];

  it.each(cases)("$name → $expected", ({ bizType, findings, expected }) => {
    const parsed = parseAiGateTaskResult(runnerEnvelope("reject", findings), { bizType });
    expect(parsed.outcome).toBe(expected);
    if (expected === "approve") {
      expect(parsed.decision).toBe("warn");
      expect(parsed.downgraded).toBe(true);
    } else {
      expect(parsed.decision).toBe("reject");
      expect(parsed.downgraded).toBe(false);
    }
  });

  it("SP-20260708-0003 旧格式散文驳回 → fail-open 放行提示人工", () => {
    const parsed = parseAiGateTaskResult(envelope("驳回"), { bizType: "outbound_contract" });
    expect(parsed.outcome).toBe("approve");
    expect(parsed.explicitOutcome).toBe(false);
  });
});
