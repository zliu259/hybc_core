import type { InstanceConfig } from "./approval";

export const reimbursementChannels = ["physical", "electronic"] as const;
export type ReimbursementChannel = (typeof reimbursementChannels)[number];

export const reimbursementStatuses = [
  "unregistered",
  "draft",
  "submitted",
  "received",
  "batched",
  "pending_approval",
  "approved",
  "paid",
  "rejected",
  "cancelled",
  "deleted"
] as const;
export type ReimbursementStatus = (typeof reimbursementStatuses)[number];

export const precheckStatuses = ["none", "pending", "approved", "supplement", "rejected"] as const;
export type PrecheckStatus = (typeof precheckStatuses)[number];

export const verificationStatuses = ["pending", "verified", "mismatch"] as const;
export type VerificationStatus = (typeof verificationStatuses)[number];

export const taskStatuses = ["none", "pending", "completed", "failed"] as const;
export type TaskStatus = (typeof taskStatuses)[number];

export interface ReimbursementEnvelope {
  id: number;
  envelope_no: string;
  envelope_uuid: string;
  project_id: number;
  applicant_userid: string;
  channel: ReimbursementChannel;
  invoice_unique_no: string | null;
  invoice_no: string | null;
  expense_date: string | null;
  amount: number;
  category: string | null;
  description: string | null;
  status: ReimbursementStatus;
  precheck_status: PrecheckStatus;
  precheck_comment: string | null;
  verification_status: VerificationStatus;
  verification_note: string | null;
  batch_id: number | null;
  approval_instance_id: number | null;
  pdf_task_id: number | null;
  pdf_status: TaskStatus;
  pdf_file_key: string | null;
  ocr_task_id: number | null;
  ocr_status: TaskStatus;
  ocr_result_json: string | null;
  ocr_invoice_unique_no_hint: string | null;
  ocr_invoice_no_hint: string | null;
  ocr_expense_date_hint: string | null;
  duplicate_check_status: TaskStatus;
  silent_review_result: string | null;
  duplicate_override_requested: number;
  duplicate_override_reason: string | null;
  submitted_at: string | null;
  received_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface EnvelopeAttachment {
  id: number;
  envelope_id: number;
  attachment_type: string;
  file_key: string;
  file_name: string | null;
  file_size: number | null;
  invoice_no: string | null;
  amount: number | null;
  issue_date: string | null;
  status: string;
  created_at: string;
}

export interface ReimbursementDuplicateCheck {
  id: number;
  envelope_id: number;
  matched_envelope_id: number | null;
  matched_invoice_no: string | null;
  match_type: string;
  match_score: number | null;
  risk_level: string;
  summary: string | null;
  evidence_json: string | null;
  created_at: string;
}

export interface ReimbursementBatch {
  id: number;
  batch_no: string;
  project_id: number;
  applicant_userid: string;
  total_amount: number;
  item_count: number;
  status: string;
  ai_audit_status: string;
  ai_audit_result: string | null;
  approval_instance_id: number | null;
  payment_method: string | null;
  paid_at: string | null;
  payment_reference: string | null;
  payment_account: string | null;
  payment_entity_id: number | null;
  payment_entity_bank_account_id: number | null;
  payment_vouchers_json: string | null;
  payee_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface ReimbursementPaymentVoucherInput {
  file_key: string;
  file_name?: string;
  file_size?: number;
}

export interface MarkBatchPaidRequest {
  paid_at?: string;
  payment_reference?: string;
  payment_account?: string;
  payment_entity_id?: number;
  payment_entity_bank_account_id?: number;
  payment_vouchers?: ReimbursementPaymentVoucherInput[];
}

export interface AttachmentInput {
  attachment_type?: string;
  file_key: string;
  file_name?: string;
  file_size?: number;
  invoice_no?: string;
  amount?: number;
  issue_date?: string;
}

export interface CreateEnvelopeRequest {
  project_id: number;
  applicant_userid?: string;
  preferred_envelope_uuid?: string;
  channel?: ReimbursementChannel;
  invoice_no?: string;
  expense_date?: string;
  amount?: number;
  category?: string;
  description?: string;
  attachments?: AttachmentInput[];
}

export interface UpdateEnvelopeRequest {
  project_id?: number;
  applicant_userid?: string;
  channel?: ReimbursementChannel;
  invoice_no?: string;
  expense_date?: string;
  amount?: number;
  category?: string;
  description?: string;
  status?: ReimbursementStatus;
  attachments?: AttachmentInput[];
}

export interface BatchGenerateEnvelopeRequest {
  project_id: number;
  count: number;
  applicant_userid?: string;
}

export interface ScanEnvelopeRequest {
  envelope_uuid: string;
  project_id?: number;
  invoice_no?: string;
  expense_date?: string;
  amount?: number;
  category?: string;
  description?: string;
  attachments?: AttachmentInput[];
}

export interface VerifyEnvelopeRequest {
  envelope_id?: number;
  envelope_uuid?: string;
  result: "verified" | "mismatch";
  note?: string;
}

export interface RebindEnvelopeUuidRequest {
  envelope_uuid: string;
  reason?: string;
}

export interface SubmitEnvelopeRequest {
  force_submit?: boolean;
  force_submit_reason?: string;
}

export interface ElectronicUploadRequest {
  project_id: number;
  applicant_userid?: string;
  file_key: string;
  file_name?: string;
  file_size?: number;
  invoice_no?: string;
  amount?: number;
  issue_date?: string;
  description?: string;
  // When set to the caller's own unsubmitted electronic draft, the upload
  // replaces that draft's invoice in place instead of creating a new envelope.
  // Prevents duplicate drafts when a user re-uploads on an active draft.
  envelope_id?: number;
}

export interface PrecheckEnvelopeRequest {
  action: "approved" | "supplement" | "rejected";
  comment?: string;
}

export interface CreateReimbursementBatchRequest {
  project_id: number;
  applicant_userid: string;
  envelope_ids?: number[];
  payment_method?: string;
  payment_entity_id?: number;
  payment_entity_bank_account_id?: number;
  payment_account?: string;
  payee_id?: number;
}

export interface SubmitReimbursementBatchApprovalRequest {
  biz_summary?: string;
  instance_config?: InstanceConfig;
  payment_method?: string;
  payment_entity_id?: number;
  payment_entity_bank_account_id?: number;
  payment_account?: string;
  payee_id?: number;
}

export interface UpdateReimbursementBatchPayoutPlanRequest {
  payment_method?: string;
  payment_entity_id?: number;
  payment_entity_bank_account_id?: number;
  payment_account?: string;
  payee_id?: number;
}

export interface UpdateReimbursementBatchPaymentVouchersRequest {
  payment_vouchers?: ReimbursementPaymentVoucherInput[];
}

export interface UpdateReimbursementBatchItemBasicInfoRequest {
  invoice_no?: string;
  expense_date?: string;
  amount?: number;
  category?: string;
  description?: string;
}
