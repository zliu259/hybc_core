/**
 * AI 关卡（approval_ai_gate）任务结果的唯一解析出口。
 *
 * 此前 executors.ts / queue-handler.ts / engine.ts / ai-slot.ts 各自维护
 * 只读 metadata.outcome 的解析副本 —— 而真实 provider 从不写该字段，
 * 导致生产上 AI 关卡永远 fail-open 放行。本模块统一解析并补上兜底路径：
 *   1. 优先读 metadata（新版 task-runner postprocess 的规范化输出）；
 *   2. 兜底容错解析 output 里的模型原始 JSON（旧版 runner / DB 模板直出）；
 *   3. 全部失败时保持 fail-open（approve），但标记 explicitOutcome=false
 *      并生成提示人工复核的意见，不再静默放行。
 *
 * 守卫：reject 结论若带有 findings 数组却无 fail 级证据，降级为 warn 放行，
 * 防止模型幻觉直接终止审批流（与 runner 侧 postprocess 同一规则）。
 */

export type AiGateDecision = "pass" | "warn" | "reject";

export interface ParsedAiGateResult {
  outcome: "approve" | "reject";
  /** outcome 是否来自可解析的数据（false = fail-open 默认值） */
  explicitOutcome: boolean;
  decision: AiGateDecision | null;
  riskLevel: "low" | "medium" | "high" | null;
  summary: string | null;
  comment: string;
  recommendations: string[];
  needsHumanReview: boolean;
}

interface ResultEnvelope {
  output?: unknown;
  metadata?: Record<string, unknown>;
}

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];

const asRiskLevel = (value: unknown): "low" | "medium" | "high" | null => {
  return value === "low" || value === "medium" || value === "high" ? value : null;
};

/** 容错解析模型输出：剥 Markdown 代码块、截取首尾花括号。 */
const tolerantParseObject = (raw: unknown): Record<string, unknown> | null => {
  if (typeof raw !== "string" || raw.trim().length === 0) return null;
  const stripped = raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  const candidates = [stripped];
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start >= 0 && end > start) {
    candidates.push(stripped.slice(start, end + 1));
  }
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // try next candidate
    }
  }
  return null;
};

interface NormalizedFinding {
  dimension: string;
  status: "pass" | "warn" | "fail";
  detail: string;
}

const normalizeFindings = (raw: unknown): NormalizedFinding[] | null => {
  if (!Array.isArray(raw)) return null;
  const findings: NormalizedFinding[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const statusRaw = asString(row.status)?.toLowerCase() ?? "";
    const status: NormalizedFinding["status"] =
      statusRaw === "pass" || statusRaw === "ok" || statusRaw === "normal"
        ? "pass"
        : statusRaw === "fail" || statusRaw === "failed" || statusRaw === "high" || statusRaw === "error"
          ? "fail"
          : "warn";
    findings.push({
      dimension: asString(row.dimension) ?? "unknown",
      status,
      detail: asString(row.detail) ?? asString(row.evidence) ?? ""
    });
  }
  return findings;
};

const normalizeDecision = (value: unknown): AiGateDecision | null => {
  const raw = asString(value)?.toLowerCase() ?? "";
  if (raw === "reject" || raw === "rejected" || raw === "deny") return "reject";
  if (raw === "pass" || raw === "approve" || raw === "approved" || raw === "ok") return "pass";
  if (raw === "warn" || raw === "warning") return "warn";
  return null;
};

const buildComment = (
  decision: AiGateDecision,
  summary: string | null,
  findings: NormalizedFinding[] | null,
  guardDowngraded: boolean
): string => {
  const concerns = (findings ?? [])
    .filter((f) => f.status !== "pass")
    .slice(0, 3)
    .map((f) => (f.detail ? `${f.dimension}：${f.detail}` : f.dimension))
    .join("；");

  if (decision === "reject") {
    const base = `AI审查不通过：${summary ?? "存在高风险问题"}`;
    return concerns ? `${base}｜依据：${concerns}` : base;
  }
  if (decision === "warn") {
    const base = `AI审查放行（需人工重点关注）：${summary ?? "存在待人工确认的疑点"}`;
    const withConcerns = concerns ? `${base}｜关注点：${concerns}` : base;
    return guardDowngraded
      ? `${withConcerns}（AI给出拒绝结论但未提供fail级证据，已降级为放行+人工关注）`
      : withConcerns;
  }
  return `AI审查通过：${summary ?? "各项检查未见异常"}`;
};

