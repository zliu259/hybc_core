/**
 * 付款风控 / 合同审查结果的服务端兜底计分。
 *
 * 正常路径由 task-runner 的 postprocess.py 确定性计分；但 runner 是外部
 * docker 节点、不随 push 部署——「旧 runner + 新提示词模板」窗口内模型只输出
 * findings/clause_analysis（模板禁止模型自打分），结果会以无分数状态永久落库。
 * 本模块在 completeTask 落库前做同规则的最后一道规范化。
 *
 * 权重与分档必须与 task-runner/runner/postprocess.py 保持一致：
 * finding warn=20 / fail=50；clause medium=20 / high=50；0-19 低 / 20-49 中 / ≥50 高。
 */

const FINDING_WEIGHTS: Record<string, number> = { pass: 0, warn: 20, fail: 50 };
const CLAUSE_WEIGHTS: Record<string, number> = { low: 0, medium: 20, high: 50 };

// 与 task-runner postprocess.py DIMENSION_LABELS / web utils/ai-review.ts 同步
const DIMENSION_LABELS: Record<string, string> = {
  duplicate_payment: "重复支付",
  overpayment: "超付核验",
  frequency_anomaly: "频率异常",
  counterparty_consistency: "收款方一致性",
  material_consistency: "材料一致性",
  clause_completeness: "条款完整性",
  amount_terms: "金额条款",
  counterparty_info: "相对方信息",
  performance_risk: "履约风险",
  item_precheck: "预审汇总",
  duplicate_invoice: "重复票据",
  amount_reasonableness: "金额合理性",
  data_consistency: "数据一致性",
  completeness: "材料完整性",
  compliance: "合规性"
};

const riskLevelForScore = (score: number): "low" | "medium" | "high" => {
  if (score >= 50) return "high";
  if (score >= 20) return "medium";
  return "low";
};

const parseObject = (raw: string): Record<string, unknown> | null => {
  const stripped = raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  const candidates = [stripped];
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start >= 0 && end > start) candidates.push(stripped.slice(start, end + 1));
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

const normalizeFindingStatus = (raw: unknown): "pass" | "warn" | "fail" => {
  const status = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (status === "pass" || status === "ok" || status === "normal" || status === "low") {
    return "pass";
  }
  if (status === "fail" || status === "failed" || status === "high" || status === "error") {
    return "fail";
  }
  return "warn";
};

const hasNumericScore = (parsed: Record<string, unknown>): boolean =>
  typeof parsed.score === "number" && Number.isFinite(parsed.score);

/**
 * 付款风控输出兜底计分：仅当结果带 findings 数组且无数值 score 时改写，
 * 其余（已计分的新结果 / 旧 schema）原样返回。
 */
export const normalizePaymentRiskOutput = (raw: string): string => {
  const parsed = parseObject(raw);
  if (!parsed || hasNumericScore(parsed) || !Array.isArray(parsed.findings)) {
    return raw;
  }

  let score = 0;
  const scoreBasis: string[] = [];
  const findings = parsed.findings
    .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    .map((item) => {
      const status = normalizeFindingStatus(item.status);
      const dimension = typeof item.dimension === "string" ? item.dimension : "unknown";
      const detail = typeof item.detail === "string" ? item.detail : "";
      const weight = FINDING_WEIGHTS[status];
      score += weight;
      if (weight > 0) {
        const label = DIMENSION_LABELS[dimension] ?? dimension;
        scoreBasis.push(`+${weight} ${label}：${detail || label}`);
      }
      return {
        dimension,
        status,
        detail,
        evidence: typeof item.evidence === "string" ? item.evidence : ""
      };
    });
  score = Math.min(score, 100);

  return JSON.stringify({
    overall_risk: riskLevelForScore(score),
    score,
    score_basis: scoreBasis,
    summary: typeof parsed.summary === "string" ? parsed.summary : "",
    findings,
    recommendations: Array.isArray(parsed.recommendations)
      ? parsed.recommendations.filter((item): item is string => typeof item === "string")
      : []
  });
};

/**
 * 合同审查输出兜底计分：仅当结果带 clause_analysis 数组且无数值 score 时改写。
 */
export const normalizeContractReviewOutput = (raw: string): string => {
  const parsed = parseObject(raw);
  if (!parsed || hasNumericScore(parsed) || !Array.isArray(parsed.clause_analysis)) {
    return raw;
  }

  let score = 0;
  const scoreBasis: string[] = [];
  const clauses = parsed.clause_analysis
    .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    .map((item) => {
      const levelRaw = typeof item.risk_level === "string" ? item.risk_level.toLowerCase() : "";
      const level = levelRaw === "low" || levelRaw === "medium" || levelRaw === "high" ? levelRaw : "medium";
      const weight = CLAUSE_WEIGHTS[level];
      score += weight;
      const clause = typeof item.clause === "string" ? item.clause : "";
      const issue = typeof item.issue === "string" ? item.issue : "";
      if (weight > 0) {
        scoreBasis.push(`+${weight} ${clause || "未命名条款"}：${issue || level}`);
      }
      return {
        clause,
        risk_level: level,
        issue,
        suggestion: typeof item.suggestion === "string" ? item.suggestion : ""
      };
    });
  score = Math.min(score, 100);

  return JSON.stringify({
    overall_risk: riskLevelForScore(score),
    score,
    score_basis: scoreBasis,
    summary: typeof parsed.summary === "string" ? parsed.summary : "",
    clause_analysis: clauses,
    amount_assessment:
      parsed.amount_assessment && typeof parsed.amount_assessment === "object"
        ? parsed.amount_assessment
        : {},
    recommendations: Array.isArray(parsed.recommendations)
      ? parsed.recommendations.filter((item): item is string => typeof item === "string")
      : []
  });
};
