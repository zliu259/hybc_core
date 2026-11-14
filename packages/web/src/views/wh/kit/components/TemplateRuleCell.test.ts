import { mount, type VueWrapper } from "@vue/test-utils";
import ElementPlus from "element-plus";
import { describe, expect, it } from "vitest";

import type { KitLineKind, KitLineRule } from "@/api/wh/kit-types";
import { emptyRule } from "../kit-plan-view";
import TemplateRuleCell from "./TemplateRuleCell.vue";

// 模板行上的计算规则：平时一句话，点「改」在格子里展开七样设置。

interface Mounted {
  wrapper: VueWrapper;
  /** 组件最后发出来的规则 */
  current: () => KitLineRule;
}

const mountCell = (
  rule: KitLineRule,
  options: { lineKind?: KitLineKind; readonly?: boolean } = {}
): Mounted => {
  const state = { value: rule };
  const wrapper: VueWrapper = mount(TemplateRuleCell, {
    props: {
      modelValue: rule,
      lineKind: options.lineKind ?? "material",
      readonly: options.readonly ?? false,
      "onUpdate:modelValue": (value: KitLineRule) => {
        state.value = value;
        void wrapper.setProps({ modelValue: value });
      }
    },
    global: { plugins: [ElementPlus] }
  });
  return { wrapper, current: () => state.value };
};

const setField = async (wrapper: VueWrapper, field: string, value: unknown) => {
  const control = wrapper.findComponent(
    `[data-field="${field}"]`
  ) as unknown as VueWrapper;
  expect(control.exists()).toBe(true);
  control.vm.$emit("update:modelValue", value);
  await wrapper.vm.$nextTick();
};

describe("模板行的计算规则", () => {
  it("平时显示规则的文字；没配时显示「固定」", () => {
    expect(mountCell(emptyRule()).wrapper.find(".rule-text").text()).toBe(
      "固定"
    );
    expect(
      mountCell({
        ...emptyRule(),
        qty_basis: "per_longest_metre",
        qty_factor: 2,
        qty_extra: 60,
        qty_per_set: true
      })
        .wrapper.find(".rule-text")
        .text()
    ).toBe("按最长一段 ×2 +60 · 每套一份");
  });

  it("点「改」展开；选按最长一段、系数 2、另加 60、勾每套一份；不改传进来的对象", async () => {
    const original = Object.freeze(emptyRule());
    const { wrapper, current } = mountCell(original);
    expect(wrapper.find(".rule-editor").exists()).toBe(false);
    await wrapper.find(".rule-edit").trigger("click");
    expect(wrapper.find(".rule-editor").exists()).toBe(true);
    // 固定时没有系数和另加
    expect(wrapper.find('[data-field="qty_factor"]').exists()).toBe(false);

    await setField(wrapper, "qty_basis", "per_longest_metre");
    await setField(wrapper, "qty_factor", 2);
    await setField(wrapper, "qty_extra", 60);
    await setField(wrapper, "qty_per_set", true);
    expect(current()).toEqual({
      qty_basis: "per_longest_metre",
      qty_factor: 2,
      qty_extra: 60,
      qty_round_to: null,
      qty_per_set: true,
      spec_by_diameter: false,
      role: null
    });
    expect(original).toEqual(emptyRule());
    expect(wrapper.find(".rule-text").text()).toBe(
      "按最长一段 ×2 +60 · 每套一份"
    );
  });

  it("取整到：固定时没有这一格；填 50 发出 50，清空是 null；一句话里带上", async () => {
    const { wrapper, current } = mountCell(emptyRule());
    await wrapper.find(".rule-edit").trigger("click");
    expect(wrapper.find('[data-field="qty_round_to"]').exists()).toBe(false);
    await setField(wrapper, "qty_basis", "per_longest_metre");
    await setField(wrapper, "qty_factor", 1);
    await setField(wrapper, "qty_round_to", 50);
    expect(current().qty_round_to).toBe(50);
    expect(wrapper.find(".rule-text").text()).toBe(
      "按最长一段 ×1，取到 50 的倍数"
    );
    await setField(wrapper, "qty_round_to", undefined);
    expect(current().qty_round_to).toBeNull();
  });

  it("计算方式改回固定时，系数、另加和取整到清空", async () => {
    const { wrapper, current } = mountCell({
      ...emptyRule(),
      qty_basis: "per_section",
      qty_factor: 3,
      qty_extra: 1,
      qty_round_to: 50,
      role: "lodging"
    });
    await wrapper.find(".rule-edit").trigger("click");
    await setField(wrapper, "qty_basis", "fixed");
    expect(current()).toEqual({ ...emptyRule(), role: "lodging" });
  });

  it("规格随管径只有物资行能勾；标记可以选也可以清掉", async () => {
    const { wrapper: material, current: materialRule } = mountCell(emptyRule());
    await material.find(".rule-edit").trigger("click");
    await setField(material, "spec_by_diameter", true);
    await setField(material, "role", "lodging");
    expect(materialRule()).toMatchObject({
      spec_by_diameter: true,
      role: "lodging"
    });
    await setField(material, "role", "");
    expect(materialRule().role).toBeNull();

    const { wrapper: device, current: deviceRule } = mountCell(emptyRule(), {
      lineKind: "device"
    });
    await device.find(".rule-edit").trigger("click");
    expect(device.find('[data-field="spec_by_diameter"]').exists()).toBe(false);
    await setField(device, "role", "main_machine");
    expect(deviceRule().role).toBe("main_machine");
  });

  it("系数和另加清空时是 null，不是 0", async () => {
    const { wrapper, current } = mountCell({
      ...emptyRule(),
      qty_basis: "per_section",
      qty_factor: 2
    });
    await wrapper.find(".rule-edit").trigger("click");
    await setField(wrapper, "qty_factor", undefined);
    expect(current().qty_factor).toBeNull();
  });

  it("只读时只有文字，没有「改」", () => {
    const { wrapper } = mountCell(
      { ...emptyRule(), qty_per_set: true },
      { readonly: true }
    );
    expect(wrapper.find(".rule-text").text()).toBe("每套一份");
    expect(wrapper.find(".rule-edit").exists()).toBe(false);
  });

  it("备忘行什么都不渲染", () => {
    const { wrapper } = mountCell(emptyRule(), { lineKind: "text" });
    expect(wrapper.find(".rule-text").exists()).toBe(false);
    expect(wrapper.find(".rule-edit").exists()).toBe(false);
  });
});
