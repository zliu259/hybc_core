export type NodeType =
  | "sequential"
  | "countersign"
  | "or_sign"
  | "auto"
  | "cc"
  | "ai_gate"
  | "start"
  | "end";

export interface FlowNodeData {
  key: string;
  type: NodeType;
  name: string;
  assignees: string[];
  autoAction?: string;
  aiSlotId?: string;
  timeoutHours?: number;
}

export interface TemplateNodeConfig {
  key: string;
  node_type: NodeType;
  name: string;
  assignee_userids?: string[];
  auto_action?: string;
  ai_slot_id?: string;
  timeout_hours?: number;
  next_keys: string[];
}

export interface TemplateConfig {
  version: number;
  start_key: string;
  nodes: TemplateNodeConfig[];
}
