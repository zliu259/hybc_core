# 库房重做 阶段 0：验证和备料 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在动手重做库房之前，证明"批内断言 + 约束回滚"在 D1 上成立，查清微盘接口的三个未知数，并把导入用的设备和物资清单定稿。

**Architecture:** 两个技术验证各自落成可重复运行的测试或脚本：批处理回滚用 `node:sqlite` 夹具测试加一个跑在本地 workerd D1 上的脚本；微盘用一个仅超管可调、自带清理的探测接口。备料是人工核对，计划只规定输入、输出和列格式。

**Tech Stack:** Hono、D1、Vitest、`node:sqlite`、wrangler `getPlatformProxy`、企微微盘服务端 API（经 bridge）。

**Spec:** `docs/superpowers/specs/2026-11-11-warehouse-rebuild-design.md`（第 6.3 节、第 8.4 节、第 15 节阶段 0、附录）

## Global Constraints

- 不用 `as any`、`@ts-ignore`。
- 用到 `node:sqlite` 的测试必须包在 `describe.skipIf(!hasSqlite)` 里；CI 是 Node 20 会跳过，推送前本地必须跑。
- 提交信息格式 `<type>: <description>`，不加 AI 署名。
- 推到 `main` 即部署。本计划在分支 `feat/warehouse-phase0` 上做，开 PR，不直接推 `main`。
- 微盘探测接口会真实调用企微生产接口，只能在 owner 完成管理端配置并同意部署后执行一次。
- 不查生产 D1。

## Review Focus

1. 断言条件为假但批处理没有回滚（最坏情况：设备被发出两次）。Task 1 和 Task 2 分别在 `node:sqlite` 和本地 workerd D1 上证明会回滚。
2. D1 返回的报错文案与 `node:sqlite` 不同，导致 `isGuardFailure` 认不出来。Task 2 的脚本打印真实文案，并用同一个匹配函数判断。
3. 探测中途失败，测试空间留在公司微盘里。Task 3 的测试覆盖"任一步失败仍执行清理"。
4. 探测接口被非超管或智能体令牌调用。Task 3 的路由测试覆盖 403。
5. 物资清单里的"25米""若干"被当成数字 0 或 25 导入。Task 4 的定稿格式要求数量列只能是数字，阶段 1 的导入解析对非数字逐行报错。

---

### Task 1: 通用 SQL 夹具和批内断言

**Files:**
- Create: `packages/api/test/helpers/sqlite-d1.ts`
- Modify: `packages/api/test/helpers/reimbursement-harness.ts`（把通用部分改为从新文件导入并原样再导出）
- Create: `packages/api/src/services/warehouse/guard.ts`
- Test: `packages/api/test/warehouse-guard.test.ts`

**Interfaces:**
- Produces（`test/helpers/sqlite-d1.ts`，从 `reimbursement-harness.ts` 原样搬出，签名不变）：`hasSqlite`、`readMigration(name)`、`listMigrationNames()`、`createSqliteD1(database, hooks?)`、`createMigratedDatabase(options?)`。
- Produces（`src/services/warehouse/guard.ts`）：

```ts
export type GuardParam = string | number | null;
/** 条件不成立时让整批回滚：existsSql 查不到行，NOT NULL 约束报错。 */
export const assertInBatch: (db: D1Database, existsSql: string, params: readonly GuardParam[]) => D1PreparedStatement;
/** 放在每个批处理的最后一条，保持 wh_guard 永远为空。 */
export const releaseGuards: (db: D1Database) => D1PreparedStatement;
export const isGuardFailure: (error: unknown) => boolean;
export const isCheckFailure: (error: unknown, constraintName: string) => boolean;
```

`assertInBatch` 生成的 SQL 固定为 `INSERT INTO wh_guard (ok) VALUES ((SELECT 1 WHERE EXISTS (<existsSql>)))`。`isGuardFailure` 判断报错信息是否包含 `wh_guard.ok`；`isCheckFailure` 判断是否同时包含 `CHECK constraint failed` 和约束名。

