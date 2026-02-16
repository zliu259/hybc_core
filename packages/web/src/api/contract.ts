import { http } from "@/utils/http";

export type Contract = {
  id: number;
  contract_no: string;
  direction: "outbound" | "inbound";
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
  status: string;
  ai_review_status: string;
  ai_review_result: string | null;
  approval_instance_id: number | null;
  attachments_json: string | null;
  remark: string | null;
  created_at: string;
  updated_at: string;
};

export type ContractAmountChange = {
  id: number;
  contract_id: number;
  change_type: string;
  old_amount: number;
  new_amount: number;
  reason: string;
  status: string;
  applicant_userid: string;
  created_at: string;
};

export type ContractDetail = Contract & {
  amount_changes: ContractAmountChange[];
  payment_requests: {
    id: number;
    serial_no: string;
    amount: number;
    status: string;
    created_at: string;
  }[];
};

type Pagination = { page: number; pageSize: number; total: number };

export const listContracts = (params?: {
  direction?: string;
  project_id?: number;
  entity_id?: number;
  status?: string;
  keyword?: string;
  page?: number;
  pageSize?: number;
}) => {
  return http.request<{
    success: boolean;
    data: Contract[];
    pagination: Pagination;
  }>("get", "/api/v1/contract", { params });
};

export const getContract = (id: number) => {
  return http.request<{ success: boolean; data: ContractDetail }>(
    "get",
    `/api/v1/contract/${id}`
  );
};

export const createContract = (data: {
  direction: string;
  project_id: number;
  entity_id: number;
  counterparty: string;
  contract_type: string;
  handler_userid: string;
  contract_date: string;
  total_amount: number;
  attachments_json?: string;
  remark?: string;
}) => {
  return http.request<{
    success: boolean;
    data: { id: number; contract_no: string };
  }>("post", "/api/v1/contract", { data });
};

export const updateContract = (
  id: number,
  data: {
    counterparty?: string;
    contract_type?: string;
    handler_userid?: string;
    contract_date?: string;
    total_amount?: number;
    attachments_json?: string;
    remark?: string;
    status?: string;
  }
) => {
  return http.request<{ success: boolean }>(
    "put",
    `/api/v1/contract/${id}`,
    { data }
  );
};

export const deleteContract = (id: number) => {
  return http.request<{ success: boolean }>(
    "delete",
    `/api/v1/contract/${id}`
  );
};

export const createAmountChange = (
  contractId: number,
  data: {
    change_type: string;
    new_amount: number;
    reason: string;
  }
) => {
  return http.request<{ success: boolean; data: { id: number } }>(
    "post",
    `/api/v1/contract/${contractId}/amount-change`,
    { data }
  );
};

export const submitAmountChangeApproval = (
  contractId: number,
  changeId: number
) => {
  return http.request<{
    success: boolean;
    data: { approval_instance_id: number; instance_no: string };
  }>("post", `/api/v1/contract/${contractId}/amount-change/${changeId}/submit-approval`);
};

export const getAiReview = (contractId: number) => {
  return http.request<{
    success: boolean;
    data: { status: string; result: Record<string, unknown> | null };
  }>("get", `/api/v1/contract/${contractId}/ai-review`);
};

export const triggerAiReview = (contractId: number) => {
  return http.request<{ success: boolean }>(
    "post",
    `/api/v1/contract/${contractId}/trigger-review`
  );
};

export const submitContractApproval = (contractId: number) => {
  return http.request<{
    success: boolean;
    data: { approval_instance_id: number; instance_no: string };
  }>("post", `/api/v1/contract/${contractId}/submit-approval`);
};
