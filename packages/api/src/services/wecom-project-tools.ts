import type { Env } from "../types/env";
import { isWeComReadOnlyToolName, type WeComReadOnlyToolName } from "../types/wecom-tools";

type ToolResult = {
  data: Record<string, unknown>;
  meta: {
    tool: WeComReadOnlyToolName;
    generated_at: string;
  };
};

type ProjectRow = {
  id: number;
  project_code: string;
  project_name: string;
  manager_userid: string | null;
  status: string;
  location_text?: string | null;
  project_kind?: string | null;
  start_date: string | null;
  end_date: string | null;
  updated_at: string;
};

type SectionRow = {
  id: number;
  project_id: number;
  section_code: string;
  section_name: string;
  section_length: number | null;
  pipe_material?: string | null;
  pipe_model?: string | null;
  soil_type?: string | null;
  status: string;
  updated_at: string;
};

type ManagerLogRow = {
  id: number;
  project_id: number;
  log_date: string;
  title: string | null;
  detail_html: string | null;
  risk_note: string | null;
  status: string;
  updated_at: string;
};

type OperatorLogRow = {
  id: number;
  project_id: number;
  section_id: number | null;
  log_date: string;
  shift: string;
  completed_pipe_count: number;
  cumulative_pipe_count: number;
  footage_m: number | null;
  issue_summary: string | null;
  remark: string | null;
  status: string;
  updated_at: string;
};

const nowIso = () => new Date().toISOString();

