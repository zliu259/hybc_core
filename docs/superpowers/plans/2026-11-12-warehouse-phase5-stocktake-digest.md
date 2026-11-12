# 库房重做 阶段 5：盘点、每日摘要、MCP 工具和收尾 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 库管能在 Web 和手机上做一次盘点（物资录实盘数、设备扫码），完成时系统自动出一张盘点调整单把账面改对；全体库管每天早上 8 点收到一张摘要卡片；智能体的库房工具对齐新模型。旧接口占位和旧表在各自的条件满足后删掉。

**Architecture:** 新表 `stocktake`、`stocktake_material_line`、`stocktake_device_line`（迁移 0098）。发起盘点时用 `INSERT ... SELECT` 一次建好所有行；录数时记下那一刻的账面数；完成时用几条按集合写的 SQL 在一个批处理里出 `adjust` 库房单、改库存、写设备时间线、改盘点状态，语句条数不随物资数量增长。每日摘要是 `WAREHOUSE_NOTICE` 事件的一个新种类，由每小时的定时任务在北京时间 8 点发进队列，沿用现有的投递和开关。MCP 把 `list_stock_orders` 换成 `list_devices`。

**Tech Stack:** Hono + D1 + KV + Queue（`packages/api`）、Vue 3 + Element Plus（`packages/web`）、原生企微小程序（`packages/miniapp`）、`@hybc/mcp`（`packages/mcp`）、Vitest、`node:sqlite` 测试夹具、小程序 node assert 测试。

**Spec:** `docs/superpowers/specs/2026-11-11-warehouse-rebuild-design.md`（6.1 的「盘点」、6.3、7.8、8.2 第一条、9、10 的每日摘要、11 的「盘点」、12 第 7 条、13、14、15、17 第 13 条、18）

**前置：** 阶段 1 到 4A 已上线（迁移 0095 到 0097，PR #24、#25、#28、#29）。沿用它们的约定：`guarded`、`handleWarehouseError`、`WarehouseError`、`badRequest`、`pathId`、`readJsonBody`、`requireHuman`、`requireKeeper`、`runAtomicBatch`、`assertInBatch`、`releaseGuards`、`executeDoc`、`generateSerials`、`publishWarehouseNotice`、`createWarehouseHarness`、`callWh`、小程序的 `createPageHarness`、`wh-wxml.test.js`、Web 的 `useWhAction`、`useWhCapabilities`。

## Global Constraints

- 迁移 `0098_warehouse_stocktake.sql` 只建三张盘点表和索引，外加 `wh_doc(stocktake_id)` 上的一个索引。不动别的表。迁移先于合并执行，需要 owner 同意。
- 新表叫 `stocktake`、`stocktake_material_line`、`stocktake_device_line`。生产库里还有旧表 `stocktake_task`、`stocktake_line`（Task 13 才删），名字不冲突，代码里不许碰这两张旧表。
- 同一时间只能有一个进行中的盘点，由数据库的唯一索引保证，不只靠先查后写。
- 完成盘点是一个批处理：出调整单、改库存、写设备时间线、改盘点状态要么都成、要么都不成。批里的语句按集合写（`UPDATE ... WHERE id IN (SELECT ...)`、`INSERT ... SELECT`），不许按行拼语句：物资有 300 多条，D1 一条语句最多绑定 100 个参数。
- 差额 = 实盘数 − 录入实盘数那一刻的账面数（`book_qty`），不是 − 完成那一刻的账面数（设计稿第 17 节第 13 条）。数量一律 `ROUND(x, 3)`。
- 设备盘点只出报告：不改设备位置，不建任务。
- 权限（设计稿第 9 节）：盘点的所有写接口先过 `requireHuman` 再过 `requireKeeper`；看盘点是全部五个角色。智能体令牌没有任何盘点接口（不在只读白名单里，保持这样）。
- 接口返回 `{ success, data }`，列表带 `pagination`；错误 `message` 是中文，界面上不出现英文枚举值和数字 ID。
- 小程序页面路径 `packageWarehouse/stocktake/index` 是设计稿定的，不能改名。主包只许多首页的一个入口（主包紧贴 2 MB）。
- 每日摘要受现有的 `warehouse.notify_enabled` 开关管，开关关着不发；没有内容不发；库管名单为空不发。
- 单个路由、service、视图、页面文件不超过 400 行。不用 `as any`、`@ts-ignore`。不改已有对象，返回新对象。
- 用到 `node:sqlite` 的测试包在 `describe.skipIf(!hasSqlite)` 里，推送前本地必须跑。小程序测试 `cd packages/miniapp && npm run test:wh`（不在 CI 里）。
- 提交信息格式 `<type>: <description>`，不加 AI 署名。分支 `feat/warehouse-phase5-stocktake`，从最新的 `origin/main` 切出，开 PR，不直接推 `main`。
- Task 1 到 11 是主 PR。**Task 12、13 各自单独的分支和 PR，闸门没开不要做**，主 PR 的整分支审查不等它们。

**设计稿没写死、本计划定下的地方（实施时如有不同意见，先改这里）：**

1. 发起盘点时就把行建好：范围含物资时给每条启用中的物资建一行（实盘数为空），范围含设备时给每台账上在库的设备建一行（`expected = 1`）。发起之后新建的物资不在这次盘点里。
2. 录数时界面上显示账面数（不做盲盘）：库管只有一个人，原则是操作简单。
3. `stocktake` 多三列：`version`（每次改这次盘点或它的行都加一，完成时核对）、`cancel_reason`、取消人和时间。取消原因可以不填。
4. 完成盘点的请求带上页面看到的 `version`。和别人的录入撞上时返回 409，刷新后再点。完成请求可以重发：已经完成的盘点直接返回上次的结果，调整单的 `client_request_id` 固定为 `stocktake-<盘点 id>`，所以最多出一张。
5. 没有差额时不出调整单。一条物资都没录、一台设备都没标记时不让完成，提示去取消。
6. 减库存减不动（完成那一刻账面数不够减）时整批不动，告诉库管是哪一条，让他重新盘这一项。
7. 设备：扫到不在这次盘点行里的设备（账上在项目、已报废，或发起之后才入库的）就加一行 `expected = 0, found = 1`，账上在项目的提示「盘完后补一张返库单」。完成时，账上在库、没被标记找到、而且现在仍然在库的，时间线记「盘点未找到」；盘点期间已经发往项目的不算没找到。可以手动标记「没找到」并写备注。
8. 盘点调整单不能冲销（现在的冲销本来就不认 `adjust`）。调错了就再盘一次。
9. 每日摘要除了设计稿列的四项，证书那一行把「已过期」和「30 天内到期」分开写。摘要的内容在投递那一刻现算。卡片点开，小程序进库房首页，Web 进总览。
10. Web 总览多一个「证书到期」数字，点进去是资料库里只看快到期和已过期的。小程序首页不加新数字（手机上没有设备列表页可以落）。
11. 定时任务用 KV 键 `warehouse:digest:<北京日期>` 防同一天发两次（保留 3 天）。
12. MCP：`warehouse_inventory`、`warehouse_low_stock` 去掉已经没用的两个筛选参数；`list_stock_orders` 换成 `list_devices`（查 `GET /warehouse/device`）。包版本升到 0.2.0。旧版客户端还在调的 `GET /warehouse/stock-order` 占位和白名单条目留到 Task 12。
13. 旧版小程序的盘点页（已下线模块，新版发布前还装在用户手机上）调的也是 `GET /warehouse/stocktake`：新接口接管后它可能把新盘点显示成不完整的行。不为它做兼容。

## Review Focus

1. **盘点期间有出入库。** 录完实盘数之后又发了货：调整量仍按录入那一刻的账面数算，发出去的不会被当成盘亏；如果减不动，整批回滚并指出是哪条物资。盘点期间发往项目的设备不记「盘点未找到」。Task 4。
2. **完成和录入撞在一起、连点两次完成。** 完成的批处理里核对版本，撞上返回 409，不会出现调整单和盘点行对不上；重发完成请求只有一张调整单，库存只改一次。Task 4。
3. **两个人同时发起盘点。** 只有一个成功，另一个得到 409 和进行中那次的单号。Task 2。
4. **扫到不该在库的设备、扫了不是设备的码、一台都没扫就点完成。** 账上在项目的记下来并提示补返库单；查不到的码 404；完成前的确认里写清楚有几台会被记成没找到。Task 3、4、6、7。
5. **每日摘要重复和空发。** 同一小时定时任务跑两次只发一次；开关关着、没有库管、四项都是 0 时不发；企微发送失败时队列重试，重试成功后库管只收到一张。Task 8。

