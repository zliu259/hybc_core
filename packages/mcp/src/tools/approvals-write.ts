/**
 * 审批写工具：**只能发起，不能落库**。
 *
 * 服务端收到智能体令牌发来的 approve/reject 时不会直接执行，而是把动作
 * park 住（202 + status=awaiting_confirmation），并向该员工本人推送企业微信
 * 确认卡片。只有**员工本人**在企业微信/网页端点确认之后，服务端才会重放这
 * 次请求、真正写库。
 *
 * 因此本文件里的工具永远只负责：发起 → 把 pending_action_id 与提示交回给
 * agent → 由 agent 提示用户去企业微信确认 → 用 check_pending 查终态。
 * 任何情况下 agent 都**不得代替用户确认**，也不得自动重试已 park 的动作。
 */
import { z } from "zod";

import { ApiError, type HybcApiClient } from "../api-client.js";
import { textResult, type ToolDef } from "./types.js";

interface ParkedAction {
  status?: string;
  pending_action_id?: string;
  summary?: string;
  expires_at?: string;
}

const AWAITING = "awaiting_confirmation";

const NEXT_STEPS = [
  "该操作【尚未生效】：服务端已暂存，并向本人推送了企业微信确认卡片。",
  "请提示用户打开企业微信，核对卡片内容后自行点击确认；确认后服务端才会真正执行。",
  "你【绝不能】代替用户确认，也不要重复发起同一动作（会占用待确认动作上限）。",
  "需要知道结果时，用 check_pending(pending_action_id) 查询终态。"
].join(" ");

const hintFor = (status: number): string => {
  if (status === 403) {
    return "当前令牌不具备该写能力（可能是只读或该能力未开放）。如实告知用户，并引导其在网页端完成该操作，不要重试绕过。";
  }
  if (status === 429) {
    return "待确认动作过多，已达上限。请提示用户先去企业微信处理已有的待确认卡片，之后再发起；不要重试。";
  }
  if (status === 401) {
    return "登录状态失效，提示用户在终端运行 `hybc-mcp login` 重新授权。";
  }
  return "如实把该错误告知用户，不要重试，也不要臆测结果。";
};

const failure = (error: unknown): ReturnType<typeof textResult> => {
  if (error instanceof ApiError) {
    return textResult({
      error: error.message,
      status: error.status,
      hint: hintFor(error.status)
    });
  }
  throw error;
};

const decide = (
  client: HybcApiClient,
  action: "approve" | "reject"
): ToolDef["handler"] => {
  return async (args) => {
    const id = args.id as number;
    const comment = typeof args.comment === "string" ? args.comment : undefined;
    const body: Record<string, string> = comment === undefined ? {} : { comment };

    try {
      const env = await client.post<ParkedAction>(`/approval/${id}/${action}`, body);
      const data = env.data ?? {};

      if (data.status === AWAITING) {
        return textResult({
          status: AWAITING,
          pending_action_id: data.pending_action_id,
          summary: data.summary,
          expires_at: data.expires_at,
          next_steps: NEXT_STEPS
        });
      }

      return textResult(data);
    } catch (error) {
      return failure(error);
    }
  };
};

export const approvalWriteTools = (client: HybcApiClient): ToolDef[] => [
  {
    name: "approve_task",
    title: "发起审批通过（需本人微信确认）",
    description:
      "对指定审批实例发起【通过】。注意：不会立即生效——服务端会暂存该动作并向本人推送企业微信确认卡片，须由该员工本人确认后才真正执行。你必须提示用户去企业微信确认，不得代替用户确认，也不要重复发起同一动作。",
    inputSchema: {
      id: z.number().int().describe("审批实例 id"),
      comment: z.string().optional().describe("审批意见，会展示在确认卡片上供本人核对")
    },
    handler: decide(client, "approve")
  },
  {
    name: "reject_task",
    title: "发起审批驳回（需本人微信确认）",
    description:
      "对指定审批实例发起【驳回】。注意：不会立即生效——服务端会暂存该动作并向本人推送企业微信确认卡片，须由该员工本人确认后才真正执行。你必须提示用户去企业微信确认，不得代替用户确认，也不要重复发起同一动作。",
    inputSchema: {
      id: z.number().int().describe("审批实例 id"),
      comment: z.string().optional().describe("驳回理由，会展示在确认卡片上供本人核对")
    },
    handler: decide(client, "reject")
  },
  {
    name: "check_pending",
    title: "查询待确认动作状态",
    description:
      "按 pending_action_id 查询此前发起的待确认动作当前状态（等待确认 / 已确认执行 / 已拒绝 / 已过期）。仅查询，不会推进状态，也不能代替用户确认。",
    inputSchema: {
      pending_action_id: z
        .string()
        .describe("发起 approve_task/reject_task 时返回的 pending_action_id")
    },
    handler: async (args) => {
      try {
        const env = await client.get(`/agent/pending/${args.pending_action_id as string}`);
        return textResult(env.data);
      } catch (error) {
        return failure(error);
      }
    }
  }
];
