import { http } from "@/utils/http";

export type ReimbursementEnvelope = {
  id: number;
  envelope_no: string;
  envelope_uuid: string;
  project_id: number;
  applicant_userid: string;
  channel: "physical" | "electronic";
  invoice_no: string | null;
  expense_date: string | null;
  amount: number;
  category: string | null;
  description: string | null;
  status: string;
  precheck_status: string;
  verification_status: string;
  pdf_status: string;
  pdf_task_id: number | null;
  pdf_file_key: string | null;
  created_at: string;
  updated_at: string;
  duplicate_count?: number;
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
  status?: string;
  project_id?: number;
  applicant_userid?: string;
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

export const getReimbursementEnvelope = (id: number) => {
  return http.request<{ success: boolean; data: ReimbursementEnvelopeDetail }>(
    "get",
    `/api/v1/reimbursement/${id}`
  );
};

export const createReimbursementEnvelope = (data: {
  project_id: number;
  applicant_userid?: string;
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
}) => {
  return http.request<{
    success: boolean;
    data: { id: number; envelope_no: string; envelope_uuid: string };
  }>("post", "/api/v1/reimbursement", { data });
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
    data: { id: number; status: string };
  }>("post", "/api/v1/reimbursement/scan", { data });
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

export const uploadElectronicInvoice = (data: {
  project_id: number;
  applicant_userid?: string;
  file_key: string;
  file_name?: string;
  file_size?: number;
  invoice_no?: string;
  amount?: number;
  issue_date?: string;
  description?: string;
}) => {
  return http.request<{
    success: boolean;
    data: {
      id: number;
      envelope_no: string;
      envelope_uuid: string;
      ocr_task_id: number;
    };
  }>("post", "/api/v1/reimbursement/electronic-upload", { data });
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

export const triggerEnvelopeAnomalyCheck = (id: number) => {
  return http.request<{
    success: boolean;
    data: { task_id: number; precheck_status: string };
  }>("post", `/api/v1/reimbursement/${id}/trigger-anomaly-check`);
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
  data: { action: "approved" | "supplement" | "rejected"; comment?: string }
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
  created_at: string;
  updated_at: string;
};

export type ReimbursementBatchDetail = ReimbursementBatch & {
  items: (ReimbursementEnvelope & {
    batch_item_id: number;
    batch_amount: number;
    batch_item_status: string;
  })[];
  duplicate_summary: { risk_level: string; cnt: number }[];
};

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

export const createReimbursementBatch = (data: {
  project_id: number;
  applicant_userid: string;
  envelope_ids?: number[];
}) => {
  return http.request<{
    success: boolean;
    data: {
      id: number;
      batch_no: string;
      total_amount: number;
      item_count: number;
    };
  }>("post", "/api/v1/reimbursement/batch", { data });
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
  data?: { biz_summary?: string; instance_config?: Record<string, unknown> }
) => {
  return http.request<{
    success: boolean;
    data: { approval_instance_id: number; instance_no: string };
  }>("post", `/api/v1/reimbursement/batch/${id}/submit-approval`, { data });
};

export const markBatchPaid = (
  id: number,
  data?: {
    paid_at?: string;
    payment_reference?: string;
    payment_account?: string;
  }
) => {
  return http.request<{ success: boolean }>(
    "post",
    `/api/v1/reimbursement/batch/${id}/mark-paid`,
    { data }
  );
};