---

### Task 1: 迁移 0098 和类型

**Files:**
- Create: `packages/api/migrations/0098_warehouse_stocktake.sql`
- Modify: `packages/api/src/types/wh.ts`
- Test: `packages/api/test/warehouse-stocktake-schema.test.ts`

**Interfaces:**
- Produces（表）：
  - `stocktake`：`id`、`stocktake_no TEXT NOT NULL UNIQUE`、`scope`（`material`、`device`、`all`）、`status`（`counting`、`done`、`cancelled`，默认 `counting`）、`remark`、`cancel_reason`、`created_by_userid NOT NULL`、`completed_by_userid`、`completed_at`、`cancelled_by_userid`、`cancelled_at`、`version INTEGER NOT NULL DEFAULT 1`、`created_at`、`updated_at`。
  - `stocktake_material_line`：`id`、`stocktake_id NOT NULL`、`material_id NOT NULL`、`counted_qty REAL`、`book_qty REAL`、`note`、`counted_by_userid`、`counted_at`、`created_at`、`updated_at`；`UNIQUE (stocktake_id, material_id)`；`CHECK (counted_qty IS NULL OR counted_qty >= 0)`；`CHECK ((counted_qty IS NULL) = (book_qty IS NULL))`。
  - `stocktake_device_line`：`id`、`stocktake_id NOT NULL`、`device_id NOT NULL`、`expected INTEGER NOT NULL CHECK (expected IN (0, 1))`、`found INTEGER CHECK (found IS NULL OR found IN (0, 1))`、`note`、`scanned_by_userid`、`scanned_at`、`created_at`、`updated_at`；`UNIQUE (stocktake_id, device_id)`。
  - 索引：`CREATE UNIQUE INDEX idx_stocktake_single_counting ON stocktake(status) WHERE status = 'counting'`；`idx_wh_doc_stocktake_id ON wh_doc(stocktake_id)`。
- Produces（`types/wh.ts`）：`StocktakeScope`、`StocktakeStatus`、`Stocktake`、`StocktakeMaterialLine`、`StocktakeDeviceLine`，字段和表一一对应（`expected: 0 | 1`，`found: 0 | 1 | null`）。

- [ ] **Step 1: 写失败的测试**

```ts
describe.skipIf(!hasSqlite)("0098 盘点表", () => {
  it("三张表和两个索引都在", () => {
    const names = h.database.prepare("SELECT name FROM sqlite_master").all().map((r) => r.name);
    for (const name of ["stocktake", "stocktake_material_line", "stocktake_device_line",
      "idx_stocktake_single_counting", "idx_wh_doc_stocktake_id"]) expect(names).toContain(name);
  });
  it("第二个进行中的盘点插不进去，已完成的可以有很多个", () => {
    insert({ stocktake_no: "PD-1", status: "counting" });
    expect(() => insert({ stocktake_no: "PD-2", status: "counting" })).toThrow(/UNIQUE/);
    insert({ stocktake_no: "PD-3", status: "done" });
    insert({ stocktake_no: "PD-4", status: "done" });
  });
  it("实盘数和账面数要么都有要么都没有；实盘数不能是负数", () => {
    expect(() => insertLine({ counted_qty: 3, book_qty: null })).toThrow(/CHECK/);
    expect(() => insertLine({ counted_qty: -1, book_qty: 2 })).toThrow(/CHECK/);
  });
  it("同一次盘点里一条物资、一台设备各只有一行", () => {});
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/api && npm test -- test/warehouse-stocktake-schema.test.ts`
Expected: FAIL，`no such table: stocktake`

- [ ] **Step 3: 写迁移和类型**

- [ ] **Step 4: 运行确认通过，并检查迁移编号**

Run: `cd packages/api && npm test -- test/warehouse-stocktake-schema.test.ts && node scripts/check-migration-numbers.mjs && npm run typecheck`
Expected: PASS；编号检查没有新的重复

- [ ] **Step 5: 提交**

```bash
git add packages/api/migrations/0098_warehouse_stocktake.sql packages/api/src/types/wh.ts packages/api/test/warehouse-stocktake-schema.test.ts
git commit -m "feat: 盘点的三张表（迁移 0098）"
```

---

### Task 2: 发起、列表、详情、取消

**Files:**
- Create: `packages/api/src/services/warehouse/stocktake-query.ts`
- Create: `packages/api/src/services/warehouse/stocktake.ts`
- Test: `packages/api/test/warehouse-stocktake.test.ts`

**Interfaces:**
- Consumes: Task 1 的表和类型；`Paged`（`services/warehouse/device.ts`）；`generateSerials(db, "PD", "stocktake", "stocktake_no", 1)`。
- Produces（`stocktake-query.ts`）：

```ts
export interface StocktakeSummary {
  material_total: number;
  material_counted: number;
  /** 已录且实盘数和账面数不一样的条数 */
  material_diff: number;
  device_expected: number;
  device_found: number;
  /** expected = 1 且 found 不是 1 */
  device_missing: number;
  /** expected = 0 且 found = 1 */
  device_unexpected: number;
}
export type StocktakeRow = Stocktake & StocktakeSummary & {
  adjust_doc_id: number | null;
  adjust_doc_no: string | null;
};
export type StocktakeMaterialLineRow = StocktakeMaterialLine & {
  material_code: string; name: string; spec: string | null; unit: string;
  category: string; storage_note: string | null;
  /** 现在的账面数 */
  current_qty: number;
  /** ROUND(counted_qty - book_qty, 3)，没录是 null */
  diff: number | null;
};
export type StocktakeDeviceLineRow = StocktakeDeviceLine & {
  device_code: string; device_name: string; alias: string | null;
  category_name: string | null; storage_note: string | null;
  location: DeviceLocation; project_name: string | null;
};
export interface StocktakeDetail extends StocktakeRow {
  material_lines: StocktakeMaterialLineRow[];
  device_lines: StocktakeDeviceLineRow[];
}
/** 断言用，绑定一个参数（盘点 id） */
export const STOCKTAKE_COUNTING_EXISTS_SQL: string;
export const listStocktakes: (env: Env, query: Record<string, string | undefined>) => Promise<Paged<StocktakeRow>>;
export const getStocktake: (env: Env, id: number) => Promise<StocktakeDetail | null>;
```

  - `listStocktakes` 认 `status`、`page`、`pageSize`（默认 20，最大 100），新的在前。
  - 行的排序：物资按 `category`、`name`、`spec`；设备按 `device_code`。
- Produces（`stocktake.ts`）：

```ts
export const startStocktake: (env: Env, input: Record<string, unknown>, userid: string) => Promise<StocktakeDetail>;
export const cancelStocktake: (env: Env, id: number, input: Record<string, unknown>, userid: string) => Promise<StocktakeDetail>;
```

  - `startStocktake` 的输入：`scope`（必填）、`remark`（可空，最长 200）。一个批处理：插单头，按范围各一条 `INSERT ... SELECT` 建行（物资取 `status = 'active'` 的，设备取 `location = 'warehouse'` 的），最后 `releaseGuards`。单号撞了重取一次；撞上「只能有一个进行中」的唯一索引时返回 409「已有进行中的盘点 <单号>，先完成或取消它」。批处理之前先查一次，给出同样的 409。
  - `cancelStocktake` 的输入：`reason`（可空，最长 200）。批内断言 `STOCKTAKE_COUNTING_EXISTS_SQL`；不是进行中返回 409「这次盘点已经结束」；不存在 404「盘点不存在」。

- [ ] **Step 1: 写失败的测试**

```ts
describe.skipIf(!hasSqlite)("发起和取消盘点", () => {
  it("范围是全部：每条启用的物资、每台在库的设备各一行，停用的物资和在项目的设备没有", async () => {
    const detail = await startStocktake(h.env, { scope: "all" }, "kp");
    expect(detail.stocktake_no).toMatch(/^PD-\d{8}-\d+$/);
    expect(detail.material_lines.map((l) => l.material_id)).toEqual([activeA, activeB]);
    expect(detail.device_lines.map((l) => [l.device_id, l.expected, l.found])).toEqual([[inWarehouse, 1, null]]);
    expect(detail).toMatchObject({ material_total: 2, material_counted: 0, device_expected: 1, device_found: 0 });
  });
  it("范围是物资就没有设备行，范围是设备就没有物资行", async () => {});
  it("已有进行中的盘点时再发起：409，带上那次的单号，不多出行", async () => {
    const first = await startStocktake(h.env, { scope: "material" }, "kp");
    await expect(startStocktake(h.env, { scope: "device" }, "kp")).rejects.toMatchObject({
      status: 409, message: `已有进行中的盘点 ${first.stocktake_no}，先完成或取消它`
    });
  });
  it("两个发起请求都过了预查，第二个撞唯一索引：也是 409，整批回滚", async () => {
    // 用 h.hooks.beforeStatement 在第一个批处理之前插一条 counting 的盘点
  });
  it("300 条物资一次建好（不超 D1 的参数上限）", async () => {});
  it("取消后状态是已取消，记下原因和人；可以再发起一次", async () => {});
  it("取消已完成或已取消的盘点：409；不存在的：404", async () => {});
  it("列表新的在前，带各自的汇总数和调整单号", async () => {});
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/api && npm test -- test/warehouse-stocktake.test.ts`
Expected: FAIL，找不到模块 `stocktake`

