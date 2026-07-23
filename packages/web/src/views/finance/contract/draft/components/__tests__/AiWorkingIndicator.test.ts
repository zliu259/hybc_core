import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import AiWorkingIndicator from "../AiWorkingIndicator.vue";

describe("AiWorkingIndicator", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("按 mode 显示首条提示语并每 4 秒轮播（循环回首条）", async () => {
    const wrapper = mount(AiWorkingIndicator, { props: { mode: "generate" } });
    expect(wrapper.text()).toContain("AI 正在起草本节条款");
    vi.advanceTimersByTime(4000);
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain("正在核对民法典合规红线");
    vi.advanceTimersByTime(12000);
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain("AI 正在起草本节条款");
    wrapper.unmount();
  });

  it("completeness 模式使用全量审提示语", () => {
    const wrapper = mount(AiWorkingIndicator, {
      props: { mode: "completeness" }
    });
    expect(wrapper.text()).toContain("两个模型正在同时全量审查整份合同");
    wrapper.unmount();
  });

  it("耗时按 startedAt 起算并每秒推进（分秒格式）", async () => {
    const wrapper = mount(AiWorkingIndicator, {
      props: { mode: "review", startedAt: Date.now() - 83_000 }
    });
    expect(wrapper.text()).toContain("已运行 1分23秒");
    vi.advanceTimersByTime(1000);
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain("已运行 1分24秒");
    wrapper.unmount();
  });

  it("不足 1 分钟只显示秒", async () => {
    const wrapper = mount(AiWorkingIndicator, { props: { mode: "generate" } });
    expect(wrapper.text()).toContain("已运行 0秒");
    vi.advanceTimersByTime(3000);
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain("已运行 3秒");
    wrapper.unmount();
  });

  it("startedAt 非法时回退挂载时刻计时（不出现 NaN）", () => {
    const wrapper = mount(AiWorkingIndicator, {
      props: { mode: "completeness", startedAt: Number.NaN }
    });
    expect(wrapper.text()).toContain("已运行 0秒");
    expect(wrapper.text()).not.toContain("NaN");
    wrapper.unmount();
  });

  it("卸载时清理全部定时器", () => {
    const wrapper = mount(AiWorkingIndicator, { props: { mode: "generate" } });
    expect(vi.getTimerCount()).toBe(2);
    wrapper.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
