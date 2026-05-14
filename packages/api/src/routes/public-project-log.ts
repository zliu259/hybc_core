import { Hono } from "hono";

import { enqueueTask } from "../services/task-queue";
import { signObjectAccess } from "../services/upload-signature";
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
  pipe_material: string | null;
  pipe_model: string | null;
  soil_type: string | null;
  assigned_machine_type: string | null;
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
            pipe_material, pipe_model, soil_type, assigned_machine_type
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
            footage_m, issue_summary, remark, operator_userid, source_type
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
            footage_m, issue_summary, remark, operator_userid, source_type
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

  return c.json({
    success: true,
    data: {
      key,
      expiresAt,
      contentType: body.contentType ?? "application/octet-stream",
      uploadUrl: `/api/v1/upload/object/${encodeURIComponent(key)}?expires=${expiresAt}&signature=${signature}`,
      fileUrl: `/api/v1/upload/object/${encodeURIComponent(key)}`
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
