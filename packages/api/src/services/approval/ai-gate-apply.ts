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
 */

import type { Env } from "../../types/env";
import type { ParsedAiGateResult } from "./ai-gate-result";
import { BIZ_TYPE_TABLE_MAP } from "./biz-table";
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

/**
 * 落地 AI 关卡决策：更新节点状态 + 写 AI_GATE 决策任务（审计与前端展示）。
 * comment 原文保留（reject 时为「AI审查不通过：…」，退回后发起人可见确切理由）。
 */
export const applyAiGateDecision = async (
  env: Env,
  node: GateNodeRef,
  instanceId: number,
  parsed: ParsedAiGateResult
): Promise<void> => {
  const now = nowIso();
  const aiBlocks = parsed.outcome === "reject" && !parsed.manualOverride;

  if (aiBlocks) {
    await env.DB.prepare(
      `UPDATE approval_node_instance SET status = 'returned', completed_at = ?, updated_at = ?
       WHERE id = ?`
    )
      .bind(now, now, node.id)
      .run();
  } else {
    await env.DB.prepare(
      `UPDATE approval_node_instance SET status = 'completed', completed_at = ?, updated_at = ?
       WHERE id = ?`
    )
      .bind(now, now, node.id)
      .run();
  }

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
