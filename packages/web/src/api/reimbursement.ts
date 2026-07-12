import { http } from "@/utils/http";

export type ReimbursementEnvelope = {
  id: number;
  envelope_no: string;
  envelope_uuid: string;
  project_id: number;
  applicant_userid: string;
  channel: "physical" | "electronic";
  invoice_unique_no: string | null;
  invoice_no: string | null;
  expense_date: string | null;
  amount: number;
  category: string | null;
  description: string | null;
  status: string;
  precheck_status: string;
  verification_status: string;
  batch_id?: number | null;
  approval_instance_id?: number | null;
  ocr_status: string;
  ocr_result_json?: string | null;
  ocr_invoice_unique_no_hint?: string | null;
  ocr_invoice_no_hint?: string | null;
  ocr_expense_date_hint?: string | null;
  duplicate_check_status: string;
  silent_review_result?: string | null;
  duplicate_override_requested?: number;
  duplicate_override_reason?: string | null;
  pdf_status: string;
  pdf_task_id: number | null;
  pdf_file_key: string | null;
  created_at: string;
  updated_at: string;
  duplicate_count?: number;
  duplicate_risk_level?: "high" | "medium" | "low" | null;
  split_from_envelope_id?: number | null;
  split_reason?: string | null;
};

export type EnvelopeAttachment = {
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
};

export type ReimbursementEnvelopeDetail = ReimbursementEnvelope & {
  attachments: EnvelopeAttachment[];
  duplicate_checks: {
    id: number;
    match_type: string;
    risk_level: string;
    summary: string | null;
    matched_invoice_no: string | null;
  }[];
  batch: {
    id: number;
    batch_no: string;
    status: string;
  } | null;
};

type Pagination = { page: number; pageSize: number; total: number };

export const listReimbursementEnvelopes = (params?: {
  status?: string | string[];
  precheck_status?: string;
  project_id?: number;
  applicant_userid?: string;
  creator_id?: string;
  exclude_cancelled?: boolean;
  exclude_unassigned?: boolean;
  channel?: string;
  keyword?: string;
  page?: number;
  pageSize?: number;
}) => {
  return http.request<{
    success: boolean;
    data: ReimbursementEnvelope[];
    pagination: Pagination;
  }>("get", "/api/v1/reimbursement", { params });
};

export type ReimbursementWorkbenchSummary = {
  to_receive: number;
  to_precheck: number;
  to_batch: number;
  batches_to_submit: number;
  batches_to_pay: number;
  admin_draft?: number;
  admin_returned?: number;
  admin_cancelled?: number;
};

export const getReimbursementWorkbenchSummary = () => {
  return http.request<{
    success: boolean;
    data: ReimbursementWorkbenchSummary;
  }>("get", "/api/v1/reimbursement/workbench-summary");
};

export const getReimbursementEnvelope = (id: number) => {
  return http.request<{ success: boolean; data: ReimbursementEnvelopeDetail }>(
    "get",
    `/api/v1/reimbursement/${id}`
  );
};

export const resolveReimbursementEnvelopeByUuid = (envelope_uuid: string) => {
  return http.request<{
    success: boolean;
    data: {
      id: number;
      envelope_no: string;
      envelope_uuid: string;
      status: string;
      applicant_userid: string;
      registered: boolean;
    };
  }>("get", "/api/v1/reimbursement/resolve/by-uuid", {
    params: { envelope_uuid }
  });
};

export const rebindReimbursementEnvelopeUuid = (
  id: number,
  data: { envelope_uuid: string; reason?: string }
) => {
  return http.request<{
    success: boolean;
    data: { id: number; envelope_uuid: string; envelope_no: string };
  }>("post", `/api/v1/reimbursement/${id}/rebind-uuid`, { data });
};

export const switchReimbursementChannel = (
  id: number,
  data: { channel: "physical" | "electronic"; reason?: string }
) => {
  return http.request<{
    success: boolean;
    data: {
      id: number;
      channel: "physical" | "electronic";
      changed: boolean;
      ai_audit_triggered: boolean;
    };
  }>("post", `/api/v1/reimbursement/${id}/switch-channel`, { data });
};

