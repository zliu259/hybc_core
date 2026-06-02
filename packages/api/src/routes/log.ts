import { Hono } from "hono";

import { authMiddleware, type AuthVariables } from "../middleware/auth";
import { requireRoles } from "../middleware/rbac";
import { createTask } from "../services/ai-slot";
import { publishEvent } from "../services/event-bus";
import type { Env } from "../types/env";
import type { ManagerLog, ManagerLogPhoto, OperatorLog } from "../types/log";
import { hydrateLegacyManagerLog, hydrateLegacyOperatorLog } from "../utils/legacy-compat";

const nowIso = () => new Date().toISOString();

const shiftOrder = (shift: string): number => {
  if (shift === "day") return 1;
  if (shift === "night") return 2;
  return 3;
};

type OperatorLogInput = {
  project_id: number;
  section_id?: number | null;
  log_date: string;
  shift: string;
  weather?: string;
  completed_pipe_count?: number;
  cumulative_pipe_count?: number;
  footage_m?: number;
  cumulative_footage_m?: number;
  main_thrust_mpa?: number;
  main_thrust_text?: string;
  chamber_pressure_mpa?: number;
  cutter_current_a?: number;
  cutter_current_text?: string;
  cutter_frequency_hz?: number;
  soil_type?: string;
  deviation_direction?: string;
  deviation_value_mm?: number;
  horizontal_deviation_direction?: string;
  horizontal_deviation_mm?: number;
  vertical_deviation_direction?: string;
  vertical_deviation_mm?: number;
  issue_summary?: string;
  remark?: string;
  status?: string;
};

type OperatorLogPatchInput = Omit<Partial<OperatorLogInput>, "project_id">;

const nullableText = (value: string | undefined): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const nullableNumber = (value: number | undefined): number | null => {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
};

const getPreviousProgress = async (
  db: D1Database,
  projectId: number,
  sectionId: number | null | undefined,
  logDate: string,
  shift: string,
  excludeId?: number
): Promise<{ cumulative_pipe_count: number; cumulative_footage_m: number }> => {
  const currentOrder = shiftOrder(shift);
  let sql =
    "SELECT cumulative_pipe_count, cumulative_footage_m, log_date, shift FROM operator_log WHERE project_id = ? AND status != 'deleted'";
  const params: Array<string | number> = [projectId];
  if (sectionId) {
    sql += " AND section_id = ?";
    params.push(sectionId);
  }
  if (excludeId) {
    sql += " AND id != ?";
    params.push(excludeId);
  }
  sql +=
    " AND (log_date < ? OR (log_date = ? AND CASE shift WHEN 'day' THEN 1 WHEN 'night' THEN 2 ELSE 3 END < ?)) ORDER BY log_date DESC, CASE shift WHEN 'day' THEN 1 WHEN 'night' THEN 2 ELSE 3 END DESC, id DESC LIMIT 1";
  params.push(logDate, logDate, currentOrder);

  const previous = await db
    .prepare(sql)
    .bind(...params)
    .first<{ cumulative_pipe_count: number | null; cumulative_footage_m: number | null }>();

  if (!previous) {
    return { cumulative_pipe_count: 0, cumulative_footage_m: 0 };
  }

  if (previous.cumulative_footage_m !== null && previous.cumulative_footage_m !== undefined) {
    return {
      cumulative_pipe_count: previous.cumulative_pipe_count ?? 0,
      cumulative_footage_m: previous.cumulative_footage_m
    };
  }

  let sumSql =
    "SELECT IFNULL(SUM(IFNULL(footage_m, 0)), 0) AS cumulative_footage_m FROM operator_log WHERE project_id = ? AND status != 'deleted'";
  const sumParams: Array<string | number> = [projectId];
  if (sectionId) {
    sumSql += " AND section_id = ?";
    sumParams.push(sectionId);
  }
  if (excludeId) {
    sumSql += " AND id != ?";
    sumParams.push(excludeId);
  }
  sumSql +=
    " AND (log_date < ? OR (log_date = ? AND CASE shift WHEN 'day' THEN 1 WHEN 'night' THEN 2 ELSE 3 END < ?))";
  sumParams.push(logDate, logDate, currentOrder);

  const footageSum = await db
    .prepare(sumSql)
    .bind(...sumParams)
    .first<{ cumulative_footage_m: number }>();

  return {
    cumulative_pipe_count: previous.cumulative_pipe_count ?? 0,
    cumulative_footage_m: footageSum?.cumulative_footage_m ?? 0
  };
};

