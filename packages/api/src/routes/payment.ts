import { Hono } from "hono";

import { authMiddleware, type AuthVariables } from "../middleware/auth";
import { requireRoles } from "../middleware/rbac";
import type { Env } from "../types/env";
import type {
  PaymentRequest,
  CreatePaymentRequestBody,
  UpdatePaymentRequestBody,
  Payee,
  CreatePayeeRequest,
  UpdatePayeeRequest,
  Contract
} from "../types/contract";
import type { InstanceConfig } from "../types/approval";
import { generateSerial } from "../services/serial";
import { toAmountChinese } from "../services/amount-cn";
import { publishEvent } from "../services/event-bus";
import { createTask } from "../services/ai-slot";
import { submitForApproval } from "../services/approval/engine";

const nowIso = () => new Date().toISOString();

type SubmitApprovalOptions = {
  biz_summary?: string;
  instance_config?: InstanceConfig;
};

type MarkPaidBody = {
  paid_at?: string;
  payment_reference?: string;
  payment_account?: string;
  remark?: string;
};

export const paymentRoutes = new Hono<{
  Bindings: Env;
  Variables: AuthVariables;
}>();

paymentRoutes.use("*", authMiddleware);

paymentRoutes.get("/payee/list", async (c) => {
  const type = c.req.query("type");
  const keyword = c.req.query("keyword");
  const legacyDataId = c.req.query("legacy_data_id");

  let sql = "SELECT * FROM payee WHERE status = 'active'";
  const params: string[] = [];

  if (type) {
    sql += " AND type = ?";
    params.push(type);
  }
  if (keyword) {
    sql += " AND (name LIKE ? OR bank_account LIKE ?)";
    params.push(`%${keyword}%`, `%${keyword}%`);
  }
  if (legacyDataId) {
    sql += " AND legacy_data_id = ?";
    params.push(legacyDataId);
  }
  sql += " ORDER BY id DESC";

  const rows = await c.env.DB.prepare(sql)
    .bind(...params)
    .all<Payee>();

  return c.json({ success: true, data: rows.results ?? [] });
});

paymentRoutes.get("/payee/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const payee = await c.env.DB.prepare(
    "SELECT * FROM payee WHERE id = ? AND status = 'active'"
  )
    .bind(id)
    .first<Payee>();

  if (!payee) {
    return c.json({ success: false, error: { message: "Payee not found" } }, 404);
  }
  return c.json({ success: true, data: payee });
});

paymentRoutes.post(
  "/payee",
  requireRoles(["super_admin", "manager", "site_manager", "finance"]),
  async (c) => {
    const auth = c.get("auth");
    const body = (await c.req.json()) as CreatePayeeRequest;
    const now = nowIso();

    const result = await c.env.DB.prepare(
      `INSERT INTO payee (name, bank_name, bank_account, phone, type, status, created_by_userid, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)`
    )
      .bind(
        body.name,
        body.bank_name,
        body.bank_account,
        body.phone ?? null,
        body.type,
        auth.sub,
        now,
        now
      )
      .run();

    return c.json({ success: true, data: { id: result.meta.last_row_id } }, 201);
  }
);

