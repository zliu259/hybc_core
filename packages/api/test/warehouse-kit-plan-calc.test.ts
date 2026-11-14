import { describe, expect, it } from "vitest";

import { calcLineQty, hasAnyRule, parsePlanParams } from "../src/services/warehouse/kit-plan-calc";

// 按项目参数生成清单：单行数量和算式。纯函数，不碰数据库，CI 上也跑。

const rule = (patch = {}) => ({
  qty_basis: "fixed",
  qty_factor: null,
  qty_extra: null,
  qty_round_to: null,
  qty_per_set: false,
  spec_by_diameter: false,
  role: null,
  ...patch
});

const params = (patch = {}) => ({
  machine_type: "泥水平衡",
  pipe_diameter_mm: 1600,
  total_length_m: 105,
  longest_drive_m: 105,
  section_count: 1,
  set_count: 1,
  soil: null,
  client_supplies: [],
  ...patch
});

describe("calcLineQty", () => {
  it.each([
    // 规则, 默认数量, 参数, 数量, 算式
    [rule(), 4, params(), 4, null],
    [rule(), null, params(), 0, null],
    [rule({ qty_per_set: true }), 1, params(), 1, null],
    [rule({ qty_per_set: true }), 1, params({ set_count: 2 }), 2, "每套一份：1 × 2 = 2"],
    [
      rule({ qty_basis: "per_longest_metre", qty_factor: 2, qty_extra: 60 }),
      120,
      params(),
      270,
      "按最长一段：2 × 105 + 60 = 270"
    ],
    [
      rule({ qty_basis: "per_longest_metre", qty_factor: 2, qty_extra: 60, qty_per_set: true }),
      120,
      params({ set_count: 2 }),
      540,
      "按最长一段：2 × 105 + 60 = 270；每套一份 × 2 = 540"
    ],
    [
      rule({ qty_basis: "per_longest_metre", qty_factor: 2, qty_per_set: true }),
      120,
      params(),
      210,
      "按最长一段：2 × 105 = 210"
    ],
    [
      rule({ qty_basis: "per_total_metre", qty_factor: 0.3 }),
      10,
      params(),
      32,
      "按总长：0.3 × 105 = 31.5，取整 32"
    ],
    [
      rule({ qty_basis: "per_total_metre", qty_factor: 0.3, qty_extra: 5 }),
      10,
      params(),
      37,
      "按总长：0.3 × 105 = 31.5，取整 32，另加 5，共 37"
    ],
    [
      rule({ qty_basis: "per_total_metre", qty_factor: 0.1 }),
      10,
      params({ total_length_m: 30 }),
      3,
      "按总长：0.1 × 30 = 3"
    ],
    [
      rule({ qty_basis: "per_section", qty_factor: 2 }),
      1,
      params({ section_count: 22 }),
      44,
      "按段：2 × 22 = 44"
    ],
    [
      rule({ qty_basis: "per_section", qty_factor: 0, qty_extra: 0 }),
      9,
      params(),
      0,
      "按段：0 × 1 = 0"
    ]
  ])("%j 默认 %s → %s", (lineRule, defaultQty, planParams, qty, text) => {
    expect(calcLineQty(lineRule, defaultQty, planParams)).toEqual({
      qty,
      calc_text: text,
      missing: null
    });
  });

  it("缺参数时退回默认数量，说明缺什么；勾了每套一份仍然乘套数", () => {
    const perLongest = rule({ qty_basis: "per_longest_metre", qty_factor: 2, qty_per_set: true });
    expect(calcLineQty(perLongest, 120, params({ longest_drive_m: null }))).toEqual({
      qty: 120,
      calc_text: "缺最长一段，用模板默认数量",
      missing: "longest_drive"
    });
    expect(calcLineQty(perLongest, 120, params({ longest_drive_m: null, set_count: 2 }))).toEqual({
      qty: 240,
      calc_text: "缺最长一段，用模板默认数量；每套一份 × 2 = 240",
      missing: "longest_drive"
    });
    expect(
      calcLineQty(
        rule({ qty_basis: "per_total_metre", qty_factor: 1 }),
        null,
        params({ total_length_m: null })
      )
    ).toEqual({ qty: 0, calc_text: "缺总长度，用模板默认数量", missing: "total_length" });
    expect(
      calcLineQty(
        rule({ qty_basis: "per_section", qty_factor: 1 }),
        3,
        params({ section_count: null })
      )
    ).toEqual({ qty: 3, calc_text: "缺段数，用模板默认数量", missing: "section_count" });
  });

  it("没填系数时退回默认数量", () => {
    expect(calcLineQty(rule({ qty_basis: "per_section" }), 3, params())).toEqual({
      qty: 3,
      calc_text: "没填系数，用模板默认数量",
      missing: "factor"
    });
  });

  it("数量最多 3 位小数（清单保存时只收 3 位）；算式里的数和数量一致", () => {
    expect(
      calcLineQty(
        rule({ qty_basis: "per_section", qty_factor: 1, qty_extra: 0.1234 }),
        null,
        params()
      )
    ).toEqual({ qty: 1.123, calc_text: "按段：1 × 1 + 0.123 = 1.123", missing: null });
    expect(
      calcLineQty(
        rule({ qty_basis: "per_section", qty_factor: 1, qty_extra: 0.1236, qty_per_set: true }),
        null,
        params({ set_count: 3 })
      )
    ).toEqual({
      qty: 3.372,
      calc_text: "按段：1 × 1 + 0.124 = 1.124；每套一份 × 3 = 3.372",
      missing: null
    });
  });

  describe("取整到：算出的数量向上取到它的倍数", () => {
    const cable = (patch = {}) =>
      rule({
        qty_basis: "per_longest_metre",
        qty_factor: 1,
        qty_extra: 10,
        qty_round_to: 50,
        ...patch
      });

    it("已经是倍数的不动，算式也不多说一句", () => {
      expect(calcLineQty(cable(), 120, params({ longest_drive_m: 190 }))).toEqual({
        qty: 200,
        calc_text: "按最长一段：1 × 190 + 10 = 200",
        missing: null
      });
    });

    it("不是倍数的往上取，算式说明取到了多少", () => {
      expect(calcLineQty(cable(), 120, params({ longest_drive_m: 195 }))).toEqual({
        qty: 250,
        calc_text: "按最长一段：1 × 195 + 10 = 205，取到 50 的倍数 250",
        missing: null
      });
    });

    it("先取整再加另加，最后才取到倍数", () => {
      const perTotal = (patch = {}) =>
        rule({ qty_basis: "per_total_metre", qty_factor: 0.3, qty_round_to: 10, ...patch });
      expect(calcLineQty(perTotal(), null, params())).toEqual({
        qty: 40,
        calc_text: "按总长：0.3 × 105 = 31.5，取整 32，取到 10 的倍数 40",
        missing: null
      });
      expect(calcLineQty(perTotal({ qty_extra: 60, qty_round_to: 50 }), null, params())).toEqual({
        qty: 100,
        calc_text: "按总长：0.3 × 105 = 31.5，取整 32，另加 60，共 92，取到 50 的倍数 100",
        missing: null
      });
    });

    it("每套一份：每套先取到倍数，再乘套数", () => {
      expect(
        calcLineQty(
          cable({ qty_per_set: true }),
          120,
          params({ longest_drive_m: 195, set_count: 2 })
        )
      ).toEqual({
        qty: 500,
        calc_text: "按最长一段：1 × 195 + 10 = 205，取到 50 的倍数 250；每套一份 × 2 = 500",
        missing: null
      });
    });

    it("倍数可以是小数；0.3 取到 0.1 的倍数还是 0.3", () => {
      const perSection = (patch = {}) =>
        rule({ qty_basis: "per_section", qty_factor: 1, ...patch });
      expect(
        calcLineQty(perSection({ qty_extra: 0.3, qty_round_to: 0.5 }), null, params())
      ).toEqual({
        qty: 1.5,
        calc_text: "按段：1 × 1 + 0.3 = 1.3，取到 0.5 的倍数 1.5",
        missing: null
      });
      expect(
        calcLineQty(
          perSection({ qty_factor: 0, qty_extra: 0.3, qty_round_to: 0.1 }),
          null,
          params()
        )
      ).toEqual({ qty: 0.3, calc_text: "按段：0 × 1 + 0.3 = 0.3", missing: null });
    });

    it("缺参数或没填系数时退回的默认数量不取整", () => {
      expect(calcLineQty(cable(), 120, params({ longest_drive_m: null }))).toEqual({
        qty: 120,
        calc_text: "缺最长一段，用模板默认数量",
        missing: "longest_drive"
      });
      expect(calcLineQty(cable({ qty_factor: null }), 120, params())).toEqual({
        qty: 120,
        calc_text: "没填系数，用模板默认数量",
        missing: "factor"
      });
    });

    it("固定的行不取整", () => {
      expect(calcLineQty(rule({ qty_round_to: 50 }), 4, params())).toEqual({
        qty: 4,
        calc_text: null,
        missing: null
      });
    });
  });

  it("不改传进来的规则和参数", () => {
    const lineRule = Object.freeze(rule({ qty_basis: "per_section", qty_factor: 2 }));
    const planParams = Object.freeze(params());
    expect(() => calcLineQty(lineRule, 1, planParams)).not.toThrow();
  });
});

