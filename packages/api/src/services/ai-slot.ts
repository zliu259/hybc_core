import type { Env } from "../types/env";
import type {
  AiProviderConfig,
  AiPromptTemplate,
  AiRoutingRule,
  CreateTaskRequest,
  TaskQueueItem,
  TaskResultSubmission,
  ComputeNode
} from "../types/ai";
import type { AiGateHandler } from "../types/approval";
import { parseAiGateTaskResult } from "./approval/ai-gate-result";
import {
  normalizeContractReviewOutput,
  normalizePaymentRiskOutput
} from "./approval/risk-score";
import {
  applyContractPrecheckExtract,
  applyContractPrecheckResult,
  markContractPrecheckTaskError
} from "./contract-precheck";
import { applyExternalLogAuditResult } from "./external-log-audit";
import { recentPaymentsQuery } from "./recent-payments";
import { checkClauseText, parseContractSectionOutput } from "./contract-draft-rules";
import { CF_AI_COMPLETENESS_MODELS, tolerantJsonParse } from "./cf-ai";
import { publishEvent } from "./event-bus";
import { generateSerial } from "./serial";
import { normalizeWarehouseManualDraftResultContent } from "./warehouse-manual-ai";

const nowIso = () => new Date().toISOString();

type AttachmentMeta = {
  file_key: string;
  file_name: string;
  file_size?: number | null;
  file_url: string;
};

const parseAttachmentMeta = (raw: string | null): AttachmentMeta[] => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const items: Array<AttachmentMeta | null> = parsed.map((item) => {
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
          file_url?: string;
          url?: string;
        };
        const key = row.file_key ?? row.key;
        if (!key) return null;
        return {
          file_key: key,
          file_name: row.file_name ?? row.name ?? key,
          file_size: row.file_size ?? row.size ?? null,
          file_url: row.file_url ?? row.url ?? `/api/v1/upload/object/${encodeURIComponent(key)}`
        };
      }
      return null;
    });
    return items.filter((item): item is AttachmentMeta => item !== null);
  } catch {
    return [];
  }
};

const asObject = (value: unknown): Record<string, unknown> => {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
};

const asNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
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

