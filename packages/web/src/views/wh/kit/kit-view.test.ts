import { describe, expect, it } from "vitest";

import type { WarehouseCapabilities } from "@/api/wh/types";
import { parseTable } from "../shared/csv";
import {
  editableFromKit,
  editableFromTemplate,
  kitActions,
  kitLineProblems,
  mapTemplateRows,
  newEditableLine,
  saveThen,
  toKitLines,
  toTemplateLines
} from "./kit-view";

const caps = (
  patch: Partial<WarehouseCapabilities> = {}
): WarehouseCapabilities => ({
  is_keeper: false,
  is_doc_admin: false,
  can_scrap: false,
  can_unscrap: false,
  can_manage_settings: false,
  can_create_kit: false,
  ...patch
});

const keeper = {
  userid: "kp",
  roles: ["operator"],
  caps: caps({ is_keeper: true, can_create_kit: true })
};
const manager = {
  userid: "mg",
  roles: ["manager"],
  caps: caps({ can_create_kit: true })
};
const lead = {
  userid: "lead",
  roles: ["site_manager"],
  caps: caps({ can_create_kit: true })
};
const operator = { userid: "op", roles: ["operator"], caps: caps() };

const kit = (
  status: "draft" | "submitted" | "confirmed" | "closed",
  managerUserid = "lead"
) => ({
  status,
  project_manager_userid: managerUserid
});

describe("清单按钮", () => {
  it("草稿：能改能提交能作废的是库管、经理、项目自己的负责人；操作员什么都不能做", () => {
    const expected = {
      canEdit: true,
      canSubmit: true,
      canConfirm: false,
      canDiscard: true,
      canClose: false,
      canShip: false
    };
    expect(kitActions(kit("draft"), keeper)).toEqual(expected);
    expect(kitActions(kit("draft"), manager)).toEqual(expected);
    expect(kitActions(kit("draft"), lead)).toEqual(expected);
    expect(kitActions(kit("draft", "someone-else"), lead).canEdit).toBe(false);
    expect(
      Object.values(kitActions(kit("draft"), operator)).some(Boolean)
    ).toBe(false);
  });

  it("待确认：只有库管能确认；改和作废照旧", () => {
    expect(kitActions(kit("submitted"), keeper)).toMatchObject({
      canEdit: true,
      canSubmit: false,
      canConfirm: true,
      canDiscard: true
    });
    expect(kitActions(kit("submitted"), manager)).toMatchObject({
      canConfirm: false,
      canEdit: true
    });
  });

  it("已确认：库管能发货和关闭，谁都不能改", () => {
    expect(kitActions(kit("confirmed"), keeper)).toEqual({
      canEdit: false,
      canSubmit: false,
      canConfirm: false,
      canDiscard: false,
      canClose: true,
      canShip: true
    });
    expect(
      Object.values(kitActions(kit("confirmed"), manager)).some(Boolean)
    ).toBe(false);
  });

  it("已关闭：什么都不能做", () => {
    expect(Object.values(kitActions(kit("closed"), keeper)).some(Boolean)).toBe(
      false
    );
  });
});

describe("提交前的行检查", () => {
  const line = (patch = {}) => ({
    section: "辅助设备",
    line_kind: "material" as const,
    device_category_id: null,
    material_id: 3,
    name_text: "排泥钢管",
    planned_qty: 120,
    ...patch
  });

  it("要发的物资行没选规格、设备数不是整数、品名为空都标出来；计划 0 的不管", () => {
    expect(
      kitLineProblems([
        line(),
        line({ material_id: null }),
        line({ material_id: null, planned_qty: 0 }),
        line({
          line_kind: "device",
          device_category_id: 1,
          material_id: null,
          planned_qty: 1.5
        }),
        line({ name_text: " " })
      ])
    ).toEqual([
      { index: 1, message: "排泥钢管 还没选规格" },
      { index: 3, message: "设备数量必须是整数" },
      { index: 4, message: "品名不能为空" }
    ]);
  });
});

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
          note: null
        },
        {
          section: "辅助设备",
          line_kind: "material",
          device_category_id: null,
          name_text: "排泥钢管",
          spec_text: "Φ114",
          unit: "米",
          default_qty: 120,
          note: null
        },
        {
          section: "生活设施",
          line_kind: "text",
          device_category_id: null,
          name_text: "集装箱",
          spec_text: null,
          unit: "个",
          default_qty: null,
          note: "本地租"
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
});

