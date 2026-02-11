import { Hono } from "hono";

import { authMiddleware, type AuthVariables } from "../middleware/auth";
import { requireRoles } from "../middleware/rbac";
import type { Env } from "../types/env";

type EntityRecord = {
  id: number;
  entity_code: string;
  entity_name: string;
  legal_person: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};

const nowIso = () => new Date().toISOString();

export const entityRoutes = new Hono<{
  Bindings: Env;
  Variables: AuthVariables;
}>();

entityRoutes.use("*", authMiddleware);

entityRoutes.get("/", async (c) => {
  const status = c.req.query("status");
  const keyword = c.req.query("keyword");

  let sql = "SELECT * FROM entity WHERE 1=1";
  const params: string[] = [];

  if (status) {
    sql += " AND status = ?";
    params.push(status);
  }
  if (keyword) {
    sql += " AND (entity_name LIKE ? OR entity_code LIKE ?)";
    params.push(`%${keyword}%`, `%${keyword}%`);
  }
  sql += " ORDER BY id DESC";

  const rows = await c.env.DB.prepare(sql)
    .bind(...params)
    .all<EntityRecord>();

  return c.json({
    success: true,
    data: rows.results ?? []
  });
});

entityRoutes.get("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const entity = await c.env.DB.prepare("SELECT * FROM entity WHERE id = ?")
    .bind(id)
    .first<EntityRecord>();

  if (!entity) {
    return c.json(
      {
        success: false,
        error: { message: "Entity not found" }
      },
      404
    );
  }

  return c.json({ success: true, data: entity });
});

entityRoutes.post("/", requireRoles(["super_admin", "manager"]), async (c) => {
  const body = (await c.req.json()) as {
    entity_code: string;
    entity_name: string;
    legal_person?: string;
    status?: string;
  };

  const createdAt = nowIso();
  const result = await c.env.DB.prepare(
    "INSERT INTO entity (entity_code, entity_name, legal_person, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
  )
    .bind(
      body.entity_code,
      body.entity_name,
      body.legal_person ?? null,
      body.status ?? "active",
      createdAt,
      createdAt
    )
    .run();

  return c.json({ success: true, data: { id: result.meta.last_row_id } }, 201);
});

entityRoutes.put("/:id", requireRoles(["super_admin", "manager"]), async (c) => {
  const id = Number(c.req.param("id"));
  const body = (await c.req.json()) as {
    entity_name?: string;
    legal_person?: string | null;
    status?: string;
  };

  await c.env.DB.prepare(
    "UPDATE entity SET entity_name = COALESCE(?, entity_name), legal_person = ?, status = COALESCE(?, status), updated_at = ? WHERE id = ?"
  )
    .bind(
      body.entity_name ?? null,
      body.legal_person ?? null,
      body.status ?? null,
      nowIso(),
      id
    )
    .run();

  return c.json({ success: true });
});

entityRoutes.delete("/:id", requireRoles(["super_admin", "manager"]), async (c) => {
  const id = Number(c.req.param("id"));
  await c.env.DB.prepare(
    "UPDATE entity SET status = 'deleted', updated_at = ? WHERE id = ?"
  )
    .bind(nowIso(), id)
    .run();

  return c.json({ success: true });
});

entityRoutes.get("/:id/bank-accounts", async (c) => {
  const entityId = Number(c.req.param("id"));
  const rows = await c.env.DB.prepare(
    "SELECT * FROM entity_bank_account WHERE entity_id = ? ORDER BY id DESC"
  )
    .bind(entityId)
    .all();

  return c.json({ success: true, data: rows.results ?? [] });
});

entityRoutes.post("/:id/bank-accounts", requireRoles(["super_admin", "manager"]), async (c) => {
  const entityId = Number(c.req.param("id"));
  const body = (await c.req.json()) as {
    bank_name: string;
    account_name: string;
    account_no: string;
    status?: string;
  };

  const createdAt = nowIso();
  const result = await c.env.DB.prepare(
    "INSERT INTO entity_bank_account (entity_id, bank_name, account_name, account_no, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(
      entityId,
      body.bank_name,
      body.account_name,
      body.account_no,
      body.status ?? "active",
      createdAt,
      createdAt
    )
    .run();

  return c.json({ success: true, data: { id: result.meta.last_row_id } }, 201);
});

