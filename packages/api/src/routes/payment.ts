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
import { writeAuditLog } from "../services/audit-log";
import { generateSerial } from "../services/serial";
import { toAmountChinese } from "../services/amount-cn";
import { publishEvent } from "../services/event-bus";
import { createAiGateHandler, createTask } from "../services/ai-slot";
import {
  abandonIdempotentRequest,
  beginIdempotentRequest,
  completeIdempotentRequest
} from "../services/idempotency";
import { submitForApproval } from "../services/approval/engine";
import { resubmit as resubmitOp } from "../services/approval/operations";

const nowIso = () => new Date().toISOString();

const paymentAllowedContractStatuses: ReadonlySet<Contract["status"]> = new Set([
  "draft",
  "pending_review",
  "pending_approval",
  "active",
  "completed"
]);

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

type VoidPaymentBody = {
  reason?: string;
};

type ApprovalInstanceLite = {
  id: number;
  instance_no: string;
  status: string;
};

const isPaymentNoLongerApprovedError = (error: unknown): boolean => {
  return (
    error instanceof Error &&
    error.message === "Payment request is no longer approved"
  );
};

export const mapApprovalInstanceStatusToPaymentStatus = (
  approvalStatus: string
): PaymentRequest["status"] | null => {
  if (approvalStatus === "pending" || approvalStatus === "in_progress") {
    return "pending_approval";
  }
  if (approvalStatus === "approved" || approvalStatus === "completed") {
    return "approved";
  }
  if (approvalStatus === "rejected") {
    return "rejected";
  }
  return null;
};

export const isPaymentStatusReconcileEligible = (
  paymentStatus: PaymentRequest["status"]
): boolean => {
  return paymentStatus === "draft" || paymentStatus === "pending_approval";
};

const findLatestApprovalInstanceForPayment = async (
  db: D1Database,
  paymentId: number
): Promise<ApprovalInstanceLite | null> => {
  return await db
    .prepare(
      `SELECT id, instance_no, status
         FROM approval_instance
        WHERE biz_type = 'payment_request'
          AND biz_id = ?
        ORDER BY id DESC
        LIMIT 1`
    )
    .bind(paymentId)
    .first<ApprovalInstanceLite>();
};

const reconcilePaymentStatusWithApproval = async (
  db: D1Database,
  paymentId: number,
  payment: Pick<PaymentRequest, "status" | "approval_instance_id">,
  now: string
): Promise<ApprovalInstanceLite | null> => {
  if (!isPaymentStatusReconcileEligible(payment.status)) {
    return null;
  }

  const latestApproval = await findLatestApprovalInstanceForPayment(db, paymentId);
  if (!latestApproval) return null;

  const targetStatus = mapApprovalInstanceStatusToPaymentStatus(latestApproval.status);
  if (!targetStatus) return null;

  const hasLinkedApproval =
    payment.approval_instance_id !== null &&
    payment.approval_instance_id === latestApproval.id;
  const statusAlreadyAligned = payment.status === targetStatus;
  if (hasLinkedApproval && statusAlreadyAligned) {
    return latestApproval;
  }

  await db
    .prepare(
      `UPDATE payment_request
          SET status = ?,
              approval_instance_id = ?,
              updated_at = ?
        WHERE id = ?`
    )
    .bind(targetStatus, latestApproval.id, now, paymentId)
    .run();

  return latestApproval;
};

const syncContractPaidAmount = async (
  db: D1Database,
  contractId: number,
  updatedAt: string
) => {
  await db.prepare(
    `UPDATE contract
        SET paid_amount = (
              SELECT COALESCE(SUM(amount), 0)
                FROM payment_request
               WHERE contract_id = ?
                 AND status = 'paid'
            ),
            updated_at = ?
      WHERE id = ?`
  )
    .bind(contractId, updatedAt, contractId)
    .run();
};

const accountToDisplayText = (account: {
  bank_name: string;
  bank_branch_no: string | null;
  account_no: string;
}) => {
  const branch = account.bank_branch_no?.trim();
  return `${account.bank_name}${branch ? `-${branch}` : ""} / ${account.account_no}`;
};

type AttachmentMeta = {
  file_key: string;
  file_name: string;
  file_size?: number | null;
  file_url: string;
};

const mergeAttachments = (...groups: AttachmentMeta[][]): AttachmentMeta[] => {
  const merged: AttachmentMeta[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    for (const item of group) {
      if (seen.has(item.file_key)) continue;
      seen.add(item.file_key);
      merged.push(item);
    }
  }
  return merged;
};

const DEFAULT_NO_CONTRACT_THRESHOLD = 10000;

const getNoContractThreshold = async (env: Env): Promise<number> => {
  const row = await env.DB.prepare(
    `SELECT MIN(at.threshold_value) AS min_threshold
       FROM approval_threshold at
       JOIN approval_template ap ON ap.id = at.template_id
      WHERE at.status = 'active'
        AND ap.status = 'active'
        AND ap.biz_type = 'payment_request'`
  ).first<{ min_threshold: number | null }>();
  const min = row?.min_threshold ?? null;
  return typeof min === "number" && Number.isFinite(min) ? min : DEFAULT_NO_CONTRACT_THRESHOLD;
};

const normalizeTextForIdempotency = (value: string | null | undefined) => {
  return String(value ?? "").trim().replace(/\s+/g, " ");
};