const failOpenResult = (comment: string): ParsedAiGateResult => ({
  outcome: "approve",
  explicitOutcome: false,
  decision: null,
  riskLevel: null,
  summary: null,
  comment,
  recommendations: [],
  needsHumanReview: true
});

/**
 * 解析 task_queue.result_json（runner 提交的 {output, metadata, ...} 信封）。
 * @param fallbackComment 完全无法解析时的意见文案
 */
export const parseAiGateTaskResult = (
  resultJson: string | null,
  fallbackComment = "AI关卡已完成（结果无法解析，请人工复核）"
): ParsedAiGateResult => {
  if (!resultJson) return failOpenResult(fallbackComment);

  let envelope: ResultEnvelope;
  try {
    const parsed = JSON.parse(resultJson) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return failOpenResult(fallbackComment);
    }
    envelope = parsed as ResultEnvelope;
  } catch {
    return failOpenResult(fallbackComment);
  }

  const metadata =
    envelope.metadata && typeof envelope.metadata === "object" ? envelope.metadata : {};

  // 路径 1：新版 runner 已在 metadata 写入规范化结论
  const metadataOutcome = asString(metadata.outcome);
  if (metadataOutcome === "approve" || metadataOutcome === "reject") {
    let decision =
      normalizeDecision(metadata.decision) ?? (metadataOutcome === "reject" ? "reject" : "pass");
    // outcome 是可执行事实（admin 手工覆写只改 outcome），decision 与其矛盾时以 outcome 为准
    if (metadataOutcome === "reject" && decision !== "reject") decision = "reject";
    if (metadataOutcome === "approve" && decision === "reject") decision = "pass";
    const summary = asString(metadata.summary);
    // 偏斜兜底：旧 runner 不写 metadata.risk_level 时从 output JSON 补
    const riskLevel =
      asRiskLevel(metadata.risk_level) ??
      asRiskLevel(tolerantParseObject(envelope.output)?.risk_level);
    return {
      outcome: metadataOutcome,
      explicitOutcome: true,
      decision,
      riskLevel,
      summary,
      comment:
        asString(metadata.comment) ?? summary ?? buildComment(decision, summary, null, false),
      recommendations: asStringArray(metadata.recommendations),
      needsHumanReview: metadata.needs_human_review === true || decision === "warn",
      };
  }

  // 路径 2：兜底解析模型原始输出（旧版 runner 不写 metadata.outcome）
  const output = tolerantParseObject(envelope.output);
  if (output) {
    const isNewContract = normalizeDecision(output.decision) !== null;
    const rawDecision =
      normalizeDecision(output.decision) ?? normalizeDecision(output.outcome);
    if (rawDecision) {
      const findings = normalizeFindings(output.findings);
      // 守卫只对能验证证据的结果生效（新契约或带 findings 数组的输出）；
      // 旧契约 {outcome:"reject"} 无 findings 概念，reject 必须保留——
      // 与 runner 侧 postprocess.py 同一规则，两侧改动必须同步。
      const guardApplies = isNewContract || findings !== null;
      const guardDowngraded =
        rawDecision === "reject" &&
        guardApplies &&
        !(findings ?? []).some((f) => f.status === "fail");
      const decision: AiGateDecision = guardDowngraded ? "warn" : rawDecision;
      const summary = asString(output.summary) ?? asString(output.comment);
      return {
        outcome: decision === "reject" ? "reject" : "approve",
        explicitOutcome: true,
        decision,
        riskLevel: asRiskLevel(output.risk_level),
        summary,
        comment: buildComment(decision, summary, findings, guardDowngraded),
        recommendations: asStringArray(output.suggestions ?? output.recommendations),
        needsHumanReview: decision === "warn"
      };
    }
  }

  // 路径 3：全部失败 → fail-open，但把可读文本带给人工
  // （前缀是跨端契约：前端据 "AI审查放行" 前缀推断 warn 三态）
  const readable =
    asString(metadata.comment) ??
    asString(metadata.summary) ??
    (typeof envelope.output === "string" ? asString(envelope.output) : null);
  return failOpenResult(
    readable
      ? `AI审查放行（需人工重点关注）：结果无结构化结论，请人工复核｜${readable.slice(0, 200)}`
      : fallbackComment
  );
};
