import { describe, expect, it } from "vitest";

import type { TemplateLineInput } from "@/api/wh/kit-types";
import { parseTable } from "../shared/csv";
import { emptyRule } from "./kit-plan-view";
import { mapTemplateRows } from "./template-paste";

describe("模板粘贴导入", () => {
  const categories = [{ id: 1, name: "顶管机" }];
  const paste = (body: string) =>
    mapTemplateRows(
      parseTable(
        `分节\t类型\t品名\t规格\t单位\t默认数量\t设备类别\t备注\n${body}`
      ),
      categories
    );

  it("三行：设备、物资（周转/消耗都算物资）、备忘", () => {
    expect(
      paste(
        "顶进设备\t按台\t机头土压\t2400\t台\t1\t顶管机\t\n辅助设备\t周转\t排泥钢管\tΦ114\t米\t120\t\t\n生活设施\t备忘\t集装箱\t\t个\t\t\t本地租"
      )
    ).toEqual({
      rows: [
        {
          section: "顶进设备",
          line_kind: "device",
          device_category_id: 1,
          name_text: "机头土压",
          spec_text: "2400",
          unit: "台",
          default_qty: 1,
          note: null,
          ...emptyRule()
        },
        {
          section: "辅助设备",
          line_kind: "material",
          device_category_id: null,
          name_text: "排泥钢管",
          spec_text: "Φ114",
          unit: "米",
          default_qty: 120,
          note: null,
          ...emptyRule()
        },
        {
          section: "生活设施",
          line_kind: "text",
          device_category_id: null,
          name_text: "集装箱",
          spec_text: null,
          unit: "个",
          default_qty: null,
          note: "本地租",
          ...emptyRule()
        }
      ],
      errors: []
    });
  });

  it("设备类别不存在、数量写成若干、类型认不出：逐行报错", () => {
    expect(
      paste(
        "辅助设备\t设备\t泥浆泵\t\t台\t1\t泥浆泵\t\n工具\t物资\t管钳\t\t把\t若干\t\t\n工具\t工具\t扳手\t\t把\t1\t\t"
      ).errors
    ).toEqual([
      { row: 1, message: "设备类别不存在：泥浆泵，请先在库房设置里添加" },
      { row: 2, message: "默认数量不是数字：若干" },
      { row: 3, message: "类型只能填 设备、物资 或 备忘：工具" }
    ]);
  });

  it("缺少必填列时整张表报错", () => {
    expect(
      mapTemplateRows(parseTable("品名\t单位\n管钳\t把"), categories).errors
    ).toEqual([{ row: 0, message: "缺少列：分节、类型" }]);
  });

  const withRules = (body: string) =>
    mapTemplateRows(
      parseTable(
        `分节\t类型\t品名\t设备类别\t计算方式\t系数\t另加\t每套一份\t规格随管径\t标记\n${body}`
      ),
      categories
    );
  const ruleOf = (row: TemplateLineInput) => ({
    qty_basis: row.qty_basis,
    qty_factor: row.qty_factor,
    qty_extra: row.qty_extra,
    qty_per_set: row.qty_per_set,
    spec_by_diameter: row.spec_by_diameter,
    role: row.role
  });

  it("认六个可选的列：计算方式、系数、另加、每套一份、规格随管径、标记", () => {
    const result = withRules(
      [
        "辅助设备\t物资\t排泥钢管\t\t按最长一段\t2\t60\t是\t是\t",
        "顶进设备\t设备\t机头泥水\t顶管机\t\t\t\t1\t\t主机",
        "顶进设备\t物资\t止水圈\t\t按段\t0.5\t\t否\t√\t",
        "生活设施\t物资\t上下床\t\t固定\t\t\t0\t\t住宿",
        "辅助设备\t设备\t发电机\t顶管机\t\t\t\t\t\t发电"
      ].join("\n")
    );
    expect(result.errors).toEqual([]);
    expect(result.rows.map(ruleOf)).toEqual([
      {
        qty_basis: "per_longest_metre",
        qty_factor: 2,
        qty_extra: 60,
        qty_per_set: true,
        spec_by_diameter: true,
        role: null
      },
      { ...emptyRule(), qty_per_set: true, role: "main_machine" },
      {
        ...emptyRule(),
        qty_basis: "per_section",
        qty_factor: 0.5,
        spec_by_diameter: true
      },
      { ...emptyRule(), role: "lodging" },
      { ...emptyRule(), role: "power" }
    ]);
  });

  it("备忘行不带规则，规则的列填了什么都不管", () => {
    const result = withRules(
      "设备维修配件\t备忘\t水泵配件\t\t按段\t2\t\t是\t是\t发电"
    );
    expect(result.errors).toEqual([]);
    expect(result.rows.map(ruleOf)).toEqual([emptyRule()]);
  });

  it("填了系数或另加、计算方式却是固定：报错，不悄悄丢掉", () => {
    const factorOnly =
      "填了系数，但计算方式是固定。要按它算就填计算方式，不用就把系数清掉";
    const extraOnly =
      "填了另加，但计算方式是固定。要按它算就填计算方式，不用就把另加清掉";
    expect(
      withRules(
        [
          "工具\t物资\t电焊机\t\t\t2\t\t\t\t",
          "工具\t物资\t焊把线\t\t固定\t\t5\t\t\t",
          "工具\t物资\t角磨机\t\t固定\t2\t5\t\t\t",
          "工具\t物资\t电锤\t\t\t0\t\t\t\t"
        ].join("\n")
      )
    ).toEqual({
      rows: [],
      errors: [
        { row: 1, message: factorOnly },
        { row: 2, message: extraOnly },
        { row: 3, message: factorOnly },
        // 写了 0 也算填了：多半是忘了选计算方式
        { row: 4, message: factorOnly }
      ]
    });
  });

  it.each([
    [
      "工具\t物资\t电焊机\t\t按套\t\t\t\t\t",
      "计算方式只能填 固定、按总长、按最长一段、按段：按套"
    ],
    ["工具\t物资\t电焊机\t\t按段\t两\t\t\t\t", "系数不是数字：两"],
    ["工具\t物资\t电焊机\t\t按段\t-1\t\t\t\t", "系数不能是负数：-1"],
    ["工具\t物资\t电焊机\t\t按段\t1\t多\t\t\t", "另加不是数字：多"],
    ["工具\t物资\t电焊机\t\t\t\t\t也许\t\t", "每套一份只能填 是 或 否：也许"],
    ["工具\t物资\t电焊机\t\t\t\t\t\t大概\t", "规格随管径只能填 是 或 否：大概"],
    [
      "工具\t物资\t电焊机\t\t\t\t\t\t\t老板",
      "标记只能填 主机、发电、住宿：老板"
    ]
  ])("规则的列填错：%s", (body, message) => {
    expect(withRules(body)).toEqual({
      rows: [],
      errors: [{ row: 1, message }]
    });
  });
});