const getAutoCreatePaymentIdempotencyKey = (authSub: string, body: CreatePaymentRequestBody) => {
  const bucket5m = Math.floor(Date.now() / 300000);
  const contractPart = typeof body.contract_id === "number" ? String(body.contract_id) : "no-contract";
  const attachmentPart = normalizeTextForIdempotency(body.attachments_json);
  return [
    "payment-create-v1",
    authSub,
    String(bucket5m),
    contractPart,
    String(body.project_id),
    normalizeTextForIdempotency(body.expected_payment_date),
    normalizeTextForIdempotency(body.category),
    String(body.payee_id),
    String(body.amount),
    normalizeTextForIdempotency(body.content),
    normalizeTextForIdempotency(body.payment_method),
    normalizeTextForIdempotency(body.remark),
    attachmentPart
  ].join("|");
};

const enqueuePaymentRiskAssessment = async (env: Env, payment: PaymentRequest) => {
  const now = nowIso();
  await env.DB.prepare(
    "UPDATE payment_request SET ai_risk_status = 'pending', updated_at = ? WHERE id = ?"
  )
    .bind(now, payment.id)
    .run();

  const contract =
    payment.contract_id !== null
      ? await env.DB.prepare(
          "SELECT contract_no, total_amount, paid_amount, counterparty, attachments_json FROM contract WHERE id = ?"
        )
          .bind(payment.contract_id)
          .first<{
            contract_no: string;
            total_amount: number;
            paid_amount: number;
            counterparty: string;
            attachments_json: string | null;
          }>()
      : null;

  const paymentAttachments = parseAttachmentMeta(payment.attachments_json);
  const contractAttachments = parseAttachmentMeta(contract?.attachments_json ?? null);
  const attachments = mergeAttachments(contractAttachments, paymentAttachments);

  const recentPayments =
    payment.contract_id !== null
      ? await env.DB.prepare(
          `SELECT serial_no, amount, created_at FROM payment_request
           WHERE contract_id = ? AND id != ? AND status != 'cancelled'
           ORDER BY created_at DESC LIMIT 10`
        )
          .bind(payment.contract_id, payment.id)
          .all()
      : await env.DB.prepare(
          `SELECT serial_no, amount, created_at FROM payment_request
           WHERE payee_id = ? AND id != ? AND status != 'cancelled'
           ORDER BY created_at DESC LIMIT 10`
        )
          .bind(payment.payee_id, payment.id)
          .all();

  await createTask(env, {
    task_type: "payment_risk_assessment",
    biz_type: "payment_request",
    biz_id: payment.id,
    priority: 3,
    payload: {
      payment_request_id: payment.id,
      serial_no: payment.serial_no,
      amount: payment.amount,
      contract,
      recent_payments: recentPayments.results ?? [],
      payee_id: payment.payee_id,
      payment_attachments: paymentAttachments,
      contract_attachments: contractAttachments,
      attachments
    },
    timeout_seconds: 300
  });
};

const parseAttachmentMeta = (raw: string | null): AttachmentMeta[] => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const items: Array<AttachmentMeta | null> = parsed.map(item => {
      if (typeof item === "string") {
        return {
          file_key: item,
          file_name: item,
          file_size: null,
          file_url: `/api/v1/upload/object/${encodeURIComponent(item)}`
        };
      }
      if (item && typeof item === "object") {
        const row = item as {
          file_key?: string;
          key?: string;
          file_name?: string;
          name?: string;
          file_size?: number;
          size?: number;
        };
        const key = row.file_key ?? row.key;
        if (!key) return null;
        return {
          file_key: key,
          file_name: row.file_name ?? row.name ?? key,
          file_size: row.file_size ?? row.size ?? null,
          file_url: `/api/v1/upload/object/${encodeURIComponent(key)}`
        };
      }
      return null;
    });
    return items.filter((item): item is AttachmentMeta => item !== null);
  } catch {
    return [];
  }
};

export const paymentRoutes = new Hono<{
  Bindings: Env;
  Variables: AuthVariables;
}>();

paymentRoutes.use("*", authMiddleware);

