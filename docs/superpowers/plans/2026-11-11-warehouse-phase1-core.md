# 库房重做 阶段 1：核心 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让库管能在 Web 上录入真实设备和物资，并完成发货、返库、检查的闭环；同时下线旧的库房和资产模块。

**Architecture:** 设备位置和物资数量只能通过"库房单"改变，每张单在一个 `db.batch()` 里完成，前置条件用批内断言保证。设备状态不存储，由位置和未完成的阻塞任务算出。后端按领域拆成五个路由文件和对应的 service；Web 新建 `views/wh/` 下的六个页面，旧页面整体删除。

**Tech Stack:** Hono + D1（`packages/api`）、Vue 3 + Element Plus + PureAdmin（`packages/web`）、Vitest、`node:sqlite` 测试夹具。

**Spec:** `docs/superpowers/specs/2026-11-11-warehouse-rebuild-design.md`

**前置：** 阶段 0 计划的 Task 1（`guard.ts` 和 `test/helpers/sqlite-d1.ts`）已合并。

## Global Constraints

- 接口统一返回 `{ success: true, data }` 或 `{ success: false, error: { message } }`；列表另带 `pagination: { page, pageSize, total }`。`message` 一律中文。
- 所有路由 `use("*", authMiddleware)`。读接口 `requireRoles(ALL_ROLES)`，`ALL_ROLES` 是全部五个角色。写接口先过 `requireHuman`（拒绝 `auth_method === "mcp_agent"`），再过能力校验。
- 多步写入一律 `runAtomicBatch`（`services/db-transaction.ts`），前置条件用 `assertInBatch`，批处理最后一条是 `releaseGuards`。
- 数量：正数，最多 3 位小数，不超过 1000000。字符串都有长度上限。
- 时间用 `new Date().toISOString()`。只做软删除。不用 `as any`、`@ts-ignore`。
- 单个路由文件和单个视图文件不超过 400 行。
- 界面上不出现英文枚举值和数字 ID。
- 设备二维码内容是 `HYBC:D:<设备编号>`。
- 用到 `node:sqlite` 的测试包在 `describe.skipIf(!hasSqlite)` 里，推送前本地必须跑。
- 提交信息格式 `<type>: <description>`，不加 AI 署名。
- 分支 `feat/warehouse-phase1-core`，开 PR，不直接推 `main`。迁移 0095 先于合并执行；Task 19 的删表迁移是另一个 PR。
- 与设计稿的两处出入，以本计划为准：
  1. 本阶段只建用得到的表，配套清单、盘点、资料的表留到各自阶段。
  2. 旧接口不直接消失：已发布的小程序和 MCP 还在调，留一个只返回空数据的占位路由，阶段 3 删除。

## Review Focus

1. **连点或重试提交库房单。** 同一个 `client_request_id` 只生成一张单，第二次返回同一张单。Task 7。
2. **两个人同时发同一台设备。** 后到的那次得到 409，设备只被发出一次。Task 8。
3. **数量填了"25米"、负数、0、超过三位小数。** 接口返回 400 并指出是哪一项；导入时逐行报错，不会被当成 0。Task 7、Task 10、Task 12。
4. **导入文件里有重复的编号或"品名 + 规格"。** 整批不导入，并列出重复的行号。Task 10。
5. **审批列表里还有旧业务类型的历史审批单。** 列表照常打开，这些单的摘要为空。Task 2。

---

### Task 1: 迁移 0095 和库房测试夹具

**Files:**
- Create: `packages/api/migrations/0095_warehouse_rebuild_core.sql`
- Create: `packages/api/src/types/wh.ts`
- Create: `packages/api/test/helpers/warehouse-harness.ts`
- Test: `packages/api/test/warehouse-schema.test.ts`

**Interfaces:**
- Produces: 下面的表结构；`types/wh.ts` 里每张表一个 `interface`（`Device`、`DeviceEvent`、`Material`、`WhDoc`、`WhDocLine`、`WhTask`、`WhTaskPhoto`、`DeviceCategory`、`WarehouseMember`），字段名和类型与列一一对应。
- Produces（`test/helpers/warehouse-harness.ts`）：

```ts
export const createWarehouseHarness: () => {
  database: DatabaseSync;
  env: Env; // DB 用 createSqliteD1(createMigratedDatabase())，KV 是内存 Map，APP_ENV "local"
  hooks: { beforeStatement: (() => void) | null };
  seed: {
    project(name?: string, managerUserid?: string): number;
    category(name?: string): number;
    device(overrides?: Partial<Device>): number; // 默认在库、类别自动建
    material(overrides?: Partial<Material>): number; // 默认 kind "turnover"、quantity 0
    member(userid: string, role: "keeper" | "doc_admin"): void;
  };
};
export const authPayload: (sub: string, roles: UserRole[], authMethod?: AuthTokenPayload["auth_method"]) => AuthTokenPayload;
```

迁移内容：

```sql
CREATE TABLE IF NOT EXISTS wh_guard (ok INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS warehouse_member (
  userid TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('keeper', 'doc_admin')),
  added_by_userid TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (userid, role)
);

CREATE TABLE IF NOT EXISTS device_category (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS device (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  alias TEXT,
  category_id INTEGER NOT NULL,
  machine_type TEXT,
  diameter_mm INTEGER,
  manufacturer TEXT,
  model TEXT,
  serial_no TEXT,
  spec TEXT,
  ownership TEXT NOT NULL DEFAULT 'owned' CHECK (ownership IN ('owned', 'leased_in')),
  purchased_date TEXT,
  location TEXT NOT NULL DEFAULT 'warehouse' CHECK (location IN ('warehouse', 'project', 'scrapped')),
  current_project_id INTEGER,
  storage_note TEXT,
  photo_key TEXT,
  remark TEXT,
  version INTEGER NOT NULL DEFAULT 0,
  created_by_userid TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CONSTRAINT device_project_matches_location
    CHECK ((location = 'project') = (current_project_id IS NOT NULL)),
  FOREIGN KEY (category_id) REFERENCES device_category(id),
  FOREIGN KEY (current_project_id) REFERENCES project(id)
);
CREATE INDEX IF NOT EXISTS idx_device_category_id ON device(category_id);
CREATE INDEX IF NOT EXISTS idx_device_location ON device(location);
CREATE INDEX IF NOT EXISTS idx_device_current_project_id ON device(current_project_id);

CREATE TABLE IF NOT EXISTS device_event (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  ref_type TEXT,
  ref_id INTEGER,
  summary TEXT NOT NULL,
  photo_keys_json TEXT,
  operator_userid TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (device_id) REFERENCES device(id)
);
CREATE INDEX IF NOT EXISTS idx_device_event_device_id ON device_event(device_id);

CREATE TABLE IF NOT EXISTS material (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  material_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  spec TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL,
  category TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('turnover', 'consumable')),
  quantity REAL NOT NULL DEFAULT 0,
  unit_price REAL,
  min_stock REAL,
  storage_note TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  remark TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CONSTRAINT material_quantity_non_negative CHECK (quantity >= 0),
  UNIQUE (name, spec)
);
CREATE INDEX IF NOT EXISTS idx_material_category ON material(category);

CREATE TABLE IF NOT EXISTS wh_doc (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_no TEXT NOT NULL UNIQUE,
  doc_type TEXT NOT NULL CHECK (doc_type IN
    ('opening', 'inbound', 'out', 'back', 'transfer', 'adjust', 'scrap', 'unscrap')),
  project_id INTEGER,
  to_project_id INTEGER,
  project_kit_id INTEGER,
  counterparty TEXT,
  handover_name TEXT,
  remark TEXT,
  photo_keys_json TEXT,
  stocktake_id INTEGER,
  reverses_doc_id INTEGER UNIQUE,
  operator_userid TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  client_request_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES project(id),
  FOREIGN KEY (to_project_id) REFERENCES project(id),
  FOREIGN KEY (reverses_doc_id) REFERENCES wh_doc(id)
);
CREATE INDEX IF NOT EXISTS idx_wh_doc_project_id ON wh_doc(project_id);
CREATE INDEX IF NOT EXISTS idx_wh_doc_doc_type ON wh_doc(doc_type);
CREATE INDEX IF NOT EXISTS idx_wh_doc_occurred_at ON wh_doc(occurred_at);

CREATE TABLE IF NOT EXISTS wh_doc_line (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id INTEGER NOT NULL,
  device_id INTEGER,
  material_id INTEGER,
  quantity REAL NOT NULL CHECK (quantity > 0),
  outcome TEXT NOT NULL DEFAULT 'normal' CHECK (outcome IN ('normal', 'returned', 'lost')),
  stock_delta REAL NOT NULL DEFAULT 0,
  balance_after REAL,
  project_id INTEGER,
  project_delta REAL NOT NULL DEFAULT 0,
  usage_meters REAL,
  soil_type TEXT,
  note TEXT,
  created_at TEXT NOT NULL,
  CONSTRAINT wh_doc_line_one_target CHECK ((device_id IS NULL) <> (material_id IS NULL)),
  FOREIGN KEY (doc_id) REFERENCES wh_doc(id),
  FOREIGN KEY (device_id) REFERENCES device(id),
  FOREIGN KEY (material_id) REFERENCES material(id),
  FOREIGN KEY (project_id) REFERENCES project(id)
);
CREATE INDEX IF NOT EXISTS idx_wh_doc_line_doc_id ON wh_doc_line(doc_id);
CREATE INDEX IF NOT EXISTS idx_wh_doc_line_device_id ON wh_doc_line(device_id);
CREATE INDEX IF NOT EXISTS idx_wh_doc_line_material_id ON wh_doc_line(material_id);
CREATE INDEX IF NOT EXISTS idx_wh_doc_line_project_id_material_id ON wh_doc_line(project_id, material_id);

CREATE TABLE IF NOT EXISTS wh_task (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_no TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('inspection', 'maintenance', 'servicing', 'other')),
  source TEXT NOT NULL CHECK (source IN ('return', 'followup', 'manual')),
  device_id INTEGER,
  title TEXT NOT NULL,
  description TEXT,
  systems_json TEXT,
  blocking INTEGER NOT NULL DEFAULT 0 CHECK (blocking IN (0, 1)),
  required_photo_count INTEGER NOT NULL DEFAULT 0,
  due_date TEXT,
  assignee_userid TEXT,
  created_by_userid TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'submitted', 'done', 'cancelled')),
  result TEXT CHECK (result IS NULL OR result IN ('pass', 'fail')),
  result_note TEXT,
  review_note TEXT,
  supplement_round INTEGER NOT NULL DEFAULT 0,
  parent_task_id INTEGER,
  origin_doc_id INTEGER,
  submitted_at TEXT,
  done_at TEXT,
  done_by_userid TEXT,
  cancel_reason TEXT,
  version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (device_id) REFERENCES device(id)
);
CREATE INDEX IF NOT EXISTS idx_wh_task_device_id ON wh_task(device_id);
CREATE INDEX IF NOT EXISTS idx_wh_task_assignee_userid ON wh_task(assignee_userid);
CREATE INDEX IF NOT EXISTS idx_wh_task_status ON wh_task(status);

CREATE TABLE IF NOT EXISTS wh_task_photo (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL,
  file_key TEXT NOT NULL,
  uploaded_by_userid TEXT NOT NULL,
  created_at TEXT NOT NULL,
  deleted_at TEXT,
  FOREIGN KEY (task_id) REFERENCES wh_task(id)
);
CREATE INDEX IF NOT EXISTS idx_wh_task_photo_task_id ON wh_task_photo(task_id);
```

- [ ] **Step 1: 写失败的测试**

`test/warehouse-schema.test.ts`，每条用 `h.database.prepare(...).run(...)` 直接写库：

```ts
it("设备在项目时必须有项目，在库时不能有", () => {
  expect(() => insertDevice({ location: "project", current_project_id: null })).toThrow("device_project_matches_location");
  expect(() => insertDevice({ location: "warehouse", current_project_id: projectId })).toThrow("device_project_matches_location");
});
it("物资数量不能为负", () => {
  const id = h.seed.material({ quantity: 1 });
  expect(() => h.database.prepare("UPDATE material SET quantity = quantity - 2 WHERE id = ?").run(id)).toThrow("material_quantity_non_negative");
});
it("同品名同规格不能重复", () => {
  h.seed.material({ name: "排泥钢管", spec: "Φ114" });
  expect(() => h.seed.material({ name: "排泥钢管", spec: "Φ114" })).toThrow("UNIQUE");
});
it("单据行必须恰好指向设备或物资之一", () => {
  expect(() => insertLine({ device_id: 1, material_id: 1 })).toThrow("wh_doc_line_one_target");
  expect(() => insertLine({ device_id: null, material_id: null })).toThrow("wh_doc_line_one_target");
});
it("同一个 client_request_id 只能有一张单", () => { /* 第二次插入抛 UNIQUE */ });
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/api && npm test -- test/warehouse-schema.test.ts`
Expected: FAIL，找不到 `./helpers/warehouse-harness`。

- [ ] **Step 3: 写迁移、类型和夹具**

- [ ] **Step 4: 运行确认通过**