- [ ] **Step 1: 搬出通用夹具**

把上述五个导出从 `reimbursement-harness.ts` 移到 `sqlite-d1.ts`，原文件改成 `export { ... } from "./sqlite-d1"`。

- [ ] **Step 2: 确认没有破坏现有测试**

Run: `cd packages/api && npm test -- test/reimbursement-harness.test.ts test/approval-admin-all.test.ts`
Expected: 全部 PASS（本机 Node 有 `node:sqlite` 时不应出现 skipped）。

- [ ] **Step 3: 写失败的测试**

`test/warehouse-guard.test.ts`，在 `beforeEach` 里用内存库自建两张表：`wh_guard (ok INTEGER NOT NULL)` 和 `demo (id INTEGER PRIMARY KEY, qty REAL NOT NULL, CONSTRAINT demo_qty_non_negative CHECK (qty >= 0))`，并插入 `demo(1, 5)`。

```ts
it("断言为假时整批回滚", async () => {
  const batch = db.batch([
    db.prepare("UPDATE demo SET qty = qty + 10 WHERE id = 1"),
    assertInBatch(db, "SELECT 1 FROM demo WHERE id = ? AND qty < 0", [1]),
    releaseGuards(db)
  ]);
  await expect(batch).rejects.toSatisfy(isGuardFailure);
  expect(database.prepare("SELECT qty FROM demo WHERE id = 1").get().qty).toBe(5);
});

it("断言为真时提交，并且不留断言行", async () => {
  await db.batch([
    assertInBatch(db, "SELECT 1 FROM demo WHERE id = ? AND qty >= ?", [1, 5]),
    db.prepare("UPDATE demo SET qty = qty - 5 WHERE id = 1"),
    releaseGuards(db)
  ]);
  expect(database.prepare("SELECT qty FROM demo WHERE id = 1").get().qty).toBe(0);
  expect(database.prepare("SELECT COUNT(*) AS n FROM wh_guard").get().n).toBe(0);
});

it("违反 CHECK 约束时整批回滚，并能认出是哪个约束", async () => {
  const batch = db.batch([
    db.prepare("INSERT INTO demo (id, qty) VALUES (2, 1)"),
    db.prepare("UPDATE demo SET qty = qty - 6 WHERE id = 1")
  ]);
  await expect(batch).rejects.toSatisfy((e) => isCheckFailure(e, "demo_qty_non_negative"));
  expect(database.prepare("SELECT COUNT(*) AS n FROM demo").get().n).toBe(1);
});

it("普通报错不会被误认成断言失败", () => {
  expect(isGuardFailure(new Error("no such table: x"))).toBe(false);
});
```

- [ ] **Step 4: 运行，确认失败**

Run: `cd packages/api && npm test -- test/warehouse-guard.test.ts`
Expected: FAIL，找不到 `../src/services/warehouse/guard`。

- [ ] **Step 5: 实现 `guard.ts`**

按 Interfaces 的签名实现四个函数。

- [ ] **Step 6: 运行，确认通过**

Run: `cd packages/api && npm test -- test/warehouse-guard.test.ts && npm run typecheck`
Expected: 4 passed；typecheck 无错误。

- [ ] **Step 7: 提交**

```bash
git add packages/api/test/helpers/sqlite-d1.ts packages/api/test/helpers/reimbursement-harness.ts packages/api/src/services/warehouse/guard.ts packages/api/test/warehouse-guard.test.ts
git commit -m "test: 库房批内断言和通用 SQL 夹具"
```

### Task 2: 在本地 workerd D1 上验证批处理回滚

**Files:**
- Create: `packages/api/scripts/verify-d1-batch.mjs`
- Modify: `doc/开发记录.md`（追加验证结果）

