import { http } from "@/utils/http";

export type WeComToolDefinition = {
  name: string;
  title: string;
  description: string;
  access: "read" | "write";
  scope: "project" | "section";
  input_schema: Record<string, unknown>;
};

export type ProjectWeComBinding = {
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
};

export type WeComToolCallAudit = {
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
};

export type ProjectWeComPushEvent = {
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
};

export type ProjectWeComBindingPayload = {
  binding_name: string;
  group_chat_id?: string | null;
  bot_id?: string | null;
  allowed_tools?: string[];
  push_webhook_secret_ref?: string | null;
  push_enabled?: boolean;
  qa_enabled?: boolean;
};

export type WeComFrontendConfig = {
  api_base_url: string;
  manifest_url: string;
  call_url: string;
  tool_token_configured: boolean;
  tool_token_source: "kv" | "env" | "none";
};

export type WeComGroupChatType =
  | "internal"
  | "external_customer_group"
  | "discovered"
  | "manual";

export type WeComGroupChat = {
  id: number;
  chat_id: string;
  chat_name: string;
  chat_type: WeComGroupChatType;
  owner_userid: string | null;
  source: string;
  webhook_secret_ref: string | null;
  status: string;
  raw_json: string | null;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
};

export type WeComGroupChatPayload = {
  chat_id: string;
  chat_name: string;
  chat_type?: WeComGroupChatType;
  owner_userid?: string | null;
  webhook_secret_ref?: string | null;
};

export const getWeComToolManifest = () => {
  return http.request<{
    success: boolean;
    data: { tools: WeComToolDefinition[] };
  }>("get", "/api/v1/wecom/tools/manifest");
};

export const getWeComFrontendConfig = () => {
  return http.request<{ success: boolean; data: WeComFrontendConfig }>(
    "get",
    "/api/v1/wecom/config"
  );
};

export const saveWeComToolToken = (data: { token: string }) => {
  return http.request<{
    success: boolean;
    data: { configured: boolean; source: "kv" };
  }>("put", "/api/v1/wecom/config/tool-token", { data });
};

export const saveWeComGroupWebhook = (data: {
  secret_ref: string;
  webhook_url: string;
}) => {
  return http.request<{
    success: boolean;
    data: { secret_ref: string; configured: boolean };
  }>("put", "/api/v1/wecom/webhooks", { data });
};

export const listWeComGroupChats = (keyword = "") => {
  return http.request<{ success: boolean; data: WeComGroupChat[] }>(
    "get",
    "/api/v1/wecom/chats",
    { params: { keyword } }
  );
};

export const saveWeComGroupChatManual = (data: WeComGroupChatPayload) => {
  return http.request<{ success: boolean; data: WeComGroupChat }>(
    "post",
    "/api/v1/wecom/chats/manual",
    { data }
  );
};

export const syncWeComExternalGroupChats = () => {
  return http.request<{
    success: boolean;
    data: { synced: number; skipped: number };
  }>("post", "/api/v1/wecom/chats/sync-external");
};

export const listProjectWeComBindings = (projectId: number) => {
  return http.request<{ success: boolean; data: ProjectWeComBinding[] }>(
    "get",
    `/api/v1/wecom/projects/${projectId}/bindings`
  );
};

export const createProjectWeComBinding = (
  projectId: number,
  data: ProjectWeComBindingPayload
) => {
  return http.request<{ success: boolean; data: ProjectWeComBinding }>(
    "post",
    `/api/v1/wecom/projects/${projectId}/bindings`,
    { data }
  );
};

export const updateProjectWeComBinding = (
  projectId: number,
  bindingId: number,
  data: ProjectWeComBindingPayload
) => {
  return http.request<{ success: boolean; data: ProjectWeComBinding }>(
    "put",
    `/api/v1/wecom/projects/${projectId}/bindings/${bindingId}`,
    { data }
  );
};

export const testProjectWeComBinding = (
  projectId: number,
  bindingId: number
) => {
  return http.request<{ success: boolean }>(
    "post",
    `/api/v1/wecom/projects/${projectId}/bindings/${bindingId}/test`
  );
};

export const disableProjectWeComBinding = (
  projectId: number,
  bindingId: number
) => {
  return http.request<{ success: boolean }>(
    "delete",
    `/api/v1/wecom/projects/${projectId}/bindings/${bindingId}`
  );
};

export const listProjectWeComToolAudits = (projectId: number, limit = 20) => {
  return http.request<{ success: boolean; data: WeComToolCallAudit[] }>(
    "get",
    `/api/v1/wecom/projects/${projectId}/tool-audits`,
    { params: { limit } }
  );
};

export const listProjectWeComPushEvents = (projectId: number, limit = 20) => {
  return http.request<{ success: boolean; data: ProjectWeComPushEvent[] }>(
    "get",
    `/api/v1/wecom/projects/${projectId}/push-events`,
    { params: { limit } }
  );
};
