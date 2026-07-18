import type { UserRole } from "./auth";

export interface AgentGrantRow {
  id: string;
  wecom_userid: string;
  device_name: string | null;
  client_info: string | null;
  agent_type: string | null;
  token_hash: string;
  token_prefix: string | null;
  role_snapshot: UserRole;
  status: "active" | "revoked" | "expired";
  created_at: string;
  expires_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  revoked_by: string | null;
}

export interface AgentIdentity {
  wecomUserid: string;
  grantId: string;
  roles: UserRole[];
  permissions: string[];
}

export type DeviceStatus = "pending" | "approved" | "denied";

export interface DeviceCodeRecord {
  userCode: string;
  status: DeviceStatus;
  agentType?: string;
  deviceName?: string;
  clientInfo?: string;
  wecomUserid?: string;
  role?: UserRole;
  agentToken?: string;
  expiresAt: string;
  createdAt: string;
}

export interface PublicGrantView {
  id: string;
  device_name: string | null;
  agent_type: string | null;
  token_prefix: string | null;
  status: AgentGrantRow["status"];
  created_at: string;
  expires_at: string;
  last_used_at: string | null;
}

export interface AdminGrantView extends PublicGrantView {
  wecom_userid: string;
  role_snapshot: UserRole;
}

export type PendingStatus =
  | "pending"
  | "confirmed"
  | "executing"
  | "done"
  | "failed"
  | "rejected"
  | "expired";

export interface AgentPendingRow {
  id: string;
  grant_id: string;
  wecom_userid: string;
  action_kind: string;
  /** JSON: { method, path, headers: { authorization, "content-type" }, body } */
  request_snapshot: string;
  risk_reason: string | null;
  summary: string;
  status: PendingStatus;
  /** JSON: { status: number, body: unknown } */
  result_snapshot: string | null;
  confirm_token_hash: string;
  created_at: string;
  expires_at: string;
  confirmed_at: string | null;
  executed_at: string | null;
}

/** 回给 MCP / 确认页的安全投影：绝不含 request_snapshot（内含 Authorization）与 confirm_token。 */
export interface PendingPublicView {
  id: string;
  action_kind: string;
  summary: string;
  status: PendingStatus;
  created_at: string;
  expires_at: string;
  confirmed_at: string | null;
  executed_at: string | null;
  result: unknown | null;
}

export interface RequestSnapshot {
  method: string;
  /**
   * 【已归一化的】请求路径，不含 query —— 取自闸门的 c.req.path（Hono 已解码百分号转义）。
   *
   * 必须与闸门匹配/校验时看到的字符串【逐字相同】：重放标记签的就是它，而验签方读的是重放请求的
   * c.req.path。若这里存 new URL(url).pathname（不解码），`/appro%76al/...` 两侧就会分叉：
   * 摘要退化成中性描述（骗人），签名与验签也对不上（已确认的动作被静默降级成再次 park）。
   */
  path: string;
  /** 原始 query 串（含前导 "?"，无 query 时为 ""）。单独留存，重放时拼回 URL。 */
  search?: string;
  headers: Record<string, string>;
  body: string;
}
