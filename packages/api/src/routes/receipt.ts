import { Hono } from "hono";

import { authMiddleware, type AuthVariables } from "../middleware/auth";
import { requireRoles } from "../middleware/rbac";
import { createAiGateHandler, createTask } from "../services/ai-slot";
import { submitForApproval } from "../services/approval/engine";
import { generateSerial } from "../services/serial";
import type { Env } from "../types/env";
import type { Contract } from "../types/contract";
import type {
  CreateInvoiceRequestPayload,
  CreateInvoiceRequest,
  InvoiceRequest,
  IssueInvoiceFromRequestPayload,
  TriggerInvoiceVerifyPayload,
  UpdateInvoiceRequestPayload,
  CreateReceiptRequest,
  Invoice,
  Receipt,
  UpdateInvoiceRequest,
  UpdateReceiptRequest
} from "../types/receipt";

const nowIso = () => new Date().toISOString();

const parseTaskResult = (resultJson: string | null): Record<string, unknown> | null => {
  if (!resultJson) return null;
  try {
    const raw = JSON.parse(resultJson) as { output?: string } & Record<string, unknown>;
    if (typeof raw.output === "string") {
      return JSON.parse(raw.output) as Record<string, unknown>;
    }
    return raw;
  } catch {
    return null;
  }
};

const parseInvoiceItems = (raw: string): Array<Record<string, unknown>> => {
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("items_json must be a non-empty array");
  }
  return parsed.filter((item): item is Record<string, unknown> => !!item && typeof item === "object");
};

const parseJsonObject = (raw: string | null | undefined): Record<string, unknown> => {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
};

const INVOICE_REQUEST_TEMPLATE_CODE = "TPL-INVOICE-REQUEST";
const INVOICE_REQUEST_TEMPLATE_NAME = "开票申请审批模板";
const INVOICE_REQUEST_TEMPLATE_CONFIG =
  '{"version":1,"start_key":"dept_review","nodes":[{"key":"dept_review","type":"sequential","name":"部门负责人审批","assignee_userids":["site_manager"],"next_key":"finance_review"},{"key":"finance_review","type":"sequential","name":"财务复核","assignee_userids":["finance_manager"],"conditions":[{"field":"amount","operator":"gt","value":500000,"next_key":"gm_approve"}],"default_next_key":"archive_cc"},{"key":"gm_approve","type":"sequential","name":"总经理审批","assignee_userids":["general_manager"],"next_key":"archive_cc"},{"key":"archive_cc","type":"cc","name":"抄送归档","assignee_userids":["manager"],"next_key":null}]}'
;

