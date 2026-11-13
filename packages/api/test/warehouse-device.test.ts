import { beforeEach, describe, expect, it, vi } from "vitest";

import { mountWarehouseRoutes } from "../src/routes/wh-app";
import {
  addDeviceNote,
  createDevice,
  getDevice,
  getDeviceByCode,
  listDevices,
  updateDevice
} from "../src/services/warehouse/device";
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

describe.skipIf(!hasSqlite)("设备台账", () => {
  let h;
  let categoryId;
  let base;

  beforeEach(() => {
    h = createWarehouseHarness();
    categoryId = h.seed.category("顶管机");
    base = {
      name: "唐兴 NSPD1200 泥水平衡顶管机",
      category_id: categoryId,
      machine_type: "泥水平衡",
      diameter_mm: 1200
    };
    authState.sub = "keeper";
    authState.roles = ["operator"];
  });

  it("不填编号时从 SB-0001 起连续生成，并写一条建档时间线", async () => {
    expect((await createDevice(h.env, base, "u1")).device_code).toBe("SB-0001");
    const second = await createDevice(h.env, base, "u1");
    expect(second.device_code).toBe("SB-0002");
    const detail = await getDevice(h.env, second.id);
    expect(detail.events.map((e) => [e.event_type, e.summary, e.operator_userid])).toEqual([
      ["created", "建档", "u1"]
    ]);
  });

  it("自带编号原样保留，重复时 409；编号生成跳过已有的最大号", async () => {
    await createDevice(h.env, { ...base, device_code: "DN1550-1" }, "u1");
    await expect(
      createDevice(h.env, { ...base, device_code: "DN1550-1" }, "u1")
    ).rejects.toMatchObject({
      status: 409,
      message: "设备编号已存在"
    });
    await createDevice(h.env, { ...base, device_code: "SB-0007" }, "u1");
    expect((await createDevice(h.env, base, "u1")).device_code).toBe("SB-0008");
  });

  const setPrefix = (id, prefix) =>
    h.database.prepare("UPDATE device_category SET code_prefix = ? WHERE id = ?").run(prefix, id);

  it("类别设了编号开头：不填编号时按这个开头排；没设的类别还是 SB", async () => {
    setPrefix(categoryId, "DG");
    const other = h.seed.category("水泵");
    expect((await createDevice(h.env, base, "u1")).device_code).toBe("DG-01");
    expect((await createDevice(h.env, base, "u1")).device_code).toBe("DG-02");
    expect((await createDevice(h.env, { ...base, category_id: other }, "u1")).device_code).toBe(
      "SB-0001"
    );
  });

  it("接着这个开头已有的最大号往下排，位数跟着已有的走", async () => {
    setPrefix(categoryId, "DG");
    const irons = h.seed.category("顶铁");
    setPrefix(irons, "DT");
    await createDevice(h.env, { ...base, device_code: "DG-033" }, "u1");
    await createDevice(h.env, { ...base, device_code: "DG-007" }, "u1");
    await createDevice(h.env, { ...base, category_id: irons, device_code: "DT-36" }, "u1");
    expect((await createDevice(h.env, base, "u1")).device_code).toBe("DG-034");
    expect((await createDevice(h.env, { ...base, category_id: irons }, "u1")).device_code).toBe(
      "DT-37"
    );
    // 超过位数就自然变长，不截断
    await createDevice(h.env, { ...base, category_id: irons, device_code: "DT-99" }, "u1");
    expect((await createDevice(h.env, { ...base, category_id: irons }, "u1")).device_code).toBe(
      "DT-100"
    );
  });

  it("别的开头的编号、开头后面不是数字的编号不影响排号", async () => {
    setPrefix(categoryId, "DG");
    await createDevice(h.env, { ...base, device_code: "DGX-050" }, "u1");
    await createDevice(h.env, { ...base, device_code: "DG-旧1" }, "u1");
    await createDevice(h.env, { ...base, device_code: "SB-0040" }, "u1");
    expect((await createDevice(h.env, base, "u1")).device_code).toBe("DG-01");
  });

  it.each([
    [{ name: "" }, "设备名称不能为空"],
    [{ category_id: 999 }, "设备类别不存在或已停用"],
    [{ diameter_mm: 1200.5 }, "口径必须是 100 到 6000 之间的整数"],
    [{ ownership: "rented" }, "所有权不对"],
    [{ purchased_date: "2026/1/1" }, "购入日期格式应为 YYYY-MM-DD"]
  ])("新建时拒绝 %j", async (patch, message) => {
    await expect(createDevice(h.env, { ...base, ...patch }, "u1")).rejects.toMatchObject({
      status: 400,
      message
    });
  });

  it("停用的类别不能用", async () => {
    h.database
      .prepare("UPDATE device_category SET status = 'disabled' WHERE id = ?")
      .run(categoryId);
    await expect(createDevice(h.env, base, "u1")).rejects.toMatchObject({
      message: "设备类别不存在或已停用"
    });
  });

  it.each([
    ["scrapped", { location: "scrapped" }, []],
    ["on_project", { location: "project", project: true }, []],
    [
      "repairing",
      {},
      [
        { kind: "maintenance", blocking: 1, status: "todo" },
        { kind: "inspection", blocking: 1, status: "todo" }
      ]
    ],
    ["pending_inspection", {}, [{ kind: "inspection", blocking: 1, status: "submitted" }]],
    ["blocked", {}, [{ kind: "other", blocking: 1, status: "todo" }]],
    [
      "available",
      {},
      [
        { kind: "inspection", blocking: 1, status: "done" },
        { kind: "servicing", blocking: 0, status: "todo" }
      ]
    ]
  ])("状态 %s", async (expected, deviceOverrides, tasks) => {
    const projectId = h.seed.project("临河 DN1200");
    const { project, ...overrides } = deviceOverrides;
    const id = h.seed.device({
      category_id: categoryId,
      ...overrides,
      ...(project ? { current_project_id: projectId } : {})
    });
    h.seed.device({ category_id: categoryId });
    for (const task of tasks) h.seed.task({ device_id: id, ...task });

    const detail = await getDevice(h.env, id);
    expect(detail.state).toBe(expected);
    expect(detail.state_label).toBe(
      {
        scrapped: "已报废",
        on_project: "在项目",
        repairing: "维修中",
        pending_inspection: "待检",
        blocked: "暂不可用",
        available: "可用"
      }[expected]
    );
    const listed = await listDevices(h.env, { state: expected });
    expect(listed.items.map((row) => row.id)).toEqual(
      expected === "available" ? expect.arrayContaining([id]) : [id]
    );
  });

  it("详情带类别名、项目名和未完成任务", async () => {
    const projectId = h.seed.project("临河 DN1200");
    const id = h.seed.device({
      category_id: categoryId,
      location: "project",
      current_project_id: projectId
    });
    h.seed.task({ device_id: id, kind: "servicing", blocking: 0, status: "todo", title: "保养" });
    h.seed.task({ device_id: id, kind: "inspection", status: "done" });
    const detail = await getDevice(h.env, id);
    expect(detail).toMatchObject({
      category_name: "顶管机",
      project_name: "临河 DN1200",
      usage_records: [],
      usage_meters_total: 0
    });
    expect(detail.open_tasks.map((t) => t.title)).toEqual(["保养"]);
  });

  it("改主数据可以，改位置被拒绝", async () => {
    const { id } = await createDevice(h.env, base, "u1");
    await updateDevice(h.env, id, { alias: "DN1200-1", remark: "新机" }, "u1");
    expect(await getDevice(h.env, id)).toMatchObject({
      alias: "DN1200-1",
      remark: "新机",
      version: 1
    });
    await updateDevice(h.env, id, { alias: null }, "u1");
    expect((await getDevice(h.env, id)).alias).toBeNull();
    for (const patch of [{ location: "warehouse" }, { current_project_id: 1 }]) {
      await expect(updateDevice(h.env, id, patch, "u1")).rejects.toMatchObject({
        status: 400,
        message: "不能直接修改设备位置"
      });
    }
  });

  it("改不存在的设备 404", async () => {
    await expect(updateDevice(h.env, 999, { alias: "x" }, "u1")).rejects.toMatchObject({
      status: 404
    });
  });

  it("按编号查，大小写和首尾空白不敏感", async () => {
    await createDevice(h.env, { ...base, device_code: "SB-0012" }, "u1");
    expect((await getDeviceByCode(h.env, " sb-0012 ")).device_code).toBe("SB-0012");
    expect(await getDeviceByCode(h.env, "SB-9999")).toBeNull();
  });

  it("列表按关键字、类别、项目筛选，并分页", async () => {
    const other = h.seed.category("发电机");
    await createDevice(h.env, { ...base, alias: "DN1200-1" }, "u1");
    await createDevice(h.env, { name: "300kW 发电机", category_id: other }, "u1");
    expect((await listDevices(h.env, { keyword: "dn1200-1" })).items.map((d) => d.alias)).toEqual([
      "DN1200-1"
    ]);
    expect(
      (await listDevices(h.env, { category_id: String(other) })).items.map((d) => d.name)
    ).toEqual(["300kW 发电机"]);
    const page = await listDevices(h.env, { page: "2", pageSize: "1" });
    expect(page).toMatchObject({ total: 2, page: 2, pageSize: 1 });
    expect(page.items).toHaveLength(1);
  });

  it("记事写进时间线", async () => {
    const { id } = await createDevice(h.env, base, "u1");
    await addDeviceNote(h.env, id, { summary: "刀盘磨损，下次进场前换" }, "u2");
    expect((await getDevice(h.env, id)).events[0]).toMatchObject({
      event_type: "note",
      summary: "刀盘磨损，下次进场前换",
      operator_userid: "u2"
    });
    await expect(addDeviceNote(h.env, id, { summary: "" }, "u2")).rejects.toMatchObject({
      status: 400
    });
  });

  it("操作员调用新建接口得到 403，库管得到 201，详情接口带状态", async () => {
    const call = (method, path, body) => callWh(h, mountWarehouseRoutes, method, path, body);
    const denied = await call("POST", "/warehouse/device", base);
    expect(denied.status).toBe(403);

    h.seed.member("keeper", "keeper");
    const created = await call("POST", "/warehouse/device", base);
    expect(created).toMatchObject({
      status: 201,
      body: { success: true, data: { device_code: "SB-0001" } }
    });

    const detail = await call("GET", `/warehouse/device/${created.body.data.id}`);
    expect(detail.body.data).toMatchObject({ state: "available", state_label: "可用" });
    const byCode = await call("GET", "/warehouse/device/by-code/SB-0001");
    expect(byCode.body.data.id).toBe(created.body.data.id);
    expect((await call("GET", "/warehouse/device/999")).status).toBe(404);

    const list = await call("GET", "/warehouse/device?pageSize=10");
    expect(list.body).toMatchObject({
      success: true,
      pagination: { page: 1, pageSize: 10, total: 1 }
    });
  });
});