export const createReimbursementEnvelope = (
  data: {
    project_id: number;
    applicant_userid?: string;
    preferred_envelope_uuid?: string;
    channel?: "physical" | "electronic";
    invoice_no?: string;
    expense_date?: string;
    amount?: number;
    category?: string;
    description?: string;
    attachments?: {
      attachment_type?: string;
      file_key: string;
      file_name?: string;
      file_size?: number;
      invoice_no?: string;
      amount?: number;
      issue_date?: string;
    }[];
  },
  options?: { idempotencyKey?: string }
) => {
  return http.request<{
    success: boolean;
    data: { id: number; envelope_no: string; envelope_uuid: string };
  }>("post", "/api/v1/reimbursement", {
    data,
    headers: options?.idempotencyKey
      ? { "Idempotency-Key": options.idempotencyKey }
      : undefined
  });
};

export const updateReimbursementEnvelope = (
  id: number,
  data: {
    project_id?: number;
    applicant_userid?: string;
    channel?: "physical" | "electronic";
    invoice_no?: string;
    expense_date?: string;
    amount?: number;
    category?: string;
    description?: string;
    status?: string;
    attachments?: {
      attachment_type?: string;
      file_key: string;
      file_name?: string;
      file_size?: number;
      invoice_no?: string;
      amount?: number;
      issue_date?: string;
    }[];
  }
) => {
  return http.request<{ success: boolean }>(
    "put",
    `/api/v1/reimbursement/${id}`,
    { data }
  );
};

export const batchGenerateReimbursementEnvelopes = (data: {
  project_id: number;
  count: number;
  applicant_userid?: string;
}) => {
  return http.request<{
    success: boolean;
    data: { id: number; envelope_no: string; envelope_uuid: string }[];
  }>("post", "/api/v1/reimbursement/batch-generate", { data });
};

export const scanReimbursementEnvelope = (data: {
  envelope_uuid: string;
  project_id?: number;
  invoice_no?: string;
  expense_date?: string;
  amount?: number;
  category?: string;
  description?: string;
  attachments?: {
    attachment_type?: string;
    file_key: string;
    file_name?: string;
    file_size?: number;
    invoice_no?: string;
    amount?: number;
    issue_date?: string;
  }[];
}) => {
  return http.request<{
    success: boolean;
    data: {
      id: number;
      status: string;
      applicant_userid: string;
      registered: boolean;
    };
  }>("post", "/api/v1/reimbursement/scan", { data });
};

export const submitReimbursementEnvelope = (
  id: number,
  data?: { force_submit?: boolean; force_submit_reason?: string },
  options?: { idempotencyKey?: string }
) => {
  return http.request<{
    success: boolean;
    data: { id: number; status: string };
  }>("post", `/api/v1/reimbursement/${id}/submit`, {
    data,
    headers: options?.idempotencyKey
      ? { "Idempotency-Key": options.idempotencyKey }
      : undefined
  });
};

export const voidReimbursementEnvelope = (id: number) => {
  return http.request<{
    success: boolean;
    data: { id: number; status: string };
  }>("post", `/api/v1/reimbursement/${id}/void`);
};

export const verifyReimbursementEnvelope = (data: {
  envelope_id?: number;
  envelope_uuid?: string;
  result: "verified" | "mismatch";
  note?: string;
}) => {
  return http.request<{
    success: boolean;
    data: { id: number; verification_status: string; status: string };
  }>("post", "/api/v1/reimbursement/verify", { data });
};

export const triggerEnvelopePdf = (id: number) => {
  return http.request<{
    success: boolean;
    data: { task_id: number; pdf_status: string };
  }>("post", `/api/v1/reimbursement/${id}/generate-pdf`);
};

export const getEnvelopePdfStatus = (id: number) => {
  return http.request<{
    success: boolean;
    data: {
      status: string;
      task_id: number | null;
      file_key: string | null;
      result: Record<string, unknown> | null;
    };
  }>("get", `/api/v1/reimbursement/${id}/pdf-status`);
};

