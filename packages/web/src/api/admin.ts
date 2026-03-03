import { http } from "@/utils/http";

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

export type ApprovalThreshold = {
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
};

export type AiProviderConfig = {
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
};

export type AiRoutingRule = {
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
};

export type AiSlotOption = {
  slot_id: string;
  label: string;
  rule_name: string;
  task_type: string;
  source: string;
};

export type AiPromptTemplate = {
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
};

export type RunnerRuntimeConfigItem = {
  id: number;
  config_key: string;
  config_value: string;
  is_secret: 0 | 1;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export const listApprovalTemplates = (params?: { biz_type?: string }) => {
  return http.request<{ success: boolean; data: ApprovalTemplate[] }>(
    "get",
    "/api/v1/admin/approval-config",
    { params }
  );
};

export const createApprovalTemplate = (data: {
  template_code: string;
  template_name: string;
  biz_type: string;
  config_json: string;
}) => {
  return http.request<{ success: boolean; data: { id: number } }>(
    "post",
    "/api/v1/admin/approval-config",
    { data }
  );
};

export const bootstrapInitialApprovalConfig = () => {
  return http.request<{
    success: boolean;
    data: { templates_active: number; thresholds_active: number };
  }>("post", "/api/v1/admin/approval-config/bootstrap-initial");
};

export const bootstrapNearProductionOpenAIConfig = (data?: {
  openai_model?: string;
  openai_endpoint?: string;
}) => {
  return http.request<{
    success: boolean;
    data: {
      openai_model: string;
      openai_endpoint: string;
      templates_active: number;
      thresholds_active: number;
      ai_providers_active: number;
      ai_routing_rules_active: number;
      ai_prompts_active: number;
    };
  }>("post", "/api/v1/admin/bootstrap/near-production-openai", { data });
};

export const updateApprovalTemplate = (
  id: number,
  data: {
    template_name?: string;
    biz_type?: string;
    config_json?: string;
    status?: string;
  }
) => {
  return http.request<{ success: boolean }>(
    "put",
    `/api/v1/admin/approval-config/${id}`,
    { data }
  );
};

export const deleteApprovalTemplate = (id: number) => {
  return http.request<{ success: boolean }>(
    "delete",
    `/api/v1/admin/approval-config/${id}`
  );
};

export const listThresholds = (params?: { template_id?: number }) => {
  return http.request<{ success: boolean; data: ApprovalThreshold[] }>(
    "get",
    "/api/v1/admin/threshold",
    { params }
  );
};

export const listBizThresholds = (params?: { biz_type?: string }) => {
  return http.request<{ success: boolean; data: ApprovalThreshold[] }>(
    "get",
    "/api/v1/admin/thresholds",
    { params }
  );
};

export const createThreshold = (data: {
  template_id: number;
  condition_field: string;
  operator: string;
  threshold_value: number;
  threshold_value_upper?: number;
  target_branch: string;
  priority: number;
}) => {
  return http.request<{ success: boolean; data: { id: number } }>(
    "post",
    "/api/v1/admin/threshold",
    { data }
  );
};

export const updateThreshold = (
  id: number,
  data: {
    condition_field?: string;
    operator?: string;
    threshold_value?: number;
    threshold_value_upper?: number | null;
    target_branch?: string;
    priority?: number;
    status?: string;
  }
) => {
  return http.request<{ success: boolean }>(
    "put",
    `/api/v1/admin/threshold/${id}`,
    { data }
  );
};

export const deleteThreshold = (id: number) => {
  return http.request<{ success: boolean }>(
    "delete",
    `/api/v1/admin/threshold/${id}`
  );
};

export const listAiProviders = () => {
  return http.request<{ success: boolean; data: AiProviderConfig[] }>(
    "get",
    "/api/v1/admin/ai-provider"
  );
};

export const createAiProvider = (data: {
  provider_key: string;
  provider_name: string;
  api_endpoint?: string;
  model_id?: string;
  config_json?: string;
  priority?: number;
  max_concurrent?: number;
}) => {
  return http.request<{ success: boolean; data: { id: number } }>(
    "post",
    "/api/v1/admin/ai-provider",
    { data }
  );
};

export const updateAiProvider = (
  id: number,
  data: {
    provider_name?: string;
    api_endpoint?: string;
    model_id?: string;
    config_json?: string;
    priority?: number;
    max_concurrent?: number;
    status?: string;
  }
) => {
  return http.request<{ success: boolean }>(
    "put",
    `/api/v1/admin/ai-provider/${id}`,
    { data }
  );
};

export const deleteAiProvider = (id: number) => {
  return http.request<{ success: boolean }>(
    "delete",
    `/api/v1/admin/ai-provider/${id}`
  );
};

export const listAiRoutingRules = (params?: {
  biz_type?: string;
  task_type?: string;
}) => {
  return http.request<{ success: boolean; data: AiRoutingRule[] }>(
    "get",
    "/api/v1/admin/ai-routing",
    { params }
  );
};

export const listAiSlotOptions = () => {
  return http.request<{ success: boolean; data: AiSlotOption[] }>(
    "get",
    "/api/v1/admin/ai-slot-options"
  );
};

export const createAiRoutingRule = (data: {
  rule_name: string;
  biz_type: string;
  task_type: string;
  condition_json?: string;
  provider_id: number;
  prompt_template_id?: number;
  priority?: number;
}) => {
  return http.request<{ success: boolean; data: { id: number } }>(
    "post",
    "/api/v1/admin/ai-routing",
    { data }
  );
};

export const updateAiRoutingRule = (
  id: number,
  data: {
    rule_name?: string;
    biz_type?: string;
    task_type?: string;
    condition_json?: string;
    provider_id?: number;
    prompt_template_id?: number | null;
    priority?: number;
    status?: string;
  }
) => {
  return http.request<{ success: boolean }>(
    "put",
    `/api/v1/admin/ai-routing/${id}`,
    { data }
  );
};

export const deleteAiRoutingRule = (id: number) => {
  return http.request<{ success: boolean }>(
    "delete",
    `/api/v1/admin/ai-routing/${id}`
  );
};

export const listAiPromptTemplates = () => {
  return http.request<{ success: boolean; data: AiPromptTemplate[] }>(
    "get",
    "/api/v1/admin/ai-prompt"
  );
};

export const createAiPromptTemplate = (data: {
  template_key: string;
  template_name: string;
  system_prompt: string;
  user_prompt_template: string;
  variables_schema?: string;
}) => {
  return http.request<{ success: boolean; data: { id: number } }>(
    "post",
    "/api/v1/admin/ai-prompt",
    { data }
  );
};

export const updateAiPromptTemplate = (
  id: number,
  data: {
    template_name?: string;
    system_prompt?: string;
    user_prompt_template?: string;
    variables_schema?: string;
    status?: string;
  }
) => {
  return http.request<{ success: boolean }>(
    "put",
    `/api/v1/admin/ai-prompt/${id}`,
    { data }
  );
};

export const deleteAiPromptTemplate = (id: number) => {
  return http.request<{ success: boolean }>(
    "delete",
    `/api/v1/admin/ai-prompt/${id}`
  );
};

export const listRunnerRuntimeConfig = () => {
  return http.request<{ success: boolean; data: RunnerRuntimeConfigItem[] }>(
    "get",
    "/api/v1/admin/runner-runtime-config"
  );
};

export const upsertRunnerRuntimeConfig = (
  items: Array<{
    config_key: string;
    config_value: string;
    is_secret?: boolean;
  }>
) => {
  return http.request<{ success: boolean; data: RunnerRuntimeConfigItem[] }>(
    "post",
    "/api/v1/admin/runner-runtime-config",
    { data: { items } }
  );
};

export type AiRuntimeTestTaskResult = {
  task_id: number;
  task_code: string;
  task_type: string;
  biz_type: string;
  biz_id: number;
  status: string;
  created_at: string;
};

export const createAiRuntimeTestTask = (data?: {
  task_type?: string;
  biz_type?: string;
  biz_id?: number;
  payload?: Record<string, unknown>;
  priority?: number;
}) => {
  return http.request<{ success: boolean; data: AiRuntimeTestTaskResult }>(
    "post",
    "/api/v1/admin/ai-runtime/test-task",
    { data }
  );
};
