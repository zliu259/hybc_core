import { Hono } from "hono";

import { authMiddleware, type AuthVariables } from "../middleware/auth";
import { requireRoles } from "../middleware/rbac";
import type { Env } from "../types/env";

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
  const keyword = c.req.query("keyword");
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
  if (keyword) {
    sql += " AND (project_name LIKE ? OR project_code LIKE ?)";
    countSql += " AND (project_name LIKE ? OR project_code LIKE ?)";
    params.push(`%${keyword}%`, `%${keyword}%`);
  }

  sql += " ORDER BY id DESC LIMIT ? OFFSET ?";

  const listResult = await c.env.DB.prepare(sql)
    .bind(...params, pageSize, offset)
    .all();

  const countResult = await c.env.DB.prepare(countSql)
    .bind(...params)
    .first<{ total: number }>();

  return c.json({
    success: true,
    data: listResult.results ?? [],
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

  return c.json({ success: true, data: project });
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
  };

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
    "INSERT INTO project (project_code, project_name, entity_id, manager_userid, status, start_date, end_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(
      body.project_code,
      body.project_name,
      body.entity_id ?? null,
      body.manager_userid ?? null,
      status,
      body.start_date ?? null,
      body.end_date ?? null,
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
  };

  await c.env.DB.prepare(
    "UPDATE project SET project_name = COALESCE(?, project_name), entity_id = ?, manager_userid = ?, start_date = ?, end_date = ?, updated_at = ? WHERE id = ?"
  )
    .bind(
      body.project_name ?? null,
      body.entity_id ?? null,
      body.manager_userid ?? null,
      body.start_date ?? null,
      body.end_date ?? null,
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

  return c.json({ success: true, data: rows.results ?? [] });
});

projectRoutes.post("/:id/sections", requireRoles(["super_admin", "manager", "site_manager"]), async (c) => {
  const projectId = Number(c.req.param("id"));
  const body = (await c.req.json()) as {
    section_code: string;
    section_name: string;
    section_length?: number | null;
    status?: ProjectStatus;
  };

  const createdAt = nowIso();
  const result = await c.env.DB.prepare(
    "INSERT INTO project_section (project_id, section_code, section_name, section_length, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(
      projectId,
      body.section_code,
      body.section_name,
      body.section_length ?? null,
      body.status ?? "planning",
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
    };

    await c.env.DB.prepare(
      "UPDATE project_section SET section_name = COALESCE(?, section_name), section_length = ?, status = COALESCE(?, status), updated_at = ? WHERE id = ?"
    )
      .bind(
        body.section_name ?? null,
        body.section_length ?? null,
        body.status ?? null,
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
