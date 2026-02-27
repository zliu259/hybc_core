import { Hono } from "hono";

import { authMiddleware, type AuthVariables } from "../middleware/auth";
import { requireRoles } from "../middleware/rbac";
import type { Env } from "../types/env";
import { hydrateLegacyProject, hydrateLegacySection } from "../utils/legacy-compat";

const nowIso = () => new Date().toISOString();

const allowedStatus = [
  "planning",
  "preparing",
  "active",
  "completing",
  "archived"
] as const;

type ProjectStatus = (typeof allowedStatus)[number];

export const projectRoutes = new Hono<{
  Bindings: Env;
  Variables: AuthVariables;
}>();

projectRoutes.use("*", authMiddleware);

projectRoutes.get("/", async (c) => {
  const status = c.req.query("status");
  const projectKind = c.req.query("project_kind");
  const keyword = c.req.query("keyword");
  const location = c.req.query("location");
  const page = Math.max(Number(c.req.query("page") ?? "1"), 1);
  const pageSize = Math.min(Math.max(Number(c.req.query("pageSize") ?? "20"), 1), 100);
  const offset = (page - 1) * pageSize;

  let sql = "SELECT * FROM project WHERE 1=1";
  let countSql = "SELECT COUNT(*) AS total FROM project WHERE 1=1";
  const params: string[] = [];

  if (status) {
    sql += " AND status = ?";
    countSql += " AND status = ?";
    params.push(status);
  }
  if (projectKind) {
    sql += " AND project_kind = ?";
    countSql += " AND project_kind = ?";
    params.push(projectKind);
  }
  if (keyword) {
    sql += " AND (project_name LIKE ? OR project_code LIKE ?)";
    countSql += " AND (project_name LIKE ? OR project_code LIKE ?)";
    params.push(`%${keyword}%`, `%${keyword}%`);
  }
  if (location) {
    sql += " AND IFNULL(location_text, '') LIKE ?";
    countSql += " AND IFNULL(location_text, '') LIKE ?";
    params.push(`%${location}%`);
  }

  sql +=
    " ORDER BY CASE status WHEN 'active' THEN 1 WHEN 'preparing' THEN 2 WHEN 'planning' THEN 3 WHEN 'completing' THEN 4 WHEN 'archived' THEN 5 ELSE 9 END, COALESCE(project_start_at, start_date, created_at) DESC, id DESC LIMIT ? OFFSET ?";

  const listResult = await c.env.DB.prepare(sql)
    .bind(...params, pageSize, offset)
    .all();

  const countResult = await c.env.DB.prepare(countSql)
    .bind(...params)
    .first<{ total: number }>();

  const data = (listResult.results ?? []).map((item) =>
    hydrateLegacyProject(item as unknown as Record<string, unknown>)
  );

  return c.json({
    success: true,
    data,
    pagination: {
      page,
      pageSize,
      total: countResult?.total ?? 0
    }
  });
});

projectRoutes.get("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const project = await c.env.DB.prepare("SELECT * FROM project WHERE id = ?")
    .bind(id)
    .first();

  if (!project) {
    return c.json(
      {
        success: false,
        error: {
          message: "Project not found"
        }
      },
      404
    );
  }

  return c.json({
    success: true,
    data: hydrateLegacyProject(project as unknown as Record<string, unknown>)
  });
});

projectRoutes.post("/", requireRoles(["super_admin", "manager", "site_manager"]), async (c) => {
  const body = (await c.req.json()) as {
    project_code: string;
    project_name: string;
    entity_id?: number | null;
    manager_userid?: string | null;
    status?: ProjectStatus;
    start_date?: string | null;
    end_date?: string | null;
    location_text?: string | null;
    project_briefing?: string | null;
    project_start_at?: string | null;
    project_kind?: "internal" | "external";
    external_party_name?: string | null;
  };

  const projectKind = body.project_kind ?? "internal";
  if (projectKind !== "internal" && projectKind !== "external") {
    return c.json({ success: false, error: { message: "project_kind must be internal or external" } }, 400);
  }

  const status = body.status ?? "planning";
  if (!allowedStatus.includes(status)) {
    return c.json(
      {
        success: false,
        error: { message: "Invalid status" }
      },
      400
    );
  }

  const createdAt = nowIso();
  const result = await c.env.DB.prepare(
    "INSERT INTO project (project_code, project_name, entity_id, manager_userid, status, start_date, end_date, location_text, project_briefing, project_start_at, project_kind, external_party_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(
      body.project_code,
      body.project_name,
      body.entity_id ?? null,
      body.manager_userid ?? null,
      status,
      body.start_date ?? null,
      body.end_date ?? null,
      body.location_text ?? null,
      body.project_briefing ?? null,
      body.project_start_at ?? null,
      projectKind,
      body.external_party_name ?? null,
      createdAt,
      createdAt
    )
    .run();

  return c.json({ success: true, data: { id: result.meta.last_row_id } }, 201);
});

