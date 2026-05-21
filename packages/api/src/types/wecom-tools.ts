export const weComReadOnlyToolNames = [
  "get_project_overview",
  "list_project_sections",
  "get_section_progress",
  "get_latest_manager_logs",
  "get_latest_operator_logs",
  "get_project_risk_summary",
  "get_equipment_summary",
  "get_public_log_link"
] as const;

export const weComWriteToolNames = [
  "create_manager_log_draft",
  "create_project_issue",
  "update_section_mileage",
  "request_equipment_support"
] as const;

export const weComToolNames = [...weComReadOnlyToolNames, ...weComWriteToolNames] as const;

export type WeComReadOnlyToolName = (typeof weComReadOnlyToolNames)[number];
export type WeComWriteToolName = (typeof weComWriteToolNames)[number];
export type WeComToolName = (typeof weComToolNames)[number];

export type WeComToolAccess = "read" | "write";
export type WeComToolScope = "project" | "section";
export type WeComGroupWebhookProxyMode = "direct" | "bridge";

export type JsonSchema = {
  type: "object";
  properties: Record<string, Record<string, unknown>>;
  required: string[];
  additionalProperties: boolean;
};

export interface WeComToolDefinition {
  name: WeComToolName;
  title: string;
  description: string;
  access: WeComToolAccess;
  scope: WeComToolScope;
  input_schema: JsonSchema;
}

const projectIdSchema = {
  type: "integer",
  minimum: 1,
  description: "项目 ID"
} as const;

const sectionIdSchema = {
  type: "integer",
  minimum: 1,
  description: "标段 ID"
} as const;

const limitSchema = {
  type: "integer",
  minimum: 1,
  maximum: 20,
  description: "返回条数，默认 5，最大 20"
} as const;

const dateSchema = {
  type: "string",
  description: "日期，格式 YYYY-MM-DD"
} as const;

const objectSchema = (
  properties: JsonSchema["properties"],
  required: string[] = ["project_id"]
): JsonSchema => ({
  type: "object",
  properties,
  required,
  additionalProperties: false
});

export const weComToolDefinitions: Record<WeComToolName, WeComToolDefinition> = {
  get_project_overview: {
    name: "get_project_overview",
    title: "项目概况",
    description: "查询项目基础信息、状态、负责人和标段数量。",
    access: "read",
    scope: "project",
    input_schema: objectSchema({ project_id: projectIdSchema })
  },
  list_project_sections: {
    name: "list_project_sections",
    title: "项目标段列表",
    description: "查询项目下所有标段或工作段的基础信息。",
    access: "read",
    scope: "project",
    input_schema: objectSchema({ project_id: projectIdSchema })
  },
  get_section_progress: {
    name: "get_section_progress",
    title: "标段进度",
    description: "查询单个标段里程、累计进尺和最近施工状态。",
    access: "read",
    scope: "section",
    input_schema: objectSchema(
      {
        project_id: projectIdSchema,
        section_id: sectionIdSchema
      },
      ["project_id", "section_id"]
    )
  },
  get_latest_manager_logs: {
    name: "get_latest_manager_logs",
    title: "最近管理员日志",
    description: "查询项目最近管理员日志摘要。",
    access: "read",
    scope: "project",
    input_schema: objectSchema({
      project_id: projectIdSchema,
      limit: limitSchema,
      date_from: dateSchema,
      date_to: dateSchema
    })
  },
  get_latest_operator_logs: {
    name: "get_latest_operator_logs",
    title: "最近操作员日志",
    description: "查询项目或标段最近操作员施工日志摘要。",
    access: "read",
    scope: "section",
    input_schema: objectSchema({
      project_id: projectIdSchema,
      section_id: sectionIdSchema,
      limit: limitSchema
    })
  },
  get_project_risk_summary: {
    name: "get_project_risk_summary",
    title: "项目风险摘要",
    description: "汇总最近日志中的风险、停工和异常描述。",
    access: "read",
    scope: "project",
    input_schema: objectSchema({
      project_id: projectIdSchema,
      days: {
        type: "integer",
        minimum: 1,
        maximum: 30,
        description: "回看天数，默认 7，最大 30"
      }
    })
  },
  get_equipment_summary: {
    name: "get_equipment_summary",
    title: "项目设备摘要",
    description: "查询项目拟派和在场设备摘要。",
    access: "read",
    scope: "project",
    input_schema: objectSchema({ project_id: projectIdSchema })
  },
  get_public_log_link: {
    name: "get_public_log_link",
    title: "日志公示链接",
    description: "查询项目日志公示链接状态和访问地址。",
    access: "read",
    scope: "project",
    input_schema: objectSchema({ project_id: projectIdSchema })
  },
  create_manager_log_draft: {
    name: "create_manager_log_draft",
    title: "创建管理员日志草稿",
    description: "二期写入工具：创建管理员日志草稿，不自动发布。",
    access: "write",
    scope: "project",
    input_schema: objectSchema({ project_id: projectIdSchema })
  },
  create_project_issue: {
    name: "create_project_issue",
    title: "创建项目问题",
    description: "二期写入工具：创建项目问题或风险记录。",
    access: "write",
    scope: "project",
    input_schema: objectSchema({ project_id: projectIdSchema })
  },
  update_section_mileage: {
    name: "update_section_mileage",
    title: "更新标段里程",
    description: "二期高风险写入工具：更新标段里程或进度。",
    access: "write",
    scope: "section",
    input_schema: objectSchema(
      {
        project_id: projectIdSchema,
        section_id: sectionIdSchema
      },
      ["project_id", "section_id"]
    )
  },
  request_equipment_support: {
    name: "request_equipment_support",
    title: "发起设备支援请求",
    description: "二期写入工具：发起设备支援请求并进入审批或任务流。",
    access: "write",
    scope: "project",
    input_schema: objectSchema({ project_id: projectIdSchema })
  }
};