export const uploadElectronicInvoice = (
  data: {
    project_id: number;
    applicant_userid?: string;
    file_key: string;
    file_name?: string;
    file_size?: number;
    invoice_no?: string;
    amount?: number;
    issue_date?: string;
    description?: string;
  },
  options?: { idempotencyKey?: string }
) => {
  return http.request<{
    success: boolean;
    data: {
      id: number;
      envelope_no: string;
      envelope_uuid: string;
      ocr_task_id: number;
    };
  }>("post", "/api/v1/reimbursement/electronic-upload", {
    data,
    headers: options?.idempotencyKey
      ? { "Idempotency-Key": options.idempotencyKey }
      : undefined
  });
};

export const getEnvelopeOcrStatus = (id: number) => {
  return http.request<{
    success: boolean;
    data: {
      status: string;
      task_id: number | null;
      result: Record<string, unknown> | null;
      duplicate_count: number;
    };
  }>("get", `/api/v1/reimbursement/${id}/ocr-status`);
};

export const listPrecheckPendingEnvelopes = (params?: {
  project_id?: number;
  page?: number;
  pageSize?: number;
}) => {
  return http.request<{
    success: boolean;
    data: ReimbursementEnvelope[];
    pagination: Pagination;
  }>("get", "/api/v1/reimbursement/precheck/pending", { params });
};

export const triggerEnvelopeAnomalyCheck = (
  id: number,
  data?: { rerun_full?: boolean; reason?: string },
  options?: { idempotencyKey?: string }
) => {
  return http.request<{
    success: boolean;
    data: {
      task_id: number | null;
      precheck_status: string;
      rerun_full?: boolean;
    };
  }>("post", `/api/v1/reimbursement/${id}/trigger-anomaly-check`, {
    data,
    headers: options?.idempotencyKey
      ? { "Idempotency-Key": options.idempotencyKey }
      : undefined
  });
};

export const getEnvelopeAnomalyStatus = (id: number) => {
  return http.request<{
    success: boolean;
    data: {
      task_id: number | null;
      status: string;
      precheck_status: string;
      result: Record<string, unknown> | null;
    };
  }>("get", `/api/v1/reimbursement/${id}/anomaly-status`);
};

export const precheckEnvelope = (
  id: number,
  data: {
    action: "approved" | "supplement" | "rejected";
    comment?: string;
    override_einvoice_reason?: string;
  }
) => {
  return http.request<{
    success: boolean;
    data: { id: number; precheck_status: string; status: string };
  }>("post", `/api/v1/reimbursement/${id}/precheck`, { data });
};

export type DuplicateCenterItem = {
  id: number;
  envelope_id: number;
  envelope_no: string;
  project_id: number;
  applicant_userid: string;
  amount: number;
  matched_envelope_id: number | null;
  matched_invoice_no: string | null;
  match_type: string;
  match_score: number | null;
  risk_level: string;
  summary: string | null;
  evidence_json: string | null;
  created_at: string;
};

export const listDuplicateCenter = (params?: {
  risk_level?: string;
  page?: number;
  pageSize?: number;
}) => {
  return http.request<{
    success: boolean;
    data: DuplicateCenterItem[];
    pagination: Pagination;
  }>("get", "/api/v1/reimbursement/duplicate-center", { params });
};

export type ReimbursementBatch = {
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
};

export type ReimbursementBatchDetail = ReimbursementBatch & {
  items: (ReimbursementEnvelope & {
    batch_item_id: number;
    batch_amount: number;
    batch_item_status: string;
    attachments?: EnvelopeAttachment[];
    ai_reasonability_summary?: string | null;
    invoice_review_highest_risk?: "high" | "medium" | "low" | null;
    invoice_review_hints?: Array<{
      risk_level: string;
      risk_hint: string | null;
      invoice_no: string | null;
      invoice_date: string | null;
      invoice_amount: number | null;
      source: string | null;
      confidence: number | null;
    }>;
  })[];
  duplicate_summary: { risk_level: string; cnt: number }[];
  approval_instance?: {
    id: number;
    instance_no: string;
    status: string;
    current_node_key: string | null;
    current_round: number;
    submitted_at: string;
    completed_at: string | null;
    current_node_name: string | null;
  } | null;
  payment_entity?: {
    id: number;
    entity_code: string;
    entity_name: string;
  } | null;
  payment_bank_account?: {
    id: number;
    entity_id: number;
    bank_name: string;
    bank_branch_no: string | null;
    account_no: string;
    account_name: string;
  } | null;
  payee?: {
    id: number;
    name: string;
    bank_name: string;
    bank_account: string;
    phone: string | null;
    type: string;
  } | null;
  payment_vouchers?: Array<{
    file_key: string;
    file_name?: string;
    file_size?: number;
  }>;
};

