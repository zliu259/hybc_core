import { flushPromises, mount } from "@vue/test-utils";
import ElementPlus from "element-plus";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DeviceCategory } from "@/api/wh/types";

const api = vi.hoisted(() => ({
  listDeviceCategories: vi.fn(),
  createDeviceCategory: vi.fn(),
  updateDeviceCategory: vi.fn()
}));
vi.mock("@/api/wh/settings", () => api);
vi.mock("@/utils/message", () => ({ message: vi.fn() }));

// el-table 依赖 ResizeObserver；happy-dom 不一定提供
if (typeof globalThis.ResizeObserver === "undefined") {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
}

import CategoryPanel from "./CategoryPanel.vue";

const category = (patch: Partial<DeviceCategory>): DeviceCategory => ({
  id: 1,
  name: "顶管机",
  code_prefix: "DG",
  sort_order: 0,
  status: "active",
  ...patch
});

const mountPanel = async (canEdit: boolean) => {
  const wrapper = mount(CategoryPanel, {
    props: { canEdit },
    global: { plugins: [ElementPlus] }
  });
  await flushPromises();
  return wrapper;
};

describe("设备类别面板", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.listDeviceCategories.mockResolvedValue({
      success: true,
      data: [
        category({}),
        category({ id: 2, name: "水泵", code_prefix: null, sort_order: 1 })
      ]
    });
    api.updateDeviceCategory.mockResolvedValue({ success: true });
  });

  it("一打开就把已有的类别列出来", async () => {
    const wrapper = await mountPanel(false);
    expect(api.listDeviceCategories).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).toContain("顶管机");
    expect(wrapper.text()).toContain("水泵");
    expect(wrapper.text()).not.toContain("还没有设备类别");
  });

  it("不能改的人看到的编号开头：设了的显示它，没设的显示 SB", async () => {
    const wrapper = await mountPanel(false);
    const cells = wrapper
      .findAll("tbody tr")
      .map(row => row.findAll("td")[1].text());
    expect(cells).toEqual(["DG", "SB"]);
  });

  it("库管改编号开头：去掉空白、转成大写再存", async () => {
    const wrapper = await mountPanel(true);
    const input = wrapper.findAll("tbody tr")[1].findAll("td")[1].find("input");
    // setValue 会依次触发 input 和 change，和人输完按回车或点别处一样
    await input.setValue(" sb2x ");
    await flushPromises();
    expect(api.updateDeviceCategory).toHaveBeenCalledTimes(1);
    expect(api.updateDeviceCategory).toHaveBeenCalledWith(2, {
      code_prefix: "SB2X"
    });
    // 存完重新取一遍
    expect(api.listDeviceCategories).toHaveBeenCalledTimes(2);
  });
});
