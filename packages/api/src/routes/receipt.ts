import { Hono } from "hono";

import { authMiddleware, type AuthVariables } from "../middleware/auth";
import { requireRoles } from "../middleware/rbac";
import { generateSerial } from "../services/serial";
import type { Env } from "../types/env";
import type { Contract } from "../types/contract";
import type {
  CreateInvoiceRequest,
  CreateReceiptRequest,
  Invoice,
  Receipt,
  UpdateInvoiceRequest,
  UpdateReceiptRequest
} from "../types/receipt";

const nowIso = () => new Date().toISOString();

export const receiptRoutes = new Hono<{
  Bindings: Env;
  Variables: AuthVariables;
}>();

receiptRoutes.use("*", authMiddleware);

receiptRoutes.get(
  "/invoice",
  requireRoles(["super_admin", "manager", "site_manager", "operator"]),
  async (c) => {
    const contractId = c.req.query("contract_id");
    const projectId = c.req.query("project_id");
    const status = c.req.query("status");
    const keyword = c.req.query("keyword");
    const page = Number(c.req.query("page") ?? "1");
    const pageSize = Number(c.req.query("pageSize") ?? "20");
    const offset = (page - 1) * pageSize;

    let sql = "SELECT * FROM invoice WHERE status != 'deleted'";
    let countSql = "SELECT COUNT(*) as total FROM invoice WHERE status != 'deleted'";
    const params: (string | number)[] = [];

    if (contractId) {
      sql += " AND contract_id = ?";
      countSql += " AND contract_id = ?";
      params.push(Number(contractId));
    }
    if (projectId) {
      sql += " AND project_id = ?";
      countSql += " AND project_id = ?";
      params.push(Number(projectId));
    }
    if (status) {
      sql += " AND status = ?";
      countSql += " AND status = ?";
      params.push(status);
    }
    if (keyword) {
      sql += " AND (invoice_no LIKE ? OR title LIKE ? OR IFNULL(tax_no, '') LIKE ? OR IFNULL(remark, '') LIKE ?)";
      countSql += " AND (invoice_no LIKE ? OR title LIKE ? OR IFNULL(tax_no, '') LIKE ? OR IFNULL(remark, '') LIKE ?)";
      params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
    }

    sql += " ORDER BY id DESC LIMIT ? OFFSET ?";

    const totalRow = await c.env.DB.prepare(countSql)
      .bind(...params)
      .first<{ total: number }>();
    const rows = await c.env.DB.prepare(sql)
      .bind(...params, pageSize, offset)
      .all<Invoice>();

    return c.json({
      success: true,
      data: rows.results ?? [],
      pagination: { page, pageSize, total: totalRow?.total ?? 0 }
    });
  }
);

receiptRoutes.post(
  "/invoice",
  requireRoles(["super_admin", "manager", "site_manager", "operator"]),
  async (c) => {
    const auth = c.get("auth");
    const body = (await c.req.json()) as CreateInvoiceRequest;

    if (!body.contract_id || body.contract_id <= 0) {
      return c.json({ success: false, error: { message: "contract_id is required" } }, 400);
    }
    if (!body.issue_date?.trim()) {
      return c.json({ success: false, error: { message: "issue_date is required" } }, 400);
    }
    if (!body.title?.trim()) {
      return c.json({ success: false, error: { message: "title is required" } }, 400);
    }
    if (!body.amount || body.amount <= 0) {
      return c.json({ success: false, error: { message: "amount must be > 0" } }, 400);
    }

    const contract = await c.env.DB.prepare("SELECT * FROM contract WHERE id = ? AND status != 'deleted'")
      .bind(body.contract_id)
      .first<Contract>();

    if (!contract) {
      return c.json({ success: false, error: { message: "Contract not found" } }, 404);
    }
    if (contract.direction !== "inbound") {
      return c.json({ success: false, error: { message: "Invoice can only bind inbound contract" } }, 400);
    }

    const sumRow = await c.env.DB.prepare(
      "SELECT IFNULL(SUM(amount), 0) as total FROM invoice WHERE contract_id = ? AND status != 'deleted'"
    )
      .bind(body.contract_id)
      .first<{ total: number }>();
    const existingTotal = sumRow?.total ?? 0;

    if (existingTotal + body.amount > contract.total_amount) {
      return c.json(
        {
          success: false,
          error: {
            message: `Invoiced overflow: existing ${existingTotal} + current ${body.amount} > contract ${contract.total_amount}`
          }
        },
        400
      );
    }

    const now = nowIso();
    const invoiceNo = await generateSerial(c.env.DB, "FP", "invoice", "invoice_no");

    const result = await c.env.DB.prepare(
      `INSERT INTO invoice
        (invoice_no, contract_id, project_id, issuer_userid, issue_date, amount, title,
         tax_no, file_key, status, remark, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'issued', ?, ?, ?)`
    )
      .bind(
        invoiceNo,
        contract.id,
        contract.project_id,
        auth.sub,
        body.issue_date,
        body.amount,
        body.title,
        body.tax_no ?? null,
        body.file_key ?? null,
        body.remark ?? null,
        now,
        now
      )
      .run();

    await c.env.DB.prepare(
      "UPDATE contract SET invoiced_amount = invoiced_amount + ?, updated_at = ? WHERE id = ?"
    )
      .bind(body.amount, now, contract.id)
      .run();

    return c.json({ success: true, data: { id: result.meta.last_row_id, invoice_no: invoiceNo } }, 201);
  }
);

