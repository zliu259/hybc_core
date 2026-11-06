import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { contractRoutes } from "../src/routes/contract";

// 合同总览的进度分档写在 SQL 里，边界和口径只有真实 SQLite 能证明。
// CI 是 Node 20，没有 node:sqlite 时跳过；参数校验和权限由
// src/routes/contract-overview.test.ts 用假 D1 守住。

vi.mock("../src/services/auth", () => ({
  verifyToken: async () => ({
    sub: "finance-a",
    username: "finance-a",
    nickname: "Finance A",
    avatar: "",
    roles: ["finance"],
    permissions: [],
    tokenId: "token-a",
    type: "access",
    auth_method: "wecom_oauth",
    wecom_verified_at: "2026-07-01T00:00:00.000Z",
    exp: 4102444800,
    iat: 1770000000
  })
}));

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readMigration = (name) => readFileSync(resolve(apiRoot, "migrations", name), "utf8");

const sqlite = await import("node:sqlite").catch(() => null);

const createD1 = (database) => ({
  prepare(sql) {
    const statement = (params) => ({
      bind: (...next) => statement(next),
      first: async () => database.prepare(sql).get(...params) ?? null,
      all: async () => ({ results: database.prepare(sql).all(...params) }),
      run: async () => ({ meta: { changes: Number(database.prepare(sql).run(...params).changes) } })
    });
    return statement([]);
  }
});

const createDatabase = () => {
  const database = new sqlite.DatabaseSync(":memory:", { enableForeignKeyConstraints: false });
  database.exec(readMigration("0003_project.sql"));
  database.exec(readMigration("0008_contract_payment.sql"));
  database.exec("ALTER TABLE contract ADD COLUMN legacy_data_id TEXT");
  database.exec("ALTER TABLE contract ADD COLUMN legacy_project_name TEXT");
  database.exec(
    `CREATE TABLE invoice (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       contract_id INTEGER,
       status TEXT NOT NULL,
       amount REAL,
       amount_with_tax REAL
     )`
  );
  database
    .prepare(
      `INSERT INTO project (id, project_code, project_name, status, created_at, updated_at)
       VALUES (1, 'P-1', '顶管一期', 'active', '2026-01-01', '2026-01-01'),
              (2, 'P-2', '管廊二期', 'active', '2026-01-01', '2026-01-01')`
    )
    .run();
  return database;
};

let nextId = 1;

const seedContract = (database, seed) => {
  const id = nextId++;
  database
    .prepare(
      `INSERT INTO contract
         (id, contract_no, direction, project_id, entity_id, counterparty, contract_type,
          handler_userid, contract_date, total_amount, paid_amount, invoiced_amount,
          received_amount, status, remark, legacy_project_name, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, '人工', 'u1', '2026-01-01', ?, ?, 0, ?, ?, ?, ?, '2026-01-01', '2026-01-01')`
    )
    .run(
      id,
      seed.contract_no ?? `CT-${id}`,
      seed.direction ?? "outbound",
      seed.project_id ?? 1,
      seed.counterparty ?? `对方${id}`,
      seed.total_amount ?? 1000,
      seed.paid_amount ?? 0,
      seed.received_amount ?? 0,
      seed.status ?? "active",
      seed.remark ?? null,
      seed.legacy_project_name ?? null
    );
  return id;
};

const buildApp = () => {
  const app = new Hono();
  app.route("/contract", contractRoutes);
  return app;
};

