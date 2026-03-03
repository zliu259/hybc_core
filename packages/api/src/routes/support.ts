import { Hono } from "hono";

import { authMiddleware, type AuthVariables } from "../middleware/auth";
import { requireRoles } from "../middleware/rbac";
import type { Env } from "../types/env";

type SupportTicketStatus = "pending" | "resolved";
type SupportTicketCategory =
  | "account_issue"
  | "permission_missing"
  | "system_error"
  | "feature_suggestion"
  | "other";

const nowIso = () => new Date().toISOString();

const normalizeAttachments = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean)
    .slice(0, 10);
};

const ensureSupportTicketTable = async (env: Env): Promise<void> => {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS support_ticket (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      creator_id TEXT NOT NULL,
      category TEXT NOT NULL,
      description TEXT NOT NULL,
      attachments_json TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      reply TEXT,
      resolved_by TEXT,
      resolved_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`
  ).run();
  await env.DB.prepare(
    "CREATE INDEX IF NOT EXISTS idx_support_ticket_creator ON support_ticket(creator_id, created_at DESC)"
  ).run();
  await env.DB.prepare(
    "CREATE INDEX IF NOT EXISTS idx_support_ticket_status ON support_ticket(status, created_at DESC)"
  ).run();
};

export const supportRoutes = new Hono<{
  Bindings: Env;
  Variables: AuthVariables;
}>();

supportRoutes.use("*", authMiddleware);

supportRoutes.post("/tickets", async (c) => {
  await ensureSupportTicketTable(c.env);

  const auth = c.get("auth");
  const body = (await c.req.json().catch(() => ({}))) as {
    category?: SupportTicketCategory;
    description?: string;
    attachments?: string[];
  };

  const category = (body.category ?? "other") as SupportTicketCategory;
  const description = (body.description ?? "").trim();
  if (!description) {
    return c.json({ success: false, error: { message: "description is required" } }, 400);
  }

  const attachments = normalizeAttachments(body.attachments);
  const now = nowIso();
  const result = await c.env.DB.prepare(
    `INSERT INTO support_ticket (
      creator_id, category, description, attachments_json, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'pending', ?, ?)`
  )
    .bind(auth.sub, category, description, JSON.stringify(attachments), now, now)
    .run();

  const row = await c.env.DB.prepare(
    `SELECT id, category, description, attachments_json, status, reply, created_at, updated_at
     FROM support_ticket
     WHERE id = ?`
  )
    .bind(result.meta.last_row_id)
    .first<{
      id: number;
      category: SupportTicketCategory;
      description: string;
      attachments_json: string | null;
      status: SupportTicketStatus;
      reply: string | null;
      created_at: string;
      updated_at: string;
    }>();

  return c.json(
    {
      success: true,
      data: {
        id: row?.id,
        category: row?.category,
        description: row?.description,
        attachments: row?.attachments_json ? (JSON.parse(row.attachments_json) as string[]) : [],
        status: row?.status,
        reply: row?.reply ?? null,
        created_at: row?.created_at,
        updated_at: row?.updated_at
      }
    },
    201
  );
});

supportRoutes.get("/tickets", async (c) => {
  await ensureSupportTicketTable(c.env);

  const auth = c.get("auth");
  const creatorIdQuery = c.req.query("creator_id")?.trim();
  const statusQuery = c.req.query("status")?.trim();
  const categoryQuery = c.req.query("category")?.trim();

  const creatorId = creatorIdQuery === "me" ? auth.sub : creatorIdQuery;
  const where: string[] = [];
  const params: unknown[] = [];

  if (creatorId) {
    where.push("creator_id = ?");
    params.push(creatorId);
  }
  if (statusQuery) {
    where.push("status = ?");
    params.push(statusQuery);
  }
  if (categoryQuery) {
    where.push("category = ?");
    params.push(categoryQuery);
  }

  if (!creatorId && !auth.roles.includes("super_admin") && !auth.roles.includes("manager")) {
    where.push("creator_id = ?");
    params.push(auth.sub);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const rows = await c.env.DB.prepare(
    `SELECT id, category, description, attachments_json, status, reply, created_at, updated_at
     FROM support_ticket
     ${whereSql}
     ORDER BY id DESC
     LIMIT 200`
  )
    .bind(...params)
    .all<{
      id: number;
      category: SupportTicketCategory;
      description: string;
      attachments_json: string | null;
      status: SupportTicketStatus;
      reply: string | null;
      created_at: string;
      updated_at: string;
    }>();

  return c.json({
    success: true,
    data: (rows.results ?? []).map((item) => ({
      id: item.id,
      category: item.category,
      description: item.description,
      attachments: item.attachments_json ? (JSON.parse(item.attachments_json) as string[]) : [],
      status: item.status,
      reply: item.reply,
      created_at: item.created_at,
      updated_at: item.updated_at
    }))
  });
});

supportRoutes.get("/tickets/:id", async (c) => {
  await ensureSupportTicketTable(c.env);

  const auth = c.get("auth");
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id) || id <= 0) {
    return c.json({ success: false, error: { message: "invalid id" } }, 400);
  }

  const row = await c.env.DB.prepare(
    `SELECT id, creator_id, category, description, attachments_json, status, reply,
            resolved_by, resolved_at, created_at, updated_at
     FROM support_ticket
     WHERE id = ?`
  )
    .bind(id)
    .first<{
      id: number;
      creator_id: string;
      category: SupportTicketCategory;
      description: string;
      attachments_json: string | null;
      status: SupportTicketStatus;
      reply: string | null;
      resolved_by: string | null;
      resolved_at: string | null;
      created_at: string;
      updated_at: string;
    }>();

  if (!row) {
    return c.json({ success: false, error: { message: "ticket not found" } }, 404);
  }

  const isPrivileged = auth.roles.includes("super_admin") || auth.roles.includes("manager");
  if (!isPrivileged && row.creator_id !== auth.sub) {
    return c.json({ success: false, error: { message: "forbidden" } }, 403);
  }

  return c.json({
    success: true,
    data: {
      id: row.id,
      category: row.category,
      description: row.description,
      attachments: row.attachments_json ? (JSON.parse(row.attachments_json) as string[]) : [],
      status: row.status,
      reply: row.reply,
      resolved_by: row.resolved_by,
      resolved_at: row.resolved_at,
      created_at: row.created_at,
      updated_at: row.updated_at
    }
  });
});

supportRoutes.post(
  "/tickets/:id/resolve",
  requireRoles(["super_admin", "manager"]),
  async (c) => {
    await ensureSupportTicketTable(c.env);

    const auth = c.get("auth");
    const id = Number(c.req.param("id"));
    if (!Number.isFinite(id) || id <= 0) {
      return c.json({ success: false, error: { message: "invalid id" } }, 400);
    }

    const body = (await c.req.json().catch(() => ({}))) as {
      reply?: string;
      status?: SupportTicketStatus;
    };
    const reply = (body.reply ?? "").trim();
    if (!reply) {
      return c.json({ success: false, error: { message: "reply is required" } }, 400);
    }

    const now = nowIso();
    const nextStatus: SupportTicketStatus = body.status === "pending" ? "pending" : "resolved";
    const result = await c.env.DB.prepare(
      `UPDATE support_ticket
       SET reply = ?,
           status = ?,
           resolved_by = ?,
           resolved_at = ?,
           updated_at = ?
       WHERE id = ?`
    )
      .bind(reply, nextStatus, auth.sub, now, now, id)
      .run();

    if ((result.meta.changes ?? 0) === 0) {
      return c.json({ success: false, error: { message: "ticket not found" } }, 404);
    }

    return c.json({ success: true });
  }
);