export const logRoutes = new Hono<{
  Bindings: Env;
  Variables: AuthVariables;
}>();

logRoutes.use("*", authMiddleware);

logRoutes.get(
  "/operator",
  requireRoles(["super_admin", "manager", "site_manager", "operator"]),
  async (c) => {
    const projectId = c.req.query("project_id");
    const sectionId = c.req.query("section_id");
    const dateFrom = c.req.query("date_from");
    const dateTo = c.req.query("date_to");
    const shift = c.req.query("shift");
    const page = Math.max(Number(c.req.query("page") ?? "1"), 1);
    const pageSize = Math.min(Math.max(Number(c.req.query("pageSize") ?? "20"), 1), 100);
    const offset = (page - 1) * pageSize;

    let sql = `SELECT ol.*, p.project_name, p.project_code, ps.section_code, ps.section_name
      FROM operator_log ol
      LEFT JOIN project p ON p.id = ol.project_id
      LEFT JOIN project_section ps ON ps.id = ol.section_id
      WHERE ol.status != 'deleted'`;
    let countSql = "SELECT COUNT(*) as total FROM operator_log ol WHERE ol.status != 'deleted'";
    const params: Array<string | number> = [];

    if (projectId) {
      sql += " AND ol.project_id = ?";
      countSql += " AND ol.project_id = ?";
      params.push(Number(projectId));
    }
    if (sectionId) {
      sql += " AND ol.section_id = ?";
      countSql += " AND ol.section_id = ?";
      params.push(Number(sectionId));
    }
    if (dateFrom) {
      sql += " AND ol.log_date >= ?";
      countSql += " AND ol.log_date >= ?";
      params.push(dateFrom);
    }
    if (dateTo) {
      sql += " AND ol.log_date <= ?";
      countSql += " AND ol.log_date <= ?";
      params.push(dateTo);
    }
    if (shift) {
      sql += " AND ol.shift = ?";
      countSql += " AND ol.shift = ?";
      params.push(shift);
    }

    sql +=
      " ORDER BY ol.log_date DESC, CASE ol.shift WHEN 'day' THEN 1 WHEN 'night' THEN 2 ELSE 3 END DESC, ol.id DESC LIMIT ? OFFSET ?";
    const rows = await c.env.DB.prepare(sql)
      .bind(...params, pageSize, offset)
      .all<OperatorLog>();
    const totalRow = await c.env.DB.prepare(countSql)
      .bind(...params)
      .first<{ total: number }>();

    const data = (rows.results ?? []).map((item) =>
      hydrateLegacyOperatorLog(item as unknown as Record<string, unknown>)
    );

    return c.json({
      success: true,
      data,
      pagination: { page, pageSize, total: totalRow?.total ?? 0 }
    });
  }
);

