import { Hono } from "hono";

import { enqueueTask } from "../services/task-queue";
import {
  buildObjectUrl,
  buildSignedObjectUrl,
  signObjectAccess
} from "../services/upload-signature";
import type { Env } from "../types/env";

const nowIso = () => new Date().toISOString();

type PublicLinkRow = {
  id: number;
  project_id: number;
  allowed_log_types_json: string;
  expires_at: string | null;
  status: string;
};

type ProjectRow = {
  id: number;
  project_code: string;
  project_name: string;
  status: string;
  location_text: string | null;
  project_briefing: string | null;
  project_start_at: string | null;
};

type SectionRow = {
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

type PublicOperatorLogRow = {
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

type PublicManagerLogRow = {
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

const hashToken = async (token: string): Promise<string> => {
  const bytes = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
};

const hashText = async (value: string): Promise<string | null> => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return hashToken(trimmed);
};

const parseFileName = (name: string): string => {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
};

const getUploadBaseUrl = (env: Env, requestUrl: string): string => {
  return env.WECOM_PUSH_API_BASE_URL?.trim() || new URL(requestUrl).origin;
};

const parseAllowedTypes = (raw: string): string[] => {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : ["operator_log", "project_log"];
  } catch {
    return ["operator_log", "project_log"];
  }
};

const requireActiveLink = async (
  env: Env,
  token: string
): Promise<{ link: PublicLinkRow; project: ProjectRow; sections: SectionRow[] } | Response> => {
  const tokenHash = await hashToken(token);
  const link = await env.DB.prepare(
    "SELECT * FROM project_public_log_link WHERE token_hash = ? AND status = 'active'"
  )
    .bind(tokenHash)
    .first<PublicLinkRow>();

  if (!link) {
    return Response.json(
      { success: false, error: { message: "Public log link not found" } },
      { status: 404 }
    );
  }

  if (link.expires_at && link.expires_at < nowIso()) {
    return Response.json(
      { success: false, error: { message: "Public log link expired" } },
      { status: 410 }
    );
  }

  const project = await env.DB.prepare(
    "SELECT id, project_code, project_name, status, location_text, project_briefing, project_start_at FROM project WHERE id = ?"
  )
    .bind(link.project_id)
    .first<ProjectRow>();

  if (!project || project.status === "archived") {
    return Response.json(
      {
        success: false,
        error: { message: "Project is archived; public log link is disabled" }
      },
      { status: 410 }
    );
  }

  const sectionRows = await env.DB.prepare(
    `SELECT id, project_id, section_code, section_name, section_length, status,
            design_slope, pipe_diameter_mm, pipe_material, pipe_model, soil_type,
            jacking_method, assigned_machine_type
       FROM project_section
      WHERE project_id = ?
      ORDER BY id DESC`
  )
    .bind(project.id)
    .all<SectionRow>();

  return { link, project, sections: sectionRows.results ?? [] };
};

const loadAuditContext = async (
  env: Env,
  projectId: number,
  sectionId: number | null,
  logDate: string
) => {
  const previousOperatorLogs = await env.DB.prepare(
    `SELECT id, section_id, log_date, shift, completed_pipe_count, cumulative_pipe_count,
            footage_m, cumulative_footage_m, main_thrust_text, chamber_pressure_mpa,
            cutter_current_text, cutter_frequency_hz, soil_type,
            horizontal_deviation_direction, horizontal_deviation_mm,
            vertical_deviation_direction, vertical_deviation_mm,
            issue_summary, remark, operator_userid, source_type
       FROM operator_log
      WHERE project_id = ?
        AND status != 'deleted'
        AND (? IS NULL OR section_id = ?)
      ORDER BY log_date DESC, id DESC
      LIMIT 8`
  )
    .bind(projectId, sectionId, sectionId)
    .all();

  const sameDayOperatorLogs = await env.DB.prepare(
    `SELECT id, section_id, log_date, shift, completed_pipe_count, cumulative_pipe_count,
            footage_m, cumulative_footage_m, main_thrust_text, chamber_pressure_mpa,
            cutter_current_text, cutter_frequency_hz, soil_type,
            horizontal_deviation_direction, horizontal_deviation_mm,
            vertical_deviation_direction, vertical_deviation_mm,
            issue_summary, remark, operator_userid, source_type
       FROM operator_log
      WHERE project_id = ?
        AND log_date = ?
        AND status != 'deleted'
      ORDER BY id DESC
      LIMIT 20`
  )
    .bind(projectId, logDate)
    .all();

  const previousProjectLogs = await env.DB.prepare(
    `SELECT id, log_date, title, detail_html, risk_note, manager_userid, source_type
       FROM manager_log
      WHERE project_id = ?
        AND status != 'deleted'
      ORDER BY log_date DESC, id DESC
      LIMIT 8`
  )
    .bind(projectId)
    .all();

  return {
    previous_operator_logs: previousOperatorLogs.results ?? [],
    same_day_operator_logs: sameDayOperatorLogs.results ?? [],
    previous_project_logs: previousProjectLogs.results ?? []
  };
};

export const publicProjectLogRoutes = new Hono<{ Bindings: Env }>();

publicProjectLogRoutes.get("/:token", async (c) => {
  const resolved = await requireActiveLink(c.env, c.req.param("token"));
  if (resolved instanceof Response) return resolved;

  return c.json({
    success: true,
    data: {
      project: {
        id: resolved.project.id,
        project_code: resolved.project.project_code,
        project_name: resolved.project.project_name,
        status: resolved.project.status,
        location_text: resolved.project.location_text
      },
      sections: resolved.sections,
      allowed_log_types: parseAllowedTypes(resolved.link.allowed_log_types_json),
      expires_at: resolved.link.expires_at
    }
  });
});

publicProjectLogRoutes.get("/:token/logs/project", async (c) => {
  const resolved = await requireActiveLink(c.env, c.req.param("token"));
  if (resolved instanceof Response) return resolved;

  const page = Math.max(Number(c.req.query("page") ?? "1"), 1);
  const pageSize = Math.min(Math.max(Number(c.req.query("pageSize") ?? "10"), 1), 30);
  const offset = (page - 1) * pageSize;

  const rows = await c.env.DB.prepare(
    `SELECT id, log_date, title, detail_html, risk_note, status, source_type,
            external_submitter_name, external_submitter_company
       FROM manager_log
      WHERE project_id = ?
        AND status != 'deleted'
      ORDER BY log_date DESC, id DESC
      LIMIT ? OFFSET ?`
  )
    .bind(resolved.project.id, pageSize, offset)
    .all<PublicManagerLogRow>();

  const totalRow = await c.env.DB.prepare(
    "SELECT COUNT(*) as total FROM manager_log WHERE project_id = ? AND status != 'deleted'"
  )
    .bind(resolved.project.id)
    .first<{ total: number }>();

  return c.json({
    success: true,
    data: rows.results ?? [],
    pagination: { page, pageSize, total: totalRow?.total ?? 0 }
  });
});

publicProjectLogRoutes.get("/:token/logs/operator", async (c) => {
  const resolved = await requireActiveLink(c.env, c.req.param("token"));
  if (resolved instanceof Response) return resolved;

  const page = Math.max(Number(c.req.query("page") ?? "1"), 1);
  const pageSize = Math.min(Math.max(Number(c.req.query("pageSize") ?? "10"), 1), 30);
  const offset = (page - 1) * pageSize;
  const sectionId = Number(c.req.query("section_id") ?? "0");

  let sql = `SELECT l.id, l.section_id, l.log_date, l.shift, l.weather,
                    l.completed_pipe_count, l.cumulative_pipe_count, l.footage_m,
                    l.cumulative_footage_m, l.main_thrust_mpa, l.main_thrust_text,
                    l.chamber_pressure_mpa, l.cutter_current_a, l.cutter_current_text,
                    l.cutter_frequency_hz, l.soil_type, l.deviation_direction,
                    l.deviation_value_mm, l.horizontal_deviation_direction,
                    l.horizontal_deviation_mm, l.vertical_deviation_direction,
                    l.vertical_deviation_mm, l.issue_summary, l.remark, l.status, l.source_type,
                    l.external_submitter_name, l.external_submitter_company,
                    s.section_code, s.section_name
               FROM operator_log l
               LEFT JOIN project_section s ON s.id = l.section_id
              WHERE l.project_id = ?
                AND l.status != 'deleted'`;
  let countSql =
    "SELECT COUNT(*) as total FROM operator_log WHERE project_id = ? AND status != 'deleted'";
  const params: Array<number> = [resolved.project.id];
  if (sectionId > 0) {
    sql += " AND l.section_id = ?";
    countSql += " AND section_id = ?";
    params.push(sectionId);
  }
  sql +=
    " ORDER BY l.log_date DESC, CASE l.shift WHEN 'day' THEN 1 WHEN 'night' THEN 2 ELSE 3 END DESC, l.id DESC LIMIT ? OFFSET ?";

  const rows = await c.env.DB.prepare(sql)
    .bind(...params, pageSize, offset)
    .all<PublicOperatorLogRow>();
  const totalRow = await c.env.DB.prepare(countSql)
    .bind(...params)
    .first<{ total: number }>();

  return c.json({
    success: true,
    data: rows.results ?? [],
    pagination: { page, pageSize, total: totalRow?.total ?? 0 }
  });
});

publicProjectLogRoutes.get("/:token/logs/operator/latest", async (c) => {
  const resolved = await requireActiveLink(c.env, c.req.param("token"));
  if (resolved instanceof Response) return resolved;

  const sectionId = Number(c.req.query("section_id") ?? "0");
  if (!sectionId) {
    return c.json({ success: true, data: null });
  }
  if (!resolved.sections.some((item) => item.id === sectionId)) {
    return c.json({ success: false, error: { message: "Section not found in this project" } }, 400);
  }

  const row = await c.env.DB.prepare(
    `SELECT l.id, l.section_id, l.log_date, l.shift, l.weather,
            l.completed_pipe_count, l.cumulative_pipe_count, l.footage_m,
            l.cumulative_footage_m, l.main_thrust_mpa, l.main_thrust_text,
            l.chamber_pressure_mpa, l.cutter_current_a, l.cutter_current_text,
            l.cutter_frequency_hz, l.soil_type, l.deviation_direction,
            l.deviation_value_mm, l.horizontal_deviation_direction,
            l.horizontal_deviation_mm, l.vertical_deviation_direction,
            l.vertical_deviation_mm, l.issue_summary, l.remark, l.status, l.source_type,
            l.external_submitter_name, l.external_submitter_company,
            s.section_code, s.section_name
       FROM operator_log l
       LEFT JOIN project_section s ON s.id = l.section_id
      WHERE l.project_id = ?
        AND l.section_id = ?
        AND l.status != 'deleted'
      ORDER BY l.log_date DESC,
               CASE l.shift WHEN 'day' THEN 1 WHEN 'night' THEN 2 ELSE 3 END DESC,
               l.id DESC
      LIMIT 1`
  )
    .bind(resolved.project.id, sectionId)
    .first<PublicOperatorLogRow>();

  return c.json({ success: true, data: row ?? null });
});

publicProjectLogRoutes.post("/:token/upload-sign", async (c) => {
  const resolved = await requireActiveLink(c.env, c.req.param("token"));
  if (resolved instanceof Response) return resolved;

  const body = (await c.req.json()) as {
    fileName: string;
    contentType?: string;
  };
  const safeName = parseFileName(body.fileName || "photo.jpg");
  const expiresAt = Date.now() + 10 * 60 * 1000;
  const key = `external-log/${resolved.project.id}/${Date.now()}-${crypto.randomUUID()}-${safeName}`;
  const signature = await signObjectAccess(c.env.UPLOAD_SIGNING_SECRET, key, expiresAt);
  const uploadBaseUrl = getUploadBaseUrl(c.env, c.req.url);

  return c.json({
    success: true,
    data: {
      key,
      expiresAt,
      contentType: body.contentType ?? "application/octet-stream",
      uploadUrl: buildSignedObjectUrl(key, expiresAt, signature, uploadBaseUrl),
      fileUrl: buildObjectUrl(key, uploadBaseUrl)
    }
  });
});

publicProjectLogRoutes.post("/:token/submissions", async (c) => {
  const resolved = await requireActiveLink(c.env, c.req.param("token"));
  if (resolved instanceof Response) return resolved;

  const body = (await c.req.json()) as {
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
  };

  const submitterName = String(body.submitter_name ?? "").trim();
  const logDate = String(body.log_date ?? "").trim();
  const shift = String(body.shift ?? "").trim();
  if (!submitterName || !logDate || !shift) {
    return c.json(
      { success: false, error: { message: "submitter_name, log_date and shift are required" } },
      400
    );
  }

  const logTypes = Array.isArray(body.log_types)
    ? body.log_types.filter((item): item is string =>
        ["operator_log", "project_log"].includes(item)
      )
    : [];
  const operatorLogEnabled =
    logTypes.includes("operator_log") || body.operator_log?.enabled === true;
  const projectLogEnabled =
    logTypes.includes("project_log") || body.project_log?.enabled === true || logTypes.length === 0;

  if (!operatorLogEnabled && !projectLogEnabled) {
    return c.json({ success: false, error: { message: "At least one log type is required" } }, 400);
  }

  const sectionId = operatorLogEnabled && body.section_id ? Number(body.section_id) : null;
  if (operatorLogEnabled && !sectionId) {
    return c.json(
      { success: false, error: { message: "section_id is required for section logs" } },
      400
    );
  }
  if (sectionId && !resolved.sections.some((item) => item.id === sectionId)) {
    return c.json({ success: false, error: { message: "Section not found in this project" } }, 400);
  }

  const photoKeys = Array.isArray(body.photo_keys)
    ? body.photo_keys.filter(
        (item): item is string => typeof item === "string" && item.trim().length > 0
      )
    : [];
  if (photoKeys.length > 12) {
    return c.json({ success: false, error: { message: "At most 12 photos are allowed" } }, 400);
  }

  const now = nowIso();
  const clientIp =
    c.req.header("cf-connecting-ip") ??
    c.req.header("x-forwarded-for") ??
    c.req.header("x-real-ip") ??
    "";
  const ipHash = await hashText(clientIp);
  const result = await c.env.DB.prepare(
    `INSERT INTO external_log_submission
      (project_id, section_id, submitter_name, submitter_company, submitter_phone,
       log_date, shift, operator_log_payload_json, project_log_payload_json, photo_keys_json,
       review_status, client_ip_hash, user_agent, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_ai_review', ?, ?, ?, ?)`
  )
    .bind(
      resolved.project.id,
      sectionId,
      submitterName,
      String(body.submitter_company ?? "").trim() || null,
      String(body.submitter_phone ?? "").trim() || null,
      logDate,
      shift,
      JSON.stringify({ ...(body.operator_log ?? {}), enabled: operatorLogEnabled }),
      JSON.stringify({ ...(body.project_log ?? {}), enabled: projectLogEnabled }),
      JSON.stringify(photoKeys),
      ipHash,
      c.req.header("user-agent") ?? null,
      now,
      now
    )
    .run();

  const submissionId = Number(result.meta.last_row_id);
  const context = await loadAuditContext(c.env, resolved.project.id, sectionId, logDate);
  const auditTask = await enqueueTask(c.env, {
    task_type: "external_log_audit",
    biz_type: "external_log_submission",
    biz_id: submissionId,
    priority: 7,
    payload: {
      submission_id: submissionId,
      project: resolved.project,
      section: resolved.sections.find((item) => item.id === sectionId) ?? null,
      submitter: {
        name: submitterName,
        company: String(body.submitter_company ?? "").trim() || null
      },
      log_date: logDate,
      shift,
      log_types: [
        ...(operatorLogEnabled ? ["operator_log"] : []),
        ...(projectLogEnabled ? ["project_log"] : [])
      ],
      operator_log: { ...(body.operator_log ?? {}), enabled: operatorLogEnabled },
      project_log: { ...(body.project_log ?? {}), enabled: projectLogEnabled },
      photo_count: photoKeys.length,
      context
    }
  });

  await c.env.DB.prepare(
    "UPDATE external_log_submission SET ai_review_task_id = ?, updated_at = ? WHERE id = ?"
  )
    .bind(auditTask.id, nowIso(), submissionId)
    .run();

  return c.json(
    {
      success: true,
      data: {
        id: submissionId,
        review_status: "pending_ai_review",
        ai_review_task_id: auditTask.id
      }
    },
    201
  );
});
