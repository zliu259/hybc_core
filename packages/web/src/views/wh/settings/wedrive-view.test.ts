import { describe, expect, it } from "vitest";

import type { WedriveStatus } from "@/api/wh/wedrive";
import {
  mirrorActions,
  mirrorAudienceText,
  mirrorCallsText,
  mirrorCountItems,
  mirrorHeadline,
  mirrorTag
} from "./wedrive-view";

const status = (patch: Partial<WedriveStatus> = {}): WedriveStatus => ({
  initialized: true,
  enabled: true,
  space_open: false,
  space_open_confirmed: false,
  paused_reason: null,
  counts: { pending: 0, syncing: 0, synced: 12, failed: 0, skipped: 0 },
  failed_removals: 0,
  calls_this_month: 40,
  monthly_budget: 900,
  mirror_max_mb: 100,
  ...patch
});
const counts = (patch: Partial<WedriveStatus["counts"]>) => ({
  pending: 0,
  syncing: 0,
  synced: 0,
  failed: 0,
  skipped: 0,
  ...patch
});

describe("mirrorHeadline", () => {
  it("没初始化", () => {
    expect(
      mirrorHeadline(status({ initialized: false, enabled: false }))
    ).toEqual({
      text: "还没有建微盘空间",
      type: "info"
    });
  });
  it("暂停：红色，带原因；同时关着也先说暂停", () => {
    const paused = { paused_reason: "本月微盘接口调用次数已经用到预算" };
    expect(mirrorHeadline(status(paused))).toEqual({
      text: "已暂停：本月微盘接口调用次数已经用到预算",
      type: "danger"
    });
    expect(mirrorHeadline(status({ ...paused, enabled: false })).type).toBe(
      "danger"
    );
  });
  it("关着", () => {
    expect(mirrorHeadline(status({ enabled: false }))).toEqual({
      text: "镜像已关闭",
      type: "info"
    });
  });
  it("有失败的：橙色，哪怕还有在等的", () => {
    expect(
      mirrorHeadline(status({ counts: counts({ failed: 2, pending: 5 }) }))
    ).toEqual({ text: "2 份没传上去", type: "warning" });
  });
  it("已删除的资料在微盘里没删掉：橙色，单独说", () => {
    expect(mirrorHeadline(status({ failed_removals: 2 }))).toEqual({
      text: "2 份该删的还留在微盘里",
      type: "warning"
    });
    expect(
      mirrorHeadline(
        status({ counts: counts({ failed: 1 }), failed_removals: 2 })
      ).text
    ).toBe("1 份没传上去，2 份该删的还留在微盘里");
  });
  it("有待传的：等待和正在传的加在一起", () => {
    expect(
      mirrorHeadline(status({ counts: counts({ pending: 3, syncing: 1 }) }))
    ).toEqual({ text: "正在镜像，还有 4 份", type: "info" });
  });
  it("都好了：绿色；有不镜像的大文件也算好了", () => {
    expect(
      mirrorHeadline(status({ counts: counts({ synced: 9, skipped: 1 }) }))
    ).toEqual({ text: "微盘和系统一致", type: "success" });
  });
});

