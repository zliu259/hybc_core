import { http } from "@/utils/http";

type Pagination = { page: number; pageSize: number; total: number };

export type OperatorLog = {
  id: number;
  project_id: number;
  section_id: number | null;
  log_date: string;
  shift: string;
  weather: string | null;
  completed_pipe_count: number;
  cumulative_pipe_count: number;
  footage_m: number | null;
  issue_summary: string | null;
  remark: string | null;
  operator_userid: string;
  status: string;
};

export type ManagerLog = {
  id: number;
  project_id: number;
  log_date: string;
  title: string | null;
  detail_html: string | null;
  risk_note: string | null;
  manager_userid: string;
  status: string;
};

export const listOperatorLogs = (params?: {
  project_id?: number;
  section_id?: number;
  date_from?: string;
  date_to?: string;
  shift?: string;
  page?: number;
  pageSize?: number;
}) =>
  http.request<{
    success: boolean;
    data: OperatorLog[];
    pagination: Pagination;
  }>("get", "/api/v1/log/operator", {
    params
  });

export const getOperatorLog = (id: number) =>
  http.request<{ success: boolean; data: OperatorLog }>(
    "get",
    `/api/v1/log/operator/${id}`
  );

export const createOperatorLog = (data: Record<string, unknown>) =>
  http.request<{ success: boolean; data: { id: number } }>(
    "post",
    "/api/v1/log/operator",
    { data }
  );

export const updateOperatorLog = (id: number, data: Record<string, unknown>) =>
  http.request<{ success: boolean }>("put", `/api/v1/log/operator/${id}`, {
    data
  });

export const deleteOperatorLog = (id: number) =>
  http.request<{ success: boolean }>("delete", `/api/v1/log/operator/${id}`);

export const smartFillOperatorLog = (data: {
  project_id: number;
  log_date: string;
  shift: string;
  completed_pipe_count?: number;
}) =>
  http.request<{
    success: boolean;
    data: {
      prefill: {
        weather: string;
        issue_summary: string;
        cumulative_pipe_count: number;
      };
      task_id: number;
    };
  }>("post", "/api/v1/log/operator/smart-fill", { data });

export const listManagerLogs = (params?: {
  project_id?: number;
  date_from?: string;
  date_to?: string;
  page?: number;
  pageSize?: number;
}) =>
  http.request<{
    success: boolean;
    data: ManagerLog[];
    pagination: Pagination;
  }>("get", "/api/v1/log/manager", {
    params
  });

export const getManagerLog = (id: number) =>
  http.request<{
    success: boolean;
    data: ManagerLog & { photos: Array<Record<string, unknown>> };
  }>("get", `/api/v1/log/manager/${id}`);

export const createManagerLog = (data: Record<string, unknown>) =>
  http.request<{ success: boolean; data: { id: number } }>(
    "post",
    "/api/v1/log/manager",
    { data }
  );

export const updateManagerLog = (id: number, data: Record<string, unknown>) =>
  http.request<{ success: boolean }>("put", `/api/v1/log/manager/${id}`, {
    data
  });

export const deleteManagerLog = (id: number) =>
  http.request<{ success: boolean }>("delete", `/api/v1/log/manager/${id}`);

export const triggerLogSummary = (data: {
  report_type: "daily" | "weekly";
  project_id?: number;
  date_from?: string;
  date_to?: string;
}) =>
  http.request<{ success: boolean; data: { task_id: number } }>(
    "post",
    "/api/v1/log/summary/trigger",
    { data }
  );

export const getLogDashboard = (params?: { project_id?: number }) =>
  http.request<{ success: boolean; data: Record<string, unknown> }>(
    "get",
    "/api/v1/log/dashboard",
    {
      params
    }
  );

export const getProgressAlerts = (params?: { date?: string }) =>
  http.request<{ success: boolean; data: Array<Record<string, unknown>> }>(
    "get",
    "/api/v1/log/progress-alert",
    {
      params
    }
  );
