// packages/api/src/routes/contract-precheck.ts
// 实用工具·合同预审：上传对方合同（前端提取文本）→ CF AI 多维合规审计 + 红线规则 →
// 意见/修改建议 → 无明显错误且确认签署后转入合同台账进入审批。
// 人在环：mutation 一律拒绝 mcp_agent 令牌（与合同起草同规）。
import { Hono } from "hono";
import { authMiddleware, type AuthVariables } from "../middleware/auth";
import { requireRoles } from "../middleware/rbac";
import type { Env } from "../types/env";
import { createTask } from "../services/ai-slot";
import { writeAuditLog } from "../services/audit-log";
import { CF_AI_REVIEW_MODEL, executeCfAiTask } from "../services/cf-ai";
import { generateSerial } from "../services/serial";

const ROLES = ["super_admin", "manager", "finance"] as const;
const MAX_TITLE = 120;
const MAX_COUNTERPARTY = 120;
const MAX_TEXT = 150_000;
const MIN_TEXT = 50;
const DIRECTION_LABELS: Record<string, string> = {
  inbound: "inbound（我方为乙方/出租方/劳务承包人/卖方，即我方收款）",
  outbound: "outbound（我方为甲方/承租方/发包人/买方，即我方付款）"
};

const nowIso = () => new Date().toISOString();
/** 北京时区日历日（Workers 运行在 UTC，直接 slice ISO 会在北京 0-8 点差一天） */
const todayBeijing = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);

interface PrecheckRow {
  id: number;
  precheck_no: string;
  title: string;
  direction: string;
  counterparty: string | null;
  created_by_userid: string;
  status: string;
  current_round: number;
  file_key: string | null;
  file_name: string | null;
  file_size: number | null;
  contract_text: string | null;
  review_task_id: number | null;
  review_result_json: string | null;
  adopted_json: string | null;
  signed_confirmed_at: string | null;
  signed_comment: string | null;
  contract_id: number | null;
  transferred_at: string | null;
  created_at: string;
  updated_at: string;
}

export const contractPrecheckRoutes = new Hono<{
  Bindings: Env;
  Variables: AuthVariables;
}>();

contractPrecheckRoutes.use("*", authMiddleware);
contractPrecheckRoutes.use("*", requireRoles([...ROLES]));

// 预审与签署确认是人本人业务：泄漏的 agent 令牌不得代为操作
contractPrecheckRoutes.use("*", async (c, next) => {
  const auth = c.get("auth");
  if (c.req.method !== "GET" && auth.auth_method === "mcp_agent") {
    return c.json({ success: false, error: { message: "该操作不对 agent 令牌开放" } }, 403);
  }
  await next();
});

// 有意宽于合同起草（仅 owner+super_admin）：预审对象是真实对方合同，
// manager 需要跨员工监督/接手单据；PUT/DELETE 等跨人操作均写审计日志留痕。
const canAccess = (row: PrecheckRow, auth: { sub: string; roles: string[] }): boolean => {
  if (row.created_by_userid === auth.sub) return true;
  return auth.roles.includes("super_admin") || auth.roles.includes("manager");
};

const loadPrecheck = async (env: Env, id: number): Promise<PrecheckRow | null> => {
  if (!Number.isFinite(id) || id <= 0) return null;
  return await env.DB.prepare("SELECT * FROM contract_precheck WHERE id = ? AND status != 'deleted'")
    .bind(id)
    .first<PrecheckRow>();
};

/** 序列化列表/详情行：contract_text 不随列表下发（大字段） */
const toListRow = (row: PrecheckRow) => ({
  id: row.id,
  precheck_no: row.precheck_no,
  title: row.title,
  direction: row.direction,
  counterparty: row.counterparty,
  created_by_userid: row.created_by_userid,
  status: row.status,
  current_round: row.current_round,
  file_name: row.file_name,
  contract_id: row.contract_id,
  created_at: row.created_at,
  updated_at: row.updated_at
});

interface ReviewInput {
  fileKey: string;
  fileName: string;
  fileSize: number | null;
  contractText: string;
}