describe("mirrorActions", () => {
  const nothing = {
    setup: false,
    toggle: null,
    resume: false,
    open: false,
    retryFailed: false
  };

  it("没初始化：只有「初始化微盘空间」", () => {
    expect(mirrorActions(status({ initialized: false }), true)).toEqual({
      ...nothing,
      setup: true
    });
  });
  it("开着、没开放：能关、能开放", () => {
    expect(mirrorActions(status(), true)).toEqual({
      ...nothing,
      toggle: "off",
      open: true
    });
  });
  it("关着：能开", () => {
    expect(mirrorActions(status({ enabled: false }), true).toggle).toBe("on");
  });
  it("暂停：多一个「恢复镜像」", () => {
    expect(mirrorActions(status({ paused_reason: "x" }), true).resume).toBe(
      true
    );
  });
  it("已经开放：没有「对全公司开放」", () => {
    expect(
      mirrorActions(
        status({ space_open: true, space_open_confirmed: true }),
        true
      ).open
    ).toBe(false);
  });
  it("有失败的：多一个「全部重试」", () => {
    expect(
      mirrorActions(status({ counts: counts({ failed: 1 }) }), true).retryFailed
    ).toBe(true);
  });
  it("只有该删没删掉的：也给「全部重试」", () => {
    expect(
      mirrorActions(status({ failed_removals: 1 }), true).retryFailed
    ).toBe(true);
  });
  it("开放过但没收到企业微信的答复：还能再点一次「对全公司开放」", () => {
    expect(
      mirrorActions(
        status({ space_open: true, space_open_confirmed: false }),
        true
      ).open
    ).toBe(true);
    expect(
      mirrorActions(
        status({ space_open: true, space_open_confirmed: true }),
        true
      ).open
    ).toBe(false);
  });
  it("不是经理或超管：什么按钮都没有", () => {
    expect(mirrorActions(status({ initialized: false }), false)).toEqual(
      nothing
    );
    expect(
      mirrorActions(
        status({ paused_reason: "x", counts: counts({ failed: 3 }) }),
        false
      )
    ).toEqual(nothing);
  });
});

describe("mirrorTag", () => {
  const row = (
    mirror_status: "pending" | "syncing" | "synced" | "failed" | "skipped",
    mirror_error: string | null = null,
    is_latest = true
  ) => ({ mirror_status, mirror_error, is_latest });

  it("已同步", () => {
    expect(mirrorTag(row("synced"))).toEqual({
      text: "已同步",
      type: "success",
      tip: ""
    });
  });
  it("等待和正在传的都叫「等待同步」", () => {
    for (const state of ["pending", "syncing"] as const) {
      expect(mirrorTag(row(state))).toEqual({
        text: "等待同步",
        type: "info",
        tip: ""
      });
    }
  });
  it("没传上去：提示里是原因", () => {
    expect(mirrorTag(row("failed", "文件不在存储里"))).toEqual({
      text: "没传上去",
      type: "danger",
      tip: "文件不在存储里"
    });
    expect(mirrorTag(row("failed"))?.tip).toBe("");
  });
  it("不镜像：提示里是原因", () => {
    expect(mirrorTag(row("skipped", "超过镜像大小上限"))).toEqual({
      text: "不镜像",
      type: "warning",
      tip: "超过镜像大小上限"
    });
  });
  it("旧版本不在微盘里：不显示", () => {
    expect(mirrorTag(row("synced", null, false))).toBeNull();
  });
});

describe("卡片上的数字", () => {
  it("各状态的份数：等待和正在传的合成一项", () => {
    expect(
      mirrorCountItems(
        status({
          counts: { pending: 3, syncing: 1, synced: 20, failed: 2, skipped: 1 }
        })
      )
    ).toEqual([
      { label: "已同步", value: 20 },
      { label: "等待同步", value: 4 },
      { label: "没传上去", value: 2 },
      { label: "不镜像", value: 1 }
    ]);
  });
  it("该删没删掉的：有才多出一项", () => {
    expect(mirrorCountItems(status({ failed_removals: 3 })).at(-1)).toEqual({
      label: "该删没删掉",
      value: 3
    });
    expect(mirrorCountItems(status())).toHaveLength(4);
  });
  it("谁能看到：没开放、已开放、不确定三种说法", () => {
    expect(mirrorAudienceText(status())).toBe("还没有开放，微盘里谁也看不到");
    expect(
      mirrorAudienceText(
        status({ space_open: true, space_open_confirmed: true })
      )
    ).toBe("全公司，只能下载");
    expect(
      mirrorAudienceText(
        status({ space_open: true, space_open_confirmed: false })
      )
    ).toBe("不确定：上次开放没收到企业微信的答复，请到微盘里看一下成员");
  });
  it("本月调用次数", () => {
    expect(mirrorCallsText(status())).toBe(
      "已用 40 / 预算 900（企业每月上限 1000 次）"
    );
  });
});
