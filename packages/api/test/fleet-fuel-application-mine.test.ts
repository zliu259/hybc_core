import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fleetRoutes } from "../src/routes/fleet";
import { createMigratedDatabase, createSqliteD1, hasSqlite } from "./helpers/reimbursement-harness";

// 小程序「我的车辆记录」用到的两个油卡接口：本人列表（可分页）和单张详情。
// 前半段用假 DB 看 SQL 和权限，CI 上也跑；后半段用 node:sqlite 跑真迁移，CI（Node 20）会跳过。

const mockAuth = vi.hoisted(() => ({
  payload: {
    sub: "driver-a",
    username: "driver-a",
    nickname: "Driver A",
    avatar: "",
    roles: ["operator"],
    permissions: [],
    tokenId: "token-a",
    type: "access",
    auth_method: "wecom_oauth",
    wecom_verified_at: "2026-07-01T00:00:00.000Z",
    exp: 4102444800,
    iat: 1770000000
  }
}));

vi.mock("../src/services/auth", () => ({
  verifyToken: async () => mockAuth.payload
}));

const asUser = (sub, roles = ["operator"]) => {
  mockAuth.payload = { ...mockAuth.payload, sub, roles };
};

const callFleet = (env, path) => {
  const app = new Hono();
  app.route("/fleet", fleetRoutes);
  return app.request(`/fleet${path}`, { headers: { authorization: "Bearer test-token" } }, env);
};

/** 记录每条 SQL 和绑定参数的假 D1；firstRow 决定 first() 的返回 */
const createFakeEnv = (firstRow = null) => {
  const seen = [];
  const statement = (sql, params) => ({
    bind: (...next) => statement(sql, next),
    first: async () => {
      seen.push({ sql, params, kind: "first" });
      return typeof firstRow === "function" ? firstRow(sql) : firstRow;
    },
    all: async () => {
      seen.push({ sql, params, kind: "all" });
      return { results: [] };
    },
    run: async () => ({ meta: { changes: 0 } })
  });
  return {
    seen,
    env: {
      DB: { prepare: (sql) => statement(sql, []) },
      KV: { get: async () => "session" }
    }
  };
};

beforeEach(() => {
  asUser("driver-a");
});

describe("GET /fleet/fuel-applications/:id", () => {
  it("编号不是正整数时 400，不查库", async () => {
    const { env, seen } = createFakeEnv();
    const res = await callFleet(env, "/fuel-applications/abc");
    expect(res.status).toBe(400);
    expect(seen).toHaveLength(0);
  });

  it("查不到时 404", async () => {
    const { env } = createFakeEnv(null);
    const res = await callFleet(env, "/fuel-applications/9");
    expect(res.status).toBe(404);
  });

  it("普通员工看别人的申请 403", async () => {
    const { env } = createFakeEnv({ id: 9, applicant_userid: "driver-b" });
    const res = await callFleet(env, "/fuel-applications/9");
    expect(res.status).toBe(403);
  });

  it("项目经理（site_manager）也不能看别人的申请", async () => {
    asUser("pm-a", ["site_manager"]);
    const { env } = createFakeEnv({ id: 9, applicant_userid: "driver-b" });
    const res = await callFleet(env, "/fuel-applications/9");
    expect(res.status).toBe(403);
  });

  it("本人能看自己的申请，按编号绑定参数查询", async () => {
    const { env, seen } = createFakeEnv({ id: 9, applicant_userid: "driver-a", status: "pending" });
    const res = await callFleet(env, "/fuel-applications/9");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toMatchObject({ id: 9, status: "pending" });
    expect(seen[0].sql).toContain("WHERE a.id = ?");
    expect(seen[0].params).toEqual([9]);
  });

  it("财务能看任何人的申请", async () => {
    asUser("office-a", ["finance"]);
    const { env } = createFakeEnv({ id: 9, applicant_userid: "driver-b" });
    const res = await callFleet(env, "/fuel-applications/9");
    expect(res.status).toBe(200);
  });

  it("pending-summary 不会被当成编号", async () => {
    asUser("office-a", ["finance"]);
    const { env, seen } = createFakeEnv({
      pending_count: 2,
      processed_count: 1,
      rejected_count: 0
    });
    const res = await callFleet(env, "/fuel-applications/pending-summary");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.pending_count).toBe(2);
    expect(seen[0].sql).not.toContain("WHERE a.id = ?");
  });
});