**Interfaces:**
- Consumes: 与 Task 1 相同的两条判断规则（报错信息包含 `tmp_wh_guard.ok`；包含 `CHECK constraint failed` 和约束名）。脚本是纯 `.mjs`，不导入 TS 源码，自己内联这两条判断。
- Produces: 命令 `node scripts/verify-d1-batch.mjs`，成功时最后一行输出 `PASS d1 batch rollback (guard, check)`，退出码 0；任何一项不符输出 `FAIL <原因>`，退出码 1。

- [ ] **Step 1: 写脚本**

用 `import { getPlatformProxy } from "wrangler"` 取本地绑定（`configPath: "wrangler.toml"`），对 `env.DB`：

1. 建临时表 `tmp_wh_guard (ok INTEGER NOT NULL)` 和 `tmp_wh_demo (id INTEGER PRIMARY KEY, qty REAL NOT NULL, CONSTRAINT tmp_wh_demo_qty_non_negative CHECK (qty >= 0))`，插入 `(1, 5)`。
2. 跑与 Task 1 第一个用例相同的三条语句的 `batch`，要求抛错、`qty` 仍为 5，并把报错信息原文打印出来。
3. 跑与第三个用例相同的两条语句的 `batch`，要求抛错、表里仍只有 1 行，并打印报错信息原文。
4. `finally` 里删掉两张临时表并 `dispose()`。

- [ ] **Step 2: 运行**

Run: `cd packages/api && npm run db:migrate:local && node scripts/verify-d1-batch.mjs`
Expected: 打印两条报错原文，最后一行 `PASS d1 batch rollback (guard, check)`。

- [ ] **Step 3: 如果报错文案与 `node:sqlite` 不同**

把 Task 1 的 `isGuardFailure` / `isCheckFailure` 改成两种文案都能认，并在 `warehouse-guard.test.ts` 里加一条用 D1 真实文案构造 `Error` 的用例。文案相同则跳过这一步。

- [ ] **Step 4: 记录并提交**

在 `doc/开发记录.md` 末尾追加一段：日期、脚本命令、两条报错原文、结论。

```bash
git add packages/api/scripts/verify-d1-batch.mjs doc/开发记录.md
git commit -m "chore: 本地 D1 批处理回滚验证脚本"
```

### Task 3: 微盘探测接口

**Files:**
- Create: `packages/api/src/services/wedrive-probe.ts`
- Create: `packages/api/src/services/sha1-state.ts`
- Create: `packages/api/src/routes/admin-wedrive-probe.ts`
- Modify: `packages/api/src/services/wecom-approval-push.ts:96`（给 `fetchViaBridgeStrict` 加 `export`）
- Modify: `packages/api/src/index.ts`（挂载 `app.route("/api/v1/admin/wedrive", adminWedriveProbeRoutes)`，放在 `adminRoutes` 之前）
- Test: `packages/api/src/services/wedrive-probe.test.ts`、`packages/api/src/services/sha1-state.test.ts`、`packages/api/src/routes/admin-wedrive-probe.test.ts`

**Interfaces:**
- Consumes: `fetchWeComAccessToken(env)`（`services/wecom-api.ts`）、`fetchViaBridgeStrict<T>(env, url, { method: "POST", body })`。
- Produces:

```ts
// services/sha1-state.ts
/** SHA1 处理完 bytes 后的内部状态（5 个 32 位寄存器），不做结尾填充。bytes 长度必须是 64 的倍数。 */
export const sha1StateHex: (bytes: Uint8Array, wordEndian: "big" | "little") => string;

// services/wedrive-probe.ts
export interface WedriveProbeStep {
  step: string;
  ok: boolean;
  errcode: number | null;
  errmsg: string | null;
  detail?: Record<string, string | number | boolean | null>;
}
export interface WedriveProbeReport {
  started_at: string;
  finished_at: string;
  steps: WedriveProbeStep[];
  cleaned_up: boolean;
  api_calls: number;
}
export type WeComCaller = (apiName: string, body: Record<string, unknown>) => Promise<{ errcode: number; errmsg: string } & Record<string, unknown>>;
export const runWedriveProbe: (
  env: Env,
  options: { foreign_spaceid?: string },
  deps?: { call?: WeComCaller; fetchDownload?: (url: string, cookie: string) => Promise<{ status: number; length: number }> }
) => Promise<WedriveProbeReport>;
```

