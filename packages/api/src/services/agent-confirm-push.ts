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

import type { Env } from "../types/env";
import { sendWeComTemplateCard } from "./wecom-approval-push";

/** 确认令牌有效期（分钟），与 park 记录的过期时间保持一致，仅用于卡片文案。 */
const CONFIRM_TTL_MINUTES = 10;

export interface ConfirmCardInput {
  /** 高危动作的人类可读摘要，例如「批准审批单 #42（张三 申请：付款 ￥120,000）」。 */
  readonly summary: string;
  /** 判定为高危的原因，用于让员工理解这条确认从何而来。 */
  readonly riskReason: string;
  /** 一次性确认令牌，只允许出现在跳转链接的 query 中。 */
  readonly confirmToken: string;
  /** 发起设备名（授权时登记）；未知时省略整句，不要输出「未知设备」误导员工。 */
  readonly deviceName: string | null;
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

export const buildConfirmCard = (env: Env, input: ConfirmCardInput): ConfirmTemplateCard => {
  const url = resolveConfirmUrl(env, input.confirmToken);
  const device = input.deviceName?.trim();
  const devicePart = device ? `发起设备：${device}。` : "";

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
    sub_title_text: `${devicePart}本次确认 ${CONFIRM_TTL_MINUTES} 分钟内有效，请核对内容无误后再确认；如非本人操作请忽略。`,
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