const loadBizContextFromInstance = async (
  env: Env,
  instanceId: number
): Promise<{
  biz_type: string;
  biz_id: number;
  biz_summary: string;
  context: Record<string, unknown>;
} | null> => {
  const instance = await env.DB.prepare(
    "SELECT biz_type, biz_id, biz_summary, instance_config_json FROM approval_instance WHERE id = ?"
  )
    .bind(instanceId)
    .first<{
      biz_type: string;
      biz_id: number;
      biz_summary: string;
      instance_config_json: string | null;
    }>();
  if (!instance) return null;

  let context = {
    biz_type: instance.biz_type,
    biz_id: instance.biz_id,
    biz_summary: instance.biz_summary
  } as Record<string, unknown>;

  if (instance.instance_config_json) {
    try {
      const parsed = JSON.parse(instance.instance_config_json) as {
        route_context?: Record<string, unknown>;
      };
      if (parsed.route_context && typeof parsed.route_context === "object") {
        context = { ...context, ...parsed.route_context };
      }
    } catch {
      context = { ...context };
    }
  }

  if (instance.biz_type === "payment_request") {
    const payment = await env.DB.prepare(
      `SELECT id, serial_no, contract_id, project_id, payee_id, amount, amount_cn,
              expected_payment_date, category, content, payment_method, attachments_json, remark
       FROM payment_request WHERE id = ?`
    )
      .bind(instance.biz_id)
      .first<{
        id: number;
        serial_no: string;
        contract_id: number | null;
        project_id: number;
        payee_id: number;
        amount: number;
        amount_cn: string;
        expected_payment_date: string;
        category: string;
        content: string;
        payment_method: string;
        attachments_json: string | null;
        remark: string | null;
      }>();
    if (payment) {
      const contract =
        payment.contract_id !== null
          ? await env.DB.prepare(
              `SELECT contract_no, counterparty, total_amount, paid_amount, entity_id, attachments_json
               FROM contract WHERE id = ?`
            )
              .bind(payment.contract_id)
              .first<{
                contract_no: string;
                counterparty: string;
                total_amount: number;
                paid_amount: number;
                entity_id: number;
                attachments_json: string | null;
              }>()
          : null;
      const paymentAttachments = parseAttachmentMeta(payment.attachments_json);
      const contractAttachments = parseAttachmentMeta(contract?.attachments_json ?? null);
      const mergedAttachments = mergeAttachments(contractAttachments, paymentAttachments);
      // 重复支付/频率异常检查的必要输入（与 payment.ts 风控任务同口径，
      // 见 recent-payments.ts：排除本单、已取消与已驳回的幽灵记录）
      const recentPayments =
        payment.contract_id !== null
          ? await env.DB.prepare(recentPaymentsQuery("contract"))
              .bind(payment.contract_id, payment.id)
              .all()
          : await env.DB.prepare(recentPaymentsQuery("payee"))
              .bind(payment.payee_id, payment.id)
              .all();
      context = {
        ...context,
        recent_payments: recentPayments.results ?? [],
        amount: payment.amount,
        project_id: payment.project_id,
        entity_id: contract?.entity_id,
        serial_no: payment.serial_no,
        contract:
          payment.contract_id !== null && contract
            ? {
                id: payment.contract_id,
                contract_no: contract.contract_no,
                counterparty: contract.counterparty,
                total_amount: contract.total_amount,
                paid_amount: contract.paid_amount
              }
            : null,
        payment: {
          expected_payment_date: payment.expected_payment_date,
          category: payment.category,
          content: payment.content,
          payment_method: payment.payment_method,
          amount_cn: payment.amount_cn,
          remark: payment.remark
        },
        payment_attachments: paymentAttachments,
        contract_attachments: contractAttachments,
        attachments: mergedAttachments
      };
    }
  }

  if (instance.biz_type === "reimbursement_batch") {
    const itemRows = await env.DB.prepare(
      `SELECT e.id, e.envelope_no, e.invoice_no, e.amount, e.category, e.description,
              e.precheck_status, e.precheck_comment, e.silent_review_result, e.ocr_status,
              e.invoice_title_entity_id, e.invoice_title_name
         FROM reimbursement_batch_item bi
         JOIN reimbursement_envelope e ON e.id = bi.envelope_id
        WHERE bi.batch_id = ?
          AND bi.status = 'active'
        ORDER BY bi.id ASC`
    )
      .bind(instance.biz_id)
      .all<{
        id: number;
        envelope_no: string;
        invoice_no: string | null;
        amount: number;
        category: string | null;
        description: string | null;
        precheck_status: string;
        precheck_comment: string | null;
        silent_review_result: string | null;
        ocr_status: string;
        invoice_title_entity_id: number | null;
        invoice_title_name: string | null;
      }>();

    const attachmentRows = await env.DB.prepare(
      `SELECT ea.file_key, ea.file_name, ea.file_size
         FROM reimbursement_batch_item bi
         JOIN envelope_attachment ea ON ea.envelope_id = bi.envelope_id
        WHERE bi.batch_id = ?
          AND bi.status = 'active'
          AND ea.status = 'active'
          AND ea.file_key IS NOT NULL
        ORDER BY ea.id ASC`
    )
      .bind(instance.biz_id)
      .all<{
        file_key: string;
        file_name: string | null;
        file_size: number | null;
      }>();

    const attachments = mergeAttachments(
      (attachmentRows.results ?? []).reduce<AttachmentMeta[]>((acc, row) => {
        const fileKey = row.file_key.trim();
        if (!fileKey) return acc;
        acc.push({
          file_key: fileKey,
          file_name: row.file_name?.trim() || fileKey,
          file_size: row.file_size,
          file_url: `/api/v1/upload/object/${encodeURIComponent(fileKey)}`
        });
        return acc;
      }, [])
    );

    if (attachments.length > 0) {
      context = {
        ...context,
        attachments
      };
    }

    const batchTitleRow = await env.DB.prepare(
      "SELECT invoice_title_entity_id, mixed_title_reason FROM reimbursement_batch WHERE id = ?"
    )
      .bind(instance.biz_id)
      .first<{ invoice_title_entity_id: number | null; mixed_title_reason: string | null }>();

    const itemReviewSummary = (itemRows.results ?? []).map((row) => {
      let silentReviewSummary: string | null = null;
      if (row.silent_review_result) {
        try {
          const parsed = JSON.parse(row.silent_review_result) as Record<string, unknown>;
          const summary =
            typeof parsed.ai_reasonability_summary === "string"
              ? parsed.ai_reasonability_summary
              : typeof parsed.summary === "string"
                ? parsed.summary
                : null;
          silentReviewSummary = summary?.trim() || null;
        } catch {
          silentReviewSummary = null;
        }
      }

      return {
        envelope_id: row.id,
        envelope_no: row.envelope_no,
        invoice_no: row.invoice_no,
        amount: row.amount,
        category: row.category,
        description: row.description,
        precheck_status: row.precheck_status,
        precheck_comment: row.precheck_comment,
        ocr_status: row.ocr_status,
        ai_reasonability_summary: silentReviewSummary,
        invoice_title_entity_id: row.invoice_title_entity_id ?? null,
        invoice_title_name: row.invoice_title_name ?? null
      };
    });

    context = {
      ...context,
      reimbursement_item_reviews: itemReviewSummary,
      reimbursement_batch_title: {
        invoice_title_entity_id: batchTitleRow?.invoice_title_entity_id ?? null,
        mixed_title_reason: batchTitleRow?.mixed_title_reason ?? null
      },
      review_focus: "reasonability_summary"
    };
  }

  if (instance.biz_type === "outbound_contract" || instance.biz_type === "inbound_contract") {
    const contract = await env.DB.prepare(
      `SELECT id, contract_no, project_id, entity_id, direction, counterparty,
              contract_type, handler_userid, contract_date, total_amount, paid_amount,
              attachments_json, remark
       FROM contract WHERE id = ?`
    )
      .bind(instance.biz_id)
      .first<{
        id: number;
        contract_no: string;
        project_id: number;
        entity_id: number;
        direction: string;
        counterparty: string;
        contract_type: string;
        handler_userid: string;
        contract_date: string;
        total_amount: number;
        paid_amount: number;
        attachments_json: string | null;
        remark: string | null;
      }>();
    if (contract) {
      context = {
        ...context,
        amount: contract.total_amount,
        project_id: contract.project_id,
        entity_id: contract.entity_id,
        contract: {
          contract_no: contract.contract_no,
          direction: contract.direction,
          counterparty: contract.counterparty,
          contract_type: contract.contract_type,
          handler_userid: contract.handler_userid,
          contract_date: contract.contract_date,
          total_amount: contract.total_amount,
          paid_amount: contract.paid_amount,
          remark: contract.remark
        },
        attachments: parseAttachmentMeta(contract.attachments_json)
      };
    }
  }

  return {
    biz_type: instance.biz_type,
    biz_id: instance.biz_id,
    biz_summary: instance.biz_summary,
    context
  };
};