export type ReimbursementBatchCandidateEnvelope = ReimbursementEnvelope;

export const listReimbursementBatches = (params?: {
  status?: string;
  project_id?: number;
  applicant_userid?: string;
  page?: number;
  pageSize?: number;
}) => {
  return http.request<{
    success: boolean;
    data: ReimbursementBatch[];
    pagination: Pagination;
  }>("get", "/api/v1/reimbursement/batch", { params });
};

export const getReimbursementBatch = (id: number) => {
  return http.request<{
    success: boolean;
    data: ReimbursementBatchDetail;
  }>("get", `/api/v1/reimbursement/batch/${id}`);
};

export const listReimbursementBatchCandidates = (params: {
  project_id: number;
  applicant_userid: string;
}) => {
  return http.request<{
    success: boolean;
    data: ReimbursementBatchCandidateEnvelope[];
  }>("get", "/api/v1/reimbursement/batch/candidates", { params });
};

export const createReimbursementBatch = (
  data: {
    project_id: number;
    applicant_userid: string;
    envelope_ids?: number[];
    payment_method?: string;
    payment_entity_id?: number;
    payment_entity_bank_account_id?: number;
    payment_account?: string;
    payee_id?: number;
  },
  options?: { idempotencyKey?: string }
) => {
  return http.request<{
    success: boolean;
    data: {
      id: number;
      batch_no: string;
      total_amount: number;
      item_count: number;
    };
  }>("post", "/api/v1/reimbursement/batch", {
    data,
    headers: options?.idempotencyKey
      ? { "Idempotency-Key": options.idempotencyKey }
      : undefined
  });
};

export const triggerBatchAudit = (id: number) => {
  return http.request<{
    success: boolean;
    data: { task_id: number; ai_audit_status: string };
  }>("post", `/api/v1/reimbursement/batch/${id}/trigger-audit`);
};

export const getBatchAuditReport = (id: number) => {
  return http.request<{
    success: boolean;
    data: {
      status: string;
      task_status: string;
      task_id: number | null;
      result: Record<string, unknown> | string | null;
    };
  }>("get", `/api/v1/reimbursement/batch/${id}/audit-report`);
};

export const submitBatchApproval = (
  id: number,
  data?: {
    biz_summary?: string;
    instance_config?: Record<string, unknown>;
    payment_method?: string;
    payment_entity_id?: number;
    payment_entity_bank_account_id?: number;
    payment_account?: string;
    payee_id?: number;
  },
  options?: { idempotencyKey?: string }
) => {
  return http.request<{
    success: boolean;
    data: { approval_instance_id: number; instance_no: string };
  }>("post", `/api/v1/reimbursement/batch/${id}/submit-approval`, {
    data,
    headers: options?.idempotencyKey
      ? { "Idempotency-Key": options.idempotencyKey }
      : undefined
  });
};

export const updateBatchPayoutPlan = (
  id: number,
  data: {
    payment_method?: string;
    payment_entity_id?: number;
    payment_entity_bank_account_id?: number;
    payment_account?: string;
    payee_id?: number;
  }
) => {
  return http.request<{
    success: boolean;
    data: {
      payment_method: string | null;
      payment_entity_id: number | null;
      payment_entity_bank_account_id: number | null;
      payment_account: string | null;
      payee_id: number | null;
    };
  }>("put", `/api/v1/reimbursement/batch/${id}/payout-plan`, { data });
};

