import { flushPromises, mount } from "@vue/test-utils";
import ElementPlus from "element-plus";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/api/wh/material", () => ({
  listMaterials: vi.fn().mockResolvedValue({ success: true, data: [] })
}));

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

import { newEditableLine, type EditableKitLine } from "../kit-view";
import KitLineTable from "./KitLineTable.vue";

const line = (patch: Partial<EditableKitLine>): EditableKitLine => ({
  ...newEditableLine("辅助设备"),
  name_text: "排泥钢管",
  ...patch
});

const mountTable = async (
  lines: EditableKitLine[],
  mode: "kit" | "template" = "kit",
  readonly = false
) => {
  const wrapper = mount(KitLineTable, {
    props: { modelValue: lines, mode, categories: [], readonly },
    global: { plugins: [ElementPlus] }
  });
  await flushPromises();
  return wrapper;
};

describe("清单表格里的算式和「已改」", () => {
  const rows = [
    line({
      qty: 270,
      calc_text: "按最长一段：2 × 105 + 60 = 270",
      generated_qty: 270
    }),
    line({
      name_text: "橡套电缆",
      qty: 150,
      calc_text: "按最长一段：1 × 105 = 105",
      generated_qty: 105
    }),
    line({ name_text: "电焊机", qty: 1, calc_text: null, generated_qty: 1 }),
    line({ name_text: "新加的", qty: 5 })
  ];

  it("有算式的行在数量下面显示算式；数量和生成时不同的行标「已改」", async () => {
    const wrapper = await mountTable(rows);
    const body = wrapper.findAll(".el-table__body tbody tr");
    expect(body).toHaveLength(4);
    expect(body[0].find(".calc-text").text()).toBe(
      "按最长一段：2 × 105 + 60 = 270"
    );
    expect(body[0].find(".changed").exists()).toBe(false);
    expect(body[1].find(".calc-text").text()).toBe("按最长一段：1 × 105 = 105");
    expect(body[1].find(".changed").text()).toBe("已改，生成时是 105");
    // 固定的行没有算式，没改过就什么都不多显示
    expect(body[2].find(".calc-text").exists()).toBe(false);
    expect(body[2].find(".changed").exists()).toBe(false);
    // 库管新加的行
    expect(body[3].find(".calc-text").exists()).toBe(false);
    expect(body[3].find(".changed").exists()).toBe(false);
  });

  it("只读时也显示", async () => {
    const wrapper = await mountTable(rows, "kit", true);
    const body = wrapper.findAll(".el-table__body tbody tr");
    expect(body[1].find(".calc-text").exists()).toBe(true);
    expect(body[1].find(".changed").exists()).toBe(true);
  });

  it("固定的行改了数量也标「已改」", async () => {
    const wrapper = await mountTable([
      line({ name_text: "电焊机", qty: 3, calc_text: null, generated_qty: 1 })
    ]);
    expect(wrapper.find(".changed").text()).toBe("已改，生成时是 1");
  });

  it("模板表格里没有这些，有「计算规则」一列", async () => {
    const wrapper = await mountTable(rows, "template");
    expect(wrapper.find(".calc-text").exists()).toBe(false);
    expect(wrapper.find(".changed").exists()).toBe(false);
    expect(wrapper.text()).toContain("计算规则");
  });
});
