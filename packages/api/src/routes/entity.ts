import { Hono } from "hono";

import { authMiddleware, type AuthVariables } from "../middleware/auth";
import { requireRoles } from "../middleware/rbac";
import type { Env } from "../types/env";

type EntityRecord = {
  id: number;
  entity_code: string;
  entity_name: string;
  legal_person: string | null;
  tax_id: string | null;
  company_attribute: "self_owned" | "external" | "shareholder_personal";
  storage_quota_mb: number;
  storage_used_mb: number;
  primary_bank_name: string | null;
  primary_bank_branch_no: string | null;
  primary_bank_account_no: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};

type EntityAttachmentRecord = {
  id: number;
  entity_id: number;
  file_key: string;
  file_name: string;
  file_size: number | null;
  file_category: string;
  status: string;
  uploaded_by_userid: string;
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
  const legacyDataId = c.req.query("legacy_data_id");

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
  if (legacyDataId) {
    sql += " AND legacy_data_id = ?";
    params.push(legacyDataId);
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
    tax_id?: string;
    company_attribute?: "self_owned" | "external" | "shareholder_personal";
    storage_quota_mb?: number;
    primary_bank_name?: string;
    primary_bank_branch_no?: string;
    primary_bank_account_no?: string;
    status?: string;
  };

  const createdAt = nowIso();
  const result = await c.env.DB.prepare(
    `INSERT INTO entity (
      entity_code,
      entity_name,
      legal_person,
      tax_id,
      company_attribute,
      storage_quota_mb,
      primary_bank_name,
      primary_bank_branch_no,
      primary_bank_account_no,
      status,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      body.entity_code,
      body.entity_name,
      body.legal_person ?? null,
      body.tax_id ?? null,
      body.company_attribute ?? "self_owned",
      body.storage_quota_mb ?? 1024,
      body.primary_bank_name ?? null,
      body.primary_bank_branch_no ?? null,
      body.primary_bank_account_no ?? null,
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
    tax_id?: string | null;
    company_attribute?: "self_owned" | "external" | "shareholder_personal";
    storage_quota_mb?: number;
    storage_used_mb?: number;
    primary_bank_name?: string | null;
    primary_bank_branch_no?: string | null;
    primary_bank_account_no?: string | null;
    status?: string;
  };

  await c.env.DB.prepare(
    `UPDATE entity SET
      entity_name = COALESCE(?, entity_name),
      legal_person = ?,
      tax_id = ?,
      company_attribute = COALESCE(?, company_attribute),
      storage_quota_mb = COALESCE(?, storage_quota_mb),
      storage_used_mb = COALESCE(?, storage_used_mb),
      primary_bank_name = ?,
      primary_bank_branch_no = ?,
      primary_bank_account_no = ?,
      status = COALESCE(?, status),
      updated_at = ?
    WHERE id = ?`
  )
    .bind(
      body.entity_name ?? null,
      body.legal_person ?? null,
      body.tax_id ?? null,
      body.company_attribute ?? null,
      typeof body.storage_quota_mb === "number" ? body.storage_quota_mb : null,
      typeof body.storage_used_mb === "number" ? body.storage_used_mb : null,
      body.primary_bank_name ?? null,
      body.primary_bank_branch_no ?? null,
      body.primary_bank_account_no ?? null,
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
    bank_branch_no?: string;
    bank_line_no?: string;
    status?: string;
  };

  const createdAt = nowIso();
  const result = await c.env.DB.prepare(
    "INSERT INTO entity_bank_account (entity_id, bank_name, account_name, account_no, bank_branch_no, bank_line_no, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(
      entityId,
      body.bank_name,
      body.account_name,
      body.account_no,
      body.bank_branch_no ?? null,
      body.bank_line_no ?? null,
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
      bank_branch_no?: string;
      bank_line_no?: string;
      status?: string;
    };

    await c.env.DB.prepare(
      "UPDATE entity_bank_account SET bank_name = COALESCE(?, bank_name), account_name = COALESCE(?, account_name), account_no = COALESCE(?, account_no), bank_branch_no = COALESCE(?, bank_branch_no), bank_line_no = COALESCE(?, bank_line_no), status = COALESCE(?, status), updated_at = ? WHERE id = ?"
    )
      .bind(
        body.bank_name ?? null,
        body.account_name ?? null,
        body.account_no ?? null,
        body.bank_branch_no ?? null,
        body.bank_line_no ?? null,
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

entityRoutes.get("/:id/attachments", async (c) => {
  const entityId = Number(c.req.param("id"));
  const rows = await c.env.DB.prepare(
    "SELECT * FROM entity_attachment WHERE entity_id = ? AND status = 'active' ORDER BY id DESC"
  )
    .bind(entityId)
    .all<EntityAttachmentRecord>();

  return c.json({ success: true, data: rows.results ?? [] });
});

entityRoutes.post("/:id/attachments", requireRoles(["super_admin", "manager", "finance"]), async (c) => {
  const entityId = Number(c.req.param("id"));
  const auth = c.get("auth");
  const body = (await c.req.json()) as {
    file_key: string;
    file_name: string;
    file_size?: number;
    file_category?: string;
  };

  if (!body.file_key || !body.file_name) {
    return c.json(
      {
        success: false,
        error: { message: "file_key and file_name are required" }
      },
      400
    );
  }

  const createdAt = nowIso();
  const result = await c.env.DB.prepare(
    `INSERT INTO entity_attachment (
      entity_id,
      file_key,
      file_name,
      file_size,
      file_category,
      uploaded_by_userid,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      entityId,
      body.file_key,
      body.file_name,
      typeof body.file_size === "number" ? body.file_size : null,
      body.file_category ?? "business_license",
      auth.sub,
      createdAt,
      createdAt
    )
    .run();

  await c.env.DB.prepare(
    `UPDATE entity
     SET storage_used_mb = (
       SELECT CAST(IFNULL(SUM(file_size), 0) / 1024.0 / 1024.0 AS INTEGER)
       FROM entity_attachment
       WHERE entity_id = ? AND status = 'active'
     ),
     updated_at = ?
     WHERE id = ?`
  )
    .bind(entityId, createdAt, entityId)
    .run();

  return c.json({ success: true, data: { id: result.meta.last_row_id } }, 201);
});

