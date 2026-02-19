import { http } from "@/utils/http";

export type BreakthroughReport = {
  id: number;
  report_no: string;
  project_id: number;
  section_id: number | null;
  report_date: string;
  breakthrough_m: number | null;
  summary: string | null;
  detail: string | null;
  status: string;
};

export type SiteSurvey = {
  id: number;
  project_id: number;
  survey_date: string;
  location: string | null;
  weather: string | null;
  summary: string | null;
  status: string;
};

export const listBreakthroughReports = (params?: {
  project_id?: number;
  date_from?: string;
  date_to?: string;
}) =>
  http.request<{ success: boolean; data: BreakthroughReport[] }>(
    "get",
    "/api/v1/survey/breakthrough",
    {
      params
    }
  );

export const createBreakthroughReport = (data: Record<string, unknown>) =>
  http.request<{ success: boolean; data: { id: number; report_no: string } }>(
    "post",
    "/api/v1/survey/breakthrough",
    {
      data
    }
  );

export const updateBreakthroughReport = (
  id: number,
  data: Record<string, unknown>
) =>
  http.request<{ success: boolean }>(
    "put",
    `/api/v1/survey/breakthrough/${id}`,
    { data }
  );

export const deleteBreakthroughReport = (id: number) =>
  http.request<{ success: boolean }>(
    "delete",
    `/api/v1/survey/breakthrough/${id}`
  );

export const listSiteSurveys = (params?: {
  project_id?: number;
  date_from?: string;
  date_to?: string;
}) =>
  http.request<{ success: boolean; data: SiteSurvey[] }>(
    "get",
    "/api/v1/survey/site-survey",
    {
      params
    }
  );

export const getSiteSurvey = (id: number) =>
  http.request<{
    success: boolean;
    data: SiteSurvey & { items: Array<Record<string, unknown>> };
  }>("get", `/api/v1/survey/site-survey/${id}`);

export const createSiteSurvey = (data: Record<string, unknown>) =>
  http.request<{ success: boolean; data: { id: number } }>(
    "post",
    "/api/v1/survey/site-survey",
    { data }
  );

export const updateSiteSurvey = (id: number, data: Record<string, unknown>) =>
  http.request<{ success: boolean }>(
    "put",
    `/api/v1/survey/site-survey/${id}`,
    { data }
  );

export const deleteSiteSurvey = (id: number) =>
  http.request<{ success: boolean }>(
    "delete",
    `/api/v1/survey/site-survey/${id}`
  );
