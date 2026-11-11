import { beforeEach, describe, expect, it, vi } from "vitest";

import { mountWarehouseRoutes } from "../src/routes/wh-app";
import { createWhDoc } from "../src/services/warehouse/doc";
import { getMaterialLedger, getWhDoc, listWhDocs } from "../src/services/warehouse/doc-query";
import { getMaterial } from "../src/services/warehouse/material";
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

describe.skipIf(!hasSqlite)("库房单：期初和入库", () => {
  let h;
  let a;
  let b;

  beforeEach(() => {
    h = createWarehouseHarness();
    a = h.seed.material({ name: "排泥钢管", spec: "Φ114", quantity: 5 });
    b = h.seed.material({ name: "卡扣", spec: "DN114", quantity: 0 });
    authState.sub = "keeper";
    authState.roles = ["operator"];
    authState.authMethod = "wecom_oauth";
  });

  const inbound = (patch = {}) => ({
    doc_type: "inbound",
    client_request_id: "req-00000001",
    counterparty: "唐兴",
    material_lines: [
      { material_id: a, quantity: 2.5 },
      { material_id: b, quantity: 60 }
    ],
    ...patch
  });

  it("入库两行：数量增加，行上记录变化和余额", async () => {
    const result = await createWhDoc(h.env, inbound(), "keeper");
    expect(result).toMatchObject({
      replayed: false,
      created_task_ids: [],
      doc_no: expect.stringMatching(/^KFD-\d{8}-0001$/)
    });
    const doc = await getWhDoc(h.env, result.id);
    expect(doc).toMatchObject({
      doc_type: "inbound",
      counterparty: "唐兴",
      operator_userid: "keeper",
      line_count: 2
    });
    expect(
      doc.lines.map((l) => [
        l.material_name,
        l.stock_delta,
        l.balance_after,
        l.project_delta,
        l.outcome
      ])
    ).toEqual([
      ["排泥钢管", 2.5, 7.5, 0, "normal"],
      ["卡扣", 60, 60, 0, "normal"]
    ]);
    expect((await getMaterial(h.env, a)).quantity).toBe(7.5);
  });

  it("同一个 client_request_id 再提交：返回同一张单，数量不再变", async () => {
    const first = await createWhDoc(h.env, inbound(), "keeper");
    const second = await createWhDoc(h.env, inbound(), "keeper");
    expect(second).toMatchObject({ id: first.id, doc_no: first.doc_no, replayed: true });
    expect((await getMaterial(h.env, a)).quantity).toBe(7.5);
  });

  it("期初单同样增加数量", async () => {
    await createWhDoc(
      h.env,
      inbound({ doc_type: "opening", client_request_id: "opening-0001" }),
      "keeper"
    );
    expect((await getMaterial(h.env, b)).quantity).toBe(60);
  });

  it.each([
    [{ material_lines: [] }, "请至少添加一行"],
    [
      { material_lines: [{ material_id: 1, quantity: "25米" }] },
      "数量必须是大于 0 的数字，最多 3 位小数"
    ],
    [
      {
        material_lines: [
          { material_id: 1, quantity: 1 },
          { material_id: 1, quantity: 2 }
        ]
      },
      "同一物资在一张单里只能出现一次"
    ],
    [
      { device_lines: [{ device_id: 1 }], material_lines: [{ material_id: 1, quantity: 1 }] },
      "入库单不能包含设备"
    ],
    [{ client_request_id: "x" }, "client_request_id"],
    [{ doc_type: "adjust" }, "不能直接创建这种单据"],
    [{ doc_type: "scrap" }, "不能直接创建这种单据"],
    [{ photo_keys: ["legacy/fin/a.jpg"] }, "单据照片不对"],
    [{ material_lines: [{ material_id: 999, quantity: 1 }] }, "物资不存在"]
  ])("拒绝 %j", async (patch, message) => {
    await expect(createWhDoc(h.env, inbound(patch), "keeper")).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining(message)
    });
  });

  it("一张单最多 200 行", async () => {
    const lines = Array.from({ length: 201 }, (_, i) => ({ material_id: i + 1, quantity: 1 }));
    await expect(
      createWhDoc(h.env, inbound({ material_lines: lines }), "keeper")
    ).rejects.toMatchObject({
      message: "一张单最多 200 行"
    });
  });

  it("停用的物资不能入库，报错带品名和规格", async () => {
    h.database.prepare("UPDATE material SET status = 'disabled' WHERE id = ?").run(b);
    await expect(createWhDoc(h.env, inbound(), "keeper")).rejects.toMatchObject({
      status: 400,
      message: "物资已停用：卡扣 DN114"
    });
  });

  it("被拒绝的请求不留下任何单据和数量变化", async () => {
    h.database.prepare("UPDATE material SET status = 'disabled' WHERE id = ?").run(b);
    await createWhDoc(h.env, inbound(), "keeper").catch(() => null);
    expect(h.database.prepare("SELECT COUNT(*) AS n FROM wh_doc").get().n).toBe(0);
    expect(h.database.prepare("SELECT COUNT(*) AS n FROM wh_doc_line").get().n).toBe(0);
    expect((await getMaterial(h.env, a)).quantity).toBe(5);
  });

  it("流水按时间倒序，带单号、类型；列表能按类型和单号筛选", async () => {
    const first = await createWhDoc(
      h.env,
      inbound({ occurred_at: "2026-11-01T02:00:00.000Z" }),
      "keeper"
    );
    const second = await createWhDoc(
      h.env,
      inbound({
        client_request_id: "req-00000002",
        occurred_at: "2026-11-05T02:00:00.000Z",
        material_lines: [{ material_id: a, quantity: 1 }]
      }),
      "keeper"
    );
    const ledger = await getMaterialLedger(h.env, a, {});
    expect(
      ledger.items.map((row) => [row.doc_no, row.doc_type, row.stock_delta, row.balance_after])
    ).toEqual([
      [second.doc_no, "inbound", 1, 8.5],
      [first.doc_no, "inbound", 2.5, 7.5]
    ]);
    expect(ledger.total).toBe(2);
    const docs = await listWhDocs(h.env, { doc_type: "inbound", keyword: second.doc_no });
    expect(docs.items.map((d) => d.id)).toEqual([second.id]);
    expect((await listWhDocs(h.env, { doc_type: "out" })).total).toBe(0);
  });

  it("操作员提交得到 403；智能体令牌得到 403；库管提交得到 201", async () => {
    const call = (method, path, body) => callWh(h, mountWarehouseRoutes, method, path, body);
    expect((await call("POST", "/warehouse/doc", inbound())).status).toBe(403);
    h.seed.member("keeper", "keeper");
    authState.authMethod = "mcp_agent";
    expect((await call("POST", "/warehouse/doc", inbound())).status).toBe(403);
    authState.authMethod = "wecom_oauth";
    const created = await call("POST", "/warehouse/doc", inbound());
    expect(created).toMatchObject({
      status: 201,
      body: { success: true, data: { replayed: false } }
    });
    const replay = await call("POST", "/warehouse/doc", inbound());
    expect(replay).toMatchObject({ status: 200, body: { data: { replayed: true } } });
    const detail = await call("GET", `/warehouse/doc/${created.body.data.id}`);
    expect(detail.body.data.lines).toHaveLength(2);
    const ledger = await call("GET", `/warehouse/material/${a}/ledger`);
    expect(ledger.body).toMatchObject({ success: true, pagination: { total: 1 } });
    expect((await call("GET", "/warehouse/doc?doc_type=inbound")).body.pagination.total).toBe(1);
  });
});
