// ─── Phase 3: 对外付款 types ──────────

// ─── Enums ──────────

export const contractDirections = ["outbound", "inbound"] as const;
export type ContractDirection = (typeof contractDirections)[number];

export const contractStatuses = [
  "draft",
  "pending_review",
  "pending_approval",
  "active",
  "completed",
  "terminated",
  "deleted"
] as const;
export type ContractStatus = (typeof contractStatuses)[number];

export const aiReviewStatuses = [
  "none",
  "pending",
  "completed",
  "failed"
] as const;
export type AiReviewStatus = (typeof aiReviewStatuses)[number];

export const changeTypes = ["increase", "decrease", "adjust"] as const;
export type ChangeType = (typeof changeTypes)[number];

export const changeStatuses = [
  "pending",
  "approved",
  "rejected"
] as const;
export type ChangeStatus = (typeof changeStatuses)[number];

export const paymentRequestStatuses = [
  "draft",
  "pending_approval",
  "approved",
  "paid",
  "rejected",
  "cancelled"
] as const;
export type PaymentRequestStatus = (typeof paymentRequestStatuses)[number];

export const aiRiskStatuses = [
  "none",
  "pending",
  "completed",
  "failed"
] as const;
export type AiRiskStatus = (typeof aiRiskStatuses)[number];

export const payeeTypes = ["internal", "external"] as const;
export type PayeeType = (typeof payeeTypes)[number];

export const payeeStatuses = ["active", "deleted"] as const;
export type PayeeStatus = (typeof payeeStatuses)[number];

// ─── Contract ──────────

