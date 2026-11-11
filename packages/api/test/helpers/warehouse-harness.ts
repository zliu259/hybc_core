import { Hono } from "hono";

import { createMigratedDatabase, createSqliteD1, normalizeParam } from "./sqlite-d1";

// 库房重做的真实 SQL 测试夹具：跑全部迁移，env.DB 是 node:sqlite 上的 D1 外壳。
// 用到它的测试要 describe.skipIf(!hasSqlite)（从 ./sqlite-d1 导入）。

const nowIso = () => new Date().toISOString();

const insertRow = (database, table, row) => {
  const columns = Object.keys(row);
  const placeholders = columns.map(() => "?").join(", ");
  const info = database
    .prepare(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`)
    .run(...columns.map((column) => normalizeParam(row[column])));
  return Number(info.lastInsertRowid);
};

export const createWarehouseHarness = () => {
  const database = createMigratedDatabase();
  const hooks = { beforeStatement: null };
  const db = createSqliteD1(database, hooks);
  const kv = new Map();
  const queued = [];
  let sequence = 0;
  const next = () => {
    sequence += 1;
    return sequence;
  };

  const env = {
    APP_ENV: "local",
    JWT_SECRET: "test-secret",
    DB: db,
    KV: {
      get: async (key) => (key.startsWith("session:") ? "session" : (kv.get(key) ?? null)),
      put: async (key, value) => {
        kv.set(key, value);
      },
      delete: async (key) => {
        kv.delete(key);
      }
    },
    EVENT_QUEUE: {
      send: async (message) => {
        queued.push(message);
      }
    }
  };

  const seed = {
    project(name = `测试项目${next()}`, managerUserid = null) {
      const now = nowIso();
      return insertRow(database, "project", {
        project_code: `P-${next()}`,
        project_name: name,
        manager_userid: managerUserid,
        status: "active",
        created_at: now,
        updated_at: now
      });
    },
    category(name = `类别${next()}`) {
      const now = nowIso();
      return insertRow(database, "device_category", {
        name,
        sort_order: 0,
        status: "active",
        created_at: now,
        updated_at: now
      });
    },
    device(overrides = {}) {
      const now = nowIso();
      const n = next();
      const categoryId = overrides.category_id ?? seed.category();
      return insertRow(database, "device", {
        device_code: `T-${String(n).padStart(4, "0")}`,
        name: `设备${n}`,
        category_id: categoryId,
        location: "warehouse",
        current_project_id: null,
        created_by_userid: "seed",
        created_at: now,
        updated_at: now,
        ...overrides
      });
    },
    material(overrides = {}) {
      const now = nowIso();
      const n = next();
      return insertRow(database, "material", {
        material_code: `M-${String(n).padStart(4, "0")}`,
        name: `物资${n}`,
        spec: "",
        unit: "个",
        category: "工具",
        kind: "turnover",
        quantity: 0,
        status: "active",
        created_at: now,
        updated_at: now,
        ...overrides
      });
    },
    member(userid, role) {
      insertRow(database, "warehouse_member", {
        userid,
        role,
        added_by_userid: "seed",
        created_at: nowIso()
      });
    },
    task(overrides = {}) {
      const now = nowIso();
      const n = next();
      return insertRow(database, "wh_task", {
        task_no: `KFR-TEST-${String(n).padStart(4, "0")}`,
        kind: "inspection",
        source: "manual",
        title: `任务${n}`,
        blocking: 1,
        required_photo_count: 0,
        created_by_userid: "seed",
        status: "todo",
        created_at: now,
        updated_at: now,
        ...overrides
      });
    },
    /** 模板加若干行；行只需写和默认值不同的字段。 */
    kitTemplate(overrides = {}, lines = []) {
      const now = nowIso();
      const id = insertRow(database, "kit_template", {
        name: `模板${next()}`,
        status: "active",
        created_by_userid: "seed",
        created_at: now,
        updated_at: now,
        ...overrides
      });
      lines.forEach((line, index) =>
        insertRow(database, "kit_template_line", {
          template_id: id,
          section: "顶进设备",
          sort_order: index,
          line_kind: "material",
          default_qty: 1,
          created_at: now,
          ...line
        })
      );
      return id;
    },
    /** 项目清单，默认已确认；行默认库房发、计划 1。 */
    kit(overrides = {}, lines = []) {
      const now = nowIso();
      const n = next();
      const id = insertRow(database, "project_kit", {
        kit_no: `PT-TEST-${String(n).padStart(4, "0")}`,
        title: `清单${n}`,
        status: "confirmed",
        created_by_userid: "seed",
        confirmed_by_userid: "seed",
        confirmed_at: now,
        created_at: now,
        updated_at: now,
        ...overrides
      });
      lines.forEach((line, index) =>
        insertRow(database, "project_kit_line", {
          kit_id: id,
          section: "顶进设备",
          sort_order: index,
          line_kind: "material",
          planned_qty: 1,
          source: "warehouse",
          created_at: now,
          ...line
        })
      );
      return id;
    }
  };

  return { database, db, env, hooks, kv, queued, seed };
};

export const authPayload = (sub, roles, authMethod = "wecom_oauth") => ({
  sub,
  username: sub,
  nickname: sub,
  avatar: "",
  roles,
  permissions: [],
  tokenId: `token-${sub}`,
  type: "access",
  auth_method: authMethod,
  wecom_verified_at: "2026-11-11T00:00:00.000Z",
  exp: 4102444800,
  iat: 1770000000
});

/**
 * 以 /api/v1 为前缀发一个请求。mount 是把路由挂到 app 上的函数（通常是 mountWarehouseRoutes）。
 * 调用方自己 vi.mock("../src/services/auth") 决定当前身份。
 */
export const callWh = async (h, mount, method, path, body) => {
  const app = new Hono();
  mount(app);
  const response = await app.request(
    `/api/v1${path}`,
    {
      method,
      headers: { authorization: "Bearer test-token", "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    },
    h.env
  );
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: response.status, body: json };
};
