import { Hono } from "hono";

import { authMiddleware, type AuthVariables } from "../middleware/auth";
import { requireRoles } from "../middleware/rbac";
import { generateSerial } from "../services/serial";
import type { Env } from "../types/env";
import type { BreakthroughReport, SiteSurvey, SiteSurveyItem } from "../types/survey";

const nowIso = () => new Date().toISOString();

export const surveyRoutes = new Hono<{
  Bindings: Env;
  Variables: AuthVariables;
}>();

surveyRoutes.use("*", authMiddleware);

surveyRoutes.get(
  "/breakthrough",
  requireRoles(["super_admin", "manager", "site_manager", "operator"]),
  async (c) => {
    const projectId = c.req.query("project_id");
    const sectionId = c.req.query("section_id");
    const dateFrom = c.req.query("date_from");
    const dateTo = c.req.query("date_to");
    let sql = "SELECT * FROM breakthrough_report WHERE status != 'deleted'";
    const params: Array<string | number> = [];
    if (projectId) {
      sql += " AND project_id = ?";
      params.push(Number(projectId));
    }
    if (sectionId) {
      sql += " AND section_id = ?";
      params.push(Number(sectionId));
    }
    if (dateFrom) {
      sql += " AND report_date >= ?";
      params.push(dateFrom);
    }
    if (dateTo) {
      sql += " AND report_date <= ?";
      params.push(dateTo);
    }
    sql += " ORDER BY report_date DESC, id DESC";
    const rows = await c.env.DB.prepare(sql).bind(...params).all<BreakthroughReport>();
    return c.json({ success: true, data: rows.results ?? [] });
  }
);

