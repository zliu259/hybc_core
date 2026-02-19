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
import { generateSerial } from "../services/serial";
import { publishEvent } from "../services/event-bus";
import { createTask } from "../services/ai-slot";
import { submitForApproval } from "../services/approval/engine";

const nowIso = () => new Date().toISOString();

type SubmitApprovalOptions = {
  biz_summary?: string;
  instance_config?: InstanceConfig;
};

export const contractRoutes = new Hono<{
  Bindings: Env;
  Variables: AuthVariables;
}>();

contractRoutes.use("*", authMiddleware);

contractRoutes.get("/", async (c) => {
  const direction = c.req.query("direction");
  const projectId = c.req.query("project_id");
  const entityId = c.req.query("entity_id");
  const status = c.req.query("status");
  const keyword = c.req.query("keyword");
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
  requireRoles(["super_admin", "manager", "site_manager"]),
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
  requireRoles(["super_admin", "manager", "site_manager"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const body = (await c.req.json()) as UpdateContractRequest;
    const now = nowIso();

    const existing = await c.env.DB.prepare(
      "SELECT * FROM contract WHERE id = ? AND status != 'deleted'"
    )
      .bind(id)
      .first<Contract>();

    if (!existing) {
      return c.json({ success: false, error: { message: "Contract not found" } }, 404);
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
        body.remark ?? null,
        body.status ?? null,
        now,
        id
      )
      .run();

    return c.json({ success: true });
  }
);

contractRoutes.delete(
  "/:id",
  requireRoles(["super_admin", "manager"]),
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
  requireRoles(["super_admin", "manager", "site_manager"]),
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

    if (contract.status !== "draft" && contract.status !== "pending_review") {
      return c.json(
        { success: false, error: { message: "Only draft/pending_review contracts can be submitted" } },
        400
      );
    }

    if (contract.approval_instance_id) {
      const existing = await c.env.DB.prepare(
        "SELECT status FROM approval_instance WHERE id = ?"
      )
        .bind(contract.approval_instance_id)
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
        biz_type: contract.direction === "outbound" ? "outbound_contract" : "inbound_contract",
        biz_id: id,
        biz_summary:
          body.biz_summary?.trim() ||
          `${contract.contract_no} | ${contract.counterparty} | ${contract.total_amount}`,
        context: {
          amount: contract.total_amount,
          entity_id: contract.entity_id,
          project_id: contract.project_id,
          biz_type: "outbound_contract",
          biz_id: id
        },
        instance_config: body.instance_config
      },
      auth.sub
    );

    await c.env.DB.prepare(
      "UPDATE contract SET status = 'pending_approval', approval_instance_id = ?, updated_at = ? WHERE id = ?"
    )
      .bind(instance.id, nowIso(), id)
      .run();

    return c.json({
      success: true,
      data: { approval_instance_id: instance.id, instance_no: instance.instance_no }
    });
  }
);

contractRoutes.post(
  "/:id/amount-change",
  requireRoles(["super_admin", "manager"]),
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
  requireRoles(["super_admin", "manager"]),
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
      auth.sub
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
  requireRoles(["super_admin", "manager"]),
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