const enrichAiGatePayload = async (
  env: Env,
  instanceIdHint: number,
  payload: Record<string, unknown>
): Promise<Record<string, unknown>> => {
  const enriched = { ...payload };
  const payloadInstanceId = asNumber(payload.instance_id);
  const instanceId = payloadInstanceId ?? instanceIdHint;
  const loaded = await loadBizContextFromInstance(env, instanceId);
  if (!loaded) return enriched;

  const loadedContext = asObject(loaded.context);
  const currentContext = asObject(payload.context);
  const mergedContext = { ...loadedContext, ...currentContext };

  const currentAttachments = Array.isArray(currentContext.attachments)
    ? currentContext.attachments
    : [];
  const loadedAttachments = Array.isArray(loadedContext.attachments)
    ? loadedContext.attachments
    : [];
  if (currentAttachments.length > 0 || loadedAttachments.length > 0) {
    const currentList = currentAttachments
      .filter((item): item is AttachmentMeta => {
        return (
          !!item &&
          typeof item === "object" &&
          typeof (item as AttachmentMeta).file_key === "string"
        );
      })
      .map((item) => ({
        file_key: item.file_key,
        file_name: item.file_name || item.file_key,
        file_size: item.file_size,
        file_url:
          typeof item.file_url === "string" && item.file_url.trim().length > 0
            ? item.file_url
            : `/api/v1/upload/object/${encodeURIComponent(item.file_key)}`
      }));
    const loadedList = loadedAttachments
      .filter((item): item is AttachmentMeta => {
        return (
          !!item &&
          typeof item === "object" &&
          typeof (item as AttachmentMeta).file_key === "string"
        );
      })
      .map((item) => ({
        file_key: item.file_key,
        file_name: item.file_name || item.file_key,
        file_size: item.file_size,
        file_url:
          typeof item.file_url === "string" && item.file_url.trim().length > 0
            ? item.file_url
            : `/api/v1/upload/object/${encodeURIComponent(item.file_key)}`
      }));
    mergedContext.attachments = mergeAttachments(loadedList, currentList);
  }

  enriched.context = mergedContext;
  if (!enriched.biz_type) enriched.biz_type = loaded.biz_type;
  if (!enriched.biz_id) enriched.biz_id = loaded.biz_id;
  if (!enriched.biz_summary) enriched.biz_summary = loaded.biz_summary;
  if (!enriched.instance_id) enriched.instance_id = instanceId;
  return enriched;
};

