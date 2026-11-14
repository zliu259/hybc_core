import { beforeEach, describe, expect, it, vi } from "vitest";

import { mountWarehouseRoutes } from "../src/routes/wh-app";
import {
  createKitTemplate,
  getKitTemplate,
  listKitTemplates,
  updateKitTemplate
} from "../src/services/warehouse/kit-template";
import { callWh, createWarehouseHarness } from "./helpers/warehouse-harness";
import { hasSqlite } from "./helpers/sqlite-d1";

const authState = vi.hoisted(() => ({
  sub: "keeper",
  roles: ["operator"],
  authMethod: "wecom_oauth"
}));

vi.mock("../src/services/auth", () => ({
  verifyToken: async () => ({
    sub: authState.sub,
    username: authState.sub,
    nickname: authState.sub,
    avatar: "",
    roles: authState.roles,
    permissions: [],
    tokenId: `token-${authState.sub}`,
    type: "access",
    auth_method: authState.authMethod,
    wecom_verified_at: "2026-11-11T00:00:00.000Z",
    exp: 4102444800,
    iat: 1770000000
  })
}));

describe.skipIf(!hasSqlite)("配套清单模板", () => {
  let h;
  let cat;

  beforeEach(() => {
    h = createWarehouseHarness();
    cat = h.seed.category("顶管机");
    authState.sub = "keeper";
    authState.roles = ["operator"];
    authState.authMethod = "wecom_oauth";
  });

  const countTemplates = () => h.database.prepare("SELECT COUNT(*) AS n FROM kit_template").get().n;

  it("新建模板带 3 行（设备、物资、备忘），读回来顺序和类别名都对", async () => {
    const { id } = await createKitTemplate(
      h.env,
      {
        name: "土压平衡",
        machine_type: "土压平衡",
        lines: [
          {
            section: "顶进设备",
            line_kind: "device",
            device_category_id: cat,
            name_text: "机头土压",
            unit: "台",
            default_qty: 1
          },
          {
            section: "辅助设备",
            line_kind: "material",
            name_text: "排泥钢管",
            spec_text: "Φ114",
            unit: "米",
            default_qty: 120
          },
          { section: "生活设施", line_kind: "text", name_text: "集装箱", note: "本地租" }
        ]
      },
      "keeper"
    );
    const t = await getKitTemplate(h.env, id);
    expect(t).toMatchObject({ name: "土压平衡", machine_type: "土压平衡", status: "active" });
    expect(
      t.lines.map((l) => [
        l.sort_order,
        l.line_kind,
        l.name_text,
        l.device_category_name ?? null,
        l.default_qty
      ])
    ).toEqual([
      [0, "device", "机头土压", "顶管机", 1],
      [1, "material", "排泥钢管", null, 120],
      [2, "text", "集装箱", null, null]
    ]);
    expect(await listKitTemplates(h.env, {})).toMatchObject([{ id, line_count: 3 }]);
  });

  it.each([
    [[{ section: "x", line_kind: "device", name_text: "机头" }], "第 1 行：设备行要选设备类别"],
    [
      [{ section: "x", line_kind: "device", device_category_id: 999, name_text: "机头" }],
      "第 1 行：设备类别不存在"
    ],
    [
      [
        { section: "x", line_kind: "text", name_text: "备忘" },
        {
          section: "x",
          line_kind: "device",
          device_category_id: "CAT",
          name_text: "机头",
          default_qty: 1.5
        }
      ],
      "第 2 行：设备数量必须是整数"
    ],
    [
      [{ section: "x", line_kind: "material", name_text: "管", default_qty: "25米" }],
      "第 1 行：数量"
    ],
    [[{ section: "", line_kind: "text", name_text: "管" }], "第 1 行：分节不能为空"],
    [[{ section: "x", line_kind: "tool", name_text: "管" }], "第 1 行：类型不对"],
    [
      Array.from({ length: 301 }, () => ({ section: "x", line_kind: "text", name_text: "a" })),
      "最多 300 行"
    ]
  ])("拒绝 %#", async (rawLines, message) => {
    const lines = rawLines.map((line) =>
      line.device_category_id === "CAT" ? { ...line, device_category_id: cat } : line
    );
    await expect(createKitTemplate(h.env, { name: "x", lines }, "keeper")).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining(message)
    });
    expect(countTemplates()).toBe(0);
  });

  it("名称重复 409", async () => {
    await createKitTemplate(h.env, { name: "泥水平衡" }, "keeper");
    await expect(createKitTemplate(h.env, { name: "泥水平衡" }, "keeper")).rejects.toMatchObject({
      status: 409,
      message: "模板名称已存在"
    });
  });

  it("修改：版本号不对 409；整体替换行；可以停用", async () => {
    const { id } = await createKitTemplate(
      h.env,
      { name: "泥水平衡", lines: [{ section: "x", line_kind: "text", name_text: "旧行" }] },
      "keeper"
    );
    await updateKitTemplate(h.env, id, {
      version: 0,
      remark: "李震核对过",
      lines: [
        { section: "辅助设备", line_kind: "material", name_text: "排泥钢管", default_qty: 60 },
        { section: "工具", line_kind: "material", name_text: "管钳", default_qty: 6 }
      ]
    });
    await expect(
      updateKitTemplate(h.env, id, { version: 0, status: "disabled" })
    ).rejects.toMatchObject({ status: 409, message: "数据已变化，请刷新后重试" });
    await updateKitTemplate(h.env, id, { version: 1, status: "disabled" });
    const t = await getKitTemplate(h.env, id);
    expect(t).toMatchObject({ remark: "李震核对过", status: "disabled", version: 2 });
    expect(t.lines.map((l) => l.name_text)).toEqual(["排泥钢管", "管钳"]);
    expect(await listKitTemplates(h.env, { status: "active" })).toEqual([]);
    await expect(updateKitTemplate(h.env, 999, { version: 0 })).rejects.toMatchObject({
      status: 404
    });
  });

  it("接口：库管 201；经理、操作员 403；智能体令牌 403；所有人能读", async () => {
    const call = (method, path, body) => callWh(h, mountWarehouseRoutes, method, path, body);
    const body = { name: "土压平衡", lines: [{ section: "x", line_kind: "text", name_text: "a" }] };
    expect((await call("POST", "/warehouse/kit-template", body)).status).toBe(403);
    authState.roles = ["manager"];
    expect((await call("POST", "/warehouse/kit-template", body)).status).toBe(403);
    authState.roles = ["operator"];
    h.seed.member("keeper", "keeper");
    authState.authMethod = "mcp_agent";
    expect((await call("POST", "/warehouse/kit-template", body)).status).toBe(403);
    authState.authMethod = "wecom_oauth";
    const created = await call("POST", "/warehouse/kit-template", body);
    expect(created).toMatchObject({ status: 201, body: { success: true } });
    const id = created.body.data.id;
    expect(
      (await call("PUT", `/warehouse/kit-template/${id}`, { version: 0, name: "土压" })).status
    ).toBe(200);
    authState.sub = "worker";
    const list = await call("GET", "/warehouse/kit-template");
    expect(list.body.data).toMatchObject([{ name: "土压", line_count: 1 }]);
    expect((await call("GET", `/warehouse/kit-template/${id}`)).body.data.lines).toHaveLength(1);
    expect((await call("GET", "/warehouse/kit-template/999")).status).toBe(404);
  });

  const ruleOf = (line) => [
    line.qty_basis,
    line.qty_factor,
    line.qty_extra,
    line.qty_per_set,
    line.spec_by_diameter,
    line.role
  ];

  it("规则字段和管径：存进去读得回来；不传就是固定、不勾、不标", async () => {
    const { id } = await createKitTemplate(
      h.env,
      {
        name: "泥水平衡 D1600",
        diameter_mm: 1600,
        lines: [
          {
            section: "顶进设备",
            line_kind: "device",
            device_category_id: cat,
            name_text: "机头泥水",
            default_qty: 1,
            qty_per_set: true,
            role: "main_machine"
          },
          {
            section: "辅助设备",
            line_kind: "material",
            name_text: "排泥钢管",
            unit: "米",
            default_qty: 120,
            qty_basis: "per_longest_metre",
            qty_factor: 2,
            qty_extra: 60,
            qty_per_set: 1,
            spec_by_diameter: true
          },
          { section: "工具", line_kind: "material", name_text: "电焊机", default_qty: 1 }
        ]
      },
      "keeper"
    );
    const saved = await getKitTemplate(h.env, id);
    expect(saved.diameter_mm).toBe(1600);
    expect(saved.lines.map(ruleOf)).toEqual([
      ["fixed", null, null, true, false, "main_machine"],
      ["per_longest_metre", 2, 60, true, true, null],
      ["fixed", null, null, false, false, null]
    ]);
  });

  it("修改时行整体替换：没带规则字段的行回到固定；只改名字不动管径；管径传 null 是清掉", async () => {
    const { id } = await createKitTemplate(
      h.env,
      {
        name: "甲",
        diameter_mm: 1200,
        lines: [
          {
            section: "工具",
            line_kind: "material",
            name_text: "排泥钢管",
            qty_basis: "per_section",
            qty_factor: 3
          }
        ]
      },
      "keeper"
    );
    await updateKitTemplate(h.env, id, { version: 0, name: "乙" });
    expect((await getKitTemplate(h.env, id)).diameter_mm).toBe(1200);
    expect((await getKitTemplate(h.env, id)).lines.map(ruleOf)).toEqual([
      ["per_section", 3, null, false, false, null]
    ]);
    await updateKitTemplate(h.env, id, {
      version: 1,
      diameter_mm: null,
      lines: [{ section: "工具", line_kind: "material", name_text: "排泥钢管" }]
    });
    const saved = await getKitTemplate(h.env, id);
    expect(saved.diameter_mm).toBeNull();
    expect(saved.lines.map(ruleOf)).toEqual([["fixed", null, null, false, false, null]]);
  });

  it("计算方式是固定时，带来的系数和另加不存；备忘行不存规则", async () => {
    const { id } = await createKitTemplate(
      h.env,
      {
        name: "甲",
        lines: [
          { section: "工具", line_kind: "material", name_text: "a", qty_factor: 2, qty_extra: 5 },
          {
            section: "工具",
            line_kind: "text",
            name_text: "备忘",
            qty_basis: "per_section",
            qty_factor: 2,
            qty_per_set: true,
            role: "power"
          }
        ]
      },
      "keeper"
    );
    expect((await getKitTemplate(h.env, id)).lines.map(ruleOf)).toEqual([
      ["fixed", null, null, false, false, null],
      ["fixed", null, null, false, false, null]
    ]);
  });

  it("取整到：存进去读得回来，写成字符串也认；不传是空的；固定的行不存", async () => {
    const line = (patch) => ({ section: "控制照明系统", line_kind: "material", ...patch });
    const { id } = await createKitTemplate(
      h.env,
      {
        name: "甲",
        lines: [
          line({
            name_text: "机头电缆",
            qty_basis: "per_longest_metre",
            qty_factor: 1,
            qty_extra: 10,
            qty_round_to: 50
          }),
          line({ name_text: "对丝", qty_basis: "per_section", qty_factor: 1, qty_round_to: "0.5" }),
          line({ name_text: "控制线", qty_basis: "per_longest_metre", qty_factor: 1 }),
          line({ name_text: "电焊机", qty_round_to: 50 })
        ]
      },
      "keeper"
    );
    const roundTo = async () => (await getKitTemplate(h.env, id)).lines.map((l) => l.qty_round_to);
    expect(await roundTo()).toEqual([50, 0.5, null, null]);
    // 修改时行整体替换：没带的回到空
    await updateKitTemplate(h.env, id, {
      version: 0,
      lines: [
        line({ name_text: "机头电缆", qty_basis: "per_longest_metre", qty_factor: 1 }),
        line({
          name_text: "控制线",
          qty_basis: "per_longest_metre",
          qty_factor: 1,
          qty_round_to: 100
        })
      ]
    });
    expect(await roundTo()).toEqual([null, 100]);
  });

  it.each([
    [{ qty_basis: "per_set" }, "第 1 行：计算方式不对"],
    [{ qty_basis: "per_section", qty_factor: -1 }, "第 1 行：系数必须是 0 到 1000000 之间的数字"],
    [{ qty_basis: "per_section", qty_extra: "多" }, "第 1 行：另加必须是 0 到 1000000 之间的数字"],
    [
      { qty_basis: "per_section", qty_round_to: 0 },
      "第 1 行：取整到必须是 0.001 到 1000000 之间的数字"
    ],
    [
      { qty_basis: "per_section", qty_round_to: -50 },
      "第 1 行：取整到必须是 0.001 到 1000000 之间的数字"
    ],
    [
      { qty_basis: "per_section", qty_round_to: "多" },
      "第 1 行：取整到必须是 0.001 到 1000000 之间的数字"
    ],
    [{ qty_basis: "per_section", qty_round_to: 12.3456 }, "第 1 行：取整到最多 3 位小数"],
    [{ qty_per_set: "yes" }, "第 1 行：每套一份只能是勾或不勾"],
    [{ spec_by_diameter: 2 }, "第 1 行：规格随管径只能是勾或不勾"],
    [{ role: "boss" }, "第 1 行：标记不对"]
  ])("规则字段不对时 400：%j", async (patch, message) => {
    await expect(
      createKitTemplate(
        h.env,
        {
          name: "x",
          lines: [{ section: "工具", line_kind: "material", name_text: "电焊机", ...patch }]
        },
        "keeper"
      )
    ).rejects.toMatchObject({ status: 400, message });
    expect(countTemplates()).toBe(0);
  });

  it.each([100, 5001, 1600.5, "大"])("管径 %s 不在 300 到 5000 之间时 400", async (diameter) => {
    await expect(
      createKitTemplate(h.env, { name: "x", diameter_mm: diameter }, "keeper")
    ).rejects.toMatchObject({ status: 400, message: "管径必须是 300 到 5000 之间的整数" });
  });
});
