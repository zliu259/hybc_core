import { beforeEach, describe, expect, it, vi } from "vitest";

import { notifyMirrorPaused } from "../src/services/wedrive/notify";
import { fetchViaBridgeStrict } from "../src/services/wecom-approval-push";
import { fetchWeComTags, listUsersInTag } from "../src/services/wecom-role";

// 镜像暂停时给超管发的那条企微消息：发给谁、写了什么、发不出去也不抛。

vi.mock("../src/services/wecom-api", async (original) => ({
  ...(await original()),
  fetchWeComAccessToken: vi.fn(async () => "token-1")
}));

vi.mock("../src/services/wecom-role", async (original) => ({
  ...(await original()),
  fetchWeComTags: vi.fn(),
  listUsersInTag: vi.fn()
}));

vi.mock("../src/services/wecom-approval-push", async (original) => ({
  ...(await original()),
  fetchViaBridgeStrict: vi.fn()
}));

const env = { WECHAT_AGENT_ID: "1000002" };
const sent = () => vi.mocked(fetchViaBridgeStrict).mock.calls.map((call) => call[2].body);

describe("微盘镜像暂停通知", () => {
  beforeEach(() => {
    vi.mocked(fetchViaBridgeStrict).mockReset().mockResolvedValue({ errcode: 0 });
    vi.mocked(fetchWeComTags)
      .mockReset()
      .mockResolvedValue([
        { tagid: 3, tagname: "HY_ROLE_SUPER_ADMIN" },
        { tagid: 4, tagname: "HY_ROLE_FINANCE" }
      ]);
    vi.mocked(listUsersInTag)
      .mockReset()
      .mockImplementation(async (_env, _token, tagId) =>
        tagId === 3 ? new Set(["admin2", "admin1"]) : new Set(["finance1"])
      );
  });

  it("发给超管标签里的人，一条文本消息，写明原因和去哪处理", async () => {
    await notifyMirrorPaused(env, "本月微盘接口调用次数已经用到预算");
    expect(sent()).toEqual([
      {
        touser: "admin1|admin2",
        msgtype: "text",
        agentid: 1000002,
        text: {
          content: "微盘镜像已暂停：本月微盘接口调用次数已经用到预算。到 库房 → 设置 里处理。"
        }
      }
    ]);
    expect(vi.mocked(fetchViaBridgeStrict).mock.calls[0][1]).toContain("/cgi-bin/message/send");
  });

  it("超管标签配成了别的名字：按配置找", async () => {
    vi.mocked(fetchWeComTags).mockResolvedValue([{ tagid: 9, tagname: "老板" }]);
    vi.mocked(listUsersInTag).mockResolvedValue(new Set(["boss"]));
    await notifyMirrorPaused({ ...env, WECHAT_ROLE_TAG_MAPPING: "super_admin:老板" }, "x");
    expect(sent()[0].touser).toBe("boss");
  });

  it("没找到超管：不发，不抛", async () => {
    vi.mocked(listUsersInTag).mockResolvedValue(new Set());
    await expect(notifyMirrorPaused(env, "x")).resolves.toBeUndefined();
    expect(sent()).toEqual([]);
  });

  it("取标签出错、企微拒绝、没配应用 ID：都不抛", async () => {
    vi.mocked(fetchViaBridgeStrict).mockResolvedValue({ errcode: 40001, errmsg: "bad" });
    await expect(notifyMirrorPaused(env, "x")).resolves.toBeUndefined();
    vi.mocked(fetchWeComTags).mockRejectedValue(new Error("企微挂了"));
    await expect(notifyMirrorPaused(env, "x")).resolves.toBeUndefined();
    await expect(notifyMirrorPaused({}, "x")).resolves.toBeUndefined();
  });
});