// ─── Task Lifecycle ──────────

/**
 * Create a new task in the queue.
 */
export const createTask = async (env: Env, request: CreateTaskRequest): Promise<TaskQueueItem> => {
  const taskCode = await generateSerial(env.DB, "TK", "task_queue", "task_code");
  const now = nowIso();

  // Resolve provider for this task
  const provider = await resolveProvider(env, request.biz_type, request.task_type);

  const result = await env.DB.prepare(
    `INSERT INTO task_queue
      (task_code, task_type, biz_type, biz_id, priority, payload_json,
       provider_id, status, max_retries, retry_count, timeout_seconds,
       created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 3, 0, ?, ?, ?)`
  )
    .bind(
      taskCode,
      request.task_type,
      request.biz_type,
      request.biz_id,
      request.priority ?? 5,
      JSON.stringify(request.payload),
      provider?.id ?? null,
      request.timeout_seconds ?? 300,
      now,
      now
    )
    .run();

  const taskId = result.meta.last_row_id;

  await publishEvent(env, "TASK_CREATED", "ai-slot", {
    task_id: taskId,
    task_code: taskCode,
    task_type: request.task_type,
    biz_type: request.biz_type,
    biz_id: request.biz_id
  });

  const task = await env.DB.prepare("SELECT * FROM task_queue WHERE id = ?")
    .bind(taskId)
    .first<TaskQueueItem>();

  if (!task) {
    throw new Error("Failed to retrieve created task");
  }

  return task;
};

/**
 * Complete a task with results. Writes audit log.
 */
