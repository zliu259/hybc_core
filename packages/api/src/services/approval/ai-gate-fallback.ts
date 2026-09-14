/**
 * AI 关卡兜底审核人：系统级配置一位超管，AI 判定拦截时把单子转给他人工裁决。
 * 设计：docs/superpowers/specs/2026-09-13-ai-gate-human-escalation-design.md
 */
import type { Env } from "../../types/env";
import { getSystemConfig } from "../system-config";

export const AI_GATE_FALLBACK_REVIEWER_KEY = "approval.ai_gate.fallback_reviewer_userid";

/** 未配置或空白 → null，调用方据此退化为旧的自动退回。 */
export const resolveAiGateFallbackReviewer = async (env: Env): Promise<string | null> => {
  const value = await getSystemConfig(env, AI_GATE_FALLBACK_REVIEWER_KEY);
  return value ? value.trim() || null : null;
};

/**
 * 节点上是否已有 pending 的人工任务（受理人不是 AI_GATE）。
 * 队列重试时据此整段跳过，避免重复建任务、重复推卡。
 */
export const hasPendingHumanTaskOnNode = async (
  env: Env,
  nodeInstanceId: number
): Promise<boolean> => {
  const row = await env.DB.prepare(
    `SELECT id
       FROM approval_task
      WHERE node_instance_id = ?
        AND assignee_userid <> 'AI_GATE'
        AND status = 'pending'
      ORDER BY id DESC
      LIMIT 1`
  )
    .bind(nodeInstanceId)
    .first<{ id: number }>();
  return Boolean(row);
};
