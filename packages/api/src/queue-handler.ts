import type { Env } from "./types/env";
import { logEvent, type DomainEvent } from "./services/event-bus";
import { advanceWorkflow } from "./services/approval/engine";
import { parseAiGateTaskResult } from "./services/approval/ai-gate-result";
import { applyAiGateDecision } from "./services/approval/ai-gate-apply";
import { createAiGateHandler } from "./services/ai-slot";
import { executeCfAiTask, isCfAiTaskType } from "./services/cf-ai";
import {
  resolveApplicantDisplayName,
  resolveApprovalPushMeta,
  sendApprovalResultTemplateCard,
  sendApprovalTodoTemplateCard,
  type ApprovalResultType
} from "./services/wecom-approval-push";
import { pushProjectLogEventToWeComGroups } from "./services/wecom-message-push";

const nowIso = () => new Date().toISOString();

const getApprovalBizContext = async (
  env: Env,
  instanceId: number
): Promise<{ biz_type: string; biz_id: number } | null> => {
  return await env.DB.prepare("SELECT biz_type, biz_id FROM approval_instance WHERE id = ?")
    .bind(instanceId)
    .first<{ biz_type: string; biz_id: number }>();
};

const handleApprovalApproved = async (env: Env, instanceId: number): Promise<void> => {
  const context = await getApprovalBizContext(env, instanceId);
  if (!context) return;

  if (context.biz_type === "outbound_contract") {
    await env.DB.prepare("UPDATE contract SET status = 'active', updated_at = ? WHERE id = ?")
      .bind(nowIso(), context.biz_id)
      .run();
    return;
  }

  if (context.biz_type === "inbound_contract") {
    await env.DB.prepare("UPDATE contract SET status = 'active', updated_at = ? WHERE id = ?")
      .bind(nowIso(), context.biz_id)
      .run();
    return;
  }

  if (context.biz_type === "payment_request") {
    await env.DB.prepare(
      "UPDATE payment_request SET status = 'approved', updated_at = ? WHERE id = ?"
    )
      .bind(nowIso(), context.biz_id)
      .run();
    return;
  }

  if (context.biz_type === "contract_amount_change") {
    const change = await env.DB.prepare(
      "SELECT contract_id, new_amount FROM contract_amount_change WHERE id = ?"
    )
      .bind(context.biz_id)
      .first<{ contract_id: number; new_amount: number }>();

    if (!change) return;

    const now = nowIso();
    await env.DB.prepare(
      "UPDATE contract_amount_change SET status = 'approved', updated_at = ? WHERE id = ?"
    )
      .bind(now, context.biz_id)
      .run();

    await env.DB.prepare("UPDATE contract SET total_amount = ?, updated_at = ? WHERE id = ?")
      .bind(change.new_amount, now, change.contract_id)
      .run();
    return;
  }

  if (context.biz_type === "reimbursement_batch") {
    const now = nowIso();
    await env.DB.prepare(
      "UPDATE reimbursement_batch SET status = 'approved', updated_at = ? WHERE id = ?"
    )
      .bind(now, context.biz_id)
      .run();

    await env.DB.prepare(
      "UPDATE reimbursement_envelope SET status = 'approved', updated_at = ? WHERE batch_id = ?"
    )
      .bind(now, context.biz_id)
      .run();
    return;
  }

  if (context.biz_type === "stock_order") {
    await env.DB.prepare("UPDATE stock_order SET status = 'approved', updated_at = ? WHERE id = ?")
      .bind(nowIso(), context.biz_id)
      .run();
    return;
  }

  if (context.biz_type === "warehouse_asset_work_order") {
    await env.DB.prepare(
      "UPDATE warehouse_asset_work_order SET status = 'approved', updated_at = ? WHERE id = ?"
    )
      .bind(nowIso(), context.biz_id)
      .run();
    return;
  }

  if (context.biz_type === "invoice_request") {
    await env.DB.prepare(
      "UPDATE invoice_request SET status = 'approved', approved_at = ?, updated_at = ? WHERE id = ?"
    )
      .bind(nowIso(), nowIso(), context.biz_id)
      .run();
  }
};

