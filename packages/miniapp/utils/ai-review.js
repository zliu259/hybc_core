/**
 * 业务级 AI 审查报告（合同审查 contract.ai_review_result /
 * 付款风控 payment_request.ai_risk_result）的小程序展示口径，
 * 与 packages/web/src/utils/ai-review.ts + components/AiReviewReport 对齐。
 *
 * 存量同时存在两代形状（后端 postprocess 对旧结果原样透传），所有字段按可选
 * 处理并归一成同一套视图模型；WXML 不能调用 JS 函数，标签/主题/列表必须在这里算完。
 */

/** 检查维度中文名（与 task-runner/runner/prompts.py 的维度标识对应） */
const FINDING_DIMENSION_LABELS = {
  duplicate_payment: "重复支付",
  overpayment: "超付核验",
  frequency_anomaly: "频率异常",
  counterparty_consistency: "收款方一致性",
  material_consistency: "材料一致性",
  clause_completeness: "条款完整性",
  amount_terms: "金额条款",
  counterparty_info: "相对方信息",
  subject_match: "签约主体",
  performance_risk: "履约风险",
  item_precheck: "预审汇总",
  duplicate_invoice: "重复票据",
  amount_reasonableness: "金额合理性",
  data_consistency: "数据一致性",
  completeness: "材料完整性",
  compliance: "合规性"
};

const FINDING_STATUS_LABELS = {
  pass: "通过",
  warn: "关注",
  fail: "异常"
};

const FINDING_STATUS_THEMES = {
  pass: "success",
  warn: "warning",
  fail: "danger"
};

const RISK_LEVEL_LABELS = {
  low: "低",
  medium: "中",
  high: "高"
};

const RISK_LEVEL_THEMES = {
  low: "success",
  medium: "warning",
  high: "danger"
};

/** t-tag 没有 info 主题，未知取值一律落到中性色 */
const NEUTRAL_THEME = "default";

const REPORT_TITLES = {
  contract: "合同AI审查报告",
  payment: "付款AI风控报告"
};

/** 旧付款形状的三段检查 → 等价 findings 行（新形状用 findings 数组） */
const LEGACY_PAYMENT_CHECKS = [
  { field: "frequency_check", dimension: "frequency_anomaly", abnormalField: "is_abnormal" },
  { field: "amount_check", dimension: "overpayment", abnormalField: "is_abnormal" },
  { field: "duplicate_check", dimension: "duplicate_payment", abnormalField: "found_duplicates" }
];

const isPlainObject = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const asString = (value) => (typeof value === "string" ? value.trim() : "");

const asStringList = (value) =>
  Array.isArray(value)
    ? value.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim())
    : [];

/** WXML 列表需要稳定唯一 key，文本可能重复，用下标前缀兜底 */
const toKeyedTextRows = (list, prefix) =>
  list.map((text, index) => ({ key: `${prefix}-${index}`, text }));

/**
 * 安全查表：模型输出的 dimension/status 是不可信字符串，直接 obj[key] 命中
 * "constructor"/"toString" 这类原型键会拿到函数，setData 后该行整片渲染空白。
 */
const lookup = (table, key, fallback) => {
  if (typeof key !== "string" || !key) return fallback;
  return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : fallback;
};

const toFindingDimensionLabel = (dimension) =>
  typeof dimension === "string" && dimension
    ? lookup(FINDING_DIMENSION_LABELS, dimension, dimension)
    : "-";

const toFindingStatusLabel = (status) =>
  typeof status === "string" && status
    ? lookup(FINDING_STATUS_LABELS, status, status)
    : "-";

const toFindingStatusTheme = (status) =>
  lookup(FINDING_STATUS_THEMES, status, NEUTRAL_THEME);

const toRiskLevelLabel = (value) =>
  typeof value === "string" && value
    ? lookup(RISK_LEVEL_LABELS, value, value)
    : "-";

const toRiskLevelTheme = (value) => lookup(RISK_LEVEL_THEMES, value, NEUTRAL_THEME);

/** 风险分档（与后端 postprocess 一致：0-19 低 / 20-49 中 / ≥50 高） */
const toRiskScoreBandLabel = (score) => {
  if (typeof score !== "number" || !isFinite(score)) return "";
  if (score >= 50) return "高风险（≥50）";
  if (score >= 20) return "中风险（20-49）";
  return "低风险（0-19）";
};

