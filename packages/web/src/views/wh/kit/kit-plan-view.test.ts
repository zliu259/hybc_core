import { describe, expect, it } from "vitest";

import type { KitPlanParams, KitTemplateRow } from "@/api/wh/kit-types";
import {
  emptyPlanParams,
  emptyRule,
  lineChanged,
  pickTemplateFor,
  planParamProblems,
  ruleSummary
} from "./kit-plan-view";

const tpl = (
  id: number,
  machine_type: string | null,
  diameter_mm: number | null,
  status: "active" | "disabled" = "active"
): KitTemplateRow => ({
  id,
  name: `模板${id}`,
  machine_type,
  diameter_mm,
  remark: null,
  status,
  version: 0,
  created_by_userid: "kp",
  created_at: "",
  updated_at: "",
  line_count: 0
});

describe("pickTemplateFor", () => {
  const list = [
    tpl(1, "泥水平衡", 1200),
    tpl(2, "泥水平衡", 600),
    tpl(3, "土压平衡", 2400),
    tpl(4, "土压平衡", 1750),
    tpl(5, "泥水平衡", null),
    tpl(6, "泥水平衡", 1600, "disabled")
  ];

  it.each([
    ["泥水平衡", 1600, 1], // 最接近的；停用的 1600 不选
    ["泥水平衡", 800, 2],
    ["泥水平衡", 900, 1], // 一样近时取大的
    ["土压平衡", 2000, 4],
    ["土压平衡", 2075, 3],
    ["泥水平衡", null, 1], // 没有管径：同机型里排最前的
    ["砾石破碎", 1600, null],
    [null, 1600, null]
  ])("%s %s → %s", (machine, diameter, id) => {
    expect(pickTemplateFor(list, machine, diameter)).toBe(id);
  });

  it("同机型的模板都没填管径时取第一个", () => {
    expect(
      pickTemplateFor(
        [tpl(7, "泥水平衡", null), tpl(8, "泥水平衡", null)],
        "泥水平衡",
        1600
      )
    ).toBe(7);
  });

  it("没有模板时是 null", () => {
    expect(pickTemplateFor([], "泥水平衡", 1600)).toBeNull();
  });
});

describe("ruleSummary", () => {
  it.each([
    [{}, ""],
    [{ qty_per_set: true }, "每套一份"],
    [
      {
        qty_basis: "per_longest_metre" as const,
        qty_factor: 2,
        qty_extra: 60,
        qty_per_set: true
      },
      "按最长一段 ×2 +60 · 每套一份"
    ],
    [
      {
        qty_basis: "per_section" as const,
        qty_factor: 1,
        spec_by_diameter: true,
        role: "main_machine" as const
      },
      "按段 ×1 · 规格随管径 · 主机"
    ],
    [{ qty_basis: "per_total_metre" as const }, "按总长（没填系数）"],
    [
      { qty_basis: "per_total_metre" as const, qty_factor: 0.3, qty_extra: 0 },
      "按总长 ×0.3"
    ],
    [{ role: "lodging" as const }, "住宿"],
    [{ role: "power" as const, spec_by_diameter: true }, "规格随管径 · 发电"]
  ])("%j → %s", (patch, text) => {
    expect(ruleSummary({ ...emptyRule(), ...patch })).toBe(text);
  });
});

describe("lineChanged", () => {
  it("生成时的数量是空的不算改过；数量不同才算", () => {
    expect(lineChanged({ planned_qty: 5, generated_qty: null })).toBe(false);
    expect(lineChanged({ planned_qty: 270, generated_qty: 270 })).toBe(false);
    expect(lineChanged({ planned_qty: 300, generated_qty: 270 })).toBe(true);
    expect(lineChanged({ planned_qty: 0, generated_qty: 3 })).toBe(true);
  });
});

describe("planParamProblems", () => {
  const params = (patch: Partial<KitPlanParams> = {}): KitPlanParams => ({
    ...emptyPlanParams(),
    ...patch
  });

  it("空的参数没有问题；套数默认 1", () => {
    expect(emptyPlanParams()).toEqual({
      machine_type: null,
      pipe_diameter_mm: null,
      total_length_m: null,
      longest_drive_m: null,
      section_count: null,
      set_count: 1,
      soil: null,
      client_supplies: []
    });
    expect(planParamProblems(emptyPlanParams())).toEqual([]);
    expect(
      planParamProblems(
        params({
          machine_type: "泥水平衡",
          pipe_diameter_mm: 1600,
          total_length_m: 1600,
          longest_drive_m: 105.5,
          section_count: 22,
          set_count: 2,
          soil: "粉质粘土",
          client_supplies: ["power", "lodging"]
        })
      )
    ).toEqual([]);
  });

  it.each([
    [{ pipe_diameter_mm: 299 }, "管径必须是 300 到 5000 之间的整数"],
    [{ pipe_diameter_mm: 1600.5 }, "管径必须是 300 到 5000 之间的整数"],
    [{ total_length_m: 0 }, "总长度必须大于 0，不超过 20000"],
    [{ longest_drive_m: 20001 }, "最长一段必须大于 0，不超过 20000"],
    [{ total_length_m: 100, longest_drive_m: 101 }, "最长一段不能超过总长度"],
    [{ section_count: 0 }, "段数必须是 1 到 200 的整数"],
    [{ section_count: 1.5 }, "段数必须是 1 到 200 的整数"],
    [{ set_count: 201 }, "套数必须是 1 到 200 的整数"],
    [{ machine_type: "机".repeat(21) }, "机型不能超过20个字"],
    [{ soil: "土".repeat(101) }, "土质不能超过100个字"]
  ])("%j → %s", (patch, message) => {
    expect(planParamProblems(params(patch))).toEqual([message]);
  });

  it("几处不对时都列出来", () => {
    expect(
      planParamProblems(params({ pipe_diameter_mm: 1, set_count: 0 }))
    ).toEqual([
      "管径必须是 300 到 5000 之间的整数",
      "套数必须是 1 到 200 的整数"
    ]);
  });
});
