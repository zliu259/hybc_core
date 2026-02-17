// ─── Enums (as const arrays, matching auth.ts pattern) ──────────

export const nodeTypes = [
  "sequential",
  "countersign",
  "or_sign",
  "auto",
  "cc",
  "ai_gate"
] as const;
export type NodeType = (typeof nodeTypes)[number];

export const approvalActions = [
  "approve",
  "reject",
  "return_initiator",
  "return_prev",
  "return_to",
  "transfer",
  "withdraw",
  "cancel",
  "resubmit"
] as const;
export type ApprovalAction = (typeof approvalActions)[number];

export const instanceStatuses = [
  "pending",
  "in_progress",
  "approved",
  "rejected",
  "cancelled",
  "withdrawn"
] as const;
export type InstanceStatus = (typeof instanceStatuses)[number];

export const nodeStatuses = [
  "pending",
  "in_progress",
  "completed",
  "skipped",
  "returned"
] as const;
export type NodeStatus = (typeof nodeStatuses)[number];

export const taskStatuses = [
  "pending",
  "completed",
  "cancelled",
  "transferred"
] as const;
export type TaskStatus = (typeof taskStatuses)[number];

// ─── Template JSON Schema Types ──────────

/** Configuration for a single node in the approval template */
export interface TemplateNodeConfig {
  key: string;
  type: NodeType;
  name: string;
  assignee_userids?: string[];
  assignee_rule?: { type: "role" | "field"; value: string };
  auto_action?: "approve" | "reject";
  ai_slot_id?: string;
  timeout_hours?: number;
  conditions?: Array<{
    field: string;
    operator: string;
    value: unknown;
    next_key: string;
  }>;
  default_next_key?: string;
  next_key?: string | null;
}

/** Root configuration stored in approval_template.config_json */
export interface TemplateConfig {
  version: number;
  nodes: TemplateNodeConfig[];
  start_key: string;
}

// ─── DB Row Types (match 0005_approval.sql column-for-column) ──────────

export interface ApprovalTemplate {
  id: number;
  template_code: string;
  template_name: string;
  biz_type: string;
  config_json: string;
  status: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ApprovalThreshold {
  id: number;
  template_id: number;
  condition_field: string;
  operator: string;
  threshold_value: number;
  threshold_value_upper: number | null;
  target_branch: string;
  priority: number;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface ApprovalInstance {
  id: number;
  instance_no: string;
  template_id: number;
  biz_type: string;
  biz_id: number;
  biz_summary: string;
  initiator_userid: string;
  current_node_key: string | null;
  status: InstanceStatus;
  current_round: number;
  instance_config_json: string | null;
  submitted_at: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ApprovalNodeInstance {
  id: number;
  instance_id: number;
  node_key: string;
  node_type: NodeType;
  node_name: string;
  assignee_userids: string | null;
  status: NodeStatus;
  round: number;
  sort_order: number;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ApprovalTask {
  id: number;
  node_instance_id: number;
  instance_id: number;
  assignee_userid: string;
  action: string | null;
  comment: string | null;
  round: number;
  status: TaskStatus;
  acted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ApprovalTransfer {
  id: number;
  task_id: number;
  instance_id: number;
  from_userid: string;
  to_userid: string;
  reason: string | null;
  created_at: string;
}

export interface ApprovalInitiatorAction {
  id: number;
  instance_id: number;
  action: string;
  userid: string;
  comment: string | null;
  created_at: string;
}

// ─── Request/Response DTOs ──────────

export interface RouteContext {
  amount?: number;
  entity_id?: number;
  project_id?: number;
  [key: string]: unknown;
}

export interface NodeInstanceOverride {
  assignee_userids?: string[];
  timeout_hours?: number;
}

export interface InstanceConfig {
  default_assignee_userids?: string[];
  node_overrides?: Record<string, NodeInstanceOverride>;
  note?: string;
}

export interface SubmitApprovalRequest {
  biz_type: string;
  biz_id: number;
  biz_summary: string;
  context?: RouteContext;
  instance_config?: InstanceConfig;
}

export interface ApprovalActionRequest {
  comment?: string;
}

export interface ReturnRequest {
  type: "initiator" | "prev" | "to";
  target_node_key?: string;
  comment?: string;
}

export interface TransferRequest {
  to_userid: string;
  reason: string;
}

export interface CreateTemplateRequest {
  template_code: string;
  template_name: string;
  biz_type: string;
  config_json: string;
}

export interface ThresholdRule {
  template_id: number;
  condition_field: string;
  operator: string;
  threshold_value: number;
  threshold_value_upper?: number;
  target_branch: string;
  priority: number;
}

export interface PendingApprovalItem {
  id: number;
  instance_no: string;
  biz_type: string;
  biz_summary: string;
  initiator_userid: string;
  current_node_key: string | null;
  current_node_name: string | null;
  status: InstanceStatus;
  submitted_at: string;
  task_id: number;
  task_status: TaskStatus;
}

export interface ApprovalDetailResponse {
  instance: ApprovalInstance;
  template: ApprovalTemplate;
  nodes: ApprovalNodeInstance[];
  tasks: ApprovalTask[];
  transfers: ApprovalTransfer[];
  initiator_actions: ApprovalInitiatorAction[];
  available_actions: ApprovalAction[];
}

// ─── AI Gate Placeholder Interface ──────────

/** 
 * Interface for AI Gate node integration with AI Slot framework.
 * Implemented by AI Slot Manager in services/ai-slot.ts.
 * Used as placeholder so approval engine Track A and AI Slot Track B
 * can be developed independently.
 */
export interface AiGateHandler {
  createAiTask(
    env: import("./env").Env,
    request: {
      biz_type: string;
      biz_id: number;
      payload: Record<string, unknown>;
    }
  ): Promise<{ task_id: number }>;

  getTaskResult(
    env: import("./env").Env,
    taskId: number
  ): Promise<{
    completed: boolean;
    outcome?: "approve" | "reject";
    comment?: string;
  } | null>;
}
