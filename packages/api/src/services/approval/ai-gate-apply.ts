/**
 * AI 关卡决策的统一落地出口。
 *
 * 写 AI_GATE 决策任务的地方有两处：executors.ts 的重入路径（initializeNode
 * 发现任务已完成）与 queue-handler.ts 的实时路径（runner 结果经队列到达）。
 * 两处必须共用本模块，避免重蹈"4 份解析副本发散"的覆辙。
 *
 * 语义（2026-08-14 分级拦截设计）：
 * - approve → 节点 completed（照旧）
 * - reject + manualOverride → 节点 completed → isNodeComplete 判 "rejected"
 *   → 引擎终态（超管刹车保留）
 * - reject（AI 自主，已过白名单）→ 节点 returned → isNodeComplete 判
 *   "returned" → 引擎走退回：发起人修改后原单重提，不再烧流水号/产生孤儿草稿
 * - reject（AI 自主）且已配置兜底审核人（2026-09-13 转人工设计）→ 节点保持
 *   in_progress，转人工裁决，不再自动退回；详见 settleAiGateBlock
 */

import type { Env } from "../../types/env";
import type { ParsedAiGateResult } from "./ai-gate-result";
import { BIZ_TYPE_TABLE_MAP } from "./biz-table";
import { hasPendingHumanTaskOnNode, resolveAiGateFallbackReviewer } from "./ai-gate-fallback";
import { publishEvent } from "../event-bus";

const nowIso = () => new Date().toISOString();

interface GateNodeRef {
  id: number;
  round: number;
}

interface GateInstanceRef {
  id: number;
  instance_no: string;
  biz_type: string;
  biz_id: number;
}