export const completeTask = async (
  env: Env,
  taskId: number,
  nodeId: string,
  result: TaskResultSubmission
): Promise<void> => {
  const now = nowIso();

  // Load task to get context
  const task = await env.DB.prepare("SELECT * FROM task_queue WHERE id = ?")
    .bind(taskId)
    .first<TaskQueueItem>();

  if (!task) {
    throw new Error(`Task ${taskId} not found`);
  }

  if (task.assigned_node_id !== nodeId) {
    throw new Error(`Task ${taskId} not assigned to node ${nodeId}`);
  }

  // Update task status
  await env.DB.prepare(
    `UPDATE task_queue SET status = 'completed', result_json = ?,
     completed_at = ?, updated_at = ? WHERE id = ?`
  )
    .bind(JSON.stringify(result), now, now, taskId)
    .run();

  if (task.task_type === "payment_risk_assessment" && task.biz_type === "payment_request") {
    const riskOutput =
      typeof result.output === "string" && result.output.trim().length > 0
        ? result.output
        : JSON.stringify(result);
    // 兜底计分：旧 runner 不做 postprocess 时，带 findings 无 score 的结果在此规范化
    await env.DB.prepare(
      "UPDATE payment_request SET ai_risk_status = 'completed', ai_risk_result = ?, updated_at = ? WHERE id = ?"
    )
      .bind(normalizePaymentRiskOutput(riskOutput), now, task.biz_id)
      .run();
  }

  // 合同 AI 审查回写：此前只有触发方置 pending、无任何完成回写，
  // 合同的 ai_review_result 永远为空、状态永远停在 pending
  if (task.task_type === "contract_review" && task.biz_type === "contract") {
    const reviewOutput =
      typeof result.output === "string" && result.output.trim().length > 0
        ? result.output
        : JSON.stringify(result);
    await env.DB.prepare(
      "UPDATE contract SET ai_review_status = 'completed', ai_review_result = ?, updated_at = ? WHERE id = ?"
    )
      .bind(normalizeContractReviewOutput(reviewOutput), now, task.biz_id)
      .run();
  }

  if (task.task_type === "warehouse_manual_draft" && task.biz_type === "warehouse_manual") {
    await env.DB.prepare(
      `UPDATE warehouse_manual_version SET
         content_json = ?,
         ai_draft_status = 'completed',
         updated_at = ?
       WHERE ai_draft_task_id = ? AND manual_id = ?`
    )
      .bind(normalizeWarehouseManualDraftResultContent(result), now, taskId, task.biz_id)
      .run();
    await env.DB.prepare("UPDATE warehouse_manual SET updated_at = ? WHERE id = ?")
      .bind(now, task.biz_id)
      .run();
  }

  if (task.task_type === "external_log_audit" && task.biz_type === "external_log_submission") {
    await applyExternalLogAuditResult(env, task.biz_id, taskId, result);
  }

  if (task.task_type === "contract_draft_section" && task.biz_type === "contract_draft") {
    const parsed = parseContractSectionOutput(result.output);
    const merged = [...parsed.risk_spans, ...checkClauseText(parsed.content)];
    await env.DB.prepare(
      `UPDATE contract_draft_section SET
         content = ?, risk_annotations_json = ?, ai_status = 'done',
         source = 'ai_generated', updated_at = ?
       WHERE ai_task_id = ? AND status != 'deleted'`
    )
      .bind(parsed.content, JSON.stringify(merged), now, taskId)
      .run();
  }

  // 合同预审·服务端提取完成（小程序路径）：文本落库并派生审计任务、指针改指
  if (task.task_type === "contract_precheck_extract" && task.biz_type === "contract_precheck") {
    await applyContractPrecheckExtract(env, task, result.output, async (payload) => {
      const reviewTask = await createTask(env, {
        task_type: "contract_precheck_review",
        biz_type: "contract_precheck",
        biz_id: task.biz_id,
        priority: 6,
        timeout_seconds: 300,
        payload
      });
      return { id: reviewTask.id };
    });
  }

  // 合同预审：AI 多维审计 + 确定性红线规则合并后落库（明显错误 → reviewed，否则 passed）
  if (task.task_type === "contract_precheck_review" && task.biz_type === "contract_precheck") {
    const model =
      result.metadata && typeof result.metadata === "object" && typeof result.metadata.model === "string"
        ? result.metadata.model
        : null;
    await applyContractPrecheckResult(env, task, result.output, model);
  }

  if (task.task_type === "contract_compliance_review" && task.biz_type === "contract_draft") {
    await env.DB.prepare(
      `UPDATE contract_draft_section SET
         review_result_json = ?, review_status = 'done', updated_at = ?
       WHERE review_task_id = ? AND status != 'deleted'`
    )
      .bind(result.output, now, taskId)
      .run();
  }

  // 完整检查递进链第一阶段（初版诊断）完成：不写 done，派生复核（audit）任务。
  // 拆两阶段是为避免单任务内串行两次大调用超时（owner 07-23 卡死修复）。
  if (task.task_type === "contract_completeness_check" && task.biz_type === "contract_draft") {
    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(task.payload_json) as Record<string, unknown>;
    } catch {
      payload = {};
    }
    const [initialModel, auditModel] = CF_AI_COMPLETENESS_MODELS;
    const initialResult = tolerantJsonParse(result.output);
    const auditTask = await createTask(env, {
      task_type: "contract_completeness_audit",
      biz_type: "contract_draft",
      biz_id: task.biz_id,
      priority: 6,
      timeout_seconds: 300,
      payload: {
        draft_id: payload.draft_id ?? task.biz_id,
        direction: payload.direction ?? "",
        sections_full_json: payload.sections_full_json ?? "",
        initial_model: initialModel,
        initial_result_json: JSON.stringify(initialResult),
        model: auditModel
      }
    });
    // 让 draft 的完整性任务指针跟随 audit 任务（超时回收/前端轮询以 audit 为准）
    await env.DB.prepare(
      "UPDATE contract_draft SET completeness_task_id = ?, updated_at = ? WHERE completeness_task_id = ?"
    )
      .bind(auditTask.id, now, taskId)
      .run();
  }

  // 完整检查递进链第二阶段（复核）完成：组装 {initial, audit} 写 draft + 历史版本。
  if (task.task_type === "contract_completeness_audit" && task.biz_type === "contract_draft") {
    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(task.payload_json) as Record<string, unknown>;
    } catch {
      payload = {};
    }
    const draftId = Number(payload.draft_id ?? task.biz_id);
    const [defaultInitialModel, defaultAuditModel] = CF_AI_COMPLETENESS_MODELS;
    const initialModel =
      typeof payload.initial_model === "string" ? payload.initial_model : defaultInitialModel;
    const initialResult = tolerantJsonParse(
      typeof payload.initial_result_json === "string" ? payload.initial_result_json : "{}"
    );
    const combined = JSON.stringify({
      initial: { model: initialModel, result: initialResult },
      audit: { model: defaultAuditModel, result: tolerantJsonParse(result.output) }
    });
    await env.DB.prepare(
      `UPDATE contract_draft SET
         completeness_result_json = ?, completeness_status = 'done', updated_at = ?
       WHERE id = ?`
    )
      .bind(combined, now, draftId)
      .run();
    await env.DB.prepare(
      `INSERT INTO contract_draft_check (draft_id, result_json, models_json, created_at)
       VALUES (?, ?, ?, ?)`
    )
      .bind(draftId, combined, JSON.stringify([...CF_AI_COMPLETENESS_MODELS]), now)
      .run();
  }

  // Write audit log
  const provider = task.provider_id
    ? await env.DB.prepare("SELECT * FROM ai_provider_config WHERE id = ?")
        .bind(task.provider_id)
        .first<AiProviderConfig>()
    : null;

  await env.DB.prepare(
    `INSERT INTO ai_audit_log
      (task_id, biz_type, biz_id, provider_key, model_id, input_summary,
       output_summary, tokens_input, tokens_output, latency_ms, status,
       compute_node_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'success', ?, ?)`
  )
    .bind(
      taskId,
      task.biz_type,
      task.biz_id,
      provider?.provider_key ?? "unknown",
      provider?.model_id ?? null,
      null,
      result.output.substring(0, 500),
      result.tokens_input ?? 0,
      result.tokens_output ?? 0,
      result.latency_ms ?? 0,
      nodeId,
      now
    )
    .run();

  // 合同正文属敏感数据：起草/预审域任务完成后清洗队列里的 payload/result
  if (task.biz_type === "contract_draft" || task.biz_type === "contract_precheck") {
    await env.DB.prepare(
      "UPDATE task_queue SET payload_json = '{}', result_json = '{}' WHERE id = ?"
    )
      .bind(taskId)
      .run();
  }

  await publishEvent(env, "TASK_COMPLETED", "ai-slot", {
    task_id: taskId,
    task_type: task.task_type,
    biz_type: task.biz_type,
    biz_id: task.biz_id
  });
};