Run: `cd packages/api && npm test -- test/warehouse-schema.test.ts test/migrations-unique.test.ts && node scripts/check-migration-numbers.mjs && npm run db:migrate:local`
Expected: 全部通过；本地迁移成功应用 0095。

- [ ] **Step 5: 提交**

```bash
git add packages/api/migrations/0095_warehouse_rebuild_core.sql packages/api/src/types/wh.ts packages/api/test/helpers/warehouse-harness.ts packages/api/test/warehouse-schema.test.ts
git commit -m "feat: 库房重做的核心表和测试夹具"
```

### Task 2: 下线旧后端并留占位接口

**Files:**
- Delete: `packages/api/src/routes/{warehouse,warehouse-work-order,warehouse-manual,asset}.ts` 及同目录的 `warehouse-*.test.ts`
- Delete: `packages/api/src/services/warehouse-*.ts`、`asset-*.ts` 及其测试（不含 `services/warehouse/` 目录）
- Delete: `packages/api/src/types/{warehouse,warehouse-manual,asset,work-order}.ts`
- Create: `packages/api/src/routes/warehouse-legacy-stub.ts`
- Modify: `packages/api/src/index.ts`（去掉第 9、37 到 39 行的导入和第 84 到 87 行的挂载，挂上占位路由）
- Modify: `packages/api/src/routes/approval.ts`（删掉所有 `WHEN 'stock_order'` 分支，约在第 110、293 到 318、391 到 414 行）
- Modify: `packages/api/src/services/approval/biz-table.ts:12-13`、`operations.ts:39-56`、`packages/api/src/queue-handler.ts:96-109,173-186`（删掉 `stock_order` 和 `warehouse_asset_work_order` 两个业务类型）
- Modify: `packages/api/src/routes/admin.ts`（删掉 `biz_type: "stock_order"` 的审批模板种子，约第 87 到 92 行）
- Modify: `packages/api/src/routes/system.ts`（删掉 `/automation/inventory-alert-notify` 路由，约第 625 行起；第 389 行任务类型列表里去掉 `inventory_alert_analysis`、`consumption_anomaly`）
- Modify: `packages/api/src/types/ai.ts`、`packages/api/src/services/ai-slot.ts`（删掉库房相关的 AI 任务类型和手册草稿回填）
- Modify: `packages/api/src/services/wecom-project-tools.ts:364-380`（在场设备数改查 `device` 表的 `current_project_id`；删掉设备需求计划的查询和返回字段）
- Test: `packages/api/test/warehouse-legacy-stub.test.ts`；Modify: `packages/api/test/approval-admin-all.test.ts`（加一条用例）

**Interfaces:**
- Produces: `warehouseLegacyStubRoutes`（`routes/warehouse-legacy-stub.ts`），在 `index.ts` 里挂两次：`app.route("/api/v1/asset", ...)` 和 `app.route("/api/v1/warehouse", ...)`。后续任务的新路由必须挂在它前面。
- 占位规则：
  - `GET` 这六个路径返回 200 `{ success: true, data: [] }`：`/api/v1/warehouse`、`/api/v1/warehouse/stock-order`、`/api/v1/warehouse/stocktake`、`/api/v1/warehouse/work-order/mobile/my-tasks`、`/api/v1/asset`、`/api/v1/asset/type`。
  - 其余落到占位路由上的请求一律 410 `{ success: false, error: { message: "库房功能已升级，请使用新版页面" } }`。
  - 占位路由同样要过 `authMiddleware`。

- [ ] **Step 1: 写失败的测试**

`warehouse-legacy-stub.test.ts`：对上面六个 GET 路径断言 200 和空数组；`POST /api/v1/warehouse/stock-order` 和 `GET /api/v1/asset/12` 断言 410 和那句中文；不带令牌时 401。

在 `test/approval-admin-all.test.ts` 里加一条用例"旧业务类型的历史审批单不影响列表"：往 `approval_instance` 插一行 `biz_type = 'stock_order'`，以超管身份调用 `GET /approval/admin/all`，断言 200，返回里有这一行，它的业务摘要为空。这份测试自己建库，只跑它需要的迁移；如果它没有跑建 `stock_order` 表的迁移，这条用例在删除 SQL 分支之前就会因为找不到表而失败，这正是要防的情况。

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/api && npm test -- test/warehouse-legacy-stub.test.ts test/approval-admin-all.test.ts`
Expected: 占位接口的测试 FAIL（模块不存在）。审批列表的新用例如果此时通过（测试库里恰好有旧表），保留即可，Task 19 删表后它仍必须通过。

- [ ] **Step 3: 删除旧文件，修改引用，实现占位路由**

删完后用 `grep -rn "tracked_asset\|asset_type\|stock_order\|stocktake_task\|warehouse_asset_work_order\|warehouse_manual\|inventory_consumption\|project_equipment_plan" packages/api/src` 检查，除占位路由的注释外不应再有引用。

- [ ] **Step 4: 运行确认通过**

Run: `cd packages/api && npm run typecheck && npm test && npm run lint`
Expected: 全部通过。被删模块的测试已一并删除；其他测试里若引用了被删的业务类型，改成仍存在的类型。

- [ ] **Step 5: 提交**

```bash
git add -A packages/api
git commit -m "refactor: 下线旧库房和资产后端，保留占位接口"
```

### Task 3: 权限、校验和设置接口

**Files:**
- Create: `packages/api/src/services/warehouse/{errors,validation,access,settings}.ts`
- Create: `packages/api/src/routes/{wh-http,wh-app,wh-settings}.ts`
- Modify: `packages/api/src/index.ts`（在占位路由之前调用 `mountWarehouseRoutes(app)`）
- Modify: `packages/api/test/helpers/warehouse-harness.ts`（加 `callWh`）
- Test: `packages/api/test/warehouse-validation.test.ts`、`packages/api/test/warehouse-settings.test.ts`

**Interfaces:**
- Produces:

```ts
// services/warehouse/errors.ts
export class WarehouseError extends Error {
  constructor(public readonly status: 400 | 403 | 404 | 409, message: string);
}

// services/warehouse/validation.ts —— 不合规一律 throw new WarehouseError(400, ...)
export const requireText: (value: unknown, label: string, maxLength: number) => string;      // "<label>不能为空" / "<label>不能超过<n>个字"
export const optionalText: (value: unknown, label: string, maxLength: number) => string | null;
export const requireId: (value: unknown, label: string) => number;                           // "请选择<label>"
export const optionalId: (value: unknown, label: string) => number | null;
export const requireQuantity: (value: unknown, label: string) => number;                     // "<label>必须是大于 0 的数字，最多 3 位小数"
export const optionalNumber: (value: unknown, label: string, range: { min: number; max: number; integer?: boolean }) => number | null;
export const requireEnum: <T extends string>(value: unknown, label: string, allowed: readonly T[]) => T;
export const optionalDate: (value: unknown, label: string) => string | null;                 // YYYY-MM-DD

// services/warehouse/access.ts
export const ALL_ROLES: UserRole[];
export interface WarehouseCapabilities {
  is_keeper: boolean; is_doc_admin: boolean; can_scrap: boolean;
  can_unscrap: boolean; can_manage_settings: boolean; can_create_kit: boolean;
}
export const getWarehouseCapabilities: (env: Env, auth: AuthTokenPayload) => Promise<WarehouseCapabilities>;
export const requireHuman: MiddlewareHandler;            // 403 "智能体不能执行库房写操作"
export const requireKeeper: MiddlewareHandler;           // 403 "只有库管可以操作"
export const requireSettingsManager: MiddlewareHandler;  // 403 "只有经理或超级管理员可以操作"
export const requireScrap: MiddlewareHandler;            // 403 "只有经理或超级管理员可以报废设备"
export const requireUnscrap: MiddlewareHandler;          // 403 "只有超级管理员可以撤销报废"

// services/warehouse/settings.ts
export interface WarehouseSettings { default_inspector_userid: string | null; return_inspection_photo_count: number }
export const getWarehouseSettings: (env: Env) => Promise<WarehouseSettings>;
export const saveWarehouseSettings: (env: Env, input: unknown, operatorUserid: string) => Promise<WarehouseSettings>;

// routes/wh-http.ts
export const handleWarehouseError: (c: Context, error: unknown) => Response;
export const readJsonBody: (c: Context) => Promise<Record<string, unknown>>; // 不是对象则 400 "请求内容格式不对"

// routes/wh-app.ts
export const mountWarehouseRoutes: (app: Hono<{ Bindings: Env; Variables: AuthVariables }>) => void;

// test/helpers/warehouse-harness.ts
export const callWh: (h: Harness, method: string, path: string, body?: unknown) => Promise<Response>; // path 以 /warehouse 开头
```

能力规则（`mcp_agent` 令牌全部为 false）：

| 能力 | 谁有 |
|---|---|
| `is_keeper` | 超管；`warehouse_member` 里 role 为 `keeper` 的人 |
| `is_doc_admin` | 有 `is_keeper` 的人；role 为 `doc_admin` 的人 |
| `can_scrap` | 超管、经理 |
| `can_unscrap` | 超管 |
| `can_manage_settings` | 超管、经理 |
| `can_create_kit` | 有 `is_keeper` 的人；经理；现场负责人 |

`handleWarehouseError` 的映射：`WarehouseError` 用它自己的状态码和文案；`isGuardFailure` 为真返回 409 `数据已变化，请刷新后重试`；`isCheckFailure(e, "material_quantity_non_negative")` 为真返回 400 `库存不足`；其他错误原样抛出。

设置存 `system_config`：键 `warehouse.default_inspector_userid`、`warehouse.return_inspection_photo_count`（默认 3，允许 0 到 9 的整数）。

接口（都在 `wh-settings.ts`）：

| 方法和路径 | 权限 | 说明 |
|---|---|---|
| `GET /warehouse/me` | 读 | 返回 `WarehouseCapabilities` |
| `GET /warehouse/settings` | 读 | |
| `PUT /warehouse/settings` | `requireSettingsManager` | |
| `GET /warehouse/member` | 读 | `WarehouseMember[]` |
| `POST /warehouse/member` | `requireSettingsManager` | `{ userid, role }`，重复添加返回 200 不报错 |
| `DELETE /warehouse/member/:userid/:role` | `requireSettingsManager` | |
| `GET /warehouse/device-category` | 读 | 按 `sort_order, id` |
| `POST /warehouse/device-category` | `requireKeeper` | `{ name, sort_order? }`，重名 409 `类别已存在` |
| `PUT /warehouse/device-category/:id` | `requireKeeper` | `{ name?, sort_order?, status? }` |

- [ ] **Step 1: 写校验函数的失败测试**

```ts
it.each([
  [1, 1], [0.125, 0.125], ["2.5", 2.5], [1000000, 1000000]
])("requireQuantity 接受 %j", (input, expected) => expect(requireQuantity(input, "数量")).toBe(expected));
it.each([0, -1, 1.2345, "25米", "", null, undefined, Number.NaN, 1000001, [], {}])(
  "requireQuantity 拒绝 %j",
  (input) => expect(() => requireQuantity(input, "数量")).toThrow("数量必须是大于 0 的数字，最多 3 位小数")
);
it("requireText 去掉首尾空白，空白串算空", () => {
  expect(requireText("  泥浆泵 ", "名称", 50)).toBe("泥浆泵");
  expect(() => requireText("   ", "名称", 50)).toThrow("名称不能为空");
  expect(() => requireText("x".repeat(51), "名称", 50)).toThrow("名称不能超过50个字");
});
it("optionalDate 只接受 YYYY-MM-DD", () => {
  expect(optionalDate("2026-11-11", "日期")).toBe("2026-11-11");
  expect(() => optionalDate("2026/11/11", "日期")).toThrow("日期");
});
```

- [ ] **Step 2: 写设置接口的失败测试**

`warehouse-settings.test.ts`，文件顶部按 `test/approval-admin-all.test.ts:10-28` 的方式 mock `../src/services/auth`，用可变的 `authState` 切换身份：

```ts
it.each([
  ["super_admin", [], { is_keeper: true, is_doc_admin: true, can_scrap: true, can_unscrap: true, can_manage_settings: true, can_create_kit: true }],
  ["manager", [], { is_keeper: false, is_doc_admin: false, can_scrap: true, can_unscrap: false, can_manage_settings: true, can_create_kit: true }],
  ["operator", ["keeper"], { is_keeper: true, is_doc_admin: true, can_scrap: false, can_unscrap: false, can_manage_settings: false, can_create_kit: true }],
  ["operator", ["doc_admin"], { is_keeper: false, is_doc_admin: true, can_scrap: false, can_unscrap: false, can_manage_settings: false, can_create_kit: false }],
  ["site_manager", [], { is_keeper: false, is_doc_admin: false, can_scrap: false, can_unscrap: false, can_manage_settings: false, can_create_kit: true }],
  ["finance", [], { is_keeper: false, is_doc_admin: false, can_scrap: false, can_unscrap: false, can_manage_settings: false, can_create_kit: false }]
])("角色 %s 加成员身份 %j 的能力", async (role, memberships, expected) => { /* GET /warehouse/me */ });
it("智能体令牌即使是超管也没有任何能力", async () => { /* 全部 false */ });
it("经理可以加库管，库管自己不能", async () => { /* 201 / 403 */ });
it("照片数设成 10 被拒绝，设成 0 可以", async () => { /* 400 / 200 */ });
it("类别重名返回 409 类别已存在", async () => {});
```

- [ ] **Step 3: 运行确认失败，然后实现**

Run: `cd packages/api && npm test -- test/warehouse-validation.test.ts test/warehouse-settings.test.ts`

- [ ] **Step 4: 运行确认通过**

Run: `cd packages/api && npm test -- test/warehouse-validation.test.ts test/warehouse-settings.test.ts test/warehouse-legacy-stub.test.ts && npm run typecheck && npm run lint`
Expected: 全部通过，占位接口的测试仍然通过（证明挂载顺序正确）。

- [ ] **Step 5: 提交**

```bash
git add packages/api/src/services/warehouse packages/api/src/routes/wh-http.ts packages/api/src/routes/wh-app.ts packages/api/src/routes/wh-settings.ts packages/api/src/index.ts packages/api/test
git commit -m "feat: 库房权限、输入校验和设置接口"
```

### Task 4: 设备台账和状态计算

**Files:**
- Create: `packages/api/src/services/warehouse/{device-state,device}.ts`
- Create: `packages/api/src/routes/wh-device.ts`
- Modify: `packages/api/src/routes/wh-app.ts`
- Test: `packages/api/test/warehouse-device.test.ts`

**Interfaces:**
- Consumes: Task 3 的校验函数、`WarehouseError`、中间件。
- Produces:

```ts
// services/warehouse/device-state.ts
export type DeviceState = "scrapped" | "on_project" | "repairing" | "pending_inspection" | "blocked" | "available";
export const DEVICE_STATE_LABELS: Record<DeviceState, string>;
// { scrapped: "已报废", on_project: "在项目", repairing: "维修中", pending_inspection: "待检", blocked: "暂不可用", available: "可用" }
export const OPEN_TASK_STATUSES: readonly ["todo", "submitted"];
/** 以 d 为设备表别名的 CASE 表达式，结果是 DeviceState。 */
export const DEVICE_STATE_SQL: string;
/** 断言用：设备 ? 在库且没有未完成的阻塞任务。绑定一个参数（设备 id）。 */
export const DEVICE_DISPATCHABLE_EXISTS_SQL: string;