const parseReviewInput = (body: Record<string, unknown>): { ok: true; value: ReviewInput } | { ok: false; message: string } => {
  const fileKey = typeof body.file_key === "string" ? body.file_key.trim() : "";
  const fileName = typeof body.file_name === "string" ? body.file_name.trim().slice(0, 200) : "";
  const fileSize = typeof body.file_size === "number" && Number.isFinite(body.file_size) ? body.file_size : null;
  const contractText = typeof body.contract_text === "string" ? body.contract_text.trim() : "";
  if (!fileKey.startsWith("contract-precheck/") || fileKey.length > 512) {
    return { ok: false, message: "缺少合同原件（需先上传 docx/pdf）" };
  }
  if (contractText.length < MIN_TEXT) {
    return { ok: false, message: "合同文本过短，请确认文件已正确解析" };
  }
  if (contractText.length > MAX_TEXT) {
    return { ok: false, message: `合同文本过长（上限 ${MAX_TEXT} 字符），请拆分后分别预审` };
  }
  return { ok: true, value: { fileKey, fileName: fileName || "合同文件", fileSize, contractText } };
};

/**
 * 原件存在性校验：contract_text 由前端提取、属客户端自证，这里至少保证
 * file_key 指向真实 R2 对象。深层防线：转入后的合同走审批时，审批 AI 关卡
 * 会带原件附件由 runner 服务端提取重审，伪造文本骗过预审也过不了审批关。
 */
const verifyOriginalFile = async (env: Env, fileKey: string): Promise<string | null> => {
  const head = await env.FILES.head(fileKey);
  if (!head) return "合同原件不存在，请重新上传";
  return null;
};

/** 创建审计任务（建单首审与复审共用）；调用方必须已完成状态抢占 */
const enqueueReviewTask = async (
  c: { env: Env; executionCtx: { waitUntil(p: Promise<unknown>): void } },
  row: { id: number; title: string; direction: string; counterparty: string | null },
  round: number,
  input: ReviewInput
): Promise<number> => {
  const now = nowIso();
  const task = await createTask(c.env, {
    task_type: "contract_precheck_review",
    biz_type: "contract_precheck",
    biz_id: row.id,
    priority: 6,
    timeout_seconds: 300,
    payload: {
      precheck_id: row.id,
      round,
      title: row.title,
      counterparty: row.counterparty ?? "（未填写）",
      direction: row.direction,
      direction_label: DIRECTION_LABELS[row.direction] ?? row.direction,
      contract_text: input.contractText,
      model: CF_AI_REVIEW_MODEL
    }
  });

  await c.env.DB.prepare(
    `UPDATE contract_precheck SET
       current_round = ?, file_key = ?, file_name = ?, file_size = ?,
       contract_text = ?, review_task_id = ?, updated_at = ?
     WHERE id = ?`
  )
    .bind(round, input.fileKey, input.fileName, input.fileSize, input.contractText, task.id, now, row.id)
    .run();

  await c.env.DB.prepare(
    `INSERT INTO contract_precheck_round
       (precheck_id, round, file_key, file_name, task_id, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'reviewing', ?, ?)`
  )
    .bind(row.id, round, input.fileKey, input.fileName, task.id, now, now)
    .run();

  // 生产走 Queue consumer；本地 waitUntil 立即执行 mock（与合同起草同规，勿在生产用 waitUntil）
  if (c.env.APP_ENV === "local") {
    c.executionCtx.waitUntil(executeCfAiTask(c.env, task.id));
  }
  return task.id;
};

// ─── 列表 / 详情 ──────────

contractPrecheckRoutes.get("/", async (c) => {
  const auth = c.get("auth");
  const page = Math.max(1, Number(c.req.query("page") ?? "1") || 1);
  const pageSize = Math.min(50, Math.max(1, Number(c.req.query("pageSize") ?? "20") || 20));
  const offset = (page - 1) * pageSize;

  const seeAll = auth.roles.includes("super_admin") || auth.roles.includes("manager");
  const where = seeAll
    ? "WHERE status != 'deleted'"
    : "WHERE status != 'deleted' AND created_by_userid = ?";
  const params = seeAll ? [] : [auth.sub];

  const count = await c.env.DB.prepare(`SELECT COUNT(*) AS total FROM contract_precheck ${where}`)
    .bind(...params)
    .first<{ total: number }>();
  const rows = await c.env.DB.prepare(
    `SELECT * FROM contract_precheck ${where} ORDER BY id DESC LIMIT ? OFFSET ?`
  )
    .bind(...params, pageSize, offset)
    .all<PrecheckRow>();

  return c.json({
    success: true,
    data: (rows.results ?? []).map(toListRow),
    pagination: { page, pageSize, total: count?.total ?? 0 }
  });
});

