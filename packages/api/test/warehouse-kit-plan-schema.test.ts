import { beforeEach, describe, expect, it } from "vitest";

import { createWarehouseHarness } from "./helpers/warehouse-harness";
import { hasSqlite, readMigration } from "./helpers/sqlite-d1";

// 迁移 0101：配套模板行上的计算规则、模板的管径、清单的生成参数。

describe.skipIf(!hasSqlite)("0101 配套模板的计算规则", () => {
  let h;

  beforeEach(() => {
    h = createWarehouseHarness();
  });

  const lineOf = (templateId) =>
    h.database
      .prepare("SELECT * FROM kit_template_line WHERE template_id = ? ORDER BY id")
      .all(templateId);

  it("新列的默认值：固定、不勾、不标；管径和 plan_json 是空的", () => {
    const templateId = h.seed.kitTemplate({ name: "甲" }, [{ name_text: "排泥钢管" }]);
    const [line] = lineOf(templateId);
    expect({
      qty_basis: line.qty_basis,
      qty_factor: line.qty_factor,
      qty_extra: line.qty_extra,
      qty_per_set: line.qty_per_set,
      spec_by_diameter: line.spec_by_diameter,
      role: line.role
    }).toEqual({
      qty_basis: "fixed",
      qty_factor: null,
      qty_extra: null,
      qty_per_set: 0,
      spec_by_diameter: 0,
      role: null
    });
    expect(
      h.database.prepare("SELECT diameter_mm FROM kit_template WHERE id = ?").get(templateId)
    ).toEqual({ diameter_mm: null });
    const kitId = h.seed.kit({ project_id: h.seed.project() });
    expect(h.database.prepare("SELECT plan_json FROM project_kit WHERE id = ?").get(kitId)).toEqual(
      {
        plan_json: null
      }
    );
  });

  it("不认的计算方式、标记，负数的系数和另加，0 和 1 以外的勾选，都写不进去", () => {
    const templateId = h.seed.kitTemplate({ name: "甲" }, [{ name_text: "x" }]);
    const [line] = lineOf(templateId);
    const set = (column, value) =>
      h.database
        .prepare(`UPDATE kit_template_line SET ${column} = ? WHERE id = ?`)
        .run(value, line.id);
    expect(() => set("qty_basis", "per_set")).toThrow(/CHECK/);
    expect(() => set("role", "boss")).toThrow(/CHECK/);
    expect(() => set("qty_factor", -1)).toThrow(/CHECK/);
    expect(() => set("qty_extra", -1)).toThrow(/CHECK/);
    expect(() => set("qty_per_set", 2)).toThrow(/CHECK/);
    expect(() => set("spec_by_diameter", 2)).toThrow(/CHECK/);
    for (const basis of ["fixed", "per_total_metre", "per_longest_metre", "per_section"]) {
      set("qty_basis", basis);
    }
    for (const role of ["main_machine", "power", "lodging", null]) set("role", role);
    set("qty_factor", 0.3);
    set("qty_extra", 0);
  });

  it("迁移给四个现有模板补管径，按名字给设备行和生活设施的行补标记，别的不动", () => {
    const category = Object.fromEntries(
      ["顶管机", "发电机", "油泵站"].map((name) => [name, h.seed.category(name)])
    );
    const lines = () => [
      { line_kind: "device", device_category_id: category["顶管机"], name_text: "机头" },
      { line_kind: "device", device_category_id: category["发电机"], name_text: "发电机" },
      { line_kind: "device", device_category_id: category["油泵站"], name_text: "油泵站" },
      { section: "生活设施", name_text: "上下床" },
      { section: "工具", name_text: "电焊机" }
    ];
    const names = [
      "泥水平衡 DN1200",
      "泥水平衡 DN600",
      "土压平衡 DN2400",
      "土压平衡 DN1750 两套",
      "别的模板"
    ];
    const ids = Object.fromEntries(
      names.map((name) => [name, h.seed.kitTemplate({ name }, lines())])
    );
    // 已经有管径、已经有标记的不被改
    h.database
      .prepare("UPDATE kit_template SET diameter_mm = 1250 WHERE id = ?")
      .run(ids["泥水平衡 DN1200"]);
    h.database
      .prepare(
        "UPDATE kit_template_line SET role = 'power' WHERE template_id = ? AND name_text = '机头'"
      )
      .run(ids["泥水平衡 DN600"]);

    // 只重跑迁移里补数据的那几句
    const updates = readMigration("0101_kit_plan_rules.sql")
      .split(";")
      .map((statement) => statement.replace(/^\s*--.*$/gm, "").trim())
      .filter((statement) => statement.toUpperCase().startsWith("UPDATE"));
    expect(updates).toHaveLength(7);
    for (const statement of updates) h.database.exec(statement);

    const diameters = h.database
      .prepare("SELECT name, diameter_mm FROM kit_template ORDER BY id")
      .all();
    expect(Object.fromEntries(diameters.map((row) => [row.name, row.diameter_mm]))).toEqual({
      "泥水平衡 DN1200": 1250,
      "泥水平衡 DN600": 600,
      "土压平衡 DN2400": 2400,
      "土压平衡 DN1750 两套": 1750,
      别的模板: null
    });
    const roles = (name) => lineOf(ids[name]).map((line) => [line.name_text, line.role]);
    const marked = [
      ["机头", "main_machine"],
      ["发电机", "power"],
      ["油泵站", null],
      ["上下床", "lodging"],
      ["电焊机", null]
    ];
    expect(roles("土压平衡 DN2400")).toEqual(marked);
    // 标记按类别名和分节名认，不限模板
    expect(roles("别的模板")).toEqual(marked);
    expect(roles("泥水平衡 DN600")[0]).toEqual(["机头", "power"]);
  });
});