// services/warehouse/device.ts
export type DeviceRow = Device & { state: DeviceState; state_label: string; category_name: string; project_name: string | null };
export interface DeviceUsageRecord { doc_no: string; project_name: string; returned_at: string; usage_meters: number | null; soil_type: string | null }
export type DeviceDetail = DeviceRow & {
  open_tasks: Pick<WhTask, "id" | "task_no" | "kind" | "status" | "title" | "blocking">[];
  events: DeviceEvent[];               // 最新 50 条
  usage_records: DeviceUsageRecord[];  // 这台设备每次返库一条，取自未被冲销的返库单行，按时间升序
  usage_meters_total: number;          // usage_records 里 usage_meters 之和
};
export const createDevice: (env: Env, input: unknown, operatorUserid: string) => Promise<{ id: number; device_code: string }>;
export const updateDevice: (env: Env, id: number, input: unknown, operatorUserid: string) => Promise<void>;
export const listDevices: (env: Env, query: Record<string, string | undefined>) => Promise<{ items: DeviceRow[]; total: number; page: number; pageSize: number }>;
export const getDevice: (env: Env, id: number) => Promise<DeviceDetail | null>;
export const getDeviceByCode: (env: Env, code: string) => Promise<DeviceRow | null>;
export const addDeviceNote: (env: Env, id: number, input: unknown, operatorUserid: string) => Promise<void>;
```

状态计算按设计稿 6.2 的表，从上到下取第一个命中。

设备输入字段和上限：`device_code`（可空，30）、`name`（必填，80）、`alias`（30）、`category_id`（必填，必须存在且启用）、`machine_type`（20）、`diameter_mm`（100 到 6000 的整数）、`manufacturer`、`model`、`serial_no`（各 50）、`spec`（80）、`ownership`、`purchased_date`、`storage_note`（50）、`photo_key`（300）、`remark`（300）。

规则：

- 不填编号时生成 `SB-` 加 4 位序号，取现有 `SB-` 编号里最大的数字加一；撞唯一约束重试一次。
- 编号重复返回 409 `设备编号已存在`。
- `updateDevice` 的请求体里出现 `location` 或 `current_project_id` 时返回 400 `不能直接修改设备位置`。
- 新建成功写一条时间线，`event_type` 为 `created`，`summary` 为 `建档`。
- `listDevices` 支持 `state`、`category_id`、`project_id`、`keyword`（匹配编号、名称、现场叫法、型号）、`page`、`pageSize`（默认 20，最大 200）。

接口：

| 方法和路径 | 权限 |
|---|---|
| `GET /warehouse/device`、`GET /warehouse/device/:id`、`GET /warehouse/device/by-code/:code` | 读 |
| `POST /warehouse/device`、`PUT /warehouse/device/:id`、`POST /warehouse/device/:id/note` | `requireKeeper` |

`by-code` 路由要注册在 `/:id` 之前。

- [ ] **Step 1: 写失败的测试**

```ts
it("不填编号时从 SB-0001 起连续生成", async () => {
  expect((await createDevice(h.env, base, "u1")).device_code).toBe("SB-0001");
  expect((await createDevice(h.env, base, "u1")).device_code).toBe("SB-0002");
});
it("自带编号原样保留，重复时 409", async () => {
  await createDevice(h.env, { ...base, device_code: "DN1550-1" }, "u1");
  await expect(createDevice(h.env, { ...base, device_code: "DN1550-1" }, "u1")).rejects.toMatchObject({ status: 409, message: "设备编号已存在" });
});
it.each([
  ["scrapped", { location: "scrapped" }, []],
  ["on_project", { location: "project" }, []],
  ["repairing", {}, [{ kind: "maintenance", blocking: 1, status: "todo" }, { kind: "inspection", blocking: 1, status: "todo" }]],
  ["pending_inspection", {}, [{ kind: "inspection", blocking: 1, status: "submitted" }]],
  ["blocked", {}, [{ kind: "other", blocking: 1, status: "todo" }]],
  ["available", {}, [{ kind: "inspection", blocking: 1, status: "done" }, { kind: "servicing", blocking: 0, status: "todo" }]]
])("状态 %s", async (expected, deviceOverrides, tasks) => {
  /* 建设备和任务后 getDevice(...).state === expected，且 listDevices({ state: expected }) 只返回这一台 */
});
it("改主数据可以，改位置被拒绝", async () => {
  await expect(updateDevice(h.env, id, { location: "warehouse" }, "u1")).rejects.toMatchObject({ status: 400, message: "不能直接修改设备位置" });
});
it("按编号查，大小写和首尾空白不敏感", async () => {});
it("操作员调用新建接口得到 403，库管得到 201", async () => {});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/api && npm test -- test/warehouse-device.test.ts`

- [ ] **Step 3: 实现 service、路由并注册**

- [ ] **Step 4: 运行确认通过**

Run: `cd packages/api && npm test -- test/warehouse-device.test.ts && npm run typecheck && npm run lint`

- [ ] **Step 5: 提交**

```bash
git add packages/api/src/services/warehouse/device-state.ts packages/api/src/services/warehouse/device.ts packages/api/src/routes/wh-device.ts packages/api/src/routes/wh-app.ts packages/api/test/warehouse-device.test.ts
git commit -m "feat: 设备台账和状态计算"
```

### Task 5: 物资档案

**Files:**
- Create: `packages/api/src/services/warehouse/material.ts`
- Create: `packages/api/src/routes/wh-material.ts`
- Modify: `packages/api/src/routes/wh-app.ts`
- Test: `packages/api/test/warehouse-material.test.ts`

**Interfaces:**
- Produces:

```ts
export const MATERIAL_CATEGORIES: readonly string[]; // 设计稿 6.1 的 11 个分节名，顺序相同
export const createMaterial: (env: Env, input: unknown) => Promise<{ id: number; material_code: string }>;
export const updateMaterial: (env: Env, id: number, input: unknown) => Promise<void>; // 不能改 quantity
export const listMaterials: (env: Env, query: Record<string, string | undefined>) => Promise<{ items: Material[]; total: number; page: number; pageSize: number }>;
export const getMaterial: (env: Env, id: number) => Promise<Material | null>;
```

规则：

- 字段上限：`name` 50、`spec` 80（不填存空串）、`unit` 10、`storage_note` 50、`remark` 300；`unit_price` 和 `min_stock` 是 0 到 100000000 的数。
- `category` 必须是 `MATERIAL_CATEGORIES` 之一；`kind` 必须是 `turnover` 或 `consumable`。
- 编号生成 `WZ-` 加 4 位序号，做法同设备。
- 同品名同规格返回 409 `同品名同规格的物资已存在`。
- 请求体里出现 `quantity` 时返回 400 `数量只能通过库房单修改`。
- `listMaterials` 支持 `keyword`（编号、品名、规格）、`category`、`kind`、`status`、`low_stock=1`（`min_stock` 非空且 `quantity <= min_stock`）、分页。

接口：

| 方法和路径 | 权限 |
|---|---|
| `GET /warehouse/material`、`GET /warehouse/material/:id` | 读 |
| `POST /warehouse/material`、`PUT /warehouse/material/:id` | `requireKeeper` |
| `GET /warehouse/inventory` | 读。全部启用的物资，不分页，返回 `Material[]` 加兼容字段 |
| `GET /warehouse/inventory/alert` | 读。低库存的那部分，同样带兼容字段 |

后两个路径是旧 MCP 工具和已发布的小程序在用的，必须保留路径名。已发布的小程序库存页按旧字段渲染，所以这两个接口的每一行额外带五个兼容字段，阶段 3 换掉小程序页面后删除：`warehouse_id` 固定 1，`warehouse_name` 固定 `库房`，`asset_type_id` 等于物资 id，`type_name` 是"品名 规格"，`status` 在低库存时为 `low`、否则为 `normal`。

- [ ] **Step 1: 写失败的测试**

```ts
it("编号从 WZ-0001 起", async () => {});
it("同品名同规格 409，同品名不同规格可以", async () => {});
it("分节不在 11 个之内被拒绝", async () => {
  await expect(createMaterial(h.env, { ...base, category: "其他" })).rejects.toMatchObject({ status: 400 });
});
it("新建和修改都不能带数量", async () => {
  await expect(createMaterial(h.env, { ...base, quantity: 5 })).rejects.toMatchObject({ message: "数量只能通过库房单修改" });
});
it("low_stock=1 只返回数量不高于最低库存的", async () => {});
it("/warehouse/inventory 返回全部启用物资的数组，/alert 只返回低库存的", async () => {});
it("库存接口带旧小程序要的兼容字段", async () => {
  expect(rows[0]).toMatchObject({ warehouse_id: 1, warehouse_name: "库房", asset_type_id: rows[0].id, type_name: "排泥钢管 Φ114", status: "low" });
});
```

- [ ] **Step 2: 运行确认失败，实现，运行确认通过**

Run: `cd packages/api && npm test -- test/warehouse-material.test.ts && npm run typecheck && npm run lint`

- [ ] **Step 3: 提交**

```bash
git add packages/api/src/services/warehouse/material.ts packages/api/src/routes/wh-material.ts packages/api/src/routes/wh-app.ts packages/api/test/warehouse-material.test.ts
git commit -m "feat: 物资档案"
```

### Task 6: 任务

**Files:**
- Modify: `packages/api/src/services/serial.ts`（加 `generateSerials`）
- Create: `packages/api/src/services/warehouse/task.ts`
- Create: `packages/api/src/routes/wh-task.ts`
- Modify: `packages/api/src/routes/wh-app.ts`、`packages/api/test/helpers/warehouse-harness.ts`（`seed.task`）
- Test: `packages/api/test/warehouse-task.test.ts`

**Interfaces:**
- Produces:

```ts
// services/serial.ts —— 格式同 generateSerial，一次取 count 个连续号
export const generateSerials: (db: D1Database, prefix: string, tableName: string, columnName: string, count: number) => Promise<string[]>;

