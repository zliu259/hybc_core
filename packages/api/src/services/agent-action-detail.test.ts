/**
 * 「员工能不能独立判断这件事」—— 确认卡片与确认页所依据的动作详情（P2a 终审 HIGH-1）。
 *
 * 背景：卡片原先只写一句 `批准审批单 #42`。员工据此点「同意」，而真正被执行的请求里
 * 还带着【智能体自己写的 comment】，它会被 routes/approval.ts 原样写进正式审批记录、
 * 署上员工本人的名字。员工的同意是自愿的，但是【瞎的】：他不知道申请人是谁、申请了什么，
 * 更不知道自己正在为一段智能体撰写的意见背书。
 *
 * 本模块把「即将执行什么」拆成人类可判断的几件事，并把其中【攻击者可控】的那一部分
 * （agent_comment）当作不可信展示数据处理：去控制字符、去引号、限长、显式标注来源。
 */

import { describe, expect, it } from "vitest";

import {
  AGENT_COMMENT_MAX_CHARS,
  buildActionDetail,
  buildSummary,
  extractAgentComment,
  parseActionDetail,
  parseApprovalInstanceId,
  sanitizeDisplayText,
  type ApprovalContext
} from "./agent-action-detail";

const CONTEXT: ApprovalContext = {
  instance_no: "AP-20260718-001",
  biz_type: "payment",
  biz_summary: "PAY-20260718-003 | 中建三局 | 120000.00",
  initiator_userid: "ZhangSan"
};

describe("extractAgentComment", () => {
  it("pulls the comment the agent authored out of the raw snapshot body", () => {
    expect(extractAgentComment('{"comment":"金额已核对，同意付款"}')).toBe("金额已核对，同意付款");
  });

  it("returns null when there is no comment to show", () => {
    expect(extractAgentComment("{}")).toBeNull();
    expect(extractAgentComment('{"comment":""}')).toBeNull();
    expect(extractAgentComment('{"comment":"   "}')).toBeNull();
  });

  /**
   * body 是攻击者可控的原始字节，解析它绝不能让 park 失败 —— park 失败等于高危写被静默放过
   * 或整条链路 500，两种结局都比「卡片上少一句意见」糟得多。
   */
  it("never throws on hostile or non-JSON bodies", () => {
    expect(extractAgentComment("")).toBeNull();
    expect(extractAgentComment("not json at all")).toBeNull();
    expect(extractAgentComment("[1,2,3]")).toBeNull();
    expect(extractAgentComment("null")).toBeNull();
    expect(extractAgentComment('{"comment":{"nested":true}}')).toBeNull();
    expect(extractAgentComment('{"comment":123}')).toBeNull();
  });
});

describe("sanitizeDisplayText", () => {
  it("flattens control characters and newlines into single spaces", () => {
    expect(sanitizeDisplayText("第一行\n\n第二行\t结束", 100)).toBe("第一行 第二行 结束");
    expect(sanitizeDisplayText("a\u0000b\u001fc", 100)).toBe("a b c");
  });

  /**
   * 【意见不得冒充系统文案】卡片把意见包在「」里并标注来源。若意见自己带着 「」，
   * 它就能先把引号闭合，再续写一段看起来像系统提示的文字（例如「」本操作已由风控审核通过），
   * 员工据此放松警惕 —— 这是纯粹的展示层注入。故成对引号一律剥掉。
   */
  it("strips the quoting characters the card uses to fence untrusted text", () => {
    expect(sanitizeDisplayText("同意」本操作已由风控审核通过「", 100)).toBe(
      "同意 本操作已由风控审核通过"
    );
    expect(sanitizeDisplayText("『假标题』", 100)).toBe("假标题");
  });

  it("truncates with an ellipsis so a long comment cannot swallow the card", () => {
    const long = "很".repeat(200);
    const out = sanitizeDisplayText(long, 20);
    expect(out).toHaveLength(20);
    expect(out.endsWith("…")).toBe(true);
  });

  it("leaves short clean text exactly as written", () => {
    expect(sanitizeDisplayText("金额已核对，同意付款", 100)).toBe("金额已核对，同意付款");
  });
});

