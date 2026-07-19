/**
 * 高危动作的「可判断详情」—— park 时把即将执行的那个请求，拆成员工能独立判断的几件事。
 *
 * ## 为什么这个模块必须存在
 *
 * 卡片是人在环控制的唯一入口，而它原先只写一句 `批准审批单 #42`。这句话隐去了两样东西：
 *
 * 1.【这单是什么】「#42」对员工而言就是一串随机数字。他无从知道申请人是谁、申请了什么、多少钱，
 *    于是「确认」退化成一次机械的点击 —— 而机械的点击正是通知疲劳攻击要收割的东西。
 *
 * 2.【他将要署名的那段话】routes/approval.ts 把请求体里的 `comment` 原样写进正式审批记录，
 *    署的是 `auth.sub` —— 也就是【员工本人】。智能体（可能已被提示注入操纵）写的意见，
 *    就这样挂在员工名下进了一条财务审批的永久留痕。员工的同意是自愿的，但是【瞎的】。
 *
 * ## comment 是不可信展示数据
 *
 * 它由调用方完全控制，故本模块在【落库前】就把它消毒定型：去控制字符、剥掉卡片用来围栏的
 * 成对引号、限长。理由是纵深 —— 消毒若留给渲染端，就意味着每一个渲染端（企微卡片、确认页、
 * 将来的审计视图）都必须记得做一次，漏一个就出事。存进库的就已经是安全的展示文本。
 *
 * 剥引号不是洁癖：卡片把意见包在「」里并标注来源，意见若自带 「」，它就能先闭合引号、
 * 再续写一段形似系统提示的文字（「」本操作已由风控审核通过），让员工放松警惕。
 *
 * ## 查不到就省略，绝不编造
 *
 * 业务上下文来自一次 approval_instance 查询。查不到（id 不存在、查询失败）时字段为 null，
 * 摘要原样退化成旧的中性形态。宁可少说，不可错说 —— 卡片上一句错的申请人比没有更危险。
 */

import type { ApprovalInstance } from "../types/approval";

/**
 * 动作类型 → 员工看得懂的动词。
 *
 * 刻意【不设兜底动词】：把未登记的 actionKind 默认成「批准」，会让卡片对员工谎报动作性质
 * ——他以为自己在同意一件 A，实际放行的是 B。新增高危规则时必须同步在此登记，
 * 漏登记的结局是文案退化成「动作类型 + 路径」的中性描述，难看，但绝不会骗人。
 */
const ACTION_VERBS: Readonly<Record<string, string>> = {
  "approval.approve": "批准",
  "approval.reject": "拒绝"
};

/** 意见落库时的长度上限。卡片另有更紧的预算（见 agent-confirm-push.ts）。 */
export const AGENT_COMMENT_MAX_CHARS = 120;

/** 匹配闸门归一化后的审批动作路径，取出实例 id。 */
const APPROVAL_ACTION_PATTERN = /\/approval\/(\d+)\/(?:approve|reject)$/;

/**
 * 控制字符（C0 + DEL + C1）：JSON 字符串里完全合法，渲染端行为却不可预期。
 *
 * no-control-regex 存在是为了抓「不小心写进正则的控制字符」。这里恰恰相反 ——
 * 匹配控制字符【就是】本正则的全部目的，故显式豁免。不改用 new RegExp 绕开检查：
 * 那样只是让 linter 看不见，而不是说明为什么可以。
 */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;

/** 卡片与确认页用来围栏不可信文本的成对引号 —— 不可信文本自己不得含有它们。 */
const FENCE_CHARS = /[「」『』]/g;

/** park 时一次查询就能拿到的业务上下文。金额不在 approval_instance 上（它在各业务表里），
 *  故【不】为了一个金额再多查一张表 —— biz_summary 按本仓库惯例已包含金额等要素。 */
export interface ApprovalContext {
  readonly instance_no: string;
  readonly biz_type: string;
  readonly biz_summary: string;
  readonly initiator_userid: string;
}

/** 落进 action_detail 列、并经 toPublicView 原样回给确认页的投影。 */
export interface PendingActionDetail {
  readonly action_kind: string;
  /** 人类可读动词；未登记的 action_kind 为 null（绝不兜底成「批准」）。 */
  readonly verb: string | null;
  /** 动作目标的人类可读描述，例如「审批单 #42」。 */
  readonly target: string;
  /** 一次 approval_instance 查询可得的业务上下文；查不到为 null。 */
  readonly approval: ApprovalContext | null;
  /** 【智能体填写的、将以员工名义入库的意见】已消毒定型的展示文本；没写为 null。 */
  readonly agent_comment: string | null;
}

/** 纯截断（不消毒）：用于对已消毒文本再做一次长度收口，不会破坏围栏引号。 */
export const truncate = (text: string, maxChars: number): string =>
  text.length <= maxChars ? text : `${text.slice(0, Math.max(0, maxChars - 1))}…`;

