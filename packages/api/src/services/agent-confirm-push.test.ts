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
      deviceName: "Max 的 MacBook"
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
      deviceName: null
    });
    expect(JSON.stringify(card)).toContain("token=a%20b%26c");
  });

  it("omits the device clause when the device is unknown", () => {
    const card = buildConfirmCard(env, {
      summary: "s",
      riskReason: "r",
      confirmToken: "t",
      deviceName: null
    });
    expect(JSON.stringify(card)).not.toContain("发起设备");
  });

  it("strips a trailing slash from the web base and falls back when it is unset", () => {
    const withSlash = buildConfirmCard(
      { AGENT_WEB_BASE_URL: "https://web.hybcdg.com/" } as unknown as Env,
      { summary: "s", riskReason: "r", confirmToken: "t", deviceName: null }
    );
    expect(JSON.stringify(withSlash)).toContain("https://web.hybcdg.com/#/agent/confirm");
    expect(JSON.stringify(withSlash)).not.toContain("com//#");

    const noBase = buildConfirmCard({} as unknown as Env, {
      summary: "s",
      riskReason: "r",
      confirmToken: "t",
      deviceName: null
    });
    expect(JSON.stringify(noBase)).toContain("/#/agent/confirm?token=t");
  });

  it("never puts the raw token anywhere except the url query", () => {
    const card = buildConfirmCard(env, {
      summary: "s",
      riskReason: "r",
      confirmToken: "SECRETTOKEN",
      deviceName: null
    });
    // 卡片正文（标题/摘要/说明）不得出现令牌，只能出现在跳转链接里
    expect(card.main_title).not.toMatchObject({ title: expect.stringContaining("SECRETTOKEN") });
    expect(JSON.stringify(card.emphasis_content)).not.toContain("SECRETTOKEN");
    expect(JSON.stringify(card.sub_title_text)).not.toContain("SECRETTOKEN");
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
        deviceName: null
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
          deviceName: null
        },
        sender
      )
    ).resolves.toBeUndefined();
  });
});