describe("GET /fleet/fuel-applications 分页", () => {
  it("不带分页参数时和原来一样整表返回，没有 LIMIT", async () => {
    const { env, seen } = createFakeEnv();
    const res = await callFleet(env, "/fuel-applications?mine=true");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pagination).toBeUndefined();
    expect(seen).toHaveLength(1);
    expect(seen[0].sql).not.toContain("LIMIT");
    expect(seen[0].params).toEqual(["driver-a"]);
  });

  it("带分页参数时按本人过滤，列表和计数用同样的条件", async () => {
    asUser("office-a", ["finance"]);
    const { env, seen } = createFakeEnv({ total: 45 });
    const res = await callFleet(
      env,
      "/fuel-applications?mine=true&status=needs_info&page=3&pageSize=20"
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pagination).toEqual({ page: 3, pageSize: 20, total: 45 });
    const count = seen.find((item) => item.kind === "first");
    const list = seen.find((item) => item.kind === "all");
    expect(count.sql).toContain("a.applicant_userid = ?");
    expect(count.params).toEqual(["office-a", "needs_info"]);
    expect(list.sql).toContain("LIMIT ? OFFSET ?");
    expect(list.params).toEqual(["office-a", "needs_info", 20, 40]);
  });

  it("普通员工不带 mine 也只能看到自己的", async () => {
    const { env, seen } = createFakeEnv({ total: 0 });
    await callFleet(env, "/fuel-applications?page=1");
    expect(seen.every((item) => item.params[0] === "driver-a")).toBe(true);
  });

  it.each(["page=0", "pageSize=101", "page=abc", "pageSize=-1"])(
    "分页参数不合法（%s）时 400",
    async (query) => {
      const { env, seen } = createFakeEnv();
      const res = await callFleet(env, `/fuel-applications?mine=true&${query}`);
      expect(res.status).toBe(400);
      expect(seen).toHaveLength(0);
    }
  );
});

describe.skipIf(!hasSqlite)("油卡申请本人记录（真实 SQL）", () => {
  const now = "2026-11-08T02:00:00.000Z";

  const seed = () => {
    const database = createMigratedDatabase();
    database
      .prepare(
        "INSERT INTO company_vehicle (id, vehicle_uuid, current_plate_no, vehicle_model, status, created_at, updated_at) VALUES (1, 'veh-1', '粤B12345', '五菱宏光', 'active', ?, ?)"
      )
      .run(now, now);
    database
      .prepare(
        "INSERT INTO fuel_card (id, card_no, latest_balance, status, created_at, updated_at) VALUES (1, 'CARD-001', 320.5, 'active', ?, ?)"
      )
      .run(now, now);
    const insertApplication = database.prepare(
      `INSERT INTO fuel_quota_application
        (application_no, applicant_userid, vehicle_id, fuel_card_id, requested_amount, vehicle_mileage_km, photo_keys_json, status, requested_at, created_at, updated_at)
       VALUES (?, ?, 1, 1, ?, ?, ?, ?, ?, ?, ?)`
    );
    insertApplication.run(
      "FQ-1",
      "driver-a",
      300,
      1000,
      '["fuel/a1.jpg"]',
      "processed",
      now,
      now,
      now
    );
    insertApplication.run("FQ-2", "driver-b", 200, 1100, null, "pending", now, now, now);
    insertApplication.run("FQ-3", "driver-a", 500, 1200, null, "needs_info", now, now, now);
    insertApplication.run("FQ-4", "driver-a", 150, 1300, null, "pending", now, now, now);
    return { env: { DB: createSqliteD1(database), KV: { get: async () => "session" } } };
  };

  it("本人列表只含自己的，最新的在前，总数正确", async () => {
    const { env } = seed();
    const res = await callFleet(env, "/fuel-applications?mine=true&page=1&pageSize=2");
    const body = await res.json();
    expect(body.pagination).toEqual({ page: 1, pageSize: 2, total: 3 });
    expect(body.data.map((item) => item.application_no)).toEqual(["FQ-4", "FQ-3"]);
    expect(body.data.every((item) => item.applicant_userid === "driver-a")).toBe(true);
  });

  it("第二页接着往下翻", async () => {
    const { env } = seed();
    const res = await callFleet(env, "/fuel-applications?mine=true&page=2&pageSize=2");
    const body = await res.json();
    expect(body.data.map((item) => item.application_no)).toEqual(["FQ-1"]);
  });

  it("详情带上车牌、车型、卡号和照片", async () => {
    const { env } = seed();
    const res = await callFleet(env, "/fuel-applications/1");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toMatchObject({
      application_no: "FQ-1",
      current_plate_no: "粤B12345",
      vehicle_model: "五菱宏光",
      card_no: "CARD-001",
      card_latest_balance: 320.5,
      photo_keys_json: '["fuel/a1.jpg"]'
    });
  });

  it("看别人的申请 403", async () => {
    const { env } = seed();
    const res = await callFleet(env, "/fuel-applications/2");
    expect(res.status).toBe(403);
  });
});