paymentRoutes.put(
  "/payee/:id",
  requireRoles(["super_admin", "manager", "site_manager", "finance"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const body = (await c.req.json()) as UpdatePayeeRequest;

    await c.env.DB.prepare(
      `UPDATE payee SET
        name = COALESCE(?, name),
        bank_name = COALESCE(?, bank_name),
        bank_account = COALESCE(?, bank_account),
        phone = COALESCE(?, phone),
        type = COALESCE(?, type),
        updated_at = ?
        WHERE id = ?`
    )
      .bind(
        body.name ?? null,
        body.bank_name ?? null,
        body.bank_account ?? null,
        body.phone ?? null,
        body.type ?? null,
        nowIso(),
        id
      )
      .run();

    return c.json({ success: true });
  }
);

paymentRoutes.delete(
  "/payee/:id",
  requireRoles(["super_admin", "manager"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    await c.env.DB.prepare(
      "UPDATE payee SET status = 'deleted', updated_at = ? WHERE id = ?"
    )
      .bind(nowIso(), id)
      .run();

    return c.json({ success: true });
  }
);

paymentRoutes.get("/", async (c) => {
  const contractId = c.req.query("contract_id");
  const projectId = c.req.query("project_id");
  const status = c.req.query("status");
  const keyword = c.req.query("keyword");
  const legacyDataId = c.req.query("legacy_data_id");
  const page = Number(c.req.query("page") ?? "1");
  const pageSize = Number(c.req.query("pageSize") ?? "20");
  const offset = (page - 1) * pageSize;

  let sql = "SELECT * FROM payment_request WHERE status != 'cancelled'";
  let countSql = "SELECT COUNT(*) as total FROM payment_request WHERE status != 'cancelled'";
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
    sql += " AND (serial_no LIKE ? OR content LIKE ?)";
    countSql += " AND (serial_no LIKE ? OR content LIKE ?)";
    params.push(`%${keyword}%`, `%${keyword}%`);
  }
  if (legacyDataId) {
    sql += " AND legacy_data_id = ?";
    countSql += " AND legacy_data_id = ?";
    params.push(legacyDataId);
  }

  sql += " ORDER BY id DESC LIMIT ? OFFSET ?";

  const countResult = await c.env.DB.prepare(countSql)
    .bind(...params)
    .first<{ total: number }>();
  const total = countResult?.total ?? 0;

  const rows = await c.env.DB.prepare(sql)
    .bind(...params, pageSize, offset)
    .all<PaymentRequest>();

  return c.json({
    success: true,
    data: rows.results ?? [],
    pagination: { page, pageSize, total }
  });
});

paymentRoutes.get("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const pr = await c.env.DB.prepare(
    "SELECT * FROM payment_request WHERE id = ?"
  )
    .bind(id)
    .first<PaymentRequest>();

  if (!pr) {
    return c.json({ success: false, error: { message: "Payment request not found" } }, 404);
  }

  const contract =
    pr.contract_id !== null
      ? await c.env.DB.prepare(
          "SELECT contract_no, counterparty, total_amount, paid_amount FROM contract WHERE id = ?"
        )
          .bind(pr.contract_id)
          .first()
      : null;

  const payee = await c.env.DB.prepare(
    "SELECT name, bank_name, bank_account FROM payee WHERE id = ?"
  )
    .bind(pr.payee_id)
    .first();

  return c.json({
    success: true,
    data: { ...pr, contract, payee }
  });
});

paymentRoutes.post(
  "/",
  requireRoles(["super_admin", "manager", "site_manager", "finance"]),
  async (c) => {
    const auth = c.get("auth");
    const body = (await c.req.json()) as CreatePaymentRequestBody;
    const now = nowIso();

    const contract = await c.env.DB.prepare(
      "SELECT * FROM contract WHERE id = ? AND status != 'deleted'"
    )
      .bind(body.contract_id)
      .first<Contract>();

    if (!contract) {
      return c.json(
        { success: false, error: { message: "Contract not found" } },
        404
      );
    }

    if (contract.status !== "active") {
      return c.json(
        { success: false, error: { message: "Contract is not active" } },
        400
      );
    }

    const remaining = contract.total_amount - contract.paid_amount;
    if (body.amount > remaining) {
      return c.json(
        {
          success: false,
          error: {
            message: `Amount (${body.amount}) exceeds contract remaining balance (${remaining}). Total: ${contract.total_amount}, Paid: ${contract.paid_amount}`
          }
        },
        400
      );
    }

    const payee = await c.env.DB.prepare(
      "SELECT * FROM payee WHERE id = ? AND status = 'active'"
    )
      .bind(body.payee_id)
      .first<Payee>();

    if (!payee) {
      return c.json(
        { success: false, error: { message: "Payee not found or inactive" } },
        404
      );
    }

    const serialNo = await generateSerial(c.env.DB, "PM", "payment_request", "serial_no");
    const amountCn = toAmountChinese(body.amount);

    const result = await c.env.DB.prepare(
      `INSERT INTO payment_request
        (serial_no, contract_id, project_id, applicant_userid, expected_payment_date,
         category, payee_id, amount, amount_cn, content, payment_method,
         status, ai_risk_status, attachments_json, remark, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', 'none', ?, ?, ?, ?)`
    )
      .bind(
        serialNo,
        body.contract_id,
        body.project_id,
        auth.sub,
        body.expected_payment_date,
        body.category,
        body.payee_id,
        body.amount,
        amountCn,
        body.content,
        body.payment_method,
        body.attachments_json ?? null,
        body.remark ?? null,
        now,
        now
      )
      .run();

    const prId = result.meta.last_row_id;

    await publishEvent(c.env, "PAYMENT_REQUEST_CREATED", "payment_request", {
      payment_request_id: prId,
      serial_no: serialNo,
      contract_id: body.contract_id,
      amount: body.amount,
      created_by: auth.sub
    });

    return c.json(
      { success: true, data: { id: prId, serial_no: serialNo, amount_cn: amountCn } },
      201
    );
  }
);

