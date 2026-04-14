import { Hono } from "hono";

import { authMiddleware, type AuthVariables } from "../middleware/auth";
import { requireRoles } from "../middleware/rbac";
import type { Env } from "../types/env";
import type {
  Contract,
  CreateContractRequest,
  UpdateContractRequest,
  ContractAmountChange,
  CreateAmountChangeRequest
} from "../types/contract";
import type { InstanceConfig } from "../types/approval";
import { writeAuditLog } from "../services/audit-log";
import { generateSerial } from "../services/serial";
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

type SubmitApprovalOptions = {
  biz_summary?: string;
  instance_config?: InstanceConfig;
};

type AttachmentMeta = {
  file_key: string;
  file_name: string;
  file_size?: number | null;
  file_url: string;
};

type ApprovalInstanceLite = {
  id: number;
  instance_no: string;
  status: string;
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

const mapApprovalInstanceStatusToContractStatus = (
  approvalStatus: string
): Contract["status"] | null => {
  if (approvalStatus === "pending" || approvalStatus === "in_progress") {
    return "pending_approval";
  }
  if (approvalStatus === "approved" || approvalStatus === "completed") {
    return "active";
  }
  if (approvalStatus === "rejected") {
    return "draft";
  }
  return null;
};

const isContractStatusReconcileEligible = (
  contractStatus: Contract["status"]
): boolean => {
  return (
    contractStatus === "draft" ||
    contractStatus === "pending_review" ||
    contractStatus === "pending_approval"
  );
};

const findLatestApprovalInstanceForContract = async (
  db: D1Database,
  contractId: number,
  bizType: "outbound_contract" | "inbound_contract"
): Promise<ApprovalInstanceLite | null> => {
  return await db
    .prepare(
      `SELECT id, instance_no, status
         FROM approval_instance
        WHERE biz_type = ?
          AND biz_id = ?
        ORDER BY id DESC
        LIMIT 1`
    )
    .bind(bizType, contractId)
    .first<ApprovalInstanceLite>();
};

const reconcileContractStatusWithApproval = async (
  db: D1Database,
  contractId: number,
  bizType: "outbound_contract" | "inbound_contract",
  contract: Pick<Contract, "status" | "approval_instance_id">,
  now: string
): Promise<ApprovalInstanceLite | null> => {
  if (!isContractStatusReconcileEligible(contract.status)) {
    return null;
  }

  const latestApproval = await findLatestApprovalInstanceForContract(
    db,
    contractId,
    bizType
  );
  if (!latestApproval) return null;

  const targetStatus = mapApprovalInstanceStatusToContractStatus(
    latestApproval.status
  );
  if (!targetStatus) return null;

  const hasLinkedApproval =
    contract.approval_instance_id !== null &&
    contract.approval_instance_id === latestApproval.id;
  const statusAlreadyAligned = contract.status === targetStatus;
  if (hasLinkedApproval && statusAlreadyAligned) {
    return latestApproval;
  }

  await db
    .prepare(
      `UPDATE contract
          SET status = ?,
              approval_instance_id = ?,
              updated_at = ?
        WHERE id = ?`
    )
    .bind(targetStatus, latestApproval.id, now, contractId)
    .run();

  return latestApproval;
};

export const contractRoutes = new Hono<{
  Bindings: Env;
  Variables: AuthVariables;
}>();

contractRoutes.use("*", authMiddleware);

contractRoutes.get("/", async (c) => {
  const direction = c.req.query("direction");
  const projectId = c.req.query("project_id");
  const projectName = c.req.query("project_name");
  const entityId = c.req.query("entity_id");
  const status = c.req.query("status");
  const keyword = c.req.query("keyword");
  const applicantUserid = c.req.query("applicant_userid");
  const dateFrom = c.req.query("date_from");
  const dateTo = c.req.query("date_to");
  const legacyDataId = c.req.query("legacy_data_id");
  const page = Number(c.req.query("page") ?? "1");
  const pageSize = Number(c.req.query("pageSize") ?? "20");
  const offset = (page - 1) * pageSize;

  let sql = "SELECT * FROM contract WHERE status != 'deleted'";
  let countSql = "SELECT COUNT(*) as total FROM contract WHERE status != 'deleted'";
  const params: (string | number)[] = [];

  if (direction) {
    sql += " AND direction = ?";
    countSql += " AND direction = ?";
    params.push(direction);
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
  if (entityId) {
    sql += " AND entity_id = ?";
    countSql += " AND entity_id = ?";
    params.push(Number(entityId));
  }
  if (status) {
    sql += " AND status = ?";
    countSql += " AND status = ?";
    params.push(status);
  }
  if (keyword) {
    sql += " AND (contract_no LIKE ? OR counterparty LIKE ? OR remark LIKE ?)";
    countSql += " AND (contract_no LIKE ? OR counterparty LIKE ? OR remark LIKE ?)";
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }
  if (applicantUserid) {
    sql += " AND handler_userid = ?";
    countSql += " AND handler_userid = ?";
    params.push(applicantUserid);
  }
  if (dateFrom) {
    sql += " AND contract_date >= ?";
    countSql += " AND contract_date >= ?";
    params.push(dateFrom);
  }
  if (dateTo) {
    sql += " AND contract_date <= ?";
    countSql += " AND contract_date <= ?";
    params.push(dateTo);
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
    .all<Contract>();

  return c.json({
    success: true,
    data: rows.results ?? [],
    pagination: { page, pageSize, total }
  });
});

contractRoutes.get("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const contract = await c.env.DB.prepare(
    "SELECT * FROM contract WHERE id = ? AND status != 'deleted'"
  )
    .bind(id)
    .first<Contract>();

  if (!contract) {
    return c.json({ success: false, error: { message: "Contract not found" } }, 404);
  }

  const changes = await c.env.DB.prepare(
    "SELECT * FROM contract_amount_change WHERE contract_id = ? ORDER BY id DESC"
  )
    .bind(id)
    .all<ContractAmountChange>();

  const payments = await c.env.DB.prepare(
    "SELECT id, serial_no, amount, status, created_at FROM payment_request WHERE contract_id = ? ORDER BY id DESC"
  )
    .bind(id)
    .all();

  return c.json({
    success: true,
    data: {
      ...contract,
      amount_changes: changes.results ?? [],
      payment_requests: payments.results ?? []
    }
  });
});

contractRoutes.post(
  "/",
  requireRoles(["super_admin", "manager", "site_manager", "finance"]),
  async (c) => {
    const auth = c.get("auth");
    const body = (await c.req.json()) as CreateContractRequest;
    const now = nowIso();
    const contractNo = await generateSerial(c.env.DB, "CT", "contract", "contract_no");

    const result = await c.env.DB.prepare(
      `INSERT INTO contract
        (contract_no, direction, project_id, entity_id, counterparty, contract_type,
         handler_userid, contract_date, total_amount, paid_amount, invoiced_amount,
         received_amount, status, ai_review_status, attachments_json, remark,
         created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 'draft', 'none', ?, ?, ?, ?)`
    )
      .bind(
        contractNo,
        body.direction,
        body.project_id,
        body.entity_id,
        body.counterparty,
        body.contract_type,
        body.handler_userid,
        body.contract_date,
        body.total_amount,
        body.attachments_json ?? null,
        body.remark ?? null,
        now,
        now
      )
      .run();

    const contractId = result.meta.last_row_id;

    await publishEvent(c.env, "CONTRACT_CREATED", "contract", {
      contract_id: contractId,
      contract_no: contractNo,
      direction: body.direction,
      total_amount: body.total_amount,
      created_by: auth.sub
    });

    if (body.attachments_json) {
      try {
        const attachments = JSON.parse(body.attachments_json);
        if (Array.isArray(attachments) && attachments.length > 0) {
          await c.env.DB.prepare(
            "UPDATE contract SET ai_review_status = 'pending', updated_at = ? WHERE id = ?"
          )
            .bind(now, contractId)
            .run();

          await createTask(c.env, {
            task_type: "contract_review",
            biz_type: "contract",
            biz_id: contractId as number,
            priority: 3,
            payload: {
              contract_id: contractId,
              contract_no: contractNo,
              counterparty: body.counterparty,
              contract_type: body.contract_type,
              total_amount: body.total_amount,
              attachments: attachments
            },
            timeout_seconds: 600
          });
        }
      } catch {
        // attachment parsing failed — skip AI review
      }
    }

    return c.json(
      { success: true, data: { id: contractId, contract_no: contractNo } },
      201
    );
  }
);

contractRoutes.put(
  "/:id",
  requireRoles(["super_admin", "manager", "site_manager", "finance"]),
  async (c) => {
    const auth = c.get("auth");
    const id = Number(c.req.param("id"));
    const body = (await c.req.json()) as UpdateContractRequest;
    const now = nowIso();
    const isSuperAdmin = auth.roles.includes("super_admin");

    const existing = await c.env.DB.prepare(
      "SELECT * FROM contract WHERE id = ? AND status != 'deleted'"
    )
      .bind(id)
      .first<Contract>();

    if (!existing) {
      return c.json({ success: false, error: { message: "Contract not found" } }, 404);
    }

    const hasDetailMutation =
      body.counterparty !== undefined ||
      body.contract_type !== undefined ||
      body.handler_userid !== undefined ||
      body.contract_date !== undefined ||
      body.total_amount !== undefined ||
      body.attachments_json !== undefined ||
      body.remark !== undefined ||
      body.status !== undefined;

    const hasNonAttachmentMutation =
      body.counterparty !== undefined ||
      body.contract_type !== undefined ||
      body.handler_userid !== undefined ||
      body.contract_date !== undefined ||
      body.total_amount !== undefined ||
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
      if (approvalInProgress && hasDetailMutation) {
        return c.json(
          {
            success: false,
            error: {
              message: "Contract details are locked while approval is in progress"
            }
          },
          400
        );
      }

      if (approvalFinished && hasNonAttachmentMutation) {
        return c.json(
          {
            success: false,
            error: {
              message:
                "Approval is finished. Only attachment upload is allowed. To modify amount, use contract amount change flow."
            }
          },
          400
        );
      }

      if (existing.status !== "draft" && body.total_amount !== undefined) {
        return c.json(
          {
            success: false,
            error: {
              message: "Cannot modify total_amount on non-draft contract. Use amount change API instead."
            }
          },
          400
        );
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

    const auditRemark =
      isSuperAdmin && hasNonAttachmentMutation
        ? `${(body.remark ?? existing.remark ?? "").trim()}\n[SUPER_ADMIN_EDIT ${now}] ${auth.sub}: ${body.edit_note?.trim()}`.trim()
        : body.remark;

    await c.env.DB.prepare(
      `UPDATE contract SET
        counterparty = COALESCE(?, counterparty),
        contract_type = COALESCE(?, contract_type),
        handler_userid = COALESCE(?, handler_userid),
        contract_date = COALESCE(?, contract_date),
        total_amount = COALESCE(?, total_amount),
        attachments_json = COALESCE(?, attachments_json),
        remark = COALESCE(?, remark),
        status = COALESCE(?, status),
        updated_at = ?
        WHERE id = ?`
    )
      .bind(
        body.counterparty ?? null,
        body.contract_type ?? null,
        body.handler_userid ?? null,
        body.contract_date ?? null,
        body.total_amount ?? null,
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
        action: "contract.super_admin_edit",
        targetType: "contract",
        targetId: id,
        detail: {
          edit_note: body.edit_note?.trim() ?? null,
          has_detail_mutation: hasDetailMutation,
          has_non_attachment_mutation: hasNonAttachmentMutation
        }
      });
    }

    return c.json({ success: true });
  }
);

