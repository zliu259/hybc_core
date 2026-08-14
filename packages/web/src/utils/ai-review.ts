/**
 * AI 审查结果（AI 关卡 / 付款风控）的前端共享展示工具。
 *
 * 新版后端契约：
 * - AI 关卡 review 带 decision（pass/warn/reject）与 risk_level；
 * - 付款风控 result 带 findings（固定维度事实判定）与 score_basis
 *   （分数构成说明，分数由后端按 warn=20/fail=50 确定性计算，
 *   warn 合计封顶 40：警示项只需人工关注，不会推进高风险档）。
 * 旧数据仍可能把 JSON 塞在 summary/comment 文本里，这里提供容错解析。
 */

export type AiTagType = "success" | "warning" | "danger" | "info" | "primary";

export interface AiRiskFinding {
  dimension: string;
  status: "pass" | "warn" | "fail" | string;
  detail: string;
  evidence: string;
}

/** 检查维度中文名（与 task-runner/runner/prompts.py 的维度标识对应） */
const FINDING_DIMENSION_LABELS: Record<string, string> = {
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

export const toFindingDimensionLabel = (dimension: unknown): string => {
  if (typeof dimension !== "string" || !dimension) return "-";
  return FINDING_DIMENSION_LABELS[dimension] ?? dimension;
};

/**
 * 已知英文字段/枚举 token → 中文业务名。展示层兜底：存量报告里模型照抄了
 * payload 的英文字段名（如 amount=282000），对审批人有歧义；新报告已由
 * 提示词约束用中文表述，这里治历史数据。仅整 token 精确匹配，未知 token
 * 原样保留（流水号、单号等不受影响）。
 */
const FIELD_TOKEN_LABELS: Record<string, string> = {
  "contract.total_amount": "合同总额",
  "contract.paid_amount": "合同已付金额",
  "contract.counterparty": "合同相对方",
  "contract.contract_no": "合同号",
  "payment.content": "付款内容",
  "payment.category": "付款类别",
  "payee.name": "收款方名称",
  total_amount: "合同总额",
  paid_amount: "已付金额",
  amount_cn: "金额大写",
  amount: "金额",
  serial_no: "流水号",
  contract_no: "合同号",
  invoice_no: "发票号",
  envelope_no: "报销单号",
  counterparty: "合同相对方",
  our_entity: "我方签约主体",
  our_entities: "集团实体名单",
  recent_payments: "近期付款记录",
  expected_payment_date: "预计付款日",
  payment_method: "付款方式",
  bank_name: "开户行",
  bank_account: "银行账号",
  payee: "收款方",
  category: "费用类别",
  content: "付款内容",
  remark: "备注",
  direction: "合同方向",
  attachments: "附件",
  risk_level: "风险等级",
  precheck_status: "预审状态",
  reimbursement_item_reviews: "报销单项预审",
  status: "状态",
  outbound: "对外付款",
  inbound: "收款",
  pass: "通过",
  warn: "关注",
  fail: "异常",
  high: "高",
  medium: "中",
  low: "低"
};

const lookupFieldToken = (token: string): string | null =>
  Object.prototype.hasOwnProperty.call(FIELD_TOKEN_LABELS, token)
    ? FIELD_TOKEN_LABELS[token]
    : null;

/** 把文本中的已知英文字段 token 换成中文业务名；非字符串原样返回空串 */
export const humanizeAiText = (text: unknown): string => {
  if (typeof text !== "string" || !text) return "";
  return text.replace(/[A-Za-z_][A-Za-z0-9_.]*/g, token => {
    const direct = lookupFieldToken(token);
    if (direct) return direct;
    // 句尾英文点号会被并进 token（如 "amount."），剥掉再查一次
    const trimmed = token.replace(/\.+$/, "");
    if (trimmed !== token) {
      const hit = lookupFieldToken(trimmed);
      if (hit) return hit + token.slice(trimmed.length);
    }
    return token;
  });
};

const FINDING_STATUS_LABELS: Record<string, string> = {
  pass: "通过",
  warn: "关注",
  fail: "异常"
};

const FINDING_STATUS_TAGS: Record<string, AiTagType> = {
  pass: "success",
  warn: "warning",
  fail: "danger"
};

export const toFindingStatusLabel = (status: unknown): string => {
  if (typeof status !== "string" || !status) return "-";
  return FINDING_STATUS_LABELS[status] ?? status;
};

export const toFindingStatusTagType = (status: unknown): AiTagType => {
  if (typeof status !== "string" || !status) return "info";
  return FINDING_STATUS_TAGS[status] ?? "info";
};

export const normalizeAiFindings = (raw: unknown): AiRiskFinding[] => {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (item): item is Record<string, unknown> =>
        !!item && typeof item === "object"
    )
    .map(item => ({
      dimension: typeof item.dimension === "string" ? item.dimension : "-",
      status: typeof item.status === "string" ? item.status : "-",
      detail: typeof item.detail === "string" ? item.detail : "",
      evidence: typeof item.evidence === "string" ? item.evidence : ""
    }));
};