// services/warehouse/task.ts
export const TASK_SYSTEMS: readonly ["hydraulic", "electric", "drive", "other"];
export interface TaskDraft {
  kind: WhTask["kind"]; source: WhTask["source"]; title: string; description: string | null;
  device_id: number | null; blocking: 0 | 1; required_photo_count: number; due_date: string | null;
  assignee_userid: string | null; parent_task_id: number | null; origin_doc_id_sql: string | null;
}
/** 给别的批处理用（返库单、检查不合格转维修）。origin_doc_id_sql 是取单据 id 的子查询文本。 */
export const buildTaskInsert: (db: D1Database, draft: TaskDraft, taskNo: string, operatorUserid: string, now: string) => D1PreparedStatement;
export const createTask: (env: Env, input: unknown, operatorUserid: string) => Promise<{ id: number; task_no: string }>;
export const assignTask: (env: Env, id: number, input: unknown, operatorUserid: string) => Promise<void>;
export const addTaskPhoto: (env: Env, id: number, input: unknown, auth: AuthTokenPayload, caps: WarehouseCapabilities) => Promise<{ id: number }>;
export const removeTaskPhoto: (env: Env, id: number, photoId: number, auth: AuthTokenPayload) => Promise<void>;
export const submitTask: (env: Env, id: number, input: unknown, auth: AuthTokenPayload, caps: WarehouseCapabilities) => Promise<{ status: "submitted" | "done"; followup_task_id: number | null }>;
export const confirmTask: (env: Env, id: number, input: unknown, operatorUserid: string) => Promise<{ followup_task_id: number | null }>;
export const sendBackTask: (env: Env, id: number, input: unknown, operatorUserid: string) => Promise<void>;
export const cancelTask: (env: Env, id: number, input: unknown, operatorUserid: string) => Promise<void>;
export type TaskRow = WhTask & { device_code: string | null; device_name: string | null; photo_count: number };
export const listTasks: (env: Env, query: Record<string, string | undefined>, userid: string) => Promise<{ items: TaskRow[]; total: number; page: number; pageSize: number }>;
export const getTask: (env: Env, id: number) => Promise<(TaskRow & { photos: WhTaskPhoto[] }) | null>;
```

规则：

- 任务号前缀 `KFR`。
- 新建默认值：检查和维修 `blocking = 1`，保养和其他 `blocking = 0`；可以在请求里覆盖。`title` 上限 80，`description` 上限 500，`required_photo_count` 0 到 9。
- 所有改状态的操作都要求请求体带 `version`，在批处理里先断言 `id、version、status` 都对得上，再更新并把 `version` 加一。对不上返回 409（由 `handleWarehouseError` 处理）。
- `assignTask`：只能改 `todo` 的任务。
- 照片：只有执行人或库管能加；只有上传人本人、且任务是 `todo` 时能删（软删）。`file_key` 必须以 `wh-task/` 开头。
- `submitTask`：
  - 只有执行人或库管能提交，任务必须是 `todo`。
  - 未删除的照片数不少于 `required_photo_count`，否则 400 `还差 <n> 张照片`。
  - `result_note` 必填，上限 800。
  - 检查任务必须给 `result`；维修任务必须给非空的 `systems`，取值在 `TASK_SYSTEMS` 内。
  - 提交人有 `is_keeper` 时直接 `done`，否则 `submitted`。
- `confirmTask`：`submitted` 变 `done`。
- 变成 `done` 时，同一个批处理里：
  - 有设备的任务写一条时间线，`event_type` 为 `task_done`。`summary`：检查合格写 `检查合格`，检查不合格写 `检查不合格，已转维修`，其他写 `<任务标题>已完成`。
  - 检查不合格时用 `buildTaskInsert` 建一个维修任务：`source` 为 `followup`，`blocking` 为 1，标题 `维修：<设备名称>`，无执行人，`parent_task_id` 指向检查任务，`required_photo_count` 取设置里的值。
- `sendBackTask`：`submitted` 变回 `todo`，`review_note` 必填（上限 300），`supplement_round` 加一。
- `cancelTask`：`todo` 或 `submitted` 变 `cancelled`，`reason` 必填（上限 300）；有设备时写时间线 `任务取消：<原因>`。
- `listTasks`：`scope=mine` 只看执行人是自己的；`scope=all` 看全部。支持 `status`、`device_id`、`kind`、分页。排序：未完成的在前，其次按 `due_date` 升序。

接口：

| 方法和路径 | 权限 |
|---|---|
| `GET /warehouse/task`、`GET /warehouse/task/:id` | 读 |
| `POST /warehouse/task`、`POST .../:id/assign`、`/confirm`、`/send-back`、`/cancel` | `requireKeeper` |
| `POST .../:id/photo`、`DELETE .../:id/photo/:photoId`、`POST .../:id/submit` | `requireHuman`，具体资格由 service 判断，不符返回 403 `只有执行人可以操作` |

- [ ] **Step 1: 写失败的测试**

```ts
it("检查和维修默认阻塞，保养和其他默认不阻塞", async () => {});
it("照片不够不能提交", async () => {
  await expect(submitTask(...)).rejects.toMatchObject({ status: 400, message: "还差 2 张照片" });
});
it("检查任务不选结果不能提交；维修任务不选系统不能提交", async () => {});
it("执行人不是库管：提交后待确认，确认后完成", async () => {});
it("执行人是库管：提交即完成", async () => {});
it("检查不合格完成时生成阻塞的维修任务，设备显示维修中", async () => {
  const { followup_task_id } = await submitTask(h.env, id, { result: "fail", result_note: "主轴漏油", version: 0 }, keeperAuth, keeperCaps);
  const followup = await getTask(h.env, followup_task_id);
  expect(followup).toMatchObject({ kind: "maintenance", source: "followup", blocking: 1, status: "todo", assignee_userid: null, parent_task_id: id });
  expect((await getDevice(h.env, deviceId)).state).toBe("repairing");
});
it("检查合格完成后设备回到可用", async () => {});
it("退回补充：必须写要求，回到待执行，轮次加一，照片保留", async () => {});
it("取消阻塞任务后设备回到可用，并写时间线", async () => {});
it("版本号不对返回 409", async () => {
  await expect(assignTask(h.env, id, { assignee_userid: "u2", version: 99 }, "keeper")).rejects.toSatisfy(isGuardFailure);
});
it("别人上传的照片不能删；已提交的任务不能删照片", async () => {});
it("非执行人提交得到 403", async () => {});
it("generateSerials 一次返回连续的号", async () => {
  expect(await generateSerials(h.env.DB, "KFR", "wh_task", "task_no", 3)).toEqual([expect.stringMatching(/-0001$/), expect.stringMatching(/-0002$/), expect.stringMatching(/-0003$/)]);
});
```

- [ ] **Step 2: 运行确认失败，实现，运行确认通过**

Run: `cd packages/api && npm test -- test/warehouse-task.test.ts test/warehouse-device.test.ts && npm run typecheck && npm run lint`

- [ ] **Step 3: 提交**

```bash
git add packages/api/src/services/serial.ts packages/api/src/services/warehouse/task.ts packages/api/src/routes/wh-task.ts packages/api/src/routes/wh-app.ts packages/api/test
git commit -m "feat: 库房任务"
```

### Task 7: 库房单：期初和入库

**Files:**
- Create: `packages/api/src/services/warehouse/{doc,doc-query}.ts`
- Create: `packages/api/src/routes/wh-doc.ts`
- Modify: `packages/api/src/routes/wh-app.ts`、`packages/api/src/routes/wh-material.ts`（加流水接口）
- Test: `packages/api/test/warehouse-doc-inbound.test.ts`

**Interfaces:**
- Produces:

```ts
// services/warehouse/doc.ts
export type WhDocType = WhDoc["doc_type"];
export interface WhDocResult { id: number; doc_no: string; replayed: boolean; created_task_ids: number[] }
/** 校验、预查、组批、执行。本任务只支持 opening 和 inbound，其余类型抛 400 "暂不支持这种单据"，由后续任务补上。 */
export const createWhDoc: (env: Env, input: unknown, operatorUserid: string) => Promise<WhDocResult>;