paymentRoutes.put(
  "/:id",
  requireRoles(["super_admin", "manager", "site_manager", "finance"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const body = (await c.req.json()) as UpdatePaymentRequestBody;
    const now = nowIso();

    const existing = await c.env.DB.prepare(
      "SELECT * FROM payment_request WHERE id = ?"
    )
      .bind(id)
      .first<PaymentRequest>();

    if (!existing) {
      return c.json({ success: false, error: { message: "Payment request not found" } }, 404);
    }

    if (existing.status !== "draft") {
      return c.json(
        { success: false, error: { message: "Only draft payment requests can be modified" } },
        400
      );
    }

    if (body.amount !== undefined) {
      const contract = await c.env.DB.prepare(
        "SELECT total_amount, paid_amount FROM contract WHERE id = ?"
      )
        .bind(existing.contract_id)
        .first<Pick<Contract, "total_amount" | "paid_amount">>();

      if (contract) {
        const remaining = contract.total_amount - contract.paid_amount;
        if (body.amount > remaining) {
          return c.json(
            {
              success: false,
              error: { message: `Amount exceeds remaining balance (${remaining})` }
            },
            400
          );
        }
      }
    }

    const newAmountCn = body.amount !== undefined ? toAmountChinese(body.amount) : null;

    await c.env.DB.prepare(
      `UPDATE payment_request SET
        expected_payment_date = COALESCE(?, expected_payment_date),
        category = COALESCE(?, category),
        payee_id = COALESCE(?, payee_id),
        amount = COALESCE(?, amount),
        amount_cn = COALESCE(?, amount_cn),
        content = COALESCE(?, content),
        payment_method = COALESCE(?, payment_method),
        attachments_json = COALESCE(?, attachments_json),
        remark = COALESCE(?, remark),
        status = COALESCE(?, status),
        updated_at = ?
        WHERE id = ?`
    )
      .bind(
        body.expected_payment_date ?? null,
        body.category ?? null,
        body.payee_id ?? null,
        body.amount ?? null,
        newAmountCn,
        body.content ?? null,
        body.payment_method ?? null,
        body.attachments_json ?? null,
        body.remark ?? null,
        body.status ?? null,
        now,
        id
      )
      .run();

    return c.json({ success: true });
  }
);

paymentRoutes.post(
  "/:id/submit-approval",
  requireRoles(["super_admin", "manager", "site_manager", "finance"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const auth = c.get("auth");
    const body = (await c.req.json().catch(() => ({}))) as SubmitApprovalOptions;

    const request = await c.env.DB.prepare(
      "SELECT * FROM payment_request WHERE id = ?"
    )
      .bind(id)
      .first<PaymentRequest>();

    if (!request) {
      return c.json({ success: false, error: { message: "Payment request not found" } }, 404);
    }

    if (request.status !== "draft") {
      return c.json(
        { success: false, error: { message: "Only draft requests can be submitted" } },
        400
      );
    }

    if (request.approval_instance_id) {
      const existing = await c.env.DB.prepare(
        "SELECT status FROM approval_instance WHERE id = ?"
      )
        .bind(request.approval_instance_id)
        .first<{ status: string }>();

      if (existing && (existing.status === "pending" || existing.status === "in_progress")) {
        return c.json(
          { success: false, error: { message: "Approval instance already in progress" } },
          400
        );
      }
    }

    const contract = await c.env.DB.prepare(
      "SELECT total_amount, paid_amount, entity_id FROM contract WHERE id = ?"
    )
      .bind(request.contract_id)
      .first<Pick<Contract, "total_amount" | "paid_amount" | "entity_id">>();

    if (!contract) {
      return c.json({ success: false, error: { message: "Contract not found" } }, 404);
    }

    const instance = await submitForApproval(
      c.env,
      {
        biz_type: "payment_request",
        biz_id: id,
        biz_summary:
          body.biz_summary?.trim() ||
          `${request.serial_no} | ${request.content} | ${request.amount}`,
        context: {
          amount: request.amount,
          project_id: request.project_id,
          entity_id: contract.entity_id,
          biz_type: "payment_request",
          biz_id: id
        },
        instance_config: body.instance_config
      },
      auth.sub
    );

    await c.env.DB.prepare(
      "UPDATE payment_request SET status = 'pending_approval', approval_instance_id = ?, updated_at = ? WHERE id = ?"
    )
      .bind(instance.id, nowIso(), id)
      .run();

    return c.json({
      success: true,
      data: { approval_instance_id: instance.id, instance_no: instance.instance_no }
    });
  }
);

paymentRoutes.post(
  "/:id/mark-paid",
  requireRoles(["super_admin", "manager"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const auth = c.get("auth");
    const body = (await c.req.json().catch(() => ({}))) as MarkPaidBody;
    const now = nowIso();

    const pr = await c.env.DB.prepare(
      "SELECT * FROM payment_request WHERE id = ?"
    )
      .bind(id)
      .first<PaymentRequest>();

    if (!pr) {
      return c.json({ success: false, error: { message: "Payment request not found" } }, 404);
    }

    if (pr.status !== "approved") {
      return c.json(
        { success: false, error: { message: "Only approved requests can be marked as paid" } },
        400
      );
    }

    if (pr.contract_id === null) {
      return c.json(
        {
          success: false,
          error: {
            message: "Legacy payment request without contract cannot use mark-paid. Migrate contract linkage first."
          }
        },
        400
      );
    }

    const paidAt = body.paid_at?.trim() ? body.paid_at : now;

    await c.env.DB.prepare(
      `UPDATE payment_request SET
        status = 'paid',
        paid_at = ?,
        paid_by_userid = ?,
        payment_reference = COALESCE(?, payment_reference),
        payment_account = COALESCE(?, payment_account),
        remark = COALESCE(?, remark),
        updated_at = ?
      WHERE id = ?`
    )
      .bind(
        paidAt,
        auth.sub,
        body.payment_reference?.trim() || null,
        body.payment_account?.trim() || null,
        body.remark?.trim() || null,
        now,
        id
      )
      .run();

    await c.env.DB.prepare(
      "UPDATE contract SET paid_amount = paid_amount + ?, updated_at = ? WHERE id = ?"
    )
      .bind(pr.amount, now, pr.contract_id)
      .run();

    await publishEvent(c.env, "PAYMENT_COMPLETED", "payment_request", {
      payment_request_id: id,
      serial_no: pr.serial_no,
      contract_id: pr.contract_id,
      amount: pr.amount
    });

    return c.json({ success: true });
  }
);

paymentRoutes.post(
  "/:id/trigger-risk-assessment",
  requireRoles(["super_admin", "manager", "site_manager", "finance"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const now = nowIso();

    const pr = await c.env.DB.prepare(
      "SELECT * FROM payment_request WHERE id = ?"
    )
      .bind(id)
      .first<PaymentRequest>();

    if (!pr) {
      return c.json({ success: false, error: { message: "Payment request not found" } }, 404);
    }

    await c.env.DB.prepare(
      "UPDATE payment_request SET ai_risk_status = 'pending', updated_at = ? WHERE id = ?"
    )
      .bind(now, id)
      .run();

    const contract = await c.env.DB.prepare(
      "SELECT contract_no, total_amount, paid_amount, counterparty FROM contract WHERE id = ?"
    )
      .bind(pr.contract_id)
      .first();

    const recentPayments = await c.env.DB.prepare(
      `SELECT serial_no, amount, created_at FROM payment_request
       WHERE contract_id = ? AND id != ? AND status != 'cancelled'
       ORDER BY created_at DESC LIMIT 10`
    )
      .bind(pr.contract_id, id)
      .all();

    await createTask(c.env, {
      task_type: "payment_risk_assessment",
      biz_type: "payment_request",
      biz_id: id,
      priority: 3,
      payload: {
        payment_request_id: id,
        serial_no: pr.serial_no,
        amount: pr.amount,
        contract: contract,
        recent_payments: recentPayments.results ?? [],
        payee_id: pr.payee_id
      },
      timeout_seconds: 300
    });

    return c.json({ success: true });
  }
);

paymentRoutes.get("/:id/risk-report", async (c) => {
  const id = Number(c.req.param("id"));
  const pr = await c.env.DB.prepare(
    "SELECT ai_risk_status, ai_risk_result FROM payment_request WHERE id = ?"
  )
    .bind(id)
    .first<Pick<PaymentRequest, "ai_risk_status" | "ai_risk_result">>();

  if (!pr) {
    return c.json({ success: false, error: { message: "Payment request not found" } }, 404);
  }

  let parsedResult = null;
  if (pr.ai_risk_result) {
    try {
      parsedResult = JSON.parse(pr.ai_risk_result);
    } catch {
      parsedResult = pr.ai_risk_result;
    }
  }

  return c.json({
    success: true,
    data: { status: pr.ai_risk_status, result: parsedResult }
  });
});
