import { http } from "@/utils/http";

/** 合同进度档位，由后端算。付款合同和收款合同各用其中一部分。 */
export type ExecutionBand =
  | "normal"
  | "warning"
  | "critical"
  | "not_started"
  | "collecting"
  | "settled"
  | "over"
  | "unpriced";

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
  /** 旧系统迁移标识：非空表示历史导入数据 */
  legacy_data_id: string | null;
  created_at: string;
  updated_at: string;
  /** 只有列表接口带这两项 */
  project_name?: string | null;
  execution_band?: ExecutionBand;
};

export type ContractOverviewBand = {
  band: ExecutionBand;
  count: number;
  total_amount: number;
  done_amount: number;
};

export type ContractOverview = {
  direction: Contract["direction"];
  status_counts: Record<string, number>;
  total_count: number;
  execution: {
    count: number;
    total_amount: number;
    /** 付款合同是已付，收款合同是已到账 */
    done_amount: number;
    remaining_amount: number;
    /** 只有收款合同有 */
    invoiced_amount: number;
    bands: ContractOverviewBand[];
  };
};

export type AmountChangeAttachment = {
  file_key: string;
  file_name: string;
  file_size: number | null;
};

export type AmountChangeAttachmentView = AmountChangeAttachment & {
  file_url: string;
};

export type ContractAmountChange = {
  id: number;
  contract_id: number;
  change_type: string;
  old_amount: number;
  new_amount: number;
  reason: string;
  status: string;
  approval_instance_id: number | null;
  applicant_userid: string;
  attachments: AmountChangeAttachmentView[];
  created_at: string;
  /** 审批实例状态；变更单提交后业务状态一直是 pending，要靠它判断走到哪了 */
  approval_status?: string | null;
};

/** 审批详情页用：单条金额变更申请 + 所属合同摘要 */
export type AmountChangeDetail = ContractAmountChange & {
  contract: Pick<
    Contract,
    | "id"
    | "contract_no"
    | "direction"
    | "project_id"
    | "entity_id"
    | "counterparty"
    | "contract_type"
    | "total_amount"
    | "paid_amount"
    | "received_amount"
    | "status"
  > | null;
};

export type ContractDetail = Contract & {
  project: { project_name: string; project_code: string } | null;
  entity: { entity_name: string } | null;
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

export type InstanceConfig = {
  default_assignee_userids?: string[];
  node_overrides?: Record<
    string,
    { assignee_userids?: string[]; timeout_hours?: number }
  >;
  note?: string;
};

export const listContracts = (params?: {
  direction?: string;
  project_id?: number;
  entity_id?: number;
  status?: string;
  keyword?: string;
  applicant_userid?: string;
  band?: ExecutionBand;
  page?: number;
  pageSize?: number;
}) => {
  return http.request<{
    success: boolean;
    data: Contract[];
    pagination: Pagination;
  }>("get", "/api/v1/contract", { params });
};

export const getContractOverview = (params: {
  direction: Contract["direction"];
  project_id?: number;
  keyword?: string;
}) => {
  return http.request<{ success: boolean; data: ContractOverview }>(
    "get",
    "/api/v1/contract/overview-summary",
    { params }
  );
};

export const getContract = (id: number) => {
  return http.request<{ success: boolean; data: ContractDetail }>(
    "get",
    `/api/v1/contract/${id}`
  );
};

export const createContract = (
  data: {
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
  },
  options?: { idempotencyKey?: string }
) => {
  return http.request<{
    success: boolean;
    data: { id: number; contract_no: string };
  }>("post", "/api/v1/contract", {
    data,
    headers: options?.idempotencyKey
      ? { "Idempotency-Key": options.idempotencyKey }
      : undefined
  });
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
    admin_edit_mode?: boolean;
    edit_note?: string;
  }
) => {
  return http.request<{ success: boolean }>("put", `/api/v1/contract/${id}`, {
    data
  });
};

export const deleteContract = (id: number) => {
  return http.request<{ success: boolean }>("delete", `/api/v1/contract/${id}`);
};

export const createAmountChange = (
  contractId: number,
  data: {
    change_type: string;
    new_amount: number;
    reason: string;
    attachments?: AmountChangeAttachment[];
  }
) => {
  return http.request<{ success: boolean; data: { id: number } }>(
    "post",
    `/api/v1/contract/${contractId}/amount-change`,
    { data }
  );
};

export const getAmountChange = (changeId: number) => {
  return http.request<{ success: boolean; data: AmountChangeDetail }>(
    "get",
    `/api/v1/contract/amount-change/${changeId}`
  );
};

export const submitAmountChangeApproval = (
  contractId: number,
  changeId: number,
  data?: { biz_summary?: string; instance_config?: InstanceConfig }
) => {
  return http.request<{
    success: boolean;
    data: { approval_instance_id: number; instance_no: string };
  }>(
    "post",
    `/api/v1/contract/${contractId}/amount-change/${changeId}/submit-approval`,
    { data }
  );
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

export const submitContractApproval = (
  contractId: number,
  data?: { biz_summary?: string; instance_config?: InstanceConfig },
  options?: { idempotencyKey?: string }
) => {
  return http.request<{
    success: boolean;
    data: { approval_instance_id: number; instance_no: string };
  }>("post", `/api/v1/contract/${contractId}/submit-approval`, {
    data,
    headers: options?.idempotencyKey
      ? { "Idempotency-Key": options.idempotencyKey }
      : undefined
  });
};