export interface Contract {
  id: number;
  contract_no: string;
  direction: ContractDirection;
  project_id: number;
  entity_id: number;
  counterparty: string;
  contract_type: string;
  handler_userid: string;
  contract_date: string;
  total_amount: number;
  paid_amount: number;
  invoiced_amount: number;
  received_amount: number;
  status: ContractStatus;
  ai_review_status: AiReviewStatus;
  ai_review_result: string | null;
  approval_instance_id: number | null;
  attachments_json: string | null;
  remark: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateContractRequest {
  direction: ContractDirection;
  project_id: number;
  entity_id: number;
  counterparty: string;
  contract_type: string;
  handler_userid: string;
  contract_date: string;
  total_amount: number;
  attachments_json?: string;
  remark?: string;
}

export interface UpdateContractRequest {
  counterparty?: string;
  contract_type?: string;
  handler_userid?: string;
  contract_date?: string;
  total_amount?: number;
  attachments_json?: string;
  remark?: string;
  status?: ContractStatus;
  admin_edit_mode?: boolean;
  edit_note?: string;
}

// ─── Contract Amount Change ──────────

export interface ContractAmountChange {
  id: number;
  contract_id: number;
  change_type: ChangeType;
  old_amount: number;
  new_amount: number;
  reason: string;
  status: ChangeStatus;
  approval_instance_id: number | null;
  applicant_userid: string;
  created_at: string;
  updated_at: string;
}

export interface CreateAmountChangeRequest {
  contract_id: number;
  change_type: ChangeType;
  new_amount: number;
  reason: string;
}

// ─── Payment Request ──────────

export interface PaymentRequest {
  id: number;
  serial_no: string;
  contract_id: number | null;
  project_id: number;
  applicant_userid: string;
  expected_payment_date: string;
  category: string;
  payee_id: number;
  amount: number;
  amount_cn: string;
  content: string;
  payment_method: string;
  status: PaymentRequestStatus;
  approval_instance_id: number | null;
  ai_risk_status: AiRiskStatus;
  ai_risk_result: string | null;
  paid_at: string | null;
  paid_by_userid: string | null;
  payment_reference: string | null;
  payment_entity_id: number | null;
  payment_entity_bank_account_id: number | null;
  payment_account: string | null;
  attachments_json: string | null;
  remark: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreatePaymentRequestBody {
  contract_id?: number | null;
  project_id: number;
  expected_payment_date: string;
  category: string;
  payee_id: number;
  amount: number;
  content: string;
  payment_method: string;
  attachments_json?: string;
  remark?: string;
}

export interface UpdatePaymentRequestBody {
  expected_payment_date?: string;
  category?: string;
  payee_id?: number;
  amount?: number;
  content?: string;
  payment_method?: string;
  payment_entity_id?: number | null;
  payment_entity_bank_account_id?: number | null;
  payment_account?: string | null;
  attachments_json?: string;
  remark?: string;
  status?: PaymentRequestStatus;
  admin_edit_mode?: boolean;
  edit_note?: string;
}

// ─── Payee ──────────

export interface Payee {
  id: number;
  name: string;
  bank_name: string;
  bank_account: string;
  phone: string | null;
  type: PayeeType;
  status: PayeeStatus;
  created_by_userid: string;
  linked_userid: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreatePayeeRequest {
  name: string;
  bank_name: string;
  bank_account: string;
  phone?: string;
  type: PayeeType;
  linked_userid?: string;
}

export interface UpdatePayeeRequest {
  name?: string;
  bank_name?: string;
  bank_account?: string;
  phone?: string;
  type?: PayeeType;
  linked_userid?: string | null;
}

// ─── AI Review Report (structured output from contract_review task) ──────────

export type AiRiskLevel = "low" | "medium" | "high";

/**
 * 存量数据同时存在两代形状：0076 提示词重写前由模型自行编分数的旧结构，
 * 与重写后「模型只给事实、分数由 postprocess 确定性计算」的新结构；
 * postprocess 对识别不出 findings/clause_analysis 的旧结果原样透传，
 * 因此解析侧必须把所有字段当可选处理，不能假定新结构必然存在。
 */

export interface ContractReviewClause {
  clause: string;
  risk_level: AiRiskLevel;
  issue: string;
  suggestion: string;
}

export interface ContractReviewReport {
  overall_risk: AiRiskLevel;
  score: number;
  /** 分数构成说明；warn/medium 触发封顶时末尾附「按上限计入」说明行 */
  score_basis: string[];
  summary: string;
  clause_analysis: ContractReviewClause[];
  amount_assessment: {
    reasonableness: AiRiskLevel;
    basis: string;
    risk_points: string[];
  };
  recommendations: string[];
}

// ─── AI Risk Assessment Report (structured output from payment_risk task) ──────────

export interface AiReviewFinding {
  /** 维度英文标识，中文名见 approval/risk-score.ts DIMENSION_LABELS */
  dimension: string;
  status: "pass" | "warn" | "fail";
  detail: string;
  evidence: string;
}

export interface PaymentRiskReport {
  overall_risk: AiRiskLevel;
  score: number;
  score_basis: string[];
  summary: string;
  findings: AiReviewFinding[];
  recommendations: string[];
}

/** 0076 前的付款风控结构；postprocess 原样透传，存量记录仍是这个形状 */
export interface LegacyPaymentRiskReport {
  overall_risk: AiRiskLevel;
  score?: number;
  summary: string;
  frequency_check?: {
    recent_count: number;
    period_days: number;
    is_abnormal: boolean;
    comment: string;
  };
  amount_check?: {
    contract_total: number;
    already_paid: number;
    this_payment: number;
    remaining_after: number;
    is_abnormal: boolean;
    comment: string;
  };
  duplicate_check?: {
    found_duplicates: boolean;
    similar_payments: { serial_no: string; amount: number; date: string }[];
    comment: string;
  };
  recommendations?: string[];
}

// ─── List Query Params ──────────

export interface ContractListParams {
  direction?: ContractDirection;
  project_id?: number;
  entity_id?: number;
  status?: ContractStatus;
  keyword?: string;
  page?: number;
  page_size?: number;
}

export interface PaymentRequestListParams {
  contract_id?: number;
  project_id?: number;
  status?: PaymentRequestStatus;
  keyword?: string;
  page?: number;
  page_size?: number;
}

export interface PayeeListParams {
  type?: PayeeType;
  keyword?: string;
  linked_userid?: string;
}
