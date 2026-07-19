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
 *
 * ## 为什么传输层异常也要包装成正常返回
 *
 * 服务端 park 的顺序是【先落库提交 → waitUntil 里推卡片 → 最后才返回 202】
 * （见 api/src/services/agent-park.ts）。所以响应回程中断（连接重置、超时、
 * DNS 失败）时，动作很可能**已经 park 成功、卡片已经推到员工微信**，而我们
 * 只看到一个裸的 TypeError。这是全流程唯一真正歧义的场景——把它原样抛出去，
 * agent 面对裸传输错误的默认行为就是重试，于是员工收到第二张一模一样的卡片、
 * 占掉第二个待确认名额，且无法判断该确认哪张、会不会批两次。
 * 故这里一律降落成结构化结果，明说「结果未知、不要重发、改用 check_pending」。
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

/** 发起类工具的 comment：这段话会以员工本人的名义进入正式审批记录。 */
const COMMENT_DESC =
  "审批意见。该文本会展示在确认卡片上供本人核对，并在本人确认后**以你所代表的员工本人名义**写入正式审批记录并长期留存。" +
  "请如实转述用户给出的理由，**不要以第一人称代入你自己**（不要写「AI 已核对无误」这类把你自己当行为主体的话）。" +
  "尽量填写：留空会让正式记录里缺少决策依据。";

const NEXT_STEPS = [
  "该操作【尚未生效】：服务端已暂存，并向本人推送了企业微信确认卡片。",
  "请提示用户打开企业微信，核对卡片内容后自行点击确认；确认后服务端才会真正执行。",
  "你【绝不能】代替用户确认，也不要重复发起同一动作（会占用待确认动作上限）。",
  "需要知道结果时，用 check_pending(pending_action_id) 查询终态。"
].join(" ");

/**
 * 结果未知时给 agent 的指引。措辞的要害是先否定「什么都没发生」这个默认假设，
 * 再给出唯一安全的下一步——查询而非重发。
 */
const UNKNOWN_OUTCOME =
  "本次请求的结果【未知】：请求可能已经送达服务端，动作**可能已经发起、确认卡片可能已经推送到员工的企业微信**。" +
  "【不要重发】这个动作——重发会造成第二张内容相同的卡片、占掉第二个待确认名额，员工将无法判断该确认哪一张。" +
  "正确做法：让用户查看企业微信是否已收到确认卡片；若此前拿到过 pending_action_id，用 check_pending 查询；" +
  "都没有时，如实告诉用户「发起结果未确认」，由其在网页端核对后再决定是否重新发起。";

/** 只读查询失败时的指引：查询没有副作用，重试是安全且正确的。 */
const READ_RETRY_OK =
  "这只是查询失败（网络或服务端问题），【不代表】待确认动作本身有任何变化。查询是只读的、重试无副作用，可以稍后再查一次。";

/** 写路径的 ApiError 指引。 */
const writeHint = (status: number, message: string): string => {
  if (status === 403) {
    return "当前令牌不具备该写能力（可能是只读或该能力未开放）。如实告知用户，并引导其在网页端完成该操作，不要重试绕过。";
  }
  if (status === 429) {
    // 服务端有两种触顶，下一步完全不同（见 api/src/services/agent-park.ts）。
    // data.reason 带机器可读原因，但 api-client 在 success:false 时直接抛 ApiError
    // 并丢弃整个信封，客户端只拿得到 error.message，故只能据文案区分。
    if (message.includes("在途")) {
      return "同时未处理的确认卡片已达在途上限。请提示用户先去企业微信确认或拒绝已推送的卡片，处理掉几张后即可继续；不要重试。";
    }
    if (message.includes("小时内") || message.includes("稍后再试")) {
      return "该授权在滚动时间窗内发起的高危动作已达总量上限。注意：处理掉已有卡片【不会】退还额度，只能等时间窗口滑过；请如实告知用户稍后再试，不要重试。若这些动作并非用户本人授意，提示其立即在网页端吊销该授权。";
    }
    return "已触发额度限制，但具体属于哪一种未能识别。请把上面 error 的原文如实转述给用户，由其判断下一步；不要重试。";
  }
  if (status === 401) {
    return "登录状态失效，提示用户在终端运行 `hybc-mcp login` 重新授权。";
  }
  return "如实把该错误告知用户，不要重试，也不要臆测结果。";
};