// services/warehouse/doc-query.ts
export type WhDocRow = WhDoc & { project_name: string | null; to_project_name: string | null; reversed_by_doc_no: string | null; line_count: number };
export type WhDocLineRow = WhDocLine & { device_code: string | null; device_name: string | null; material_name: string | null; material_spec: string | null; unit: string | null };
export const listWhDocs: (env: Env, query: Record<string, string | undefined>) => Promise<{ items: WhDocRow[]; total: number; page: number; pageSize: number }>;
export const getWhDoc: (env: Env, id: number) => Promise<(WhDocRow & { lines: WhDocLineRow[] }) | null>;
export const getMaterialLedger: (env: Env, materialId: number, query: Record<string, string | undefined>) => Promise<{ items: (WhDocLineRow & { doc_no: string; doc_type: WhDocType; occurred_at: string; operator_userid: string; project_name: string | null })[]; total: number; page: number; pageSize: number }>;
```

请求体（所有单据类型共用，后续任务沿用）：

```ts
{
  doc_type: WhDocType;
  client_request_id: string;          // 8 到 64 个字符
  project_id?: number; to_project_id?: number;
  counterparty?: string;              // 上限 80
  handover_name?: string;             // 上限 30
  remark?: string;                    // 上限 300
  photo_keys?: string[];              // 最多 9 个，必须以 "wh-doc/" 开头
  occurred_at?: string;               // 不填用当前时间
  device_lines?: { device_id: number; usage_meters?: number; soil_type?: string; note?: string }[];
  material_lines?: { material_id: number; quantity: number; outcome?: "returned" | "lost"; note?: string }[];
}
```

规则：

- 单号前缀 `KFD`。
- 幂等：先按 `client_request_id` 查，查到就返回那张单且 `replayed: true`。批处理撞 `client_request_id` 唯一约束时同样处理。撞单号唯一约束时重新取号重试一次。
- 批处理里的行用 `(SELECT id FROM wh_doc WHERE client_request_id = ?)` 取单头 id。
- 物资行先 `UPDATE material SET quantity = quantity + ?`，再插行；行的 `balance_after` 用 `(SELECT quantity FROM material WHERE id = ?)`。
- 通用校验：设备行和物资行合计至少一行，最多 200 行，否则 400 `请至少添加一行` / `一张单最多 200 行`；同一物资在同一 `outcome` 下只能出现一次，否则 400 `同一物资在一张单里只能出现一次`；同一设备只能出现一次；引用的物资必须存在且启用，否则 400 `物资已停用：<品名 规格>`。
- `opening`、`inbound`：不能有设备行（400 `入库单不能包含设备`）；每行 `stock_delta = +quantity`，`project_delta = 0`，`outcome = normal`。

接口：

| 方法和路径 | 权限 |
|---|---|
| `POST /warehouse/doc` | `requireKeeper`。`scrap`、`unscrap`、`adjust` 三种类型不走这个接口，传了返回 400 `不能直接创建这种单据` |
| `GET /warehouse/doc`（按 `doc_type`、`project_id`、`keyword` 单号、日期范围筛选）、`GET /warehouse/doc/:id` | 读 |
| `GET /warehouse/material/:id/ledger` | 读 |

- [ ] **Step 1: 写失败的测试**

```ts
it("入库两行：数量增加，行上记录变化和余额", async () => {
  const a = h.seed.material({ quantity: 5 });
  const b = h.seed.material({ name: "卡扣", quantity: 0 });
  const result = await createWhDoc(h.env, { doc_type: "inbound", client_request_id: "req-00000001", material_lines: [{ material_id: a, quantity: 2.5 }, { material_id: b, quantity: 60 }] }, "keeper");
  expect(result).toMatchObject({ replayed: false, doc_no: expect.stringMatching(/^KFD-\d{8}-0001$/) });
  const doc = await getWhDoc(h.env, result.id);
  expect(doc.lines.map((l) => [l.stock_delta, l.balance_after, l.project_delta])).toEqual([[2.5, 7.5, 0], [60, 60, 0]]);
});
it("同一个 client_request_id 再提交：返回同一张单，数量不再变", async () => {
  const first = await createWhDoc(h.env, input, "keeper");
  const second = await createWhDoc(h.env, input, "keeper");
  expect(second).toMatchObject({ id: first.id, replayed: true });
  expect((await getMaterial(h.env, a)).quantity).toBe(7.5);
});
it.each([
  [{ material_lines: [] }, "请至少添加一行"],
  [{ material_lines: [{ material_id: 1, quantity: "25米" }] }, "数量必须是大于 0 的数字，最多 3 位小数"],
  [{ material_lines: [{ material_id: 1, quantity: 1 }, { material_id: 1, quantity: 2 }] }, "同一物资在一张单里只能出现一次"],
  [{ device_lines: [{ device_id: 1 }], material_lines: [{ material_id: 1, quantity: 1 }] }, "入库单不能包含设备"],
  [{ client_request_id: "x", material_lines: [{ material_id: 1, quantity: 1 }] }, "client_request_id"]
])("拒绝 %j", async (patch, message) => {
  await expect(createWhDoc(h.env, { ...valid, ...patch }, "keeper")).rejects.toMatchObject({ status: 400, message: expect.stringContaining(message) });
});
it("停用的物资不能入库，报错带品名和规格", async () => {});
it("被拒绝的请求不留下任何单据和数量变化", async () => {});
it("流水按时间倒序，带单号、类型和项目名", async () => {});
it("操作员提交得到 403；智能体令牌得到 403", async () => {});
```

- [ ] **Step 2: 运行确认失败，实现，运行确认通过**

Run: `cd packages/api && npm test -- test/warehouse-doc-inbound.test.ts && npm run typecheck && npm run lint`

- [ ] **Step 3: 提交**

```bash
git add packages/api/src/services/warehouse/doc.ts packages/api/src/services/warehouse/doc-query.ts packages/api/src/routes/wh-doc.ts packages/api/src/routes/wh-material.ts packages/api/src/routes/wh-app.ts packages/api/test/warehouse-doc-inbound.test.ts
git commit -m "feat: 库房单的期初和入库"
```

### Task 8: 库房单：发货、返库、转场

**Files:**
- Create: `packages/api/src/services/warehouse/{doc-move,holdings}.ts`
- Modify: `packages/api/src/services/warehouse/doc.ts`（按类型分派到 `doc-move.ts`）、`packages/api/src/routes/wh-doc.ts`（加在场接口）
- Test: `packages/api/test/warehouse-doc-move.test.ts`

**Interfaces:**
- Consumes: `DEVICE_DISPATCHABLE_EXISTS_SQL`、`buildTaskInsert`、`generateSerials`、`getWarehouseSettings`。
- Produces:

```ts
// services/warehouse/holdings.ts
export interface MaterialHolding { material_id: number; material_code: string; name: string; spec: string; unit: string; holding: number }
export const getProjectHoldings: (env: Env, projectId: number) => Promise<{ devices: DeviceRow[]; materials: MaterialHolding[] }>; // 只含在场数大于 0 的周转件
/** 断言用：项目 ? 名下物资 ? 的在场数不少于 ?。绑定三个参数。 */
export const HOLDING_AT_LEAST_EXISTS_SQL: string;
```

在场数 = `wh_doc_line` 里该项目、该物资的 `project_delta` 之和。

各类型的规则（`out`、`back`、`transfer` 至少要有一行，设备行物资行都可以）：

| | `out` 发往项目 | `back` 项目返库 | `transfer` 项目间转场 |
|---|---|---|---|
| 必填 | `project_id` | `project_id` | `project_id`、`to_project_id`，两者不同 |
| 设备前置 | 可发出（在库且无阻塞任务） | 在该项目 | 在来源项目 |
| 设备结果 | 位置改为该项目 | 位置改为在库 | 位置改为目的项目 |
| 时间线 | `dispatched`，`发往<项目名>` | `returned`，`从<项目名>返库` | `transferred`，`从<甲>转到<乙>` |
| 周转件 | 在库减，项目在场加 | `returned`：在库加、在场减；`lost`：在库不变、在场减 | 来源在场减、目的在场加，各一行，在库不变 |
| 消耗件 | 在库减，在场不变 | 只允许 `returned`：在库加 | 不允许 |

- 设备前置和在场数前置都用 `assertInBatch` 写进批处理；设备更新带 `version = version + 1`。
- `back` 的物资行必须带 `outcome`；同一周转件的退回数加报损数不能超过在场数。
- `back` 每台设备建一个检查任务（设备已有未完成的检查任务则不建）：`kind` `inspection`、`source` `return`、`blocking` 1、标题 `返库检查：<设备名称>`、`required_photo_count` 和执行人取设置（没设默认检查人就派给操作人）、`due_date` 为单据日期后两天、`origin_doc_id` 指向这张单。任务号用 `generateSerials` 一次取够。返回值的 `created_task_ids` 是这些任务的 id。
- `back` 的设备行可以带 `usage_meters`（0 到 100000）和 `soil_type`（上限 50）。

错误文案（都在批处理之前的预查里给出）：

| 情况 | 状态码和文案 |
|---|---|
| 库存不足 | 400 `库存不足：<品名 规格>，在库 <n>` |
| 设备有阻塞任务 | 409 `<编号> 有未完成的<检查或维修>任务，不能发出` |
| 设备不在库 | 409 `<编号> 不在库` |
| 设备不在该项目 | 409 `<编号> 不在该项目，现在在：<项目名或"库房">` |
| 超过在场数 | 400 `<品名 规格> 在场只有 <n>` |
| 消耗件报损 | 400 `耗材不需要报损：<品名>` |
| 消耗件转场 | 400 `耗材不能转场：<品名>` |
| 转场两个项目相同 | 400 `来源和目的项目不能相同` |
| 缺项目 | 400 `请选择项目` |

预查通过但批内断言失败（并发），由 `handleWarehouseError` 返回 409 `数据已变化，请刷新后重试`。

接口：`GET /warehouse/project/:projectId/holdings`，读权限。

- [ ] **Step 1: 写失败的测试**

```ts
it("发货：设备到项目，周转件记到项目名下，耗材只扣库存", async () => {
  /* 断言 device.location/current_project_id、时间线 summary、material.quantity、getProjectHoldings */
});
it("库存不足时整单失败，设备也没有动", async () => {
  await expect(createWhDoc(...)).rejects.toMatchObject({ status: 400, message: "库存不足：排泥钢管 Φ114，在库 10" });
  expect((await getDevice(h.env, deviceId)).location).toBe("warehouse");
});
it("有阻塞任务的设备不能发出，报错说明是哪种任务", async () => {});
it("两个请求同时发同一台设备：后到的得到 409，设备只有一条发货记录", async () => {
  let injected = false;
  h.hooks.beforeStatement = () => {
    if (injected || !inBatchPhase()) return;
    injected = true;
    directDispatch(h.database, deviceId, otherProjectId); // 直接改库，模拟另一个请求先完成
  };
  await expect(createWhDoc(h.env, outInput, "keeper")).rejects.toSatisfy(isGuardFailure);
  expect(countLines(h.database, deviceId)).toBe(1);
});
it("返库：设备回库并待检，每台生成一个检查任务，顶进距离被记录", async () => {
  const result = await createWhDoc(h.env, { doc_type: "back", project_id, client_request_id: "req-back-001", device_lines: [{ device_id, usage_meters: 320.5, soil_type: "砂卵石" }] }, "keeper");
  expect(result.created_task_ids).toHaveLength(1);
  expect(await getTask(h.env, result.created_task_ids[0])).toMatchObject({ kind: "inspection", source: "return", blocking: 1, required_photo_count: 3, assignee_userid: "keeper", origin_doc_id: result.id });
  expect(await getDevice(h.env, device_id)).toMatchObject({
    state: "pending_inspection",
    usage_meters_total: 320.5,
    usage_records: [{ doc_no: result.doc_no, project_name: "临河 DN1200", usage_meters: 320.5, soil_type: "砂卵石" }]
  });
});
it("设了默认检查人时任务派给他", async () => {});
it("返库选错项目：报错说出设备实际在哪", async () => {});
it("周转件退回 6、报损 2：在库加 6，在场减 8", async () => {});
it("退回加报损超过在场数被拒绝", async () => {});
it("耗材可以退回，不能报损", async () => {});
it("转场：设备换项目，周转件在场数从甲移到乙，在库不变", async () => {});
it("耗材不能转场；来源和目的相同被拒绝", async () => {});
it("在场接口只返回在场数大于 0 的周转件和在该项目的设备", async () => {});
```

并发用例里的 `inBatchPhase` 由测试自己实现：数 `beforeStatement` 被调用的次数，在预查结束后、批处理之前的那一次注入。

- [ ] **Step 2: 运行确认失败，实现，运行确认通过**

Run: `cd packages/api && npm test -- test/warehouse-doc-move.test.ts test/warehouse-doc-inbound.test.ts && npm run typecheck && npm run lint`

- [ ] **Step 3: 提交**

```bash
git add packages/api/src/services/warehouse packages/api/src/routes/wh-doc.ts packages/api/test/warehouse-doc-move.test.ts
git commit -m "feat: 库房单的发货、返库、转场和项目在场"
```

### Task 9: 库房单：报废和冲销

**Files:**
- Create: `packages/api/src/services/warehouse/{doc-scrap,doc-reverse}.ts`
- Modify: `packages/api/src/services/warehouse/doc.ts`、`packages/api/src/routes/wh-doc.ts`、`packages/api/src/routes/wh-device.ts`
- Test: `packages/api/test/warehouse-doc-reverse.test.ts`

**Interfaces:**
- Produces:

```ts
export const scrapDevice: (env: Env, deviceId: number, input: unknown, operatorUserid: string) => Promise<WhDocResult>;   // 生成 scrap 单
export const unscrapDevice: (env: Env, deviceId: number, input: unknown, operatorUserid: string) => Promise<WhDocResult>; // 生成 unscrap 单
export const reverseWhDoc: (env: Env, docId: number, input: unknown, operatorUserid: string) => Promise<WhDocResult>;
```

三个函数的请求体都要带 `client_request_id`，幂等规则同 Task 7。

报废规则：

- `scrapDevice`：设备不能已经是报废状态；`remark` 必填；至少一张照片。结果：位置改为 `scrapped`，项目清空，时间线 `scrapped`，`summary` 为 `报废：<原因>`。
- `unscrapDevice`：设备必须是报废状态。结果：位置改为在库，时间线 `unscrapped`。

冲销规则：

- 只能冲销 `opening`、`inbound`、`out`、`back`、`transfer`；其他类型 400 `这种单据不能冲销`。
- 冲销单本身不能再冲销（400 `冲销单不能再冲销`）；一张单只能冲销一次（409 `这张单已经冲销过`，由 `reverses_doc_id` 的唯一约束兜底）。
- 冲销单的 `doc_type` 与原单相同，`reverses_doc_id` 指向原单，每行的 `stock_delta` 和 `project_delta` 取原行的相反数，`quantity` 不变。
- 物资：在库数量按相反数调整，不够时 400 `库存不足，无法冲销：<品名 规格>`。
- 设备：恢复到原单执行前的位置。前提是这台设备在原单之后没有别的库房单行，否则 409 `<编号> 之后又有新的单据，不能冲销`。
- 冲销 `back` 时，原单生成的检查任务必须仍是 `todo` 且没有照片，否则 409 `返库后的检查任务已经开始，不能冲销`；满足则把这些任务置为 `cancelled`，`cancel_reason` 为 `单据冲销`。
- 时间线写 `reversed`，`summary` 为 `单据 <原单号> 已冲销`。

接口：

| 方法和路径 | 权限 |
|---|---|
| `POST /warehouse/device/:id/scrap` | `requireScrap` |
| `POST /warehouse/device/:id/unscrap` | `requireUnscrap` |
| `POST /warehouse/doc/:id/reverse` | `requireKeeper` |

- [ ] **Step 1: 写失败的测试**

```ts
it("报废必须写原因并带照片；报废后状态是已报废", async () => {});
it("库管不能报废，经理可以；经理不能撤销报废，超管可以", async () => { /* 403 / 201 / 403 / 201 */ });
it("在项目上的设备可以直接报废，项目被清空", async () => {});
it("冲销入库：数量回到原值，原单显示已被哪张单冲销", async () => {
  expect((await getWhDoc(h.env, original.id)).reversed_by_doc_no).toBe(reversal.doc_no);
});
it("入库的东西已经发出去一部分：冲销被拒绝并指出是哪项", async () => {
  await expect(reverseWhDoc(...)).rejects.toMatchObject({ status: 400, message: "库存不足，无法冲销：卡扣 DN114" });
});
it("冲销发货：设备回库，周转件在场数归零，在库数恢复", async () => {});
it("设备发货后又转了场：冲销发货被拒绝", async () => {
  await expect(reverseWhDoc(...)).rejects.toMatchObject({ status: 409, message: "SB-0001 之后又有新的单据，不能冲销" });
});
it("冲销返库：设备回到项目，检查任务被取消", async () => {
  expect(await getTask(h.env, taskId)).toMatchObject({ status: "cancelled", cancel_reason: "单据冲销" });
  expect(await getDevice(h.env, deviceId)).toMatchObject({ location: "project", current_project_id: projectId, usage_records: [], usage_meters_total: 0 });
});
it("检查任务已经有照片：冲销返库被拒绝", async () => {});
it("同一张单冲销两次：第二次 409；冲销单不能再冲销", async () => {});
it("报废单不能冲销", async () => {});
```

- [ ] **Step 2: 运行确认失败，实现，运行确认通过**

Run: `cd packages/api && npm test -- test/warehouse-doc-reverse.test.ts test/warehouse-doc-move.test.ts && npm run typecheck && npm run lint`

- [ ] **Step 3: 提交**

```bash
git add packages/api/src/services/warehouse packages/api/src/routes/wh-doc.ts packages/api/src/routes/wh-device.ts packages/api/test/warehouse-doc-reverse.test.ts
git commit -m "feat: 设备报废和库房单冲销"
```

### Task 10: 导入

**Files:**
- Create: `packages/api/src/services/warehouse/import.ts`
- Modify: `packages/api/src/routes/wh-device.ts`、`packages/api/src/routes/wh-material.ts`
- Test: `packages/api/test/warehouse-import.test.ts`

**Interfaces:**
- Produces:

```ts
export interface ImportRowError { row: number; message: string } // row 从 1 起，对应文件里的数据行
export interface ImportResult { created: number; errors: ImportRowError[]; opening_doc_no: string | null }
export const importDevices: (env: Env, input: unknown, operatorUserid: string) => Promise<ImportResult>;
export const importMaterials: (env: Env, input: unknown, operatorUserid: string) => Promise<ImportResult>;
```

请求体：`{ client_request_id: string, rows: [...] }`，最多 200 行，超过返回 400 `一次最多导入 200 行`。

设备行字段：`device_code`、`name`、`alias`、`category_name`、`machine_type`、`diameter_mm`、`manufacturer`、`model`、`serial_no`、`spec`、`project_name`、`storage_note`、`remark`。
物资行字段：`name`、`spec`、`unit`、`category`、`kind`、`opening_quantity`、`unit_price`、`min_stock`、`storage_note`、`remark`。

规则：

- 全有或全无：任何一行有错就一行都不导入，`created` 为 0，`errors` 列出所有出错的行（不是遇到第一个就停）。接口此时仍返回 200，由前端展示错误表。
- 每行按 Task 4、Task 5 的字段规则校验，报错文案相同。
- 设备：`category_name` 对不上现有类别时自动新建类别。`project_name` 填了就必须与 `project.project_name` 完全相等，对不上报 `找不到项目：<名字>`；对上了设备直接建在该项目。文件内或与库里已有的编号重复，报 `设备编号重复：<编号>`。
- 物资：文件内或与库里已有的"品名 + 规格"重复，报 `品名和规格重复：<品名 规格>`。`opening_quantity` 大于 0 的行合起来生成一张 `opening` 库房单，与新建物资在同一个批处理里；`opening_doc_no` 返回它的单号。
- 整个导入是一个批处理。
- 防止重复导入：
  - 设备：每台导入设备的"建档"时间线把 `ref_type` 写成 `import:<client_request_id>`。导入前先查有没有这个 `ref_type` 的时间线，有就直接返回 `{ created: <条数>, errors: [], opening_doc_no: null }`；批处理里再用 `assertInBatch` 断言"不存在这个 `ref_type`"，兜住两个相同请求同时到达的情况。
  - 物资：期初单的 `client_request_id` 就用请求里的这个值，重放时按它找到期初单并返回第一次的结果。没有期初数量的导入重放时，会因为"品名 + 规格"重复而全部报错，同样不会导入两遍。

接口：`POST /warehouse/device/import`、`POST /warehouse/material/import`，都是 `requireKeeper`。

- [ ] **Step 1: 写失败的测试**

```ts
it("三行里第二行缺名称、第三行口径不是整数：一行都不导入，两个错都报出来", async () => {
  const result = await importDevices(h.env, { client_request_id: "imp-dev-0001", rows }, "keeper");
  expect(result).toEqual({ created: 0, opening_doc_no: null, errors: [{ row: 2, message: "名称不能为空" }, { row: 3, message: expect.stringContaining("口径") }] });
  expect(countDevices(h.database)).toBe(0);
});
it("类别不存在时自动新建；填了项目名的设备直接在项目上", async () => {});
it("项目名对不上时报 找不到项目", async () => {});
it("文件里两行编号相同，或与库里已有的相同，都报重复", async () => {});
it("物资导入带期初数量：生成一张期初单，数量正确", async () => {
  expect(result).toMatchObject({ created: 3, errors: [], opening_doc_no: expect.stringMatching(/^KFD-/) });
});
it("期初数量是 '25米' 的行报错，整批不导入", async () => {
  expect(result.errors).toEqual([{ row: 2, message: "期初数量必须是大于 0 的数字，最多 3 位小数" }]);
});
it("品名和规格重复时报出重复的那一行", async () => {});
it("201 行被拒绝", async () => {});
it("设备导入（不带编号）用同一个 client_request_id 重放：不会多出设备，返回相同的条数", async () => {
  const first = await importDevices(h.env, input, "keeper");
  const second = await importDevices(h.env, input, "keeper");
  expect(second).toEqual({ created: first.created, errors: [], opening_doc_no: null });
  expect(countDevices(h.database)).toBe(first.created);
});
it("物资导入带期初数量时重放：返回同一张期初单，数量不翻倍", async () => {});
```

- [ ] **Step 2: 运行确认失败，实现，运行确认通过**

Run: `cd packages/api && npm test -- test/warehouse-import.test.ts && npm run typecheck && npm run lint`

- [ ] **Step 3: 提交**

```bash
git add packages/api/src/services/warehouse/import.ts packages/api/src/routes/wh-device.ts packages/api/src/routes/wh-material.ts packages/api/test/warehouse-import.test.ts
git commit -m "feat: 设备和物资导入"
```

### Task 11: 总览和权限矩阵

**Files:**
- Create: `packages/api/src/services/warehouse/overview.ts`
- Modify: `packages/api/src/routes/wh-settings.ts`
- Test: `packages/api/test/warehouse-overview.test.ts`、`packages/api/test/warehouse-permission-matrix.test.ts`

**Interfaces:**
- Produces:

```ts
export interface WarehouseOverview {
  tasks_to_confirm: number;          // status = submitted
  tasks_unassigned: number;          // status = todo 且没有执行人
  tasks_overdue: number;             // 未完成且 due_date 早于今天（北京时间）
  devices_pending_inspection: number;
  devices_repairing: number;
  devices_on_project: number;
  low_stock_count: number;
  recent_docs: WhDocRow[];           // 最新 10 张
}
export const getWarehouseOverview: (env: Env) => Promise<WarehouseOverview>;
```

接口：`GET /warehouse/overview`，读权限。

- [ ] **Step 1: 写总览的失败测试**

造好数据后断言每个数字；其中"超期"要用北京时间的今天判断，测试里用 `vi.setSystemTime` 固定在 UTC 16:30（北京时间已是第二天）验证。

- [ ] **Step 2: 写权限矩阵测试**

`warehouse-permission-matrix.test.ts` 用 `it.each` 遍历下面每个写接口和六种身份，请求体可以是空对象。断言：标"否"的得到 403；标"是"的得到的状态码不是 401 也不是 403。

| 接口 | 操作员 | 现场负责人 | 经理 | 库管 | 超管 | 智能体（超管） |
|---|---|---|---|---|---|---|
| `PUT /warehouse/settings`、`POST /warehouse/member`、`DELETE /warehouse/member/u/keeper` | 否 | 否 | 是 | 否 | 是 | 否 |
| `POST /warehouse/device-category`、`POST /warehouse/device`、`PUT /warehouse/device/1`、`POST /warehouse/device/1/note`、`POST /warehouse/device/import` | 否 | 否 | 否 | 是 | 是 | 否 |
| `POST /warehouse/material`、`PUT /warehouse/material/1`、`POST /warehouse/material/import` | 否 | 否 | 否 | 是 | 是 | 否 |
| `POST /warehouse/doc`、`POST /warehouse/doc/1/reverse` | 否 | 否 | 否 | 是 | 是 | 否 |
| `POST /warehouse/task`、`POST /warehouse/task/1/assign`、`/confirm`、`/send-back`、`/cancel` | 否 | 否 | 否 | 是 | 是 | 否 |
| `POST /warehouse/device/1/scrap` | 否 | 否 | 是 | 否 | 是 | 否 |
| `POST /warehouse/device/1/unscrap` | 否 | 否 | 否 | 否 | 是 | 否 |

另加一条：所有 `GET /warehouse/*` 读接口，财务角色得到 200，不带令牌得到 401。

- [ ] **Step 3: 运行确认失败，实现，运行确认通过**

Run: `cd packages/api && npm test && npm run typecheck && npm run lint`
Expected: 后端全部测试通过。

- [ ] **Step 4: 提交**

```bash
git add packages/api/src/services/warehouse/overview.ts packages/api/src/routes/wh-settings.ts packages/api/test/warehouse-overview.test.ts packages/api/test/warehouse-permission-matrix.test.ts
git commit -m "feat: 库房总览接口和权限矩阵测试"
```

### Task 12: Web 基础

**Files:**
- Delete: `packages/web/src/views/warehouse/`、`packages/web/src/views/asset/`、`packages/web/src/api/{warehouse,warehouse-manual,asset}.ts`、`packages/web/src/router/modules/{warehouse,warehouse-assets,asset}.ts`
- Create: `packages/web/src/api/wh/{types,settings,device,material,doc,task}.ts`
- Create: `packages/web/src/router/modules/wh.ts`
- Create: `packages/web/src/views/wh/shared/{labels,csv,qr,useWhAction,useWhCapabilities}.ts`
- Create: 六个占位页面 `packages/web/src/views/wh/{overview,device,material,doc,task,settings}/index.vue` 和 `packages/web/src/views/wh/device/detail.vue`
- Modify: `packages/web/src/views/approval/biz-edit-routes.ts`（删掉 `stock_order` 和 `warehouse_asset_work_order` 两个分支）
- Modify: `packages/web/src/views/welcome/workbench-view.ts`（`ledger` 的路径改为 `/wh/device`，`warehouseTasks` 的路径改为 `/wh/task`、标签改为"库房任务"）
- Modify: `packages/web/src/views/project/equipment-view.vue`、`packages/web/src/views/project/workspace/equipment-panel.vue`（改用 `getProjectHoldings`）
- Test: `packages/web/src/views/wh/shared/{labels,csv,qr,useWhAction}.test.ts`

**Interfaces:**
- Consumes: 后端 Task 3 到 Task 11 的接口。
- Produces（`api/wh/*.ts`）：每个后端接口一个函数，用 `http.request<{ success: boolean; data: T }>(method, url, { data | params })`。类型从 `api/wh/types.ts` 导出，字段与后端一致，类型名：`DeviceState`、`DeviceRow`、`DeviceDetail`、`DeviceEvent`、`DeviceUsageRecord`、`DeviceCategory`、`DeviceImportRow`、`Material`、`MaterialKind`、`MaterialImportRow`、`ImportResult`、`WhDocType`、`WhDocRow`、`WhDocLineRow`、`CreateWhDocInput`、`ProjectHoldings`、`TaskKind`、`TaskStatus`、`TaskSystem`、`TaskRow`、`WarehouseCapabilities`、`WarehouseSettings`、`WarehouseMember`、`WarehouseOverview`。函数名：
  - `settings.ts`：`getWhMe`、`getWhOverview`、`getWhSettings`、`saveWhSettings`、`listWhMembers`、`addWhMember`、`removeWhMember`、`listDeviceCategories`、`createDeviceCategory`、`updateDeviceCategory`
  - `device.ts`：`listDevices`、`getDevice`、`getDeviceByCode`、`createDevice`、`updateDevice`、`importDevices`、`addDeviceNote`、`scrapDevice`、`unscrapDevice`
  - `material.ts`：`listMaterials`、`getMaterial`、`createMaterial`、`updateMaterial`、`importMaterials`、`getMaterialLedger`
  - `doc.ts`：`createWhDoc`、`listWhDocs`、`getWhDoc`、`reverseWhDoc`、`getProjectHoldings`
  - `task.ts`：`listTasks`、`getTask`、`createTask`、`assignTask`、`addTaskPhoto`、`removeTaskPhoto`、`submitTask`、`confirmTask`、`sendBackTask`、`cancelTask`
- Produces（公共模块）：

```ts
// shared/labels.ts
export const DEVICE_STATE_LABELS: Record<DeviceState, string>;
export const DEVICE_STATE_TAG: Record<DeviceState, "success" | "warning" | "danger" | "info">; // 可用 success；待检、暂不可用 warning；维修中 danger；在项目、已报废 info
export const DOC_TYPE_LABELS: Record<WhDocType, string>;   // 期初、入库、发往项目、项目返库、项目间转场、盘点调整、报废、撤销报废
export const TASK_KIND_LABELS: Record<TaskKind, string>;   // 检查、维修、保养、其他
export const TASK_SYSTEM_LABELS: Record<TaskSystem, string>; // 液压、电气、传动、其他
export const MATERIAL_KIND_LABELS: Record<MaterialKind, string>; // 周转、消耗
export const taskStatusLabel: (task: { status: TaskStatus; assignee_userid: string | null; photo_count: number }) => string;
// todo 且无执行人 "待派工"；todo 且有照片 "进行中"；todo 其余 "待执行"；submitted "待确认"；done "已完成"；cancelled "已取消"

// shared/csv.ts
export const parseTable: (text: string) => { headers: string[]; rows: Record<string, string>[] }; // 自动识别制表符或逗号，支持引号、BOM，去首尾空白，跳过空行
export interface MappedRows<T> { rows: T[]; errors: { row: number; message: string }[] }
export const mapDeviceRows: (table: ReturnType<typeof parseTable>) => MappedRows<DeviceImportRow>;
export const mapMaterialRows: (table: ReturnType<typeof parseTable>) => MappedRows<MaterialImportRow>;

// shared/qr.ts
export const deviceQrPayload: (deviceCode: string) => string;        // "HYBC:D:" + 编号
export const parseDeviceQr: (text: string) => string | null;          // 不是设备码返回 null

// shared/useWhAction.ts
export const useWhAction: () => {
  busy: Ref<boolean>;
  /** 失败时用 resolveApiErrorMessage（packages/web/src/utils/api-error.ts）弹出错误并返回 undefined；finally 里复位 busy。 */
  run: <T>(action: () => Promise<T>, options?: { success?: string }) => Promise<T | undefined>;
};