logRoutes.post(
  "/operator",
  requireRoles(["super_admin", "manager", "site_manager", "operator"]),
  async (c) => {
    const auth = c.get("auth");
    const body = (await c.req.json()) as OperatorLogInput;

    if (!body.project_id || !body.log_date?.trim() || !body.shift?.trim()) {
      return c.json(
        { success: false, error: { message: "project_id, log_date, shift are required" } },
        400
      );
    }

    const completed = Number(body.completed_pipe_count ?? 0);
    const footage = Number(body.footage_m ?? 0);
    const previous = await getPreviousProgress(
      c.env.DB,
      body.project_id,
      body.section_id ?? null,
      body.log_date,
      body.shift
    );
    const cumulative = Number(
      body.cumulative_pipe_count ?? previous.cumulative_pipe_count + completed
    );
    const cumulativeFootage = Number(
      body.cumulative_footage_m ?? previous.cumulative_footage_m + footage
    );

    const now = nowIso();
    const result = await c.env.DB.prepare(
      `INSERT INTO operator_log
        (project_id, section_id, log_date, shift, weather, completed_pipe_count, cumulative_pipe_count,
         footage_m, cumulative_footage_m, main_thrust_mpa, main_thrust_text, chamber_pressure_mpa,
         cutter_current_a, cutter_current_text, cutter_frequency_hz, soil_type,
         deviation_direction, deviation_value_mm, horizontal_deviation_direction,
         horizontal_deviation_mm, vertical_deviation_direction, vertical_deviation_mm,
         issue_summary, remark, operator_userid, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        body.project_id,
        body.section_id ?? null,
        body.log_date,
        body.shift,
        nullableText(body.weather),
        completed,
        cumulative,
        nullableNumber(body.footage_m),
        cumulativeFootage,
        nullableNumber(body.main_thrust_mpa),
        nullableText(body.main_thrust_text),
        nullableNumber(body.chamber_pressure_mpa),
        nullableNumber(body.cutter_current_a),
        nullableText(body.cutter_current_text),
        nullableNumber(body.cutter_frequency_hz),
        nullableText(body.soil_type),
        nullableText(body.deviation_direction),
        nullableNumber(body.deviation_value_mm),
        nullableText(body.horizontal_deviation_direction),
        nullableNumber(body.horizontal_deviation_mm),
        nullableText(body.vertical_deviation_direction),
        nullableNumber(body.vertical_deviation_mm),
        nullableText(body.issue_summary),
        nullableText(body.remark),
        auth.sub,
        body.status ?? "draft",
        now,
        now
      )
      .run();

    const id = Number(result.meta.last_row_id);
    await publishEvent(c.env, "OPERATOR_LOG_CREATED", "log.operator.create", {
      project_id: body.project_id,
      operator_log_id: id
    });

    return c.json({ success: true, data: { id } }, 201);
  }
);

logRoutes.get(
  "/operator/:id",
  requireRoles(["super_admin", "manager", "site_manager", "operator"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const row = await c.env.DB.prepare(
      "SELECT * FROM operator_log WHERE id = ? AND status != 'deleted'"
    )
      .bind(id)
      .first<OperatorLog>();
    if (!row) {
      return c.json({ success: false, error: { message: "Operator log not found" } }, 404);
    }
    return c.json({
      success: true,
      data: hydrateLegacyOperatorLog(row as unknown as Record<string, unknown>)
    });
  }
);

logRoutes.put(
  "/operator/:id",
  requireRoles(["super_admin", "manager", "site_manager", "operator"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const body = (await c.req.json()) as OperatorLogPatchInput;

    const existing = await c.env.DB.prepare(
      "SELECT * FROM operator_log WHERE id = ? AND status != 'deleted'"
    )
      .bind(id)
      .first<OperatorLog>();
    if (!existing) {
      return c.json({ success: false, error: { message: "Operator log not found" } }, 404);
    }

    const nextLogDate = body.log_date ?? existing.log_date;
    const nextShift = body.shift ?? existing.shift;
    const nextSectionId =
      body.section_id === undefined ? existing.section_id : (body.section_id ?? null);
    const nextCompleted = Number(body.completed_pipe_count ?? existing.completed_pipe_count);
    const nextFootage = Number(body.footage_m ?? existing.footage_m ?? 0);
    const previous = await getPreviousProgress(
      c.env.DB,
      existing.project_id,
      nextSectionId,
      nextLogDate,
      nextShift,
      id
    );
    const nextCumulative = Number(
      body.cumulative_pipe_count ?? previous.cumulative_pipe_count + nextCompleted
    );
    const nextCumulativeFootage = Number(
      body.cumulative_footage_m ?? previous.cumulative_footage_m + nextFootage
    );

    await c.env.DB.prepare(
      `UPDATE operator_log SET
         section_id = COALESCE(?, section_id),
         log_date = COALESCE(?, log_date),
         shift = COALESCE(?, shift),
         weather = COALESCE(?, weather),
         completed_pipe_count = ?,
         cumulative_pipe_count = ?,
         footage_m = COALESCE(?, footage_m),
         cumulative_footage_m = ?,
         main_thrust_mpa = COALESCE(?, main_thrust_mpa),
         main_thrust_text = COALESCE(?, main_thrust_text),
         chamber_pressure_mpa = COALESCE(?, chamber_pressure_mpa),
         cutter_current_a = COALESCE(?, cutter_current_a),
         cutter_current_text = COALESCE(?, cutter_current_text),
         cutter_frequency_hz = COALESCE(?, cutter_frequency_hz),
         soil_type = COALESCE(?, soil_type),
         deviation_direction = COALESCE(?, deviation_direction),
         deviation_value_mm = COALESCE(?, deviation_value_mm),
         horizontal_deviation_direction = COALESCE(?, horizontal_deviation_direction),
         horizontal_deviation_mm = COALESCE(?, horizontal_deviation_mm),
         vertical_deviation_direction = COALESCE(?, vertical_deviation_direction),
         vertical_deviation_mm = COALESCE(?, vertical_deviation_mm),
         issue_summary = COALESCE(?, issue_summary),
         remark = COALESCE(?, remark),
         status = COALESCE(?, status),
         updated_at = ?
       WHERE id = ?`
    )
      .bind(
        body.section_id ?? null,
        body.log_date ?? null,
        body.shift ?? null,
        nullableText(body.weather),
        nextCompleted,
        nextCumulative,
        nullableNumber(body.footage_m),
        nextCumulativeFootage,
        nullableNumber(body.main_thrust_mpa),
        nullableText(body.main_thrust_text),
        nullableNumber(body.chamber_pressure_mpa),
        nullableNumber(body.cutter_current_a),
        nullableText(body.cutter_current_text),
        nullableNumber(body.cutter_frequency_hz),
        nullableText(body.soil_type),
        nullableText(body.deviation_direction),
        nullableNumber(body.deviation_value_mm),
        nullableText(body.horizontal_deviation_direction),
        nullableNumber(body.horizontal_deviation_mm),
        nullableText(body.vertical_deviation_direction),
        nullableNumber(body.vertical_deviation_mm),
        nullableText(body.issue_summary),
        nullableText(body.remark),
        body.status ?? null,
        nowIso(),
        id
      )
      .run();

    await publishEvent(c.env, "OPERATOR_LOG_UPDATED", "log.operator.update", {
      project_id: existing.project_id,
      operator_log_id: id
    });

    return c.json({ success: true });
  }
);

logRoutes.delete(
  "/operator/:id",
  requireRoles(["super_admin", "manager", "site_manager"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    await c.env.DB.prepare(
      "UPDATE operator_log SET status = 'deleted', updated_at = ? WHERE id = ?"
    )
      .bind(nowIso(), id)
      .run();
    return c.json({ success: true });
  }
);

logRoutes.post(
  "/operator/smart-fill",
  requireRoles(["super_admin", "manager", "site_manager", "operator"]),
  async (c) => {
    const body = (await c.req.json()) as {
      project_id: number;
      section_id?: number | null;
      log_date: string;
      shift: string;
      completed_pipe_count?: number;
      footage_m?: number;
    };
    if (!body.project_id || !body.log_date?.trim() || !body.shift?.trim()) {
      return c.json(
        { success: false, error: { message: "project_id, log_date, shift are required" } },
        400
      );
    }

    let previousSql = "SELECT * FROM operator_log WHERE project_id = ? AND status != 'deleted'";
    const previousParams: Array<number> = [body.project_id];
    if (body.section_id) {
      previousSql += " AND section_id = ?";
      previousParams.push(body.section_id);
    }
    previousSql +=
      " ORDER BY log_date DESC, CASE shift WHEN 'day' THEN 1 WHEN 'night' THEN 2 ELSE 3 END DESC, id DESC LIMIT 1";

    const previous = await c.env.DB.prepare(previousSql)
      .bind(...previousParams)
      .first<OperatorLog>();

    const completed = Number(body.completed_pipe_count ?? 0);
    const footage = Number(body.footage_m ?? 0);
    const previousProgress = await getPreviousProgress(
      c.env.DB,
      body.project_id,
      body.section_id ?? null,
      body.log_date,
      body.shift
    );
    const cumulative = Number(previousProgress.cumulative_pipe_count + completed);
    const cumulativeFootage = Number(previousProgress.cumulative_footage_m + footage);

    const task = await createTask(c.env, {
      task_type: "log_smart_fill",
      biz_type: "operator_log",
      biz_id: body.project_id,
      payload: {
        project_id: body.project_id,
        section_id: body.section_id ?? null,
        log_date: body.log_date,
        shift: body.shift,
        previous_log: previous,
        completed_pipe_count: completed,
        cumulative_pipe_count: cumulative,
        footage_m: footage,
        cumulative_footage_m: cumulativeFootage
      },
      priority: 5
    });

    return c.json({
      success: true,
      data: {
        previous: previous
          ? hydrateLegacyOperatorLog(previous as unknown as Record<string, unknown>)
          : null,
        prefill: {
          weather: previous?.weather ?? "",
          issue_summary: previous?.issue_summary ?? "",
          cumulative_pipe_count: cumulative,
          cumulative_footage_m: cumulativeFootage
        },
        task_id: task.id
      }
    });
  }
);

logRoutes.get(
  "/manager",
  requireRoles(["super_admin", "manager", "site_manager", "operator"]),
  async (c) => {
    const projectId = c.req.query("project_id");
    const dateFrom = c.req.query("date_from");
    const dateTo = c.req.query("date_to");
    const page = Math.max(Number(c.req.query("page") ?? "1"), 1);
    const pageSize = Math.min(Math.max(Number(c.req.query("pageSize") ?? "20"), 1), 100);
    const offset = (page - 1) * pageSize;

    let sql = `SELECT ml.*, p.project_name, p.project_code
      FROM manager_log ml
      LEFT JOIN project p ON p.id = ml.project_id
      WHERE ml.status != 'deleted'`;
    let countSql = "SELECT COUNT(*) as total FROM manager_log ml WHERE ml.status != 'deleted'";
    const params: Array<string | number> = [];
    if (projectId) {
      sql += " AND ml.project_id = ?";
      countSql += " AND ml.project_id = ?";
      params.push(Number(projectId));
    }
    if (dateFrom) {
      sql += " AND ml.log_date >= ?";
      countSql += " AND ml.log_date >= ?";
      params.push(dateFrom);
    }
    if (dateTo) {
      sql += " AND ml.log_date <= ?";
      countSql += " AND ml.log_date <= ?";
      params.push(dateTo);
    }
    sql += " ORDER BY ml.log_date DESC, ml.id DESC LIMIT ? OFFSET ?";

    const rows = await c.env.DB.prepare(sql)
      .bind(...params, pageSize, offset)
      .all<ManagerLog>();
    const totalRow = await c.env.DB.prepare(countSql)
      .bind(...params)
      .first<{ total: number }>();

    const data = (rows.results ?? []).map((item) =>
      hydrateLegacyManagerLog(item as unknown as Record<string, unknown>)
    );

    return c.json({
      success: true,
      data,
      pagination: { page, pageSize, total: totalRow?.total ?? 0 }
    });
  }
);

logRoutes.post("/manager", requireRoles(["super_admin", "manager", "site_manager"]), async (c) => {
  const auth = c.get("auth");
  const body = (await c.req.json()) as {
    project_id: number;
    log_date: string;
    title?: string;
    detail_html?: string;
    risk_note?: string;
    status?: string;
    photos?: Array<{ file_key: string; caption?: string }>;
  };

  if (!body.project_id || !body.log_date?.trim()) {
    return c.json(
      { success: false, error: { message: "project_id and log_date are required" } },
      400
    );
  }

  const now = nowIso();
  const result = await c.env.DB.prepare(
    `INSERT INTO manager_log
        (project_id, log_date, title, detail_html, risk_note, manager_userid, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      body.project_id,
      body.log_date,
      body.title ?? null,
      body.detail_html ?? null,
      body.risk_note ?? null,
      auth.sub,
      body.status ?? "draft",
      now,
      now
    )
    .run();

  const id = Number(result.meta.last_row_id);
  if (Array.isArray(body.photos)) {
    let sortOrder = 0;
    for (const photo of body.photos) {
      if (!photo.file_key?.trim()) continue;
      await c.env.DB.prepare(
        `INSERT INTO manager_log_photo
            (manager_log_id, file_key, caption, sort_order, status, created_at)
           VALUES (?, ?, ?, ?, 'active', ?)`
      )
        .bind(id, photo.file_key, photo.caption ?? null, sortOrder, now)
        .run();
      sortOrder += 1;
    }
  }

  await publishEvent(c.env, "MANAGER_LOG_CREATED", "log.manager.create", {
    project_id: body.project_id,
    manager_log_id: id
  });

  return c.json({ success: true, data: { id } }, 201);
});

logRoutes.get(
  "/manager/:id",
  requireRoles(["super_admin", "manager", "site_manager", "operator"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const managerLog = await c.env.DB.prepare(
      "SELECT * FROM manager_log WHERE id = ? AND status != 'deleted'"
    )
      .bind(id)
      .first<ManagerLog>();
    if (!managerLog) {
      return c.json({ success: false, error: { message: "Manager log not found" } }, 404);
    }
    const photos = await c.env.DB.prepare(
      "SELECT * FROM manager_log_photo WHERE manager_log_id = ? AND status = 'active' ORDER BY sort_order ASC, id ASC"
    )
      .bind(id)
      .all<ManagerLogPhoto>();

    return c.json({
      success: true,
      data: {
        ...hydrateLegacyManagerLog(managerLog as unknown as Record<string, unknown>),
        photos: photos.results ?? []
      }
    });
  }
);

logRoutes.put(
  "/manager/:id",
  requireRoles(["super_admin", "manager", "site_manager"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const body = (await c.req.json()) as {
      log_date?: string;
      title?: string;
      detail_html?: string;
      risk_note?: string;
      status?: string;
      photos?: Array<{ file_key: string; caption?: string }>;
    };

    await c.env.DB.prepare(
      `UPDATE manager_log SET
         log_date = COALESCE(?, log_date),
         title = COALESCE(?, title),
         detail_html = COALESCE(?, detail_html),
         risk_note = COALESCE(?, risk_note),
         status = COALESCE(?, status),
         updated_at = ?
       WHERE id = ?`
    )
      .bind(
        body.log_date ?? null,
        body.title ?? null,
        body.detail_html ?? null,
        body.risk_note ?? null,
        body.status ?? null,
        nowIso(),
        id
      )
      .run();

    if (Array.isArray(body.photos)) {
      await c.env.DB.prepare(
        "UPDATE manager_log_photo SET status = 'deleted' WHERE manager_log_id = ?"
      )
        .bind(id)
        .run();
      let sortOrder = 0;
      for (const photo of body.photos) {
        if (!photo.file_key?.trim()) continue;
        await c.env.DB.prepare(
          `INSERT INTO manager_log_photo
            (manager_log_id, file_key, caption, sort_order, status, created_at)
           VALUES (?, ?, ?, ?, 'active', ?)`
        )
          .bind(id, photo.file_key, photo.caption ?? null, sortOrder, nowIso())
          .run();
        sortOrder += 1;
      }
    }

    const updatedLog = await c.env.DB.prepare("SELECT project_id FROM manager_log WHERE id = ?")
      .bind(id)
      .first<{ project_id: number }>();
    if (updatedLog) {
      await publishEvent(c.env, "MANAGER_LOG_UPDATED", "log.manager.update", {
        project_id: updatedLog.project_id,
        manager_log_id: id
      });
    }

    return c.json({ success: true });
  }
);

logRoutes.post(
  "/manager/:id/photo",
  requireRoles(["super_admin", "manager", "site_manager"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const body = (await c.req.json()) as { file_key: string; caption?: string };
    if (!body.file_key?.trim()) {
      return c.json({ success: false, error: { message: "file_key is required" } }, 400);
    }

    const maxOrder = await c.env.DB.prepare(
      "SELECT IFNULL(MAX(sort_order), -1) as max_order FROM manager_log_photo WHERE manager_log_id = ?"
    )
      .bind(id)
      .first<{ max_order: number }>();

    const result = await c.env.DB.prepare(
      `INSERT INTO manager_log_photo
        (manager_log_id, file_key, caption, sort_order, status, created_at)
       VALUES (?, ?, ?, ?, 'active', ?)`
    )
      .bind(id, body.file_key, body.caption ?? null, (maxOrder?.max_order ?? -1) + 1, nowIso())
      .run();

    return c.json({ success: true, data: { id: result.meta.last_row_id } }, 201);
  }
);

logRoutes.delete(
  "/manager/:id/photo/:photoId",
  requireRoles(["super_admin", "manager", "site_manager"]),
  async (c) => {
    const photoId = Number(c.req.param("photoId"));
    await c.env.DB.prepare("UPDATE manager_log_photo SET status = 'deleted' WHERE id = ?")
      .bind(photoId)
      .run();
    return c.json({ success: true });
  }
);

logRoutes.delete("/manager/:id", requireRoles(["super_admin", "manager"]), async (c) => {
  const id = Number(c.req.param("id"));
  await c.env.DB.prepare("UPDATE manager_log SET status = 'deleted', updated_at = ? WHERE id = ?")
    .bind(nowIso(), id)
    .run();
  await c.env.DB.prepare("UPDATE manager_log_photo SET status = 'deleted' WHERE manager_log_id = ?")
    .bind(id)
    .run();
  return c.json({ success: true });
});

logRoutes.post(
  "/summary/trigger",
  requireRoles(["super_admin", "manager", "site_manager"]),
  async (c) => {
    const body = (await c.req.json()) as {
      report_type: "daily" | "weekly";
      project_id?: number;
      date_from?: string;
      date_to?: string;
    };
    if (!body.report_type) {
      return c.json({ success: false, error: { message: "report_type is required" } }, 400);
    }

    const task = await createTask(c.env, {
      task_type: "log_summary",
      biz_type: "construction_log",
      biz_id: body.project_id ?? 0,
      payload: {
        report_type: body.report_type,
        project_id: body.project_id ?? null,
        date_from: body.date_from ?? null,
        date_to: body.date_to ?? null
      },
      priority: 5
    });

    return c.json({ success: true, data: { task_id: task.id } }, 201);
  }
);

logRoutes.get(
  "/dashboard",
  requireRoles(["super_admin", "manager", "site_manager", "operator"]),
  async (c) => {
    const projectId = c.req.query("project_id");
    const params: Array<string | number> = [];
    let where = "WHERE status != 'deleted'";
    if (projectId) {
      where += " AND project_id = ?";
      params.push(Number(projectId));
    }

    const totals = await c.env.DB.prepare(
      `SELECT
         COUNT(*) as operator_count,
         IFNULL(SUM(completed_pipe_count), 0) as completed_total,
         IFNULL(SUM(footage_m), 0) as footage_total
       FROM operator_log ${where}`
    )
      .bind(...params)
      .first<{ operator_count: number; completed_total: number; footage_total: number }>();

    const managerCount = await c.env.DB.prepare(
      `SELECT COUNT(*) as manager_count FROM manager_log ${where}`
    )
      .bind(...params)
      .first<{ manager_count: number }>();

    const trend = await c.env.DB.prepare(
      `SELECT log_date, IFNULL(SUM(completed_pipe_count), 0) as completed_pipe_count, IFNULL(SUM(footage_m), 0) as footage_m
       FROM operator_log ${where}
       GROUP BY log_date
       ORDER BY log_date DESC
       LIMIT 30`
    )
      .bind(...params)
      .all<{ log_date: string; completed_pipe_count: number; footage_m: number }>();

    return c.json({
      success: true,
      data: {
        operator_count: totals?.operator_count ?? 0,
        manager_count: managerCount?.manager_count ?? 0,
        completed_total: totals?.completed_total ?? 0,
        footage_total: totals?.footage_total ?? 0,
        trend: trend.results ?? []
      }
    });
  }
);

logRoutes.get(
  "/progress-alert",
  requireRoles(["super_admin", "manager", "site_manager", "operator"]),
  async (c) => {
    const targetDate = c.req.query("date") ?? new Date().toISOString().slice(0, 10);

    const rows = await c.env.DB.prepare(
      `SELECT p.id as project_id, p.project_name,
          IFNULL((SELECT SUM(IFNULL(ol.footage_m, 0)) FROM operator_log ol
                  WHERE ol.project_id = p.id AND ol.status != 'deleted' AND ol.log_date = ?), 0) as today_footage,
          IFNULL((SELECT AVG(day_sum) FROM (
                    SELECT SUM(IFNULL(ol2.footage_m, 0)) as day_sum
                    FROM operator_log ol2
                    WHERE ol2.project_id = p.id
                      AND ol2.status != 'deleted'
                      AND ol2.log_date < ?
                      AND ol2.log_date >= date(?, '-7 day')
                    GROUP BY ol2.log_date
                 )), 0) as avg_7d
       FROM project p
       WHERE p.status != 'archived'
       ORDER BY p.id DESC`
    )
      .bind(targetDate, targetDate, targetDate)
      .all<{ project_id: number; project_name: string; today_footage: number; avg_7d: number }>();

    const alerts = (rows.results ?? [])
      .map((item) => {
        const ratio = item.avg_7d > 0 ? item.today_footage / item.avg_7d : 1;
        const level = ratio < 0.4 ? "high" : ratio < 0.7 ? "medium" : "none";
        return {
          ...item,
          ratio,
          level,
          message:
            level === "high"
              ? "今日进度明显低于近7日均值"
              : level === "medium"
                ? "今日进度低于近7日均值"
                : "进度正常"
        };
      })
      .filter((item) => item.level !== "none");

    return c.json({ success: true, data: alerts });
  }
);