const ensureInvoiceRequestTemplate = async (env: Env) => {
  const now = nowIso();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO approval_template
      (template_code, template_name, biz_type, config_json, status, created_by, created_at, updated_at)
     VALUES (?, ?, 'invoice_request', ?, 'active', 'system', ?, ?)`
  )
    .bind(INVOICE_REQUEST_TEMPLATE_CODE, INVOICE_REQUEST_TEMPLATE_NAME, INVOICE_REQUEST_TEMPLATE_CONFIG, now, now)
    .run();

  await env.DB.prepare(
    "UPDATE approval_template SET status = 'active', updated_at = ? WHERE biz_type = 'invoice_request' AND status != 'deleted'"
  )
    .bind(now)
    .run();
};

export const receiptRoutes = new Hono<{
  Bindings: Env;
  Variables: AuthVariables;
}>();

receiptRoutes.use("*", authMiddleware);

receiptRoutes.get(
  "/invoice-request",
  requireRoles(["super_admin", "manager", "site_manager", "finance", "operator"]),
  async (c) => {
    const contractId = c.req.query("contract_id");
    const projectId = c.req.query("project_id");
    const status = c.req.query("status");
    const keyword = c.req.query("keyword");
    const page = Number(c.req.query("page") ?? "1");
    const pageSize = Number(c.req.query("pageSize") ?? "20");
    const offset = (page - 1) * pageSize;

    let sql = "SELECT * FROM invoice_request WHERE status != 'cancelled'";
    let countSql = "SELECT COUNT(*) as total FROM invoice_request WHERE status != 'cancelled'";
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
      sql +=
        " AND (request_no LIKE ? OR customer_name LIKE ? OR customer_tax_no LIKE ? OR IFNULL(payment_reference, '') LIKE ? OR IFNULL(remark, '') LIKE ?)";
      countSql +=
        " AND (request_no LIKE ? OR customer_name LIKE ? OR customer_tax_no LIKE ? OR IFNULL(payment_reference, '') LIKE ? OR IFNULL(remark, '') LIKE ?)";
      params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
    }

    sql += " ORDER BY id DESC LIMIT ? OFFSET ?";

    const totalRow = await c.env.DB.prepare(countSql)
      .bind(...params)
      .first<{ total: number }>();
    const rows = await c.env.DB.prepare(sql)
      .bind(...params, pageSize, offset)
      .all<InvoiceRequest>();

    return c.json({
      success: true,
      data: rows.results ?? [],
      pagination: { page, pageSize, total: totalRow?.total ?? 0 }
    });
  }
);

receiptRoutes.get(
  "/invoice-request/:id",
  requireRoles(["super_admin", "manager", "site_manager", "finance", "operator"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const row = await c.env.DB.prepare("SELECT * FROM invoice_request WHERE id = ?")
      .bind(id)
      .first<InvoiceRequest>();
    if (!row) {
      return c.json({ success: false, error: { message: "Invoice request not found" } }, 404);
    }
    return c.json({ success: true, data: row });
  }
);

receiptRoutes.post(
  "/invoice-request",
  requireRoles(["super_admin", "manager", "site_manager", "finance", "operator"]),
  async (c) => {
    const auth = c.get("auth");
    const body = (await c.req.json()) as CreateInvoiceRequestPayload;

    if (!body.contract_id || body.contract_id <= 0) {
      return c.json({ success: false, error: { message: "contract_id is required" } }, 400);
    }
    const counterpartyName = (body.counterparty_name ?? body.customer_name ?? "").trim();
    const counterpartyTaxNo = (body.counterparty_tax_no ?? body.customer_tax_no ?? "").trim();
    if (!counterpartyName || !counterpartyTaxNo) {
      return c.json({ success: false, error: { message: "counterparty_name and counterparty_tax_no are required" } }, 400);
    }
    if (!body.invoice_type || !body.invoice_category?.trim()) {
      return c.json({ success: false, error: { message: "invoice_type and invoice_category are required" } }, 400);
    }
    if (!Number.isFinite(body.tax_rate) || body.tax_rate < 0) {
      return c.json({ success: false, error: { message: "tax_rate must be >= 0" } }, 400);
    }
    if (!Number.isFinite(body.amount_without_tax) || body.amount_without_tax <= 0) {
      return c.json({ success: false, error: { message: "amount_without_tax must be > 0" } }, 400);
    }
    if (!Number.isFinite(body.tax_amount_estimated) || body.tax_amount_estimated < 0) {
      return c.json({ success: false, error: { message: "tax_amount_estimated must be >= 0" } }, 400);
    }
    if (!Number.isFinite(body.amount_with_tax) || body.amount_with_tax <= 0) {
      return c.json({ success: false, error: { message: "amount_with_tax must be > 0" } }, 400);
    }

    try {
      parseInvoiceItems(body.items_json);
    } catch (error) {
      return c.json(
        { success: false, error: { message: error instanceof Error ? error.message : "items_json invalid" } },
        400
      );
    }

    const contract = await c.env.DB.prepare("SELECT * FROM contract WHERE id = ? AND status != 'deleted'")
      .bind(body.contract_id)
      .first<Contract>();
    if (!contract) {
      return c.json({ success: false, error: { message: "Contract not found" } }, 404);
    }
    if (contract.direction !== "inbound") {
      return c.json({ success: false, error: { message: "Invoice request can only bind inbound contract" } }, 400);
    }

    const projectId = body.project_id && body.project_id > 0 ? body.project_id : contract.project_id;
    const buyerRaw = parseJsonObject(body.buyer_json ?? null);
    const buyerJson = JSON.stringify({
      ...buyerRaw,
      counterparty_name: counterpartyName,
      counterparty_tax_no: counterpartyTaxNo,
      counterparty_contact: body.counterparty_contact ?? buyerRaw.counterparty_contact ?? null,
      seller_entity_id: body.seller_entity_id ?? buyerRaw.seller_entity_id ?? contract.entity_id,
      seller_entity_name: body.seller_entity_name ?? buyerRaw.seller_entity_name ?? null
    });

    const now = nowIso();
    const requestNo = await generateSerial(c.env.DB, "KP", "invoice_request", "request_no");
    const result = await c.env.DB.prepare(
      `INSERT INTO invoice_request
        (request_no, contract_id, project_id, customer_name, customer_tax_no, buyer_json,
         invoice_type, invoice_category, tax_rate, currency, items_json,
         amount_without_tax, tax_amount_estimated, amount_with_tax,
         business_contract_no, payment_reference,
         applicant_userid, status, attachments_json, remark, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`
    )
      .bind(
        requestNo,
        contract.id,
        projectId,
        counterpartyName,
        counterpartyTaxNo,
        buyerJson,
        body.invoice_type,
        body.invoice_category.trim(),
        body.tax_rate,
        body.currency ?? "CNY",
        body.items_json,
        body.amount_without_tax,
        body.tax_amount_estimated,
        body.amount_with_tax,
        body.business_contract_no ?? contract.contract_no,
        body.payment_reference ?? null,
        auth.sub,
        body.attachments_json ?? null,
        body.remark ?? null,
        now,
        now
      )
      .run();

    return c.json({ success: true, data: { id: result.meta.last_row_id, request_no: requestNo } }, 201);
  }
);

receiptRoutes.put(
  "/invoice-request/:id",
  requireRoles(["super_admin", "manager", "site_manager", "finance", "operator"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const body = (await c.req.json()) as UpdateInvoiceRequestPayload;

    const existing = await c.env.DB.prepare("SELECT * FROM invoice_request WHERE id = ?")
      .bind(id)
      .first<InvoiceRequest>();
    if (!existing) {
      return c.json({ success: false, error: { message: "Invoice request not found" } }, 404);
    }

    const editableStates = new Set(["draft", "rejected"]);
    if (!editableStates.has(existing.status) && body.status === undefined) {
      return c.json({ success: false, error: { message: `Request in status ${existing.status} cannot be edited` } }, 400);
    }

    if (body.items_json) {
      try {
        parseInvoiceItems(body.items_json);
      } catch (error) {
        return c.json(
          { success: false, error: { message: error instanceof Error ? error.message : "items_json invalid" } },
          400
        );
      }
    }

    const mergedName = (body.counterparty_name ?? body.customer_name ?? existing.customer_name).trim();
    const mergedTaxNo = (body.counterparty_tax_no ?? body.customer_tax_no ?? existing.customer_tax_no).trim();
    const existingBuyer = parseJsonObject(existing.buyer_json);
    const nextBuyer = {
      ...existingBuyer,
      ...parseJsonObject(body.buyer_json ?? null),
      counterparty_name: mergedName,
      counterparty_tax_no: mergedTaxNo,
      counterparty_contact:
        body.counterparty_contact ?? existingBuyer.counterparty_contact ?? null,
      seller_entity_id: body.seller_entity_id ?? existingBuyer.seller_entity_id ?? null,
      seller_entity_name: body.seller_entity_name ?? existingBuyer.seller_entity_name ?? null
    };

    const now = nowIso();
    await c.env.DB.prepare(
      `UPDATE invoice_request SET
         project_id = COALESCE(?, project_id),
         customer_name = ?,
         customer_tax_no = ?,
         buyer_json = ?,
         invoice_type = COALESCE(?, invoice_type),
         invoice_category = COALESCE(?, invoice_category),
         tax_rate = COALESCE(?, tax_rate),
         currency = COALESCE(?, currency),
         items_json = COALESCE(?, items_json),
         amount_without_tax = COALESCE(?, amount_without_tax),
         tax_amount_estimated = COALESCE(?, tax_amount_estimated),
         amount_with_tax = COALESCE(?, amount_with_tax),
         business_contract_no = COALESCE(?, business_contract_no),
         payment_reference = COALESCE(?, payment_reference),
         status = COALESCE(?, status),
         review_comment = COALESCE(?, review_comment),
         attachments_json = COALESCE(?, attachments_json),
         remark = COALESCE(?, remark),
         updated_at = ?
       WHERE id = ?`
    )
      .bind(
        body.project_id ?? null,
        mergedName,
        mergedTaxNo,
        JSON.stringify(nextBuyer),
        body.invoice_type ?? null,
        body.invoice_category?.trim() ?? null,
        body.tax_rate ?? null,
        body.currency ?? null,
        body.items_json ?? null,
        body.amount_without_tax ?? null,
        body.tax_amount_estimated ?? null,
        body.amount_with_tax ?? null,
        body.business_contract_no ?? null,
        body.payment_reference ?? null,
        body.status ?? null,
        body.review_comment ?? null,
        body.attachments_json ?? null,
        body.remark ?? null,
        now,
        id
      )
      .run();

    return c.json({ success: true });
  }
);

receiptRoutes.post(
  "/invoice-request/:id/submit-approval",
  requireRoles(["super_admin", "manager", "site_manager", "finance", "operator"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const auth = c.get("auth");
    const body = (await c.req.json().catch(() => ({}))) as { biz_summary?: string };

    const request = await c.env.DB.prepare("SELECT * FROM invoice_request WHERE id = ?")
      .bind(id)
      .first<InvoiceRequest>();
    if (!request) {
      return c.json({ success: false, error: { message: "Invoice request not found" } }, 404);
    }
    if (!["draft", "rejected"].includes(request.status)) {
      return c.json(
        { success: false, error: { message: `Only draft/rejected request can submit, current=${request.status}` } },
        400
      );
    }

    const contract = await c.env.DB.prepare("SELECT * FROM contract WHERE id = ? AND status != 'deleted'")
      .bind(request.contract_id)
      .first<Contract>();
    if (!contract) {
      return c.json({ success: false, error: { message: "Contract not found" } }, 404);
    }

    const summary =
      body.biz_summary?.trim() ||
      `${request.request_no} | ${request.customer_name} | ${request.amount_with_tax}`;

    await ensureInvoiceRequestTemplate(c.env);

    const instance = await submitForApproval(
      c.env,
      {
        biz_type: "invoice_request",
        biz_id: id,
        biz_summary: summary,
        context: {
          amount: request.amount_with_tax,
          project_id: request.project_id,
          contract_id: request.contract_id,
          counterparty_name: request.customer_name,
          counterparty_tax_no: request.customer_tax_no,
          invoice_type: request.invoice_type,
          invoice_category: request.invoice_category,
          tax_rate: request.tax_rate,
          request_no: request.request_no,
          attachments_json: request.attachments_json,
          payment_reference: request.payment_reference,
          buyer_json: request.buyer_json,
          contract: {
            contract_no: contract.contract_no,
            counterparty: contract.counterparty,
            total_amount: contract.total_amount
          }
        }
      },
      auth.sub,
      createAiGateHandler()
    );

    await c.env.DB.prepare(
      "UPDATE invoice_request SET status = 'pending_approval', approval_instance_id = ?, updated_at = ? WHERE id = ?"
    )
      .bind(instance.id, nowIso(), id)
      .run();

    return c.json({
      success: true,
      data: { approval_instance_id: instance.id, instance_no: instance.instance_no }
    });
  }
);

receiptRoutes.post(
  "/invoice-request/:id/issue",
  requireRoles(["super_admin", "manager", "finance"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const auth = c.get("auth");
    const body = (await c.req.json()) as IssueInvoiceFromRequestPayload;

    if (!body.file_key?.trim()) {
      return c.json({ success: false, error: { message: "file_key is required" } }, 400);
    }

    const request = await c.env.DB.prepare("SELECT * FROM invoice_request WHERE id = ?")
      .bind(id)
      .first<InvoiceRequest>();
    if (!request) {
      return c.json({ success: false, error: { message: "Invoice request not found" } }, 404);
    }
    if (!["approved", "ready_to_issue"].includes(request.status)) {
      return c.json(
        { success: false, error: { message: `Only approved/ready_to_issue request can issue, current=${request.status}` } },
        400
      );
    }
    if (request.issued_invoice_id) {
      return c.json({ success: false, error: { message: "Request already issued" } }, 400);
    }

    const contract = await c.env.DB.prepare("SELECT * FROM contract WHERE id = ? AND status != 'deleted'")
      .bind(request.contract_id)
      .first<Contract>();
    if (!contract) {
      return c.json({ success: false, error: { message: "Contract not found" } }, 404);
    }

    const sumRow = await c.env.DB.prepare(
      "SELECT IFNULL(SUM(amount), 0) as total FROM invoice WHERE contract_id = ? AND status != 'deleted'"
    )
      .bind(request.contract_id)
      .first<{ total: number }>();
    const existingTotal = sumRow?.total ?? 0;

    if (existingTotal + request.amount_with_tax > contract.total_amount) {
      return c.json(
        {
          success: false,
          error: {
            message: `Invoiced overflow: existing ${existingTotal} + current ${request.amount_with_tax} > contract ${contract.total_amount}`
          }
        },
        400
      );
    }

    const now = nowIso();
    const fallbackIssueDate = now.slice(0, 10);
    const invoiceNo = await generateSerial(c.env.DB, "FP", "invoice", "invoice_no");
    const result = await c.env.DB.prepare(
      `INSERT INTO invoice
        (invoice_no, invoice_request_id, contract_id, project_id, issuer_userid, issue_date, amount, title,
         tax_no, file_key, invoice_code, invoice_number, check_code, tax_amount, amount_with_tax,
         pdf_file_key, ofd_file_key, xml_file_key, qr_code,
         status, invoice_status_detail, payment_status, send_status, verification_status, remark, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'issued', 'normal', 'unpaid', 'unsent', 'none', ?, ?, ?)`
    )
      .bind(
        invoiceNo,
        request.id,
        request.contract_id,
        request.project_id,
        auth.sub,
        fallbackIssueDate,
        request.amount_without_tax,
        request.customer_name,
        request.customer_tax_no,
        body.file_key.trim(),
        null,
        null,
        null,
        request.tax_amount_estimated,
        request.amount_with_tax,
        body.pdf_file_key ?? null,
        body.ofd_file_key ?? null,
        body.xml_file_key ?? null,
        null,
        body.remark ?? request.remark ?? null,
        now,
        now
      )
      .run();

    const invoiceId = Number(result.meta.last_row_id);
    const verifyTask = await createTask(c.env, {
      task_type: "ocr_extract",
      biz_type: "receipt_invoice",
      biz_id: invoiceId,
      priority: 4,
      payload: {
        invoice_id: invoiceId,
        file_key: body.file_key.trim(),
        expected_invoice_no: null,
        expected_issue_date: null,
        expected_amount: request.amount_with_tax
      },
      timeout_seconds: 300
    });

    await c.env.DB.prepare(
      "UPDATE invoice SET verification_status = 'pending', verification_task_id = ?, updated_at = ? WHERE id = ?"
    )
      .bind(verifyTask.id, now, invoiceId)
      .run();

    await c.env.DB.prepare(
      "UPDATE invoice_request SET status = 'issued', issued_invoice_id = ?, updated_at = ? WHERE id = ?"
    )
      .bind(invoiceId, now, request.id)
      .run();

    await c.env.DB.prepare(
      "UPDATE contract SET invoiced_amount = invoiced_amount + ?, updated_at = ? WHERE id = ?"
    )
      .bind(request.amount_without_tax, now, request.contract_id)
      .run();

    return c.json(
      {
        success: true,
        data: { id: invoiceId, invoice_no: invoiceNo, verification_task_id: verifyTask.id }
      },
      201
    );
  }
);

receiptRoutes.get(
  "/invoice",
  requireRoles(["super_admin", "manager", "site_manager", "finance", "operator"]),
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
  requireRoles(["super_admin", "manager", "site_manager", "finance", "operator"]),
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
  requireRoles(["super_admin", "manager", "site_manager", "finance", "operator"]),
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

receiptRoutes.post(
  "/invoice/:id/trigger-verify",
  requireRoles(["super_admin", "manager", "site_manager", "finance", "operator"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const body = (await c.req.json().catch(() => ({}))) as TriggerInvoiceVerifyPayload;

    const invoice = await c.env.DB.prepare("SELECT * FROM invoice WHERE id = ? AND status != 'deleted'")
      .bind(id)
      .first<Invoice>();
    if (!invoice) {
      return c.json({ success: false, error: { message: "Invoice not found" } }, 404);
    }

    const fileKey = body.file_key ?? invoice.file_key;
    if (!fileKey) {
      return c.json({ success: false, error: { message: "file_key is required" } }, 400);
    }

    const task = await createTask(c.env, {
      task_type: "ocr_extract",
      biz_type: "receipt_invoice",
      biz_id: id,
      priority: 4,
      payload: {
        invoice_id: id,
        file_key: fileKey,
        expected_invoice_no: invoice.invoice_number ?? null,
        expected_issue_date: invoice.invoice_number ? invoice.issue_date : null,
        expected_amount: invoice.amount_with_tax ?? invoice.amount
      },
      timeout_seconds: 300
    });

    await c.env.DB.prepare(
      "UPDATE invoice SET verification_status = 'pending', verification_task_id = ?, file_key = COALESCE(?, file_key), updated_at = ? WHERE id = ?"
    )
      .bind(task.id, body.file_key ?? null, nowIso(), id)
      .run();

    return c.json({ success: true, data: { task_id: task.id, verification_status: "pending" } });
  }
);

receiptRoutes.get(
  "/invoice/:id/verify-status",
  requireRoles(["super_admin", "manager", "site_manager", "finance", "operator"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const invoice = await c.env.DB.prepare("SELECT * FROM invoice WHERE id = ? AND status != 'deleted'")
      .bind(id)
      .first<Invoice>();
    if (!invoice) {
      return c.json({ success: false, error: { message: "Invoice not found" } }, 404);
    }

    if (!invoice.verification_task_id) {
      return c.json({
        success: true,
        data: {
          status: invoice.verification_status,
          task_id: null,
          result: null
        }
      });
    }

    const task = await c.env.DB.prepare("SELECT status, result_json FROM task_queue WHERE id = ?")
      .bind(invoice.verification_task_id)
      .first<{ status: string; result_json: string | null }>();
    const result = parseTaskResult(task?.result_json ?? null);

    if (task?.status === "completed" && invoice.verification_status !== "passed") {
      const extractedInvoiceNo =
        typeof result?.invoice_no === "string"
          ? result.invoice_no
          : typeof result?.invoice_number === "string"
            ? result.invoice_number
            : null;
      const extractedInvoiceCode = typeof result?.invoice_code === "string" ? result.invoice_code : null;
      const extractedCheckCode = typeof result?.check_code === "string" ? result.check_code : null;
      const extractedQrCode =
        typeof result?.qr_code === "string"
          ? result.qr_code
          : typeof result?.qr_code_text === "string"
            ? result.qr_code_text
            : null;
      const extractedDate = typeof result?.issue_date === "string" ? result.issue_date : null;
      const extractedAmount =
        typeof result?.amount_with_tax === "number"
          ? result.amount_with_tax
          : typeof result?.amount === "number"
            ? result.amount
            : null;
      const extractedTitle = typeof result?.buyer_name === "string" ? result.buyer_name : null;
      const extractedTaxNo = typeof result?.tax_no === "string" ? result.tax_no : null;

      const expectedInvoiceNo = invoice.invoice_number ?? null;
      const expectedIssueDate = invoice.invoice_number ? invoice.issue_date : null;
      const expectedAmount = invoice.amount_with_tax ?? invoice.amount;
      const invoiceNoMatched = !extractedInvoiceNo || extractedInvoiceNo === expectedInvoiceNo;
      const dateMatched = !expectedIssueDate || !extractedDate || extractedDate === expectedIssueDate;
      const amountMatched = extractedAmount === null || Math.abs(extractedAmount - expectedAmount) < 0.01;
      const passed = invoiceNoMatched && dateMatched && amountMatched;

      const verifyResult = {
        extracted: result,
        compare: {
          expected_invoice_no: expectedInvoiceNo,
          expected_issue_date: expectedIssueDate,
          expected_amount: expectedAmount,
          invoice_no_matched: invoiceNoMatched,
          issue_date_matched: dateMatched,
          amount_matched: amountMatched
        }
      };

      await c.env.DB.prepare(
        `UPDATE invoice SET
          verification_status = ?,
          verification_result = ?,
          invoice_code = COALESCE(?, invoice_code),
          invoice_number = COALESCE(?, invoice_number),
          check_code = COALESCE(?, check_code),
          issue_date = COALESCE(?, issue_date),
          amount_with_tax = COALESCE(?, amount_with_tax),
          title = COALESCE(?, title),
          tax_no = COALESCE(?, tax_no),
          qr_code = COALESCE(?, qr_code),
          updated_at = ?
         WHERE id = ?`
      )
        .bind(
          passed ? "passed" : "failed",
          JSON.stringify(verifyResult),
          extractedInvoiceCode,
          extractedInvoiceNo,
          extractedCheckCode,
          extractedDate,
          extractedAmount,
          extractedTitle,
          extractedTaxNo,
          extractedQrCode,
          nowIso(),
          id
        )
        .run();
    }

    if ((task?.status === "failed" || task?.status === "timeout") && invoice.verification_status !== "failed") {
      await c.env.DB.prepare(
        "UPDATE invoice SET verification_status = 'failed', updated_at = ? WHERE id = ?"
      )
        .bind(nowIso(), id)
        .run();
    }

    return c.json({
      success: true,
      data: {
        status:
          task?.status === "completed"
            ? "completed"
            : task?.status === "failed" || task?.status === "timeout"
              ? "failed"
              : invoice.verification_status,
        task_id: invoice.verification_task_id,
        result
      }
    });
  }
);

receiptRoutes.get(
  "/",
  requireRoles(["super_admin", "manager", "site_manager", "finance", "operator"]),
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
  requireRoles(["super_admin", "manager", "site_manager", "finance", "operator"]),
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
  requireRoles(["super_admin", "manager", "site_manager", "finance", "operator"]),
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
