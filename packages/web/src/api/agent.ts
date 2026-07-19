import { http } from "@/utils/http";

export type AgentGrant = {
  id: string;
  device_name: string | null;
  agent_type: string | null;
  token_prefix: string | null;
  status: "active" | "revoked" | "expired";
  created_at: string;
  expires_at: string;
  last_used_at: string | null;
};

export type AdminAgentGrant = AgentGrant & {
  wecom_userid: string;
  role_snapshot: string;
};

export type AgentProvisionResult = {
  boot_code: string;
  expires_in: number;
  install_sh: string;
  install_ps1: string;
};

export type AgentDeviceInfo = {
  user_code: string;
  device_name: string | null;
  agent_type: string | null;
  client_info: string | null;
  status: "pending" | "approved" | "denied";
};

export const AGENT_TYPE_LABELS: Record<string, string> = {
  claude_code: "Claude Code",
  codex: "Codex",
  claude_desktop: "Claude Desktop",
  other: "其它 Agent"
};

export const agentTypeLabel = (value: string | null, fallback = "未知 Agent") =>
  (value && AGENT_TYPE_LABELS[value]) || value || fallback;

export const provisionAgent = (data: {
  device_name: string;
  agent_type: string;
}) => {
  return http.request<{ success: boolean; data: AgentProvisionResult }>(
    "post",
    "/api/v1/agent/setup/provision",
    { data }
  );
};

export const getDeviceInfo = (userCode: string) => {
  return http.request<{ success: boolean; data: AgentDeviceInfo }>(
    "get",
    "/api/v1/agent/device/info",
    { params: { user_code: userCode } }
  );
};

export const approveDevice = (userCode: string) => {
  return http.request<{ success: boolean; data: { approved: boolean } }>(
    "post",
    "/api/v1/agent/device/approve",
    { data: { user_code: userCode } }
  );
};

export const denyDevice = (userCode: string) => {
  return http.request<{ success: boolean; data: { denied: boolean } }>(
    "post",
    "/api/v1/agent/device/deny",
    { data: { user_code: userCode } }
  );
};

export const listMyAgentGrants = () => {
  return http.request<{ success: boolean; data: AgentGrant[] }>(
    "get",
    "/api/v1/agent/grants"
  );
};

export const revokeMyAgentGrant = (id: string) => {
  return http.request<{ success: boolean; data: { revoked: boolean } }>(
    "post",
    `/api/v1/agent/grants/${id}/revoke`
  );
};

export const adminListAgentGrants = () => {
  return http.request<{ success: boolean; data: AdminAgentGrant[] }>(
    "get",
    "/api/v1/admin/agent/grants"
  );
};

export const adminRevokeAgentGrant = (id: string) => {
  return http.request<{ success: boolean; data: { revoked: boolean } }>(
    "post",
    `/api/v1/admin/agent/grants/${id}/revoke`
  );
};

export type PendingApprovalContext = {
  instance_no: string;
  biz_type: string;
  biz_summary: string;
  initiator_userid: string;
};

export type PendingActionDetail = {
  action_kind: string;
  /** 未登记的动作类型为 null —— 页面必须显式处理，绝不兜底成「批准」 */
  verb: string | null;
  target: string;
  approval: PendingApprovalContext | null;
  /** 智能体填写、将以员工名义入库的意见 */
  agent_comment: string | null;
};

export type PendingStatus =
  | "pending"
  | "confirmed"
  | "executing"
  | "done"
  | "failed"
  | "rejected"
  | "expired";

export type PendingPublicView = {
  id: string;
  action_kind: string;
  summary: string;
  status: PendingStatus;
  detail: PendingActionDetail | null;
  created_at: string;
  expires_at: string;
  confirmed_at: string | null;
  executed_at: string | null;
  result: unknown | null;
};

/** 确认页首屏：用卡片链接里的一次性 token 定位待确认动作（仅本人可见，否则 404）。 */
export const getPendingByToken = (token: string) => {
  return http.request<{ success: boolean; data: PendingPublicView }>(
    "get",
    `/api/v1/agent/pending/by-token/${encodeURIComponent(token)}`
  );
};

export const getPendingAction = (id: string) => {
  return http.request<{ success: boolean; data: PendingPublicView }>(
    "get",
    `/api/v1/agent/pending/${id}`
  );
};

export const confirmPendingAction = (id: string) => {
  return http.request<{ success: boolean; data: PendingPublicView }>(
    "post",
    `/api/v1/agent/pending/${id}/confirm`
  );
};

export const rejectPendingAction = (id: string) => {
  return http.request<{
    success: boolean;
    data: PendingPublicView & { rejected: boolean };
  }>("post", `/api/v1/agent/pending/${id}/reject`);
};
