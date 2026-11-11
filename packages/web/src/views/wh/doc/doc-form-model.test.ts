import { describe, expect, it } from "vitest";

import type { ProjectHoldings } from "@/api/wh/types";
import type { KitFulfilmentLine } from "@/api/wh/kit-types";
import {
  buildDocPayload,
  newDocForm,
  prefillBackForm,
  prefillOutFromKit,
  validateDocForm,
  type DocFormState
} from "./doc-form-model";

const pipe = {
  material_id: 3,
  name: "排泥钢管",
  spec: "Φ114",
  unit: "米",
  kind: "turnover" as const,
  available: 200,
  returned: "",
  lost: "",
  quantity: "120"
};

const outState = (patch: Partial<DocFormState> = {}): DocFormState => ({
  ...newDocForm("out"),
  project_id: 7,
  handover_name: "张三",
  devices: [
    {
      device_id: 1,
      device_code: "SB-0001",
      name: "唐兴",
      usage_meters: "",
      soil_type: ""
    }
  ],
  materials: [pipe],
  ...patch
});

describe("库房单表单", () => {
  it("发货：设备和物资各一行，生成的请求体只含需要的字段", () => {
    const state = outState();
    expect(buildDocPayload(state)).toEqual({
      doc_type: "out",
      client_request_id: state.client_request_id,
      project_id: 7,
      handover_name: "张三",
      device_lines: [{ device_id: 1 }],
      material_lines: [{ material_id: 3, quantity: 120 }]
    });
  });

  it("返库：退回 6 报损 2 拆成两行，都为 0 的不生成；设备带顶进距离", () => {
    const state: DocFormState = {
      ...newDocForm("back"),
      project_id: 7,
      devices: [
        {
          device_id: 1,
          device_code: "SB-0001",
          name: "唐兴",
          usage_meters: "320.5",
          soil_type: "砂卵石"
        }
      ],
      materials: [
        { ...pipe, available: 10, returned: "6", lost: "2" },
        {
          ...pipe,
          material_id: 4,
          name: "卡扣",
          available: 5,
          returned: "0",
          lost: ""
        }
      ]
    };
    const payload = buildDocPayload(state);
    expect(payload.material_lines).toEqual([
      { material_id: 3, quantity: 6, outcome: "returned" },
      { material_id: 3, quantity: 2, outcome: "lost" }
    ]);
    expect(payload.device_lines).toEqual([
      { device_id: 1, usage_meters: 320.5, soil_type: "砂卵石" }
    ]);
  });

  it.each([
    [{ project_id: null }, "请选择项目"],
    [{ devices: [], materials: [] }, "请至少添加一行"],
    [{ materials: [{ ...pipe, quantity: "25米" }] }, "排泥钢管 的数量不对"],
    [{ materials: [{ ...pipe, quantity: "1.2345" }] }, "排泥钢管 的数量不对"],
    [
      { materials: [{ ...pipe, available: 10, quantity: "12" }] },
      "排泥钢管 在库只有 10"
    ]
  ])("发货表单 %j 报 %s", (patch, message) => {
    expect(validateDocForm(outState(patch as Partial<DocFormState>))).toBe(
      message
    );
  });

  it("合法的发货表单没有错误", () => {
    expect(validateDocForm(outState())).toBeNull();
  });

  it("返库：顶进距离填了就必须是数字，不能悄悄丢掉", () => {
    const backWith = (usage: string) =>
      validateDocForm({
        ...newDocForm("back"),
        project_id: 7,
        devices: [
          {
            device_id: 1,
            device_code: "SB-0001",
            name: "唐兴",
            usage_meters: usage,
            soil_type: ""
          }
        ]
      });
    expect(backWith("120米")).toBe("SB-0001 的顶进距离不对，只填数字（米）");
    expect(backWith("120.5555")).toBe("SB-0001 的顶进距离不对，只填数字（米）");
    expect(backWith("100001")).toBe("SB-0001 的顶进距离不对，只填数字（米）");
    expect(backWith("")).toBeNull();
    expect(backWith(" 320.5 ")).toBeNull();
  });

  it("返库：退回加报损超过在场数时报错；耗材不能报损；全为 0 等于没有行", () => {
    const base = { ...newDocForm("back"), project_id: 7 };
    expect(
      validateDocForm({
        ...base,
        materials: [
          { ...pipe, name: "顶镐", available: 4, returned: "3", lost: "2" }
        ]
      })
    ).toBe("顶镐 在场只有 4");
    expect(
      validateDocForm({
        ...base,
        materials: [
          {
            ...pipe,
            name: "电焊条",
            kind: "consumable",
            available: null,
            returned: "1",
            lost: "1"
          }
        ]
      })
    ).toBe("耗材不需要报损：电焊条");
    expect(
      validateDocForm({
        ...base,
        materials: [{ ...pipe, available: 4, returned: "0", lost: "" }]
      })
    ).toBe("请至少添加一行");
  });

  it("转场：两个项目相同报错；入库不能带设备", () => {
    expect(
      validateDocForm({
        ...newDocForm("transfer"),
        project_id: 7,
        to_project_id: 7,
        materials: [pipe]
      })
    ).toBe("来源和目的项目不能相同");
    expect(
      validateDocForm({
        ...newDocForm("transfer"),
        project_id: 7,
        to_project_id: null,
        materials: [pipe]
      })
    ).toBe("请选择目的项目");
    expect(
      validateDocForm({
        ...newDocForm("inbound"),
        devices: outState().devices,
        materials: [pipe]
      })
    ).toBe("入库单不能包含设备");
  });

  it("用在场清单预填返库表单：设备全部带出，周转件默认全部退回", () => {
    const holdings: ProjectHoldings = {
      devices: [
        {
          id: 1,
          device_code: "SB-0001",
          name: "唐兴"
        } as ProjectHoldings["devices"][number]
      ],
      materials: [
        {
          material_id: 3,
          material_code: "WZ-0001",
          name: "排泥钢管",
          spec: "Φ114",
          unit: "米",
          holding: 120
        }
      ]
    };
    const state = prefillBackForm(
      { ...newDocForm("back"), project_id: 7 },
      holdings
    );
    expect(state.devices).toEqual([
      {
        device_id: 1,
        device_code: "SB-0001",
        name: "唐兴",
        usage_meters: "",
        soil_type: ""
      }
    ]);
    expect(state.materials).toEqual([
      {
        material_id: 3,
        name: "排泥钢管",
        spec: "Φ114",
        unit: "米",
        kind: "turnover",
        available: 120,
        returned: "120",
        lost: "",
        quantity: ""
      }
    ]);
  });

  it("每次新建表单的 client_request_id 都不同", () => {
    expect(newDocForm("out").client_request_id).not.toBe(
      newDocForm("out").client_request_id
    );
  });
});

