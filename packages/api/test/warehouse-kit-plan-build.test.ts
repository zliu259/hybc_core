import { beforeEach, describe, expect, it, vi } from "vitest";

import { mountWarehouseRoutes } from "../src/routes/wh-app";
import { linesFromTemplate } from "../src/services/warehouse/kit-build";
import { buildPlan } from "../src/services/warehouse/kit-plan-build";
import { parsePlanParams } from "../src/services/warehouse/kit-plan-calc";
import { createKitTemplate, updateKitTemplate } from "../src/services/warehouse/kit-template";
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

// 设计稿第 13 节的例子：26-08 阳坊，D1600、泥水平衡、105 米、1 段，发电和住宿甲方负责。
const YANGFANG = {
  machine_type: "泥水平衡",
  pipe_diameter_mm: 1600,
  total_length_m: 105,
  longest_drive_m: 105,
  section_count: 1,
  client_supplies: ["power", "lodging"]
};

describe.skipIf(!hasSqlite)("按项目参数生成：生成器", () => {
  let h;
  let cat;
  let material;
  let templateId;

  const templateLines = () => [
    {
      section: "顶进设备",
      line_kind: "device",
      device_category_id: cat.machine,
      name_text: "机头泥水",
      spec_text: "DN1200",
      unit: "台",
      default_qty: 1,
      qty_per_set: true,
      role: "main_machine"
    },
    {
      section: "顶进设备",
      line_kind: "device",
      device_category_id: cat.pump,
      name_text: "油泵站",
      spec_text: "唐兴6组",
      unit: "套",
      default_qty: 1,
      qty_per_set: true
    },
    {
      section: "顶进设备",
      line_kind: "material",
      name_text: "护口铁",
      spec_text: "DN1200",
      unit: "个",
      default_qty: 1,
      spec_by_diameter: true
    },
    {
      section: "顶进设备",
      line_kind: "material",
      name_text: "止水圈",
      spec_text: "1200*1900",
      unit: "套",
      default_qty: 1,
      spec_by_diameter: true,
      qty_basis: "per_section",
      qty_factor: 1
    },
    {
      section: "辅助设备",
      line_kind: "device",
      device_category_id: cat.power,
      name_text: "发电机",
      spec_text: "150KW",
      unit: "台",
      role: "power"
    },
    {
      section: "辅助设备",
      line_kind: "material",
      name_text: "排泥钢管",
      spec_text: "Φ114",
      unit: "米",
      default_qty: 120,
      qty_basis: "per_longest_metre",
      qty_factor: 2,
      qty_extra: 60,
      qty_per_set: true
    },
    {
      section: "工具",
      line_kind: "material",
      name_text: "电焊机",
      spec_text: "400A",
      unit: "台",
      default_qty: 1
    },
    {
      section: "生活设施",
      line_kind: "material",
      name_text: "上下床",
      unit: "套",
      default_qty: 3,
      role: "lodging"
    }
  ];

  const plan = (params, id = templateId) => buildPlan(h.env, id, parsePlanParams(params));
  const rowOf = (result, name) => result.lines.find((line) => line.name_text === name);

  beforeEach(async () => {
    h = createWarehouseHarness();
    cat = {
      machine: h.seed.category("顶管机"),
      pump: h.seed.category("油泵站"),
      power: h.seed.category("发电机")
    };
    const device = (code, name, machineType, diameter, extra = {}) =>
      h.seed.device({
        device_code: code,
        name,
        category_id: cat.machine,
        machine_type: machineType,
        diameter_mm: diameter,
        ...extra
      });
    device("DG-012", "唐兴1600", "泥水平衡", 1600);
    device("DG-007", "伟诚1200", "泥水平衡", 1200);
    device("DG-020", "土压1600", "土压平衡", 1600);
    device("DG-030", "在外1600", "泥水平衡", 1600, {
      location: "project",
      current_project_id: h.seed.project("别的工程")
    });
    material = {
      guard1200: h.seed.material({ name: "护口铁", spec: "DN1200" }),
      guard1600: h.seed.material({ name: "护口铁", spec: "D1600" }),
      pipe114: h.seed.material({ name: "排泥钢管", spec: "Φ114", unit: "米" }),
      seal1200: h.seed.material({ name: "止水圈", spec: "1200*1900" }),
      seal600: h.seed.material({ name: "止水圈", spec: "DN600*1400" }),
      welder: h.seed.material({ name: "电焊机", spec: "400A" }),
      bunk: h.seed.material({ name: "上下床", spec: "" })
    };
    ({ id: templateId } = await createKitTemplate(
      h.env,
      {
        name: "泥水平衡 DN1200",
        machine_type: "泥水平衡",
        diameter_mm: 1200,
        lines: templateLines()
      },
      "keeper"
    ));
    h.seed.member("keeper", "keeper");
    authState.sub = "keeper";
    authState.roles = ["operator"];
  });

  it("阳坊的例子：D1600、泥水平衡、105 米、1 段、甲方提供发电和住宿", async () => {
    const result = await plan(YANGFANG);
    expect(result.template).toEqual({
      id: templateId,
      version: 0,
      name: "泥水平衡 DN1200",
      diameter_mm: 1200
    });
    expect(rowOf(result, "机头泥水")).toMatchObject({
      qty: 1,
      spec_text: "D1600",
      source: "warehouse",
      calc_text: null,
      note: "生成时在库：DG-012 唐兴1600（1600）、DG-007 伟诚1200（1200）；模板规格：DN1200"
    });
    expect(result.devices).toEqual([
      {
        name_text: "机头泥水",
        qty: 1,
        candidates: [
          { device_code: "DG-012", name: "唐兴1600", diameter_mm: 1600 },
          { device_code: "DG-007", name: "伟诚1200", diameter_mm: 1200 }
        ]
      },
      { name_text: "油泵站", qty: 1, candidates: [] },
      { name_text: "发电机", qty: 0, candidates: [] }
    ]);
    expect(rowOf(result, "护口铁")).toMatchObject({
      material_id: material.guard1600,
      spec_text: "D1600",
      needs_spec: false,
      material_label: "护口铁 D1600"
    });
    expect(rowOf(result, "止水圈")).toMatchObject({
      material_id: null,
      spec_text: null,
      needs_spec: true,
      qty: 1,
      calc_text: "按段：1 × 1 = 1",
      note: "模板规格：1200*1900"
    });
    expect(rowOf(result, "发电机")).toMatchObject({
      source: "on_site",
      qty: 0,
      spec_text: "150KW"
    });
    expect(rowOf(result, "上下床")).toMatchObject({
      source: "on_site",
      qty: 3,
      material_id: material.bunk
    });
    expect(rowOf(result, "排泥钢管")).toMatchObject({
      qty: 270,
      calc_text: "按最长一段：2 × 105 + 60 = 270",
      material_id: material.pipe114,
      spec_text: "Φ114"
    });
    expect(rowOf(result, "电焊机")).toMatchObject({
      qty: 1,
      calc_text: null,
      source: "warehouse",
      material_id: material.welder
    });
    expect(result.lines.map((line) => line.sort_order)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(result.warnings).toEqual(["模板是 DN1200，本项目 D1600", "1 行要重新选规格"]);
  });

  it("套数 2：勾了每套一份的翻倍，没勾的不变；甲方不提供时来源都是库房发", async () => {
    const result = await plan({ ...YANGFANG, set_count: 2, client_supplies: [] });
    expect(
      Object.fromEntries(result.lines.map((line) => [line.name_text, line.qty]))
    ).toMatchObject({ 机头泥水: 2, 油泵站: 2, 排泥钢管: 540, 止水圈: 1, 电焊机: 1, 上下床: 3 });
    expect(rowOf(result, "机头泥水").calc_text).toBe("每套一份：1 × 2 = 2");
    expect(result.lines.every((line) => line.source === "warehouse")).toBe(true);
  });

  it("缺最长一段和段数：用到它们的行退回默认数量，提醒里写明各几行", async () => {
    const result = await plan({
      machine_type: "泥水平衡",
      pipe_diameter_mm: 1200,
      total_length_m: 105
    });
    expect(rowOf(result, "排泥钢管")).toMatchObject({
      qty: 120,
      calc_text: "缺最长一段，用模板默认数量"
    });
    expect(rowOf(result, "止水圈")).toMatchObject({ qty: 1, calc_text: "缺段数，用模板默认数量" });
    expect(result.warnings).toEqual([
      "缺最长一段，1 行用了模板默认数量",
      "缺段数，1 行用了模板默认数量"
    ]);
  });

  it("管径和模板相同：规格随管径的行照模板找物资，没有管径不同的提醒", async () => {
    const result = await plan({ ...YANGFANG, pipe_diameter_mm: 1200 });
    expect(rowOf(result, "护口铁")).toMatchObject({
      material_id: material.guard1200,
      spec_text: "DN1200",
      needs_spec: false
    });
    expect(rowOf(result, "止水圈")).toMatchObject({
      material_id: material.seal1200,
      spec_text: "1200*1900",
      note: null
    });
    expect(rowOf(result, "机头泥水")).toMatchObject({
      spec_text: "D1200",
      note: "生成时在库：DG-007 伟诚1200（1200）、DG-012 唐兴1600（1600）；模板规格：DN1200"
    });
    expect(result.warnings).toEqual([]);
  });

  it("不填管径和机型：机头规格不改，候选不限机型按口径从小到大，规格随管径的行照模板找物资", async () => {
    const result = await plan({ total_length_m: 105, longest_drive_m: 105, section_count: 1 });
    expect(rowOf(result, "机头泥水")).toMatchObject({
      spec_text: "DN1200",
      note: "生成时在库：DG-007 伟诚1200（1200）、DG-012 唐兴1600（1600）、DG-020 土压1600（1600）"
    });
    expect(rowOf(result, "护口铁").material_id).toBe(material.guard1200);
    expect(result.warnings).toEqual([]);
  });

  it("模板没填管径：规格随管径的行一律按不同处理，但不出现「模板是 DN…」这一句", async () => {
    await updateKitTemplate(h.env, templateId, { version: 0, diameter_mm: null });
    const same = await plan({ ...YANGFANG, pipe_diameter_mm: 1200 });
    // 档案里规格含 1200 的各只有一条，都能选上
    expect(rowOf(same, "护口铁").material_id).toBe(material.guard1200);
    expect(rowOf(same, "止水圈")).toMatchObject({
      material_id: material.seal1200,
      spec_text: "1200*1900"
    });
    expect(same.warnings).toEqual([]);

    const other = await plan(YANGFANG);
    expect(rowOf(other, "止水圈")).toMatchObject({ material_id: null, needs_spec: true });
    expect(other.warnings).toEqual(["1 行要重新选规格"]);
  });

  it("规格里的数字要整段相同才算：D16000 不算 1600", async () => {
    h.database.prepare("UPDATE material SET spec = 'D16000' WHERE id = ?").run(material.guard1600);
    expect(rowOf(await plan(YANGFANG), "护口铁")).toMatchObject({
      material_id: null,
      needs_spec: true,
      note: "模板规格：DN1200"
    });
  });

  it("同品名含这个管径的物资有两条时不替人选", async () => {
    h.seed.material({ name: "护口铁", spec: "1600 加厚" });
    expect(rowOf(await plan(YANGFANG), "护口铁")).toMatchObject({
      material_id: null,
      needs_spec: true
    });
  });

  it("一条规则都没配的模板：结果和选模板逐行相同，并提醒", async () => {
    const plain = templateLines().map((line) => ({
      section: line.section,
      line_kind: line.line_kind,
      device_category_id: line.device_category_id,
      name_text: line.name_text,
      spec_text: line.spec_text,
      unit: line.unit,
      default_qty: line.default_qty,
      note: "原来的备注"
    }));
    const { id } = await createKitTemplate(
      h.env,
      { name: "没配规则", machine_type: "泥水平衡", diameter_mm: 1200, lines: plain },
      "keeper"
    );
    const result = await plan({ ...YANGFANG, set_count: 2 }, id);
    const strip = ({ calc_text, needs_spec, material_label, ...line }) => line;
    expect(result.lines.map(strip)).toEqual(await linesFromTemplate(h.env, id));
    expect(result.lines.every((line) => line.calc_text === null)).toBe(true);
    expect(result.warnings).toEqual([
      "模板是 DN1200，本项目 D1600",
      "这个模板还没配计算规则，数量都是模板默认数量"
    ]);
  });

  it("没填系数的行退回默认数量，并提醒", async () => {
    const { id } = await createKitTemplate(
      h.env,
      {
        name: "漏了系数",
        lines: [
          {
            section: "辅助设备",
            line_kind: "material",
            name_text: "排泥钢管",
            spec_text: "Φ114",
            default_qty: 120,
            qty_basis: "per_longest_metre"
          }
        ]
      },
      "keeper"
    );
    const result = await plan({ longest_drive_m: 105 }, id);
    expect(result.lines[0]).toMatchObject({ qty: 120, calc_text: "没填系数，用模板默认数量" });
    expect(result.warnings).toEqual(["1 行没填系数，用了模板默认数量"]);
  });

  it("设备行的数量总是整数；备忘行不算、数量 0", async () => {
    const { id } = await createKitTemplate(
      h.env,
      {
        name: "小数",
        lines: [
          {
            section: "辅助设备",
            line_kind: "device",
            device_category_id: cat.pump,
            name_text: "泥浆泵",
            qty_basis: "per_section",
            qty_factor: 0.5,
            qty_extra: 0.5
          },
          { section: "设备维修配件", line_kind: "text", name_text: "水泵配件", default_qty: 2 }
        ]
      },
      "keeper"
    );
    const result = await plan({ section_count: 3 }, id);
    expect(result.lines.map((line) => [line.name_text, line.qty, line.calc_text])).toEqual([
      ["泥浆泵", 3, "按段：0.5 × 3 = 1.5，取整 2，另加 0.5，共 2.5，设备取整 3"],
      ["水泵配件", 0, null]
    ]);
  });

  it("停用的物资不会被选上；模板不存在或停用 400", async () => {
    h.database
      .prepare("UPDATE material SET status = 'disabled' WHERE id = ?")
      .run(material.guard1600);
    expect(rowOf(await plan(YANGFANG), "护口铁")).toMatchObject({ material_id: null });
    await expect(plan(YANGFANG, 999)).rejects.toMatchObject({ status: 400, message: "模板不存在" });
    await updateKitTemplate(h.env, templateId, { version: 0, status: "disabled" });
    await expect(plan(YANGFANG)).rejects.toMatchObject({ status: 400, message: "模板已停用" });
  });

  it("库里没有合适的设备时备注里说明；候选最多 5 台", async () => {
    const none = await plan({ ...YANGFANG, machine_type: "岩石破碎" });
    expect(rowOf(none, "机头泥水").note).toBe("生成时库里没有同机型的在库设备；模板规格：DN1200");
    expect(none.devices[0].candidates).toEqual([]);
    for (let i = 0; i < 6; i += 1) {
      h.seed.device({
        device_code: `DG-1${i}0`,
        name: `多${i}`,
        category_id: cat.machine,
        machine_type: "泥水平衡",
        diameter_mm: 1600
      });
    }
    const many = await plan(YANGFANG);
    expect(many.devices[0].candidates).toHaveLength(5);
    expect(many.devices[0].candidates.every((device) => device.diameter_mm === 1600)).toBe(true);
  });

  it("候选设备写进备注时不超过 200 字，模板原来的备注接在后面", async () => {
    // 一台就占 150 多个字，第二台放不下
    const longName = "很长的设备名称".repeat(20);
    h.database.prepare("UPDATE device SET name = ? WHERE device_code = 'DG-012'").run(longName);
    h.database.prepare("UPDATE device SET name = ? WHERE device_code = 'DG-007'").run(longName);
    const lines = templateLines();
    await updateKitTemplate(h.env, templateId, {
      version: 0,
      lines: [{ ...lines[0], note: "带备用刀盘" }, ...lines.slice(1)]
    });
    const note = rowOf(await plan(YANGFANG), "机头泥水").note;
    expect(note.length).toBeLessThanOrEqual(200);
    expect(note.startsWith(`生成时在库：DG-012 ${longName}（1600）`)).toBe(true);
    expect(note.endsWith("；带备用刀盘；模板规格：DN1200")).toBe(true);
    expect(note).not.toContain("DG-007");
  });

  describe("预览接口", () => {
    const preview = (body) =>
      callWh(h, mountWarehouseRoutes, "POST", "/warehouse/kit/plan/preview", body);
    const countKits = () => h.database.prepare("SELECT COUNT(*) AS n FROM project_kit").get().n;

    it("返回算好的行、主要设备和提醒；不写库", async () => {
      const projectId = h.seed.project("阳坊");
      const result = await preview({
        project_id: projectId,
        template_id: templateId,
        params: YANGFANG
      });
      expect(result.status).toBe(200);
      expect(result.body.data.lines).toHaveLength(8);
      expect(result.body.data.devices[0].candidates).toHaveLength(2);
      expect(result.body.data.warnings).toEqual([
        "模板是 DN1200，本项目 D1600",
        "1 行要重新选规格"
      ]);
      expect(countKits()).toBe(0);
    });

    it("现场负责人对别人的项目 403；没有建清单权限的 403", async () => {
      const mine = h.seed.project("我的", "lead");
      const theirs = h.seed.project("别人的", "someone");
      authState.sub = "lead";
      authState.roles = ["site_manager"];
      expect(
        (await preview({ project_id: mine, template_id: templateId, params: YANGFANG })).status
      ).toBe(200);
      expect(
        await preview({ project_id: theirs, template_id: templateId, params: YANGFANG })
      ).toEqual({
        status: 403,
        body: { success: false, error: { message: "只能给自己负责的项目建清单" } }
      });
      authState.sub = "op";
      authState.roles = ["operator"];
      expect(
        (await preview({ project_id: mine, template_id: templateId, params: YANGFANG })).status
      ).toBe(403);
    });

    it("参数不对、没选项目、没选模板 400", async () => {
      const projectId = h.seed.project("阳坊");
      expect(
        await preview({
          project_id: projectId,
          template_id: templateId,
          params: { pipe_diameter_mm: 99999 }
        })
      ).toEqual({
        status: 400,
        body: { success: false, error: { message: "管径必须是 300 到 5000 之间的整数" } }
      });
      expect((await preview({ template_id: templateId, params: {} })).status).toBe(400);
      expect((await preview({ project_id: projectId, params: {} })).status).toBe(400);
    });
  });
});