/**
 * 合同起草任务【终态】失败/超时的统一收尾：回写节或草稿的 error 状态，并清空 task_queue
 * 敏感 payload。仅在终态调用（failTask 的 newStatus==='failed'、checkTimeouts 中重试耗尽的
 * timeout）——中间可重试态不得调用，否则会把仍会自动重试的节误标为 error 并卡住重试。
 */
const markContractDraftTaskError = async (
  env: Env,
  task: { id: number; task_type: string },
  now: string
): Promise<void> => {
  if (task.task_type === "contract_draft_section") {
    await env.DB.prepare(
      "UPDATE contract_draft_section SET ai_status = 'error', updated_at = ? WHERE ai_task_id = ?"
    )
      .bind(now, task.id)
      .run();
  } else if (task.task_type === "contract_compliance_review") {
    await env.DB.prepare(
      "UPDATE contract_draft_section SET review_status = 'error', updated_at = ? WHERE review_task_id = ?"
    )
      .bind(now, task.id)
      .run();
  } else if (
    task.task_type === "contract_completeness_check" ||
    task.task_type === "contract_completeness_audit"
  ) {
    await env.DB.prepare(
      "UPDATE contract_draft SET completeness_status = 'error', updated_at = ? WHERE completeness_task_id = ?"
    )
      .bind(now, task.id)
      .run();
  }
  // 终态清洗：失败任务的 payload（含节正文/模板）不再需要，与 completeTask 成功路径口径一致。
  await env.DB.prepare("UPDATE task_queue SET payload_json = '{}' WHERE id = ?")
    .bind(task.id)
    .run();
};

/**
 * Mark a task as failed. Auto-retry if under max_retries.
 */