contractPrecheckRoutes.get("/:id", async (c) => {
  const auth = c.get("auth");
  const row = await loadPrecheck(c.env, Number(c.req.param("id")));
  if (!row || !canAccess(row, auth)) {
    return c.json({ success: false, error: { message: "预审单不存在" } }, 404);
  }
  const rounds = await c.env.DB.prepare(
    "SELECT id, round, file_key, file_name, task_id, status, created_at, updated_at FROM contract_precheck_round WHERE precheck_id = ? ORDER BY round DESC"
  )
    .bind(row.id)
    .all<Record<string, unknown>>();
  return c.json({
    success: true,
    data: { ...row, contract_text: null, rounds: rounds.results ?? [] }
  });
});

// ─── 创建（建单 + 首轮审计） ──────────

contractPrecheckRoutes.post("/", async (c) => {
  const auth = c.get("auth");
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return c.json({ success: false, error: { message: "请求体不是合法 JSON" } }, 400);

  const title = typeof body.title === "string" ? body.title.trim().slice(0, MAX_TITLE) : "";
  const direction = body.direction === "outbound" ? "outbound" : "inbound";
  const counterparty =
    typeof body.counterparty === "string" ? body.counterparty.trim().slice(0, MAX_COUNTERPARTY) : "";
  if (!title) return c.json({ success: false, error: { message: "请填写合同标题" } }, 400);

  const input = parseReviewInput(body);
  if (!input.ok) return c.json({ success: false, error: { message: input.message } }, 400);
  const fileMissing = await verifyOriginalFile(c.env, input.value.fileKey);
  if (fileMissing) return c.json({ success: false, error: { message: fileMissing } }, 400);

  const now = nowIso();
  const precheckNo = await generateSerial(c.env.DB, "CP", "contract_precheck", "precheck_no");
  const insert = await c.env.DB.prepare(
    `INSERT INTO contract_precheck
       (precheck_no, title, direction, counterparty, created_by_userid, status,
        current_round, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'reviewing', 0, ?, ?)`
  )
    .bind(precheckNo, title, direction, counterparty || null, auth.sub, now, now)
    .run();
  const id = insert.meta.last_row_id as number;

  try {
    const taskId = await enqueueReviewTask(
      c,
      { id, title, direction, counterparty: counterparty || null },
      1,
      input.value
    );
    return c.json({ success: true, data: { id, precheck_no: precheckNo, task_id: taskId } }, 201);
  } catch (err) {
    // 补偿：任务创建失败则回退为 review_failed，允许重试（D1 无事务）。
    // 带 status 谓词：若任务实际已入队且完成回写先落地，不能覆盖真实结果
    await c.env.DB.prepare(
      "UPDATE contract_precheck SET status = 'review_failed', updated_at = ? WHERE id = ? AND status = 'reviewing'"
    )
      .bind(nowIso(), id)
      .run();
    return c.json(
      { success: false, error: { message: err instanceof Error ? err.message : "预审任务创建失败" } },
      500
    );
  }
});

// ─── 复审（可携带新版本文件） ──────────

contractPrecheckRoutes.post("/:id/review", async (c) => {
  const auth = c.get("auth");
  const row = await loadPrecheck(c.env, Number(c.req.param("id")));
  if (!row || !canAccess(row, auth)) {
    return c.json({ success: false, error: { message: "预审单不存在" } }, 404);
  }
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

  // 新版本文件可选：不传则用当前存量文本复审
  let input: ReviewInput;
  if (typeof body.file_key === "string" && body.file_key.trim()) {
    const parsedInput = parseReviewInput(body);
    if (!parsedInput.ok) return c.json({ success: false, error: { message: parsedInput.message } }, 400);
    const fileMissing = await verifyOriginalFile(c.env, parsedInput.value.fileKey);
    if (fileMissing) return c.json({ success: false, error: { message: fileMissing } }, 400);
    input = parsedInput.value;
  } else {
    if (!row.file_key || !row.contract_text || row.contract_text.trim().length < MIN_TEXT) {
      return c.json({ success: false, error: { message: "无存量合同文本，请上传新版本文件" } }, 400);
    }
    input = {
      fileKey: row.file_key,
      fileName: row.file_name ?? "合同文件",
      fileSize: row.file_size,
      contractText: row.contract_text
    };
  }

  // 抢占：在途（reviewing）与已转入（transferred）不可复审；
  // signed 状态复审会自动撤销签署确认（SET 清空签署字段），避免误签后无路可退
  const claim = await c.env.DB.prepare(
    `UPDATE contract_precheck SET status = 'reviewing', signed_confirmed_at = NULL, signed_comment = NULL, updated_at = ?
     WHERE id = ? AND status IN ('draft', 'passed', 'reviewed', 'review_failed', 'signed')`
  )
    .bind(nowIso(), row.id)
    .run();
  if (!claim.meta.changes) {
    return c.json(
      { success: false, error: { message: "当前状态不可发起复审（审计进行中或已转入合同）" } },
      409
    );
  }

  try {
    const taskId = await enqueueReviewTask(c, row, row.current_round + 1, input);
    return c.json({ success: true, data: { task_id: taskId, round: row.current_round + 1 } });
  } catch (err) {
    await c.env.DB.prepare(
      "UPDATE contract_precheck SET status = 'review_failed', updated_at = ? WHERE id = ? AND status = 'reviewing'"
    )
      .bind(nowIso(), row.id)
      .run();
    return c.json(
      { success: false, error: { message: err instanceof Error ? err.message : "预审任务创建失败" } },
      500
    );
  }
});