`apiName` 是 `cgi-bin/wedrive/` 之后的部分，例如 `space_create`。

探测步骤固定为下面的顺序，`step` 字段用这些名字：

| step | 做什么 | 记录到 detail |
|---|---|---|
| `mng_pro_info` | 查是否专业版 | `is_pro` |
| `mng_capacity` | 查容量 | `total_capacity_bytes`、`capacity_used_bytes` |
| `space_create` | 建空间，名字 `接口验证-可删除-<时间戳>` | `spaceid` |
| `file_create` | 在空间根目录建文件夹"验证目录" | `fileid` |
| `file_upload` | 往文件夹里直传 1KB 的 `probe.txt`，带 `skip_push_card: true` | `fileid` |
| `file_list` | 列出文件夹 | `count` |
| `file_info` | 取刚上传文件的信息 | `has_sha`、`has_mtime` |
| `file_download` | 取下载地址后用 `fetchDownload` 带 cookie 取一次 | `http_status`、`length` |
| `chunk_upload_big` | 分块上传 3MB（2 块），中间块的 `block_sha` 用 `sha1StateHex(..., "big")`，末块用整文件 SHA1 | `fileid` |
| `chunk_upload_little` | 仅当上一步失败时执行，改用 `"little"` | `fileid` |
| `foreign_file_list` | 仅当传了 `foreign_spaceid`：对它调 `file_list` | 无 |
| `file_delete` | 删掉本次上传的文件 | 无 |
| `space_dismiss` | 解散本次建的空间 | 无 |

规则：任一步失败只记录、不抛出；依赖前一步产物的步骤在产物缺失时记 `ok: false, errmsg: "skipped"`；只要 `space_create` 成功过，无论中间发生什么都执行 `space_dismiss`，`cleaned_up` 等于它是否成功。`foreign_file_list` 的 `ok` 表示"调用返回了 errcode"，预期 errcode 是 640008。

- 路由：`POST /api/v1/admin/wedrive/probe`，`authMiddleware` 后要求 `roles` 含 `super_admin` 且 `auth_method !== "mcp_agent"`，否则 403 `{ success: false, error: { message: "只有超级管理员可以执行" } }`。请求体 `{ foreign_spaceid?: string }`，返回 `{ success: true, data: WedriveProbeReport }`。

- [ ] **Step 1: 写 `sha1-state` 的失败测试**

```ts
it("空输入给出 SHA1 初始状态", () => {
  expect(sha1StateHex(new Uint8Array(0), "big")).toBe("67452301efcdab8998badcfe10325476c3d2e1f0");
});
it("little 端序只翻转每个字的字节序", () => {
  expect(sha1StateHex(new Uint8Array(0), "little")).toBe("0123456789abcdeffedcba9876543210f0e1d2c3");
});
it("64 字节零块的状态与手算一致，且不等于标准摘要", async () => {
  const block = new Uint8Array(64);
  const state = sha1StateHex(block, "big");
  const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-1", block))].map((b) => b.toString(16).padStart(2, "0")).join("");
  expect(state).toHaveLength(40);
  expect(state).not.toBe(digest);
});
it("长度不是 64 的倍数时报错", () => {
  expect(() => sha1StateHex(new Uint8Array(10), "big")).toThrow("64");
});
```

- [ ] **Step 2: 运行确认失败，实现 `sha1StateHex`，再运行确认通过**

Run: `cd packages/api && npm test -- src/services/sha1-state.test.ts`
实现是标准 SHA1 的压缩函数循环，去掉结尾填充，输出 h0 到 h4。

- [ ] **Step 3: 写 `runWedriveProbe` 的失败测试**

用假的 `call` 和 `fetchDownload`：