describe("hasAnyRule", () => {
  it("有一行不是固定，或者勾了每套一份，就算配了规则", () => {
    expect(hasAnyRule([rule(), rule({ spec_by_diameter: true, role: "power" })])).toBe(false);
    expect(hasAnyRule([rule(), rule({ qty_per_set: true })])).toBe(true);
    expect(hasAnyRule([rule({ qty_basis: "per_section" })])).toBe(true);
    expect(hasAnyRule([])).toBe(false);
  });
});

describe("parsePlanParams", () => {
  it("什么都不填也行：都是空的，套数 1", () => {
    const empty = {
      machine_type: null,
      pipe_diameter_mm: null,
      total_length_m: null,
      longest_drive_m: null,
      section_count: null,
      set_count: 1,
      soil: null,
      client_supplies: []
    };
    expect(parsePlanParams({})).toEqual(empty);
    expect(parsePlanParams(undefined)).toEqual(empty);
    expect(parsePlanParams({ machine_type: "  ", soil: "", set_count: null })).toEqual(empty);
  });

  it("填全了原样带出；数字写成字符串也认；甲方提供去重", () => {
    expect(
      parsePlanParams({
        machine_type: " 泥水平衡 ",
        pipe_diameter_mm: "1600",
        total_length_m: 1600,
        longest_drive_m: 105.5,
        section_count: 22,
        set_count: 2,
        soil: "粉质粘土",
        client_supplies: ["power", "lodging", "power"]
      })
    ).toEqual({
      machine_type: "泥水平衡",
      pipe_diameter_mm: 1600,
      total_length_m: 1600,
      longest_drive_m: 105.5,
      section_count: 22,
      set_count: 2,
      soil: "粉质粘土",
      client_supplies: ["power", "lodging"]
    });
  });

  it.each([
    [{ pipe_diameter_mm: 299 }, "管径必须是 300 到 5000 之间的整数"],
    [{ pipe_diameter_mm: 5001 }, "管径必须是 300 到 5000 之间的整数"],
    [{ pipe_diameter_mm: 1600.5 }, "管径必须是 300 到 5000 之间的整数"],
    [{ pipe_diameter_mm: "大" }, "管径必须是 300 到 5000 之间的整数"],
    [{ total_length_m: 0 }, "总长度必须大于 0，不超过 20000"],
    [{ total_length_m: 20001 }, "总长度必须大于 0，不超过 20000"],
    [{ longest_drive_m: 20001 }, "最长一段必须大于 0，不超过 20000"],
    [{ longest_drive_m: -1 }, "最长一段必须大于 0，不超过 20000"],
    [{ total_length_m: 100, longest_drive_m: 101 }, "最长一段不能超过总长度"],
    [{ section_count: 0 }, "段数必须是 1 到 200 的整数"],
    [{ section_count: 1.5 }, "段数必须是 1 到 200 的整数"],
    [{ set_count: 201 }, "套数必须是 1 到 200 的整数"],
    [{ set_count: 0 }, "套数必须是 1 到 200 的整数"],
    [{ client_supplies: ["crane"] }, "甲方提供只能是发电、住宿"],
    [{ client_supplies: "power" }, "甲方提供只能是发电、住宿"],
    [{ machine_type: "机".repeat(21) }, "机型不能超过20个字"],
    [{ soil: "土".repeat(101) }, "土质不能超过100个字"]
  ])("%j → %s", (input, message) => {
    expect(() => parsePlanParams(input)).toThrow(message);
    try {
      parsePlanParams(input);
    } catch (error) {
      expect(error.status).toBe(400);
    }
  });
});