// shared/useWhCapabilities.ts
export const useWhCapabilities: () => { caps: Ref<WarehouseCapabilities | null>; load: () => Promise<void> };
```

导入表格的列名是阶段 0 计划 Task 4 定的中文列名，与请求字段的对应关系：

| 设备列名 | 字段 | 物资列名 | 字段 |
|---|---|---|---|
| 编号 | `device_code` | 品名 | `name` |
| 名称 | `name` | 规格 | `spec` |
| 现场叫法 | `alias` | 单位 | `unit` |
| 类别 | `category_name` | 分节 | `category` |
| 机型 | `machine_type` | 管法 | `kind`（周转 → `turnover`，消耗 → `consumable`） |
| 口径 | `diameter_mm` | 期初数量 | `opening_quantity` |
| 厂家、型号、出厂编号、规格 | `manufacturer`、`model`、`serial_no`、`spec` | 单价 | `unit_price` |
| 所在项目 | `project_name` | 最低库存 | `min_stock` |
| 库位、备注 | `storage_note`、`remark` | 库位、备注 | `storage_note`、`remark` |

路由（`router/modules/wh.ts`，父级标题"库房"，`rank: 16`，图标 `ep:goods`）：`/wh/overview`、`/wh/device`、`/wh/device/:id`（`showLink: false`）、`/wh/material`、`/wh/doc`、`/wh/task`、`/wh/settings`（`showLink: false`）。路由 `name` 用 `WhOverview`、`WhDevice`、`WhDeviceDetail`、`WhMaterial`、`WhDoc`、`WhTask`、`WhSettings`。

- [ ] **Step 1: 写公共模块的失败测试**

```ts
// labels.test.ts
it.each([
  [{ status: "todo", assignee_userid: null, photo_count: 0 }, "待派工"],
  [{ status: "todo", assignee_userid: "u1", photo_count: 0 }, "待执行"],
  [{ status: "todo", assignee_userid: "u1", photo_count: 2 }, "进行中"],
  [{ status: "submitted", assignee_userid: "u1", photo_count: 3 }, "待确认"],
  [{ status: "done", assignee_userid: "u1", photo_count: 3 }, "已完成"],
  [{ status: "cancelled", assignee_userid: null, photo_count: 0 }, "已取消"]
])("任务状态 %j 显示为 %s", (task, label) => expect(taskStatusLabel(task)).toBe(label));

