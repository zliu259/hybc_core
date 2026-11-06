import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { approvalRoutes } from "../src/routes/approval";

// 审批监控和小程序流程查询共用的列表。子查询只有真实 SQLite 能证明，CI 的 Node 20 没有 node:sqlite 时跳过。

const authState = vi.hoisted(() => ({ roles: ["super_admin"] }));

vi.mock("../src/services/auth", () => ({
  verifyToken: async () => ({
    sub: "admin-a",
    username: "admin-a",
    nickname: "Admin",
    avatar: "",
    roles: authState.roles,
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

const NOW = "2026-11-06T00:00:00.000Z";

describe.skipIf(!sqlite)("GET /approval/admin/all", () => {
  let database;
  let env;

  const request = async (query = "") => {
    const app = new Hono();
    app.route("/approval", approvalRoutes);
    const response = await app.request(
      `/approval/admin/all${query}`,
      { headers: { authorization: "Bearer test-token" } },
      env
    );
    return { status: response.status, body: await response.json() };
  };

  const seedInstance = (id, patch = {}) => {
    const row = {
      instance_no: `SP-20261106-${String(id).padStart(4, "0")}`,
      biz_summary: `摘要${id}`,
      status: "in_progress",
      current_node_key: "finance",
      current_round: 1,
      ...patch
    };
    database
      .prepare(
        `INSERT INTO approval_instance
           (id, instance_no, template_id, biz_type, biz_id, biz_summary, initiator_userid, status,
            current_node_key, current_round, submitted_at, created_at, updated_at)
         VALUES (?, ?, 1, 'payment_request', 1, ?, 'u1', ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        row.instance_no,
        row.biz_summary,
        row.status,
        row.current_node_key,
        row.current_round,
        NOW,
        NOW,
        NOW
      );
  };

  const seedNode = (id, instanceId, nodeKey, nodeName, round) => {
    database
      .prepare(
        `INSERT INTO approval_node_instance
           (id, instance_id, node_key, node_type, node_name, status, round, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, 'sequential', ?, 'in_progress', ?, 1, ?, ?)`
      )
      .run(id, instanceId, nodeKey, nodeName, round, NOW, NOW);
  };

  const seedTask = (instanceId, nodeId, assignee, status, round) => {
    database
      .prepare(
        `INSERT INTO approval_task (node_instance_id, instance_id, assignee_userid, round, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(nodeId, instanceId, assignee, round, status, NOW, NOW);
  };

  beforeEach(() => {
    authState.roles = ["super_admin"];
    database = new sqlite.DatabaseSync(":memory:", { enableForeignKeyConstraints: false });
    database.exec(readMigration("0005_approval.sql"));
    env = { DB: createD1(database), KV: { get: async () => "session" } };
  });

  it("带上当前节点和等谁处理，只算当前这一轮还没处理的", async () => {
    seedInstance(1, { current_round: 2 });
    seedNode(11, 1, "finance", "第一轮财务", 1);
    seedNode(12, 1, "finance", "财务审核", 2);
    seedTask(1, 11, "old-person", "pending", 1);
    seedTask(1, 12, "zhang", "pending", 2);
    seedTask(1, 12, "li", "pending", 2);
    seedTask(1, 12, "done-person", "approved", 2);

    const { body } = await request();
    const [row] = body.data;

    expect(row.current_node_name).toBe("财务审核");
    expect(row.pending_assignees.split(",").sort()).toEqual(["li", "zhang"]);
    expect(row.instance_no).toBe("SP-20261106-0001");
  });

  it("已结束的单子没有等谁处理", async () => {
    seedInstance(1, { status: "approved", current_node_key: null });

    const { body } = await request();

    expect(body.data[0].current_node_name).toBeNull();
    expect(body.data[0].pending_assignees).toBeNull();
  });

  it("关键字能搜审批单号，也能搜摘要，总数跟着对", async () => {
    seedInstance(1, { instance_no: "SP-20261014-0010", biz_summary: "工资" });
    seedInstance(2, { instance_no: "SP-20261106-0002", biz_summary: "材料款" });

    const byNo = await request("?keyword=20261014");
    const bySummary = await request(`?keyword=${encodeURIComponent("材料")}`);

    expect(byNo.body.data.map((row) => row.id)).toEqual([1]);
    expect(byNo.body.pagination.total).toBe(1);
    expect(bySummary.body.data.map((row) => row.id)).toEqual([2]);
    expect(bySummary.body.pagination.total).toBe(1);
  });

  it("状态和发起人筛选照常，普通角色不能看", async () => {
    seedInstance(1, { status: "returned" });
    seedInstance(2, { status: "approved" });

    const filtered = await request("?status=returned&initiator=u1");
    expect(filtered.body.data.map((row) => row.id)).toEqual([1]);

    authState.roles = ["finance"];
    expect((await request()).status).toBe(403);
  });
});
