import { describe, expect, it } from "vitest";

import {
  buildNoticeCard,
  clip,
  NOTICE_PAGES,
  recipientsExcept
} from "../src/services/warehouse/notice-cards";

// 库房通知卡片的纯函数：跳转、截断、收件人。

const input = {
  title: "配套清单待确认",
  desc: "一号工程",
  lines: [{ keyname: "清单", value: "PT-20261112-001 主清单" }],
  pagePath: NOTICE_PAGES.kit(12),
  webPath: "/wh/kit/12"
};

describe("库房通知卡片", () => {
  it("有小程序时点卡片进小程序，Web 也列在跳转里", () => {
    const card = buildNoticeCard(input, {
      miniAppId: "wx1",
      webBaseUrl: "https://web.hybcdg.com"
    });
    expect(card).toMatchObject({
      card_type: "text_notice",
      source: { desc: "库房" },
      main_title: { title: "配套清单待确认", desc: "一号工程" },
      horizontal_content_list: [{ keyname: "清单", value: "PT-20261112-001 主清单" }],
      card_action: { type: 2, appid: "wx1", pagepath: "packageWarehouse/kit/index?id=12" }
    });
    expect(card?.jump_list).toEqual([
      { type: 2, title: "打开小程序", appid: "wx1", pagepath: "packageWarehouse/kit/index?id=12" },
      { type: 1, title: "打开Web", url: "https://web.hybcdg.com/#/wh/kit/12" }
    ]);
  });

  it("没配小程序时进 Web 的 hash 路径", () => {
    const card = buildNoticeCard(input, {
      miniAppId: null,
      webBaseUrl: "https://web.hybcdg.com"
    });
    expect(card?.card_action).toEqual({ type: 1, url: "https://web.hybcdg.com/#/wh/kit/12" });
    expect(card?.jump_list).toHaveLength(1);
  });

  it("两种都没配返回 null", () => {
    expect(buildNoticeCard(input, { miniAppId: null, webBaseUrl: null })).toBeNull();
  });

  it("超长的字段被截断", () => {
    const card = buildNoticeCard(
      {
        ...input,
        title: "长".repeat(40),
        desc: "述".repeat(40),
        lines: [{ keyname: "要求要求要求", value: "很".repeat(60) }]
      },
      { miniAppId: "wx1", webBaseUrl: null }
    );
    const main = card?.main_title as { title: string; desc: string };
    const line = (card?.horizontal_content_list as { keyname: string; value: string }[])[0];
    expect(main.title).toHaveLength(26);
    expect(main.title.endsWith("…")).toBe(true);
    expect(main.desc).toHaveLength(30);
    expect(line.keyname).toHaveLength(5);
    expect(line.value).toHaveLength(26);
  });

  it("明细最多 6 行，空值的行不列", () => {
    const lines = [
      { keyname: "一", value: "1" },
      { keyname: "空", value: "  " },
      ...["二", "三", "四", "五", "六", "七"].map((keyname) => ({ keyname, value: "x" }))
    ];
    const card = buildNoticeCard({ ...input, lines }, { miniAppId: "wx1", webBaseUrl: null });
    const list = card?.horizontal_content_list as { keyname: string }[];
    expect(list.map((line) => line.keyname)).toEqual(["一", "二", "三", "四", "五", "六"]);
  });

  it("clip 不动短文本，长的截到指定长度并以省略号结尾", () => {
    expect(clip("短", 5)).toBe("短");
    expect(clip("  两边空白  ", 10)).toBe("两边空白");
    expect(clip("一二三四五六", 5)).toBe("一二三四…");
  });

  it("收件人去空、去重、去掉操作人", () => {
    expect(recipientsExcept(["lz", null, "wang", "lz", "", "zhang"], "zhang")).toEqual([
      "lz",
      "wang"
    ]);
  });

  it("页面路径是定死的", () => {
    expect(NOTICE_PAGES.kit(12)).toBe("packageWarehouse/kit/index?id=12");
    expect(NOTICE_PAGES.task(7)).toBe("packageWarehouse/task-detail/index?id=7");
    expect(NOTICE_PAGES.myTasks).toBe("packageWarehouse/task-list/index?tab=mine");
    expect(NOTICE_PAGES.project(3)).toBe("packageWarehouse/project/index?projectId=3");
  });
});
