import { beforeEach, describe, expect, it, vi } from "vitest";

import { mountWarehouseRoutes } from "../src/routes/wh-app";
import { getDevice, listDevices } from "../src/services/warehouse/device";
import { getWhDoc, listWhDocs } from "../src/services/warehouse/doc-query";
import { importDevices, importMaterials } from "../src/services/warehouse/import";
import { listMaterials } from "../src/services/warehouse/material";
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

const countDevices = (database) => database.prepare("SELECT COUNT(*) AS n FROM device").get().n;

describe.skipIf(!hasSqlite)("导入", () => {
  let h;
  let projectId;

  beforeEach(() => {
    h = createWarehouseHarness();
    projectId = h.seed.project("临河 DN1200");
    authState.sub = "keeper";
    authState.roles = ["operator"];
  });

  const machine = (patch = {}) => ({
    name: "唐兴-NSPD1200泥水平衡顶管机",
    category_name: "顶管机",
    machine_type: "泥水平衡",
    diameter_mm: "1200",
    manufacturer: "唐兴",
    model: "NSPD1200",
    ...patch
  });

  const material = (patch = {}) => ({
    name: "排泥钢管",
    spec: "Φ114",
    unit: "米",
    category: "辅助设备",
    kind: "turnover",
    ...patch
  });

  it("三行里第二行缺名称、第三行口径不是整数：一行都不导入，两个错都报出来", async () => {
    const rows = [machine(), machine({ name: "" }), machine({ diameter_mm: "1200.5" })];
    const result = await importDevices(
      h.env,
      { client_request_id: "imp-dev-0001", rows },
      "keeper"
    );
    expect(result).toEqual({
      created: 0,
      opening_doc_no: null,
      errors: [
        { row: 2, message: "名称不能为空" },
        { row: 3, message: "口径必须是 100 到 6000 之间的整数" }
      ]
    });
    expect(countDevices(h.database)).toBe(0);
  });

  it("类别不存在时自动新建；填了项目名的设备直接在项目上；编号自动生成", async () => {
    const result = await importDevices(
      h.env,
      {
        client_request_id: "imp-dev-0002",
        rows: [
          machine(),
          machine({
            name: "300kW 发电机",
            category_name: "发电机",
            project_name: "临河 DN1200",
            diameter_mm: ""
          })
        ]
      },
      "keeper"
    );
    expect(result).toEqual({ created: 2, errors: [], opening_doc_no: null });
    const devices = (await listDevices(h.env, {})).items;
    expect(
      devices.map((d) => [d.device_code, d.category_name, d.location, d.current_project_id])
    ).toEqual([
      ["SB-0001", "顶管机", "warehouse", null],
      ["SB-0002", "发电机", "project", projectId]
    ]);
    expect((await getDevice(h.env, devices[0].id)).events[0]).toMatchObject({
      event_type: "created",
      summary: "导入建档"
    });
  });

  it("项目名对不上时报 找不到项目", async () => {
    const result = await importDevices(
      h.env,
      { client_request_id: "imp-dev-0003", rows: [machine({ project_name: "临河" })] },
      "keeper"
    );
    expect(result.errors).toEqual([{ row: 1, message: "找不到项目：临河" }]);
  });

  it("文件里两行编号相同，或与库里已有的相同，都报重复", async () => {
    h.seed.device({ device_code: "SB-0009" });
    const result = await importDevices(
      h.env,
      {
        client_request_id: "imp-dev-0004",
        rows: [
          machine({ device_code: "DN1550-1" }),
          machine({ device_code: "dn1550-1" }),
          machine({ device_code: "SB-0009" })
        ]
      },
      "keeper"
    );
    expect(result.errors).toEqual([
      { row: 2, message: "设备编号重复：dn1550-1" },
      { row: 3, message: "设备编号重复：SB-0009" }
    ]);
  });

  it("自动编号跳过文件里自带的 SB 编号", async () => {
    await importDevices(
      h.env,
      { client_request_id: "imp-dev-0005", rows: [machine({ device_code: "SB-0003" }), machine()] },
      "keeper"
    );
    expect((await listDevices(h.env, {})).items.map((d) => d.device_code)).toEqual([
      "SB-0003",
      "SB-0004"
    ]);
  });

  it("设备导入（不带编号）用同一个 client_request_id 重放：不会多出设备，返回相同的条数", async () => {
    const input = { client_request_id: "imp-dev-0006", rows: [machine(), machine()] };
    const first = await importDevices(h.env, input, "keeper");
    const second = await importDevices(h.env, input, "keeper");
    expect(second).toEqual({ created: first.created, errors: [], opening_doc_no: null });
    expect(countDevices(h.database)).toBe(2);
  });

  it("物资导入带期初数量：生成一张期初单，数量正确", async () => {
    const rows = [
      material({ opening_quantity: "120" }),
      material({ spec: "Φ80", opening_quantity: 30 }),
      material({ name: "卡扣", spec: "DN114", unit: "个" })
    ];
    const result = await importMaterials(
      h.env,
      { client_request_id: "imp-mat-0001", rows },
      "keeper"
    );
    expect(result).toMatchObject({
      created: 3,
      errors: [],
      opening_doc_no: expect.stringMatching(/^KFD-/)
    });
    const items = (await listMaterials(h.env, {})).items;
    expect(items.map((m) => [m.material_code, m.name, m.spec, m.quantity])).toEqual([
      ["WZ-0001", "排泥钢管", "Φ114", 120],
      ["WZ-0002", "排泥钢管", "Φ80", 30],
      ["WZ-0003", "卡扣", "DN114", 0]
    ]);
    const docs = await listWhDocs(h.env, { doc_type: "opening" });
    expect(docs.total).toBe(1);
    const doc = await getWhDoc(h.env, docs.items[0].id);
    expect(doc.lines.map((l) => [l.material_name, l.stock_delta, l.balance_after])).toEqual([
      ["排泥钢管", 120, 120],
      ["排泥钢管", 30, 30]
    ]);
  });

  it("期初数量是 '25米' 的行报错，整批不导入", async () => {
    const result = await importMaterials(
      h.env,
      {
        client_request_id: "imp-mat-0002",
        rows: [material(), material({ spec: "Φ80", opening_quantity: "25米" })]
      },
      "keeper"
    );
    expect(result.errors).toEqual([
      { row: 2, message: "期初数量必须是大于 0 的数字，最多 3 位小数" }
    ]);
    expect((await listMaterials(h.env, {})).total).toBe(0);
  });

  it("品名和规格重复时报出重复的那一行（文件内和库里）", async () => {
    h.seed.material({ name: "卡扣", spec: "DN114" });
    const result = await importMaterials(
      h.env,
      {
        client_request_id: "imp-mat-0003",
        rows: [material(), material({ spec: " Φ114 " }), material({ name: "卡扣", spec: "DN114" })]
      },
      "keeper"
    );
    expect(result.errors).toEqual([
      { row: 2, message: "品名和规格重复：排泥钢管 Φ114" },
      { row: 3, message: "品名和规格重复：卡扣 DN114" }
    ]);
  });

  it("201 行被拒绝，0 行被拒绝", async () => {
    const rows = Array.from({ length: 201 }, (_, i) => material({ spec: `S${i}` }));
    await expect(
      importMaterials(h.env, { client_request_id: "imp-mat-0004", rows }, "keeper")
    ).rejects.toMatchObject({
      status: 400,
      message: "一次最多导入 200 行"
    });
    await expect(
      importDevices(h.env, { client_request_id: "imp-dev-0007", rows: [] }, "keeper")
    ).rejects.toMatchObject({
      message: "请至少导入一行"
    });
  });

  it("物资导入带期初数量时重放：返回同一张期初单，数量不翻倍", async () => {
    const input = { client_request_id: "imp-mat-0005", rows: [material({ opening_quantity: 5 })] };
    const first = await importMaterials(h.env, input, "keeper");
    const second = await importMaterials(h.env, input, "keeper");
    expect(second).toEqual({ created: 1, errors: [], opening_doc_no: first.opening_doc_no });
    expect((await listMaterials(h.env, {})).items[0].quantity).toBe(5);
  });

  it("接口：操作员 403，库管 200", async () => {
    const call = (path, body) => callWh(h, mountWarehouseRoutes, "POST", path, body);
    expect(
      (
        await call("/warehouse/device/import", {
          client_request_id: "imp-dev-0008",
          rows: [machine()]
        })
      ).status
    ).toBe(403);
    h.seed.member("keeper", "keeper");
    const result = await call("/warehouse/material/import", {
      client_request_id: "imp-mat-0006",
      rows: [material()]
    });
    expect(result).toMatchObject({
      status: 200,
      body: { success: true, data: { created: 1, errors: [] } }
    });
  });
});
