import { describe, expect, it, vi } from "vitest";

import { buildConfirmCard, pushConfirmCard } from "./agent-confirm-push";
import type { TemplateCardSender } from "./agent-confirm-push";
import type { Env } from "../types/env";

const env = { AGENT_WEB_BASE_URL: "https://web.hybcdg.com" } as unknown as Env;

describe("buildConfirmCard", () => {
  it("shows the summary, risk reason and device, and links to the hash-routed confirm page", () => {
    const card = buildConfirmCard(env, {
      summary: "批准审批单 #42（张三 申请：付款 ￥120,000）",
      riskReason: "智能体请求批准审批单",
      confirmToken: "tok123",
      deviceName: "Max 的 MacBook",
      agentComment: null
    });
    const json = JSON.stringify(card);
    expect(json).toContain("批准审批单 #42");
    expect(json).toContain("智能体请求批准审批单");
    expect(json).toContain("Max 的 MacBook");
    expect(json).toContain("https://web.hybcdg.com/#/agent/confirm?token=tok123");
  });

  it("url-encodes the token", () => {
    const card = buildConfirmCard(env, {
      summary: "s",
      riskReason: "r",
      confirmToken: "a b&c",
      deviceName: null,
      agentComment: null
    });
    expect(JSON.stringify(card)).toContain("token=a%20b%26c");
  });

  it("omits the device clause when the device is unknown", () => {
    const card = buildConfirmCard(env, {
      summary: "s",
      riskReason: "r",
      confirmToken: "t",
      deviceName: null,
      agentComment: null
    });
    expect(JSON.stringify(card)).not.toContain("发起设备");
  });

  it("strips a trailing slash from the web base and falls back when it is unset", () => {
    const withSlash = buildConfirmCard(
      { AGENT_WEB_BASE_URL: "https://web.hybcdg.com/" } as unknown as Env,
      { summary: "s", riskReason: "r", confirmToken: "t", deviceName: null, agentComment: null }
    );
    expect(JSON.stringify(withSlash)).toContain("https://web.hybcdg.com/#/agent/confirm");
    expect(JSON.stringify(withSlash)).not.toContain("com//#");

    const noBase = buildConfirmCard({} as unknown as Env, {
      summary: "s",
      riskReason: "r",
      confirmToken: "t",
      deviceName: null,
      agentComment: null
    });
    expect(JSON.stringify(noBase)).toContain("/#/agent/confirm?token=t");
  });

  it("never puts the raw token anywhere except the url query", () => {
    const card = buildConfirmCard(env, {
      summary: "s",
      riskReason: "r",
      confirmToken: "SECRETTOKEN",
      deviceName: null,
      agentComment: null
    });
    // 卡片正文（标题/摘要/说明）不得出现令牌，只能出现在跳转链接里
    expect(card.main_title).not.toMatchObject({ title: expect.stringContaining("SECRETTOKEN") });
    expect(JSON.stringify(card.emphasis_content)).not.toContain("SECRETTOKEN");
    expect(JSON.stringify(card.sub_title_text)).not.toContain("SECRETTOKEN");
  });

  /**
   * 【卡片必须让员工看见他将要署名的那段话】
   *
   * routes/approval.ts 把请求体里的 comment 原样写进正式审批记录，署的是【员工本人】的名字。
   * 卡片若不展示它，员工的同意就是在为一段自己从未读过的、智能体撰写的意见背书 ——
   * 他以为自己只是同意了「批准 #42」。
   */
  describe("agent-authored comment", () => {
    const withComment = (agentComment: string | null) =>
      buildConfirmCard(env, {
        summary: "批准审批单 #42",
        riskReason: "智能体请求批准审批单",
        confirmToken: "t",
        deviceName: null,
        agentComment
      });

    it("renders the comment verbatim, labelled as agent-authored", () => {
      const card = withComment("金额已核对，同意付款");
      expect(card.sub_title_text).toContain("金额已核对，同意付款");
      // 必须明确写出这段话【是智能体填的】，否则员工会读成系统给出的事实说明。
      expect(card.sub_title_text).toContain("智能体填写的意见");
    });

    it("omits the clause entirely when the agent wrote no comment", () => {
      // 「智能体填写的意见：无」是噪声；没有就不提。
      expect(withComment(null).sub_title_text).not.toContain("智能体填写的意见");
    });

    it("keeps the card within WeCom's sub_title_text limit even for a hostile comment", () => {
      // 意见是攻击者可控的，长度不设防就会把卡片挤爆（企微直接拒收 → 员工收不到任何通知，
      // 而动作已经 park 在库里等着被确认）。
      const card = withComment("很".repeat(500));
      expect(card.sub_title_text.length).toBeLessThanOrEqual(112);
    });

    it("survives JSON serialization with control characters in the comment", () => {
      const card = withComment('恶意\n{"card_type":"伪造"}\u0000');
      expect(() => JSON.stringify(card)).not.toThrow();
      expect(card.sub_title_text).not.toContain("\n");
    });
  });
});

describe("pushConfirmCard", () => {
  it("sends to the granting employee via the injected sender", async () => {
    const sender = vi.fn<TemplateCardSender>(async () => ({
      msgid: "m1",
      invaliduser: null,
      unlicenseduser: null
    }));
    await pushConfirmCard(
      env,
      {
        wecomUserid: "MaxLiu",
        summary: "批准审批单 #42",
        riskReason: "r",
        confirmToken: "tok123",
        deviceName: null,
        agentComment: null
      },
      sender
    );
    expect(sender).toHaveBeenCalledTimes(1);
    const call = sender.mock.calls.at(0);
    if (!call) throw new Error("sender was not called");
    const [, input] = call;
    expect(input.touser).toBe("MaxLiu");
    expect(JSON.stringify(input.template_card)).toContain("tok123");
  });

  it("never throws out of the push path (a failed card must not break the park)", async () => {
    const sender = vi.fn<TemplateCardSender>(async () => {
      throw new Error("wecom down");
    });
    await expect(
      pushConfirmCard(
        env,
        {
          wecomUserid: "MaxLiu",
          summary: "s",
          riskReason: "r",
          confirmToken: "t",
          deviceName: null,
          agentComment: null
        },
        sender
      )
    ).resolves.toBeUndefined();
  });
});