const handleApprovalRejected = async (env: Env, instanceId: number): Promise<void> => {
  const context = await getApprovalBizContext(env, instanceId);
  if (!context) return;

  if (context.biz_type === "outbound_contract") {
    await env.DB.prepare("UPDATE contract SET status = 'draft', updated_at = ? WHERE id = ?")
      .bind(nowIso(), context.biz_id)
      .run();
    return;
  }

  if (context.biz_type === "inbound_contract") {
    await env.DB.prepare("UPDATE contract SET status = 'draft', updated_at = ? WHERE id = ?")
      .bind(nowIso(), context.biz_id)
      .run();
    return;
  }

  if (context.biz_type === "payment_request") {
    await env.DB.prepare(
      "UPDATE payment_request SET status = 'rejected', updated_at = ? WHERE id = ?"
    )
      .bind(nowIso(), context.biz_id)
      .run();
    return;
  }

  if (context.biz_type === "contract_amount_change") {
    await env.DB.prepare(
      "UPDATE contract_amount_change SET status = 'rejected', updated_at = ? WHERE id = ?"
    )
      .bind(nowIso(), context.biz_id)
      .run();
    return;
  }

  if (context.biz_type === "reimbursement_batch") {
    const now = nowIso();
    await env.DB.prepare(
      "UPDATE reimbursement_batch SET status = 'rejected', updated_at = ? WHERE id = ?"
    )
      .bind(now, context.biz_id)
      .run();

    await env.DB.prepare(
      "UPDATE reimbursement_envelope SET status = 'received', updated_at = ? WHERE batch_id = ?"
    )
      .bind(now, context.biz_id)
      .run();
    return;
  }

  if (context.biz_type === "stock_order") {
    await env.DB.prepare("UPDATE stock_order SET status = 'rejected', updated_at = ? WHERE id = ?")
      .bind(nowIso(), context.biz_id)
      .run();
    return;
  }

  if (context.biz_type === "warehouse_asset_work_order") {
    await env.DB.prepare(
      "UPDATE warehouse_asset_work_order SET status = 'draft', updated_at = ? WHERE id = ?"
    )
      .bind(nowIso(), context.biz_id)
      .run();
    return;
  }

  if (context.biz_type === "invoice_request") {
    await env.DB.prepare(
      "UPDATE invoice_request SET status = 'rejected', rejected_at = ?, updated_at = ? WHERE id = ?"
    )
      .bind(nowIso(), nowIso(), context.biz_id)
      .run();
  }
};

const handleAiGateTaskCompleted = async (env: Env, taskId: number): Promise<void> => {
  const task = await env.DB.prepare("SELECT * FROM task_queue WHERE id = ?").bind(taskId).first<{
    id: number;
    task_type: string;
    biz_id: number;
    payload_json: string | null;
    result_json: string | null;
  }>();

  if (!task || task.task_type !== "approval_ai_gate") return;

  let nodeKey: string | null = null;
  if (task.payload_json) {
    try {
      const payload = JSON.parse(task.payload_json) as { node_key?: string };
      nodeKey = payload.node_key ?? null;
    } catch {
      nodeKey = null;
    }
  }

  const node = nodeKey
    ? await env.DB.prepare(
        `SELECT * FROM approval_node_instance
         WHERE instance_id = ?
           AND node_type = 'ai_gate'
           AND node_key = ?
           AND status = 'in_progress'
         ORDER BY id DESC
         LIMIT 1`
      )
        .bind(task.biz_id, nodeKey)
        .first<{ id: number; round: number }>()
    : await env.DB.prepare(
        `SELECT * FROM approval_node_instance
         WHERE instance_id = ?
           AND node_type = 'ai_gate'
           AND status = 'in_progress'
         ORDER BY id DESC
         LIMIT 1`
      )
        .bind(task.biz_id)
        .first<{ id: number; round: number }>();

  if (!node) return;

  // 拦截白名单裁决需要实例的真实业务类型（payload 里的 biz_type 与其一致，
  // 但以 approval_instance 为权威来源，兼容旧任务 payload 缺字段的情况）
  const instanceRow = await env.DB.prepare(
    "SELECT biz_type FROM approval_instance WHERE id = ?"
  )
    .bind(task.biz_id)
    .first<{ biz_type: string }>();
  const parsedResult = parseAiGateTaskResult(task.result_json, {
    bizType: instanceRow?.biz_type,
    fallbackComment: "AI关卡已执行"
  });
  await applyAiGateDecision(env, node, task.biz_id, parsedResult);

  await advanceWorkflow(env, task.biz_id, createAiGateHandler());
};

