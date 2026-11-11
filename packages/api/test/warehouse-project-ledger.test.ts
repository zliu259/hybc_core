import { beforeEach, describe, expect, it, vi } from "vitest";

import { mountWarehouseRoutes } from "../src/routes/wh-app";
import { createWhDoc } from "../src/services/warehouse/doc";
import { reverseWhDoc } from "../src/services/warehouse/doc-reverse";
import { closeProjectKit } from "../src/services/warehouse/kit";
import { getKitFulfilment, getProjectLedger } from "../src/services/warehouse/project-ledger";
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

describe.skipIf(!hasSqlite)("清单执行情况和项目物资", () => {
  let h;
  let p;
  let q;
  let pipe;
  let rod;
  let rope;
  let category;
  let d1;
  let d2;
  let seq = 0;

  beforeEach(() => {
    h = createWarehouseHarness();
    p = h.seed.project("临河 DN1200");
    q = h.seed.project("安定 DN600");
    pipe = h.seed.material({
      name: "排泥钢管",
      spec: "Φ114",
      unit: "米",
      quantity: 500,
      unit_price: 30
    });
    rod = h.seed.material({ name: "电焊条", spec: "J422", kind: "consumable", quantity: 100 });
    rope = h.seed.material({ name: "吊装链", spec: "5T", quantity: 50 });
    category = h.seed.category("顶管机");
    d1 = h.seed.device({ device_code: "SB-0001", category_id: category });
    d2 = h.seed.device({ device_code: "SB-0002", category_id: category });
    h.seed.member("keeper", "keeper");
    authState.sub = "keeper";
    authState.roles = ["operator"];
  });

  const rid = () => `req-ledger-${String((seq += 1)).padStart(4, "0")}`;
  const doc = (input) => createWhDoc(h.env, { client_request_id: rid(), ...input }, "keeper");
  const out = (projectId, materialLines = [], deviceLines = [], extra = {}) =>
    doc({
      doc_type: "out",
      project_id: projectId,
      material_lines: materialLines,
      device_lines: deviceLines,
      ...extra
    });
  const reverse = (docId) => reverseWhDoc(h.env, docId, { client_request_id: rid() }, "keeper");
  const lineOf = async (kitId, name) =>
    (await getKitFulfilment(h.env, kitId)).find((line) => line.name_text === name);
  const ledgerRow = async (projectId, materialId) =>
    (await getProjectLedger(h.env, projectId)).materials.find((m) => m.material_id === materialId);

  it("主清单和追加清单都写了排泥钢管：计划相加，已发按确认先后分", async () => {
    const a = h.seed.kit({ project_id: p, confirmed_at: "2026-11-01T00:00:00.000Z" }, [
      { material_id: pipe, name_text: "排泥钢管", planned_qty: 100 }
    ]);
    const b = h.seed.kit({ project_id: p, confirmed_at: "2026-11-05T00:00:00.000Z" }, [
      { material_id: pipe, name_text: "排泥钢管", planned_qty: 50 }
    ]);
    await out(p, [{ material_id: pipe, quantity: 120 }]);
    expect(await lineOf(a, "排泥钢管")).toMatchObject({ shipped: 100, pending: 0, in_stock: 380 });
    expect(await lineOf(b, "排泥钢管")).toMatchObject({ shipped: 20, pending: 30 });
    expect(await ledgerRow(p, pipe)).toMatchObject({ planned: 150, shipped: 120, on_site: 120 });
  });

  it("作废的清单（没确认就关掉）不参与分摊，也不算计划", async () => {
    const discarded = h.seed.kit(
      {
        project_id: p,
        status: "closed",
        confirmed_at: null,
        confirmed_by_userid: null,
        close_reason: "建错了"
      },
      [{ material_id: pipe, name_text: "排泥钢管", planned_qty: 100 }]
    );
    const b = h.seed.kit({ project_id: p }, [
      { material_id: pipe, name_text: "排泥钢管", planned_qty: 100 }
    ]);
    await out(p, [{ material_id: pipe, quantity: 100 }]);
    expect(await lineOf(b, "排泥钢管")).toMatchObject({ shipped: 100, pending: 0 });
    expect(await lineOf(discarded, "排泥钢管")).toMatchObject({ shipped: 0, pending: 0 });
    expect(await ledgerRow(p, pipe)).toMatchObject({ planned: 100, shipped: 100 });
  });

  it("发货单冲销后，已发减少，待发恢复", async () => {
    const a = h.seed.kit({ project_id: p }, [
      { material_id: pipe, name_text: "排泥钢管", planned_qty: 100 }
    ]);
    const shipped = await out(p, [{ material_id: pipe, quantity: 60 }]);
    expect(await lineOf(a, "排泥钢管")).toMatchObject({ shipped: 60, pending: 40 });
    await reverse(shipped.id);
    expect(await lineOf(a, "排泥钢管")).toMatchObject({ shipped: 0, pending: 100 });
    expect(await ledgerRow(p, pipe)).toMatchObject({ shipped: 0, on_site: 0 });
  });

  it("没有清单直接发的货也算进已发；草稿清单不分", async () => {
    const a = h.seed.kit({ project_id: p }, [
      { material_id: pipe, name_text: "排泥钢管", planned_qty: 100 }
    ]);
    const draft = h.seed.kit({ project_id: p, status: "draft", confirmed_at: null }, [
      { material_id: pipe, name_text: "排泥钢管", planned_qty: 30 }
    ]);
    await out(p, [{ material_id: pipe, quantity: 40 }]);
    expect(await lineOf(a, "排泥钢管")).toMatchObject({ shipped: 40, pending: 60 });
    expect(await lineOf(draft, "排泥钢管")).toMatchObject({ shipped: 0, pending: 30 });
    expect(await ledgerRow(p, pipe)).toMatchObject({ planned: 100 });
  });

  it("其他来源和备忘行不参与分摊", async () => {
    const a = h.seed.kit({ project_id: p }, [
      { material_id: pipe, name_text: "排泥钢管", planned_qty: 100, source: "site_purchase" },
      { line_kind: "text", name_text: "集装箱", planned_qty: 1 }
    ]);
    await out(p, [{ material_id: pipe, quantity: 40 }]);
    expect(await lineOf(a, "排泥钢管")).toMatchObject({ shipped: 0, pending: 0 });
    expect(await lineOf(a, "集装箱")).toMatchObject({ shipped: 0, pending: 0, in_stock: null });
    expect(await ledgerRow(p, pipe)).toMatchObject({ planned: 0, shipped: 40 });
  });

  it("设备行：清单要 2 台顶管机，发了 1 台再转进来 1 台，已发 2；冲销转场后已发 1", async () => {
    const a = h.seed.kit({ project_id: p }, [
      { line_kind: "device", device_category_id: category, name_text: "机头", planned_qty: 2 }
    ]);
    await out(p, [], [{ device_id: d1 }]);
    await out(q, [], [{ device_id: d2 }]);
    const moved = await doc({
      doc_type: "transfer",
      project_id: q,
      to_project_id: p,
      device_lines: [{ device_id: d2 }]
    });
    expect(await lineOf(a, "机头")).toMatchObject({ shipped: 2, pending: 0, in_stock: 0 });
    await reverse(moved.id);
    expect(await lineOf(a, "机头")).toMatchObject({ shipped: 1, pending: 1 });
    const ledger = await getProjectLedger(h.env, p);
    expect(ledger.device_categories).toEqual([
      { device_category_id: category, category_name: "顶管机", planned: 2, shipped: 1, on_site: 1 }
    ]);
    expect(ledger.devices.map((d) => d.device_code)).toEqual(["SB-0001"]);
  });

  it("返库退回 90、报损 10：报损金额 = 10 × 单价；没单价的报损金额为 null", async () => {
    await out(p, [
      { material_id: pipe, quantity: 100 },
      { material_id: rope, quantity: 8 }
    ]);
    await doc({
      doc_type: "back",
      project_id: p,
      material_lines: [
        { material_id: pipe, quantity: 90, outcome: "returned" },
        { material_id: pipe, quantity: 10, outcome: "lost" },
        { material_id: rope, quantity: 8, outcome: "lost" }
      ]
    });
    expect(await ledgerRow(p, pipe)).toMatchObject({
      shipped: 100,
      returned: 90,
      lost: 10,
      on_site: 0,
      unit_price: 30,
      loss_amount: 300
    });
    expect(await ledgerRow(p, rope)).toMatchObject({ lost: 8, loss_amount: null });
  });

  it("消耗类：发出 20，退回 5：在场为 null，不影响结清", async () => {
    await out(p, [{ material_id: rod, quantity: 20 }]);
    await doc({
      doc_type: "back",
      project_id: p,
      material_lines: [{ material_id: rod, quantity: 5, outcome: "returned" }]
    });
    expect(await ledgerRow(p, rod)).toMatchObject({
      kind: "consumable",
      shipped: 20,
      returned: 5,
      lost: 0,
      on_site: null
    });
    expect((await getProjectLedger(h.env, p)).settled).toBe(true);
  });

  it("转场：来源项目记转出，目的项目记已发；两边在场数对", async () => {
    await out(p, [{ material_id: pipe, quantity: 50 }]);
    await doc({
      doc_type: "transfer",
      project_id: p,
      to_project_id: q,
      material_lines: [{ material_id: pipe, quantity: 20 }]
    });
    expect(await ledgerRow(p, pipe)).toMatchObject({
      shipped: 50,
      transferred_out: 20,
      on_site: 30
    });
    expect(await ledgerRow(q, pipe)).toMatchObject({
      shipped: 20,
      transferred_out: 0,
      on_site: 20
    });
  });

  it("结清：还有东西在场时关闭清单 409 并说明数量；全部返库后可以关闭", async () => {
    const a = h.seed.kit({ project_id: p });
    await out(p, [{ material_id: pipe, quantity: 30 }], [{ device_id: d1 }]);
    const before = await getProjectLedger(h.env, p);
    expect(before).toMatchObject({ settled: false, devices_on_site: 1, turnover_kinds_on_site: 1 });
    await expect(closeProjectKit(h.env, a, { version: 0 }, "keeper")).rejects.toMatchObject({
      status: 409,
      message: "项目还有 1 台设备、1 种周转件在场，结清后才能关闭"
    });
    await doc({
      doc_type: "back",
      project_id: p,
      device_lines: [{ device_id: d1 }],
      material_lines: [{ material_id: pipe, quantity: 30, outcome: "returned" }]
    });
    expect((await getProjectLedger(h.env, p)).settled).toBe(true);
    await closeProjectKit(h.env, a, { version: 0 }, "keeper");
    expect((await getProjectLedger(h.env, p)).kits[0]).toMatchObject({
      status: "closed",
      closed_by_userid: "keeper"
    });
    await expect(closeProjectKit(h.env, a, { version: 1 }, "keeper")).rejects.toMatchObject({
      status: 409,
      message: "清单已关闭"
    });
  });

  it("只有已确认的清单能关闭", async () => {
    const draft = h.seed.kit({ project_id: p, status: "draft", confirmed_at: null });
    await expect(closeProjectKit(h.env, draft, { version: 0 }, "keeper")).rejects.toMatchObject({
      status: 409,
      message: "清单还没确认，不需要关闭；不要了可以作废"
    });
  });

  it("首次出库和最后退库日期不看冲销的单", async () => {
    const early = await out(p, [{ material_id: pipe, quantity: 5 }], [], {
      occurred_at: "2026-11-02T02:00:00.000Z"
    });
    await reverse(early.id);
    await out(p, [{ material_id: pipe, quantity: 5 }], [], {
      occurred_at: "2026-11-05T02:00:00.000Z"
    });
    await doc({
      doc_type: "back",
      project_id: p,
      occurred_at: "2026-11-08T02:00:00.000Z",
      material_lines: [{ material_id: pipe, quantity: 5, outcome: "returned" }]
    });
    expect(await ledgerRow(p, pipe)).toMatchObject({
      first_out_at: "2026-11-05T02:00:00.000Z",
      last_back_at: "2026-11-08T02:00:00.000Z"
    });
  });

  it("接口：所有角色能看项目物资和执行情况；关闭只有库管", async () => {
    const call = (method, path, body) => callWh(h, mountWarehouseRoutes, method, path, body);
    const a = h.seed.kit({ project_id: p }, [
      { material_id: pipe, name_text: "排泥钢管", planned_qty: 10 }
    ]);
    authState.sub = "worker";
    const ledger = await call("GET", `/warehouse/project/${p}/ledger`);
    expect(ledger).toMatchObject({
      status: 200,
      body: { data: { project_name: "临河 DN1200", settled: true } }
    });
    const fulfilment = await call("GET", `/warehouse/kit/${a}/fulfilment`);
    expect(fulfilment.body.data).toMatchObject([{ name_text: "排泥钢管", pending: 10 }]);
    authState.roles = ["manager"];
    expect((await call("POST", `/warehouse/kit/${a}/close`, { version: 0 })).status).toBe(403);
    authState.sub = "keeper";
    authState.roles = ["operator"];
    expect((await call("POST", `/warehouse/kit/${a}/close`, { version: 0 })).status).toBe(200);
    expect((await call("GET", "/warehouse/project/999/ledger")).status).toBe(404);
    expect((await call("GET", "/warehouse/kit/999/fulfilment")).status).toBe(404);
  });
});