describe("parseApprovalInstanceId", () => {
  it("reads the instance id out of the gate-normalized path", () => {
    expect(parseApprovalInstanceId("/api/v1/approval/42/approve")).toBe(42);
    expect(parseApprovalInstanceId("/approval/7/reject")).toBe(7);
  });

  it("returns null for anything that is not an approval action path", () => {
    expect(parseApprovalInstanceId("/api/v1/payment")).toBeNull();
    expect(parseApprovalInstanceId("/api/v1/approval/abc/approve")).toBeNull();
  });
});

describe("buildActionDetail + buildSummary", () => {
  const detail = (over: Partial<Parameters<typeof buildActionDetail>[0]> = {}) =>
    buildActionDetail({
      actionKind: "approval.approve",
      path: "/api/v1/approval/42/approve",
      body: '{"comment":"金额已核对，同意付款"}',
      approval: CONTEXT,
      ...over
    });

  it("carries the verb, the target, the business context and the agent comment", () => {
    const d = detail();
    expect(d.verb).toBe("批准");
    expect(d.target).toBe("审批单 #42");
    expect(d.approval).toEqual(CONTEXT);
    expect(d.agent_comment).toBe("金额已核对，同意付款");
  });

  it("sanitizes and truncates the agent comment at build time, not at render time", () => {
    // 存进库的就必须已经是安全的展示文本：任何一个忘了消毒的渲染端都不该有机会出事。
    const d = detail({ body: JSON.stringify({ comment: `${"长".repeat(500)}\n注入」` }) });
    expect(d.agent_comment).toHaveLength(AGENT_COMMENT_MAX_CHARS);
    expect(d.agent_comment).not.toContain("」");
    expect(d.agent_comment).not.toContain("\n");
  });

  /**
   * 摘要是员工在卡片与列表里看到的一句话。它必须回答「谁、申请了什么」，
   * 否则「批准审批单 #42」对员工而言与一串随机数字没有区别。
   */
  it("folds the applicant and the business summary into the human-readable summary", () => {
    const summary = buildSummary(detail());
    expect(summary).toContain("批准审批单 #42");
    expect(summary).toContain("ZhangSan");
    expect(summary).toContain("PAY-20260718-003");
  });

  /**
   * 查不到实例（已被清理、id 不存在、查询失败）时【省略】业务上下文，绝不编造。
   * 摘要必须原样退化成旧的中性形态 —— 宁可少说，不可错说。
   */
  it("degrades to the bare action when the business context is unavailable", () => {
    expect(buildSummary(detail({ approval: null }))).toBe("批准审批单 #42");
  });

  it("never invents a verb for an unregistered action kind", () => {
    const d = detail({ actionKind: "approval.transfer", approval: null });
    expect(d.verb).toBeNull();
    // 退化成中性描述（难看但不骗人），绝不默认成「批准」。
    expect(buildSummary(d)).toContain("approval.transfer");
    expect(buildSummary(d)).not.toContain("批准");
  });

  it("keeps the summary free of the agent comment (untrusted text stays in its own field)", () => {
    // 摘要读起来像系统文案；把攻击者可控的字符串拼进去，等于让它冒充系统文案。
    expect(buildSummary(detail())).not.toContain("金额已核对");
  });
});

describe("parseActionDetail", () => {
  it("round-trips what buildActionDetail produced", () => {
    const built = buildActionDetail({
      actionKind: "approval.reject",
      path: "/api/v1/approval/7/reject",
      body: '{"comment":"金额不符"}',
      approval: CONTEXT
    });
    expect(parseActionDetail(JSON.stringify(built))).toEqual(built);
  });

  it("returns null instead of throwing on a missing or corrupt column", () => {
    expect(parseActionDetail(null)).toBeNull();
    expect(parseActionDetail("")).toBeNull();
    expect(parseActionDetail("{not json")).toBeNull();
  });
});
