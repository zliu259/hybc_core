import { describe, expect, it } from "vitest";

import { mapDeviceRows, mapMaterialRows, parseTable } from "./csv";

describe("导入表格解析", () => {
  it("从 Excel 粘贴的制表符文本和 CSV 都能解析", () => {
    expect(parseTable("品名\t规格\n排泥钢管\tΦ114\n").rows).toEqual([
      { 品名: "排泥钢管", 规格: "Φ114" }
    ]);
    expect(parseTable('﻿品名,规格\n"卡扣, 带螺栓",DN114\n\n').rows).toEqual([
      { 品名: "卡扣, 带螺栓", 规格: "DN114" }
    ]);
    expect(parseTable('品名,备注\n"引号""里""",x\r\n').rows).toEqual([
      { 品名: '引号"里"', 备注: "x" }
    ]);
  });

  it("物资：管法翻成枚举，期初数量不是数字时逐行报错", () => {
    const mapped = mapMaterialRows(
      parseTable(
        "品名,规格,单位,分节,管法,期初数量\n焊把线,,米,工具,周转,25米\n胶布,塑料,盘,施工消耗材料,消耗,60\n"
      )
    );
    expect(mapped.errors).toEqual([
      { row: 1, message: "期初数量不是数字：25米" }
    ]);
    expect(mapped.rows).toHaveLength(1);
    expect(mapped.rows[0]).toMatchObject({
      name: "胶布",
      spec: "塑料",
      kind: "consumable",
      opening_quantity: 60
    });
  });

  it("物资：管法不是周转或消耗时报错", () => {
    const mapped = mapMaterialRows(
      parseTable("品名,单位,分节,管法\n机头,台,顶进设备,按台\n")
    );
    expect(mapped.errors).toEqual([
      { row: 1, message: "管法只能填 周转 或 消耗：按台" }
    ]);
  });

  it("缺少必需的列时报出缺哪一列", () => {
    expect(mapMaterialRows(parseTable("品名,规格\n")).errors).toEqual([
      { row: 0, message: "缺少列：单位、分节、管法" }
    ]);
    expect(mapDeviceRows(parseTable("编号\nSB-1\n")).errors).toEqual([
      { row: 0, message: "缺少列：名称、类别" }
    ]);
  });

  it("设备：口径不是整数时报错，其余字段原样带上", () => {
    const mapped = mapDeviceRows(
      parseTable(
        "名称,类别,机型,口径,所在项目\n唐兴 NSPD1200,顶管机,泥水平衡,1200,临河 DN1200\n发电机,发电机,,一千二,\n"
      )
    );
    expect(mapped.errors).toEqual([
      { row: 2, message: "口径不是整数：一千二" }
    ]);
    expect(mapped.rows).toEqual([
      {
        device_code: "",
        name: "唐兴 NSPD1200",
        alias: "",
        category_name: "顶管机",
        machine_type: "泥水平衡",
        diameter_mm: 1200,
        manufacturer: "",
        model: "",
        serial_no: "",
        spec: "",
        project_name: "临河 DN1200",
        storage_note: "",
        remark: ""
      }
    ]);
  });
});