paymentRoutes.get("/payee/list", async (c) => {
  const auth = c.get("auth");
  const type = c.req.query("type");
  const keyword = c.req.query("keyword");
  const legacyDataId = c.req.query("legacy_data_id");
  const linkedUserid = c.req.query("linked_userid");
  const mine = c.req.query("mine") === "true";

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
  if (linkedUserid) {
    sql += " AND linked_userid = ?";
    params.push(linkedUserid);
  }

  if (mine) {
    sql += " AND type = 'internal'";
    sql += " AND created_by_userid = ?";
    params.push(auth.sub);
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
  requireRoles(["super_admin", "manager", "site_manager", "finance", "operator"]),
  async (c) => {
    const auth = c.get("auth");
    const body = (await c.req.json()) as CreatePayeeRequest;
    const now = nowIso();

    const canManageInternalPayee = auth.roles.some(role =>
      ["super_admin", "manager", "site_manager", "finance"].includes(role)
    );
    if (body.type === "internal" && !canManageInternalPayee) {
      return c.json(
        {
          success: false,
          error: { message: "Only finance/manager roles can create internal payees" }
        },
        403
      );
    }

    const result = await c.env.DB.prepare(
      `INSERT INTO payee (name, bank_name, bank_account, phone, type, status, created_by_userid, linked_userid, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`
    )
      .bind(
        body.name,
        body.bank_name,
        body.bank_account,
        body.phone ?? null,
        body.type,
        auth.sub,
        body.type === "internal" ? body.linked_userid ?? null : null,
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

    const linkedUseridProvided = Object.prototype.hasOwnProperty.call(body, "linked_userid");
    await c.env.DB.prepare(
      `UPDATE payee SET
        name = COALESCE(?, name),
        bank_name = COALESCE(?, bank_name),
        bank_account = COALESCE(?, bank_account),
        phone = COALESCE(?, phone),
        type = COALESCE(?, type),
        linked_userid = CASE WHEN ? = 1 THEN ? ELSE linked_userid END,
        updated_at = ?
        WHERE id = ?`
    )
      .bind(
        body.name ?? null,
        body.bank_name ?? null,
        body.bank_account ?? null,
        body.phone ?? null,
        body.type ?? null,
        linkedUseridProvided ? 1 : 0,
        body.linked_userid ?? null,
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
  const auth = c.get("auth");
  const contractId = c.req.query("contract_id");
  const projectId = c.req.query("project_id");
  const projectName = c.req.query("project_name");
  const status = c.req.query("status")?.trim().toLowerCase() || "";
  const keyword = c.req.query("keyword");
  const legacyDataId = c.req.query("legacy_data_id");
  const applicantUserid = c.req.query("applicant_userid");
  const dateFrom = c.req.query("date_from");
  const dateTo = c.req.query("date_to");
  const mine = c.req.query("mine") === "true";
  const page = Number(c.req.query("page") ?? "1");
  const pageSize = Number(c.req.query("pageSize") ?? "20");
  const offset = (page - 1) * pageSize;

  const includeCancelled = status === "cancelled";
  let sql = includeCancelled
    ? "SELECT * FROM payment_request WHERE 1=1"
    : "SELECT * FROM payment_request WHERE status != 'cancelled'";
  let countSql = includeCancelled
    ? "SELECT COUNT(*) as total FROM payment_request WHERE 1=1"
    : "SELECT COUNT(*) as total FROM payment_request WHERE status != 'cancelled'";
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
  if (projectName) {
    sql += " AND project_id IN (SELECT id FROM project WHERE project_name LIKE ? OR project_code LIKE ?)";
    countSql += " AND project_id IN (SELECT id FROM project WHERE project_name LIKE ? OR project_code LIKE ?)";
    params.push(`%${projectName}%`, `%${projectName}%`);
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
  if (mine) {
    sql += " AND applicant_userid = ?";
    countSql += " AND applicant_userid = ?";
    params.push(auth.sub);
  } else if (applicantUserid) {
    sql += " AND applicant_userid = ?";
    countSql += " AND applicant_userid = ?";
    params.push(applicantUserid);
  }
  if (dateFrom) {
    sql += " AND expected_payment_date >= ?";
    countSql += " AND expected_payment_date >= ?";
    params.push(dateFrom);
  }
  if (dateTo) {
    sql += " AND expected_payment_date <= ?";
    countSql += " AND expected_payment_date <= ?";
    params.push(dateTo);
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
  requireRoles(["super_admin", "manager", "site_manager", "finance", "operator"]),
  async (c) => {
    const auth = c.get("auth");
    const body = (await c.req.json()) as CreatePaymentRequestBody;
    const now = nowIso();

    const contractId = typeof body.contract_id === "number" ? body.contract_id : null;
    let contract: Contract | null = null;

    if (contractId !== null) {
      contract = await c.env.DB.prepare(
        "SELECT * FROM contract WHERE id = ? AND status != 'deleted'"
      )
        .bind(contractId)
        .first<Contract>();

      if (!contract) {
        return c.json(
          { success: false, error: { message: "Contract not found" } },
          404
        );
      }

      if (!paymentAllowedContractStatuses.has(contract.status)) {
        return c.json(
          {
            success: false,
            error: {
              message: `Contract status ${contract.status} does not allow payment request creation`
            }
          },
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
    } else {
      const threshold = await getNoContractThreshold(c.env);
      if (body.amount > threshold) {
        return c.json(
          {
            success: false,
            error: {
              message: `No-contract payment is only allowed at or below ${threshold}. Current amount: ${body.amount}`
            }
          },
          400
        );
      }
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

    const explicitIdempotencyKey = String(c.req.header("Idempotency-Key") ?? "").trim();
    const createIdempotencyKey =
      explicitIdempotencyKey || getAutoCreatePaymentIdempotencyKey(auth.sub, body);
    const createIdempotency = await beginIdempotentRequest<{
      success: boolean;
      data: { id: number; serial_no: string; amount_cn: string };
    }>(c.env.DB, "payment:create", auth.sub, createIdempotencyKey);

    if (createIdempotency.kind === "replay") {
      return c.json(createIdempotency.payload, {
        status: createIdempotency.statusCode as 200 | 201
      });
    }

    if (createIdempotency.kind === "pending") {
      return c.json({ success: false, error: { message: "Payment creation already in progress" } }, 409);
    }

    try {
      const serialNo = await generateSerial(c.env.DB, "PM", "payment_request", "serial_no");
      const amountCn = toAmountChinese(body.amount);

      const result = await c.env.DB.prepare(
        `INSERT INTO payment_request
          (serial_no, contract_id, project_id, applicant_userid, expected_payment_date,
           category, payee_id, amount, amount_cn, content, payment_method,
           payment_entity_id, payment_entity_bank_account_id, payment_account,
           status, ai_risk_status, attachments_json, remark, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', 'none', ?, ?, ?, ?)`
      )
        .bind(
          serialNo,
          contractId,
          body.project_id,
          auth.sub,
          body.expected_payment_date,
          body.category,
          body.payee_id,
          body.amount,
          amountCn,
          body.content,
          body.payment_method,
          contract?.entity_id ?? null,
          null,
          null,
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
        contract_id: contractId,
        amount: body.amount,
        created_by: auth.sub
      });

      const payload = {
        success: true,
        data: { id: prId, serial_no: serialNo, amount_cn: amountCn }
      };
      await completeIdempotentRequest(c.env.DB, "payment:create", auth.sub, createIdempotencyKey, 201, payload);

      return c.json(payload, 201);
    } catch (error) {
      await abandonIdempotentRequest(c.env.DB, "payment:create", auth.sub, createIdempotencyKey);
      throw error;
    }
  }
);

paymentRoutes.put(
  "/:id",
  requireRoles(["super_admin", "manager", "site_manager", "finance"]),
  async (c) => {
    const auth = c.get("auth");
    const id = Number(c.req.param("id"));
    const body = (await c.req.json()) as UpdatePaymentRequestBody;
    const now = nowIso();
    const isSuperAdmin = auth.roles.includes("super_admin");

    const existing = await c.env.DB.prepare(
      "SELECT * FROM payment_request WHERE id = ?"
    )
      .bind(id)
      .first<PaymentRequest>();

    if (!existing) {
      return c.json({ success: false, error: { message: "Payment request not found" } }, 404);
    }

    const hasNonAttachmentMutation =
      body.payment_entity_id !== undefined ||
      body.payment_entity_bank_account_id !== undefined ||
      body.payment_account !== undefined ||
      body.expected_payment_date !== undefined ||
      body.category !== undefined ||
      body.payee_id !== undefined ||
      body.amount !== undefined ||
      body.content !== undefined ||
      body.payment_method !== undefined ||
      body.remark !== undefined ||
      body.status !== undefined;

    const hasPayoutMutation =
      body.payment_entity_id !== undefined ||
      body.payment_entity_bank_account_id !== undefined ||
      body.payment_account !== undefined;

    const hasBusinessMutationExcludingPayout =
      body.expected_payment_date !== undefined ||
      body.category !== undefined ||
      body.payee_id !== undefined ||
      body.amount !== undefined ||
      body.content !== undefined ||
      body.payment_method !== undefined ||
      body.remark !== undefined ||
      body.status !== undefined;

    const approval = existing.approval_instance_id
      ? await c.env.DB.prepare("SELECT status FROM approval_instance WHERE id = ?")
          .bind(existing.approval_instance_id)
          .first<{ status: string }>()
      : null;
    const approvalInProgress = approval ? approval.status === "pending" || approval.status === "in_progress" : false;
    const approvalFinished = approval ? !approvalInProgress : false;

    if (!isSuperAdmin) {
      if (existing.status !== "draft") {
        if (approvalInProgress && hasPayoutMutation && !hasBusinessMutationExcludingPayout) {
          const approverTask = existing.approval_instance_id
            ? await c.env.DB.prepare(
                `SELECT id FROM approval_task
                 WHERE instance_id = ?
                   AND assignee_userid = ?
                   AND status IN ('pending', 'in_progress')
                 ORDER BY id DESC LIMIT 1`
              )
                .bind(existing.approval_instance_id, auth.sub)
                .first<{ id: number }>()
            : null;

          if (!approverTask) {
            return c.json(
              {
                success: false,
                error: {
                  message: "Only current approver can adjust payout entity/account during approval"
                }
              },
              400
            );
          }
        } else if (!(approvalFinished && !hasNonAttachmentMutation)) {
          return c.json(
            {
              success: false,
              error: {
                message:
                  "Payment request is locked after approval lifecycle. Only attachment upload is allowed."
              }
            },
            400
          );
        }
      }
    }

    if (isSuperAdmin && hasNonAttachmentMutation) {
      if (body.admin_edit_mode !== true) {
        return c.json(
          { success: false, error: { message: "Super admin must enable edit mode for privileged modification" } },
          400
        );
      }
      if (!body.edit_note?.trim()) {
        return c.json(
          { success: false, error: { message: "edit_note is required for privileged modification" } },
          400
        );
      }
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

    let normalizedPaymentAccount: string | null = null;
    let normalizedPaymentEntityBankAccountId: number | null = null;

    if (body.payment_entity_bank_account_id !== undefined) {
      if (body.payment_entity_bank_account_id === null) {
        normalizedPaymentEntityBankAccountId = null;
      } else if (typeof body.payment_entity_bank_account_id === "number") {
        const bankAccount = await c.env.DB.prepare(
          "SELECT id, entity_id, bank_name, bank_branch_no, account_no FROM entity_bank_account WHERE id = ? AND status = 'active'"
        )
          .bind(body.payment_entity_bank_account_id)
          .first<{
            id: number;
            entity_id: number;
            bank_name: string;
            bank_branch_no: string | null;
            account_no: string;
          }>();

        if (!bankAccount) {
          return c.json({ success: false, error: { message: "Payment bank account not found" } }, 400);
        }
        if (
          typeof body.payment_entity_id === "number" &&
          bankAccount.entity_id !== body.payment_entity_id
        ) {
          return c.json(
            { success: false, error: { message: "Selected account does not belong to selected entity" } },
            400
          );
        }

        normalizedPaymentEntityBankAccountId = bankAccount.id;
        normalizedPaymentAccount = accountToDisplayText(bankAccount);
        if (body.payment_entity_id === undefined) {
          body.payment_entity_id = bankAccount.entity_id;
        }
      }
    }

    if (body.payment_account !== undefined) {
      normalizedPaymentAccount = body.payment_account?.trim() || null;
    }

    const auditRemark =
      isSuperAdmin && hasNonAttachmentMutation
        ? `${(body.remark ?? existing.remark ?? "").trim()}\n[SUPER_ADMIN_EDIT ${now}] ${auth.sub}: ${body.edit_note?.trim()}`.trim()
        : body.remark;

    await c.env.DB.prepare(
      `UPDATE payment_request SET
        expected_payment_date = COALESCE(?, expected_payment_date),
        category = COALESCE(?, category),
        payee_id = COALESCE(?, payee_id),
        amount = COALESCE(?, amount),
        amount_cn = COALESCE(?, amount_cn),
        content = COALESCE(?, content),
        payment_method = COALESCE(?, payment_method),
        payment_entity_id = COALESCE(?, payment_entity_id),
        payment_entity_bank_account_id = COALESCE(?, payment_entity_bank_account_id),
        payment_account = COALESCE(?, payment_account),
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
        body.payment_entity_id ?? null,
        normalizedPaymentEntityBankAccountId,
        normalizedPaymentAccount,
        body.attachments_json ?? null,
        auditRemark ?? null,
        body.status ?? null,
        now,
        id
      )
      .run();

    if (isSuperAdmin && hasNonAttachmentMutation) {
      await writeAuditLog(c.env.DB, {
        actorUserId: auth.sub,
        actorRoles: auth.roles,
        action: "payment_request.super_admin_edit",
        targetType: "payment_request",
        targetId: id,
        detail: {
          edit_note: body.edit_note?.trim() ?? null,
          has_payout_mutation: hasPayoutMutation,
          has_non_attachment_mutation: hasNonAttachmentMutation
        }
      });
    }

    return c.json({ success: true });
  }
);

paymentRoutes.post(
  "/:id/submit-approval",
  requireRoles(["super_admin", "manager", "site_manager", "finance", "operator"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const auth = c.get("auth");
    const body = (await c.req.json().catch(() => ({}))) as SubmitApprovalOptions;

    const request = await c.env.DB.prepare(
      "SELECT * FROM payment_request WHERE id = ?"
    )
      .bind(id)
      .first<PaymentRequest>();
    const now = nowIso();

    if (!request) {
      return c.json({ success: false, error: { message: "Payment request not found" } }, 404);
    }

    const reconciledApproval = isPaymentStatusReconcileEligible(request.status)
      ? await reconcilePaymentStatusWithApproval(
          c.env.DB,
          id,
          {
            status: request.status,
            approval_instance_id: request.approval_instance_id
          },
          now
        )
      : null;

    if (
      reconciledApproval &&
      (reconciledApproval.status === "pending" || reconciledApproval.status === "in_progress")
    ) {
      return c.json({
        success: true,
        data: {
          approval_instance_id: reconciledApproval.id,
          instance_no: reconciledApproval.instance_no,
          already_submitted: true,
          recovered: true
        }
      });
    }

    if (
      reconciledApproval &&
      (reconciledApproval.status === "approved" ||
        reconciledApproval.status === "completed" ||
        reconciledApproval.status === "rejected")
    ) {
      return c.json(
        {
          success: false,
          error: {
            message: `Payment request already reached approval result: ${reconciledApproval.status}`
          }
        },
        409
      );
    }

    if (request.status !== "draft") {
      if (request.status === "pending_approval" && request.approval_instance_id) {
        const existingInstance = await c.env.DB.prepare(
          "SELECT instance_no FROM approval_instance WHERE id = ?"
        )
          .bind(request.approval_instance_id)
          .first<{ instance_no: string }>();
        return c.json({
          success: true,
          data: {
            approval_instance_id: request.approval_instance_id,
            instance_no: existingInstance?.instance_no ?? "",
            already_submitted: true
          }
        });
      }

      return c.json(
        { success: false, error: { message: "Only draft requests can be submitted" } },
        400
      );
    }

    const idempotencyKey = c.req.header("Idempotency-Key");
    const idempotency = await beginIdempotentRequest<{
      success: boolean;
      data: { approval_instance_id: number; instance_no: string; resubmitted?: boolean };
    }>(c.env.DB, `payment:submit-approval:${id}`, auth.sub, idempotencyKey);
    if (idempotency.kind === "replay") {
      return c.json(idempotency.payload);
    }
    if (idempotency.kind === "pending") {
      return c.json({ success: false, error: { message: "Approval submission already in progress" } }, 409);
    }

    if (request.approval_instance_id) {
      const existing = await c.env.DB.prepare(
        "SELECT status FROM approval_instance WHERE id = ?"
      )
        .bind(request.approval_instance_id)
        .first<{ status: string }>();

      if (existing && existing.status === "in_progress") {
        return c.json(
          { success: false, error: { message: "Approval instance already in progress" } },
          400
        );
      }

      if (existing && (existing.status === "pending" || existing.status === "withdrawn")) {
        try {
          await resubmitOp(c.env, request.approval_instance_id, auth.sub);
          await c.env.DB.prepare(
            "UPDATE payment_request SET status = 'pending_approval', updated_at = ? WHERE id = ?"
          )
            .bind(nowIso(), id)
            .run();
          const payload = {
            success: true,
            data: {
              approval_instance_id: request.approval_instance_id,
              instance_no: "",
              resubmitted: true
            }
          };
          await completeIdempotentRequest(c.env.DB, `payment:submit-approval:${id}`, auth.sub, idempotencyKey, 200, payload);
          return c.json(payload);
        } catch (err) {
          await abandonIdempotentRequest(c.env.DB, `payment:submit-approval:${id}`, auth.sub, idempotencyKey);
          const msg = err instanceof Error ? err.message : "Resubmit failed";
          return c.json({ success: false, error: { message: msg } }, 400);
        }
      }
    }

    const claimedDraft = await c.env.DB.prepare(
      `UPDATE payment_request
          SET status = 'pending_approval', updated_at = ?
        WHERE id = ? AND status = 'draft'`
    )
      .bind(now, id)
      .run();

    if ((claimedDraft.meta.changes ?? 0) !== 1) {
      const latest = await c.env.DB.prepare(
        "SELECT status, approval_instance_id FROM payment_request WHERE id = ?"
      )
        .bind(id)
        .first<{ status: string; approval_instance_id: number | null }>();

      if (latest?.status === "pending_approval" && latest.approval_instance_id) {
        const currentInstance = await c.env.DB.prepare(
          "SELECT instance_no FROM approval_instance WHERE id = ?"
        )
          .bind(latest.approval_instance_id)
          .first<{ instance_no: string }>();

        const payload = {
          success: true,
          data: {
            approval_instance_id: latest.approval_instance_id,
            instance_no: currentInstance?.instance_no ?? "",
            already_submitted: true
          }
        };
        await completeIdempotentRequest(c.env.DB, `payment:submit-approval:${id}`, auth.sub, idempotencyKey, 200, payload);
        return c.json(payload);
      }

      await abandonIdempotentRequest(c.env.DB, `payment:submit-approval:${id}`, auth.sub, idempotencyKey);
      return c.json(
        { success: false, error: { message: "Payment request submission already in progress" } },
        409
      );
    }

    const contract =
      request.contract_id !== null
        ? await c.env.DB.prepare(
            "SELECT contract_no, counterparty, total_amount, paid_amount, entity_id, attachments_json FROM contract WHERE id = ?"
          )
            .bind(request.contract_id)
            .first<
              Pick<
                Contract,
                "contract_no" | "counterparty" | "total_amount" | "paid_amount" | "entity_id" | "attachments_json"
              >
            >()
        : null;

    if (request.contract_id !== null && !contract) {
      return c.json({ success: false, error: { message: "Contract not found" } }, 404);
    }

    const payee = await c.env.DB.prepare(
      "SELECT name, bank_name, bank_account FROM payee WHERE id = ?"
    )
      .bind(request.payee_id)
      .first<Pick<Payee, "name" | "bank_name" | "bank_account">>();

    const paymentAttachments = parseAttachmentMeta(request.attachments_json);
    const contractAttachments = parseAttachmentMeta(contract?.attachments_json ?? null);
    const attachments = mergeAttachments(contractAttachments, paymentAttachments);

    let instanceNoForPayload = "";
    let instanceIdForPayload: number | null = null;
    try {
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
            entity_id: contract?.entity_id,
            biz_type: "payment_request",
            biz_id: id,
            serial_no: request.serial_no,
            contract:
              request.contract_id !== null && contract
                ? {
                    id: request.contract_id,
                    contract_no: contract.contract_no,
                    counterparty: contract.counterparty,
                    total_amount: contract.total_amount,
                    paid_amount: contract.paid_amount
                  }
                : null,
            payee: {
              id: request.payee_id,
              name: payee?.name ?? null,
              bank_name: payee?.bank_name ?? null,
              bank_account: payee?.bank_account ?? null
            },
            payment: {
              expected_payment_date: request.expected_payment_date,
              category: request.category,
              payment_method: request.payment_method,
              content: request.content,
              amount_cn: request.amount_cn,
              remark: request.remark ?? null
            },
            payment_attachments: paymentAttachments,
            contract_attachments: contractAttachments,
            attachments
          },
          instance_config: body.instance_config
        },
        auth.sub,
        createAiGateHandler()
      );

      instanceIdForPayload = instance.id;
      instanceNoForPayload = instance.instance_no;

      const attachResult = await c.env.DB.prepare(
        `UPDATE payment_request
            SET approval_instance_id = ?, updated_at = ?
          WHERE id = ? AND status = 'pending_approval' AND approval_instance_id IS NULL`
      )
        .bind(instance.id, now, id)
        .run();

      if ((attachResult.meta.changes ?? 0) !== 1) {
        const latest = await c.env.DB.prepare(
          "SELECT approval_instance_id FROM payment_request WHERE id = ?"
        )
          .bind(id)
          .first<{ approval_instance_id: number | null }>();

        if (latest?.approval_instance_id) {
          instanceIdForPayload = latest.approval_instance_id;
          const latestInstance = await c.env.DB.prepare(
            "SELECT instance_no FROM approval_instance WHERE id = ?"
          )
            .bind(latest.approval_instance_id)
            .first<{ instance_no: string }>();
          instanceNoForPayload = latestInstance?.instance_no ?? instanceNoForPayload;
        } else {
          throw new Error("Payment request lost approval binding during submission");
        }
      }
    } catch (error) {
      const recoveredApproval = await reconcilePaymentStatusWithApproval(
        c.env.DB,
        id,
        {
          status: "pending_approval",
          approval_instance_id: null
        },
        now
      );

      if (!recoveredApproval) {
        await c.env.DB.prepare(
          `UPDATE payment_request
              SET status = 'draft', updated_at = ?
            WHERE id = ? AND status = 'pending_approval' AND approval_instance_id IS NULL`
        )
          .bind(now, id)
          .run();
      }

      await abandonIdempotentRequest(c.env.DB, `payment:submit-approval:${id}`, auth.sub, idempotencyKey);
      throw error;
    }

    await enqueuePaymentRiskAssessment(c.env, request);

    await writeAuditLog(c.env.DB, {
      actorUserId: auth.sub,
      actorRoles: auth.roles,
      action: "payment_request.submit_approval",
      targetType: "payment_request",
      targetId: id,
      detail: {
        approval_instance_id: instanceIdForPayload,
        instance_no: instanceNoForPayload
      }
    });

    const payload = {
      success: true,
      data: {
        approval_instance_id: instanceIdForPayload,
        instance_no: instanceNoForPayload
      }
    };
    await completeIdempotentRequest(c.env.DB, `payment:submit-approval:${id}`, auth.sub, idempotencyKey, 200, payload);

    return c.json(payload);
  }
);

paymentRoutes.post(
  "/:id/mark-paid",
  requireRoles(["super_admin", "manager", "finance"]),
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

    if (pr.status !== "approved" && pr.status !== "paid") {
      return c.json(
        { success: false, error: { message: "Only approved requests can be marked as paid" } },
        400
      );
    }

    if (pr.status === "paid") {
      if (pr.contract_id !== null) {
        await syncContractPaidAmount(c.env.DB, pr.contract_id, now);
      }
      return c.json({ success: true });
    }

    const idempotencyKey = c.req.header("Idempotency-Key");
    const idempotency = await beginIdempotentRequest<{ success: boolean }>(
      c.env.DB,
      `payment:mark-paid:${id}`,
      auth.sub,
      idempotencyKey
    );
    if (idempotency.kind === "replay") {
      return c.json(idempotency.payload);
    }
    if (idempotency.kind === "pending") {
      return c.json({ success: false, error: { message: "Mark-paid operation already in progress" } }, 409);
    }

    const paidAt = body.paid_at?.trim() ? body.paid_at : now;
    try {
      const updateRequest = await c.env.DB.prepare(
        `UPDATE payment_request SET
          status = 'paid',
          paid_at = ?,
          paid_by_userid = ?,
          payment_reference = COALESCE(?, payment_reference),
          payment_account = COALESCE(?, payment_account),
          remark = COALESCE(?, remark),
          updated_at = ?
        WHERE id = ? AND status = 'approved'`
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

      if ((updateRequest.meta.changes ?? 0) !== 1) {
        const latest = await c.env.DB.prepare(
          "SELECT status, contract_id FROM payment_request WHERE id = ?"
        )
          .bind(id)
          .first<{ status: string; contract_id: number | null }>();

        if (latest?.status === "paid") {
          if (latest.contract_id !== null) {
            await syncContractPaidAmount(c.env.DB, latest.contract_id, now);
          }
        } else {
          throw new Error("Payment request is no longer approved");
        }
      }

      if (pr.contract_id !== null) {
        await syncContractPaidAmount(c.env.DB, pr.contract_id, now);
      }
    } catch (error) {
      await abandonIdempotentRequest(c.env.DB, `payment:mark-paid:${id}`, auth.sub, idempotencyKey);
      if (isPaymentNoLongerApprovedError(error)) {
        return c.json(
          {
            success: false,
            error: { message: "Payment request is no longer approved" }
          },
          409
        );
      }
      throw error;
    }

    try {
      await publishEvent(c.env, "PAYMENT_COMPLETED", "payment_request", {
        payment_request_id: id,
        serial_no: pr.serial_no,
        contract_id: pr.contract_id,
        amount: pr.amount
      });
    } catch (error) {
      console.error("Failed to publish payment completed event", error);
    }

    try {
      await writeAuditLog(c.env.DB, {
        actorUserId: auth.sub,
        actorRoles: auth.roles,
        action: "payment_request.mark_paid",
        targetType: "payment_request",
        targetId: id,
        detail: {
          paid_at: paidAt,
          amount: pr.amount,
          contract_id: pr.contract_id,
          payment_reference: body.payment_reference?.trim() || null
        }
      });
    } catch (error) {
      console.error("Failed to write payment mark-paid audit log", error);
    }

    const payload = { success: true };
    await completeIdempotentRequest(c.env.DB, `payment:mark-paid:${id}`, auth.sub, idempotencyKey, 200, payload);

    return c.json(payload);
  }
);

paymentRoutes.post(
  "/:id/void",
  requireRoles(["super_admin"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const auth = c.get("auth");
    const body = (await c.req.json().catch(() => ({}))) as VoidPaymentBody;
    const now = nowIso();

    const pr = await c.env.DB.prepare(
      "SELECT * FROM payment_request WHERE id = ?"
    )
      .bind(id)
      .first<PaymentRequest>();

    if (!pr) {
      return c.json({ success: false, error: { message: "Payment request not found" } }, 404);
    }

    if (pr.status === "cancelled") {
      return c.json(
        { success: false, error: { message: "Payment request is already cancelled" } },
        400
      );
    }

    const reason = body.reason?.trim();
    const voidLog = `[VOID ${now}] ${auth.sub}${reason ? `: ${reason}` : ""}`;
    const mergedRemark = `${(pr.remark ?? "").trim()}\n${voidLog}`.trim();

    await c.env.DB.prepare(
      `UPDATE payment_request
          SET status = 'cancelled',
              remark = ?,
              updated_at = ?
        WHERE id = ?`
    )
      .bind(mergedRemark || null, now, id)
      .run();

    if (pr.status === "paid" && pr.contract_id !== null) {
      await c.env.DB.prepare(
        `UPDATE contract
            SET paid_amount = CASE WHEN paid_amount >= ? THEN paid_amount - ? ELSE 0 END,
                updated_at = ?
          WHERE id = ?`
      )
        .bind(pr.amount, pr.amount, now, pr.contract_id)
        .run();
    }

    if (pr.approval_instance_id) {
      await c.env.DB.prepare(
        `UPDATE approval_task
            SET status = 'cancelled',
                updated_at = ?
          WHERE instance_id = ?
            AND status IN ('pending', 'in_progress')`
      )
        .bind(now, pr.approval_instance_id)
        .run();

      await c.env.DB.prepare(
        `UPDATE approval_instance
            SET status = 'cancelled',
                completed_at = COALESCE(completed_at, ?),
                updated_at = ?
          WHERE id = ?
            AND status IN ('pending', 'in_progress')`
      )
        .bind(now, now, pr.approval_instance_id)
        .run();
    }

    await publishEvent(c.env, "PAYMENT_CANCELLED", "payment_request", {
      payment_request_id: id,
      serial_no: pr.serial_no,
      previous_status: pr.status,
      reason: reason || null,
      cancelled_by: auth.sub,
      contract_id: pr.contract_id
    });

    await writeAuditLog(c.env.DB, {
      actorUserId: auth.sub,
      actorRoles: auth.roles,
      action: "payment_request.void",
      targetType: "payment_request",
      targetId: id,
      detail: {
        previous_status: pr.status,
        reason: reason || null,
        contract_id: pr.contract_id
      }
    });

    return c.json({ success: true });
  }
);

paymentRoutes.post(
  "/:id/reactivate",
  requireRoles(["super_admin"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const auth = c.get("auth");
    const now = nowIso();

    const pr = await c.env.DB.prepare(
      "SELECT * FROM payment_request WHERE id = ?"
    )
      .bind(id)
      .first<PaymentRequest>();

    if (!pr) {
      return c.json({ success: false, error: { message: "Payment request not found" } }, 404);
    }

    if (pr.status !== "cancelled") {
      return c.json(
        {
          success: false,
          error: { message: "Only cancelled payment requests can be reactivated" }
        },
        400
      );
    }

    const reactivateLog = `[REACTIVATE ${now}] ${auth.sub}`;
    const mergedRemark = `${(pr.remark ?? "").trim()}\n${reactivateLog}`.trim();

    await c.env.DB.prepare(
      `UPDATE payment_request
          SET status = 'draft',
              approval_instance_id = NULL,
              paid_at = NULL,
              paid_by_userid = NULL,
              payment_reference = NULL,
              updated_at = ?,
              remark = ?
        WHERE id = ?`
    )
      .bind(now, mergedRemark || null, id)
      .run();

    await publishEvent(c.env, "PAYMENT_REACTIVATED", "payment_request", {
      payment_request_id: id,
      serial_no: pr.serial_no,
      reactivated_by: auth.sub,
      previous_status: pr.status,
      contract_id: pr.contract_id
    });

    await writeAuditLog(c.env.DB, {
      actorUserId: auth.sub,
      actorRoles: auth.roles,
      action: "payment_request.reactivate",
      targetType: "payment_request",
      targetId: id,
      detail: {
        previous_status: pr.status,
        contract_id: pr.contract_id
      }
    });

    return c.json({ success: true });
  }
);

paymentRoutes.post(
  "/:id/trigger-risk-assessment",
  requireRoles(["super_admin", "manager", "site_manager", "finance"]),
  async (c) => {
    const id = Number(c.req.param("id"));

    const pr = await c.env.DB.prepare(
      "SELECT * FROM payment_request WHERE id = ?"
    )
      .bind(id)
      .first<PaymentRequest>();

    if (!pr) {
      return c.json({ success: false, error: { message: "Payment request not found" } }, 404);
    }

    await enqueuePaymentRiskAssessment(c.env, pr);

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