- [ ] **Step 3: 实现两个文件**

汇总数用一条带子查询的 `SELECT` 算，不在 JS 里遍历行。`adjust_doc_id`、`adjust_doc_no` 从 `wh_doc WHERE stocktake_id = s.id` 取。

- [ ] **Step 4: 运行确认通过**

Run: `cd packages/api && npm test -- test/warehouse-stocktake.test.ts && npm run typecheck`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/api/src/services/warehouse/stocktake.ts packages/api/src/services/warehouse/stocktake-query.ts packages/api/test/warehouse-stocktake.test.ts
git commit -m "feat: 发起、查看、取消盘点"
```

---

### Task 3: 录实盘数、标记设备

**Files:**
- Create: `packages/api/src/services/warehouse/stocktake-count.ts`
- Test: `packages/api/test/warehouse-stocktake-count.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `STOCKTAKE_COUNTING_EXISTS_SQL`、`StocktakeMaterialLineRow`、`StocktakeDeviceLineRow`。
- Produces：

```ts
export const saveMaterialCount: (
  env: Env, stocktakeId: number, lineId: number, input: Record<string, unknown>, userid: string
) => Promise<StocktakeMaterialLineRow>;

export interface DeviceMarkResult {
  line: StocktakeDeviceLineRow;
  /** 这台设备账上不在库 */
  unexpected: boolean;
  /** 给库管看的一句话，没有就是 null */
  hint: string | null;
}
export const markStocktakeDevice: (
  env: Env, stocktakeId: number, input: Record<string, unknown>, userid: string
) => Promise<DeviceMarkResult>;
```

  - `saveMaterialCount` 的输入：`counted_qty`（数字或 `null`；数字要 ≥ 0、最多 3 位小数、不超过 1e9）、`note`（可空，最长 200）。`null` 表示清掉这一行（`book_qty` 也清）。`book_qty` 在同一条 `UPDATE` 里用子查询取 `material.quantity`，不先读再写。
  - `markStocktakeDevice` 的输入：`device_id` 或 `device_code`（二选一，都给以 `device_id` 为准）、`found`（`true`、`false`、`null`）、`note`。行不存在时用 `INSERT ... ON CONFLICT(stocktake_id, device_id) DO UPDATE` 加一行 `expected = 0`。
  - 两个函数的批处理都是：`assertInBatch(STOCKTAKE_COUNTING_EXISTS_SQL)`、改行、`UPDATE stocktake SET version = version + 1, updated_at = ?`、`releaseGuards`。
  - 错误：盘点不存在 404「盘点不存在」；已结束 409「这次盘点已经结束，不能再改」；行不属于这次盘点 404「这次盘点里没有这一行」；范围只有物资时标设备 400「这次盘点不盘设备」；设备查不到 404「没有这台设备」。
  - `hint`：账上在项目 →「账上在「<项目名>」，盘完后补一张返库单」；已报废 →「账上已报废」；其余 `null`。`unexpected` 只在这两种情况下为真。

- [ ] **Step 1: 写失败的测试**

```ts
describe.skipIf(!hasSqlite)("录实盘数", () => {
  it("记下实盘数和那一刻的账面数、谁录的；盘点版本加一", async () => {
    const line = await saveMaterialCount(h.env, st.id, lineA, { counted_qty: 8, note: "少两个" }, "kp");
    expect(line).toMatchObject({ counted_qty: 8, book_qty: 10, diff: -2, counted_by_userid: "kp" });
    expect((await getStocktake(h.env, st.id))?.version).toBe(st.version + 1);
  });
  it("录完之后账面变了，再录一次会按新的账面数重记", async () => {});
  it("实盘数可以是 0；null 是清掉这一行", async () => {});
  it("负数、4 位小数、不是数字：400，行不变", async () => {});
  it("别的盘点的行、不存在的行：404", async () => {});
  it("盘点已完成或已取消：409", async () => {});
  it("预查之后盘点被取消：批内断言失败，整批回滚", async () => {});
});
describe.skipIf(!hasSqlite)("标记设备", () => {
  it("按编号标记找到；记下谁扫的", async () => {
    const result = await markStocktakeDevice(h.env, st.id, { device_code: "SB-0001", found: true }, "kp");
    expect(result).toMatchObject({ unexpected: false, hint: null, line: { expected: 1, found: 1, scanned_by_userid: "kp" } });
  });
  it("账上在项目的设备：加一行 expected = 0，提示补返库单", async () => {
    const result = await markStocktakeDevice(h.env, st.id, { device_id: onProject, found: true }, "kp");
    expect(result).toMatchObject({ unexpected: true, hint: "账上在「临河 DN1200」，盘完后补一张返库单", line: { expected: 0, found: 1 } });
  });
  it("同一台扫两次只有一行", async () => {});
  it("可以标记没找到并写备注，也可以清掉标记", async () => {});
  it("查不到的编号 404；范围只有物资 400；盘点已结束 409", async () => {});
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/api && npm test -- test/warehouse-stocktake-count.test.ts`
Expected: FAIL，找不到模块 `stocktake-count`

- [ ] **Step 3: 实现**

- [ ] **Step 4: 运行确认通过**