contractRoutes.delete(
  "/:id",
  requireRoles(["super_admin", "manager", "finance"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    await c.env.DB.prepare(
      "UPDATE contract SET status = 'deleted', updated_at = ? WHERE id = ?"
    )
      .bind(nowIso(), id)
      .run();

    return c.json({ success: true });
  }
);

contractRoutes.post(
  "/:id/submit-approval",
  requireRoles(["super_admin", "manager", "site_manager", "finance"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const auth = c.get("auth");
    const body = (await c.req.json().catch(() => ({}))) as SubmitApprovalOptions;

    const contract = await c.env.DB.prepare(
      "SELECT * FROM contract WHERE id = ? AND status != 'deleted'"
    )
      .bind(id)
      .first<Contract>();

    if (!contract) {
      return c.json({ success: false, error: { message: "Contract not found" } }, 404);
    }

    if (contract.direction !== "outbound" && contract.direction !== "inbound") {
      return c.json(
        { success: false, error: { message: "Only outbound/inbound contracts can submit this approval flow" } },
        400
      );
    }

    const now = nowIso();
    const bizType =
      contract.direction === "outbound" ? "outbound_contract" : "inbound_contract";

    let effectiveStatus = contract.status;
    let effectiveApprovalInstanceId = contract.approval_instance_id;

    const reconciledApproval = await reconcileContractStatusWithApproval(
      c.env.DB,
      id,
      bizType,
      {
        status: contract.status,
        approval_instance_id: contract.approval_instance_id
      },
      now
    );

    if (reconciledApproval) {
      const mappedStatus = mapApprovalInstanceStatusToContractStatus(
        reconciledApproval.status
      );
      if (mappedStatus) {
        effectiveStatus = mappedStatus;
        effectiveApprovalInstanceId = reconciledApproval.id;
      }
    }

    if (effectiveStatus === "pending_approval" && effectiveApprovalInstanceId) {
      const existingInstance = await c.env.DB.prepare(
        "SELECT instance_no FROM approval_instance WHERE id = ?"
      )
        .bind(effectiveApprovalInstanceId)
        .first<{ instance_no: string }>();

      return c.json({
        success: true,
        data: {
          approval_instance_id: effectiveApprovalInstanceId,
          instance_no:
            existingInstance?.instance_no ?? reconciledApproval?.instance_no ?? "",
          already_submitted: true,
          recovered: Boolean(reconciledApproval)
        }
      });
    }

    if (effectiveStatus !== "draft" && effectiveStatus !== "pending_review") {
      return c.json(
        { success: false, error: { message: "Only draft/pending_review contracts can be submitted" } },
        400
      );
    }

    const idempotencyKey = c.req.header("Idempotency-Key");
    const idempotency = await beginIdempotentRequest<{
      success: boolean;
      data: { approval_instance_id: number; instance_no: string; resubmitted?: boolean };
    }>(c.env.DB, `contract:submit-approval:${id}`, auth.sub, idempotencyKey);
    if (idempotency.kind === "replay") {
      return c.json(idempotency.payload);
    }
    if (idempotency.kind === "pending") {
      return c.json({ success: false, error: { message: "Approval submission already in progress" } }, 409);
    }

    if (effectiveApprovalInstanceId) {
      const existing = await c.env.DB.prepare(
        "SELECT status FROM approval_instance WHERE id = ?"
      )
        .bind(effectiveApprovalInstanceId)
        .first<{ status: string }>();

      if (existing && existing.status === "in_progress") {
        const currentInstance = await c.env.DB.prepare(
          "SELECT instance_no FROM approval_instance WHERE id = ?"
        )
          .bind(effectiveApprovalInstanceId)
          .first<{ instance_no: string }>();
        const payload = {
          success: true,
          data: {
            approval_instance_id: effectiveApprovalInstanceId,
            instance_no: currentInstance?.instance_no ?? "",
            already_submitted: true
          }
        };
        await completeIdempotentRequest(
          c.env.DB,
          `contract:submit-approval:${id}`,
          auth.sub,
          idempotencyKey,
          200,
          payload
        );
        return c.json(payload);
      }

      if (existing && (existing.status === "pending" || existing.status === "withdrawn")) {
        try {
          await resubmitOp(c.env, effectiveApprovalInstanceId, auth.sub);
          await c.env.DB.prepare(
            "UPDATE contract SET status = 'pending_approval', approval_instance_id = ?, updated_at = ? WHERE id = ?"
          )
            .bind(effectiveApprovalInstanceId, now, id)
            .run();

          const existingInstance = await c.env.DB.prepare(
            "SELECT instance_no FROM approval_instance WHERE id = ?"
          )
            .bind(effectiveApprovalInstanceId)
            .first<{ instance_no: string }>();

          const payload = {
            success: true,
            data: {
              approval_instance_id: effectiveApprovalInstanceId,
              instance_no: existingInstance?.instance_no ?? "",
              resubmitted: true
            }
          };
          await completeIdempotentRequest(c.env.DB, `contract:submit-approval:${id}`, auth.sub, idempotencyKey, 200, payload);
          return c.json(payload);
        } catch (err) {
          await abandonIdempotentRequest(c.env.DB, `contract:submit-approval:${id}`, auth.sub, idempotencyKey);
          const msg = err instanceof Error ? err.message : "Resubmit failed";
          return c.json({ success: false, error: { message: msg } }, 400);
        }
      }
    }

    const claimedDraft = await c.env.DB.prepare(
      `UPDATE contract
          SET status = 'pending_approval', approval_instance_id = NULL, updated_at = ?
        WHERE id = ? AND status IN ('draft', 'pending_review')`
    )
      .bind(now, id)
      .run();

    if ((claimedDraft.meta.changes ?? 0) !== 1) {
      const latest = await c.env.DB.prepare(
        "SELECT status, approval_instance_id FROM contract WHERE id = ?"
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
        await completeIdempotentRequest(
          c.env.DB,
          `contract:submit-approval:${id}`,
          auth.sub,
          idempotencyKey,
          200,
          payload
        );
        return c.json(payload);
      }

      await abandonIdempotentRequest(
        c.env.DB,
        `contract:submit-approval:${id}`,
        auth.sub,
        idempotencyKey
      );
      return c.json(
        { success: false, error: { message: "Contract submission already in progress" } },
        409
      );
    }

    const attachments = parseAttachmentMeta(contract.attachments_json);

    let instanceNoForPayload = "";
    let instanceIdForPayload: number | null = null;
    try {
      const instance = await submitForApproval(
        c.env,
        {
          biz_type: bizType,
          biz_id: id,
          biz_summary:
            body.biz_summary?.trim() ||
            `${contract.contract_no} | ${contract.counterparty} | ${contract.total_amount}`,
          context: {
            amount: contract.total_amount,
            entity_id: contract.entity_id,
            project_id: contract.project_id,
            biz_type: bizType,
            biz_id: id,
            contract: {
              contract_no: contract.contract_no,
              direction: contract.direction,
              counterparty: contract.counterparty,
              contract_type: contract.contract_type,
              handler_userid: contract.handler_userid,
              contract_date: contract.contract_date,
              total_amount: contract.total_amount,
              paid_amount: contract.paid_amount,
              remark: contract.remark ?? null
            },
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
        `UPDATE contract
            SET approval_instance_id = ?, updated_at = ?
          WHERE id = ? AND status = 'pending_approval' AND approval_instance_id IS NULL`
      )
        .bind(instance.id, now, id)
        .run();

      if ((attachResult.meta.changes ?? 0) !== 1) {
        const latest = await c.env.DB.prepare(
          "SELECT approval_instance_id FROM contract WHERE id = ?"
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
          throw new Error("Contract lost approval binding during submission");
        }
      }
    } catch (error) {
      const recoveredApproval = await reconcileContractStatusWithApproval(
        c.env.DB,
        id,
        bizType,
        {
          status: "pending_approval",
          approval_instance_id: null
        },
        now
      );

      if (!recoveredApproval) {
        await c.env.DB.prepare(
          `UPDATE contract
              SET status = 'draft', updated_at = ?
            WHERE id = ? AND status = 'pending_approval' AND approval_instance_id IS NULL`
        )
          .bind(now, id)
          .run();
      }

      await abandonIdempotentRequest(
        c.env.DB,
        `contract:submit-approval:${id}`,
        auth.sub,
        idempotencyKey
      );
      throw error;
    }

    if (instanceIdForPayload === null) {
      await abandonIdempotentRequest(
        c.env.DB,
        `contract:submit-approval:${id}`,
        auth.sub,
        idempotencyKey
      );
      throw new Error("Contract missing approval binding after submission");
    }

    await writeAuditLog(c.env.DB, {
      actorUserId: auth.sub,
      actorRoles: auth.roles,
      action: "contract.submit_approval",
      targetType: "contract",
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
    await completeIdempotentRequest(c.env.DB, `contract:submit-approval:${id}`, auth.sub, idempotencyKey, 200, payload);

    return c.json(payload);
  }
);

contractRoutes.post(
  "/:id/amount-change",
  requireRoles(["super_admin", "manager", "finance"]),
  async (c) => {
    const contractId = Number(c.req.param("id"));
    const auth = c.get("auth");
    const body = (await c.req.json()) as CreateAmountChangeRequest;
    const now = nowIso();

    const contract = await c.env.DB.prepare(
      "SELECT * FROM contract WHERE id = ? AND status != 'deleted'"
    )
      .bind(contractId)
      .first<Contract>();

    if (!contract) {
      return c.json({ success: false, error: { message: "Contract not found" } }, 404);
    }

    if (contract.status !== "active") {
      return c.json(
        { success: false, error: { message: "Amount change only allowed on active contracts" } },
        400
      );
    }

    if (body.new_amount < contract.paid_amount) {
      return c.json(
        {
          success: false,
          error: { message: `New amount (${body.new_amount}) cannot be less than already paid (${contract.paid_amount})` }
        },
        400
      );
    }

    const result = await c.env.DB.prepare(
      `INSERT INTO contract_amount_change
        (contract_id, change_type, old_amount, new_amount, reason, status,
         applicant_userid, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)`
    )
      .bind(
        contractId,
        body.change_type,
        contract.total_amount,
        body.new_amount,
        body.reason,
        auth.sub,
        now,
        now
      )
      .run();

    return c.json(
      { success: true, data: { id: result.meta.last_row_id } },
      201
    );
  }
);

contractRoutes.post(
  "/:id/amount-change/:changeId/submit-approval",
  requireRoles(["super_admin", "manager", "finance"]),
  async (c) => {
    const contractId = Number(c.req.param("id"));
    const changeId = Number(c.req.param("changeId"));
    const auth = c.get("auth");
    const body = (await c.req.json().catch(() => ({}))) as SubmitApprovalOptions;

    const contract = await c.env.DB.prepare(
      "SELECT * FROM contract WHERE id = ? AND status != 'deleted'"
    )
      .bind(contractId)
      .first<Contract>();

    if (!contract) {
      return c.json({ success: false, error: { message: "Contract not found" } }, 404);
    }

    const change = await c.env.DB.prepare(
      "SELECT * FROM contract_amount_change WHERE id = ? AND contract_id = ?"
    )
      .bind(changeId, contractId)
      .first<ContractAmountChange>();

    if (!change) {
      return c.json({ success: false, error: { message: "Amount change record not found" } }, 404);
    }

    if (change.status !== "pending") {
      return c.json(
        { success: false, error: { message: "Only pending amount changes can be submitted" } },
        400
      );
    }

    if (change.approval_instance_id) {
      const existing = await c.env.DB.prepare(
        "SELECT status FROM approval_instance WHERE id = ?"
      )
        .bind(change.approval_instance_id)
        .first<{ status: string }>();

      if (existing && (existing.status === "pending" || existing.status === "in_progress")) {
        return c.json(
          { success: false, error: { message: "Approval instance already in progress" } },
          400
        );
      }
    }

    const instance = await submitForApproval(
      c.env,
      {
        biz_type: "contract_amount_change",
        biz_id: changeId,
        biz_summary:
          body.biz_summary?.trim() ||
          `${contract.contract_no} 金额变更 ${change.old_amount} -> ${change.new_amount}`,
        context: {
          amount: change.new_amount,
          entity_id: contract.entity_id,
          project_id: contract.project_id,
          biz_type: "contract_amount_change",
          biz_id: changeId
        },
        instance_config: body.instance_config
      },
      auth.sub,
      createAiGateHandler()
    );

    await c.env.DB.prepare(
      "UPDATE contract_amount_change SET approval_instance_id = ?, updated_at = ? WHERE id = ?"
    )
      .bind(instance.id, nowIso(), changeId)
      .run();

    return c.json({
      success: true,
      data: { approval_instance_id: instance.id, instance_no: instance.instance_no }
    });
  }
);

contractRoutes.get("/:id/ai-review", async (c) => {
  const id = Number(c.req.param("id"));
  const contract = await c.env.DB.prepare(
    "SELECT ai_review_status, ai_review_result FROM contract WHERE id = ?"
  )
    .bind(id)
    .first<Pick<Contract, "ai_review_status" | "ai_review_result">>();

  if (!contract) {
    return c.json({ success: false, error: { message: "Contract not found" } }, 404);
  }

  let parsedResult = null;
  if (contract.ai_review_result) {
    try {
      parsedResult = JSON.parse(contract.ai_review_result);
    } catch {
      parsedResult = contract.ai_review_result;
    }
  }

  return c.json({
    success: true,
    data: {
      status: contract.ai_review_status,
      result: parsedResult
    }
  });
});

contractRoutes.post(
  "/:id/trigger-review",
  requireRoles(["super_admin", "manager", "finance"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const now = nowIso();

    const contract = await c.env.DB.prepare(
      "SELECT * FROM contract WHERE id = ? AND status != 'deleted'"
    )
      .bind(id)
      .first<Contract>();

    if (!contract) {
      return c.json({ success: false, error: { message: "Contract not found" } }, 404);
    }

    await c.env.DB.prepare(
      "UPDATE contract SET ai_review_status = 'pending', updated_at = ? WHERE id = ?"
    )
      .bind(now, id)
      .run();

    let attachments: string[] = [];
    if (contract.attachments_json) {
      try {
        attachments = JSON.parse(contract.attachments_json);
      } catch {
        // ignore
      }
    }

    await createTask(c.env, {
      task_type: "contract_review",
      biz_type: "contract",
      biz_id: id,
      priority: 3,
      payload: {
        contract_id: id,
        contract_no: contract.contract_no,
        counterparty: contract.counterparty,
        contract_type: contract.contract_type,
        total_amount: contract.total_amount,
        attachments
      },
      timeout_seconds: 600
    });

    return c.json({ success: true });
  }
);