/** 风险分档说明（与后端 postprocess 分档一致：0-19 低 / 20-49 中 / ≥50 高） */
export const toRiskScoreBandLabel = (score: unknown): string => {
  if (typeof score !== "number" || Number.isNaN(score)) return "";
  if (score >= 50) return "高风险（≥50）";
  if (score >= 20) return "中风险（20-49）";
  return "低风险（0-19）";
};

export const toRiskScoreBandTagType = (score: unknown): AiTagType => {
  if (typeof score !== "number" || Number.isNaN(score)) return "info";
  if (score >= 50) return "danger";
  if (score >= 20) return "warning";
  return "success";
};

/** AI 关卡三态判定展示（decision 优先于二值 outcome） */
export const AI_DECISION_LABELS: Record<string, string> = {
  pass: "建议通过",
  warn: "放行·需人工关注",
  reject: "建议拒绝"
};

export const AI_DECISION_TAGS: Record<string, AiTagType> = {
  pass: "success",
  warn: "warning",
  reject: "danger"
};

/**
 * 从规范化意见文本前缀推断三态判定（后端 ai-gate-result 的 comment 格式：
 * “AI审查通过：…”/“AI审查放行（需人工重点关注）：…”/“AI审查不通过：…”）。
 * 用于 approval_task.comment 这类只有文本、没有 decision 字段的场景。
 */
export const deriveAiDecisionFromComment = (
  comment: string | null | undefined
): "pass" | "warn" | "reject" | null => {
  if (typeof comment !== "string") return null;
  if (comment.startsWith("AI审查不通过")) return "reject";
  if (comment.startsWith("AI审查放行")) return "warn";
  if (comment.startsWith("AI审查通过")) return "pass";
  return null;
};

/**
 * 容错解析文本里内嵌的 AI 结果 JSON（旧数据 summary/comment 可能是裸 JSON）。
 * 返回 null 表示不是 JSON 文本。
 */
export const parseEmbeddedAiJson = (
  text: string | null | undefined
): Record<string, unknown> | null => {
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  const candidates: string[] = [];
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    candidates.push(trimmed);
  }
  const fenceMatches = trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)\s*```/gi);
  for (const match of fenceMatches) {
    if (match[1]) candidates.push(match[1]);
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

/** 把 summary/comment 文本转成可读展示文本（旧数据裸 JSON 时提取摘要字段） */
export const toReadableAiText = (text: string | null | undefined): string => {
  if (typeof text !== "string" || !text.trim()) return "";
  const embedded = parseEmbeddedAiJson(text);
  if (!embedded) return text.trim();
  for (const key of ["comment", "summary", "output"]) {
    const value = embedded[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return text.trim();
};