const toRiskScoreBandTheme = (score) => {
  if (typeof score !== "number" || !isFinite(score)) return NEUTRAL_THEME;
  if (score >= 50) return "danger";
  if (score >= 20) return "warning";
  return "success";
};

/** 容错解析：剥 markdown 围栏、截取首尾花括号，失败返回 null 而不抛 */
const parseAiReportJson = (text) => {
  if (typeof text !== "string") return null;
  const stripped = text
    .trim()
    .replace(/^```(?:json)?\s*|\s*```$/g, "")
    .trim();
  if (!stripped) return null;
  const candidates = [stripped];
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start >= 0 && end > start) {
    candidates.push(stripped.slice(start, end + 1));
  }
  for (let i = 0; i < candidates.length; i += 1) {
    try {
      const parsed = JSON.parse(candidates[i]);
      if (isPlainObject(parsed)) return parsed;
    } catch {
      // 换下一个候选继续尝试
    }
  }
  return null;
};

/** source 既可能是服务端解析好的对象，也可能是落库的原始 JSON 文本 */
const toReportObject = (source) => {
  if (isPlainObject(source)) return source;
  return parseAiReportJson(source);
};

const normalizeAiFindings = (raw) => {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isPlainObject).map((item) => ({
    dimension: typeof item.dimension === "string" ? item.dimension : "-",
    status: typeof item.status === "string" ? item.status : "-",
    detail: typeof item.detail === "string" ? item.detail : "",
    evidence: typeof item.evidence === "string" ? item.evidence : ""
  }));
};

const buildLegacyPaymentFindings = (report) =>
  LEGACY_PAYMENT_CHECKS.map((check) => {
    const node = report[check.field];
    if (!isPlainObject(node)) return null;
    const comment = asString(node.comment);
    if (!comment) return null;
    return {
      dimension: check.dimension,
      status: node[check.abnormalField] === true ? "warn" : "pass",
      detail: comment,
      evidence: ""
    };
  }).filter(Boolean);

const buildFindingRows = (report) => {
  const normalized = normalizeAiFindings(report.findings);
  const findings = normalized.length > 0 ? normalized : buildLegacyPaymentFindings(report);
  return findings.map((finding, index) => ({
    key: `finding-${index}`,
    dimensionLabel: toFindingDimensionLabel(finding.dimension),
    statusLabel: toFindingStatusLabel(finding.status),
    statusTheme: toFindingStatusTheme(finding.status),
    detail: finding.detail,
    evidence: finding.evidence
  }));
};

/** 合同条款：新形状 issue/suggestion，旧形状只有 comment，一并落到 issue */
const buildClauseRows = (raw) => {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isPlainObject).map((item, index) => {
    const riskLevel = asString(item.risk_level) || "medium";
    return {
      key: `clause-${index}`,
      clause: asString(item.clause) || "未命名条款",
      riskLabel: toRiskLevelLabel(riskLevel),
      riskTheme: toRiskLevelTheme(riskLevel),
      issue: asString(item.issue) || asString(item.comment),
      suggestion: asString(item.suggestion)
    };
  });
};

/**
 * 金额评估：新形状 reasonableness/basis/risk_points，旧形状 reasonable/comment。
 * reasonableness 是「合理程度」不是风险等级——模型按字面输出（生产
 * CT-20260805-0001：reasonableness=low 同时列了 4 条 risk_points，指金额依据不足），
 * 所以色板与风险轴相反：低=红、高=绿；旧结构 reasonable=true（合理）同轴映射为 high。
 */
const REASONABLENESS_THEMES = {
  low: "danger",
  medium: "warning",
  high: "success"
};

const buildAmountAssessment = (node) => {
  if (!isPlainObject(node)) return null;
  let reasonableness = asString(node.reasonableness);
  if (!reasonableness && node.reasonable === true) reasonableness = "high";
  if (!reasonableness && node.reasonable === false) reasonableness = "low";
  const basis = asString(node.basis) || asString(node.comment);
  const riskPoints = asStringList(node.risk_points);
  if (!reasonableness && !basis && riskPoints.length === 0) return null;
  return {
    riskLabel: reasonableness ? toRiskLevelLabel(reasonableness) : "",
    riskTheme: lookup(REASONABLENESS_THEMES, reasonableness, NEUTRAL_THEME),
    basis,
    riskPointRows: toKeyedTextRows(riskPoints, "risk-point")
  };
};

const PENDING_HINT = "AI 正在重新审查，以下为上一次的结果";