entityRoutes.delete(
  "/:id/attachments/:attachmentId",
  requireRoles(["super_admin", "manager", "finance"]),
  async (c) => {
    const entityId = Number(c.req.param("id"));
    const attachmentId = Number(c.req.param("attachmentId"));

    await c.env.DB.prepare(
      "UPDATE entity_attachment SET status = 'deleted', updated_at = ? WHERE id = ?"
    )
      .bind(nowIso(), attachmentId)
      .run();

    await c.env.DB.prepare(
      `UPDATE entity
       SET storage_used_mb = (
         SELECT CAST(IFNULL(SUM(file_size), 0) / 1024.0 / 1024.0 AS INTEGER)
         FROM entity_attachment
         WHERE entity_id = ? AND status = 'active'
       ),
       updated_at = ?
       WHERE id = ?`
    )
      .bind(entityId, nowIso(), entityId)
      .run();

    return c.json({ success: true });
  }
);

entityRoutes.get("/:id/storage-summary", async (c) => {
  const entityId = Number(c.req.param("id"));
  const entity = await c.env.DB.prepare(
    "SELECT storage_quota_mb, storage_used_mb FROM entity WHERE id = ?"
  )
    .bind(entityId)
    .first<{ storage_quota_mb: number; storage_used_mb: number }>();

  if (!entity) {
    return c.json(
      {
        success: false,
        error: { message: "Entity not found" }
      },
      404
    );
  }

  const fileCount = await c.env.DB.prepare(
    "SELECT COUNT(*) as total FROM entity_attachment WHERE entity_id = ? AND status = 'active'"
  )
    .bind(entityId)
    .first<{ total: number }>();

  return c.json({
    success: true,
    data: {
      storage_quota_mb: entity.storage_quota_mb,
      storage_used_mb: entity.storage_used_mb,
      storage_remaining_mb: Math.max(entity.storage_quota_mb - entity.storage_used_mb, 0),
      active_attachment_count: fileCount?.total ?? 0
    }
  });
});

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