/** 只读路径的 ApiError 指引：区分「确实没有」与「这次没查到」。 */
const readHint = (status: number): string => {
  if (status === 404) {
    return "服务端查不到该 pending_action_id（可能 id 有误，或该动作已被清理）。如实告诉用户【查不到这条记录】，不要把它读成「仍在等待确认」——重复查询也不会让它出现。";
  }
  if (status === 403) {
    return "无权查看该待确认动作（它可能属于另一个授权）。如实告知用户，不要重试绕过。";
  }
  if (status === 401) {
    return "登录状态失效，提示用户在终端运行 `hybc-mcp login` 重新授权。";
  }
  if (status >= 500) {
    return READ_RETRY_OK;
  }
  return "如实把该错误告知用户；查询本身是只读的，必要时可稍后再查一次。";
};

const writeFailure = (error: unknown): ReturnType<typeof textResult> => {
  if (error instanceof ApiError) {
    return textResult({
      error: error.message,
      status: error.status,
      hint: writeHint(error.status, error.message)
    });
  }
  // 传输层异常：结果真的未知，绝不能让 agent 当成「没发生」而重发。
  return textResult({
    status: "unknown",
    error: error instanceof Error ? error.message : String(error),
    hint: UNKNOWN_OUTCOME
  });
};

const readFailure = (error: unknown): ReturnType<typeof textResult> => {
  if (error instanceof ApiError) {
    return textResult({
      error: error.message,
      status: error.status,
      hint: readHint(error.status)
    });
  }
  return textResult({
    error: error instanceof Error ? error.message : String(error),
    hint: READ_RETRY_OK
  });
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
      return writeFailure(error);
    }
  };
};

const decideDescription = (verb: string): string =>
  `对指定审批实例发起【${verb}】。注意：不会立即生效——服务端会暂存该动作并向本人推送企业微信确认卡片，须由该员工本人确认后才真正执行。` +
  "你必须提示用户去企业微信确认，不得代替用户确认，也不要重复发起同一动作。" +
  "请尽量填写 comment：它会以该员工本人的名义写入正式审批记录。";

export const approvalWriteTools = (client: HybcApiClient): ToolDef[] => [
  {
    name: "approve_task",
    title: "发起审批通过（需本人微信确认）",
    description: decideDescription("通过"),
    inputSchema: {
      id: z.number().int().describe("审批实例 id"),
      comment: z.string().optional().describe(COMMENT_DESC)
    },
    handler: decide(client, "approve")
  },
  {
    name: "reject_task",
    title: "发起审批驳回（需本人微信确认）",
    description: decideDescription("驳回"),
    inputSchema: {
      id: z.number().int().describe("审批实例 id"),
      comment: z.string().optional().describe(COMMENT_DESC)
    },
    handler: decide(client, "reject")
  },
  {
    name: "check_pending",
    title: "查询待确认动作状态",
    description:
      "按 pending_action_id 查询此前发起的待确认动作当前状态。可能的状态：pending(等待本人确认)、confirmed(已确认待执行)、" +
      "executing(执行中，可稍后再查)、done(已成功执行)、failed(重放执行失败，结果未知、可能已经落库，必须让用户去核对而不能报成「没生效」)、" +
      "rejected(本人已拒绝)、expired(超时未确认已过期)。仅查询，不会推进状态，也不能代替用户确认。",
    inputSchema: {
      pending_action_id: z
        .string()
        .uuid()
        .describe("发起 approve_task/reject_task 时返回的 pending_action_id（UUID）")
    },
    handler: async (args) => {
      try {
        // 即便 schema 已限定 UUID，拼接处仍做编码：schema 只在 MCP 入口生效，
        // 而这一行是拼进 URL 路径的实际位置（api-client 用 new URL 构造，
        // 未编码的 ../ 会被路径归一化打到别的端点）。
        const id = encodeURIComponent(args.pending_action_id as string);
        const env = await client.get(`/agent/pending/${id}`);
        return textResult(env.data);
      } catch (error) {
        return readFailure(error);
      }
    }
  }
];
