/**
 * AI 关卡（approval_ai_gate）任务结果的唯一解析出口 + 拦截权裁决点。
 *
 * 此前 executors.ts / queue-handler.ts / engine.ts / ai-slot.ts 各自维护
 * 只读 metadata.outcome 的解析副本 —— 而真实 provider 从不写该字段，
 * 导致生产上 AI 关卡永远 fail-open 放行。本模块统一解析并补上兜底路径：
 *   1. 优先读 metadata（新版 task-runner postprocess 的规范化输出）；
 *   2. 兜底容错解析 output 里的模型原始 JSON（旧版 runner / DB 模板直出）；
 *   3. 全部失败时保持 fail-open（approve），但标记 explicitOutcome=false
 *      并生成提示人工复核的意见，不再静默放行。
 *
 * 分级拦截（2026-08-14，设计文档 docs/superpowers/specs/2026-08-14-ai-gate-tiered-block-design.md）：
 * AI 的 reject 只有在【存在 fail 级 finding 且其 dimension 落在该业务域的
 * 拦截白名单内】时才可执行；否则降级为 warn 放行 + 人工关注，理由保留。
 * 背景：历史 8 次 reject 中 6 次靠编造维度（contract_identity_consistency）、
 * 串域维度（合同域的 data_consistency）或合法维度名下的越权检查
 * （material_consistency 名下做付款节点核对）达成 —— 白名单在代码侧硬裁决，
 * 不信任模型自律。两条路径都过白名单（此前 fail 证据守卫只在路径2，
 * 现行 runner 走路径1，守卫实为死代码）。
 *
 * 唯一豁免：metadata.manual_override === true（超管人工覆写，是人的决定）。
 * bizType 未知 → 空白名单（fail-open 偏置：宁可放给人工，不可错拦）。
 */

export type AiGateDecision = "pass" | "warn" | "reject";

/**
 * 拦截白名单：仅这些维度的 fail 有资格触发 reject 执行。
 * 精确字符串匹配 —— 编造维度 / 串域维度天然落空。
 * 依据历史战绩（详见设计文档回溯表）；报销等其余业务域留空 = AI 纯建议。
 * 同步契约：task-runner/runner/postprocess.py BLOCK_CAPABLE_DIMENSIONS 保持一致。
 */
export const AI_GATE_BLOCK_DIMENSIONS: Readonly<Record<string, readonly string[]>> = {
  outbound_contract: ["subject_match", "amount_terms"],
  inbound_contract: ["subject_match", "amount_terms"],
  payment_request: ["duplicate_payment", "overpayment", "counterparty_consistency"]
};

const NOTE_NO_FAIL_EVIDENCE =
  "（AI给出拒绝结论但未提供fail级证据，已降级为放行+人工关注）";
const NOTE_OUT_OF_SCOPE =
  "（AI拒绝意见超出该业务可拦截维度范围，已降级为放行+人工关注）";

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
  /** metadata.manual_override === true：超管人工覆写，绕过拦截白名单 */
  manualOverride: boolean;
  /** AI 的 reject 结论被白名单裁决降级为 warn 放行 */
  downgraded: boolean;
}

export interface ParseAiGateOptions {
  /**
   * 审批实例的真实业务类型（approval_instance.biz_type / payload.biz_type）。
   * 决定拦截白名单；缺失时按空白名单处理（AI 纯建议）。
   */
  bizType?: string | null;
  /** 完全无法解析时的意见文案 */
  fallbackComment?: string;
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

/** 白名单裁决：是否存在有拦截资格的 fail 级 finding。 */
const hasBlockCapableFail = (
  findings: NormalizedFinding[] | null,
  bizType: string | null | undefined
): boolean => {
  if (!findings || !bizType) return false;
  const allowed = AI_GATE_BLOCK_DIMENSIONS[bizType] ?? [];
  if (allowed.length === 0) return false;
  return findings.some((f) => f.status === "fail" && allowed.includes(f.dimension));
};

/** 降级附注：区分「无 fail 证据」与「fail 超出可拦截范围」两种情况。 */
const downgradeNoteFor = (findings: NormalizedFinding[] | null): string =>
  (findings ?? []).some((f) => f.status === "fail") ? NOTE_OUT_OF_SCOPE : NOTE_NO_FAIL_EVIDENCE;

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
  downgradeNote: string | null
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
    // 前缀是跨端契约：web utils/ai-review.ts 与 miniapp approval-detail 按前缀推断三态
    const base = `AI审查放行（需人工重点关注）：${summary ?? "存在待人工确认的疑点"}`;
    const withConcerns = concerns ? `${base}｜关注点：${concerns}` : base;
    return downgradeNote ? `${withConcerns}${downgradeNote}` : withConcerns;
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
  needsHumanReview: true,
  manualOverride: false,
  downgraded: false
});

