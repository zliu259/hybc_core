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
  created_at: string;
  updated_at: string;
};

export const listProjects = (params?: {
  page?: number;
  pageSize?: number;
  status?: string;
  keyword?: string;
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
  project_code: string;
  project_name: string;
  entity_id?: number | null;
  manager_userid?: string | null;
  status?: string;
  start_date?: string | null;
  end_date?: string | null;
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
  }
) => {
  return http.request<{ success: boolean; data: { id: number } }>(
    "post",
    `/api/v1/project/${projectId}/sections`,
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
