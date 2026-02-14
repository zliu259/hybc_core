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
  contract_id: number;
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
  attachments_json: string | null;
  remark: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreatePaymentRequestBody {
  contract_id: number;
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
  attachments_json?: string;
  remark?: string;
  status?: PaymentRequestStatus;
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
  created_at: string;
  updated_at: string;
}

export interface CreatePayeeRequest {
  name: string;
  bank_name: string;
  bank_account: string;
  phone?: string;
  type: PayeeType;
}

export interface UpdatePayeeRequest {
  name?: string;
  bank_name?: string;
  bank_account?: string;
  phone?: string;
  type?: PayeeType;
}

// ─── AI Review Report (structured output from contract_review task) ──────────

export interface ContractReviewReport {
  overall_risk: "low" | "medium" | "high";
  score: number;
  summary: string;
  clause_analysis: {
    clause: string;
    risk_level: "low" | "medium" | "high";
    comment: string;
  }[];
  amount_assessment: {
    reasonable: boolean;
    comment: string;
  };
  recommendations: string[];
  reviewed_at: string;
}

// ─── AI Risk Assessment Report (structured output from payment_risk task) ──────────

export interface PaymentRiskReport {
  overall_risk: "low" | "medium" | "high";
  score: number;
  summary: string;
  frequency_check: {
    recent_count: number;
    period_days: number;
    is_abnormal: boolean;
    comment: string;
  };
  amount_check: {
    contract_total: number;
    already_paid: number;
    this_payment: number;
    remaining_after: number;
    is_abnormal: boolean;
    comment: string;
  };
  duplicate_check: {
    found_duplicates: boolean;
    similar_payments: {
      serial_no: string;
      amount: number;
      date: string;
    }[];
    comment: string;
  };
  recommendations: string[];
  assessed_at: string;
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
}