// csv.test.ts
it("从 Excel 粘贴的制表符文本和 CSV 都能解析", () => {
  expect(parseTable("品名\t规格\n排泥钢管\tΦ114\n").rows).toEqual([{ 品名: "排泥钢管", 规格: "Φ114" }]);
  expect(parseTable("﻿品名,规格\n\"卡扣, 带螺栓\",DN114\n\n").rows).toEqual([{ 品名: "卡扣, 带螺栓", 规格: "DN114" }]);
});
it("物资：管法翻成枚举，期初数量不是数字时逐行报错", () => {
  const mapped = mapMaterialRows(parseTable("品名,规格,单位,分节,管法,期初数量\n焊把线,,米,工具,周转,25米\n胶布,塑料,盘,施工消耗材料,消耗,60\n"));
  expect(mapped.errors).toEqual([{ row: 1, message: "期初数量不是数字：25米" }]);
  expect(mapped.rows[0]).toMatchObject({ name: "胶布", kind: "consumable", opening_quantity: 60 });
});
it("缺少必需的列时报出缺哪一列", () => {
  expect(mapMaterialRows(parseTable("品名,规格\n")).errors).toEqual([{ row: 0, message: "缺少列：单位、分节、管法" }]);
});
it("设备：口径不是整数时报错", () => {});

// qr.test.ts
it("生成和解析互逆，别的内容返回 null", () => {
  expect(deviceQrPayload("SB-0012")).toBe("HYBC:D:SB-0012");
  expect(parseDeviceQr("HYBC:D:SB-0012")).toBe("SB-0012");
  expect(parseDeviceQr("https://example.com/12")).toBeNull();
});