projectRoutes.put("/:id", requireRoles(["super_admin", "manager", "site_manager"]), async (c) => {
  const id = Number(c.req.param("id"));
  const body = (await c.req.json()) as {
    project_name?: string;
    entity_id?: number | null;
    manager_userid?: string | null;
    start_date?: string | null;
    end_date?: string | null;
    location_text?: string | null;
    project_briefing?: string | null;
    project_start_at?: string | null;
    project_kind?: "internal" | "external";
    external_party_name?: string | null;
  };

  if (
    body.project_kind !== undefined &&
    body.project_kind !== "internal" &&
    body.project_kind !== "external"
  ) {
    return c.json({ success: false, error: { message: "project_kind must be internal or external" } }, 400);
  }

  await c.env.DB.prepare(
    "UPDATE project SET project_name = COALESCE(?, project_name), entity_id = ?, manager_userid = ?, start_date = ?, end_date = ?, location_text = COALESCE(?, location_text), project_briefing = COALESCE(?, project_briefing), project_start_at = COALESCE(?, project_start_at), project_kind = COALESCE(?, project_kind), external_party_name = COALESCE(?, external_party_name), updated_at = ? WHERE id = ?"
  )
    .bind(
      body.project_name ?? null,
      body.entity_id ?? null,
      body.manager_userid ?? null,
      body.start_date ?? null,
      body.end_date ?? null,
      body.location_text ?? null,
      body.project_briefing ?? null,
      body.project_start_at ?? null,
      body.project_kind ?? null,
      body.external_party_name ?? null,
      nowIso(),
      id
    )
    .run();

  return c.json({ success: true });
});