```ts
it("全部成功时按固定顺序执行并清理", async () => {
  const report = await runWedriveProbe(env, {}, { call: okCaller, fetchDownload: async () => ({ status: 200, length: 1024 }) });
  expect(report.steps.map((s) => s.step)).toEqual([
    "mng_pro_info", "mng_capacity", "space_create", "file_create", "file_upload",
    "file_list", "file_info", "file_download", "chunk_upload_big", "file_delete", "space_dismiss"
  ]);
  expect(report.cleaned_up).toBe(true);
});
it("中间一步失败仍然解散空间", async () => {
  const report = await runWedriveProbe(env, {}, { call: failOn("file_upload", 640019), fetchDownload });
  expect(report.steps.find((s) => s.step === "file_upload")).toMatchObject({ ok: false, errcode: 640019 });
  expect(report.steps.at(-1)).toMatchObject({ step: "space_dismiss", ok: true });
  expect(report.cleaned_up).toBe(true);
});
it("big 端序分块失败时再试 little", async () => {
  const report = await runWedriveProbe(env, {}, { call: failOn("file_upload_finish", 640030, { times: 1 }), fetchDownload });
  expect(report.steps.map((s) => s.step)).toContain("chunk_upload_little");
});
it("建空间失败时不调用后续写接口，也不解散", async () => {
  const calls: string[] = [];
  const report = await runWedriveProbe(env, {}, { call: recording(calls, failOn("space_create", 60020)), fetchDownload });
  expect(calls).toEqual(["mng_pro_info", "mng_capacity", "space_create"]);
  expect(report.cleaned_up).toBe(false);
});
it("传了外部空间时记录它的 errcode", async () => {
  const report = await runWedriveProbe(env, { foreign_spaceid: "s.x" }, { call: failOn("file_list", 640008, { whenSpace: "s.x" }), fetchDownload });
  expect(report.steps.find((s) => s.step === "foreign_file_list")).toMatchObject({ ok: true, errcode: 640008 });
});
```

- [ ] **Step 4: 运行确认失败，实现 `runWedriveProbe`，再运行确认通过**

Run: `cd packages/api && npm test -- src/services/wedrive-probe.test.ts`
默认的 `call` 用 `fetchWeComAccessToken` 加 `fetchViaBridgeStrict` 发 POST；默认的 `fetchDownload` 直接 `fetch`，带 `Cookie: <cookie_name>=<cookie_value>`，读完响应体后返回状态码和字节数。

- [ ] **Step 5: 写路由的失败测试，实现路由并挂载**

测试用 `vi.mock("../services/auth")` 的方式（参照 `packages/api/test/approval-admin-all.test.ts:12-28`）构造三种身份：`super_admin` 得 200；`manager` 得 403；`super_admin` 但 `auth_method: "mcp_agent"` 得 403。测试里 `vi.mock("../services/wedrive-probe")` 让 `runWedriveProbe` 返回固定报告。

Run: `cd packages/api && npm test -- src/routes/admin-wedrive-probe.test.ts && npm run typecheck && npm run lint`
Expected: 全部通过。

- [ ] **Step 6: 提交并开 PR**

```bash
git add packages/api/src/services/wedrive-probe.ts packages/api/src/services/wedrive-probe.test.ts packages/api/src/services/sha1-state.ts packages/api/src/services/sha1-state.test.ts packages/api/src/routes/admin-wedrive-probe.ts packages/api/src/routes/admin-wedrive-probe.test.ts packages/api/src/services/wecom-approval-push.ts packages/api/src/index.ts
git commit -m "feat: 微盘接口探测（仅超管，自带清理）"
```

- [ ] **Step 7: 执行探测（需要 owner 两次确认）**

前置条件，缺一不可：

1. owner 已在企微管理端"协作 → 微盘 → API"把本应用加入可调用接口的应用。
2. owner 同意合并 PR（合并即部署）。

