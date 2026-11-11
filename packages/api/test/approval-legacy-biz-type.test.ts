import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { approvalRoutes } from "../src/routes/approval";
import { createMigratedDatabase, createSqliteD1, hasSqlite } from "./helpers/sqlite-d1";

// 旧库房下线后（迁移 0096 删掉 stock_order 等表），历史上 biz_type 为 stock_order / warehouse_asset_work_order
// 的审批单还留在 approval_instance 里。审批的各个列表不能因为引用已删除的表而整页报错。

vi.mock("../src/services/auth", () => ({
  verifyToken: async () => ({
    sub: "u1",
    username: "u1",
    nickname: "U1",
    avatar: "",
    roles: ["super_admin"],
    permissions: [],
    tokenId: "token-u1",
    type: "access",
    auth_method: "wecom_oauth",
    wecom_verified_at: "2026-11-11T00:00:00.000Z",
    exp: 4102444800,
    iat: 1770000000
  })
}));

const NOW = "2026-11-11T00:00:00.000Z";

describe.skipIf(!hasSqlite)("审批列表里的旧库房单据", () => {
  let database;
  let env;

  const request = async (path) => {
    const app = new Hono();
    app.route("/approval", approvalRoutes);
    const response = await app.request(
      `/approval${path}`,
      { headers: { authorization: "Bearer test-token" } },
      env
    );
    return { status: response.status, body: await response.json() };
  };

  beforeEach(() => {
    database = createMigratedDatabase();
    database.exec("DROP TABLE IF EXISTS stock_order_item; DROP TABLE IF EXISTS stock_order;");
    env = { DB: createSqliteD1(database), KV: { get: async () => "session" } };

    for (const [id, bizType] of [
      [9001, "stock_order"],
      [9002, "warehouse_asset_work_order"]
    ]) {
      database
        .prepare(
          `INSERT INTO approval_instance
             (id, instance_no, template_id, biz_type, biz_id, biz_summary, initiator_userid, status,
              current_node_key, current_round, submitted_at, created_at, updated_at)
           VALUES (?, ?, 1, ?, 1, '旧库房单据', 'u1', 'in_progress', 'n1', 1, ?, ?, ?)`
        )
        .run(id, `SP-20260101-${id}`, bizType, NOW, NOW, NOW);
      database
        .prepare(
          `INSERT INTO approval_node_instance
             (id, instance_id, node_key, node_type, node_name, status, round, sort_order, created_at, updated_at)
           VALUES (?, ?, 'n1', 'sequential', '审核', 'in_progress', 1, 1, ?, ?)`
        )
        .run(id, id, NOW, NOW);
      database
        .prepare(
          `INSERT INTO approval_task (node_instance_id, instance_id, assignee_userid, round, status, created_at, updated_at)
           VALUES (?, ?, 'u1', 1, 'pending', ?, ?)`
        )
        .run(id, id, NOW, NOW);
    }
  });

  it.each(["", "/pending", "/processed", "/cc"])("GET /approval%s 照常返回", async (path) => {
    const result = await request(path);
    expect(result.status).toBe(200);
    expect(result.body.success).toBe(true);
  });

  it("待办列表里能看到这两张旧单据", async () => {
    const result = await request("/pending");
    const ids = result.body.data.map((row) => row.id ?? row.instance_id);
    expect(ids).toEqual(expect.arrayContaining([9001, 9002]));
  });
});
