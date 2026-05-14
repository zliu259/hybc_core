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
  pipe_material: string | null;
  pipe_model: string | null;
  soil_type: string | null;
  assigned_machine_type: string | null;
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

export const submitPublicProjectLog = (
  token: string,
  data: {
    submitter_name: string;
    submitter_company?: string;
    submitter_phone?: string;
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