const handleApprovalSubmitted = async (env: Env, instanceId: number): Promise<void> => {
  const instance = await env.DB.prepare(
    `SELECT ai.id, ai.instance_no, ai.biz_type, ai.biz_id, ai.biz_summary, ai.initiator_userid,
            COALESCE(ani.node_name, ai.current_node_key, '当前节点') AS current_node_name
     FROM approval_instance ai
     LEFT JOIN approval_node_instance ani
       ON ani.instance_id = ai.id
      AND ani.node_key = ai.current_node_key
      AND ani.round = ai.current_round
     WHERE ai.id = ?`
  )
    .bind(instanceId)
    .first<{
      id: number;
      instance_no: string;
      biz_type: string;
      biz_id: number;
      biz_summary: string;
      initiator_userid: string;
      current_node_name: string;
    }>();

  if (!instance) {
    return;
  }

  const pendingTaskRows = await env.DB.prepare(
    `SELECT DISTINCT assignee_userid
     FROM approval_task
     WHERE instance_id = ?
       AND status = 'pending'
       AND assignee_userid IS NOT NULL
       AND assignee_userid != ''`
  )
    .bind(instanceId)
    .all<{ assignee_userid: string }>();

  const recipientSet = new Set<string>();
  for (const row of pendingTaskRows.results ?? []) {
    const userid = row.assignee_userid.trim();
    if (userid) recipientSet.add(userid);
  }

  const recipients = [...recipientSet];
  if (recipients.length === 0) {
    return;
  }

  let successCount = 0;
  const errors: string[] = [];
  const applicantName = await resolveApplicantDisplayName(env, instance.initiator_userid);
  const pushMeta = await resolveApprovalPushMeta(
    env,
    instance.biz_type,
    instance.biz_id,
    instance.biz_summary
  );

  for (const assignee of recipients) {
    try {
      const result = await sendApprovalTodoTemplateCard(env, {
        instanceId,
        instanceNo: instance.instance_no,
        bizType: instance.biz_type,
        bizId: instance.biz_id,
        bizSummary: instance.biz_summary,
        currentNodeName: instance.current_node_name,
        assigneeUserId: assignee,
        applicantName,
        requestTitle: pushMeta.requestTitle,
        amountText: pushMeta.amountText ?? undefined
      });
      successCount += 1;

      await env.DB.prepare(
        "INSERT INTO event_log (event_type, event_source, event_payload, created_at) VALUES (?, ?, ?, ?)"
      )
        .bind(
          "wecom_template_card_sent",
          "queue-handler",
          JSON.stringify({
            instance_id: instanceId,
            assignee_userid: assignee,
            msgid: result.msgid,
            invaliduser: result.invaliduser,
            unlicenseduser: result.unlicenseduser
          }),
          nowIso()
        )
        .run();
    } catch (error) {
      const message = error instanceof Error ? error.message : "send failed";
      errors.push(`${assignee}: ${message}`);

      await env.DB.prepare(
        "INSERT INTO event_log (event_type, event_source, event_payload, created_at) VALUES (?, ?, ?, ?)"
      )
        .bind(
          "wecom_template_card_failed",
          "queue-handler",
          JSON.stringify({
            instance_id: instanceId,
            assignee_userid: assignee,
            error: message
          }),
          nowIso()
        )
        .run();
    }
  }

  await env.DB.prepare(
    "INSERT INTO event_log (event_type, event_source, event_payload, created_at) VALUES (?, ?, ?, ?)"
  )
    .bind(
      "wecom_template_card_summary",
      "queue-handler",
      JSON.stringify({
        instance_id: instanceId,
        recipient_count: recipients.length,
        pending_assignee_count: (pendingTaskRows.results ?? []).length,
        success_count: successCount,
        failure_count: errors.length,
        errors
      }),
      nowIso()
    )
    .run();
};

