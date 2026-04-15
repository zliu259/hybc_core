import { http } from "@/utils/http";

export type ApprovalInstance = {
  id: number;
  instance_no: string;
  template_id: number;
  biz_type: string;
  biz_id: number;
  biz_summary: string;
  initiator_userid: string;
  biz_applicant_userid?: string | null;
  current_node_key: string | null;
  status: string;
  current_round: number;
  submitted_at: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  initiated_bucket?: InitiatedBucket;
  has_pending_task_for_initiator?: boolean;
  can_remind?: boolean;
  last_updated_at?: string;
};

export type InitiatedBucket =
  | "returned_needs_action"
  | "in_progress"
  | "done";

export type InitiatedApprovalSummary = {
  total: number;
  returned_needs_action: number;
  in_progress: number;
  done: number;
  remindable: number;
};

export type PendingApprovalItem = {
  id: number;
  instance_no: string;
  biz_type: string;
  biz_summary: string;
  biz_detail?: string | null;
  biz_amount?: number | null;
  biz_project_id?: number | null;
  project_name?: string | null;
  project_code?: string | null;
  initiator_userid: string;
  biz_applicant_userid?: string | null;
  current_node_key: string | null;
  current_node_name: string | null;
  status: string;
  submitted_at: string;
  task_id: number;
  task_status: string;
};

export type ProcessedApprovalItem = {
  id: number;
  instance_no: string;
  biz_type: string;
  biz_summary: string;
  biz_detail?: string | null;
  biz_amount?: number | null;
  biz_project_id?: number | null;
  project_name?: string | null;
  project_code?: string | null;
  initiator_userid: string;
  biz_applicant_userid?: string | null;
  status: string;
  submitted_at: string;
  action: string | null;
  acted_at: string | null;
  comment: string | null;
};