const insertAiGateDecisionTask = async (
  env: Env,
  node: GateNodeRef,
  instanceId: number,
  parsed: ParsedAiGateResult,
  now: string
): Promise<void> => {
  await env.DB.prepare(
    `INSERT INTO approval_task
      (node_instance_id, instance_id, assignee_userid, action, comment, round, status, acted_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      node.id,
      instanceId,
      "AI_GATE",
      parsed.outcome,
      parsed.comment,
      node.round,
      "completed",
      now,
      now,
      now
    )
    .run();
};

export type AiGateBlockSettlement = "escalated" | "returned" | "skipped";

/**
 * AI 自主拦截的落地（2026-09-13 转人工设计）：
 * - 已配置兜底审核人 → 节点保持 in_progress，写 AI 驳回记录，给审核人建 pending 任务，
 *   发 APPROVAL_AI_ESCALATED（审核人待办卡 + 发起人结果卡）
 * - 未配置（或配置读取抛错，如 Worker 先于迁移 0088 上线）→ 旧行为：节点 returned
 *   （引擎随后 applyAiGateReturn 退回发起人），并写告警日志行（抛错时附 error）
 * - 节点已有 pending 人工任务 → 整段跳过（队列重试幂等）
 * 两条路径都先写 AI 记录：转人工 = AI 记录 → 人工任务 → 事件；退回 = AI 记录 →
 * 节点 returned → 告警日志。先落节点 returned 会让 isolate 中途死亡时队列重入的
 * `status = 'in_progress'` 查询再也找不到该节点，实例卡死且没有 AI 记录。
 * 人工任务写失败即抛错交队列重试——但「交队列重试」只在实时路径（queue-handler 的
 * TASK_COMPLETED）成立。关卡更常见的入口是上一位审批人的 HTTP 请求：advanceWorkflow →
 * initializeNode 发现 AI 任务早已完成而直接重入，此时队列里没有对应消息，中途失败没有任何
 * 自动重试，只剩「关卡 in_progress + AI 驳回记录 + 无人工任务」的半成品。恢复手段是超管在
 * 「AI关卡任务」页对该任务放行/驳回（routes/admin.ts 的 ai-gate handle 路由）；后续计划补一个
 * 巡检任务扫出这种半成品自动收口。
 *
 * 已知窗口（D1 无事务，均为有意接受）：
 * 1. 检查后写入存在竞态：队列实时路径与执行器重入路径若同时进入，可能各建一条人工任务、
 *    各推一张卡；不能用唯一索引兜底（会签/或签节点合法地持有多条 pending 人工任务），
 *    由控制台放行/驳回时的悬空任务清理兜底。
 * 2. 事件已记 event_log 但队列投递失败（publishEvent 只 warn 不抛）时不会重试，审核人
 *    只能在待办列表看到任务、收不到卡片；接受该缺口，后续可加待办兜底巡检。
 * 3. 部分写入后重试可能重复一条 AI 驳回记录（不对 AI 记录做幂等守卫，否则同轮合法重跑会
 *    丢掉新理由），引擎与前端均取最新一条。
 */
export const settleAiGateBlock = async (
  env: Env,
  node: GateNodeRef,
  instanceId: number,
  parsed: ParsedAiGateResult
): Promise<AiGateBlockSettlement> => {
  const now = nowIso();

  if (await hasPendingHumanTaskOnNode(env, node.id)) {
    return "skipped";
  }

  let reviewer: string | null = null;
  let reviewerError: string | null = null;
  try {
    reviewer = await resolveAiGateFallbackReviewer(env);
  } catch (error) {
    console.error("[ai-gate] fallback reviewer lookup failed, degrading to auto-return:", error);
    reviewerError = error instanceof Error ? error.message : String(error);
  }

  if (!reviewer) {
    await insertAiGateDecisionTask(env, node, instanceId, parsed, now);
    await env.DB.prepare(
      `UPDATE approval_node_instance SET status = 'returned', completed_at = ?, updated_at = ?
       WHERE id = ?`
    )
      .bind(now, now, node.id)
      .run();
    await env.DB.prepare(
      "INSERT INTO event_log (event_type, event_source, event_payload, created_at) VALUES (?, ?, ?, ?)"
    )
      .bind(
        "ai_gate_fallback_reviewer_missing",
        "approval-engine",
        JSON.stringify({
          instance_id: instanceId,
          node_instance_id: node.id,
          ...(reviewerError ? { error: reviewerError } : {})
        }),
        now
      )
      .run();
    return "returned";
  }

  await insertAiGateDecisionTask(env, node, instanceId, parsed, now);
  await env.DB.prepare(
    `INSERT INTO approval_task
      (node_instance_id, instance_id, assignee_userid, round, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'pending', ?, ?)`
  )
    .bind(node.id, instanceId, reviewer, node.round, now, now)
    .run();

  const instance = await env.DB.prepare(
    "SELECT id, instance_no FROM approval_instance WHERE id = ?"
  )
    .bind(instanceId)
    .first<{ id: number; instance_no: string }>();

  await publishEvent(env, "APPROVAL_AI_ESCALATED", "approval-engine", {
    instance_id: instanceId,
    instance_no: instance?.instance_no ?? "",
    node_instance_id: node.id,
    reviewer_userid: reviewer,
    reason: parsed.comment
  });
  return "escalated";
};

/**
 * 落地 AI 关卡决策：更新节点状态 + 写 AI_GATE 决策任务（审计与前端展示）。
 * comment 原文保留（reject 时为「AI审查不通过：…」，退回/转人工后审核人与发起人
 * 均可见确切理由）。AI 自主拦截整段交给 settleAiGateBlock。
 */
export const applyAiGateDecision = async (
  env: Env,
  node: GateNodeRef,
  instanceId: number,
  parsed: ParsedAiGateResult
): Promise<void> => {
  const aiBlocks = parsed.outcome === "reject" && !parsed.manualOverride;

  if (aiBlocks) {
    await settleAiGateBlock(env, node, instanceId, parsed);
    return;
  }

  const now = nowIso();
  await env.DB.prepare(
    `UPDATE approval_node_instance SET status = 'completed', completed_at = ?, updated_at = ?
     WHERE id = ?`
  )
    .bind(now, now, node.id)
    .run();

  await insertAiGateDecisionTask(env, node, instanceId, parsed, now);
};

/**
 * AI 关卡拦截后的实例级退回，镜像 operations.returnToInitiator 的状态迁移：
 * 实例 returned + 清 current_node_key（进发起人「退回待处理」桶）、
 * 业务记录回 draft（发起人可编辑重提）、发 APPROVAL_RETURNED 走既有通知链。
 * 不写 approval_initiator_action（那是人工操作审计表；AI 的理由已在
 * AI_GATE 决策任务的 comment 里）。
 */
export const applyAiGateReturn = async (
  env: Env,
  instance: GateInstanceRef,
  nodeInstanceId: number
): Promise<void> => {
  const now = nowIso();

  await env.DB.prepare(
    `UPDATE approval_node_instance SET status = 'returned', completed_at = ?, updated_at = ?
     WHERE id = ?`
  )
    .bind(now, now, nodeInstanceId)
    .run();

  await env.DB.prepare(
    `UPDATE approval_instance SET status = 'returned', current_node_key = NULL, updated_at = ?
     WHERE id = ?`
  )
    .bind(now, instance.id)
    .run();

  const bizTable = BIZ_TYPE_TABLE_MAP[instance.biz_type];
  if (bizTable) {
    await env.DB.prepare(
      `UPDATE ${bizTable} SET status = 'draft', updated_at = ? WHERE id = ?`
    )
      .bind(now, instance.biz_id)
      .run();
  }

  await publishEvent(env, "APPROVAL_RETURNED", "approval-engine", {
    instance_id: instance.id,
    instance_no: instance.instance_no,
    returned_by: "AI_GATE",
    return_type: "ai_gate"
  });
};