/**
 * 把任意不可信文本压成一行安全的展示文本：控制字符与围栏引号变空格，空白折叠，再限长。
 * 幂等 —— 可以在落库时做一次、渲染时再做一次，结果相同。
 */
export const sanitizeDisplayText = (text: string, maxChars: number): string => {
  const flattened = text
    .replace(CONTROL_CHARS, " ")
    .replace(FENCE_CHARS, " ")
    .replace(/\s+/g, " ")
    .trim();
  return truncate(flattened, maxChars);
};

/**
 * 从原始快照 body 里取出智能体填写的 comment。
 *
 * body 是攻击者可控的原始字节，解析它【绝不允许抛异常】：park 失败的结局要么是高危写被静默
 * 放过，要么是整条链路 500，两者都比「卡片上少一句意见」糟糕得多。故一切异常与非预期形状
 * 一律收敛为 null。
 */
export const extractAgentComment = (rawBody: string): string | null => {
  if (!rawBody) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const comment = (parsed as { comment?: unknown }).comment;
  if (typeof comment !== "string") {
    return null;
  }
  const trimmed = comment.trim();
  return trimmed.length > 0 ? trimmed : null;
};

/** 从闸门归一化后的路径里取审批实例 id；非审批动作路径返回 null。 */
export const parseApprovalInstanceId = (path: string): number | null => {
  const matched = APPROVAL_ACTION_PATTERN.exec(path);
  if (!matched) {
    return null;
  }
  const id = Number(matched[1]);
  return Number.isSafeInteger(id) ? id : null;
};

/**
 * 查这一单的业务上下文。【一次查询、只读四列】—— park 位于请求关键路径上，
 * 且这次查询纯粹服务于卡片文案，不值得为它多打一次数据库。
 *
 * 查询失败一律降级为 null 并记日志：卡片少一段上下文是可接受的退化，
 * 让一次高危写因为文案查询失败而 500 则不是。
 */
export const loadApprovalContext = async (
  db: D1Database,
  instanceId: number
): Promise<ApprovalContext | null> => {
  try {
    const row = await db
      .prepare(
        `SELECT instance_no, biz_type, biz_summary, initiator_userid FROM approval_instance WHERE id = ? LIMIT 1`
      )
      .bind(instanceId)
      .first<Pick<
        ApprovalInstance,
        "instance_no" | "biz_type" | "biz_summary" | "initiator_userid"
      >>();
    if (!row) {
      return null;
    }
    return {
      instance_no: row.instance_no,
      biz_type: row.biz_type,
      biz_summary: row.biz_summary,
      initiator_userid: row.initiator_userid
    };
  } catch (error) {
    console.error("agent park: approval context lookup failed", { instanceId, error });
    return null;
  }
};

export interface BuildActionDetailInput {
  readonly actionKind: string;
  /** 闸门归一化后的路径（c.req.path）—— 与摘要、签名所用的必须是同一个字符串。 */
  readonly path: string;
  /** 原始请求体字节。 */
  readonly body: string;
  readonly approval: ApprovalContext | null;
}

export const buildActionDetail = (input: BuildActionDetailInput): PendingActionDetail => {
  const instanceId = parseApprovalInstanceId(input.path);
  const rawComment = extractAgentComment(input.body);
  return {
    action_kind: input.actionKind,
    verb: ACTION_VERBS[input.actionKind] ?? null,
    target: instanceId === null ? input.path : `审批单 #${instanceId}`,
    approval: input.approval,
    // 落库前就定型成安全的展示文本 —— 任何忘了消毒的渲染端都不该有机会出事。
    agent_comment: rawComment === null ? null : sanitizeDisplayText(rawComment, AGENT_COMMENT_MAX_CHARS)
  };
};

/**
 * 生成企微卡片与 pending 列表里展示的一句话摘要。
 *
 * 【摘要里不含 agent_comment】摘要读起来像系统文案；把攻击者可控的字符串拼进去，
 * 等于把冒充系统文案的能力送给他。意见有自己的字段，并在卡片上被显式标注来源。
 */
export const buildSummary = (detail: PendingActionDetail): string => {
  const action = detail.verb ? `${detail.verb}${detail.target}` : `${detail.action_kind}（${detail.target}）`;
  if (!detail.approval) {
    return action;
  }
  return `${action}（${detail.approval.initiator_userid} 提交：${detail.approval.biz_summary}）`;
};

/** 读侧：NULL / 空串 / 损坏 JSON 一律降级为 null，绝不让一条坏行炸掉整个查询。 */
export const parseActionDetail = (raw: string | null): PendingActionDetail | null => {
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as PendingActionDetail;
  } catch (error) {
    console.error("agent pending action_detail parse failed", error);
    return null;
  }
};