export const failTask = async (
  env: Env,
  taskId: number,
  nodeId: string,
  error: string
): Promise<void> => {
  const now = nowIso();

  const task = await env.DB.prepare("SELECT * FROM task_queue WHERE id = ?")
    .bind(taskId)
    .first<TaskQueueItem>();

  if (!task) {
    throw new Error(`Task ${taskId} not found`);
  }

  const newRetryCount = task.retry_count + 1;
  const newStatus = newRetryCount < task.max_retries ? "pending" : "failed";

  await env.DB.prepare(
    `UPDATE task_queue SET status = ?, error_message = ?, retry_count = ?,
     assigned_node_id = NULL, assigned_at = NULL, started_at = NULL,
     updated_at = ? WHERE id = ?`
  )
    .bind(newStatus, error, newRetryCount, now, taskId)
    .run();

  // 仅终态失败才落 'failed'——非终态还会自动重试，提前落会让前端误报“评估失败”
  if (
    task.task_type === "payment_risk_assessment" &&
    task.biz_type === "payment_request" &&
    newStatus === "failed"
  ) {
    await env.DB.prepare(
      "UPDATE payment_request SET ai_risk_status = 'failed', updated_at = ? WHERE id = ?"
    )
      .bind(now, task.biz_id)
      .run();
  }

  if (
    task.task_type === "contract_review" &&
    task.biz_type === "contract" &&
    newStatus === "failed"
  ) {
    await env.DB.prepare(
      "UPDATE contract SET ai_review_status = 'failed', updated_at = ? WHERE id = ?"
    )
      .bind(now, task.biz_id)
      .run();
  }

  if (task.task_type === "warehouse_manual_draft" && task.biz_type === "warehouse_manual") {
    await env.DB.prepare(
      "UPDATE warehouse_manual_version SET ai_draft_status = 'failed', updated_at = ? WHERE ai_draft_task_id = ? AND manual_id = ?"
    )
      .bind(now, taskId, task.biz_id)
      .run();
    await env.DB.prepare("UPDATE warehouse_manual SET updated_at = ? WHERE id = ?")
      .bind(now, task.biz_id)
      .run();
  }

  if (
    task.task_type === "external_log_audit" &&
    task.biz_type === "external_log_submission" &&
    newStatus === "failed"
  ) {
    await env.DB.prepare(
      `UPDATE external_log_submission SET
         review_status = 'needs_manual_review',
         ai_review_summary = ?,
         updated_at = ?
       WHERE id = ?`
    )
      .bind(`AI审计任务失败：${error}`, now, task.biz_id)
      .run();
  }

  if (task.biz_type === "contract_draft" && newStatus === "failed") {
    await markContractDraftTaskError(env, task, now);
  }

  if (task.biz_type === "contract_precheck" && newStatus === "failed") {
    await markContractPrecheckTaskError(env, task, now);
  }

  // Write error audit log
  const provider = task.provider_id
    ? await env.DB.prepare("SELECT * FROM ai_provider_config WHERE id = ?")
        .bind(task.provider_id)
        .first<AiProviderConfig>()
    : null;

  await env.DB.prepare(
    `INSERT INTO ai_audit_log
      (task_id, biz_type, biz_id, provider_key, model_id, status,
       error_message, compute_node_id, created_at)
      VALUES (?, ?, ?, ?, ?, 'error', ?, ?, ?)`
  )
    .bind(
      taskId,
      task.biz_type,
      task.biz_id,
      provider?.provider_key ?? "unknown",
      provider?.model_id ?? null,
      error,
      nodeId,
      now
    )
    .run();

  await publishEvent(env, "TASK_FAILED", "ai-slot", {
    task_id: taskId,
    error,
    retry_count: newRetryCount,
    will_retry: newStatus === "pending"
  });
};

// ─── Provider Routing ──────────

/**
 * Resolve which AI provider to use for a given biz_type + task_type.
 */
export const resolveProvider = async (
  env: Env,
  bizType: string,
  taskType: string
): Promise<AiProviderConfig | null> => {
  // Try to find a matching routing rule
  const rule = await env.DB.prepare(
    `SELECT * FROM ai_routing_rule
     WHERE biz_type = ? AND task_type = ? AND status = 'active'
     ORDER BY priority ASC LIMIT 1`
  )
    .bind(bizType, taskType)
    .first<AiRoutingRule>();

  if (rule) {
    const provider = await env.DB.prepare(
      "SELECT * FROM ai_provider_config WHERE id = ? AND status = 'active'"
    )
      .bind(rule.provider_id)
      .first<AiProviderConfig>();

    if (provider) {
      return provider;
    }
  }

  // Fallback: highest-priority active provider
  const fallback = await env.DB.prepare(
    "SELECT * FROM ai_provider_config WHERE status = 'active' ORDER BY priority ASC LIMIT 1"
  ).all<AiProviderConfig>();

  return fallback.results?.[0] ?? null;
};

/**
 * Resolve and render a prompt template with variables.
 */
export const resolvePrompt = async (
  env: Env,
  templateId: number,
  variables: Record<string, unknown>
): Promise<{ system: string; user: string } | null> => {
  const template = await env.DB.prepare(
    "SELECT * FROM ai_prompt_template WHERE id = ? AND status = 'active'"
  )
    .bind(templateId)
    .first<AiPromptTemplate>();

  if (!template) {
    return null;
  }

  // Replace {{variable}} patterns
  const renderTemplate = (tmpl: string): string => {
    return tmpl.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
      const value = variables[key];
      if (value === undefined) return `{{${key}}}`;
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        return String(value);
      }
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    });
  };

  return {
    system: renderTemplate(template.system_prompt),
    user: renderTemplate(template.user_prompt_template)
  };
};

// ─── Node Management ──────────