export type ApprovalNodeInstance = {
  id: number;
  instance_id: number;
  node_key: string;
  node_type: string;
  node_name: string;
  assignee_userids: string | null;
  status: string;
  round: number;
  sort_order: number;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ApprovalTask = {
  id: number;
  node_instance_id: number;
  instance_id: number;
  assignee_userid: string;
  action: string | null;
  comment: string | null;
  round: number;
  status: string;
  acted_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ApprovalTransfer = {
  id: number;
  task_id: number;
  instance_id: number;
  from_userid: string;
  to_userid: string;
  reason: string | null;
  created_at: string;
};

export type ApprovalInitiatorAction = {
  id: number;
  instance_id: number;
  action: string;
  userid: string;
  comment: string | null;
  created_at: string;
};

export type AiGateReview = {
  task_id: number;
  node_key: string | null;
  ai_slot_id: string | null;
  status: string;
  summary: string | null;
  recommendations: string[];
  outcome: "approve" | "reject" | null;
  comment: string | null;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
};

export type ApprovalTemplate = {
  id: number;
  template_code: string;
  template_name: string;
  biz_type: string;
  config_json: string;
  status: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type ApprovalDetailResponse = {
  instance: ApprovalInstance;
  template: ApprovalTemplate;
  nodes: ApprovalNodeInstance[];
  tasks: ApprovalTask[];
  transfers: ApprovalTransfer[];
  initiator_actions: ApprovalInitiatorAction[];
  ai_gate_reviews: AiGateReview[];
  available_actions: string[];
};

type PaginatedResponse<T> = {
  success: boolean;
  data: T[];
  pagination: { page: number; pageSize: number; total: number };
};

export const listApprovalInstances = (params?: {
  biz_type?: string;
  status?: string;
  initiator?: string;
  initiatedBucket?: InitiatedBucket;
  keyword?: string;
  page?: number;
  pageSize?: number;
}) => {
  return http.request<PaginatedResponse<ApprovalInstance>>(
    "get",
    "/api/v1/approval",
    { params }
  );
};

export const getInitiatedApprovalSummary = (params?: {
  initiator?: string;
}) => {
  return http.request<{ success: boolean; data: InitiatedApprovalSummary }>(
    "get",
    "/api/v1/approval/initiated/summary",
    { params }
  );
};

export const listAllApprovalInstances = (params?: {
  biz_type?: string;
  status?: string;
  keyword?: string;
  initiator?: string;
  page?: number;
  pageSize?: number;
}) => {
  return http.request<PaginatedResponse<ApprovalInstance>>(
    "get",
    "/api/v1/approval/admin/all",
    { params }
  );
};

export const listPendingApprovals = (params?: {
  biz_type?: string;
  keyword?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}) => {
  return http.request<PaginatedResponse<PendingApprovalItem>>(
    "get",
    "/api/v1/approval/pending",
    { params }
  );
};

export const listProcessedApprovals = (params?: {
  biz_type?: string;
  keyword?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}) => {
  return http.request<PaginatedResponse<ProcessedApprovalItem>>(
    "get",
    "/api/v1/approval/processed",
    { params }
  );
};

export const listCcApprovals = (params?: {
  biz_type?: string;
  keyword?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}) => {
  return http.request<PaginatedResponse<ApprovalInstance>>(
    "get",
    "/api/v1/approval/cc",
    { params }
  );
};

export const getApprovalDetail = (id: number) => {
  return http.request<{ success: boolean; data: ApprovalDetailResponse }>(
    "get",
    `/api/v1/approval/${id}`
  );
};

export const submitApproval = (data: {
  biz_type: string;
  biz_id: number;
  biz_summary: string;
  context?: Record<string, unknown>;
}) => {
  return http.request<{ success: boolean; data: ApprovalInstance }>(
    "post",
    "/api/v1/approval/submit",
    { data }
  );
};

export const approveApproval = (id: number, data: { comment?: string }) => {
  return http.request<{ success: boolean }>(
    "post",
    `/api/v1/approval/${id}/approve`,
    { data }
  );
};

export const rejectApproval = (id: number, data: { comment?: string }) => {
  return http.request<{ success: boolean }>(
    "post",
    `/api/v1/approval/${id}/reject`,
    { data }
  );
};

export const returnApproval = (
  id: number,
  data: {
    type: "initiator" | "prev" | "to";
    target_node_key?: string;
    comment?: string;
  }
) => {
  return http.request<{ success: boolean }>(
    "post",
    `/api/v1/approval/${id}/return`,
    { data }
  );
};

export const transferApproval = (
  id: number,
  data: { to_userid: string; reason: string }
) => {
  return http.request<{ success: boolean }>(
    "post",
    `/api/v1/approval/${id}/transfer`,
    { data }
  );
};

export const forceTransferApproval = (
  id: number,
  data: { task_id: number; to_userid: string; reason: string }
) => {
  return http.request<{ success: boolean }>(
    "post",
    `/api/v1/approval/${id}/force-transfer`,
    { data }
  );
};

export const forceApproveTask = (
  instanceId: number,
  data: { task_id: number; comment?: string }
) => {
  return http.request<{ success: boolean }>(
    "post",
    `/api/v1/approval/${instanceId}/force-approve`,
    { data }
  );
};

export const withdrawApproval = (id: number, data?: { comment?: string }) => {
  return http.request<{ success: boolean }>(
    "post",
    `/api/v1/approval/${id}/withdraw`,
    { data }
  );
};

export const cancelApproval = (id: number, data?: { comment?: string }) => {
  return http.request<{ success: boolean }>(
    "post",
    `/api/v1/approval/${id}/cancel`,
    { data }
  );
};

export const resubmitApproval = (
  id: number,
  data?: { biz_summary?: string }
) => {
  return http.request<{ success: boolean }>(
    "post",
    `/api/v1/approval/${id}/resubmit`,
    { data }
  );
};

export const uploadApprovalAttachment = (
  id: number,
  data: { file_key: string; file_name: string; file_size?: number }
) => {
  return http.request<{ success: boolean }>(
    "post",
    `/api/v1/approval/${id}/attachments`,
    { data }
  );
};
