export interface OperatorLog {
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
  source_type?: string;
  external_submission_id?: number | null;
  external_submitter_name?: string | null;
  external_submitter_company?: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface ManagerLog {
  id: number;
  project_id: number;
  log_date: string;
  title: string | null;
  detail_html: string | null;
  risk_note: string | null;
  manager_userid: string;
  source_type?: string;
  external_submission_id?: number | null;
  external_submitter_name?: string | null;
  external_submitter_company?: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface ManagerLogPhoto {
  id: number;
  manager_log_id: number;
  file_key: string;
  caption: string | null;
  sort_order: number;
  status: string;
  created_at: string;
}
