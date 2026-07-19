/**
 * 智能体高危动作的「企业微信本人确认」卡片（P2a）。
 *
 * 背景：mcp_agent 令牌只读（见 middleware/agent-readonly.ts）。P2 放开的高危写（审批 approve/reject）
 * 不直接执行，而是先 park 到 D1，再把本卡片推给授权员工本人；员工在企微内打开确认页、完成人机确认后，
 * 服务端才按原请求重放执行。卡片是「人在环」的唯一入口，因此内容必须让员工能独立判断：
 * 做什么（summary）、为什么判定为高危（riskReason）、哪台设备发起的（deviceName）。
 *
 * 【确认页链接必须是 hash 路由】web SPA 全环境 VITE_ROUTER_HISTORY="hash"，且 Cloudflare Pages
 * 没有 SPA catch-all，path 形式的 /agent/confirm 会直接 404。此坑本项目已踩过一次并在终审中被抓出，
 * 故链接固定为 `${webBase}/#/agent/confirm?token=...`，改动前请先确认路由模式。
 *
 * 【令牌只出现在链接 query 里】卡片正文（标题/摘要/说明）一律不得回显 confirmToken，
 * 避免令牌被截图、转发或出现在企微消息检索结果中。
 *
 * 【推送失败绝不能失败 park】动作此时已落库，员工仍可从确认页自行处理；
 * 因此 pushConfirmCard 吞掉所有发送异常，只记录日志。
 */

import { sanitizeDisplayText, truncate } from "./agent-action-detail";
import type { Env } from "../types/env";
import { sendWeComTemplateCard } from "./wecom-approval-push";

/** 确认令牌有效期（分钟），与 park 记录的过期时间保持一致，仅用于卡片文案。 */
const CONFIRM_TTL_MINUTES = 10;

/**
 * 企微 text_notice 的 sub_title_text 上限。超限企微【直接拒收整条消息】——
 * 结局是员工收不到任何通知，而动作已经 park 在库里等着被确认。
 * 意见是调用方可控的文本，故长度必须由我们守，不能指望它自觉。
 */
const SUB_TITLE_MAX_CHARS = 112;

/** 卡片上留给「智能体填写的意见」的字数预算（落库时另有更宽的上限）。 */
const CARD_COMMENT_MAX_CHARS = 30;

/** 卡片上留给设备名的字数预算。 */
const CARD_DEVICE_MAX_CHARS = 16;

/** 意见前的固定标签。必须出现，员工才知道这段话【不是】系统说的。 */
const AGENT_COMMENT_LABEL = "智能体填写的意见";

export interface ConfirmCardInput {
  /** 高危动作的人类可读摘要，例如「批准审批单 #42（张三 提交：付款 ￥120,000）」。 */
  readonly summary: string;
  /** 判定为高危的原因，用于让员工理解这条确认从何而来。 */
  readonly riskReason: string;
  /** 一次性确认令牌，只允许出现在跳转链接的 query 中。 */
  readonly confirmToken: string;
  /** 发起设备名（授权时登记）；未知时省略整句，不要输出「未知设备」误导员工。 */
  readonly deviceName: string | null;
  /**
   * 【智能体填写的意见】—— 它会被 routes/approval.ts 原样写进正式审批记录并署上员工本人的名字。
   * 卡片不展示它，员工就是在为一段自己从未读过的话背书。没写时为 null（整句省略，不输出「无」）。
   *
   * 必填而非可选：漏传的后果正是本字段要消灭的那个缺陷，类型系统应当逼调用方正视它。
   */
  readonly agentComment: string | null;
}

export interface PushConfirmInput extends ConfirmCardInput {
  /** 授权该智能体令牌的员工 userid（企微 userid 即身份主键）。 */
  readonly wecomUserid: string;
}