/**
 * Get available compute nodes for a task type.
 */
export const getAvailableNodes = async (env: Env, taskType: string): Promise<ComputeNode[]> => {
  const rows = await env.DB.prepare(
    "SELECT * FROM compute_node WHERE status = 'online'"
  ).all<ComputeNode>();

  const nodes = rows.results ?? [];

  // Filter by capability
  return nodes.filter((node) => {
    if (!node.capabilities_json) return false;
    try {
      const capabilities = JSON.parse(node.capabilities_json) as string[];
      return capabilities.includes(taskType);
    } catch {
      return false;
    }
  });
};

/**
 * Check for timed-out tasks and mark them accordingly.
 */
export const checkTimeouts = async (env: Env): Promise<number> => {
  const now = nowIso();

  // Find tasks that have been assigned/running and exceeded timeout
  const timedOut = await env.DB.prepare(
    `SELECT * FROM task_queue
     WHERE status IN ('assigned', 'running')
       AND started_at IS NOT NULL
       AND (julianday(?) - julianday(started_at)) * 86400 > timeout_seconds`
  )
    .bind(now)
    .all<TaskQueueItem>();

  const tasks = timedOut.results ?? [];

  for (const task of tasks) {
    await env.DB.prepare(
      `UPDATE task_queue SET status = 'timeout', error_message = 'Task timed out',
       updated_at = ? WHERE id = ?`
    )
      .bind(now, task.id)
      .run();

    // Audit log for timeout
    await env.DB.prepare(
      `INSERT INTO ai_audit_log
        (task_id, biz_type, biz_id, provider_key, status, error_message,
         compute_node_id, created_at)
        VALUES (?, ?, ?, 'unknown', 'timeout', 'Task exceeded timeout', ?, ?)`
    )
      .bind(task.id, task.biz_type, task.biz_id, task.assigned_node_id ?? null, now)
      .run();

    // 合同起草任务终态超时（重试已耗尽，requeueTimedOutTasks 只 requeue
    // retry_count < max_retries 的任务，故此处 >= 即为终态）：回写节 error 并清 payload，
    // 否则节会永久卡在 generating（generate 抢占 409、编辑被 generating 守卫挡住）无法恢复。
    if (task.biz_type === "contract_draft" && task.retry_count >= task.max_retries) {
      await markContractDraftTaskError(env, task, now);
    }

    // 预审任务终态超时同理：不回写 error 会让预审单永久卡在 reviewing
    if (task.biz_type === "contract_precheck" && task.retry_count >= task.max_retries) {
      await markContractPrecheckTaskError(env, task, now);
    }
  }

  return tasks.length;
};

// ─── AI Gate Handler Implementation ──────────

/**
 * Creates an AiGateHandler that bridges the approval engine with the AI Slot system.
 * This implements the AiGateHandler interface from types/approval.ts.
 */
export const createAiGateHandler = (): AiGateHandler => ({
  async createAiTask(
    env: Env,
    request: { biz_type: string; biz_id: number; payload: Record<string, unknown> }
  ): Promise<{ task_id: number }> {
    const payload = await enrichAiGatePayload(env, request.biz_id, request.payload);
    const task = await createTask(env, {
      task_type: "approval_ai_gate",
      biz_type: request.biz_type,
      biz_id: request.biz_id,
      payload,
      priority: 8
    });
    return { task_id: task.id };
  },

  async getTaskResult(
    env: Env,
    taskId: number
  ): Promise<{ completed: boolean; outcome?: "approve" | "reject"; comment?: string } | null> {
    const task = await env.DB.prepare("SELECT * FROM task_queue WHERE id = ?")
      .bind(taskId)
      .first<TaskQueueItem>();

    if (!task) return null;

    if (task.status === "completed" && task.result_json) {
      // 拦截白名单需要真实业务类型：关卡任务的 payload.biz_type 即实例 biz_type
      let bizType: string | undefined;
      if (task.payload_json) {
        try {
          const payload = JSON.parse(task.payload_json) as { biz_type?: unknown };
          bizType = typeof payload.biz_type === "string" ? payload.biz_type : undefined;
        } catch {
          bizType = undefined;
        }
      }
      const parsed = parseAiGateTaskResult(task.result_json, { bizType });
      return {
        completed: true,
        outcome: parsed.outcome,
        comment: parsed.comment
      };
    }

    if (task.status === "failed" || task.status === "timeout") {
      return { completed: true, outcome: "approve", comment: "AI task failed, auto-approved" };
    }

    return { completed: false };
  }
});