entityRoutes.put(
  "/:id/bank-accounts/:accountId",
  requireRoles(["super_admin", "manager"]),
  async (c) => {
    const accountId = Number(c.req.param("accountId"));
    const body = (await c.req.json()) as {
      bank_name?: string;
      account_name?: string;
      account_no?: string;
      status?: string;
    };

    await c.env.DB.prepare(
      "UPDATE entity_bank_account SET bank_name = COALESCE(?, bank_name), account_name = COALESCE(?, account_name), account_no = COALESCE(?, account_no), status = COALESCE(?, status), updated_at = ? WHERE id = ?"
    )
      .bind(
        body.bank_name ?? null,
        body.account_name ?? null,
        body.account_no ?? null,
        body.status ?? null,
        nowIso(),
        accountId
      )
      .run();

    return c.json({ success: true });
  }
);

entityRoutes.delete(
  "/:id/bank-accounts/:accountId",
  requireRoles(["super_admin", "manager"]),
  async (c) => {
    const accountId = Number(c.req.param("accountId"));
    await c.env.DB.prepare(
      "UPDATE entity_bank_account SET status = 'deleted', updated_at = ? WHERE id = ?"
    )
      .bind(nowIso(), accountId)
      .run();

    return c.json({ success: true });
  }
);

entityRoutes.get("/:id/invoice-profiles", async (c) => {
  const entityId = Number(c.req.param("id"));
  const rows = await c.env.DB.prepare(
    "SELECT * FROM entity_invoice_profile WHERE entity_id = ? ORDER BY id DESC"
  )
    .bind(entityId)
    .all();

  return c.json({ success: true, data: rows.results ?? [] });
});

entityRoutes.post(
  "/:id/invoice-profiles",
  requireRoles(["super_admin", "manager"]),
  async (c) => {
    const entityId = Number(c.req.param("id"));
    const body = (await c.req.json()) as {
      invoice_title: string;
      tax_no: string;
      address?: string;
      phone?: string;
      bank_name?: string;
      bank_account?: string;
    };

    const createdAt = nowIso();
    const result = await c.env.DB.prepare(
      "INSERT INTO entity_invoice_profile (entity_id, invoice_title, tax_no, address, phone, bank_name, bank_account, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
      .bind(
        entityId,
        body.invoice_title,
        body.tax_no,
        body.address ?? null,
        body.phone ?? null,
        body.bank_name ?? null,
        body.bank_account ?? null,
        createdAt,
        createdAt
      )
      .run();

    return c.json({ success: true, data: { id: result.meta.last_row_id } }, 201);
  }
);

entityRoutes.put(
  "/:id/invoice-profiles/:profileId",
  requireRoles(["super_admin", "manager"]),
  async (c) => {
    const profileId = Number(c.req.param("profileId"));
    const body = (await c.req.json()) as {
      invoice_title?: string;
      tax_no?: string;
      address?: string;
      phone?: string;
      bank_name?: string;
      bank_account?: string;
    };

    await c.env.DB.prepare(
      "UPDATE entity_invoice_profile SET invoice_title = COALESCE(?, invoice_title), tax_no = COALESCE(?, tax_no), address = COALESCE(?, address), phone = COALESCE(?, phone), bank_name = COALESCE(?, bank_name), bank_account = COALESCE(?, bank_account), updated_at = ? WHERE id = ?"
    )
      .bind(
        body.invoice_title ?? null,
        body.tax_no ?? null,
        body.address ?? null,
        body.phone ?? null,
        body.bank_name ?? null,
        body.bank_account ?? null,
        nowIso(),
        profileId
      )
      .run();

    return c.json({ success: true });
  }
);

entityRoutes.delete(
  "/:id/invoice-profiles/:profileId",
  requireRoles(["super_admin", "manager"]),
  async (c) => {
    const profileId = Number(c.req.param("profileId"));
    await c.env.DB.prepare("DELETE FROM entity_invoice_profile WHERE id = ?")
      .bind(profileId)
      .run();

    return c.json({ success: true });
  }
);
