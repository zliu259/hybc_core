import { beforeEach, describe, expect, it } from "vitest";

import { getWarehouseCapabilities } from "../src/services/warehouse/access";
import {
  createProjectKit,
  submitProjectKit,
  updateProjectKit
} from "../src/services/warehouse/kit";
import { getProjectKit, listProjectKits } from "../src/services/warehouse/kit-query";
import { createKitTemplate, updateKitTemplate } from "../src/services/warehouse/kit-template";
import { authPayload, createWarehouseHarness } from "./helpers/warehouse-harness";
import { hasSqlite } from "./helpers/sqlite-d1";

const PARAMS = {
  machine_type: "泥水平衡",
  pipe_diameter_mm: 1600,
  total_length_m: 105,
  longest_drive_m: 105,
  section_count: 1
};

// 小程序和 Web 保存清单时每行只带这十个字段
const SAVED_FIELDS = [
  "section",
  "line_kind",
  "device_category_id",
  "material_id",
  "name_text",
  "spec_text",
  "unit",
  "planned_qty",
  "source",
  "note"
];
const asSaved = (line) => Object.fromEntries(SAVED_FIELDS.map((field) => [field, line[field]]));

describe.skipIf(!hasSqlite)("按项目参数生成：创建和读回", () => {
  let h;
  let auth;
  let caps;
  let projectId;
  let templateId;

  const create = (extra = {}) =>
    createProjectKit(
      h.env,
      { project_id: projectId, title: "阳坊", template_id: templateId, ...extra },
      auth,
      caps
    );
  const rowOf = (kit, name, nth = 0) => kit.lines.filter((line) => line.name_text === name)[nth];
  const save = async (id, change) => {
    const kit = await getProjectKit(h.env, id);
    await updateProjectKit(
      h.env,
      id,
      { version: kit.version, lines: change(kit.lines.map(asSaved)) },
      auth,
      caps
    );
    return getProjectKit(h.env, id);
  };

  beforeEach(async () => {
    h = createWarehouseHarness();
    h.seed.member("kp", "keeper");
    auth = authPayload("kp", ["operator"]);
    caps = await getWarehouseCapabilities(h.env, auth);
    projectId = h.seed.project("阳坊");
    const machine = h.seed.category("顶管机");
    h.seed.device({
      device_code: "DG-012",
      name: "唐兴1600",
      category_id: machine,
      machine_type: "泥水平衡",
      diameter_mm: 1600
    });
    h.seed.material({ name: "排泥钢管", spec: "Φ114", unit: "米" });
    h.seed.material({ name: "橡套电缆", spec: "5芯10平方", unit: "米" });
    h.seed.material({ name: "橡套电缆", spec: "5芯6平方", unit: "米" });
    h.seed.material({ name: "电焊机", spec: "400A" });
    ({ id: templateId } = await createKitTemplate(
      h.env,
      {
        name: "泥水平衡 DN1200",
        machine_type: "泥水平衡",
        diameter_mm: 1200,
        lines: [
          {
            section: "顶进设备",
            line_kind: "device",
            device_category_id: machine,
            name_text: "机头泥水",
            spec_text: "DN1200",
            default_qty: 1,
            qty_per_set: true,
            role: "main_machine"
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
            qty_extra: 60
          },
          {
            section: "控制照明系统",
            line_kind: "material",
            name_text: "橡套电缆",
            spec_text: "5芯10平方",
            unit: "米",
            default_qty: 20,
            qty_basis: "per_longest_metre",
            qty_factor: 1
          },
          {
            section: "控制照明系统",
            line_kind: "material",
            name_text: "橡套电缆",
            spec_text: "5芯6平方",
            unit: "米",
            default_qty: 20,
            qty_basis: "per_longest_metre",
            qty_factor: 0.5
          },
          {
            section: "工具",
            line_kind: "material",
            name_text: "电焊机",
            spec_text: "400A",
            default_qty: 1
          }
        ]
      },
      "kp"
    ));
  });

  it("带 plan 创建：行是服务端算的，页面塞进来的行不要；参数、来源、模板版本都存下", async () => {
    const { id } = await create({
      plan: {
        params: PARAMS,
        sources: {
          pipe_diameter_mm: { from: "manual" },
          total_length_m: { from: "ai", quote: "L=105米" },
          machine_type: { from: "project" }
        }
      },
      lines: [
        { section: "x", line_kind: "material", name_text: "页面塞进来的行", planned_qty: 999 }
      ]
    });
    const kit = await getProjectKit(h.env, id);
    expect(kit.lines.map((line) => line.name_text)).toEqual([
      "机头泥水",
      "排泥钢管",
      "橡套电缆",
      "橡套电缆",
      "电焊机"
    ]);
    expect(kit.plan).toEqual({
      v: 1,
      params: { ...PARAMS, set_count: 1, soil: null, client_supplies: [] },
      sources: {
        pipe_diameter_mm: { from: "manual" },
        total_length_m: { from: "ai", quote: "L=105米" },
        machine_type: { from: "project" }
      },
      template: { id: templateId, version: 0, name: "泥水平衡 DN1200", diameter_mm: 1200 }
    });
    expect(kit).not.toHaveProperty("plan_json");
    expect(rowOf(kit, "机头泥水")).toMatchObject({
      planned_qty: 1,
      generated_qty: 1,
      calc_text: null,
      spec_text: "D1600"
    });
    expect(rowOf(kit, "排泥钢管")).toMatchObject({
      planned_qty: 270,
      generated_qty: 270,
      calc_text: "按最长一段：2 × 105 + 60 = 270"
    });
    expect(rowOf(kit, "橡套电缆", 1)).toMatchObject({
      planned_qty: 53,
      generated_qty: 53,
      calc_text: "按最长一段：0.5 × 105 = 52.5，取整 53"
    });
    expect(rowOf(kit, "电焊机")).toMatchObject({
      planned_qty: 1,
      generated_qty: 1,
      calc_text: null
    });
    // 生成时的原样只存在库里，不随详情带出去
    const stored = JSON.parse(
      h.database.prepare("SELECT plan_json FROM project_kit WHERE id = ?").get(id).plan_json
    );
    expect(stored.generated).toHaveLength(5);
    expect(stored.generated[1]).toEqual({
      section: "辅助设备",
      line_kind: "material",
      name_text: "排泥钢管",
      spec_text: "Φ114",
      qty: 270,
      calc_text: "按最长一段：2 × 105 + 60 = 270"
    });
  });

  it("库管改数量后保存（请求里不带任何新字段，小程序就是这样）：算式还在，生成时的数量不变", async () => {
    const { id } = await create({ plan: { params: PARAMS } });
    const kit = await save(id, (lines) =>
      lines.map((line) => (line.name_text === "排泥钢管" ? { ...line, planned_qty: 300 } : line))
    );
    expect(rowOf(kit, "排泥钢管")).toMatchObject({
      planned_qty: 300,
      generated_qty: 270,
      calc_text: "按最长一段：2 × 105 + 60 = 270"
    });
    expect(rowOf(kit, "橡套电缆", 0)).toMatchObject({ planned_qty: 105, generated_qty: 105 });
    expect(kit.plan.params.pipe_diameter_mm).toBe(1600);
  });

  it("加一行、删一行、同品名的两行换了顺序：其余行的算式不串", async () => {
    const { id } = await create({ plan: { params: PARAMS } });
    const kit = await save(id, (lines) => {
      const [machine, pipe, cableA, cableB, welder] = lines;
      const added = { ...welder, name_text: "新加的", material_id: null, spec_text: null };
      return [machine, added, cableB, cableA, pipe];
    });
    expect(
      kit.lines.map((line) => [line.name_text, line.spec_text, line.generated_qty, line.calc_text])
    ).toEqual([
      ["机头泥水", "D1600", 1, null],
      ["新加的", null, null, null],
      // 同品名的两行换了顺序，各自还带着自己的算式（按规格认回去）
      ["橡套电缆", "5芯6平方", 53, "按最长一段：0.5 × 105 = 52.5，取整 53"],
      ["橡套电缆", "5芯10平方", 105, "按最长一段：1 × 105 = 105"],
      ["排泥钢管", "Φ114", 270, "按最长一段：2 × 105 + 60 = 270"]
    ]);
  });

  it("生成的清单照常能提交；模板后来改了不影响已生成的清单", async () => {
    const { id } = await create({ plan: { params: PARAMS } });
    await updateKitTemplate(h.env, templateId, { version: 0, lines: [] });
    const kit = await getProjectKit(h.env, id);
    expect(kit.lines).toHaveLength(5);
    expect(rowOf(kit, "排泥钢管").calc_text).toBe("按最长一段：2 × 105 + 60 = 270");
    expect(await submitProjectKit(h.env, id, { version: kit.version }, auth, caps)).toEqual({
      status: "confirmed"
    });
  });

  it.each([
    [{ template_id: null, plan: { params: PARAMS } }, "按项目参数生成要选模板"],
    [
      { template_id: null, copy_from_kit_id: 1, plan: { params: PARAMS } },
      "按项目参数生成要选模板"
    ],
    [{ plan: { params: { pipe_diameter_mm: 99999 } } }, "管径必须是 300 到 5000 之间的整数"],
    [
      { plan: { params: PARAMS, sources: { pipe_diameter_mm: { from: "guess" } } } },
      "参数来源不对"
    ],
    [{ plan: { params: PARAMS, sources: { colour: { from: "manual" } } } }, "参数来源不对"],
    [
      { plan: { params: PARAMS, sources: { soil: { from: "ai", quote: "字".repeat(101) } } } },
      "原文片段不能超过100个字"
    ],
    [{ plan: "yes" }, "生成参数的格式不对"]
  ])("带 plan 创建被拒绝 %#", async (extra, message) => {
    await expect(create(extra)).rejects.toMatchObject({ status: 400, message });
    expect(h.database.prepare("SELECT COUNT(*) AS n FROM project_kit").get().n).toBe(0);
  });

  it("不带 plan 的清单：plan 是 null，每行的算式和生成时的数量是空的；列表不带出生成参数", async () => {
    const { id } = await create();
    const kit = await getProjectKit(h.env, id);
    expect(kit.plan).toBeNull();
    expect(kit.lines.every((line) => line.calc_text === null && line.generated_qty === null)).toBe(
      true
    );
    expect(rowOf(kit, "排泥钢管").planned_qty).toBe(120);

    await create({ plan: { params: PARAMS } });
    const list = await listProjectKits(h.env, {});
    expect(list.items).toHaveLength(2);
    expect(list.items.every((item) => !("plan_json" in item) && !("plan" in item))).toBe(true);
    expect(list.items.map((item) => item.has_plan).sort()).toEqual([false, true]);
  });

  it("plan_json 坏了（不是 JSON，或者形状不对）时读清单不报错，当作没有", async () => {
    const { id } = await create({ plan: { params: PARAMS } });
    for (const broken of ["{oops", JSON.stringify({ v: 2 }), JSON.stringify([1, 2]), "null"]) {
      h.database.prepare("UPDATE project_kit SET plan_json = ? WHERE id = ?").run(broken, id);
      const kit = await getProjectKit(h.env, id);
      expect(kit.plan).toBeNull();
      expect(kit.lines).toHaveLength(5);
      expect(kit.lines.every((line) => line.generated_qty === null)).toBe(true);
    }
  });
});
