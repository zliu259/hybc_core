import { http } from "@/utils/http";

export type PublicProjectLogProject = {
  id: number;
  project_code: string;
  project_name: string;
  status: string;
  location_text: string | null;
};

export type PublicProjectLogSection = {
  id: number;
  project_id: number;
  section_code: string;
  section_name: string;
  section_length: number | null;
  status: string;
  design_slope: number | null;
  pipe_diameter_mm: number | null;
  pipe_material: string | null;
  pipe_model: string | null;
  soil_type: string | null;
  jacking_method: string | null;
  assigned_machine_type: string | null;
};

export type PublicOperatorLogItem = {
  id: number;
  section_id: number | null;
  log_date: string;
  shift: string;
  weather: string | null;
  completed_pipe_count: number;
  cumulative_pipe_count: number;
  footage_m: number | null;
  cumulative_footage_m: number | null;
  main_thrust_mpa: number | null;
  main_thrust_text: string | null;
  chamber_pressure_mpa: number | null;
  cutter_current_a: number | null;
  cutter_current_text: string | null;
  cutter_frequency_hz: number | null;
  soil_type: string | null;
  deviation_direction: string | null;
  deviation_value_mm: number | null;
  horizontal_deviation_direction: string | null;
  horizontal_deviation_mm: number | null;
  vertical_deviation_direction: string | null;
  vertical_deviation_mm: number | null;
  issue_summary: string | null;
  remark: string | null;
  status: string;
  source_type: string;
  external_submitter_name: string | null;
  external_submitter_company: string | null;
  section_code: string | null;
  section_name: string | null;
};

export type PublicProjectLogItem = {
  id: number;
  log_date: string;
  title: string | null;
  detail_html: string | null;
  risk_note: string | null;
  status: string;
  source_type: string;
  external_submitter_name: string | null;
  external_submitter_company: string | null;
};

export type PublicPagination = {
  page: number;
  pageSize: number;
  total: number;
};

export const getPublicProjectLogContext = (token: string) =>
  http.request<{
    success: boolean;
    data: {
      project: PublicProjectLogProject;
      sections: PublicProjectLogSection[];
      allowed_log_types: string[];
      expires_at: string | null;
    };
  }>("get", `/api/v1/public/project-log/${token}`);

export const createPublicProjectLogUploadSignature = (
  token: string,
  data: {
    fileName: string;
    contentType?: string;
  }
) =>
  http.request<{
    success: boolean;
    data: {
      key: string;
      expiresAt: number;
      contentType: string;
      uploadUrl: string;
      fileUrl: string;
    };
  }>("post", `/api/v1/public/project-log/${token}/upload-sign`, { data });

export const getPublicProjectLogItems = (
  token: string,
  params?: {
    page?: number;
    pageSize?: number;
  }
) =>
  http.request<{
    success: boolean;
    data: PublicProjectLogItem[];
    pagination: PublicPagination;
  }>("get", `/api/v1/public/project-log/${token}/logs/project`, {
    params
  });

export const getPublicOperatorLogItems = (
  token: string,
  params?: {
    section_id?: number;
    page?: number;
    pageSize?: number;
  }
) =>
  http.request<{
    success: boolean;
    data: PublicOperatorLogItem[];
    pagination: PublicPagination;
  }>("get", `/api/v1/public/project-log/${token}/logs/operator`, {
    params
  });

export const getPublicLatestOperatorLog = (
  token: string,
  params: {
    section_id?: number;
  }
) =>
  http.request<{
    success: boolean;
    data: PublicOperatorLogItem | null;
  }>("get", `/api/v1/public/project-log/${token}/logs/operator/latest`, {
    params
  });

export const submitPublicProjectLog = (
  token: string,
  data: {
    submitter_name: string;
    submitter_company?: string;
    submitter_phone?: string;
    log_types?: string[];
    section_id?: number | null;
    log_date: string;
    shift: string;
    operator_log: Record<string, unknown>;
    project_log: Record<string, unknown>;
    photo_keys?: string[];
  }
) =>
  http.request<{
    success: boolean;
    data: {
      id: number;
      review_status: string;
      ai_review_task_id: number;
    };
  }>("post", `/api/v1/public/project-log/${token}/submissions`, { data });
