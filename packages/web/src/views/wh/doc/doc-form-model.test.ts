import { describe, expect, it } from "vitest";

import type { ProjectHoldings } from "@/api/wh/types";
import {
  buildDocPayload,
  newDocForm,
  prefillBackForm,
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
