import { describe, expect, it } from "vitest";

import type { KitTemplateLine } from "@/api/wh/kit-types";
import type { WarehouseCapabilities } from "@/api/wh/types";
import { emptyRule } from "./kit-plan-view";
import {
  editableFromKit,
  editableFromTemplate,
  kitActions,
  kitLineProblems,
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
        note: "本地租",
        ...emptyRule(),
        // 备忘行不存规则，带回来的也不往外发
        qty_per_set: true,
        role: "power"
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
        note: "本地租",
        ...emptyRule()
      }
    ]);
  });

  it("模板行的规则：读回来再保存原样不变；固定的行不带系数和另加", () => {
    const line = (patch: Partial<KitTemplateLine>): KitTemplateLine => ({
      id: 1,
      sort_order: 0,
      section: "辅助设备",
      line_kind: "material",
      device_category_id: null,
      device_category_name: null,
      name_text: "排泥钢管",
      spec_text: "Φ114",
      unit: "米",
      default_qty: 120,
      note: null,
      ...emptyRule(),
      ...patch
    });
    const rule = {
      qty_basis: "per_longest_metre" as const,
      qty_factor: 2,
      qty_extra: 60,
      qty_per_set: true,
      spec_by_diameter: true,
      role: null
    };
    const [calculated, fixed] = toTemplateLines(
      editableFromTemplate([
        line(rule),
        line({ qty_factor: 2, qty_extra: 5, role: "lodging" })
      ])
    );
    expect(calculated).toMatchObject(rule);
    expect(fixed).toMatchObject({
      qty_basis: "fixed",
      qty_factor: null,
      qty_extra: null,
      role: "lodging"
    });
  });

  it("新加的一行默认是固定、不勾、不标", () => {
    expect(newEditableLine("工具").rule).toEqual(emptyRule());
  });
});

describe("按参数生成的清单行", () => {
  const detailLine = {
    id: 9,
    sort_order: 0,
    section: "辅助设备",
    line_kind: "material" as const,
    device_category_id: null,
    material_id: 3,
    name_text: "排泥钢管",
    spec_text: "Φ114",
    unit: "米",
    planned_qty: 300,
    source: "warehouse" as const,
    note: null,
    material_code: "WZ-0007",
    material_name: "排泥钢管",
    material_spec: "Φ114",
    material_unit: "米",
    material_status: "active",
    material_kind: "turnover" as const,
    category_name: null,
    spec_choices: [],
    calc_text: "按最长一段：2 × 105 + 60 = 270",
    generated_qty: 270
  };

  it("读回来带上算式和生成时的数量；保存时每一行只有原来那十个字段", () => {
    const [row] = editableFromKit([detailLine]);
    expect(row).toMatchObject({
      qty: 300,
      calc_text: "按最长一段：2 × 105 + 60 = 270",
      generated_qty: 270
    });
    expect(Object.keys(toKitLines([row])[0]).sort()).toEqual([
      "device_category_id",
      "line_kind",
      "material_id",
      "name_text",
      "note",
      "planned_qty",
      "section",
      "source",
      "spec_text",
      "unit"
    ]);
  });

  it("不是生成的行、新加的行：两项都是空的", () => {
    const plain = { ...detailLine, calc_text: null, generated_qty: null };
    expect(editableFromKit([plain])[0]).toMatchObject({
      calc_text: null,
      generated_qty: null
    });
    expect(newEditableLine("工具")).toMatchObject({
      calc_text: null,
      generated_qty: null
    });
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