部署后由超管登录 Web，在浏览器控制台对 `/api/v1/admin/wedrive/probe` 发一次 POST。想顺便验证"手建空间读不到"，请求体带上公司空间的 `spaceid`。把返回的 JSON 存为 `mig/warehouse/wedrive-probe-<日期>.json`。

- [ ] **Step 8: 把结论写回设计稿**

按报告更新 `docs/superpowers/specs/2026-11-11-warehouse-rebuild-design.md` 的附录和第 20 节，逐条回答：

- 是否专业版，容量多少。
- 直传、建目录、列目录、下载是否可用；下载是否必须带 cookie。
- 分块上传用哪种端序成功，或两种都失败时的 errcode。
- 是否出现 640019 或 640035（月调用上限）。
- 对手建空间调用返回的 errcode。

提交：`git commit -m "docs: 微盘探测结论写入库房设计稿"`。

### Task 4: 导入清单定稿（人工）

**Files:**
- 输入（已存在，不进 git）：`mig/warehouse/物资档案草稿.csv`、`mig/warehouse/设备清单草稿-顶管机.csv`、`mig/warehouse/土压配套清单-工程对照.csv`、`mig/warehouse/泥水配套清单-工程对照.csv`
- 输出（不进 git）：`mig/warehouse/物资档案-定稿.csv`、`mig/warehouse/设备清单-定稿.csv`

**Interfaces:**
- Produces: 两份定稿的列名和取值规则。阶段 1 的导入功能按这个格式解析，列名必须一字不差。

物资档案定稿的列：

| 列名 | 规则 |
|---|---|
| 品名 | 必填 |
| 规格 | 可空；不允许"DN25/32/40"这类合并写法，一个规格一行 |
| 单位 | 必填 |
| 分节 | 必填，取现有清单的 11 个分节名之一 |
| 管法 | 必填，`周转` 或 `消耗`。按台管的东西不出现在这份表里 |
| 期初数量 | 可空，只能是数字 |
| 单价 | 可空，只能是数字 |
| 最低库存 | 可空，只能是数字 |
| 库位 | 可空 |
| 备注 | 可空 |

设备清单定稿的列：

| 列名 | 规则 |
|---|---|
| 编号 | 可空，空则系统生成 `SB-0001` 起的编号 |
| 名称 | 必填，例如"唐兴-NSPD1200泥水平衡顶管机" |
| 现场叫法 | 可空，例如"DN1550-1" |
| 类别 | 必填，例如顶管机、油泵站、发电机 |
| 机型 | 顶管机必填：泥水平衡、土压平衡、岩石破碎、卵石破碎、泥水/土压两用 |
| 口径 | 可空，只能是整数（毫米） |
| 厂家、型号、出厂编号、规格 | 可空 |
| 所在项目 | 可空；填了就必须和系统里的项目名称完全一致，表示这台设备现在在工地上 |
| 库位、备注 | 可空 |

- [ ] **Step 1: 李震核对物资档案草稿**

逐行确认"建议管法"，把标成"按台"的行移到设备清单；补全 84 条空规格；把 39 条合并写法拆行；改掉 6 处非数字的计划数和原表笔误。期初数量按现在库里的实际数填，不知道的留空。

- [ ] **Step 2: 核对设备清单草稿**

`设备清单草稿-顶管机.csv` 有 31 行，来自微盘文件夹名，其中"唐兴-SPB1550BYA"出现两次，需要确认是两台还是重复。补上现场叫法和现在在哪。再把物资草稿里移过来的按台设备（油泵站、发电机、泵、焊机、测量仪器等）逐台加进去。

- [ ] **Step 3: owner 确认三件事**

备用库管是谁；资料管理员名单；二维码标签用 A4 不干胶还是标签打印机。结论写进设计稿第 16 节。

- [ ] **Step 4: 自查定稿**

两份定稿另存为 UTF-8 的 CSV。检查：列名与上表一致；数量列没有非数字；物资没有重复的"品名 + 规格"；设备没有重复的编号。