export const defaultAllowedWeComToolNames: WeComReadOnlyToolName[] = [...weComReadOnlyToolNames];

const toolNameSet = new Set<string>(weComToolNames);
const readOnlyToolNameSet = new Set<string>(weComReadOnlyToolNames);

export const isWeComToolName = (value: unknown): value is WeComToolName => {
  return typeof value === "string" && toolNameSet.has(value);
};

export const isWeComReadOnlyToolName = (value: unknown): value is WeComReadOnlyToolName => {
  return typeof value === "string" && readOnlyToolNameSet.has(value);
};

export const isWeComGroupWebhookProxyMode = (
  value: unknown
): value is WeComGroupWebhookProxyMode => {
  return value === "direct" || value === "bridge";
};

export interface ProjectWeComBotBinding {
  id: number;
  project_id: number;
  binding_name: string;
  group_chat_id: string | null;
  bot_id: string | null;
  allowed_tools_json: string;
  data_scope: string;
  push_webhook_secret_ref: string | null;
  push_enabled: 0 | 1;
  qa_enabled: 0 | 1;
  status: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface WeComToolCallContext {
  bot_id?: string;
  group_chat_id?: string;
  caller_userid?: string;
}

export interface WeComToolCallRequest {
  tool: WeComToolName;
  input: Record<string, unknown>;
  context?: WeComToolCallContext;
}

export interface WeComToolCallAudit {
  id: number;
  binding_id: number | null;
  project_id: number | null;
  tool_name: string;
  caller_userid: string | null;
  group_chat_id: string | null;
  request_json: string;
  response_summary: string | null;
  status: string;
  error_message: string | null;
  latency_ms: number;
  created_at: string;
}

export interface ProjectWeComPushEvent {
  id: number;
  binding_id: number | null;
  project_id: number;
  source_event_type: string;
  source_biz_type: string;
  source_biz_id: number;
  message_type: string;
  message_summary: string | null;
  status: string;
  error_message: string | null;
  webhook_secret_ref: string | null;
  retry_count: number;
  pushed_at: string | null;
  created_at: string;
  updated_at: string;
}