const logResultPushIsolationGuard = async (
  env: Env,
  payload: {
    instance_id: number;
    event_type: string;
    error: string;
  }
) => {
  await env.DB.prepare(
    "INSERT INTO event_log (event_type, event_source, event_payload, created_at) VALUES (?, ?, ?, ?)"
  )
    .bind(
      "wecom_template_card_result_isolation_guard",
      "queue-handler",
      JSON.stringify(payload),
      nowIso()
    )
    .run();
};

const pushApprovalResultToInitiator = async (
  env: Env,
  instanceId: number,
  resultType: ApprovalResultType,
  resultReason?: string
) => {
  const instance = await env.DB.prepare(
    `SELECT ai.id, ai.instance_no, ai.biz_type, ai.biz_id, ai.biz_summary, ai.initiator_userid
       FROM approval_instance ai
      WHERE ai.id = ?
      LIMIT 1`
  )
    .bind(instanceId)
    .first<{
      id: number;
      instance_no: string;
      biz_type: string;
      biz_id: number;
      biz_summary: string;
      initiator_userid: string;
    }>();

  if (!instance) {
    return;
  }

  const initiatorUserId = instance.initiator_userid?.trim();
  if (!initiatorUserId) {
    return;
  }

  const initiatorName = await resolveApplicantDisplayName(env, initiatorUserId);
  const pushMeta = await resolveApprovalPushMeta(
    env,
    instance.biz_type,
    instance.biz_id,
    instance.biz_summary
  );

  try {
    const result = await sendApprovalResultTemplateCard(env, {
      instanceId,
      instanceNo: instance.instance_no,
      bizType: instance.biz_type,
      bizId: instance.biz_id,
      bizSummary: instance.biz_summary,
      initiatorUserId,
      initiatorName,
      resultType,
      resultReason,
      requestTitle: pushMeta.requestTitle,
      amountText: pushMeta.amountText ?? undefined
    });

    await env.DB.prepare(
      "INSERT INTO event_log (event_type, event_source, event_payload, created_at) VALUES (?, ?, ?, ?)"
    )
      .bind(
        "wecom_template_card_result_sent",
        "queue-handler",
        JSON.stringify({
          instance_id: instanceId,
          initiator_userid: initiatorUserId,
          result_type: resultType,
          msgid: result.msgid,
          invaliduser: result.invaliduser,
          unlicenseduser: result.unlicenseduser
        }),
        nowIso()
      )
      .run();
  } catch (error) {
    const message = error instanceof Error ? error.message : "send failed";
    await env.DB.prepare(
      "INSERT INTO event_log (event_type, event_source, event_payload, created_at) VALUES (?, ?, ?, ?)"
    )
      .bind(
        "wecom_template_card_result_failed",
        "queue-handler",
        JSON.stringify({
          instance_id: instanceId,
          initiator_userid: initiatorUserId,
          result_type: resultType,
          error: message
        }),
        nowIso()
      )
      .run();
    throw error;
  }
};

const REJECT_REASON_MAX_LENGTH = 200;

const resolveRejectPushReason = async (env: Env, instanceId: number): Promise<string> => {
  const fallback = "流程已驳回";
  try {
    const row = await env.DB.prepare(
      `SELECT comment
         FROM approval_task
        WHERE instance_id = ?
          AND action = 'reject'
          AND comment IS NOT NULL
          AND comment != ''
        ORDER BY id DESC
        LIMIT 1`
    )
      .bind(instanceId)
      .first<{ comment: string }>();

    const comment = row?.comment?.trim();
    if (!comment) {
      return fallback;
    }
    // 企微模板卡片文案超长会导致整卡发送失败，截断兜底；
    // 按码点切分，避免把 emoji 的代理对切成半个字符（企微会判为非法 JSON）
    const codePoints = Array.from(comment);
    const clipped =
      codePoints.length > REJECT_REASON_MAX_LENGTH
        ? `${codePoints.slice(0, REJECT_REASON_MAX_LENGTH - 1).join("")}…`
        : comment;
    return `${fallback}：${clipped}`;
  } catch (error) {
    console.error(
      "resolveRejectPushReason failed, fallback to default reason:",
      error instanceof Error ? error.message : error
    );
    return fallback;
  }
};