// ─── 采纳/取消采纳修改建议 ──────────

contractPrecheckRoutes.post("/:id/adopt", async (c) => {
  const auth = c.get("auth");
  const row = await loadPrecheck(c.env, Number(c.req.param("id")));
  if (!row || !canAccess(row, auth)) {
    return c.json({ success: false, error: { message: "预审单不存在" } }, 404);
  }
  if (!["passed", "reviewed", "signed"].includes(row.status)) {
    return c.json({ success: false, error: { message: "当前状态不可操作修改建议" } }, 400);
  }
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const issueIndex = Number(body.issue_index);
  const adopted = body.adopted !== false;
  // issues 服务端截断到 20 条，上界 100 防 adopted_json 被脚本刷成无限增长
  if (!Number.isInteger(issueIndex) || issueIndex < 0 || issueIndex >= 100) {
    return c.json({ success: false, error: { message: "issue_index 无效" } }, 400);
  }

  let adoptedList: Array<{ issue_index: number; adopted_at: string }> = [];
  try {
    const parsed = row.adopted_json ? (JSON.parse(row.adopted_json) as unknown) : [];
    if (Array.isArray(parsed)) {
      adoptedList = parsed.filter(
        (item): item is { issue_index: number; adopted_at: string } =>
          !!item && typeof item === "object" && Number.isInteger((item as { issue_index?: unknown }).issue_index)
      );
    }
  } catch {
    adoptedList = [];
  }

  const withoutTarget = adoptedList.filter((item) => item.issue_index !== issueIndex);
  const next = adopted
    ? [...withoutTarget, { issue_index: issueIndex, adopted_at: nowIso() }]
    : withoutTarget;

  await c.env.DB.prepare("UPDATE contract_precheck SET adopted_json = ?, updated_at = ? WHERE id = ?")
    .bind(JSON.stringify(next), nowIso(), row.id)
    .run();
  return c.json({ success: true, data: { adopted_count: next.length } });
});

// ─── 确认已与对方完成签署/沟通（仅无明显错误可进） ──────────

contractPrecheckRoutes.post("/:id/confirm-signed", async (c) => {
  const auth = c.get("auth");
  const row = await loadPrecheck(c.env, Number(c.req.param("id")));
  if (!row || !canAccess(row, auth)) {
    return c.json({ success: false, error: { message: "预审单不存在" } }, 404);
  }
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const comment = typeof body.comment === "string" ? body.comment.trim().slice(0, 500) : "";

  const now = nowIso();
  // 闸门：仅最新一轮无「明显错误」（status=passed）可确认签署
  const claim = await c.env.DB.prepare(
    `UPDATE contract_precheck SET status = 'signed', signed_confirmed_at = ?, signed_comment = ?, updated_at = ?
     WHERE id = ? AND status = 'passed'`
  )
    .bind(now, comment || null, now, row.id)
    .run();
  if (!claim.meta.changes) {
    const message =
      row.status === "reviewed"
        ? "最新预审存在明显错误，需与对方修改合同并复审通过后才能确认签署"
        : "当前状态不可确认签署（需先完成预审且无明显错误）";
    return c.json({ success: false, error: { message } }, 409);
  }
  await writeAuditLog(c.env.DB, {
    actorUserId: auth.sub,
    actorRoles: auth.roles,
    action: "contract_precheck.confirm_signed",
    targetType: "contract_precheck",
    targetId: row.id,
    detail: { precheck_no: row.precheck_no, comment }
  });
  return c.json({ success: true });
});

