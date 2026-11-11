import { beforeEach, describe, expect, it, vi } from "vitest";

import { mountWarehouseRoutes } from "../src/routes/wh-app";
import {
  createMaterial,
  getMaterial,
  listMaterials,
  MATERIAL_CATEGORIES,
  updateMaterial
} from "../src/services/warehouse/material";
import { callWh, createWarehouseHarness } from "./helpers/warehouse-harness";
import { hasSqlite } from "./helpers/sqlite-d1";

const authState = vi.hoisted(() => ({ sub: "keeper", roles: ["operator"] }));

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
    auth_method: "wecom_oauth",
    wecom_verified_at: "2026-11-11T00:00:00.000Z",
    exp: 4102444800,
    iat: 1770000000
  })
}));

describe.skipIf(!hasSqlite)("物资档案", () => {
  let h;
  const base = {
    name: "排泥钢管",
    spec: "Φ114",
    unit: "米",
    category: "辅助设备",
    kind: "turnover"
  };

  beforeEach(() => {
    h = createWarehouseHarness();
    authState.sub = "keeper";
    authState.roles = ["operator"];
  });

  it("分节是现有清单的 11 个", () => {
    expect(MATERIAL_CATEGORIES).toEqual([
      "顶进设备",
      "辅助设备",
      "注浆设备",
      "控制照明系统",
      "测量工具",
      "工具",
      "手动工具",
      "劳动保护",
      "施工消耗材料",
      "生活设施",
      "设备维修配件"
    ]);
  });

  it("编号从 WZ-0001 起，新建后数量为 0", async () => {
    const first = await createMaterial(h.env, base);
    expect(first.material_code).toBe("WZ-0001");
    expect((await createMaterial(h.env, { ...base, spec: "Φ80" })).material_code).toBe("WZ-0002");
    expect(await getMaterial(h.env, first.id)).toMatchObject({
      quantity: 0,
      spec: "Φ114",
      kind: "turnover"
    });
  });

  it("同品名同规格 409，同品名不同规格可以，规格不填存空串", async () => {
    await createMaterial(h.env, base);
    await expect(createMaterial(h.env, { ...base, spec: " Φ114 " })).rejects.toMatchObject({
      status: 409,
      message: "同品名同规格的物资已存在"
    });
    const noSpec = await createMaterial(h.env, { ...base, spec: undefined });
    expect((await getMaterial(h.env, noSpec.id)).spec).toBe("");
    await expect(createMaterial(h.env, { ...base, spec: "" })).rejects.toMatchObject({
      status: 409
    });
  });

  it.each([
    [{ category: "其他" }, "分节不对"],
    [{ kind: "按台" }, "管法不对"],
    [{ unit: "" }, "单位不能为空"],
    [{ unit_price: -1 }, "单价必须是 0 到 100000000 之间的数字"],
    [{ min_stock: "若干" }, "最低库存必须是 0 到 100000000 之间的数字"]
  ])("拒绝 %j", async (patch, message) => {
    await expect(createMaterial(h.env, { ...base, ...patch })).rejects.toMatchObject({
      status: 400,
      message
    });
  });

  it("新建和修改都不能带数量", async () => {
    await expect(createMaterial(h.env, { ...base, quantity: 5 })).rejects.toMatchObject({
      status: 400,
      message: "数量只能通过库房单修改"
    });
    const { id } = await createMaterial(h.env, base);
    await expect(updateMaterial(h.env, id, { quantity: 5 })).rejects.toMatchObject({
      message: "数量只能通过库房单修改"
    });
  });

  it("修改：只改传了的字段，可以停用，改成重复的品名规格 409", async () => {
    const { id } = await createMaterial(h.env, base);
    await createMaterial(h.env, { ...base, spec: "Φ80" });
    await updateMaterial(h.env, id, { min_stock: 50, status: "disabled" });
    expect(await getMaterial(h.env, id)).toMatchObject({
      min_stock: 50,
      status: "disabled",
      spec: "Φ114"
    });
    await expect(updateMaterial(h.env, id, { spec: "Φ80" })).rejects.toMatchObject({ status: 409 });
    await expect(updateMaterial(h.env, 999, { remark: "x" })).rejects.toMatchObject({
      status: 404
    });
  });

  it("列表：关键字、分节、管法、只看低库存", async () => {
    h.seed.material({
      name: "排泥钢管",
      spec: "Φ114",
      category: "辅助设备",
      quantity: 10,
      min_stock: 50
    });
    h.seed.material({
      name: "卡扣",
      spec: "DN114",
      category: "辅助设备",
      quantity: 100,
      min_stock: 50
    });
    h.seed.material({
      name: "电焊条",
      spec: "J422",
      category: "施工消耗材料",
      kind: "consumable",
      quantity: 0
    });
    expect((await listMaterials(h.env, { keyword: "dn114" })).items.map((m) => m.name)).toEqual([
      "卡扣"
    ]);
    expect((await listMaterials(h.env, { kind: "consumable" })).items.map((m) => m.name)).toEqual([
      "电焊条"
    ]);
    expect((await listMaterials(h.env, { category: "辅助设备" })).total).toBe(2);
    expect((await listMaterials(h.env, { low_stock: "1" })).items.map((m) => m.name)).toEqual([
      "排泥钢管"
    ]);
  });

  it("/warehouse/inventory 返回全部启用物资的数组，/alert 只返回低库存的，都带旧小程序要的兼容字段", async () => {
    const low = h.seed.material({ name: "排泥钢管", spec: "Φ114", quantity: 10, min_stock: 50 });
    h.seed.material({ name: "卡扣", spec: "", quantity: 100 });
    h.seed.material({ name: "旧物资", status: "disabled" });
    const call = (path) => callWh(h, mountWarehouseRoutes, "GET", path);

    const all = await call("/warehouse/inventory");
    expect(all.body.data.map((row) => row.name)).toEqual(["排泥钢管", "卡扣"]);
    expect(all.body.data[1]).toMatchObject({ type_name: "卡扣", status: "normal" });

    const alert = await call("/warehouse/inventory/alert");
    expect(alert.body.data).toHaveLength(1);
    expect(alert.body.data[0]).toMatchObject({
      id: low,
      warehouse_id: 1,
      warehouse_name: "库房",
      asset_type_id: low,
      type_name: "排泥钢管 Φ114",
      status: "low",
      quantity: 10
    });
  });

  it("接口：操作员不能新建，库管可以；列表带分页", async () => {
    const call = (method, path, body) => callWh(h, mountWarehouseRoutes, method, path, body);
    expect((await call("POST", "/warehouse/material", base)).status).toBe(403);
    h.seed.member("keeper", "keeper");
    const created = await call("POST", "/warehouse/material", base);
    expect(created).toMatchObject({ status: 201, body: { data: { material_code: "WZ-0001" } } });
    expect(
      (await call("PUT", `/warehouse/material/${created.body.data.id}`, { remark: "常用" })).status
    ).toBe(200);
    const list = await call("GET", "/warehouse/material");
    expect(list.body).toMatchObject({
      success: true,
      pagination: { page: 1, pageSize: 20, total: 1 }
    });
    expect(
      (await call("GET", `/warehouse/material/${created.body.data.id}`)).body.data.remark
    ).toBe("常用");
    expect((await call("GET", "/warehouse/material/999")).status).toBe(404);
  });
});
