import { http } from "@/utils/http";

export type Project = {
  id: number;
  project_code: string;
  project_name: string;
  entity_id: number | null;
  manager_userid: string | null;
  status: string;
  start_date: string | null;
  end_date: string | null;
  location_text?: string | null;
  project_briefing?: string | null;
  project_start_at?: string | null;
  project_kind?: "internal" | "external";
  external_party_name?: string | null;
  created_at: string;
  updated_at: string;
};

export type ProjectSection = {
  id: number;
  project_id: number;
  section_code: string;
  section_name: string;
  section_length: number | null;
  status: string;
  pipe_material?: string | null;
  pipe_model?: string | null;
  soil_type?: string | null;
  assigned_machine_type?: string | null;
  ai_machine_match_note?: string | null;
  ai_machine_match_score?: number | null;
  created_at: string;
  updated_at: string;
};

export type ProjectFile = {
  id: number;
  project_id: number;
  section_id: number | null;
  section_code?: string | null;
  section_name?: string | null;
  file_name: string;
  file_key: string;
  file_size: number | null;
  file_url: string;
  category: string | null;
  remark: string | null;
  uploaded_by_userid: string;
  status: string;
  created_at: string;
  updated_at: string;
};

export type ProjectPublicLogLink = {
  id: number;
  project_id: number;
  allowed_log_types_json: string;
  expires_at: string | null;
  status: string;
  created_by_userid: string;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ExternalLogSubmission = {
  id: number;
  project_id: number;
  section_id: number | null;
  section_code?: string | null;
  section_name?: string | null;
  submitter_name: string;
  submitter_company: string | null;
  submitter_phone: string | null;
  log_date: string;
  shift: string;
  operator_log_payload_json: string;
  project_log_payload_json: string;
  photo_keys_json: string | null;
  review_status: string;
  ai_review_task_id: number | null;
  ai_review_result_json: string | null;
  ai_review_score: number | null;
  ai_review_risk_level: string | null;
  ai_review_summary: string | null;
  reviewed_by_userid: string | null;
  reviewed_at: string | null;
  review_comment: string | null;
  adopted_operator_log_id: number | null;
  adopted_manager_log_id: number | null;
  created_at: string;
  updated_at: string;
};

export const listProjects = (params?: {
  page?: number;
  pageSize?: number;
  status?: string;
  keyword?: string;
  location?: string;
  project_kind?: "internal" | "external";
}) => {
  return http.request<{
    success: boolean;
    data: Project[];
    pagination: { page: number; pageSize: number; total: number };
  }>("get", "/api/v1/project", { params });
};

export const getProjectById = (id: number) => {
  return http.request<{ success: boolean; data: Project }>(
    "get",
    `/api/v1/project/${id}`
  );
};

export const createProject = (data: {
  project_code?: string;
  project_name: string;
  entity_id?: number | null;
  manager_userid?: string | null;
  status?: string;
  start_date?: string | null;
  end_date?: string | null;
  location_text?: string | null;
  project_briefing?: string | null;
  project_start_at?: string | null;
  project_kind?: "internal" | "external";
  external_party_name?: string | null;
}) => {
  return http.request<{ success: boolean; data: { id: number } }>(
    "post",
    "/api/v1/project",
    { data }
  );
};

export const updateProjectStatus = (id: number, status: string) => {
  return http.request<{ success: boolean }>(
    "patch",
    `/api/v1/project/${id}/status`,
    {
      data: { status }
    }
  );
};

export const updateProject = (
  id: number,
  data: {
    project_name?: string;
    entity_id?: number | null;
    manager_userid?: string | null;
    start_date?: string | null;
    end_date?: string | null;
    location_text?: string | null;
    project_briefing?: string | null;
    project_start_at?: string | null;
    project_kind?: "internal" | "external";
    external_party_name?: string | null;
  }
) => {
  return http.request<{ success: boolean }>("put", `/api/v1/project/${id}`, {
    data
  });
};

export const listProjectSections = (projectId: number) => {
  return http.request<{ success: boolean; data: ProjectSection[] }>(
    "get",
    `/api/v1/project/${projectId}/sections`
  );
};

export const createProjectSection = (
  projectId: number,
  data: {
    section_code: string;
    section_name: string;
    section_length?: number | null;
    status?: string;
    pipe_material?: string | null;
    pipe_model?: string | null;
    soil_type?: string | null;
    assigned_machine_type?: string | null;
    ai_machine_match_note?: string | null;
    ai_machine_match_score?: number | null;
  }
) => {
  return http.request<{ success: boolean; data: { id: number } }>(
    "post",
    `/api/v1/project/${projectId}/sections`,
    { data }
  );
};

export const updateProjectSection = (
  projectId: number,
  sectionId: number,
  data: {
    section_name?: string;
    section_length?: number | null;
    status?: string;
    pipe_material?: string | null;
    pipe_model?: string | null;
    soil_type?: string | null;
    assigned_machine_type?: string | null;
    ai_machine_match_note?: string | null;
    ai_machine_match_score?: number | null;
  }
) => {
  return http.request<{ success: boolean }>(
    "put",
    `/api/v1/project/${projectId}/sections/${sectionId}`,
    { data }
  );
};

export const getProjectFinancialSummary = (projectId: number) => {
  return http.request<{
    success: boolean;
    data: {
      projectId: number;
      outboundPaidAmount: number;
      inboundReceivedAmount: number;
      inboundInvoicedAmount: number;
      reimbursementAmount: number;
      receiptCount: number;
    };
  }>("get", `/api/v1/project/${projectId}/financial-summary`);
};

export const listProjectFiles = (
  projectId: number,
  params?: {
    section_id?: number;
    category?: string;
  }
) => {
  return http.request<{ success: boolean; data: ProjectFile[] }>(
    "get",
    `/api/v1/project/${projectId}/files`,
    { params }
  );
};

export const createProjectFile = (
  projectId: number,
  data: {
    file_name: string;
    file_key: string;
    file_size?: number | null;
    category?: string | null;
    section_id?: number | null;
    remark?: string | null;
  }
) => {
  return http.request<{ success: boolean; data: { id: number } }>(
    "post",
    `/api/v1/project/${projectId}/files`,
    { data }
  );
};

export const deleteProjectFile = (projectId: number, fileId: number) => {
  return http.request<{ success: boolean }>(
    "delete",
    `/api/v1/project/${projectId}/files/${fileId}`
  );
};

export const listProjectPublicLogLinks = (projectId: number) =>
  http.request<{ success: boolean; data: ProjectPublicLogLink[] }>(
    "get",
    `/api/v1/project/${projectId}/public-log-link`
  );

export const createProjectPublicLogLink = (
  projectId: number,
  data: {
    allowed_log_types?: string[];
    expires_at?: string | null;
  }
) =>
  http.request<{
    success: boolean;
    data: {
      id: number;
      token: string;
      allowed_log_types: string[];
      expires_at: string | null;
      status: string;
    };
  }>("post", `/api/v1/project/${projectId}/public-log-link`, { data });

export const updateProjectPublicLogLink = (
  projectId: number,
  linkId: number,
  data: { status: "active" | "revoked" }
) =>
  http.request<{ success: boolean }>(
    "patch",
    `/api/v1/project/${projectId}/public-log-link/${linkId}`,
    { data }
  );

export const listExternalLogSubmissions = (
  projectId: number,
  params?: {
    status?: string;
    page?: number;
    pageSize?: number;
  }
) =>
  http.request<{
    success: boolean;
    data: ExternalLogSubmission[];
    pagination: { page: number; pageSize: number; total: number };
  }>("get", `/api/v1/project/${projectId}/external-log-submissions`, {
    params
  });

export const reviewExternalLogSubmission = (
  projectId: number,
  submissionId: number,
  data: {
    action: "approve" | "reject";
    comment?: string;
  }
) =>
  http.request<{ success: boolean; data?: Record<string, unknown> }>(
    "post",
    `/api/v1/project/${projectId}/external-log-submissions/${submissionId}/review`,
    { data }
  );