describe.skipIf(!sqlite)("合同总览：真实 SQL", () => {
  let database;
  let env;

  const request = async (path) => {
    const response = await buildApp().request(
      path,
      { headers: { authorization: "Bearer test-token" } },
      env
    );
    return { status: response.status, body: await response.json() };
  };

  const bandOf = (summary, band) =>
    summary.execution.bands.find((item) => item.band === band)?.count ?? 0;

  beforeEach(() => {
    nextId = 1;
    database = createDatabase();
    env = { DB: createD1(database), KV: { get: async () => "session" } };
  });

  it("付款合同按已付比例分档，80 和 95 两个边界与原监控页一致", async () => {
    const paidByExpectedBand = [
      [799.99, "normal"],
      [800, "warning"],
      [950, "warning"],
      [950.01, "critical"],
      [999.98, "critical"],
      [1000, "settled"],
      [1000.004, "settled"],
      [1000.01, "over"]
    ];
    paidByExpectedBand.forEach(([paid_amount]) => seedContract(database, { paid_amount }));

    const { body } = await request("/contract?direction=outbound&pageSize=50");
    const bandByPaid = new Map(body.data.map((row) => [row.paid_amount, row.execution_band]));

    paidByExpectedBand.forEach(([paid, band]) => {
      expect(bandByPaid.get(paid)).toBe(band);
    });
  });

  it("总额不大于 0 的单价合同不算比例，单独成档", async () => {
    seedContract(database, { total_amount: 0, paid_amount: 500 });

    const { body } = await request("/contract?direction=outbound");

    expect(body.data[0].execution_band).toBe("unpriced");
  });

  it("收款合同按到账比例分档，不用付款阈值", async () => {
    const receivedByExpectedBand = [
      [0, "not_started"],
      [970, "collecting"],
      [1000, "settled"],
      [1200, "over"]
    ];
    receivedByExpectedBand.forEach(([received_amount]) =>
      seedContract(database, { direction: "inbound", received_amount })
    );

    const { body } = await request("/contract?direction=inbound&pageSize=50");
    const bandByReceived = new Map(
      body.data.map((row) => [row.received_amount, row.execution_band])
    );

    receivedByExpectedBand.forEach(([received, band]) => {
      expect(bandByReceived.get(received)).toBe(band);
    });
  });

  it("按档筛选能找到第一页之外的合同，且接近上限的排在前面", async () => {
    Array.from({ length: 30 }).forEach(() => seedContract(database, { paid_amount: 100 }));
    const lower = seedContract(database, { paid_amount: 810 });
    const higher = seedContract(database, { paid_amount: 940 });
    Array.from({ length: 30 }).forEach(() => seedContract(database, { paid_amount: 100 }));

    const { body } = await request("/contract?direction=outbound&band=warning&pageSize=20");

    expect(body.pagination.total).toBe(2);
    expect(body.data.map((row) => row.id)).toEqual([higher, lower]);
  });

  it("按档筛选和汇总只看在执行的合同：已终止、删除、未付款草稿都不算", async () => {
    seedContract(database, { status: "active", paid_amount: 990 });
    seedContract(database, { status: "terminated", paid_amount: 990 });
    seedContract(database, { status: "deleted", paid_amount: 990 });
    seedContract(database, { status: "pending_approval", paid_amount: 0 });
    seedContract(database, { status: "draft", paid_amount: 0 });

    const list = await request("/contract?direction=outbound&band=critical");
    const summary = await request("/contract/overview-summary?direction=outbound");

    expect(list.body.pagination.total).toBe(1);
    expect(summary.body.data.execution.count).toBe(1);
    expect(bandOf(summary.body.data, "critical")).toBe(1);
    expect(bandOf(summary.body.data, "normal")).toBe(0);
  });

  it("草稿但已经付了款的合同也算在执行，否则这种异常单会被漏掉", async () => {
    seedContract(database, { status: "draft", paid_amount: 1000 });

    const { body } = await request("/contract/overview-summary?direction=outbound");

    expect(body.data.execution.count).toBe(1);
    expect(bandOf(body.data, "settled")).toBe(1);
  });

  it("状态计数覆盖全部未删除合同，和执行范围无关", async () => {
    seedContract(database, { status: "active" });
    seedContract(database, { status: "active" });
    seedContract(database, { status: "draft" });
    seedContract(database, { status: "terminated" });
    seedContract(database, { status: "deleted" });

    const { body } = await request("/contract/overview-summary?direction=outbound");

    expect(body.data.total_count).toBe(4);
    expect(body.data.status_counts).toEqual({ active: 2, draft: 1, terminated: 1 });
  });

  it("汇总金额：超付不会把未付额抵成负数", async () => {
    seedContract(database, { total_amount: 1000, paid_amount: 400 });
    seedContract(database, { total_amount: 500, paid_amount: 700 });

    const { body } = await request("/contract/overview-summary?direction=outbound");

    expect(body.data.execution.total_amount).toBe(1500);
    expect(body.data.execution.done_amount).toBe(1100);
    expect(body.data.execution.remaining_amount).toBe(600);
    expect(body.data.execution.invoiced_amount).toBe(0);
  });

  it("收款汇总用到账额，已开票只算执行范围内合同的有效发票", async () => {
    const counted = seedContract(database, {
      direction: "inbound",
      total_amount: 1000,
      received_amount: 300,
      paid_amount: 999
    });
    const terminated = seedContract(database, {
      direction: "inbound",
      total_amount: 1000,
      status: "terminated"
    });
    const insertInvoice = database.prepare(
      "INSERT INTO invoice (contract_id, status, amount, amount_with_tax) VALUES (?, ?, ?, ?)"
    );
    insertInvoice.run(counted, "issued", 100, 113);
    insertInvoice.run(counted, "issued", 50, null);
    insertInvoice.run(counted, "deleted", 900, 900);
    insertInvoice.run(terminated, "issued", 900, 900);

    const { body } = await request("/contract/overview-summary?direction=inbound");

    expect(body.data.execution.done_amount).toBe(300);
    expect(body.data.execution.remaining_amount).toBe(700);
    expect(body.data.execution.invoiced_amount).toBe(163);
  });

  it("汇总跟随方向、项目和关键字，分别看到各自范围的数字", async () => {
    seedContract(database, { project_id: 1, counterparty: "恒越劳务", paid_amount: 900 });
    seedContract(database, { project_id: 2, counterparty: "恒越机械", paid_amount: 900 });
    seedContract(database, { project_id: 2, counterparty: "别的公司", paid_amount: 900 });
    seedContract(database, { direction: "inbound", project_id: 1, received_amount: 10 });

    const byProject = await request("/contract/overview-summary?direction=outbound&project_id=2");
    const byKeyword = await request("/contract/overview-summary?direction=outbound&keyword=恒越");
    const inbound = await request("/contract/overview-summary?direction=inbound");

    expect(byProject.body.data.execution.count).toBe(2);
    expect(byKeyword.body.data.execution.count).toBe(2);
    expect(inbound.body.data.execution.count).toBe(1);
    expect(inbound.body.data.direction).toBe("inbound");
  });

  it("列表每行带项目名，项目不存在时退回历史项目名", async () => {
    seedContract(database, { project_id: 1 });
    seedContract(database, { project_id: 9999, legacy_project_name: "旧系统项目" });

    const { body } = await request("/contract?direction=outbound");
    const names = body.data.map((row) => row.project_name).sort();

    expect(names).toEqual(["旧系统项目", "顶管一期"].sort());
  });
});
