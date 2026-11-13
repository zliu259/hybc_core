import { mount } from "@vue/test-utils";
import ElementPlus from "element-plus";
import { describe, expect, it } from "vitest";

import type { KitPlanView } from "@/api/wh/kit-types";
import KitPlanSummary from "./KitPlanSummary.vue";

const plan = (patch: Partial<KitPlanView["params"]> = {}): KitPlanView => ({
  v: 1,
  params: {
    machine_type: "泥水平衡",
    pipe_diameter_mm: 1600,
    total_length_m: 105,
    longest_drive_m: 105,
    section_count: 1,
    set_count: 1,
    soil: "粉质粘土",
    client_supplies: ["power", "lodging"],
    ...patch
  },
  sources: {},
  template: { id: 1, version: 3, name: "泥水平衡 DN1200", diameter_mm: 1200 }
});

const partsOf = (value: KitPlanView): string[] => {
  const wrapper = mount(KitPlanSummary, {
    props: { plan: value },
    global: { plugins: [ElementPlus] }
  });
  return [".el-tag", ".params", ".template"].map(selector =>
    wrapper.find(selector).text()
  );
};

describe("清单详情顶部的生成参数", () => {
  it("把参数和所用的模板写成一行", () => {
    expect(partsOf(plan())).toEqual([
      "按项目参数生成",
      "泥水平衡 · D1600 · 总长 105 米 · 最长一段 105 米 · 1 段 · 1 套 · 粉质粘土 · 甲方提供发电、住宿",
      "模板：泥水平衡 DN1200"
    ]);
  });

  it("空着的参数不出现", () => {
    expect(
      partsOf(
        plan({
          machine_type: null,
          total_length_m: null,
          longest_drive_m: null,
          section_count: null,
          soil: null,
          client_supplies: []
        })
      )
    ).toEqual(["按项目参数生成", "D1600 · 1 套", "模板：泥水平衡 DN1200"]);
  });
});