describe("表格行和接口行互转", () => {
  it("清单行：读回来再保存，字段不丢；设备行不带物资，物资行不带类别；空字符串存成 null", () => {
    const rows = editableFromKit([
      {
        id: 7,
        sort_order: 0,
        section: "辅助设备",
        line_kind: "material",
        device_category_id: null,
        material_id: 3,
        name_text: "排泥钢管",
        spec_text: null,
        unit: "米",
        planned_qty: 120,
        source: "warehouse",
        note: null,
        material_code: "WZ-0003",
        material_name: "排泥钢管",
        material_spec: "Φ114",
        material_unit: "米",
        material_status: "active",
        material_kind: "turnover",
        category_name: null,
        spec_choices: [{ id: 3, spec: "Φ114" }]
      }
    ]);
    expect(rows[0]).toMatchObject({
      id: 7,
      qty: 120,
      material_label: "排泥钢管 Φ114",
      spec_text: ""
    });
    const edited = [
      ...rows,
      {
        ...newEditableLine("顶进设备"),
        line_kind: "device" as const,
        device_category_id: 1,
        material_id: 9,
        name_text: "机头",
        qty: 1
      }
    ];
    expect(toKitLines(edited)).toEqual([
      {
        section: "辅助设备",
        line_kind: "material",
        device_category_id: null,
        material_id: 3,
        name_text: "排泥钢管",
        spec_text: null,
        unit: "米",
        planned_qty: 120,
        source: "warehouse",
        note: null
      },
      {
        section: "顶进设备",
        line_kind: "device",
        device_category_id: 1,
        material_id: null,
        name_text: "机头",
        spec_text: null,
        unit: null,
        planned_qty: 1,
        source: "warehouse",
        note: null
      }
    ]);
  });

  it("模板行：数量为空保持 null；备忘行不带类别", () => {
    const rows = editableFromTemplate([
      {
        id: 1,
        sort_order: 0,
        section: "生活设施",
        line_kind: "text",
        device_category_id: 4,
        device_category_name: null,
        name_text: "集装箱",
        spec_text: null,
        unit: "个",
        default_qty: null,
        note: "本地租"
      }
    ]);
    expect(toTemplateLines(rows)).toEqual([
      {
        section: "生活设施",
        line_kind: "text",
        device_category_id: null,
        name_text: "集装箱",
        spec_text: null,
        unit: "个",
        default_qty: null,
        note: "本地租"
      }
    ]);
  });
});

describe("先保存再提交或确认", () => {
  it("表格能改时先保存，保存成功才做下一步", async () => {
    const calls: string[] = [];
    const result = await saveThen(
      true,
      async () => {
        calls.push("save");
        return true;
      },
      async () => {
        calls.push("confirm");
        return "ok";
      }
    );
    expect(calls).toEqual(["save", "confirm"]);
    expect(result).toBe("ok");
  });

  it("保存失败就停下，不确认", async () => {
    const calls: string[] = [];
    const result = await saveThen(
      true,
      async () => {
        calls.push("save");
        return false;
      },
      async () => {
        calls.push("confirm");
        return "ok";
      }
    );
    expect(calls).toEqual(["save"]);
    expect(result).toBeUndefined();
  });

  it("不能改时直接做下一步", async () => {
    const calls: string[] = [];
    await saveThen(
      false,
      async () => {
        calls.push("save");
        return true;
      },
      async () => {
        calls.push("confirm");
      }
    );
    expect(calls).toEqual(["confirm"]);
  });
});