describe("按清单发货预填", () => {
  const line = (patch: Partial<KitFulfilmentLine>): KitFulfilmentLine => ({
    id: 1,
    sort_order: 0,
    section: "辅助设备",
    line_kind: "material",
    device_category_id: null,
    material_id: 3,
    name_text: "排泥钢管",
    spec_text: null,
    unit: "米",
    planned_qty: 100,
    source: "warehouse",
    note: null,
    material_code: "WZ-0003",
    material_name: "排泥钢管",
    material_spec: "Φ114",
    material_unit: "米",
    material_status: "active",
    material_kind: "turnover",
    category_name: null,
    spec_choices: [],
    shipped: 20,
    pending: 80,
    in_stock: 110,
    ...patch
  });

  it("只取库房发、待发大于 0 的物资行；同一物资两行合并；数量默认待发；请求体带清单", () => {
    const { form, deviceNeeds } = prefillOutFromKit({ id: 9, project_id: 7 }, [
      line({ id: 1 }),
      line({ id: 2, pending: 30, shipped: 20 }),
      line({
        id: 3,
        material_id: 4,
        material_name: "电焊条",
        material_spec: "J422",
        material_kind: "consumable",
        pending: 0
      }),
      line({
        id: 4,
        material_id: 5,
        material_name: "集装箱",
        source: "rental",
        pending: 0
      }),
      line({
        id: 5,
        line_kind: "text",
        material_id: null,
        name_text: "备忘",
        pending: 0,
        in_stock: null
      })
    ]);
    expect(form).toMatchObject({
      doc_type: "out",
      project_id: 7,
      project_kit_id: 9
    });
    expect(form.materials).toEqual([
      {
        material_id: 3,
        name: "排泥钢管",
        spec: "Φ114",
        unit: "米",
        kind: "turnover",
        available: 110,
        returned: "",
        lost: "",
        quantity: "110"
      }
    ]);
    expect(deviceNeeds).toEqual([]);
    expect(
      buildDocPayload({
        ...form,
        materials: [{ ...form.materials[0], quantity: "80" }]
      })
    ).toMatchObject({
      doc_type: "out",
      project_id: 7,
      project_kit_id: 9,
      material_lines: [{ material_id: 3, quantity: 80 }]
    });
  });

  it("设备行不预填具体设备，只按类别给出还需几台", () => {
    const { form, deviceNeeds } = prefillOutFromKit({ id: 9, project_id: 7 }, [
      line({
        id: 1,
        line_kind: "device",
        material_id: null,
        device_category_id: 2,
        category_name: "顶管机",
        spec_text: "DN1200",
        pending: 1,
        in_stock: 3
      }),
      line({
        id: 2,
        line_kind: "device",
        material_id: null,
        device_category_id: 2,
        category_name: "顶管机",
        spec_text: "DN1500",
        pending: 1,
        in_stock: 3
      }),
      line({
        id: 3,
        line_kind: "device",
        material_id: null,
        device_category_id: 5,
        category_name: "发电机",
        spec_text: null,
        pending: 0,
        in_stock: 1
      })
    ]);
    expect(form.devices).toEqual([]);
    expect(deviceNeeds).toEqual([
      {
        category_id: 2,
        category_name: "顶管机",
        spec_text: "DN1200、DN1500",
        count: 2,
        available: 3
      }
    ]);
  });

  it("没带清单的发货单请求体里没有 project_kit_id", () => {
    expect(
      buildDocPayload({ ...newDocForm("out"), project_id: 7 })
    ).not.toHaveProperty("project_kit_id");
  });
});