// useWhAction.test.ts
it("失败时弹出后端给的中文错误，busy 复位，返回 undefined", async () => {});
it("成功时返回结果并弹出成功提示", async () => {});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/web && npm test -- src/views/wh/shared`

- [ ] **Step 3: 实现公共模块、接口封装、路由和占位页面，删除旧文件，改三处引用**

占位页面只放一个标题，后续任务逐个替换。项目设备面板改成两张表：在场设备（编号、名称、状态）和在场周转件（品名、规格、数量）。

- [ ] **Step 4: 运行确认通过**

Run: `cd packages/web && npm test -- src/views/wh/shared && npm run typecheck && npm run build`
Expected: 全部通过。用 `grep -rn "api/warehouse\|api/asset\|warehouse-assets" packages/web/src` 确认没有残留引用。

- [ ] **Step 5: 提交**

```bash
git add -A packages/web
git commit -m "refactor: Web 下线旧库房页面，搭好新库房的接口封装和公共模块"
```

### Task 13: Web 设置和总览

**Files:**
- Modify: `packages/web/src/views/wh/settings/index.vue`、`packages/web/src/views/wh/overview/index.vue`
- Create: `packages/web/src/views/wh/settings/components/{MemberPanel,CategoryPanel}.vue`

**Interfaces:**
- Consumes: `api/wh/settings.ts`、`useWhAction`、`useWhCapabilities`、现有的 `useWecomUserOptions`（选人）。

页面内容：

- 设置页三块：
  - 人员：库管名单和资料管理员名单，从企微通讯录选人添加，可移除。没有 `can_manage_settings` 的人只读。
  - 设备类别：名称、排序、停用。没有 `is_keeper` 的人只读。
  - 返库检查：默认检查人（可清空）、要求的照片数（0 到 9）。
- 总览页：七个数字卡片（待确认任务、待派工任务、超期任务、待检设备、维修中设备、在项目设备、低库存物资），点击跳到对应页面并带上筛选参数；下方是最近 10 张库房单（单号、类型、项目、时间、操作人）。右上角"设置"按钮进设置页。
- 还没有任何库管时，总览页顶部显示提示"还没有设置库管，请先到设置里添加"。

- [ ] **Step 1: 实现两个页面**

- [ ] **Step 2: 在浏览器里验证**

用 `preview_start` 启动 `api` 和 `web` 两个配置。本地用 `admin` 登录（`POST /api/v1/auth/login/web`）。检查：

1. 设置页添加自己为库管，刷新后还在。
2. 新建类别"顶管机"，重名时出现"类别已存在"。
3. 照片数填 10 保存，出现错误提示，页面不卡住。
4. 用 `operator` 身份登录，设置页全部只读。
5. 总览页数字卡片能点，控制台没有报错。

- [ ] **Step 3: 提交**

```bash
git add packages/web/src/views/wh/settings packages/web/src/views/wh/overview
git commit -m "feat: 库房设置页和总览页"
```

### Task 14: Web 设备

**Files:**
- Modify: `packages/web/src/views/wh/device/index.vue`、`packages/web/src/views/wh/device/detail.vue`
- Create: `packages/web/src/views/wh/device/components/{DeviceFormDialog,DeviceImportDialog,QrPrintDialog,ScrapDialog,DeviceTimeline,DeviceUsagePanel}.vue`
- Create: `packages/web/src/views/wh/device/usage-view.ts`
- Test: `packages/web/src/views/wh/device/usage-view.test.ts`

**Interfaces:**
- Consumes: `api/wh/device.ts`、`api/wh/task.ts`、`mapDeviceRows`、`deviceQrPayload`、现有的 `uploadAttachmentFile`（`packages/web/src/api/upload.ts`，分类用 `wh-doc`）、`qrcode` 依赖。
- Produces:

```ts
// usage-view.ts —— "维修使用记录表"里的维修部分。使用记录直接用 DeviceDetail.usage_records。
export interface RepairGroup { system: TaskSystem; label: string; entries: { done_at: string; task_no: string; note: string }[] }
/** 只取已完成的维修任务；一个任务涉及多个系统时在每个系统下都出现；组按 液压、电气、传动、其他 的顺序，空组不返回。 */
export const buildRepairGroups: (tasks: TaskRow[]) => RepairGroup[];
```

维修任务用 `listTasks({ scope: "all", device_id, kind: "maintenance", status: "done" })` 取。

页面内容：

- 列表页：顶部按状态的页签（全部、可用、待检、维修中、在项目、已报废），带数量；筛选类别和关键字；表格列为编号、名称、现场叫法、类别、机型、口径、状态标签、所在项目。按钮：新增、导入、打印二维码（对勾选的设备）。没有 `is_keeper` 的人看不到这三个按钮。
- 导入对话框：一个文本框，从 Excel 复制粘贴或粘贴 CSV；先在前端用 `mapDeviceRows` 解析并显示错误表，没有前端错误才提交；后端返回的 `errors` 同样显示成表。超过 200 行时分批提交，遇到有错的批就停。
- 二维码打印：A4 纸每页 3 列 8 行，每格是二维码（30 毫米见方）加编号和名称，调用 `window.print()`，打印样式里隐藏页面其他部分。
- 详情页：基本信息和状态标签；未完成的任务；时间线；"维修使用记录"（用 `usage-view.ts`）；报废按钮（只有 `can_scrap` 可见，要填原因并上传照片）；撤销报废按钮（只有 `can_unscrap` 且设备已报废时可见）。发货和返库不在这里做，放一个"去库房单"的链接。

- [ ] **Step 1: 写 `usage-view` 的失败测试**

```ts
it("维修记录按系统分组，一个任务两个系统时两边都有", () => {
  const groups = buildRepairGroups([{ ...doneTask, systems_json: '["hydraulic","drive"]' }]);
  expect(groups.map((g) => [g.label, g.entries.length])).toEqual([["液压", 1], ["传动", 1]]);
});
it("未完成和非维修的任务不出现；没有记录的系统不出现", () => {
  expect(buildRepairGroups([{ ...doneTask, status: "todo" }, { ...doneTask, kind: "inspection" }])).toEqual([]);
});
it("systems_json 不是合法 JSON 时归到 其他", () => {
  expect(buildRepairGroups([{ ...doneTask, systems_json: "oops" }]).map((g) => g.label)).toEqual(["其他"]);
});
```

- [ ] **Step 2: 运行确认失败，实现 `usage-view.ts`，再运行确认通过**

Run: `cd packages/web && npm test -- src/views/wh/device`

- [ ] **Step 3: 实现页面和组件**

- [ ] **Step 4: 在浏览器里验证**

1. 新增一台设备不填编号，得到 `SB-0001`；再建一台填同样编号，出现"设备编号已存在"。
2. 把 `mig/warehouse/设备清单草稿-顶管机.csv` 的内容按定稿列名整理 3 行粘贴导入；故意把一行口径写成"一千二"，看到错误表且一台都没导入；改对后导入成功。
3. 勾选两台，打开打印预览，二维码清晰、每格有编号和名称。用手机扫码得到 `HYBC:D:<编号>`。
4. 详情页能看到"建档"时间线。
5. 用经理身份报废一台，状态变"已报废"；用超管撤销。

- [ ] **Step 5: 提交**

```bash
git add packages/web/src/views/wh/device
git commit -m "feat: 库房设备页（台账、导入、二维码、详情、报废）"
```

### Task 15: Web 物资

**Files:**
- Modify: `packages/web/src/views/wh/material/index.vue`
- Create: `packages/web/src/views/wh/material/components/{MaterialFormDialog,MaterialImportDialog,MaterialLedgerDrawer}.vue`

**Interfaces:**
- Consumes: `api/wh/material.ts`、`mapMaterialRows`、`MATERIAL_KIND_LABELS`、`DOC_TYPE_LABELS`。

页面内容：

- 列表：筛选分节、管法、关键字、"只看低库存"；列为编号、品名、规格、单位、分节、管法、在库数量、最低库存、库位。低库存的行数量标红。数量列不可编辑。
- 新增和编辑对话框：分节是 11 个固定选项的下拉；管法是单选。
- 导入对话框：同设备导入的做法；导入成功后提示"已导入 N 条，期初单号 KFD-…"。
- 流水抽屉：点某条物资打开，列为时间、单号、类型、项目、变化（带正负号）、余额、操作人。

- [ ] **Step 1: 实现页面和组件**

- [ ] **Step 2: 在浏览器里验证**

1. 新增"排泥钢管 Φ114"，再新增同品名同规格，出现"同品名同规格的物资已存在"。
2. 从 `mig/warehouse/物资档案草稿.csv` 取 5 行按定稿列名整理后粘贴导入，其中一行期初数量写"25米"，看到逐行错误；改成 25 后导入成功并显示期初单号。
3. 打开该物资的流水，有一条"期初"，变化为 +25，余额 25。
4. 勾"只看低库存"，只剩数量不高于最低库存的。

- [ ] **Step 3: 提交**

```bash
git add packages/web/src/views/wh/material
git commit -m "feat: 库房物资页（档案、导入、流水）"
```

### Task 16: Web 库房单

**Files:**
- Modify: `packages/web/src/views/wh/doc/index.vue`
- Create: `packages/web/src/views/wh/doc/doc-form-model.ts`
- Create: `packages/web/src/views/wh/doc/components/{DocFormDialog,DevicePicker,MaterialLineTable,DocDetailDrawer}.vue`
- Test: `packages/web/src/views/wh/doc/doc-form-model.test.ts`

**Interfaces:**
- Consumes: `api/wh/doc.ts`、`api/wh/device.ts`、`api/wh/material.ts`、`useProjectOptions`、`uploadAttachmentFile`。
- Produces:

```ts
// doc-form-model.ts
export type DocFormType = "inbound" | "out" | "back" | "transfer";
export interface DocFormState {
  doc_type: DocFormType; client_request_id: string;
  project_id: number | null; to_project_id: number | null;
  counterparty: string; handover_name: string; remark: string; photo_keys: string[];
  devices: { device_id: number; device_code: string; name: string; usage_meters: string; soil_type: string }[];
  materials: { material_id: number; name: string; spec: string; unit: string; kind: MaterialKind; available: number; returned: string; lost: string; quantity: string }[];
}
export const newDocForm: (docType: DocFormType) => DocFormState; // client_request_id 用 crypto.randomUUID()
export const validateDocForm: (state: DocFormState) => string | null; // 返回第一条中文错误，没有错返回 null
export const buildDocPayload: (state: DocFormState) => CreateWhDocInput;
/** 返库时用项目在场清单预填：设备全部带出，周转件带出在场数作为 available。 */
export const prefillBackForm: (state: DocFormState, holdings: ProjectHoldings) => DocFormState;
```

`validateDocForm` 的规则和文案：发货、返库、转场没选项目 → `请选择项目`；转场两个项目相同 → `来源和目的项目不能相同`；一行都没有 → `请至少添加一行`；数量不是正数或超过三位小数 → `<品名> 的数量不对`；发货数量超过在库 → `<品名> 在库只有 <n>`；返库的退回加报损超过在场 → `<品名> 在场只有 <n>`；入库带了设备 → `入库单不能包含设备`。

`buildDocPayload`：返库时一条物资可能拆成两行（`returned` 和 `lost`），数量为 0 的不生成行；空字符串的可选字段不发送。

页面内容：

- 列表：按类型页签筛选，加项目、单号、日期范围；列为单号、类型、项目、行数、领料人、操作人、时间、是否已冲销。
- 四个按钮：入库、发往项目、项目返库、项目间转场。没有 `is_keeper` 的人看不到。
- 录入对话框按类型显示不同字段：
  - 入库：供应商、物资行。
  - 发往项目：项目、领料人、设备（从"可用"设备里搜索选择）、物资行（显示在库数）。
  - 项目返库：选项目后自动带出在场清单；设备勾选要返的，顶管机可填顶进距离和土质；周转件填退回数和报损数；可以另加耗材退回行。
  - 项目间转场：来源项目、目的项目，选完来源后带出在场清单。
- 提交成功后关闭对话框并刷新列表；返库成功时提示"已生成 N 个检查任务"。
- 对话框每次打开都调用 `newDocForm` 取新的 `client_request_id`；提交失败时保留同一个 id，方便重试。
- 详情抽屉：单头、行、照片。库管可见"冲销"按钮，点后二次确认。

- [ ] **Step 1: 写失败的测试**

```ts
it("发货：设备和物资各一行，生成的请求体只含需要的字段", () => {
  expect(buildDocPayload(state)).toEqual({
    doc_type: "out", client_request_id: state.client_request_id, project_id: 7, handover_name: "张三",
    device_lines: [{ device_id: 1 }], material_lines: [{ material_id: 3, quantity: 120 }]
  });
});
it("返库：退回 6 报损 2 拆成两行，都为 0 的不生成", () => {
  expect(buildDocPayload(state).material_lines).toEqual([
    { material_id: 3, quantity: 6, outcome: "returned" },
    { material_id: 3, quantity: 2, outcome: "lost" }
  ]);
});
it.each([
  [{ project_id: null }, "请选择项目"],
  [{ devices: [], materials: [] }, "请至少添加一行"],
  [{ materials: [{ ...line, quantity: "25米" }] }, "排泥钢管 的数量不对"],
  [{ materials: [{ ...line, available: 10, quantity: "12" }] }, "排泥钢管 在库只有 10"]
])("发货表单 %j 报 %s", (patch, message) => expect(validateDocForm({ ...valid, ...patch })).toBe(message));
it("返库：退回加报损超过在场数时报错", () => {
  expect(validateDocForm(backState)).toBe("顶镐 在场只有 4");
});
it("用在场清单预填返库表单", () => {});
it("每次新建表单的 client_request_id 都不同", () => {});
```

- [ ] **Step 2: 运行确认失败，实现 `doc-form-model.ts`，再运行确认通过**

Run: `cd packages/web && npm test -- src/views/wh/doc`

- [ ] **Step 3: 实现页面和组件**

- [ ] **Step 4: 在浏览器里验证完整闭环**

1. 入库：给"排泥钢管 Φ114"入库 200。物资页数量变 200。
2. 发往项目：选一个项目，选一台可用设备和 120 米排泥钢管，提交。设备状态变"在项目"，物资数量变 80。
3. 再发同一台设备：设备选择器里找不到它。
4. 项目返库：选同一项目，自动带出那台设备和 120 米；填退回 100、报损 20，设备填顶进距离 320。提交后提示"已生成 1 个检查任务"；设备状态变"待检"；物资数量变 180。
5. 详情抽屉里点冲销刚才的入库单：因为数量已变动，出现后端给的"库存不足，无法冲销…"提示。
6. 快速连点两次提交按钮：只生成一张单。

- [ ] **Step 5: 提交**

```bash
git add packages/web/src/views/wh/doc
git commit -m "feat: 库房单页（入库、发货、返库、转场、冲销）"
```

### Task 17: Web 任务

**Files:**
- Modify: `packages/web/src/views/wh/task/index.vue`
- Create: `packages/web/src/views/wh/task/components/{TaskFormDialog,TaskDetailDrawer,AssignDialog,SubmitPanel}.vue`

**Interfaces:**
- Consumes: `api/wh/task.ts`、`taskStatusLabel`、`TASK_KIND_LABELS`、`TASK_SYSTEM_LABELS`、`useWecomUserOptions`、`uploadAttachmentFile`（分类 `wh-task`）。

页面内容：

- 列表：页签"我的"和"全部"；状态筛选（待派工、待执行、待确认、已完成、已取消）；列为任务号、类型、标题、设备（编号和名称）、执行人姓名、期限、状态、照片数/要求数。超期的期限标红。
- 库管可见"新建任务"：类型、标题、设备（可不选）、说明、是否阻塞、照片要求、期限、执行人。
- 详情抽屉：
  - 任务信息、设备、退回要求（有 `review_note` 时用醒目的提示框显示）。
  - 照片缩略图，可预览；执行人在待执行状态下可上传和删除自己的照片。
  - 执行人的提交区：检查任务选合格或不合格；维修任务勾选系统；简报；提交按钮。
  - 库管的操作：派工或改派、确认完成、退回补充（必须写要求）、取消（必须写原因）。
- 每个操作都带上当前的 `version`；后端返回 409 时提示"数据已变化，请刷新后重试"并自动重新加载这条任务。

- [ ] **Step 1: 实现页面和组件**

- [ ] **Step 2: 在浏览器里验证**

接着 Task 16 留下的那个返库检查任务：

1. 用另一个账号（操作员，不是库管）被派到这个任务。照片不够时点提交，出现"还差 3 张照片"。
2. 传 3 张照片，选"不合格"，写简报，提交。状态变"待确认"。
3. 库管点"退回补充"不写要求，被拦住；写了要求后任务回到"待执行"，执行人打开能看到退回要求，照片还在。
4. 执行人再次提交，库管确认。出现一个新的"维修：<设备名>"任务，状态"待派工"；设备页状态变"维修中"。
5. 库管把维修任务派给自己，勾"液压"，写简报提交，直接"已完成"。设备状态回到"可用"，设备详情的维修记录里"液压"下有这一条。

- [ ] **Step 3: 提交**

```bash
git add packages/web/src/views/wh/task
git commit -m "feat: 库房任务页"
```

### Task 18: 收尾和发布

**Files:**
- Modify: `doc/UI设计文档.md`（库房章节换成新的六个页面）
- Modify: `doc/开发记录.md`（追加本阶段记录）
- Modify: `doc/库房与资产重构进度与下一阶段.md`（文件顶部加一行：本文档描述的旧模块已于阶段 1 下线，现行设计见 `docs/superpowers/specs/2026-11-11-warehouse-rebuild-design.md`）
- Modify: `docs/superpowers/specs/2026-11-11-warehouse-rebuild-design.md`（把阶段 1 状态标为已完成，并记录实施中与设计不一致的地方）

- [ ] **Step 1: 全量校验**

Run:
```bash
cd packages/api && npm run typecheck && npm test && npm run lint && node scripts/check-migration-numbers.mjs
cd ../web && npm run typecheck && npm test && npm run build
cd ../mcp && npm test
```
Expected: 全部通过。`packages/mcp` 没有改动，它的测试用来确认没有被连带破坏。

- [ ] **Step 2: 在浏览器里走一遍设计稿的完成标准**

用库管身份，从空库开始：建类别和设备，导入物资，发货，返库，检查，确认。控制台和 `preview_logs` 都没有报错。截图存档。

- [ ] **Step 3: 更新文档并提交，开 PR**

```bash
git add doc docs
git commit -m "docs: 库房重做阶段 1 的记录和界面文档"
git push -u origin feat/warehouse-phase1-core
```

PR 描述里写清：新增迁移 0095；旧接口占位到阶段 3；已发布的小程序库房页会显示空数据；删表在另一个 PR。

- [ ] **Step 4: 发布（需要 owner 明确同意）**

1. 切到只含本批迁移的分支，执行迁移：`cd packages/api && npx wrangler d1 migrations apply hybcdg-prod-db --remote --env prod`。
2. 合并 PR（合并即部署）。部署后访问 `https://api.hybcdg.com/api/v1/system/health`，要求 `ok=true`。
3. 由经理或超管在"库房 → 设置"里把李震加为库管。
4. 李震在 Web 上按阶段 0 的定稿导入设备和物资，并做一次真实的发货、返库、检查。

### Task 19: 删除旧表（单独的 PR，owner 验收阶段 1 之后）

**Files:**
- Create: `packages/api/migrations/0096_warehouse_legacy_drop.sql`
- Modify: `packages/api/scripts/mock-data.sql`（约第 452 到 740 行：删掉往旧表插数据的语句，换成新表的示例数据）
- Test: `packages/api/test/warehouse-legacy-drop.test.ts`

**Interfaces:**
- Consumes: Task 2 加在 `test/approval-admin-all.test.ts` 里的用例"旧业务类型的历史审批单不影响列表"，删表后它必须仍然通过。

迁移内容：`DROP TABLE IF EXISTS` 下面这些表，按"先删引用别人的，再删被引用的"排列：

`warehouse_task_evidence`、`warehouse_task_step`、`warehouse_task_package`、`warehouse_manual_binding`、`warehouse_manual_version`、`warehouse_manual`、`warehouse_asset_work_order`、`stocktake_line`、`stocktake_task`、`project_equipment_plan_item`、`project_equipment_plan`、`inventory_consumption`、`stock_order_item`、`stock_order`、`inventory`、`asset_rental_term`、`asset_compatibility_rule`、`tracked_asset_configuration`、`tracked_asset_document`、`tracked_asset_event`、`tracked_asset`、`asset_type`、`warehouse`。

再加一句：`DELETE FROM approval_template WHERE biz_type IN ('stock_order', 'warehouse_asset_work_order');`

`mock-data.sql` 的新示例数据：3 个设备类别、6 台设备（其中 2 台在示例项目上）、12 条物资（周转和消耗各半，带数量），编号都用 `MOCK-` 前缀，保持脚本可重复执行。

- [ ] **Step 1: 写失败的测试**

```ts
it("迁移之后旧表都不存在，新表都在", () => {
  const names = h.database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
  for (const dropped of ["tracked_asset", "asset_type", "stock_order", "inventory", "warehouse", "warehouse_asset_work_order", "warehouse_manual"]) {
    expect(names).not.toContain(dropped);
  }
  for (const kept of ["device", "material", "wh_doc", "wh_task", "warehouse_member"]) {
    expect(names).toContain(kept);
  }
});
it("旧业务类型的审批模板被清掉", () => {});
```

- [ ] **Step 2: 运行确认失败，写迁移，改 mock 数据，运行确认通过**

Run: `cd packages/api && npm test && npm run db:migrate:local && npm run db:seed:mock:local`
Expected: 全部测试通过（包括 `approval-admin-all.test.ts` 里那条旧业务类型的用例）；本地迁移和造数都成功。

- [ ] **Step 3: 提交并开 PR**

```bash
git add packages/api/migrations/0096_warehouse_legacy_drop.sql packages/api/scripts/mock-data.sql packages/api/test/warehouse-legacy-drop.test.ts
git commit -m "chore: 删除旧库房和资产表"
```

- [ ] **Step 4: 在生产执行（需要 owner 两次确认）**

1. 先经 owner 同意查生产库，统计上面每张旧表的行数，把结果给 owner 看。有行数不为零的表，由 owner 决定是否需要先导出。
2. owner 确认后，切到只含本批迁移的分支执行迁移，再合并 PR。
3. 访问健康检查接口，并打开 Web 的审批列表确认正常。