surveyRoutes.post(
  "/breakthrough",
  requireRoles(["super_admin", "manager", "site_manager"]),
  async (c) => {
    const auth = c.get("auth");
    const body = (await c.req.json()) as {
      project_id: number;
      section_id?: number;
      report_date: string;
      breakthrough_m?: number;
      summary?: string;
      detail?: string;
      status?: string;
    };
    if (!body.project_id || !body.report_date?.trim()) {
      return c.json({ success: false, error: { message: "project_id and report_date are required" } }, 400);
    }

    const reportNo = await generateSerial(c.env.DB, "GT", "breakthrough_report", "report_no");
    const now = nowIso();
    const result = await c.env.DB.prepare(
      `INSERT INTO breakthrough_report
        (report_no, project_id, section_id, report_date, breakthrough_m, summary, detail, reporter_userid, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        reportNo,
        body.project_id,
        body.section_id ?? null,
        body.report_date,
        body.breakthrough_m ?? null,
        body.summary ?? null,
        body.detail ?? null,
        auth.sub,
        body.status ?? "draft",
        now,
        now
      )
      .run();

    return c.json({ success: true, data: { id: result.meta.last_row_id, report_no: reportNo } }, 201);
  }
);

surveyRoutes.get(
  "/breakthrough/:id",
  requireRoles(["super_admin", "manager", "site_manager", "operator"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const row = await c.env.DB.prepare("SELECT * FROM breakthrough_report WHERE id = ? AND status != 'deleted'")
      .bind(id)
      .first<BreakthroughReport>();
    if (!row) {
      return c.json({ success: false, error: { message: "Breakthrough report not found" } }, 404);
    }
    return c.json({ success: true, data: row });
  }
);

surveyRoutes.put(
  "/breakthrough/:id",
  requireRoles(["super_admin", "manager", "site_manager"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const body = (await c.req.json()) as {
      section_id?: number;
      report_date?: string;
      breakthrough_m?: number;
      summary?: string;
      detail?: string;
      status?: string;
    };
    await c.env.DB.prepare(
      `UPDATE breakthrough_report SET
         section_id = COALESCE(?, section_id),
         report_date = COALESCE(?, report_date),
         breakthrough_m = COALESCE(?, breakthrough_m),
         summary = COALESCE(?, summary),
         detail = COALESCE(?, detail),
         status = COALESCE(?, status),
         updated_at = ?
       WHERE id = ?`
    )
      .bind(
        body.section_id ?? null,
        body.report_date ?? null,
        body.breakthrough_m ?? null,
        body.summary ?? null,
        body.detail ?? null,
        body.status ?? null,
        nowIso(),
        id
      )
      .run();
    return c.json({ success: true });
  }
);

surveyRoutes.delete(
  "/breakthrough/:id",
  requireRoles(["super_admin", "manager"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    await c.env.DB.prepare("UPDATE breakthrough_report SET status = 'deleted', updated_at = ? WHERE id = ?")
      .bind(nowIso(), id)
      .run();
    return c.json({ success: true });
  }
);

surveyRoutes.get(
  "/site-survey",
  requireRoles(["super_admin", "manager", "site_manager", "operator"]),
  async (c) => {
    const projectId = c.req.query("project_id");
    const dateFrom = c.req.query("date_from");
    const dateTo = c.req.query("date_to");
    let sql = "SELECT * FROM site_survey WHERE status != 'deleted'";
    const params: Array<string | number> = [];
    if (projectId) {
      sql += " AND project_id = ?";
      params.push(Number(projectId));
    }
    if (dateFrom) {
      sql += " AND survey_date >= ?";
      params.push(dateFrom);
    }
    if (dateTo) {
      sql += " AND survey_date <= ?";
      params.push(dateTo);
    }
    sql += " ORDER BY survey_date DESC, id DESC";
    const rows = await c.env.DB.prepare(sql).bind(...params).all<SiteSurvey>();
    return c.json({ success: true, data: rows.results ?? [] });
  }
);

surveyRoutes.post(
  "/site-survey",
  requireRoles(["super_admin", "manager", "site_manager", "operator"]),
  async (c) => {
    const auth = c.get("auth");
    const body = (await c.req.json()) as {
      project_id: number;
      survey_date: string;
      location?: string;
      weather?: string;
      summary?: string;
      status?: string;
      items?: Array<{ item_name: string; item_value?: string; remark?: string }>;
    };
    if (!body.project_id || !body.survey_date?.trim()) {
      return c.json({ success: false, error: { message: "project_id and survey_date are required" } }, 400);
    }

    const now = nowIso();
    const result = await c.env.DB.prepare(
      `INSERT INTO site_survey
        (project_id, survey_date, location, weather, summary, surveyor_userid, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        body.project_id,
        body.survey_date,
        body.location ?? null,
        body.weather ?? null,
        body.summary ?? null,
        auth.sub,
        body.status ?? "draft",
        now,
        now
      )
      .run();

    const surveyId = Number(result.meta.last_row_id);
    if (Array.isArray(body.items)) {
      for (const item of body.items) {
        if (!item.item_name?.trim()) continue;
        await c.env.DB.prepare(
          `INSERT INTO site_survey_item
            (survey_id, item_name, item_value, remark, created_at)
           VALUES (?, ?, ?, ?, ?)`
        )
          .bind(surveyId, item.item_name, item.item_value ?? null, item.remark ?? null, now)
          .run();
      }
    }

    return c.json({ success: true, data: { id: surveyId } }, 201);
  }
);

surveyRoutes.get(
  "/site-survey/:id",
  requireRoles(["super_admin", "manager", "site_manager", "operator"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const row = await c.env.DB.prepare("SELECT * FROM site_survey WHERE id = ? AND status != 'deleted'")
      .bind(id)
      .first<SiteSurvey>();
    if (!row) {
      return c.json({ success: false, error: { message: "Site survey not found" } }, 404);
    }
    const items = await c.env.DB.prepare("SELECT * FROM site_survey_item WHERE survey_id = ? ORDER BY id ASC")
      .bind(id)
      .all<SiteSurveyItem>();

    return c.json({ success: true, data: { ...row, items: items.results ?? [] } });
  }
);

surveyRoutes.put(
  "/site-survey/:id",
  requireRoles(["super_admin", "manager", "site_manager"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const body = (await c.req.json()) as {
      survey_date?: string;
      location?: string;
      weather?: string;
      summary?: string;
      status?: string;
      items?: Array<{ item_name: string; item_value?: string; remark?: string }>;
    };
    await c.env.DB.prepare(
      `UPDATE site_survey SET
         survey_date = COALESCE(?, survey_date),
         location = COALESCE(?, location),
         weather = COALESCE(?, weather),
         summary = COALESCE(?, summary),
         status = COALESCE(?, status),
         updated_at = ?
       WHERE id = ?`
    )
      .bind(
        body.survey_date ?? null,
        body.location ?? null,
        body.weather ?? null,
        body.summary ?? null,
        body.status ?? null,
        nowIso(),
        id
      )
      .run();

    if (Array.isArray(body.items)) {
      await c.env.DB.prepare("DELETE FROM site_survey_item WHERE survey_id = ?").bind(id).run();
      for (const item of body.items) {
        if (!item.item_name?.trim()) continue;
        await c.env.DB.prepare(
          `INSERT INTO site_survey_item
            (survey_id, item_name, item_value, remark, created_at)
           VALUES (?, ?, ?, ?, ?)`
        )
          .bind(id, item.item_name, item.item_value ?? null, item.remark ?? null, nowIso())
          .run();
      }
    }

    return c.json({ success: true });
  }
);

surveyRoutes.delete(
  "/site-survey/:id",
  requireRoles(["super_admin", "manager"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    await c.env.DB.prepare("UPDATE site_survey SET status = 'deleted', updated_at = ? WHERE id = ?")
      .bind(nowIso(), id)
      .run();
    return c.json({ success: true });
  }
);
