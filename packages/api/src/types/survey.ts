export interface BreakthroughReport {
  id: number;
  report_no: string;
  project_id: number;
  section_id: number | null;
  report_date: string;
  breakthrough_m: number | null;
  summary: string | null;
  detail: string | null;
  reporter_userid: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface SiteSurvey {
  id: number;
  project_id: number;
  survey_date: string;
  location: string | null;
  weather: string | null;
  summary: string | null;
  surveyor_userid: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface SiteSurveyItem {
  id: number;
  survey_id: number;
  item_name: string;
  item_value: string | null;
  remark: string | null;
  created_at: string;
}