receiptRoutes.put(
  "/invoice/:id",
  requireRoles(["super_admin", "manager", "site_manager", "operator"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const body = (await c.req.json()) as UpdateInvoiceRequest;

    const invoice = await c.env.DB.prepare("SELECT * FROM invoice WHERE id = ? AND status != 'deleted'")
      .bind(id)
      .first<Invoice>();
    if (!invoice) {
      return c.json({ success: false, error: { message: "Invoice not found" } }, 404);
    }

    const nextAmount = body.amount ?? invoice.amount;

    const contract = await c.env.DB.prepare("SELECT * FROM contract WHERE id = ? AND status != 'deleted'")
      .bind(invoice.contract_id)
      .first<Contract>();
    if (!contract) {
      return c.json({ success: false, error: { message: "Contract not found" } }, 404);
    }

    const others = await c.env.DB.prepare(
      "SELECT IFNULL(SUM(amount), 0) as total FROM invoice WHERE contract_id = ? AND status != 'deleted' AND id != ?"
    )
      .bind(invoice.contract_id, id)
      .first<{ total: number }>();
    const othersTotal = others?.total ?? 0;

    if (othersTotal + nextAmount > contract.total_amount) {
      return c.json(
        {
          success: false,
          error: {
            message: `Invoiced overflow: others ${othersTotal} + current ${nextAmount} > contract ${contract.total_amount}`
          }
        },
        400
      );
    }

    const now = nowIso();
    await c.env.DB.prepare(
      `UPDATE invoice SET
         issue_date = COALESCE(?, issue_date),
         amount = COALESCE(?, amount),
         title = COALESCE(?, title),
         tax_no = COALESCE(?, tax_no),
         file_key = COALESCE(?, file_key),
         status = COALESCE(?, status),
         remark = COALESCE(?, remark),
         updated_at = ?
       WHERE id = ?`
    )
      .bind(
        body.issue_date ?? null,
        body.amount ?? null,
        body.title ?? null,
        body.tax_no ?? null,
        body.file_key ?? null,
        body.status ?? null,
        body.remark ?? null,
        now,
        id
      )
      .run();

    const delta = nextAmount - invoice.amount;
    if (delta !== 0) {
      await c.env.DB.prepare(
        "UPDATE contract SET invoiced_amount = invoiced_amount + ?, updated_at = ? WHERE id = ?"
      )
        .bind(delta, now, contract.id)
        .run();
    }

    return c.json({ success: true });
  }
);

receiptRoutes.delete(
  "/invoice/:id",
  requireRoles(["super_admin", "manager"]),
  async (c) => {
    const id = Number(c.req.param("id"));

    const invoice = await c.env.DB.prepare("SELECT * FROM invoice WHERE id = ? AND status != 'deleted'")
      .bind(id)
      .first<Invoice>();
    if (!invoice) {
      return c.json({ success: false, error: { message: "Invoice not found" } }, 404);
    }

    const now = nowIso();
    await c.env.DB.prepare("UPDATE invoice SET status = 'deleted', updated_at = ? WHERE id = ?")
      .bind(now, id)
      .run();
    await c.env.DB.prepare(
      "UPDATE contract SET invoiced_amount = MAX(invoiced_amount - ?, 0), updated_at = ? WHERE id = ?"
    )
      .bind(invoice.amount, now, invoice.contract_id)
      .run();

    return c.json({ success: true });
  }
);

receiptRoutes.get(
  "/",
  requireRoles(["super_admin", "manager", "site_manager", "operator"]),
  async (c) => {
    const contractId = c.req.query("contract_id");
    const projectId = c.req.query("project_id");
    const invoiceId = c.req.query("invoice_id");
    const page = Number(c.req.query("page") ?? "1");
    const pageSize = Number(c.req.query("pageSize") ?? "20");
    const offset = (page - 1) * pageSize;

    let sql = "SELECT * FROM receipt WHERE status != 'deleted'";
    let countSql = "SELECT COUNT(*) as total FROM receipt WHERE status != 'deleted'";
    const params: (string | number)[] = [];

    if (contractId) {
      sql += " AND contract_id = ?";
      countSql += " AND contract_id = ?";
      params.push(Number(contractId));
    }
    if (projectId) {
      sql += " AND project_id = ?";
      countSql += " AND project_id = ?";
      params.push(Number(projectId));
    }
    if (invoiceId) {
      sql += " AND invoice_id = ?";
      countSql += " AND invoice_id = ?";
      params.push(Number(invoiceId));
    }

    sql += " ORDER BY id DESC LIMIT ? OFFSET ?";

    const totalRow = await c.env.DB.prepare(countSql)
      .bind(...params)
      .first<{ total: number }>();
    const rows = await c.env.DB.prepare(sql)
      .bind(...params, pageSize, offset)
      .all<Receipt>();

    return c.json({
      success: true,
      data: rows.results ?? [],
      pagination: { page, pageSize, total: totalRow?.total ?? 0 }
    });
  }
);

receiptRoutes.post(
  "/",
  requireRoles(["super_admin", "manager", "site_manager", "operator"]),
  async (c) => {
    const auth = c.get("auth");
    const body = (await c.req.json()) as CreateReceiptRequest;

    if (!body.contract_id || body.contract_id <= 0) {
      return c.json({ success: false, error: { message: "contract_id is required" } }, 400);
    }
    if (!body.received_date?.trim()) {
      return c.json({ success: false, error: { message: "received_date is required" } }, 400);
    }
    if (!body.amount || body.amount <= 0) {
      return c.json({ success: false, error: { message: "amount must be > 0" } }, 400);
    }

    const contract = await c.env.DB.prepare("SELECT * FROM contract WHERE id = ? AND status != 'deleted'")
      .bind(body.contract_id)
      .first<Contract>();
    if (!contract) {
      return c.json({ success: false, error: { message: "Contract not found" } }, 404);
    }
    if (contract.direction !== "inbound") {
      return c.json({ success: false, error: { message: "Receipt can only bind inbound contract" } }, 400);
    }

    if (contract.received_amount + body.amount > contract.total_amount) {
      return c.json(
        {
          success: false,
          error: {
            message: `Received overflow: existing ${contract.received_amount} + current ${body.amount} > contract ${contract.total_amount}`
          }
        },
        400
      );
    }

    if (body.invoice_id) {
      const invoice = await c.env.DB.prepare("SELECT * FROM invoice WHERE id = ? AND status != 'deleted'")
        .bind(body.invoice_id)
        .first<Invoice>();
      if (!invoice || invoice.contract_id !== contract.id) {
        return c.json({ success: false, error: { message: "invoice_id not valid for this contract" } }, 400);
      }

      const receivedOnInvoice = await c.env.DB.prepare(
        "SELECT IFNULL(SUM(amount), 0) as total FROM receipt WHERE invoice_id = ? AND status != 'deleted'"
      )
        .bind(body.invoice_id)
        .first<{ total: number }>();
      const invoiceReceived = receivedOnInvoice?.total ?? 0;
      if (invoiceReceived + body.amount > invoice.amount) {
        return c.json(
          {
            success: false,
            error: {
              message: `Receipt overflow for invoice: existing ${invoiceReceived} + current ${body.amount} > invoice ${invoice.amount}`
            }
          },
          400
        );
      }
    }

    const now = nowIso();
    const receiptNo = await generateSerial(c.env.DB, "SK", "receipt", "receipt_no");

    const result = await c.env.DB.prepare(
      `INSERT INTO receipt
        (receipt_no, contract_id, project_id, invoice_id, receiver_userid, received_date,
         amount, payment_account, status, remark, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'recorded', ?, ?, ?)`
    )
      .bind(
        receiptNo,
        contract.id,
        contract.project_id,
        body.invoice_id ?? null,
        auth.sub,
        body.received_date,
        body.amount,
        body.payment_account ?? null,
        body.remark ?? null,
        now,
        now
      )
      .run();

    await c.env.DB.prepare(
      "UPDATE contract SET received_amount = received_amount + ?, updated_at = ? WHERE id = ?"
    )
      .bind(body.amount, now, contract.id)
      .run();

    return c.json({ success: true, data: { id: result.meta.last_row_id, receipt_no: receiptNo } }, 201);
  }
);

receiptRoutes.put(
  "/:id",
  requireRoles(["super_admin", "manager", "site_manager", "operator"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const body = (await c.req.json()) as UpdateReceiptRequest;

    const oldReceipt = await c.env.DB.prepare("SELECT * FROM receipt WHERE id = ? AND status != 'deleted'")
      .bind(id)
      .first<Receipt>();
    if (!oldReceipt) {
      return c.json({ success: false, error: { message: "Receipt not found" } }, 404);
    }

    const contract = await c.env.DB.prepare("SELECT * FROM contract WHERE id = ? AND status != 'deleted'")
      .bind(oldReceipt.contract_id)
      .first<Contract>();
    if (!contract) {
      return c.json({ success: false, error: { message: "Contract not found" } }, 404);
    }

    const nextAmount = body.amount ?? oldReceipt.amount;
    const nextInvoiceId = body.invoice_id === undefined ? oldReceipt.invoice_id : body.invoice_id;

    const othersTotal = await c.env.DB.prepare(
      "SELECT IFNULL(SUM(amount), 0) as total FROM receipt WHERE contract_id = ? AND status != 'deleted' AND id != ?"
    )
      .bind(oldReceipt.contract_id, id)
      .first<{ total: number }>();
    const contractOthers = othersTotal?.total ?? 0;
    if (contractOthers + nextAmount > contract.total_amount) {
      return c.json(
        {
          success: false,
          error: {
            message: `Received overflow: others ${contractOthers} + current ${nextAmount} > contract ${contract.total_amount}`
          }
        },
        400
      );
    }

    if (nextInvoiceId) {
      const invoice = await c.env.DB.prepare("SELECT * FROM invoice WHERE id = ? AND status != 'deleted'")
        .bind(nextInvoiceId)
        .first<Invoice>();
      if (!invoice || invoice.contract_id !== contract.id) {
        return c.json({ success: false, error: { message: "invoice_id not valid for this contract" } }, 400);
      }

      const invoiceOthers = await c.env.DB.prepare(
        "SELECT IFNULL(SUM(amount), 0) as total FROM receipt WHERE invoice_id = ? AND status != 'deleted' AND id != ?"
      )
        .bind(nextInvoiceId, id)
        .first<{ total: number }>();
      const invoiceOtherTotal = invoiceOthers?.total ?? 0;

      if (invoiceOtherTotal + nextAmount > invoice.amount) {
        return c.json(
          {
            success: false,
            error: {
              message: `Receipt overflow for invoice: others ${invoiceOtherTotal} + current ${nextAmount} > invoice ${invoice.amount}`
            }
          },
          400
        );
      }
    }

    const now = nowIso();

    await c.env.DB.prepare(
      `UPDATE receipt SET
         invoice_id = ?,
         received_date = COALESCE(?, received_date),
         amount = COALESCE(?, amount),
         payment_account = COALESCE(?, payment_account),
         status = COALESCE(?, status),
         remark = COALESCE(?, remark),
         updated_at = ?
       WHERE id = ?`
    )
      .bind(
        nextInvoiceId ?? null,
        body.received_date ?? null,
        body.amount ?? null,
        body.payment_account ?? null,
        body.status ?? null,
        body.remark ?? null,
        now,
        id
      )
      .run();

    const delta = nextAmount - oldReceipt.amount;
    if (delta !== 0) {
      await c.env.DB.prepare(
        "UPDATE contract SET received_amount = received_amount + ?, updated_at = ? WHERE id = ?"
      )
        .bind(delta, now, oldReceipt.contract_id)
        .run();
    }

    return c.json({ success: true });
  }
);

receiptRoutes.delete(
  "/:id",
  requireRoles(["super_admin", "manager"]),
  async (c) => {
    const id = Number(c.req.param("id"));

    const oldReceipt = await c.env.DB.prepare("SELECT * FROM receipt WHERE id = ? AND status != 'deleted'")
      .bind(id)
      .first<Receipt>();
    if (!oldReceipt) {
      return c.json({ success: false, error: { message: "Receipt not found" } }, 404);
    }

    const now = nowIso();
    await c.env.DB.prepare("UPDATE receipt SET status = 'deleted', updated_at = ? WHERE id = ?")
      .bind(now, id)
      .run();
    await c.env.DB.prepare(
      "UPDATE contract SET received_amount = MAX(received_amount - ?, 0), updated_at = ? WHERE id = ?"
    )
      .bind(oldReceipt.amount, now, oldReceipt.contract_id)
      .run();

    return c.json({ success: true });
  }
);