// ─── 转入合同台账（进入我方审批体系的入口） ──────────

contractPrecheckRoutes.post("/:id/transfer", async (c) => {
  const auth = c.get("auth");
  const row = await loadPrecheck(c.env, Number(c.req.param("id")));
  if (!row || !canAccess(row, auth)) {
    return c.json({ success: false, error: { message: "预审单不存在" } }, 404);
  }
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return c.json({ success: false, error: { message: "请求体不是合法 JSON" } }, 400);

  const projectId = Number(body.project_id);
  const entityId = Number(body.entity_id);
  const contractType =
    typeof body.contract_type === "string" ? body.contract_type.trim().slice(0, 20) : "";
  const totalAmount = Number(body.total_amount);
  const contractDate =
    typeof body.contract_date === "string" && body.contract_date.trim()
      ? body.contract_date.trim()
      : todayBeijing();
  // 建单时对方主体可留空，转入时在此补填
  const bodyCounterparty =
    typeof body.counterparty === "string"
      ? body.counterparty.trim().slice(0, MAX_COUNTERPARTY)
      : "";
  const counterparty = bodyCounterparty || row.counterparty || "";
  if (!Number.isFinite(projectId) || projectId <= 0) {
    return c.json({ success: false, error: { message: "请选择所属项目" } }, 400);
  }
  if (!Number.isFinite(entityId) || entityId <= 0) {
    return c.json({ success: false, error: { message: "请选择我方主体" } }, 400);
  }
  if (!contractType) return c.json({ success: false, error: { message: "请填写合同类型" } }, 400);
  if (!Number.isFinite(totalAmount) || totalAmount < 0) {
    return c.json({ success: false, error: { message: "合同金额无效" } }, 400);
  }
  if (!counterparty) {
    return c.json({ success: false, error: { message: "请填写对方主体名称" } }, 400);
  }
  if (!row.file_key) {
    return c.json({ success: false, error: { message: "预审单缺少合同原件" } }, 400);
  }
  if (bodyCounterparty && bodyCounterparty !== row.counterparty) {
    await c.env.DB.prepare(
      "UPDATE contract_precheck SET counterparty = ?, updated_at = ? WHERE id = ?"
    )
      .bind(bodyCounterparty, nowIso(), row.id)
      .run();
  }

  const now = nowIso();
  // 闸门：仅已确认签署可转入（signed 状态本身已保证最新审计无明显错误）
  const claim = await c.env.DB.prepare(
    "UPDATE contract_precheck SET status = 'transferred', transferred_at = ?, updated_at = ? WHERE id = ? AND status = 'signed'"
  )
    .bind(now, now, row.id)
    .run();
  if (!claim.meta.changes) {
    return c.json(
      { success: false, error: { message: "需先确认已与对方完成签署/沟通后才能转入合同" } },
      409
    );
  }

  // 合同 INSERT 是否已落地：决定 catch 里是回滚还是补链——
  // INSERT 成功后回滚会造成用户重试双开合同（真实台账重复单）
  let createdContractId: number | null = null;
  let createdContractNo: string | null = null;
  try {
    const contractNo = await generateSerial(c.env.DB, "CT", "contract", "contract_no");
    const attachments = [
      { file_key: row.file_key, file_name: row.file_name ?? "合同原件", file_size: row.file_size ?? 0 }
    ];
    // 预审已产出审计报告，跳过平台自动 contract_review（与合同起草 convert 同规）
    const insert = await c.env.DB.prepare(
      `INSERT INTO contract
         (contract_no, direction, project_id, entity_id, counterparty, contract_type,
          handler_userid, contract_date, total_amount, status, ai_review_status,
          attachments_json, remark, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', 'none', ?, ?, ?, ?)`
    )
      .bind(
        contractNo,
        row.direction,
        projectId,
        entityId,
        counterparty,
        contractType,
        auth.sub,
        contractDate,
        totalAmount,
        JSON.stringify(attachments),
        `合同预审 ${row.precheck_no} 转入`,
        now,
        now
      )
      .run();
    createdContractId = insert.meta.last_row_id as number;
    createdContractNo = contractNo;

    await c.env.DB.prepare(
      "UPDATE contract_precheck SET contract_id = ?, updated_at = ? WHERE id = ?"
    )
      .bind(createdContractId, nowIso(), row.id)
      .run();
    await writeAuditLog(c.env.DB, {
      actorUserId: auth.sub,
      actorRoles: auth.roles,
      action: "contract_precheck.transfer",
      targetType: "contract_precheck",
      targetId: row.id,
      detail: {
        precheck_no: row.precheck_no,
        contract_id: createdContractId,
        contract_no: contractNo,
        total_amount: totalAmount
      }
    });
    return c.json({
      success: true,
      data: { contract_id: createdContractId, contract_no: contractNo }
    });
  } catch (err) {
    if (createdContractId !== null) {
      // 合同已实际创建（链接/审计步骤失败）：转入实质成功，补链后按成功返回，
      // 绝不能回滚——回滚会让用户重试再开一份重复合同
      await c.env.DB.prepare(
        "UPDATE contract_precheck SET contract_id = ?, updated_at = ? WHERE id = ? AND contract_id IS NULL"
      )
        .bind(createdContractId, nowIso(), row.id)
        .run()
        .catch(() => undefined);
      return c.json({
        success: true,
        data: { contract_id: createdContractId, contract_no: createdContractNo }
      });
    }
    // 合同未创建（序列号/INSERT 失败）：回退签署态允许重试（D1 无事务）
    await c.env.DB.prepare(
      "UPDATE contract_precheck SET status = 'signed', transferred_at = NULL, updated_at = ? WHERE id = ? AND status = 'transferred' AND contract_id IS NULL"
    )
      .bind(nowIso(), row.id)
      .run();
    return c.json(
      { success: false, error: { message: err instanceof Error ? err.message : "转入合同失败，请重试" } },
      500
    );
  }
});