export const markBatchPaid = (
  id: number,
  data?: {
    paid_at?: string;
    payment_reference?: string;
    payment_account?: string;
    payment_entity_id?: number;
    payment_entity_bank_account_id?: number;
    payment_vouchers?: {
      file_key: string;
      file_name?: string;
      file_size?: number;
    }[];
  },
  options?: { idempotencyKey?: string }
) => {
  return http.request<{ success: boolean }>(
    "post",
    `/api/v1/reimbursement/batch/${id}/mark-paid`,
    {
      data,
      headers: options?.idempotencyKey
        ? { "Idempotency-Key": options.idempotencyKey }
        : undefined
    }
  );
};

export const updateBatchPaymentVouchers = (
  id: number,
  data: {
    payment_vouchers?: {
      file_key: string;
      file_name?: string;
      file_size?: number;
    }[];
  }
) => {
  return http.request<{
    success: boolean;
    data: {
      payment_vouchers: {
        file_key: string;
        file_name?: string;
        file_size?: number;
      }[];
    };
  }>("put", `/api/v1/reimbursement/batch/${id}/payment-vouchers`, {
    data
  });
};

export const updateBatchItemBasicInfo = (
  batchId: number,
  envelopeId: number,
  data: {
    invoice_no?: string;
    expense_date?: string;
    amount?: number;
    category?: string;
    description?: string;
  }
) => {
  return http.request<{
    success: boolean;
    data: {
      envelope_id: number;
      invoice_no: string | null;
      expense_date: string | null;
      amount: number;
      category: string | null;
      description: string | null;
    };
  }>(
    "put",
    `/api/v1/reimbursement/batch/${batchId}/items/${envelopeId}/basic-info`,
    {
      data
    }
  );
};

export type SplitEnvelopeResult = {
  new_envelope: { id: number; envelope_no: string; envelope_uuid: string };
  original: { id: number; amount: number };
  amount_delta: number;
};

export const splitReimbursementEnvelope = (
  id: number,
  data: {
    new_envelope: {
      project_id: number;
      amount: number;
      category?: string;
      description?: string;
      expense_date?: string;
    };
    attachment_ids?: number[];
    original_amount: number;
    reason?: string;
  },
  options?: { idempotencyKey?: string }
) => {
  return http.request<{ success: boolean; data: SplitEnvelopeResult }>(
    "post",
    `/api/v1/reimbursement/${id}/split`,
    {
      data,
      headers: options?.idempotencyKey
        ? { "Idempotency-Key": options.idempotencyKey }
        : undefined
    }
  );
};

export type ReimbursementBatchProposal = {
  project_id: number;
  applicant_userid: string;
  item_count: number;
  total_amount: number;
  envelopes: {
    id: number;
    envelope_no: string;
    amount: number;
    description: string | null;
    channel: string;
    duplicate_risk_level: "high" | "medium" | "low" | null;
  }[];
  matched_payee: {
    id: number;
    name: string;
    bank_name: string;
    bank_account: string;
  } | null;
  payee_required: boolean;
  suggested_payment_method: string;
};

export const listReimbursementBatchProposals = () => {
  return http.request<{ success: boolean; data: ReimbursementBatchProposal[] }>(
    "get",
    "/api/v1/reimbursement/batch/proposals"
  );
};

export type BulkLifecycleResult = {
  results: { id: number; ok: boolean; status?: string; error?: string }[];
  succeeded: number;
  failed: number;
};

export const bulkVoidReimbursementEnvelopes = (data: {
  envelope_ids: number[];
  reason?: string;
}) => {
  return http.request<{ success: boolean; data: BulkLifecycleResult }>(
    "post",
    "/api/v1/reimbursement/void-batch",
    { data }
  );
};

export const bulkDeleteReimbursementEnvelopes = (data: {
  envelope_ids: number[];
  reason?: string;
}) => {
  return http.request<{ success: boolean; data: BulkLifecycleResult }>(
    "post",
    "/api/v1/reimbursement/delete-batch",
    { data }
  );
};
