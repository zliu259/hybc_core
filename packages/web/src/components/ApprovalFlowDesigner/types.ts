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
  nextKey?: string | null;
  defaultNextKey?: string;
  conditions?: Array<{
    field: string;
    operator: string;
    value: unknown;
    next_key: string;
  }>;
}

export interface TemplateNodeConfig {
  key: string;
  type: NodeType;
  name: string;
  assignee_userids?: string[];
  assignee_rule?: { type: "role" | "field"; value: string };
  auto_action?: string;
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

export interface TemplateConfig {
  version: number;
  start_key: string;
  nodes: TemplateNodeConfig[];
}