const emptyViewModel = (kind) => ({
  kind,
  title: REPORT_TITLES[kind],
  placeholder: "",
  pendingHint: "",
  hasBody: false,
  overallRiskLabel: "",
  overallRiskTheme: NEUTRAL_THEME,
  scoreText: "",
  scoreTheme: NEUTRAL_THEME,
  summary: "",
  scoreBasisRows: [],
  clauseRows: [],
  findingRows: [],
  amountAssessment: null,
  recommendationRows: [],
  rawFallback: "",
  emptyHint: ""
});

/**
 * 把报告（对象或原始 JSON 文本）转成 WXML 可直接渲染的视图模型。
 * status 取 ai_review_status / ai_risk_status（none|pending|completed|failed），
 * 缺省时只按有无内容判断。
 */
const buildAiReportViewModel = (source, kind, status) => {
  const normalizedKind = kind === "contract" ? "contract" : "payment";
  const base = emptyViewModel(normalizedKind);
  const statusText = asString(status);
  const report = toReportObject(source);
  // 状态不得压过已有内容：重新触发审查时 status=pending，上一轮报告仍应可见
  const statusPlaceholder =
    statusText === "pending"
      ? "AI 审查进行中，稍后重新进入本页查看"
      : statusText === "failed"
        ? "AI 审查失败，可在网页端重新触发"
        : source
          ? ""
          : "暂无 AI 审查报告";

  if (!report) {
    const rawText = typeof source === "string" ? source.trim() : "";
    // 解析不出结构但确有文本时保留原文，避免“有结果却空白”
    if (rawText) {
      return {
        ...base,
        rawFallback: rawText.slice(0, 1000),
        pendingHint: statusText === "pending" ? PENDING_HINT : ""
      };
    }
    return { ...base, placeholder: statusPlaceholder || "暂无 AI 审查报告" };
  }

  const score =
    typeof report.score === "number" && isFinite(report.score) ? report.score : null;
  const overallRisk = asString(report.overall_risk);
  const summary = asString(report.summary);
  const scoreBasis = asStringList(report.score_basis);
  // 只有确定性计分的结果（带 score_basis 键）才配分档文案与配色：旧结果的
  // 分数是模型自己编的，跨单不可比，打上「高风险（≥50）」会误导审批人
  const scoreIsDeterministic = Array.isArray(report.score_basis);
  const recommendations = asStringList(report.recommendations);
  const clauseRows = normalizedKind === "contract" ? buildClauseRows(report.clause_analysis) : [];
  const findingRows = normalizedKind === "payment" ? buildFindingRows(report) : [];
  const amountAssessment = buildAmountAssessment(report.amount_assessment);

  const hasBody =
    Boolean(overallRisk) ||
    Boolean(summary) ||
    score !== null ||
    scoreBasis.length > 0 ||
    clauseRows.length > 0 ||
    findingRows.length > 0 ||
    Boolean(amountAssessment) ||
    recommendations.length > 0;

  return {
    ...base,
    hasBody,
    overallRiskLabel: overallRisk ? toRiskLevelLabel(overallRisk) : "",
    overallRiskTheme: toRiskLevelTheme(overallRisk),
    scoreText:
      score === null
        ? ""
        : scoreIsDeterministic
          ? `风险分 ${score} · ${toRiskScoreBandLabel(score)}`
          : `风险分 ${score}`,
    scoreTheme: scoreIsDeterministic ? toRiskScoreBandTheme(score) : NEUTRAL_THEME,
    summary,
    scoreBasisRows: toKeyedTextRows(scoreBasis, "score-basis"),
    clauseRows,
    findingRows,
    amountAssessment,
    recommendationRows: toKeyedTextRows(recommendations, "recommendation"),
    // 解析成功但没有任何可渲染字段（模型未按 schema 输出）时，原样保留内容，
    // 否则结论会被静默吞掉——服务端对这类结果是原样透传的，这里是最后一道防线
    rawFallback: hasBody ? "" : JSON.stringify(report, null, 2).slice(0, 1000),
    pendingHint: statusText === "pending" ? PENDING_HINT : "",
    emptyHint: ""
  };
};

module.exports = {
  FINDING_DIMENSION_LABELS,
  REPORT_TITLES,
  toFindingDimensionLabel,
  toFindingStatusLabel,
  toFindingStatusTheme,
  toRiskLevelLabel,
  toRiskLevelTheme,
  toRiskScoreBandLabel,
  toRiskScoreBandTheme,
  parseAiReportJson,
  normalizeAiFindings,
  buildAiReportViewModel
};