// ─── 更新基础信息 / 删除 ──────────

contractPrecheckRoutes.put("/:id", async (c) => {
  const auth = c.get("auth");
  const row = await loadPrecheck(c.env, Number(c.req.param("id")));
  if (!row || !canAccess(row, auth)) {
    return c.json({ success: false, error: { message: "预审单不存在" } }, 404);
  }
  if (["transferred"].includes(row.status)) {
    return c.json({ success: false, error: { message: "已转入合同，不可修改" } }, 400);
  }
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const title =
    typeof body.title === "string" && body.title.trim() ? body.title.trim().slice(0, MAX_TITLE) : row.title;
  const counterparty =
    typeof body.counterparty === "string"
      ? body.counterparty.trim().slice(0, MAX_COUNTERPARTY) || null
      : row.counterparty;
  await c.env.DB.prepare(
    "UPDATE contract_precheck SET title = ?, counterparty = ?, updated_at = ? WHERE id = ?"
  )
    .bind(title, counterparty, nowIso(), row.id)
    .run();
  // manager 可跨人编辑，留痕
  if (row.created_by_userid !== auth.sub) {
    await writeAuditLog(c.env.DB, {
      actorUserId: auth.sub,
      actorRoles: auth.roles,
      action: "contract_precheck.update_other",
      targetType: "contract_precheck",
      targetId: row.id,
      detail: { precheck_no: row.precheck_no, owner: row.created_by_userid }
    });
  }
  return c.json({ success: true });
});

contractPrecheckRoutes.delete("/:id", async (c) => {
  const auth = c.get("auth");
  const row = await loadPrecheck(c.env, Number(c.req.param("id")));
  if (!row || !canAccess(row, auth)) {
    return c.json({ success: false, error: { message: "预审单不存在" } }, 404);
  }
  if (row.status === "transferred") {
    return c.json({ success: false, error: { message: "已转入合同，不可删除" } }, 400);
  }
  if (row.status === "reviewing") {
    return c.json({ success: false, error: { message: "审计进行中，请稍后再删除" } }, 409);
  }
  await c.env.DB.prepare(
    "UPDATE contract_precheck SET status = 'deleted', updated_at = ? WHERE id = ?"
  )
    .bind(nowIso(), row.id)
    .run();
  // manager 可跨人删除，留痕
  if (row.created_by_userid !== auth.sub) {
    await writeAuditLog(c.env.DB, {
      actorUserId: auth.sub,
      actorRoles: auth.roles,
      action: "contract_precheck.delete_other",
      targetType: "contract_precheck",
      targetId: row.id,
      detail: { precheck_no: row.precheck_no, owner: row.created_by_userid }
    });
  }
  return c.json({ success: true });
});
