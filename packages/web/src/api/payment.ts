import { http } from "@/utils/http";
import type { InstanceConfig } from "./contract";

export type PaymentRequest = {
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
  status: string;
  approval_instance_id: number | null;
  ai_risk_status: string;
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
};

export type PaymentRequestDetail = PaymentRequest & {
  contract: {
    contract_no: string;
    counterparty: string;
    total_amount: number;
    paid_amount: number;
  } | null;
  payee: {
    name: string;
    bank_name: string;
    bank_account: string;
  } | null;
};

export type Payee = {
  id: number;
  name: string;
  bank_name: string;
  bank_account: string;
  phone: string | null;
  type: "internal" | "external";
  status: string;
  created_by_userid: string;
  created_at: string;
  updated_at: string;
};

type Pagination = { page: number; pageSize: number; total: number };

export const listPaymentRequests = (params?: {
  contract_id?: number;
  project_id?: number;
  status?: string;
  keyword?: string;
  applicant_userid?: string;
  mine?: boolean;
  page?: number;
  pageSize?: number;
}) => {
  return http.request<{
    success: boolean;
    data: PaymentRequest[];
    pagination: Pagination;
  }>("get", "/api/v1/payment", { params });
};

export const getPaymentRequest = (id: number) => {
  return http.request<{ success: boolean; data: PaymentRequestDetail }>(
    "get",
    `/api/v1/payment/${id}`
  );
};

export const createPaymentRequest = (
  data: {
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
  },
  options?: { idempotencyKey?: string }
) => {
  return http.request<{
    success: boolean;
    data: { id: number; serial_no: string; amount_cn: string };
  }>("post", "/api/v1/payment", {
    data,
    headers: options?.idempotencyKey
      ? { "Idempotency-Key": options.idempotencyKey }
      : undefined
  });
};

export const updatePaymentRequest = (
  id: number,
  data: {
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
    status?: string;
    admin_edit_mode?: boolean;
    edit_note?: string;
  }
) => {
  return http.request<{ success: boolean }>("put", `/api/v1/payment/${id}`, {
    data
  });
};

export const markPaymentPaid = (
  id: number,
  data?: {
    paid_at?: string;
    payment_reference?: string;
    payment_account?: string;
    remark?: string;
  }
) => {
  return http.request<{ success: boolean }>(
    "post",
    `/api/v1/payment/${id}/mark-paid`,
    { data }
  );
};

export const voidPayment = (id: number, data?: { reason?: string }) => {
  return http.request<{ success: boolean }>(
    "post",
    `/api/v1/payment/${id}/void`,
    {
      data
    }
  );
};

export const reactivatePayment = (id: number) => {
  return http.request<{ success: boolean }>(
    "post",
    `/api/v1/payment/${id}/reactivate`
  );
};

export const triggerRiskAssessment = (id: number) => {
  return http.request<{ success: boolean }>(
    "post",
    `/api/v1/payment/${id}/trigger-risk-assessment`
  );
};

export const submitPaymentApproval = (
  id: number,
  data?: { biz_summary?: string; instance_config?: InstanceConfig },
  options?: { idempotencyKey?: string }
) => {
  return http.request<{
    success: boolean;
    data: { approval_instance_id: number; instance_no: string };
  }>("post", `/api/v1/payment/${id}/submit-approval`, {
    data,
    headers: options?.idempotencyKey
      ? { "Idempotency-Key": options.idempotencyKey }
      : undefined
  });
};

export const getRiskReport = (id: number) => {
  return http.request<{
    success: boolean;
    data: { status: string; result: Record<string, unknown> | null };
  }>("get", `/api/v1/payment/${id}/risk-report`);
};

export const listPayees = (params?: {
  type?: string;
  keyword?: string;
  mine?: boolean;
}) => {
  return http.request<{ success: boolean; data: Payee[] }>(
    "get",
    "/api/v1/payment/payee/list",
    { params }
  );
};

export const getPayee = (id: number) => {
  return http.request<{ success: boolean; data: Payee }>(
    "get",
    `/api/v1/payment/payee/${id}`
  );
};

export const createPayee = (data: {
  name: string;
  bank_name: string;
  bank_account: string;
  phone?: string;
  type: "internal" | "external";
}) => {
  return http.request<{ success: boolean; data: { id: number } }>(
    "post",
    "/api/v1/payment/payee",
    { data }
  );
};

export const updatePayee = (
  id: number,
  data: {
    name?: string;
    bank_name?: string;
    bank_account?: string;
    phone?: string;
    type?: "internal" | "external";
  }
) => {
  return http.request<{ success: boolean }>(
    "put",
    `/api/v1/payment/payee/${id}`,
    { data }
  );
};

export const deletePayee = (id: number) => {
  return http.request<{ success: boolean }>(
    "delete",
    `/api/v1/payment/payee/${id}`
  );
};