projectRoutes.patch(
  "/:id/status",
  requireRoles(["super_admin", "manager", "site_manager"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const body = (await c.req.json()) as {
      status: ProjectStatus;
    };

    if (!allowedStatus.includes(body.status)) {
      return c.json(
        {
          success: false,
          error: { message: "Invalid status" }
        },
        400
      );
    }

    await c.env.DB.prepare("UPDATE project SET status = ?, updated_at = ? WHERE id = ?")
      .bind(body.status, nowIso(), id)
      .run();

    return c.json({ success: true });
  }
);

projectRoutes.delete("/:id", requireRoles(["super_admin", "manager"]), async (c) => {
  const id = Number(c.req.param("id"));
  await c.env.DB.prepare("UPDATE project SET status = 'archived', updated_at = ? WHERE id = ?")
    .bind(nowIso(), id)
    .run();

  return c.json({ success: true });
});

projectRoutes.get("/:id/sections", async (c) => {
  const projectId = Number(c.req.param("id"));
  const rows = await c.env.DB.prepare(
    "SELECT * FROM project_section WHERE project_id = ? ORDER BY id DESC"
  )
    .bind(projectId)
    .all();

  const data = (rows.results ?? []).map((item) =>
    hydrateLegacySection(item as unknown as Record<string, unknown>)
  );
  return c.json({ success: true, data });
});

projectRoutes.get("/:id/files", async (c) => {
  const projectId = Number(c.req.param("id"));
  const sectionIdQuery = c.req.query("section_id");
  const category = c.req.query("category");

  let sql =
    "SELECT pf.*, ps.section_code, ps.section_name FROM project_file pf LEFT JOIN project_section ps ON ps.id = pf.section_id WHERE pf.project_id = ? AND pf.status = 'active'";
  const params: Array<string | number> = [projectId];

  if (sectionIdQuery) {
    sql += " AND pf.section_id = ?";
    params.push(Number(sectionIdQuery));
  }

  if (category) {
    sql += " AND pf.category = ?";
    params.push(category);
  }

  sql += " ORDER BY pf.id DESC";

  const rows = await c.env.DB.prepare(sql)
    .bind(...params)
    .all();

  const data = (rows.results ?? []).map((item) => {
    const key = String(item.file_key ?? "");
    return {
      ...item,
      file_url: `/api/v1/upload/object/${encodeURIComponent(key)}`
    };
  });

  return c.json({ success: true, data });
});

projectRoutes.post(
  "/:id/files",
  requireRoles(["super_admin", "manager", "site_manager", "finance", "operator"]),
  async (c) => {
    const projectId = Number(c.req.param("id"));
    const auth = c.get("auth");
    const body = (await c.req.json()) as {
      file_name: string;
      file_key: string;
      file_size?: number | null;
      category?: string | null;
      section_id?: number | null;
      remark?: string | null;
    };

    if (!body.file_name?.trim() || !body.file_key?.trim()) {
      return c.json(
        {
          success: false,
          error: { message: "file_name and file_key are required" }
        },
        400
      );
    }

    const project = await c.env.DB.prepare("SELECT id FROM project WHERE id = ?")
      .bind(projectId)
      .first<{ id: number }>();
    if (!project) {
      return c.json({ success: false, error: { message: "Project not found" } }, 404);
    }

    if (body.section_id) {
      const section = await c.env.DB.prepare(
        "SELECT id FROM project_section WHERE id = ? AND project_id = ?"
      )
        .bind(body.section_id, projectId)
        .first<{ id: number }>();
      if (!section) {
        return c.json(
          { success: false, error: { message: "Section not found in this project" } },
          400
        );
      }
    }

    const now = nowIso();
    const result = await c.env.DB.prepare(
      `INSERT INTO project_file
        (project_id, section_id, file_name, file_key, file_size, category, remark, uploaded_by_userid, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`
    )
      .bind(
        projectId,
        body.section_id ?? null,
        body.file_name.trim(),
        body.file_key.trim(),
        body.file_size ?? null,
        body.category?.trim() || null,
        body.remark?.trim() || null,
        auth.sub,
        now,
        now
      )
      .run();

    return c.json({ success: true, data: { id: result.meta.last_row_id } }, 201);
  }
);

projectRoutes.delete(
  "/:id/files/:fileId",
  requireRoles(["super_admin", "manager", "site_manager", "finance", "operator"]),
  async (c) => {
    const projectId = Number(c.req.param("id"));
    const fileId = Number(c.req.param("fileId"));
    const auth = c.get("auth");

    const row = await c.env.DB.prepare(
      "SELECT id, uploaded_by_userid FROM project_file WHERE id = ? AND project_id = ? AND status = 'active'"
    )
      .bind(fileId, projectId)
      .first<{ id: number; uploaded_by_userid: string }>();

    if (!row) {
      return c.json({ success: false, error: { message: "Project file not found" } }, 404);
    }

    const privileged = auth.roles.some((role) =>
      ["super_admin", "manager", "site_manager"].includes(role)
    );
    if (!privileged && auth.sub !== row.uploaded_by_userid) {
      return c.json({ success: false, error: { message: "Forbidden" } }, 403);
    }

    await c.env.DB.prepare(
      "UPDATE project_file SET status = 'deleted', updated_at = ? WHERE id = ?"
    )
      .bind(nowIso(), fileId)
      .run();

    return c.json({ success: true });
  }
);

projectRoutes.post("/:id/sections", requireRoles(["super_admin", "manager", "site_manager"]), async (c) => {
  const projectId = Number(c.req.param("id"));
  const body = (await c.req.json()) as {
    section_code: string;
    section_name: string;
    section_length?: number | null;
    status?: ProjectStatus;
    pipe_material?: string | null;
    pipe_model?: string | null;
    soil_type?: string | null;
    assigned_machine_type?: string | null;
    ai_machine_match_note?: string | null;
    ai_machine_match_score?: number | null;
  };

  const createdAt = nowIso();
  const result = await c.env.DB.prepare(
    "INSERT INTO project_section (project_id, section_code, section_name, section_length, status, pipe_material, pipe_model, soil_type, assigned_machine_type, ai_machine_match_note, ai_machine_match_score, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(
      projectId,
      body.section_code,
      body.section_name,
      body.section_length ?? null,
      body.status ?? "planning",
      body.pipe_material ?? null,
      body.pipe_model ?? null,
      body.soil_type ?? null,
      body.assigned_machine_type ?? null,
      body.ai_machine_match_note ?? null,
      body.ai_machine_match_score ?? null,
      createdAt,
      createdAt
    )
    .run();

  return c.json({ success: true, data: { id: result.meta.last_row_id } }, 201);
});

projectRoutes.put(
  "/:id/sections/:sectionId",
  requireRoles(["super_admin", "manager", "site_manager"]),
  async (c) => {
    const sectionId = Number(c.req.param("sectionId"));
    const body = (await c.req.json()) as {
      section_name?: string;
      section_length?: number | null;
      status?: ProjectStatus;
      pipe_material?: string | null;
      pipe_model?: string | null;
      soil_type?: string | null;
      assigned_machine_type?: string | null;
      ai_machine_match_note?: string | null;
      ai_machine_match_score?: number | null;
    };

    await c.env.DB.prepare(
      "UPDATE project_section SET section_name = COALESCE(?, section_name), section_length = ?, status = COALESCE(?, status), pipe_material = COALESCE(?, pipe_material), pipe_model = COALESCE(?, pipe_model), soil_type = COALESCE(?, soil_type), assigned_machine_type = COALESCE(?, assigned_machine_type), ai_machine_match_note = COALESCE(?, ai_machine_match_note), ai_machine_match_score = COALESCE(?, ai_machine_match_score), updated_at = ? WHERE id = ?"
    )
      .bind(
        body.section_name ?? null,
        body.section_length ?? null,
        body.status ?? null,
        body.pipe_material ?? null,
        body.pipe_model ?? null,
        body.soil_type ?? null,
        body.assigned_machine_type ?? null,
        body.ai_machine_match_note ?? null,
        body.ai_machine_match_score ?? null,
        nowIso(),
        sectionId
      )
      .run();

    return c.json({ success: true });
  }
);

projectRoutes.delete(
  "/:id/sections/:sectionId",
  requireRoles(["super_admin", "manager"]),
  async (c) => {
    const sectionId = Number(c.req.param("sectionId"));
    await c.env.DB.prepare("DELETE FROM project_section WHERE id = ?")
      .bind(sectionId)
      .run();

    return c.json({ success: true });
  }
);

projectRoutes.get("/:id/financial-summary", async (c) => {
  const id = Number(c.req.param("id"));

  const outbound = await c.env.DB.prepare(
    "SELECT IFNULL(SUM(paid_amount), 0) as total FROM contract WHERE project_id = ? AND direction = 'outbound' AND status != 'deleted'"
  )
    .bind(id)
    .first<{ total: number }>();

  const inbound = await c.env.DB.prepare(
    "SELECT IFNULL(SUM(received_amount), 0) as total FROM contract WHERE project_id = ? AND direction = 'inbound' AND status != 'deleted'"
  )
    .bind(id)
    .first<{ total: number }>();

  const invoiced = await c.env.DB.prepare(
    "SELECT IFNULL(SUM(invoiced_amount), 0) as total FROM contract WHERE project_id = ? AND direction = 'inbound' AND status != 'deleted'"
  )
    .bind(id)
    .first<{ total: number }>();

  const reimbursement = await c.env.DB.prepare(
    "SELECT IFNULL(SUM(total_amount), 0) as total FROM reimbursement_batch WHERE project_id = ? AND status IN ('approved', 'paid')"
  )
    .bind(id)
    .first<{ total: number }>();

  const receiptCount = await c.env.DB.prepare(
    "SELECT COUNT(*) as cnt FROM receipt WHERE project_id = ? AND status != 'deleted'"
  )
    .bind(id)
    .first<{ cnt: number }>();

  return c.json({
    success: true,
    data: {
      projectId: id,
      outboundPaidAmount: outbound?.total ?? 0,
      inboundReceivedAmount: inbound?.total ?? 0,
      inboundInvoicedAmount: invoiced?.total ?? 0,
      reimbursementAmount: reimbursement?.total ?? 0,
      receiptCount: receiptCount?.cnt ?? 0
    }
  });
});
