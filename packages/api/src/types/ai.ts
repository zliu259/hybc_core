// ─── Enums ──────────

export const taskTypes = [
  "contract_review",
  "risk_assessment",
  "payment_risk_assessment",
  "reimbursement_check",
  "reimbursement_anomaly",
  "log_smart_fill",
  "log_analysis",
  "log_summary",
  "external_log_audit",
  "equipment_recommend",
  "consumable_estimation",
  "inventory_alert_analysis",
  "consumption_anomaly",
  "ocr_extract",
  "file_generate",
  "voice_stt",
  "approval_ai_gate",
  "warehouse_task_dispatch_recommendation",
  "tbm_composition_recommendation",
  "warehouse_manual_draft",
  "warehouse_task_summary",
  "bidding_dedup_rewrite"
] as const;
export type TaskType = (typeof taskTypes)[number];

export const taskQueueStatuses = [
  "pending",
  "assigned",
  "running",
  "completed",
  "failed",
  "timeout"
] as const;
export type TaskQueueStatus = (typeof taskQueueStatuses)[number];

export const computeNodeStatuses = ["online", "offline", "draining"] as const;
export type ComputeNodeStatus = (typeof computeNodeStatuses)[number];

export const providerKeys = ["claude", "openai", "local"] as const;
export type ProviderKey = (typeof providerKeys)[number];

// ─── DB Row Types (match 0006_ai_slot.sql column-for-column) ──────────

export interface AiProviderConfig {
  id: number;
  provider_key: string;
  provider_name: string;
  api_endpoint: string | null;
  model_id: string | null;
  config_json: string | null;
  priority: number;
  max_concurrent: number;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface AiRoutingRule {
  id: number;
  rule_name: string;
  biz_type: string;
  task_type: string;
  condition_json: string | null;
  provider_id: number;
  prompt_template_id: number | null;
  priority: number;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface AiPromptTemplate {
  id: number;
  template_key: string;
  template_name: string;
  system_prompt: string;
  user_prompt_template: string;
  variables_schema: string | null;
  version: number;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface AiAuditLog {
  id: number;
  task_id: number | null;
  biz_type: string;
  biz_id: number;
  provider_key: string;
  model_id: string | null;
  prompt_hash: string | null;
  input_summary: string | null;
  output_summary: string | null;
  tokens_input: number;
  tokens_output: number;
  latency_ms: number;
  status: string;
  error_message: string | null;
  compute_node_id: string | null;
  created_at: string;
}

export interface TaskQueueItem {
  id: number;
  task_code: string;
  task_type: string;
  biz_type: string;
  biz_id: number;
  priority: number;
  payload_json: string;
  provider_id: number | null;
  assigned_node_id: string | null;
  status: TaskQueueStatus;
  max_retries: number;
  retry_count: number;
  timeout_seconds: number;
  result_json: string | null;
  error_message: string | null;
  assigned_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ComputeNode {
  id: number;
  node_id: string;
  node_name: string;
  node_type: string;
  capabilities_json: string | null;
  status: ComputeNodeStatus;
  cpu_cores: number | null;
  memory_mb: number | null;
  last_heartbeat_at: string | null;
  registered_at: string;
  created_at: string;
  updated_at: string;
}

// ─── Request/Response DTOs ──────────

export interface CreateTaskRequest {
  task_type: TaskType;
  biz_type: string;
  biz_id: number;
  payload: Record<string, unknown>;
  priority?: number;
  timeout_seconds?: number;
}

export interface TaskPollResponse {
  task: TaskQueueItem | null;
  provider?: {
    key: string;
    endpoint: string;
    model: string;
    config: Record<string, unknown>;
  };
  runner_runtime?: Record<string, string>;
  prompt?: {
    system: string;
    user: string;
  } | null;
}

export interface RunnerRuntimeConfigItem {
  id: number;
  config_key: string;
  config_value: string;
  is_secret: 0 | 1;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaskResultSubmission {
  output: string;
  tokens_input?: number;
  tokens_output?: number;
  latency_ms?: number;
  metadata?: Record<string, unknown>;
}

export interface HeartbeatRequest {
  cpu_usage?: number;
  memory_usage?: number;
  active_tasks?: number;
  status: ComputeNodeStatus;
}

export interface NodeRegistrationRequest {
  node_id: string;
  node_name: string;
  node_type: string;
  capabilities: TaskType[];
  cpu_cores?: number;
  memory_mb?: number;
}

export interface ProviderConfigRequest {
  provider_key: string;
  provider_name: string;
  api_endpoint?: string;
  model_id?: string;
  config_json?: string;
  priority?: number;
  max_concurrent?: number;
}

export interface RoutingRuleRequest {
  rule_name: string;
  biz_type: string;
  task_type: TaskType;
  condition_json?: string;
  provider_id: number;
  prompt_template_id?: number;
  priority?: number;
}

export interface PromptTemplateRequest {
  template_key: string;
  template_name: string;
  system_prompt: string;
  user_prompt_template: string;
  variables_schema?: string;
}