/**
 * 解析 task_queue.result_json（runner 提交的 {output, metadata, ...} 信封）
 * 并对 reject 结论做拦截白名单裁决。
 */
export const parseAiGateTaskResult = (
  resultJson: string | null,
  options: ParseAiGateOptions = {}
): ParsedAiGateResult => {
  const bizType = options.bizType ?? null;
  const fallbackComment =
    options.fallbackComment ?? "AI关卡已完成（结果无法解析，请人工复核）";

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
  const manualOverride = metadata.manual_override === true;

  // 路径 1：新版 runner 已在 metadata 写入规范化结论
  const metadataOutcome = asString(metadata.outcome);
  if (metadataOutcome === "approve" || metadataOutcome === "reject") {
    const output = tolerantParseObject(envelope.output);
    const summary = asString(metadata.summary) ?? asString(output?.summary);
    // 偏斜兜底：旧 runner 不写 metadata.risk_level 时从 output JSON 补
    const riskLevel = asRiskLevel(metadata.risk_level) ?? asRiskLevel(output?.risk_level);
    const recommendations = asStringArray(metadata.recommendations);

    // 拦截白名单裁决：AI 自主 reject 必须有白名单内维度的 fail 证据；
    // 超管覆写（manual_override）是人的决定，完全豁免。
    if (metadataOutcome === "reject" && !manualOverride) {
      const findings = normalizeFindings(output?.findings);
      if (!hasBlockCapableFail(findings, bizType)) {
        return {
          outcome: "approve",
          explicitOutcome: true,
          decision: "warn",
          riskLevel,
          summary,
          comment: buildComment("warn", summary, findings, downgradeNoteFor(findings)),
          recommendations,
          needsHumanReview: true,
          manualOverride: false,
          downgraded: true
        };
      }
    }

    let decision =
      normalizeDecision(metadata.decision) ?? (metadataOutcome === "reject" ? "reject" : "pass");
    // outcome 是可执行事实（admin 手工覆写只改 outcome），decision 与其矛盾时以 outcome 为准
    if (metadataOutcome === "reject" && decision !== "reject") decision = "reject";
    if (metadataOutcome === "approve" && decision === "reject") decision = "pass";
    return {
      outcome: metadataOutcome,
      explicitOutcome: true,
      decision,
      riskLevel,
      summary,
      comment:
        asString(metadata.comment) ?? summary ?? buildComment(decision, summary, null, null),
      recommendations,
      needsHumanReview: metadata.needs_human_review === true || decision === "warn",
      manualOverride,
      downgraded: false
    };
  }

  // 路径 2：兜底解析模型原始输出（旧版 runner 不写 metadata.outcome）
  const output = tolerantParseObject(envelope.output);
  if (output) {
    const rawDecision =
      normalizeDecision(output.decision) ?? normalizeDecision(output.outcome);
    if (rawDecision) {
      const findings = normalizeFindings(output.findings);
      // 与路径 1 同一白名单规则：reject 必须有白名单内 fail 证据，否则降级。
      // （旧契约 {outcome:"reject"} 无 findings 概念 → 无证据即无拦截权，
      //   较重构前收紧；runner 侧 postprocess.py 同步同一规则。）
      const guardDowngraded = rawDecision === "reject" && !hasBlockCapableFail(findings, bizType);
      const decision: AiGateDecision = guardDowngraded ? "warn" : rawDecision;
      const summary = asString(output.summary) ?? asString(output.comment);
      return {
        outcome: decision === "reject" ? "reject" : "approve",
        explicitOutcome: true,
        decision,
        riskLevel: asRiskLevel(output.risk_level),
        summary,
        comment: buildComment(
          decision,
          summary,
          findings,
          guardDowngraded ? downgradeNoteFor(findings) : null
        ),
        recommendations: asStringArray(output.suggestions ?? output.recommendations),
        needsHumanReview: decision === "warn",
        manualOverride,
        downgraded: guardDowngraded
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
