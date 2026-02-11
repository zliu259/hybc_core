import { Hono } from "hono";

import { authMiddleware, type AuthVariables } from "../middleware/auth";
import { requireRoles } from "../middleware/rbac";
import type { Env } from "../types/env";

const nowIso = () => new Date().toISOString();

export const dictRoutes = new Hono<{
  Bindings: Env;
  Variables: AuthVariables;
}>();

dictRoutes.use("*", authMiddleware);

dictRoutes.get("/", async (c) => {
  const dictType = c.req.query("dict_type");

  if (dictType) {
    const rows = await c.env.DB.prepare(
      "SELECT * FROM sys_dict WHERE dict_type = ? ORDER BY sort_order ASC, id DESC"
    )
      .bind(dictType)
      .all();

    return c.json({ success: true, data: rows.results ?? [] });
  }

  const rows = await c.env.DB.prepare(
    "SELECT * FROM sys_dict ORDER BY dict_type ASC, sort_order ASC, id DESC"
  ).all<{
    id: number;
    dict_type: string;
    dict_label: string;
    dict_value: string;
    sort_order: number;
    status: string;
    created_at: string;
    updated_at: string;
  }>();

  const grouped = (rows.results ?? []).reduce<Record<string, typeof rows.results>>(
    (acc, item) => {
      if (!acc[item.dict_type]) {
        acc[item.dict_type] = [];
      }
      acc[item.dict_type]?.push(item);
      return acc;
    },
    {}
  );

  return c.json({ success: true, data: grouped });
});

dictRoutes.post("/", requireRoles(["super_admin", "manager"]), async (c) => {
  const body = (await c.req.json()) as {
    dict_type: string;
    dict_label: string;
    dict_value: string;
    sort_order?: number;
    status?: string;
  };

  const createdAt = nowIso();
  const result = await c.env.DB.prepare(
    "INSERT INTO sys_dict (dict_type, dict_label, dict_value, sort_order, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(
      body.dict_type,
      body.dict_label,
      body.dict_value,
      body.sort_order ?? 0,
      body.status ?? "active",
      createdAt,
      createdAt
    )
    .run();

  return c.json({ success: true, data: { id: result.meta.last_row_id } }, 201);
});

dictRoutes.put("/:id", requireRoles(["super_admin", "manager"]), async (c) => {
  const id = Number(c.req.param("id"));
  const body = (await c.req.json()) as {
    dict_label?: string;
    dict_value?: string;
    sort_order?: number;
    status?: string;
  };

  await c.env.DB.prepare(
    "UPDATE sys_dict SET dict_label = COALESCE(?, dict_label), dict_value = COALESCE(?, dict_value), sort_order = COALESCE(?, sort_order), status = COALESCE(?, status), updated_at = ? WHERE id = ?"
  )
    .bind(
      body.dict_label ?? null,
      body.dict_value ?? null,
      body.sort_order ?? null,
      body.status ?? null,
      nowIso(),
      id
    )
    .run();

  return c.json({ success: true });
});

dictRoutes.delete("/:id", requireRoles(["super_admin", "manager"]), async (c) => {
  const id = Number(c.req.param("id"));
  await c.env.DB.prepare("DELETE FROM sys_dict WHERE id = ?").bind(id).run();

  return c.json({ success: true });
});
