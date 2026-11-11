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
});