Run: `cd packages/api && npm test -- test/warehouse-stocktake-count.test.ts && npm run typecheck`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/api/src/services/warehouse/stocktake-count.ts packages/api/test/warehouse-stocktake-count.test.ts
git commit -m "feat: 盘点录实盘数和标记设备"
```

---

### Task 4: 完成盘点并调账

**Files:**
- Create: `packages/api/src/services/warehouse/stocktake-complete.ts`
- Modify: `packages/api/src/services/warehouse/doc-core.ts`（`DocHeader` 加可选的 `stocktake_id?: number | null`，`executeDoc` 的 `INSERT` 把它写进去，别的调用方不用改）
- Test: `packages/api/test/warehouse-stocktake-complete.test.ts`

**Interfaces:**
- Consumes: `executeDoc`、`DOC_ID_SQL`（`doc-core.ts`）；`getStocktake`（Task 2）。
- Produces：

```ts
export interface CompleteStocktakeResult {
  stocktake: StocktakeDetail;
  adjust_doc: { id: number; doc_no: string } | null;
  replayed: boolean;
}
export const completeStocktake: (
  env: Env, id: number, input: Record<string, unknown>, userid: string
) => Promise<CompleteStocktakeResult>;
```

  - 输入：`version`（必填的正整数，页面看到的盘点版本）。
  - 顺序：
    1. 读盘点。不存在 404。已完成：直接返回 `{ replayed: true }` 和原来的调整单。已取消 409「这次盘点已经取消」。
    2. `version` 和库里的不一样：409「盘点内容有变化，请刷新后再点完成」。
    3. 没有任何已录的物资行、也没有任何 `found` 不为空的设备行：400「还什么都没盘。不盘了请点取消」。
    4. 预查减不动的：有差额为负、且 `material.quantity + 差额 < 0` 的行，400「<品名 规格> 现在账面只有 <n><单位>，扣不了 <m>，请重新盘这一项」（只报第一条）。
    5. 有差额时走 `executeDoc`（`doc_type: "adjust"`、`stocktake_id`、`remark: "盘点 <单号> 调整"`、`clientRequestId: "stocktake-<id>"`、`occurred_at` 取现在），`build` 返回下面这些语句；没有差额时同样的语句（去掉第 2、3 条）直接 `runAtomicBatch`，最后加 `releaseGuards`。
  - 批里的语句，按这个顺序，全部按集合写：
    1. `assertInBatch`：`SELECT 1 FROM stocktake WHERE id = ? AND status = 'counting' AND version = ?`
    2. 改库存：`UPDATE material SET quantity = ROUND(quantity + (差额子查询), 3), updated_at = ? WHERE id IN (这次盘点里差额不为 0 的物资)`
    3. 插调整单的行：`INSERT INTO wh_doc_line (...) SELECT ...`，每条有差额的物资一行，`quantity = ABS(差额)`、`stock_delta = 差额`、`outcome = 'normal'`、`balance_after` 取改完之后的 `material.quantity`、`project_id` 空、`project_delta = 0`、`note` 取盘点行的备注。
    4. 没标记的在库设备记成没找到：`UPDATE stocktake_device_line SET found = 0 ... WHERE stocktake_id = ? AND expected = 1 AND found IS NULL`
    5. 写时间线：`INSERT INTO device_event (...) SELECT ...`，条件是 `expected = 1 AND found = 0` 且设备现在 `location = 'warehouse'`；`event_type = 'stocktake_missing'`、`ref_type = 'stocktake'`、`ref_id = 盘点 id`、`summary = '盘点未找到（<单号>）'`。
    6. `UPDATE stocktake SET status = 'done', completed_by_userid = ?, completed_at = ?, version = version + 1, updated_at = ?`
  - 「差额不为 0」的统一写法：`counted_qty IS NOT NULL AND ROUND(counted_qty - book_qty, 3) <> 0`。
  - `executeDoc` 返回 `replayed: true`（另一个相同的完成请求先做完了）时，照常重新读盘点返回，结果里的 `replayed` 也是真。

- [ ] **Step 1: 写失败的测试**

```ts
describe.skipIf(!hasSqlite)("完成盘点", () => {
  it("盘亏盘盈各一条：出一张调整单，库存改对，流水里看得到", async () => {
    await saveMaterialCount(h.env, st.id, lineA, { counted_qty: 8 }, "kp");   // 账面 10
    await saveMaterialCount(h.env, st.id, lineB, { counted_qty: 5.5 }, "kp"); // 账面 5
    await saveMaterialCount(h.env, st.id, lineC, { counted_qty: 3 }, "kp");   // 账面 3，没差额
    const fresh = await getStocktake(h.env, st.id);
    const result = await completeStocktake(h.env, st.id, { version: fresh.version }, "kp");
    expect(result.replayed).toBe(false);
    expect(result.stocktake.status).toBe("done");
    const doc = await getWhDoc(h.env, result.adjust_doc.id);
    expect(doc).toMatchObject({ doc_type: "adjust", stocktake_id: st.id });
    expect(doc.lines.map((l) => [l.material_id, l.quantity, l.stock_delta, l.balance_after])).toEqual([
      [materialA, 2, -2, 8], [materialB, 0.5, 0.5, 5.5]
    ]);
    expect((await getMaterial(h.env, materialC)).quantity).toBe(3);
  });
  it("录完之后发了 3 个货再完成：只扣盘亏的 2 个，不把发出去的当盘亏", async () => {
    // 账面 10，录 8（book 10），发货 3（账面 7），完成后账面 5
  });
  it("减不动：400，说出是哪条物资，库存、盘点状态、设备行都没变", async () => {
    // 账面 10，录 2（差额 -8），发货 5（账面 5）
    await expect(complete()).rejects.toMatchObject({ status: 400, message: "水泥 P.O42.5 现在账面只有 5袋，扣不了 8，请重新盘这一项" });
  });
  it("没有差额：不出调整单，盘点照样完成", async () => {
    expect((await complete()).adjust_doc).toBeNull();
  });
  it("没录的物资不动", async () => {});
  it("重发完成请求：返回同一张调整单，库存只改了一次", async () => {
    const first = await complete();
    const again = await completeStocktake(h.env, st.id, { version: 1 }, "kp");
    expect(again).toMatchObject({ replayed: true, adjust_doc: first.adjust_doc });
  });
  it("版本不对：409，什么都没变", async () => {});
  it("预查之后有人又录了一行：批内断言失败，整批回滚，没有调整单", async () => {
    // h.hooks.beforeStatement 在 kind === "batch" 时先插一次 saveMaterialCount 的效果（version + 1）
  });
  it("什么都没盘：400，提示去取消", async () => {});
  it("已取消的盘点：409", async () => {});
  it("设备：没扫到的在库设备时间线上有「盘点未找到」，扫到的没有，位置都没变", async () => {});
  it("盘点期间已经发往项目的设备不记「盘点未找到」", async () => {});
  it("手动标记没找到的设备和没标记的一样处理；账上不在库但扫到的只留在报告里", async () => {});
  it("调整单不能冲销", async () => {
    await expect(reverseWhDoc(h.env, adjustId, { client_request_id: rid() }, "kp")).rejects.toMatchObject({ status: 400 });
  });
  it("300 条物资都有差额也能一次完成", async () => {});
  it("项目物资页不受盘点调整影响", async () => {});
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/api && npm test -- test/warehouse-stocktake-complete.test.ts`
Expected: FAIL，找不到模块 `stocktake-complete`

- [ ] **Step 3: 实现**

`completeStocktake` 抛出的减库存约束错误不用自己接：路由层的 `handleWarehouseError` 已经把 `material_quantity_non_negative` 变成 400「库存不足」（预查和批处理之间又有出库时才会走到）。

- [ ] **Step 4: 运行确认通过，再跑一遍库房单相关的旧测试**

Run: `cd packages/api && npm test -- test/warehouse-stocktake-complete.test.ts test/warehouse-doc-inbound.test.ts test/warehouse-doc-move.test.ts test/warehouse-doc-reverse.test.ts test/warehouse-large-batches.test.ts && npm run typecheck`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/api/src/services/warehouse/stocktake-complete.ts packages/api/src/services/warehouse/doc-core.ts packages/api/test/warehouse-stocktake-complete.test.ts
git commit -m "feat: 完成盘点时自动出调整单"
```

---

### Task 5: 盘点路由和权限

**Files:**
- Create: `packages/api/src/routes/wh-stocktake.ts`
- Modify: `packages/api/src/routes/wh-app.ts`（挂上 `whStocktakeRoutes`）
- Modify: `packages/api/test/warehouse-permission-matrix.test.ts`
- Test: `packages/api/test/warehouse-stocktake-routes.test.ts`

**Interfaces:**
- Consumes: Task 2 到 4 的 service。
- Produces（都在 `/api/v1/warehouse` 下）：

| 方法和路径 | 权限 | 返回的 `data` |
|---|---|---|
| `GET /stocktake` | 全部角色 | `StocktakeRow[]`，带 `pagination` |
| `GET /stocktake/:id` | 全部角色 | `StocktakeDetail` |
| `POST /stocktake` | 库管 | `StocktakeDetail` |
| `PUT /stocktake/:id/material-line/:lineId` | 库管 | `StocktakeMaterialLineRow` |
| `POST /stocktake/:id/device-scan` | 库管 | `DeviceMarkResult` |
| `POST /stocktake/:id/complete` | 库管 | `CompleteStocktakeResult` |
| `POST /stocktake/:id/cancel` | 库管 | `StocktakeDetail` |

  - `export const whStocktakeRoutes: Hono<WhEnv>`。写接口的中间件顺序：`requireRoles(ALL_ROLES)`、`requireHuman`、`requireKeeper`。

- [ ] **Step 1: 写失败的测试**

```ts
describe.skipIf(!hasSqlite)("盘点路由", () => {
  it("库管走完一遍：发起、录数、扫设备、完成，返回的东西对得上", async () => {});
  it("GET /warehouse/stocktake 由新路由回答，不是旧占位的空数组", async () => {
    // mount 用和 index.ts 一样的顺序：mountWarehouseRoutes 之后挂 warehouseLegacyStubRoutes
    const res = await callWh(h, mountLikeIndex, "GET", "/warehouse/stocktake");
    expect(res.body.pagination).toEqual({ page: 1, pageSize: 20, total: 1 });
  });
  it("操作员能看列表和详情", async () => {});
  it("不是数字的 id：404「盘点不存在」；请求体不是对象：400", async () => {});
  it("service 抛出的未知错误是 500，不是 401", async () => {});
});
```

权限矩阵里加 5 行，都用 `KEEPER`：`POST /warehouse/stocktake`、`PUT /warehouse/stocktake/1/material-line/1`、`POST /warehouse/stocktake/1/device-scan`、`POST /warehouse/stocktake/1/complete`、`POST /warehouse/stocktake/1/cancel`。矩阵已有的断言会覆盖：操作员、现场负责人、经理 403，库管和超管不是 401 或 403，智能体令牌 403。

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/api && npm test -- test/warehouse-stocktake-routes.test.ts test/warehouse-permission-matrix.test.ts`
Expected: FAIL，新路径 404

- [ ] **Step 3: 实现路由并挂上**

- [ ] **Step 4: 运行确认通过，跑 API 全套**

Run: `cd packages/api && npm test && npm run typecheck && npm run lint`
Expected: 全部通过

- [ ] **Step 5: 提交**

```bash
git add packages/api/src/routes/wh-stocktake.ts packages/api/src/routes/wh-app.ts packages/api/test/warehouse-stocktake-routes.test.ts packages/api/test/warehouse-permission-matrix.test.ts
git commit -m "feat: 盘点接口"
```

---

### Task 6: Web 盘点页

**Files:**
- Create: `packages/web/src/api/wh/stocktake-types.ts`、`packages/web/src/api/wh/stocktake.ts`
- Create: `packages/web/src/views/wh/stocktake/stocktake-view.ts`
- Create: `packages/web/src/views/wh/stocktake/index.vue`（列表、发起）
- Create: `packages/web/src/views/wh/stocktake/detail.vue`
- Create: `packages/web/src/views/wh/stocktake/components/MaterialCountTable.vue`、`DeviceCheckTable.vue`、`CompleteStocktakeDialog.vue`
- Modify: `packages/web/src/router/modules/wh.ts`（`/wh/stocktake`，`WhStocktake`，标题「盘点」，排在「任务」后面；`/wh/stocktake/:id`，`WhStocktakeDetail`，`showLink: false`）
- Test: `packages/web/src/views/wh/stocktake/stocktake-view.test.ts`

**Interfaces:**
- Consumes: Task 5 的接口。
- Produces（`api/wh/stocktake.ts`）：`listStocktakes(params)`、`getStocktake(id)`、`startStocktake({ scope, remark })`、`saveStocktakeCount(id, lineId, { counted_qty, note })`、`markStocktakeDevice(id, { device_id, found, note })`、`completeStocktake(id, version)`、`cancelStocktake(id, reason)`；类型照 Task 2 到 4 的返回结构写在 `stocktake-types.ts`。
- Produces（`stocktake-view.ts`，纯函数）：

```ts
export const SCOPE_LABELS: Record<StocktakeScope, string>;   // 物资、设备、全部
export const STATUS_LABELS: Record<StocktakeStatus, string>; // 盘点中、已完成、已取消
export type MaterialFilter = "all" | "uncounted" | "diff";
export const filterMaterialLines: (
  lines: StocktakeMaterialLineRow[], filter: MaterialFilter, keyword: string
) => StocktakeMaterialLineRow[];
/** "+0.5"、"-2"、"一致"、""（没录） */
export const diffText: (line: Pick<StocktakeMaterialLineRow, "diff">) => string;
export const deviceLineStatus: (line: StocktakeDeviceLineRow) => { text: string; type: "success" | "danger" | "warning" | "info" };
/** 完成前确认里的几句话；没有可说的那一句不出现 */
export const completeSummary: (detail: StocktakeDetail) => string[];
/** 输入框里的字 → 要存的数；空串是 null；不合规返回错误文字 */
export const parseCount: (text: string) => { value: number | null } | { error: string };
```

  - `deviceLineStatus`：找到「已找到」；`expected = 1` 且没标「没扫到」（完成后是「没找到」）；`expected = 0` 且在项目「账上在「<项目>」」；`found = 0`「没找到」。
  - `completeSummary` 的句子：「N 条物资有差额，会出一张盘点调整单」「还有 N 条物资没盘，这些不动」「N 台在库设备没扫到，会在时间线上记「盘点未找到」」「N 台扫到了但账上不在库，记得补返库单」；什么差额都没有时「账面和实盘一致，不出调整单」。

页面要点（版式实施者定，这些是要有的东西）：
- 列表页：单号、范围、状态、发起人、时间、物资进度（已盘 / 总数）、设备进度、调整单号（点开是库房单）。库管有「发起盘点」（选范围，可写备注）；已有进行中的盘点时按钮换成「继续盘点」直达那一次。
- 详情页：按范围显示「物资」「设备」两个页签。
  - 物资：按类别分组或可筛类别，关键字搜品名、规格、编号；筛「全部、没盘的、有差额的」；每行显示账面数、实盘数输入框、差额、备注。输入框失焦或回车就存，存失败恢复原值并提示。
  - 设备：编号、名称、库位、状态；行上「找到」「没找到」「清掉」；顶上一个输入框，输编号回车等于扫码（Web 上没有扫码枪也能用）。
  - 库管有「完成盘点」（弹 `CompleteStocktakeDialog`，列出 `completeSummary`，确认后提交）和「取消盘点」。完成返回 409 时提示并重新加载。
  - 已完成、已取消的盘点和不是库管的人：全部只读。
- 所有接口调用走 `useWhAction`。

- [ ] **Step 1: 写失败的测试**

```ts
describe("stocktake-view", () => {
  it("筛没盘的、有差额的；关键字搜品名、规格、编号，不分大小写", () => {});
  it("diffText：+0.5、-2、一致、没录是空", () => {
    expect([0.5, -2, 0, null].map((diff) => diffText({ diff }))).toEqual(["+0.5", "-2", "一致", ""]);
  });
  it("parseCount：空串是 null；0 可以；负数、4 位小数、字母报错", () => {
    expect(parseCount("")).toEqual({ value: null });
    expect(parseCount("0")).toEqual({ value: 0 });
    expect(parseCount("-1")).toEqual({ error: "实盘数不能是负数" });
    expect(parseCount("1.2345")).toEqual({ error: "最多 3 位小数" });
    expect(parseCount("1e3")).toEqual({ error: "请填数字" });
  });
  it("deviceLineStatus 的四种情况", () => {});
  it("completeSummary：有差额、没盘完、设备没扫到、账上不在库各一句；都没有时说一致", () => {});
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/web && npm test -- src/views/wh/stocktake/stocktake-view.test.ts`
Expected: FAIL，找不到模块

- [ ] **Step 3: 实现 `stocktake-view.ts`，测试通过后写接口封装、页面和路由**

- [ ] **Step 4: 在浏览器里走一遍**

起本地 `api` 和 `web`（`.claude/launch.json`），用库管账号：发起「全部」盘点；录三条物资（盘亏、盘盈、一致）；设备标一台找到、输一个在项目上的设备编号；点完成，核对确认里的句子；完成后看库房单列表里有「盘点调整」、物资流水里有这一笔、没扫到的设备时间线上有「盘点未找到」。再用操作员账号确认只读、没有按钮。

- [ ] **Step 5: 检查并提交**

Run: `cd packages/web && npm test && npm run typecheck && npm run lint:check && npm run build`
Expected: 测试、类型检查、构建通过；lint 没有新的 error

```bash
git add packages/web/src/api/wh/stocktake.ts packages/web/src/api/wh/stocktake-types.ts packages/web/src/views/wh/stocktake packages/web/src/router/modules/wh.ts
git commit -m "feat: Web 盘点页"
```

---

### Task 7: 小程序盘点页

**Files:**
- Create: `packages/miniapp/packageWarehouse/common/wh-stocktake-view.js`
- Create: `packages/miniapp/packageWarehouse/stocktake/index.js`、`index.json`、`index.wxml`、`index.wxss`
- Modify: `packages/miniapp/app.json`（分包加 `stocktake/index`）
- Modify: `packages/miniapp/utils/wh-app-json.test.js`（`SUB_PAGES` 加 `stocktake/index`）
- Modify: `packages/miniapp/utils/wh-home-view.js`（`KEEPER_ACTIONS` 加 `{ key: "stocktake", label: "盘点", url: "/packageWarehouse/stocktake/index" }`，放在「入库」后面）和它的测试
- Test: `packages/miniapp/packageWarehouse/common/wh-stocktake-view.test.js`、`wh-stocktake-page.test.js`

**Interfaces:**
- Consumes: Task 5 的接口；`whGet`、`whSend`（`common/wh-api.js`）；`scanDevice`、`parseDeviceCode`（`utils/wh-scan.js`）；`toast`、`errorText`、`isConflict`、`confirmModal`、`alertModal`、`loadViewer`（`common/wh-ui.js`）。
- Produces（`wh-stocktake-view.js`）：

```js
/** @returns {{ header, tabs, materialRows, deviceRows, canEdit, canStart, summaryLines }} */
const buildStocktakeView = (detail, { isKeeper, filter, keyword }) => {};
/** 输入框里的字 → { value } 或 { error }，规则同 Web 的 parseCount */
const parseCount = (text) => {};
/** 完成前确认里的句子，规则同 Web 的 completeSummary */
const completeSummary = (detail) => {};
/** 录完一行后的新详情（不改传进来的对象） */
const withMaterialLine = (detail, line) => {};
const withDeviceLine = (detail, line) => {};
module.exports = { SCOPE_OPTIONS, buildStocktakeView, parseCount, completeSummary, withMaterialLine, withDeviceLine };
```

页面行为：
- `onLoad`：`GET /stocktake?status=counting&pageSize=1`。有就取详情显示；没有时库管看到三个发起按钮（物资、设备、全部），别人看到「现在没有进行中的盘点」。带 `?id=` 打开时显示那一次（可以是已完成的，只读）。
- 物资页签：搜索框（本地筛）、「全部、没盘、有差额」三个筛选；点一行弹出录数层：品名规格、账面数、实盘数输入框（数字键盘）、备注、「保存」「清掉」。保存成功用返回的行换掉列表里那一行，不整页重拉。
- 设备页签：「连续扫码」按钮和一个「输编号」入口；列表显示每台的状态；点一行出动作面板：找到、没找到、清掉。
  - 连续扫码沿用发货页的做法：扫到就标记找到并接着扫；「不是设备码」「没有这台设备」和账上不在库的提示用弹窗停住，点「继续扫」才接着扫；别的错误（断网、相机打不开）直接停下。
- 底部（库管、盘点中）：「完成盘点」（`confirmModal` 列出 `completeSummary`）和「取消盘点」。完成遇到 409 提示后重新拉详情。
- 所有忙状态 `try/finally` 复位；离开页面后回来的请求不再 `setData`（照资料页的 `unloaded` 做法）。
- 页面文件超过 400 行就把扫码那一块拆到 `stocktake/scan.js`。

- [ ] **Step 1: 写失败的测试**

```js
// wh-stocktake-view.test.js
// 库管 + 盘点中：canEdit；别人或已完成：只读、没有底部按钮
// 范围是物资时只有一个页签
// 筛选和关键字
// withMaterialLine 换掉那一行并更新已盘数、差额数，原对象不变
// completeSummary 的五种句子

// wh-stocktake-page.test.js（createPageHarness）
// 1 没有进行中的盘点：库管看到发起按钮；点「全部」发 POST /stocktake { scope: "all" }，然后显示详情
// 2 不是库管：没有发起按钮，显示「现在没有进行中的盘点」
// 3 录数：点行、输 8、保存 → PUT .../material-line/11 { counted_qty: 8, note: "" }，列表那一行变了
// 4 输 -1：不发请求，提示「实盘数不能是负数」
// 5 保存失败：提示后端的中文，弹层不关，busy 复位
// 6 连续扫码：两台在库的都标记找到（两次 POST .../device-scan），第三台账上在项目 → 弹窗写着补返库单
// 7 扫到不是设备码的：弹窗停住，不发请求
// 8 完成：确认框里是 completeSummary 的句子；确认后 POST .../complete { version }；成功后页面变只读
// 9 完成返回 409：提示并重新拉详情
// 10 取消盘点
// 11 离开页面后回来的详情请求不再 setData
// 12 带 id 打开已完成的盘点：只读
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/miniapp && node packageWarehouse/common/wh-stocktake-view.test.js`
Expected: FAIL，找不到模块 `./wh-stocktake-view`

- [ ] **Step 3: 实现视图模块、页面、注册和首页入口**

- [ ] **Step 4: 运行确认通过**

Run: `cd packages/miniapp && npm run test:wh && node utils/wh-app-json.test.js && npm run typecheck`
Expected: 全部通过；`wh-wxml.test.js` 自动把新页面算进去（14 个页面）

- [ ] **Step 5: 提交**

```bash
git add packages/miniapp/packageWarehouse/stocktake packages/miniapp/packageWarehouse/common/wh-stocktake-view.js packages/miniapp/packageWarehouse/common/wh-stocktake-view.test.js packages/miniapp/packageWarehouse/common/wh-stocktake-page.test.js packages/miniapp/app.json packages/miniapp/utils/wh-app-json.test.js packages/miniapp/utils/wh-home-view.js packages/miniapp/utils/wh-home-view.test.js
git commit -m "feat: 小程序盘点页"
```

---

### Task 8: 每日摘要

**Files:**
- Create: `packages/api/src/services/warehouse/digest.ts`
- Create: `packages/api/src/services/warehouse/notice-digest.ts`
- Modify: `packages/api/src/services/warehouse/notice.ts`（多一种 `daily_digest`）
- Modify: `packages/api/src/services/warehouse/notice-deliver.ts`（`buildDrafts` 分到 `digestDrafts`；`NoticeOutcome["skipped"]` 加 `"empty"`）
- Modify: `packages/api/src/services/warehouse/notice-cards.ts`（`NOTICE_PAGES.home = "pages/warehouse/index"`）
- Modify: `packages/api/src/services/warehouse/material.ts`（导出 `LOW_STOCK_SQL`）、`packages/api/src/services/doc-library/query.ts`（导出 `EXPIRING_DAYS` 和 `IS_LATEST`）
- Modify: `packages/api/src/services/warehouse/overview.ts`（`OverviewCounts` 加 `certs_attention`）
- Modify: `packages/api/src/scheduled.ts`（每小时那一段里调用 `publishDailyDigestIfDue`）
- Modify: `packages/web/src/api/wh/types.ts`、`packages/web/src/views/wh/overview/index.vue`（多一张「证书到期」卡片，去 `/wh/doc-library?expiring=1`）、`packages/web/src/views/wh/doc-library/index.vue`（打开时认 `expiring=1`）
- Test: `packages/api/test/warehouse-digest.test.ts`；改 `packages/api/test/warehouse-overview.test.ts`

**Interfaces:**
- Produces（`digest.ts`）：

```ts
export interface DigestSection { count: number; examples: string[] }  // examples 最多 3 个
export interface WarehouseDigest {
  /** 北京日期 YYYY-MM-DD */
  date: string;
  low_stock: DigestSection;         // 例子是「品名 规格」
  overdue_tasks: DigestSection;     // 例子是任务标题
  stale_inspections: DigestSection; // 例子是设备编号
  certs_soon: DigestSection;        // 例子是资料标题
  certs_expired: DigestSection;
}
export const collectDigest: (env: Env, now: Date) => Promise<WarehouseDigest>;
export const isEmptyDigest: (digest: WarehouseDigest) => boolean;
export type DigestPublishOutcome = "published" | "not_due" | "already" | "disabled" | "no_keeper" | "empty" | "error";
/** 定时任务里调用，永不抛出 */
export const publishDailyDigestIfDue: (env: Env, now: Date) => Promise<DigestPublishOutcome>;
```

  - 口径：
    - 低库存：`status = 'active' AND LOW_STOCK_SQL`。
    - 超期任务：`status IN ('todo', 'submitted') AND due_date < 北京今天`（和总览的 `tasks_overdue` 一样）。
    - 待检超过 3 天：设备 `location = 'warehouse'`，有未完成的阻塞检查任务，且那个任务的 `created_at` 早于 `now` 减 72 小时。
    - 证书：没删、是最新版、`valid_until` 不为空；早于北京今天算已过期，今天到 `EXPIRING_DAYS` 天后算快到期（和资料列表标橙标红的边界一样）。
  - `publishDailyDigestIfDue`：北京时间不是 8 点 → `not_due`；KV 里已有 `warehouse:digest:<日期>` → `already`；开关关着 → `disabled`；没有库管 → `no_keeper`；`isEmptyDigest` → `empty`；否则 `publishWarehouseNotice(env, { kind: "daily_digest", date }, "system")`，再写 KV（`expirationTtl` 3 天）→ `published`。任何异常记日志返回 `error`。
- Produces（`notice.ts`）：`WarehouseNotice` 多一支 `{ kind: "daily_digest"; date: string }`；`parseWarehouseNotice` 只认 `date` 是 `YYYY-MM-DD` 的。
- Produces（`notice-digest.ts`）：`digestDrafts(env: Env, now: Date): Promise<NoticeDraft[]>`。收件人是全体库管（不排除任何人）；摘要为空时返回空数组，`deliverWarehouseNotice` 据此返回 `{ sent: 0, skipped: "empty" }`。
- Produces（`notice-deliver.ts`）：`NoticeDeps` 多一个可选的 `now?: () => Date`（默认 `() => new Date()`），摘要用它取投递那一刻的时间，测试用它定住日期。
  - 卡片：标题「库房每日摘要」；副标题「<月-日> 有 N 项要处理」（N 是有内容的行数）；行只出有内容的：
    - 「低库存」：`5 种：水泥 P.O42.5、膨润土`
    - 「超期任务」：`3 个：返库检查 SB-0003`
    - 「待检设备」：`2 台超过 3 天：SB-0001、SB-0007`
    - 「证书」：`2 份快到期，1 份已过期`（是 0 的那一半不写）
  - `pagePath: NOTICE_PAGES.home`，`webPath: "/wh/overview"`。
- Produces（`overview.ts`）：`certs_attention` = 已过期加快到期的份数。

- [ ] **Step 1: 写失败的测试**

```ts
describe.skipIf(!hasSqlite)("每日摘要的内容", () => {
  it("四项各有东西时的数字和例子", async () => {
    expect(await collectDigest(h.env, at("2026-11-13T00:00:00Z"))).toEqual({
      date: "2026-11-13",
      low_stock: { count: 2, examples: ["水泥 P.O42.5", "膨润土"] },
      overdue_tasks: { count: 1, examples: ["返库检查 SB-0003"] },
      stale_inspections: { count: 1, examples: ["SB-0003"] },
      certs_soon: { count: 1, examples: ["SB-0001 合格证"] },
      certs_expired: { count: 1, examples: ["泥浆泵检测报告"] }
    });
  });
  it("返库不到 3 天的待检设备不算；已经发往项目的不算", async () => {});
  it("被替换掉的旧版证书、已删除的证书不算；没填有效期的不算", async () => {});
  it("今天到期算快到期，昨天到期算已过期，第 31 天到期的不算", async () => {});
  it("例子最多 3 个，数字是全部", async () => {});
});
describe.skipIf(!hasSqlite)("定时发布", () => {
  it("北京时间 8 点、开关开着、有库管、有内容：发一个事件，记下当天已发", async () => {
    expect(await publishDailyDigestIfDue(h.env, at("2026-11-13T00:00:10Z"))).toBe("published");
    expect(h.queued).toHaveLength(1);
    expect(h.kv.get("warehouse:digest:2026-11-13")).toBeTruthy();
  });
  it("同一小时再跑一次：already，不再发", async () => {});
  it("不是 8 点：not_due，不查库", async () => {});
  it("开关关着、没有库管、四项都是 0：各自的结果，都不发事件", async () => {});
  it("发布时抛错：返回 error，不抛出，不记当天已发", async () => {});
});
describe.skipIf(!hasSqlite)("摘要卡片", () => {
  it("发给全体库管一张卡片，行只有有内容的那几项，点开是库房首页", async () => {
    // deps：send 记到 sent 里，resolveLinks 给一个小程序 appid，now 定在 2026-11-13T00:00:00Z
    const outcome = await deliverWarehouseNotice(h.env, { kind: "daily_digest", date: "2026-11-13", actor_userid: "system" }, deps);
    expect(outcome).toEqual({ sent: 1, skipped: null });
    expect(sent[0].touser).toBe("kp1|kp2");
    expect(sent[0].template_card.main_title).toEqual({ title: "库房每日摘要", desc: "11-13 有 2 项要处理" });
    expect(sent[0].template_card.card_action.pagepath).toBe("pages/warehouse/index");
  });
  it("投递时已经没有内容了：不发，skipped 是 empty", async () => {});
  it("日期格式不对的消息：invalid", async () => {});
  it("发送失败：抛出让队列重试，event_log 里有一行 warehouse_notice_failed", async () => {});
});
```

总览的测试加一条：`certs_attention` 等于快到期加已过期的份数。

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/api && npm test -- test/warehouse-digest.test.ts test/warehouse-overview.test.ts`
Expected: FAIL，找不到模块 `digest`

- [ ] **Step 3: 实现**

`scheduled.ts` 里放在每小时那一段的 `Promise.all` 之后单独一行：`await publishDailyDigestIfDue(env, new Date(event.scheduledTime));`。

- [ ] **Step 4: 运行确认通过，改 Web 的总览卡片和资料库的查询参数**

Run: `cd packages/api && npm test && npm run typecheck && npm run lint`
Run: `cd packages/web && npm test && npm run typecheck`
Expected: 全部通过。在浏览器里确认总览多了「证书到期」，点进去资料库勾着「只看快到期和已过期的」。

- [ ] **Step 5: 提交**

```bash
git add packages/api/src/services/warehouse/digest.ts packages/api/src/services/warehouse/notice-digest.ts packages/api/src/services/warehouse/notice.ts packages/api/src/services/warehouse/notice-deliver.ts packages/api/src/services/warehouse/notice-cards.ts packages/api/src/services/warehouse/material.ts packages/api/src/services/warehouse/overview.ts packages/api/src/services/doc-library/query.ts packages/api/src/scheduled.ts packages/api/test/warehouse-digest.test.ts packages/api/test/warehouse-overview.test.ts packages/web/src/api/wh/types.ts packages/web/src/views/wh/overview/index.vue packages/web/src/views/wh/doc-library/index.vue
git commit -m "feat: 库房每日摘要（低库存、超期任务、久未检查的设备、到期证书）"
```

---

### Task 9: MCP 工具和只读白名单

**Files:**
- Modify: `packages/mcp/src/tools/warehouse.ts`、`packages/mcp/src/tools/warehouse.test.ts`
- Modify: `packages/mcp/SKILL.md`、`packages/mcp/package.json`（`0.2.0`）、`packages/mcp/src/server.ts`（`version: "0.2.0"`）
- Modify: `packages/api/src/middleware/agent-readonly.ts`、`packages/api/src/middleware/agent-readonly.test.ts`

**Interfaces:**
- Produces（MCP 工具）：
  - `warehouse_inventory`：没有输入参数。说明：「查询物资库存：每条物资的编号、品名、规格、单位、在库数量、最低库存，以及是否低库存。返回数组（不分页）。」
  - `warehouse_low_stock`：没有输入参数。说明：「查询在库数量不高于最低库存的物资。返回数组。」
  - `list_devices`（替换 `list_stock_orders`）：`GET /warehouse/device`，返回 `{ items, pagination }`。

```ts
inputSchema: {
  state: z.enum(["available", "pending_inspection", "repairing", "blocked", "on_project", "scrapped"]).optional()
    .describe("设备状态：可用、待检、维修中、暂不可用、在项目、已报废"),
  keyword: z.string().optional().describe("设备编号、名称、现场叫法或型号里的关键词"),
  project_id: z.number().int().optional().describe("只看这个项目上的设备"),
  category_id: z.number().int().optional(),
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).max(200).optional()
}
```

- Produces（白名单）：加 `{ method: "GET", pattern: /^\/warehouse\/device$/, tool: "list_devices" }`。`/warehouse/stock-order` 那一条留着，注释写明「旧版客户端还在调，Task 12 删」。别的库房路径（`/warehouse/device/1`、`/warehouse/stocktake`、`/warehouse/doc`）继续 403。

- [ ] **Step 1: 改测试让它们先失败**

```ts
// packages/mcp/src/tools/warehouse.test.ts
it("list_devices 调 GET /warehouse/device，带筛选，返回 items 和 pagination", async () => {
  const get = vi.fn(async () => ({ data: [{ device_code: "SB-0001" }], pagination: { page: 1, pageSize: 20, total: 1 } }));
  const res = await byName(fakeClient(get), "list_devices").handler({ state: "available", keyword: "1200" });
  expect(get).toHaveBeenCalledWith("/warehouse/device", { state: "available", keyword: "1200" });
  expect(JSON.parse(res.content[0].text)).toEqual({ items: [{ device_code: "SB-0001" }], pagination: { page: 1, pageSize: 20, total: 1 } });
});
it("没有 list_stock_orders 这个工具了", () => {
  expect(warehouseTools(fakeClient(vi.fn())).map((t) => t.name)).toEqual(["warehouse_inventory", "warehouse_low_stock", "list_devices"]);
});
it("warehouse_inventory 不再接受库房和资产类型两个参数", () => {
  expect(Object.keys(byName(fakeClient(vi.fn()), "warehouse_inventory").inputSchema)).toEqual([]);
});

// packages/api/src/middleware/agent-readonly.test.ts：ALLOWED_FULL_PATHS 加 "/api/v1/warehouse/device"（一共 14 条），再加：
it("设备列表以外的库房路径都不放行", () => {
  for (const path of ["/api/v1/warehouse/device/1", "/api/v1/warehouse/device/by-code/SB-0001",
    "/api/v1/warehouse/stocktake", "/api/v1/warehouse/doc", "/api/v1/warehouse/home"]) {
    expect(isAllowedAgentRead("GET", path)).toBe(false);
  }
  expect(isAllowedAgentRead("POST", "/api/v1/warehouse/device")).toBe(false);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/mcp && npm test` 和 `cd packages/api && npm test -- src/middleware/agent-readonly.test.ts`
Expected: FAIL，找不到 `list_devices`；`/warehouse/device` 没被放行

- [ ] **Step 3: 实现。放行之前先读一遍 `routes/wh-device.ts` 的 `GET /device` 和 `listDevices`，确认它只读不写**（白名单的规矩：有的 GET 会写库，放行前必须看过处理函数）。把结论写进白名单那一行的注释。

- [ ] **Step 4: 运行确认通过**

Run: `cd packages/mcp && npm test && npm run typecheck && npm run lint && npm run build:bundle`
Run: `cd packages/api && npm test -- src/middleware/agent-readonly.test.ts test/warehouse-permission-matrix.test.ts`
Expected: PASS；bundle 能打出来

- [ ] **Step 5: 提交**

```bash
git add packages/mcp/src/tools/warehouse.ts packages/mcp/src/tools/warehouse.test.ts packages/mcp/SKILL.md packages/mcp/package.json packages/mcp/src/server.ts packages/api/src/middleware/agent-readonly.ts packages/api/src/middleware/agent-readonly.test.ts
git commit -m "feat: 智能体的库房工具对齐新模型（设备查询替换出入库单）"
```

`SKILL.md` 的库房那一行改成：`warehouse_inventory`、`warehouse_low_stock`、`list_devices`。

---

### Task 10: 文档

**Files:**
- Modify: `docs/superpowers/specs/2026-11-11-warehouse-rebuild-design.md`
- Modify: `doc/UI设计文档.md`
- Modify: `doc/开发记录.md`（只追加）
- Modify: `CLAUDE.md`

要写的内容：
- 设计稿：第 21 节阶段 3、阶段 4A 的「状态」改成已上线（阶段 3：PR #28，`52b59ea3`，没有迁移，小程序没上传；阶段 4A：2026-11-12 跑了迁移 0097，PR #29，`4fb2e1cf`，API 版本 `e0652735`）；加「阶段 5」小节，照前几个阶段的格式写状态和「设计稿没写死、定下的地方」（本计划开头那 13 条，加上执行时的 Ruling）。文档顶上的状态行同步。
- UI 文档：Web 加「J-11. 盘点」；小程序 4.38 加盘点页；总览多了「证书到期」；第 564 行那段旧接口占位的说明补一句「`list_stock_orders` 已换成 `list_devices`，占位到 Task 12 删」。
- 开发记录：追加一条，先补记「阶段 4A 的接口和 Web 已上线」（时间、迁移、合并提交、验证了什么、没验证什么），再写阶段 5 的内容、验证、没验证的、上线顺序、真机清单新增的项（接着第 19 项往下编：手机上发起盘点、录数、连续扫码、扫到在项目的设备、完成后调整单、每日摘要卡片点开的页面）。
- `CLAUDE.md`：小程序分包页面里加上盘点页；MCP 那一段不用改。

- [ ] **Step 1: 写文档**
- [ ] **Step 2: 提交**

```bash
git add docs/superpowers/specs/2026-11-11-warehouse-rebuild-design.md doc/UI设计文档.md doc/开发记录.md CLAUDE.md
git commit -m "docs: 库房阶段 5 的设计记录、页面说明和开发记录"
```

---

### Task 11: 上线（每一步需要 owner）

整分支审查和修复做完之后，停下来问 owner，再做下面的事。

- [ ] **Step 1: 推分支、开 PR。** PR 说明里写清楚：有迁移 0098；合并即部署 API 和 Web；小程序要另外上传；MCP 的新包要另外发布。
- [ ] **Step 2: 跑生产迁移。** 在只含本批改动的分支上：`cd packages/api && ./node_modules/.bin/wrangler d1 migrations list hybcdg-prod-db --remote --env prod` 确认只有 0098 待跑，再 `migrations apply`。
- [ ] **Step 3: 合并 PR，验证。** `https://api.hybcdg.com/api/v1/system/health` 返回 `ok=true`；没登录调 `GET /api/v1/warehouse/stocktake` 是 401；Web 入口脚本和本地构建一致；登录后「库房 → 盘点」能打开。
- [ ] **Step 4: 发布 MCP 新包。** `cd packages/mcp && npm run publish:dist`（往生产存储桶的 `agent-dist/` 写四个文件，owner 执行或明确同意后执行）。装过的人重跑一次安装脚本才会换成新工具；没换之前旧工具 `list_stock_orders` 返回空列表。
- [ ] **Step 5: 小程序。** 和阶段 3、4A 的页面一起上传、过真机清单、提审。
- [ ] **Step 6: 完成标准。** 李震做一次真实盘点：发起、录数、完成，核对调整单和物资流水。每日摘要在通知开关打开后的第二天早上 8 点检查一次。

---

### Task 12: 删旧接口占位（单独的分支和 PR）

**闸门（两条都满足才做，由 owner 确认）：** 新版小程序已经发布满一周；MCP 0.2.0 已经发布到 `agent-dist/`。

**Files:**
- Delete: `packages/api/src/routes/warehouse-legacy-stub.ts`、`packages/api/test/warehouse-legacy-stub.test.ts`
- Modify: `packages/api/src/index.ts`（去掉第 87、88 行附近的两处挂载和 import）
- Modify: `packages/api/test/warehouse-settings.test.ts`（第 218 行附近依赖占位的两条断言）
- Modify: `packages/api/src/middleware/agent-readonly.ts` 和测试（去掉 `/warehouse/stock-order`）
- Modify: `packages/api/src/services/warehouse/material.ts`（`listInventory` 去掉给旧小程序带的 `warehouse_id`、`warehouse_name`、`asset_type_id`、`type_name`；`status` 留着）和它的测试、`InventoryRow` 类型
- Modify: `packages/api/src/routes/voice.ts`（第 99 行还指向已删除的 `/pages/asset/index`，改成 `/pages/warehouse/index`）
- Modify: `doc/UI设计文档.md`（旧接口占位那一段）、`doc/开发记录.md`

- [ ] **Step 1: 改测试。** 旧路径（`GET /api/v1/warehouse/stock-order`、`GET /api/v1/asset`、`POST /api/v1/warehouse/work-order/1`）现在是 404；`/warehouse/stock-order` 对智能体令牌是 403；`listInventory` 的行里没有那四个字段。动手前先全仓库搜这四个字段名，确认 Web、小程序、MCP 都没在用。
- [ ] **Step 2: 运行确认失败，删代码，运行确认通过。**

Run: `cd packages/api && npm test && npm run typecheck && npm run lint`
Expected: 全部通过

- [ ] **Step 3: 提交、开 PR、owner 同意后合并。** 没有迁移。

```bash
git commit -m "chore: 删掉旧库房接口占位"
```

---

### Task 13: 删旧表（单独的分支和 PR）

**闸门：** owner 验收过新库房（李震在生产上用起来了）；owner 同意查生产库并看过各旧表的行数。

内容照 `docs/superpowers/plans/2026-11-11-warehouse-phase1-core.md` 的 Task 19，改三处：

1. 迁移文件用当时下一个空号（现在看是 `0099_warehouse_legacy_drop.sql`；`check-migration-numbers.mjs` 会拦重复）。
2. 旧表里的 `stocktake_task`、`stocktake_line` 照删；新的 `stocktake`、`stocktake_material_line`、`stocktake_device_line` 不能出现在迁移里。测试里把这三张新表加进「必须还在」的名单，再加 `doc_file`、`doc_share`、`project_kit`。
3. 设计稿第 14 节还要求清掉库房 AI 的提示词配置。阶段 1 去掉了 4 个库房 AI 任务类型；动手时先在代码和迁移里查这几个类型留下的配置行存在哪张表、哪些键，有就在同一个迁移里删，没有就在设计稿第 21 节记一句「没有要清的」。

4. **删表之前先去掉还在写旧表的代码。** `services/cron-jobs.ts` 的 `markOverdueRentalTerms` 每小时都在 `UPDATE asset_rental_term`，而这张表在删除名单里；阶段 1 的 Task 19 没有提到它。不先去掉的话，删表之后每小时的定时批次都会在这一步报错，排在它后面的车队超时通知等任务就不跑了。做法：从 `scheduled.ts` 的小时批次里去掉它，删掉函数和它的测试、`RENTAL_OVERDUE_MARKED` 事件类型里没人用的部分；动手时再全仓库搜一遍删除名单里的每个表名（`rg -n "asset_rental_term|tracked_asset|stock_order|inventory_consumption|stocktake_task|stocktake_line|project_equipment_plan|warehouse_asset_work_order|warehouse_manual|warehouse_task_"`），确认运行时代码里没有别的引用。这一步和删表迁移放在同一个 PR 里，**代码先上线，再跑迁移**。

生产执行步骤（两次 owner 确认）不变：先统计行数给 owner 看，再跑迁移、合并、验证健康检查和审批列表。
