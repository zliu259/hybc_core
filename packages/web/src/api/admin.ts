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