export const queue = async (batch: MessageBatch<DomainEvent>, env: Env): Promise<void> => {
  for (const msg of batch.messages) {
    try {
      const event = msg.body;
      await logEvent(env, event);

      switch (event.type) {
        case "APPROVAL_SUBMITTED": {
          const instanceId = Number(event.payload?.instance_id ?? 0);
          if (!Number.isNaN(instanceId) && instanceId > 0) {
            try {
              await handleApprovalSubmitted(env, instanceId);
            } catch (error) {
              await env.DB.prepare(
                "INSERT INTO event_log (event_type, event_source, event_payload, created_at) VALUES (?, ?, ?, ?)"
              )
                .bind(
                  "wecom_template_card_isolation_guard",
                  "queue-handler",
                  JSON.stringify({
                    instance_id: instanceId,
                    error: error instanceof Error ? error.message : "unknown error"
                  }),
                  nowIso()
                )
                .run();
            }
          }
          break;
        }
        case "APPROVAL_NODE_ENTERED": {
          const instanceId = Number(event.payload?.instance_id ?? 0);
          if (!Number.isNaN(instanceId) && instanceId > 0) {
            try {
              await handleApprovalSubmitted(env, instanceId);
            } catch (error) {
              await env.DB.prepare(
                "INSERT INTO event_log (event_type, event_source, event_payload, created_at) VALUES (?, ?, ?, ?)"
              )
                .bind(
                  "wecom_template_card_isolation_guard",
                  "queue-handler",
                  JSON.stringify({
                    instance_id: instanceId,
                    event_type: "APPROVAL_NODE_ENTERED",
                    error: error instanceof Error ? error.message : "unknown error"
                  }),
                  nowIso()
                )
                .run();
            }
          }
          break;
        }
        case "APPROVAL_TRANSFERRED": {
          const instanceId = Number(event.payload?.instance_id ?? 0);
          if (!Number.isNaN(instanceId) && instanceId > 0) {
            try {
              await handleApprovalSubmitted(env, instanceId);
            } catch (error) {
              await env.DB.prepare(
                "INSERT INTO event_log (event_type, event_source, event_payload, created_at) VALUES (?, ?, ?, ?)"
              )
                .bind(
                  "wecom_template_card_isolation_guard",
                  "queue-handler",
                  JSON.stringify({
                    instance_id: instanceId,
                    event_type: "APPROVAL_TRANSFERRED",
                    error: error instanceof Error ? error.message : "unknown error"
                  }),
                  nowIso()
                )
                .run();
            }
          }
          break;
        }
        case "APPROVAL_RETURNED": {
          const instanceId = Number(event.payload?.instance_id ?? 0);
          if (!Number.isNaN(instanceId) && instanceId > 0) {
            try {
              await handleApprovalSubmitted(env, instanceId);
            } catch (error) {
              await env.DB.prepare(
                "INSERT INTO event_log (event_type, event_source, event_payload, created_at) VALUES (?, ?, ?, ?)"
              )
                .bind(
                  "wecom_template_card_isolation_guard",
                  "queue-handler",
                  JSON.stringify({
                    instance_id: instanceId,
                    event_type: "APPROVAL_RETURNED",
                    error: error instanceof Error ? error.message : "unknown error"
                  }),
                  nowIso()
                )
                .run();
            }

            const returnTypeRaw = String(event.payload?.return_type ?? "");
            const returnReasonMap: Record<string, string> = {
              initiator: "流程已退回发起人",
              prev: "流程已退回上一步节点",
              to: "流程已退回指定节点"
            };

            try {
              await pushApprovalResultToInitiator(
                env,
                instanceId,
                "returned",
                returnReasonMap[returnTypeRaw] ?? "流程已退回"
              );
            } catch (error) {
              await logResultPushIsolationGuard(env, {
                instance_id: instanceId,
                event_type: "APPROVAL_RETURNED",
                error: error instanceof Error ? error.message : "unknown error"
              });
            }
          }
          break;
        }
        case "APPROVAL_APPROVED": {
          const instanceId = Number(event.payload?.instance_id ?? 0);
          if (!Number.isNaN(instanceId) && instanceId > 0) {
            await handleApprovalApproved(env, instanceId);
            try {
              await pushApprovalResultToInitiator(env, instanceId, "approved", "流程审批已完成");
            } catch (error) {
              await logResultPushIsolationGuard(env, {
                instance_id: instanceId,
                event_type: "APPROVAL_APPROVED",
                error: error instanceof Error ? error.message : "unknown error"
              });
            }
          }
          break;
        }
        case "APPROVAL_REJECTED": {
          const instanceId = Number(event.payload?.instance_id ?? 0);
          if (!Number.isNaN(instanceId) && instanceId > 0) {
            await handleApprovalRejected(env, instanceId);
            try {
              const rejectReason = await resolveRejectPushReason(env, instanceId);
              await pushApprovalResultToInitiator(env, instanceId, "rejected", rejectReason);
            } catch (error) {
              await logResultPushIsolationGuard(env, {
                instance_id: instanceId,
                event_type: "APPROVAL_REJECTED",
                error: error instanceof Error ? error.message : "unknown error"
              });
            }
          }
          break;
        }
        case "APPROVAL_CANCELLED": {
          const instanceId = Number(event.payload?.instance_id ?? 0);
          if (!Number.isNaN(instanceId) && instanceId > 0) {
            try {
              await pushApprovalResultToInitiator(env, instanceId, "cancelled", "流程已终止");
            } catch (error) {
              await logResultPushIsolationGuard(env, {
                instance_id: instanceId,
                event_type: "APPROVAL_CANCELLED",
                error: error instanceof Error ? error.message : "unknown error"
              });
            }
          }
          break;
        }
        case "APPROVAL_WITHDRAWN": {
          const instanceId = Number(event.payload?.instance_id ?? 0);
          if (!Number.isNaN(instanceId) && instanceId > 0) {
            try {
              await pushApprovalResultToInitiator(env, instanceId, "withdrawn", "流程已撤回");
            } catch (error) {
              await logResultPushIsolationGuard(env, {
                instance_id: instanceId,
                event_type: "APPROVAL_WITHDRAWN",
                error: error instanceof Error ? error.message : "unknown error"
              });
            }
          }
          break;
        }
        case "TASK_CREATED": {
          const createdTaskId = Number(event.payload?.task_id ?? 0);
          const createdTaskType = String(event.payload?.task_type ?? "");
          if (createdTaskId > 0 && isCfAiTaskType(createdTaskType)) {
            await executeCfAiTask(env, createdTaskId);
          }
          break;
        }
        case "TASK_COMPLETED": {
          const taskId = Number(event.payload?.task_id ?? 0);
          if (!Number.isNaN(taskId) && taskId > 0) {
            await handleAiGateTaskCompleted(env, taskId);
          }
          break;
        }
        case "MANAGER_LOG_CREATED":
        case "MANAGER_LOG_UPDATED":
        case "OPERATOR_LOG_CREATED":
        case "OPERATOR_LOG_UPDATED":
        case "EXTERNAL_LOG_ADOPTED": {
          const projectId = Number(event.payload?.project_id ?? 0);
          const managerLogId = Number(event.payload?.manager_log_id ?? 0);
          const operatorLogId = Number(event.payload?.operator_log_id ?? 0);
          const externalSubmissionId = Number(event.payload?.external_submission_id ?? 0);
          if (projectId > 0 && (managerLogId > 0 || operatorLogId > 0)) {
            await pushProjectLogEventToWeComGroups(env, {
              event_type: event.type,
              project_id: projectId,
              manager_log_id: managerLogId || null,
              operator_log_id: operatorLogId || null,
              external_submission_id: externalSubmissionId || null
            });
          }
          break;
        }
        default:
          break;
      }

      msg.ack();
    } catch (err) {
      console.error("Queue processing error:", err);
      msg.retry();
    }
  }
};