/** 企微文本通知卡片（text_notice）结构，仅覆盖本场景用到的字段。 */
export interface ConfirmTemplateCard {
  readonly card_type: "text_notice";
  readonly source: { readonly desc: string; readonly desc_color: number };
  readonly main_title: { readonly title: string; readonly desc: string };
  readonly emphasis_content: { readonly title: string; readonly desc: string };
  readonly sub_title_text: string;
  readonly jump_list: ReadonlyArray<{
    readonly type: 1;
    readonly title: string;
    readonly url: string;
  }>;
  readonly card_action: { readonly type: 1; readonly url: string };
}

/** 与 sendWeComTemplateCard 同形，便于测试注入假发送器，避免真的走出网桥。 */
export type TemplateCardSender = (
  env: Env,
  input: {
    touser: string;
    template_card: Record<string, unknown>;
    enable_duplicate_check?: 0 | 1;
    fallback_error_message?: string;
  }
) => Promise<{
  msgid: string | null;
  invaliduser: string | null;
  unlicenseduser: string | null;
}>;

/** 拼确认页链接：剥掉 base 末尾斜杠，未配置 base 时退化为站内相对路径。 */
const resolveConfirmUrl = (env: Env, confirmToken: string): string => {
  const base = (env.AGENT_WEB_BASE_URL ?? "").trim().replace(/\/+$/, "");
  return `${base}/#/agent/confirm?token=${encodeURIComponent(confirmToken)}`;
};

/**
 * 拼 sub_title_text：意见 → 设备 → 固定提示。
 *
 * 意见排在最前，因为它是这张卡片上员工最需要读、也最可能被忽略的一句 ——
 * 排在「本次确认 10 分钟内有效…」这类样板话之后，它就会被当成样板话跳过。
 *
 * 消毒在此【再做一次】（park 落库时已做过）：本函数也可能被其它调用方直接使用，
 * 而 sanitizeDisplayText 是幂等的，重复调用零代价。最后整串再收口一次长度，
 * 防止各段预算之和因将来的文案改动而悄悄越线。
 */
const buildSubTitle = (input: ConfirmCardInput): string => {
  const comment = input.agentComment?.trim();
  const commentPart = comment
    ? `${AGENT_COMMENT_LABEL}：「${sanitizeDisplayText(comment, CARD_COMMENT_MAX_CHARS)}」。`
    : "";
  const device = input.deviceName?.trim();
  const devicePart = device ? `发起设备：${sanitizeDisplayText(device, CARD_DEVICE_MAX_CHARS)}。` : "";
  const notice = `本次确认 ${CONFIRM_TTL_MINUTES} 分钟内有效，请核对内容无误后再确认；如非本人操作请忽略。`;
  return truncate(`${commentPart}${devicePart}${notice}`, SUB_TITLE_MAX_CHARS);
};

export const buildConfirmCard = (env: Env, input: ConfirmCardInput): ConfirmTemplateCard => {
  const url = resolveConfirmUrl(env, input.confirmToken);

  return {
    card_type: "text_notice",
    source: {
      desc: "智能体操作确认",
      desc_color: 0
    },
    main_title: {
      title: "智能体操作确认",
      desc: input.riskReason
    },
    emphasis_content: {
      title: input.summary,
      desc: "待你确认"
    },
    sub_title_text: buildSubTitle(input),
    jump_list: [
      {
        type: 1,
        title: "去确认",
        url
      }
    ],
    card_action: {
      type: 1,
      url
    }
  };
};

/**
 * 把确认卡片推给授权员工本人。
 * 任何发送异常都只记录不抛出——动作已 park 落库，卡片失败不应让 park 事务失败。
 */
export const pushConfirmCard = async (
  env: Env,
  input: PushConfirmInput,
  sender: TemplateCardSender = sendWeComTemplateCard
): Promise<void> => {
  try {
    await sender(env, {
      touser: input.wecomUserid,
      template_card: buildConfirmCard(env, input) as unknown as Record<string, unknown>,
      // 每条确认都是独立的一次性令牌，去重会吞掉后续确认请求，必须关闭
      enable_duplicate_check: 0,
      fallback_error_message: "Failed to send agent confirm template card"
    });
  } catch (error) {
    console.error("Failed to push agent confirm card", error);
  }
};