const asPositiveInt = (
  value: unknown,
  fieldName: string,
  options: { required?: boolean; defaultValue?: number; max?: number } = {}
): number => {
  if (value === undefined || value === null || value === "") {
    if (options.required) throw new Error(`${fieldName} is required`);
    return options.defaultValue ?? 0;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${fieldName} must be a positive integer`);
  }
  return options.max ? Math.min(parsed, options.max) : parsed;
};

const projectIdFromInput = (input: Record<string, unknown>): number => {
  return asPositiveInt(input.project_id, "project_id", { required: true });
};

const limitFromInput = (input: Record<string, unknown>): number => {
  return asPositiveInt(input.limit, "limit", { defaultValue: 5, max: 20 });
};

const stripHtml = (html: string | null): string => {
  if (!html) return "";
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
};

const loadProject = async (env: Env, projectId: number): Promise<ProjectRow> => {
  const project = await env.DB.prepare("SELECT * FROM project WHERE id = ?")
    .bind(projectId)
    .first<ProjectRow>();
  if (!project) throw new Error("Project not found");
  return project;
};

const mapSection = (row: SectionRow): Record<string, unknown> => ({
  section_id: row.id,
  section_code: row.section_code,
  section_name: row.section_name,
  section_length: row.section_length,
  pipe_material: row.pipe_material ?? null,
  pipe_model: row.pipe_model ?? null,
  soil_type: row.soil_type ?? null,
  status: row.status,
  updated_at: row.updated_at
});

const getProjectOverview = async (
  env: Env,
  input: Record<string, unknown>
): Promise<Record<string, unknown>> => {
  const projectId = projectIdFromInput(input);
  const project = await loadProject(env, projectId);
  const count = await env.DB.prepare(
    "SELECT COUNT(*) AS section_count FROM project_section WHERE project_id = ?"
  )
    .bind(projectId)
    .first<{ section_count: number }>();

  return {
    project_id: project.id,
    project_code: project.project_code,
    project_name: project.project_name,
    status: project.status,
    manager_userid: project.manager_userid,
    location_text: project.location_text ?? null,
    project_kind: project.project_kind ?? null,
    start_date: project.start_date,
    end_date: project.end_date,
    section_count: count?.section_count ?? 0,
    updated_at: project.updated_at
  };
};

const listProjectSections = async (
  env: Env,
  input: Record<string, unknown>
): Promise<Record<string, unknown>> => {
  const projectId = projectIdFromInput(input);
  const rows = await env.DB.prepare(
    "SELECT * FROM project_section WHERE project_id = ? ORDER BY id ASC"
  )
    .bind(projectId)
    .all<SectionRow>();

  return {
    project_id: projectId,
    sections: (rows.results ?? []).map(mapSection)
  };
};

const getSectionProgress = async (
  env: Env,
  input: Record<string, unknown>
): Promise<Record<string, unknown>> => {
  const projectId = projectIdFromInput(input);
  const sectionId = asPositiveInt(input.section_id, "section_id", { required: true });
  const section = await env.DB.prepare(
    "SELECT * FROM project_section WHERE project_id = ? AND id = ?"
  )
    .bind(projectId, sectionId)
    .first<SectionRow>();
  if (!section) throw new Error("Section not found");

  const progress = await env.DB.prepare(
    `SELECT MAX(cumulative_pipe_count) AS cumulative_pipe_count,
            SUM(IFNULL(footage_m, 0)) AS total_footage_m,
            MAX(log_date) AS latest_log_date
       FROM operator_log
      WHERE project_id = ? AND section_id = ? AND status != 'deleted'`
  )
    .bind(projectId, sectionId)
    .first<{
      cumulative_pipe_count: number | null;
      total_footage_m: number | null;
      latest_log_date: string | null;
    }>();

  return {
    ...mapSection(section),
    project_id: projectId,
    cumulative_pipe_count: progress?.cumulative_pipe_count ?? 0,
    total_footage_m: progress?.total_footage_m ?? 0,
    latest_log_date: progress?.latest_log_date ?? null
  };
};

const getLatestManagerLogs = async (
  env: Env,
  input: Record<string, unknown>
): Promise<Record<string, unknown>> => {
  const projectId = projectIdFromInput(input);
  const limit = limitFromInput(input);
  const rows = await env.DB.prepare(
    `SELECT id, project_id, log_date, title, detail_html, risk_note, status, updated_at
       FROM manager_log
      WHERE project_id = ? AND status != 'deleted'
      ORDER BY log_date DESC, id DESC
      LIMIT ?`
  )
    .bind(projectId, limit)
    .all<ManagerLogRow>();

  return {
    project_id: projectId,
    logs: (rows.results ?? []).map((row) => ({
      log_id: row.id,
      log_date: row.log_date,
      title: row.title,
      detail_text: stripHtml(row.detail_html),
      risk_note: row.risk_note,
      status: row.status,
      updated_at: row.updated_at
    }))
  };
};

const getLatestOperatorLogs = async (
  env: Env,
  input: Record<string, unknown>
): Promise<Record<string, unknown>> => {
  const projectId = projectIdFromInput(input);
  const sectionId = input.section_id
    ? asPositiveInt(input.section_id, "section_id", { required: true })
    : null;
  const limit = limitFromInput(input);
  const rows = sectionId
    ? await env.DB.prepare(
        `SELECT id, project_id, section_id, log_date, shift, completed_pipe_count,
                cumulative_pipe_count, footage_m, issue_summary, remark, status, updated_at
           FROM operator_log
          WHERE project_id = ? AND section_id = ? AND status != 'deleted'
          ORDER BY log_date DESC, id DESC
          LIMIT ?`
      )
        .bind(projectId, sectionId, limit)
        .all<OperatorLogRow>()
    : await env.DB.prepare(
        `SELECT id, project_id, section_id, log_date, shift, completed_pipe_count,
                cumulative_pipe_count, footage_m, issue_summary, remark, status, updated_at
           FROM operator_log
          WHERE project_id = ? AND status != 'deleted'
          ORDER BY log_date DESC, id DESC
          LIMIT ?`
      )
        .bind(projectId, limit)
        .all<OperatorLogRow>();

  return {
    project_id: projectId,
    section_id: sectionId,
    logs: (rows.results ?? []).map((row) => ({
      log_id: row.id,
      section_id: row.section_id,
      log_date: row.log_date,
      shift: row.shift,
      completed_pipe_count: row.completed_pipe_count,
      cumulative_pipe_count: row.cumulative_pipe_count,
      footage_m: row.footage_m,
      issue_summary: row.issue_summary,
      remark: row.remark,
      status: row.status,
      updated_at: row.updated_at
    }))
  };
};

const getProjectRiskSummary = async (
  env: Env,
  input: Record<string, unknown>
): Promise<Record<string, unknown>> => {
  const projectId = projectIdFromInput(input);
  const managerLogs = await getLatestManagerLogs(env, { project_id: projectId, limit: 10 });
  const operatorLogs = await getLatestOperatorLogs(env, { project_id: projectId, limit: 10 });
  const managerItems = Array.isArray(managerLogs.logs) ? managerLogs.logs : [];
  const operatorItems = Array.isArray(operatorLogs.logs) ? operatorLogs.logs : [];

  return {
    project_id: projectId,
    manager_risks: managerItems
      .filter((item) => typeof item === "object" && item && "risk_note" in item)
      .map((item) => item as { risk_note?: unknown })
      .filter((item) => typeof item.risk_note === "string" && item.risk_note.trim())
      .map((item) => item.risk_note),
    operator_issues: operatorItems
      .filter((item) => typeof item === "object" && item && "issue_summary" in item)
      .map((item) => item as { issue_summary?: unknown })
      .filter((item) => typeof item.issue_summary === "string" && item.issue_summary.trim())
      .map((item) => item.issue_summary)
  };
};

const getEquipmentSummary = async (
  env: Env,
  input: Record<string, unknown>
): Promise<Record<string, unknown>> => {
  const projectId = projectIdFromInput(input);
  const plan = await env.DB.prepare(
    `SELECT id, plan_no, plan_status, ai_status, updated_at
       FROM project_equipment_plan
      WHERE project_id = ?
      ORDER BY id DESC LIMIT 1`
  )
    .bind(projectId)
    .first<{
      id: number;
      plan_no: string;
      plan_status: string;
      ai_status: string;
      updated_at: string;
    }>();
  const activeAssets = await env.DB.prepare(
    "SELECT COUNT(*) AS active_asset_count FROM tracked_asset WHERE current_project_id = ?"
  )
    .bind(projectId)
    .first<{ active_asset_count: number }>();
  const items = plan
    ? await env.DB.prepare(
        `SELECT asset_type_id, planned_qty, recommended_qty, source, note
           FROM project_equipment_plan_item
          WHERE plan_id = ?
          ORDER BY id ASC`
      )
        .bind(plan.id)
        .all<{
          asset_type_id: number;
          planned_qty: number;
          recommended_qty: number | null;
          source: string | null;
          note: string | null;
        }>()
    : { results: [] };

  return {
    project_id: projectId,
    active_asset_count: activeAssets?.active_asset_count ?? 0,
    latest_plan: plan
      ? {
          plan_id: plan.id,
          plan_no: plan.plan_no,
          plan_status: plan.plan_status,
          ai_status: plan.ai_status,
          updated_at: plan.updated_at,
          items: items.results ?? []
        }
      : null
  };
};

const getPublicLogLink = async (
  env: Env,
  input: Record<string, unknown>
): Promise<Record<string, unknown>> => {
  const projectId = projectIdFromInput(input);
  const link = await env.DB.prepare(
    `SELECT id, project_id, token, allowed_log_types_json, expires_at, status, updated_at
       FROM project_public_log_link
      WHERE project_id = ? AND status = 'active'
      ORDER BY id DESC LIMIT 1`
  )
    .bind(projectId)
    .first<{
      id: number;
      project_id: number;
      token?: string | null;
      allowed_log_types_json: string;
      expires_at: string | null;
      status: string;
      updated_at: string;
    }>();

  const baseUrl = env.WECOM_TOOL_WEB_BASE_URL?.replace(/\/$/, "") ?? null;
  const url = link?.token && baseUrl ? `${baseUrl}/#/public/project-log/${link.token}` : null;

  return {
    project_id: projectId,
    status: link?.status ?? "missing",
    url,
    expires_at: link?.expires_at ?? null,
    updated_at: link?.updated_at ?? null
  };
};

export const callWeComProjectTool = async (
  env: Env,
  tool: string,
  input: Record<string, unknown>
): Promise<ToolResult> => {
  if (!isWeComReadOnlyToolName(tool)) {
    throw new Error("Unsupported WeCom read-only tool");
  }

  const handlers: Record<
    WeComReadOnlyToolName,
    (env: Env, input: Record<string, unknown>) => Promise<Record<string, unknown>>
  > = {
    get_project_overview: getProjectOverview,
    list_project_sections: listProjectSections,
    get_section_progress: getSectionProgress,
    get_latest_manager_logs: getLatestManagerLogs,
    get_latest_operator_logs: getLatestOperatorLogs,
    get_project_risk_summary: getProjectRiskSummary,
    get_equipment_summary: getEquipmentSummary,
    get_public_log_link: getPublicLogLink
  };

  return {
    data: await handlers[tool](env, input),
    meta: {
      tool,
      generated_at: nowIso()
    }
  };
};

export const summarizeWeComToolResponse = (value: unknown): string => {
  const text = JSON.stringify(value);
  return text.length > 500 ? `${text.slice(0, 497)}...` : text;
};
