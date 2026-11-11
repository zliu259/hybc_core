# 库房重做 阶段 2：项目配套清单 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把李震那张"设备出入库登记表"做成系统里能自动填的项目配套清单：选模板出清单、项目方提交库管确认、按清单发货、返库报损后项目物资自动结清。

**Architecture:** 新增四张表（模板、模板行、项目清单、清单行）。清单只存计划，不存实发：已发、已退、报损、在场全部从阶段 1 的库房单按项目汇总算出；一个项目多份清单时，已发数按清单确认先后依次分摊。按清单发货就是阶段 1 的发货单多带一个 `project_kit_id`。Web 新增"项目配套"页（清单列表、清单详情、项目物资、模板）。

**Tech Stack:** Hono + D1（`packages/api`）、Vue 3 + Element Plus + PureAdmin（`packages/web`）、Vitest、`node:sqlite` 测试夹具。

**Spec:** `docs/superpowers/specs/2026-11-11-warehouse-rebuild-design.md`（6.1 项目配套清单、7.1 到 7.4、9、11、12、18）

**前置：** 阶段 1 已上线（PR #24，迁移 0095）。阶段 1 计划的台账 `.superpowers/sdd/2026-11-11-warehouse-phase1-core/progress.md` 里有全部 Ruling，本计划沿用其中的约定（`guarded`、`handleWarehouseError`、`queryIn`、批内断言、`client_request_id`）。

## Global Constraints

- 接口统一返回 `{ success: true, data }` 或 `{ success: false, error: { message } }`；列表另带 `pagination: { page, pageSize, total }`。`message` 一律中文。
- 新路由挂进 `routes/wh-app.ts` 的 `mountWarehouseRoutes`（只在那里过一次 `authMiddleware`），路由函数用 `guarded()` 包住。读接口 `requireRoles(ALL_ROLES)`；写接口先过 `requireHuman`（拒绝智能体令牌），再做能力校验。
- 多步写入一律 `runAtomicBatch`，前置条件用 `assertInBatch`，批处理最后一条 `releaseGuards`。`IN (...)` 列表一律用 `services/warehouse/query-in.ts` 的 `queryIn`（D1 一条语句最多 100 个绑定参数）。
- 数量：大于等于 0，最多 3 位小数，不超过 1000000；设备行的计划数是整数。字符串都有长度上限。
- 模板行和未确认清单的行在保存时整体替换（它们是一份正在编辑的文档，不是有历史的业务记录）；已确认的清单不能再改，追加用新清单。其余只做软删除。
- 单个路由文件、service 文件、视图文件不超过 400 行。
- 界面上不出现英文枚举值和数字 ID。
- 用到 `node:sqlite` 的测试包在 `describe.skipIf(!hasSqlite)` 里，推送前本地必须跑。
- 提交信息格式 `<type>: <description>`，不加 AI 署名。
- 分支 `feat/warehouse-phase2-kits`，从 `main` 切出，开 PR，不直接推 `main`。迁移 0096 先于合并执行（需要 owner 同意）。阶段 1 计划里删旧表的 Task 19 改用 0096 之后的空号。
- 本阶段不做：企微通知（阶段 3）、小程序页面（阶段 3）、"从清单返库"（返库已经按项目在场清单做，阶段 1 已有）。
- 设计稿没写死、本计划定下的地方（实施时如有不同意见，先改这里）：
  1. 一个项目多份清单时，已发数按清单确认的先后依次分给各行（先确认的先分满），所以每份清单的"已发、待发"加起来等于项目的总数，不会重复。
  2. "计划"只算已确认和已关闭清单里来源是"库房发"、计划数大于 0 的行；草稿和待确认的清单不算。
  3. 未确认的清单可以"作废"（单独的 `/discard`，必须写原因，状态记为已关闭）；已确认的清单只有项目结清后才能"关闭"。
  4. 计划数可以是 0：模板里这个工程用不上的行留着不删也行，不参与统计，也不要求选规格。

**权限（设计稿第 9 节）：**

| 动作 | 库管 | 经理 | 现场负责人 | 操作员、财务 | 智能体令牌 |
|---|---|---|---|---|---|
| 看模板、清单、项目物资 | 是 | 是 | 是 | 是 | 否（无白名单） |
| 维护模板 | 是 | 否 | 否 | 否 | 否 |
| 建清单、改、提交、作废未确认的清单 | 是 | 是 | 只限 `project.manager_userid` 是自己的项目 | 否 | 否 |
| 确认清单、关闭已确认的清单 | 是 | 否 | 否 | 否 | 否 |

超管拥有库管身份（阶段 1 的 `getWarehouseCapabilities`）。已有能力位 `can_create_kit`（库管、经理、现场负责人）直接用；"自己的项目"在 service 里判断。

## Review Focus

1. **同一项目两份清单（主清单 + 追加）都写了排泥钢管。** 计划数相加；已发数先分给先确认的那份，分满了再给后一份；不会两份都显示"已发 100"。Task 4。
2. **发货单被冲销。** 清单的已发数跟着减少，待发恢复；项目物资页的已发也减少。Task 4。
3. **模板里同一品名有两种规格（排泥钢管 Φ114、Φ80）。** 生成清单时不替用户选，行上显示"待选规格"；提交被拒并指出是第几行。Task 3。
4. **发货单带的清单不属于这个项目、还没确认、或已关闭。** 返回 400/409，不生成单，数量不变。Task 5。
5. **项目还有东西在场时关闭清单。** 拒绝并说明还有几台设备、几种周转件在场；全部退回或报损后可以关闭。Task 4。

---

### Task 1: 迁移 0096 和测试夹具

**Files:**
- Create: `packages/api/migrations/0096_warehouse_kits.sql`
- Modify: `packages/api/src/types/wh.ts`（加类型）
- Modify: `packages/api/test/helpers/warehouse-harness.ts`（加 `seed.kitTemplate`、`seed.kit`）
- Test: `packages/api/test/warehouse-kit-schema.test.ts`

**Interfaces:**
- Produces（`types/wh.ts`）：
  - `type KitLineKind = "device" | "material" | "text"`
  - `type KitLineSource = "warehouse" | "site_purchase" | "rental" | "on_site"`
  - `type ProjectKitStatus = "draft" | "submitted" | "confirmed" | "closed"`
  - `interface KitTemplate { id; name; machine_type: string | null; remark: string | null; status: "active" | "disabled"; version: number; created_by_userid; created_at; updated_at }`
  - `interface KitTemplateLine { id; template_id; section: string; sort_order: number; line_kind: KitLineKind; device_category_id: number | null; name_text: string; spec_text: string | null; unit: string | null; default_qty: number | null; note: string | null }`
  - `interface ProjectKit { id; kit_no; project_id; title; template_id: number | null; copied_from_kit_id: number | null; status: ProjectKitStatus; remark; created_by_userid; submitted_by_userid; submitted_at; confirmed_by_userid; confirmed_at; closed_by_userid; closed_at; close_reason; version; created_at; updated_at }`
  - `interface ProjectKitLine { id; kit_id; section; sort_order; line_kind; device_category_id; material_id: number | null; name_text; spec_text; unit; planned_qty: number; source: KitLineSource; note }`
- Produces（harness）：`seed.kitTemplate(overrides?, lines?) → id`、`seed.kit(overrides?, lines?) → id`（默认 `status: "confirmed"`、`confirmed_at` 为当前时间，行默认 `source: "warehouse"`）。

表结构（设计稿 6.1，字段名照抄）：

- `kit_template`：`name` 唯一；`status` CHECK `active|disabled`；`version` 默认 0。
- `kit_template_line`：`template_id` 外键；`line_kind` CHECK 三值；CHECK `line_kind <> 'device' OR device_category_id IS NOT NULL`；`default_qty` CHECK 空或 `>= 0`。
- `project_kit`：`kit_no` 唯一；`project_id` 非空外键；`status` CHECK 四值；`version` 默认 0。
- `project_kit_line`：`kit_id` 外键；同上两条 CHECK；`planned_qty` 非空 CHECK `>= 0`；`source` CHECK 四值。
- 索引：`idx_kit_template_line_template_id`、`idx_project_kit_project_id`、`idx_project_kit_status`、`idx_project_kit_line_kit_id`、`idx_project_kit_line_material_id`、`idx_wh_doc_project_kit_id`（`wh_doc.project_kit_id` 阶段 1 已建列）。

- [ ] **Step 1: 写失败的测试 `warehouse-kit-schema.test.ts`**

```ts
it("四张表存在，约束生效", () => {
  const h = createWarehouseHarness();
  const templateId = h.seed.kitTemplate({ name: "土压平衡" });
  expect(() => h.seed.kitTemplate({ name: "土压平衡" })).toThrow(/UNIQUE/);
  expect(() => insertTemplateLine(h, templateId, { line_kind: "device", device_category_id: null })).toThrow(/CHECK/);
  expect(() => insertTemplateLine(h, templateId, { line_kind: "material", default_qty: -1 })).toThrow(/CHECK/);
  const projectId = h.seed.project();
  const kitId = h.seed.kit({ project_id: projectId });
  expect(() => insertKitLine(h, kitId, { source: "borrowed" })).toThrow(/CHECK/);
  expect(() => insertKitLine(h, kitId, { planned_qty: -2 })).toThrow(/CHECK/);
  expect(() => h.seed.kit({ project_id: projectId, status: "approved" })).toThrow(/CHECK/);
});
```

（`insertTemplateLine`、`insertKitLine` 是测试文件里的小函数，直接 `h.database.prepare(INSERT ...)`。）

- [ ] **Step 2: 运行，确认失败**

Run: `cd packages/api && npx vitest run test/warehouse-kit-schema.test.ts`
Expected: FAIL，`no such table: kit_template`

- [ ] **Step 3: 写迁移、类型和夹具**

- [ ] **Step 4: 运行，确认通过；跑迁移编号检查**

Run: `npx vitest run test/warehouse-kit-schema.test.ts && node scripts/check-migration-numbers.mjs`
Expected: PASS；`OK: no new duplicate migration numbers`

- [ ] **Step 5: 本地库执行迁移并提交**

```bash
npm run db:migrate:local
git add packages/api/migrations/0096_warehouse_kits.sql packages/api/src/types/wh.ts packages/api/test/helpers/warehouse-harness.ts packages/api/test/warehouse-kit-schema.test.ts
git commit -m "feat: 配套清单的表和测试夹具"
```

---

### Task 2: 模板

**Files:**
- Create: `packages/api/src/services/warehouse/kit-lines.ts`（模板和清单共用的行校验）
- Create: `packages/api/src/services/warehouse/kit-template.ts`
- Create: `packages/api/src/routes/wh-kit-template.ts`
- Modify: `packages/api/src/routes/wh-app.ts`
- Test: `packages/api/test/warehouse-kit-template.test.ts`

**Interfaces:**
- Consumes: `requireKeeper`、`requireHuman`（`access.ts`）；`requireText`、`optionalText`、`optionalNumber`、`requireEnum`、`requireId`（`validation.ts`）；`queryIn`。
- Produces（`kit-lines.ts`）：
  - `MAX_KIT_LINES = 300`
  - `interface ParsedKitLine { section: string; sort_order: number; line_kind: KitLineKind; device_category_id: number | null; material_id: number | null; name_text: string; spec_text: string | null; unit: string | null; qty: number | null; source: KitLineSource; note: string | null }`
  - `parseKitLines(raw: unknown, mode: "template" | "kit"): ParsedKitLine[]`：`sort_order` 按数组下标重排；`qty` 在模板里来自 `default_qty`（可空），在清单里来自 `planned_qty`（空当 0）；设备行的数量必须是整数；`source` 只在清单模式读，缺省 `warehouse`；模板模式忽略 `material_id`。错误信息带行号："第 3 行：设备行要选设备类别"。
  - `assertCategoriesExist(env, lines): Promise<void>`、`assertMaterialsActive(env, lines): Promise<void>`（"第 5 行：物资已停用：排泥钢管 Φ114"）。
- Produces（`kit-template.ts`）：
  - `listKitTemplates(env, query: { status?: string }): Promise<(KitTemplate & { line_count: number })[]>`
  - `getKitTemplate(env, id): Promise<(KitTemplate & { lines: KitTemplateLineView[] }) | null>`，`KitTemplateLineView` 带 `device_category_name`
  - `createKitTemplate(env, input, userid): Promise<{ id: number }>`（`name` 必填，`lines` 可选）
  - `updateKitTemplate(env, id, input): Promise<void>`：`version` 必填；`name`、`machine_type`、`remark`、`status` 传了才改；传了 `lines` 就整体替换。一个批处理：断言版本 → 改头 → 删旧行 → 插新行。
- Produces（路由）：`GET /warehouse/kit-template`、`GET /warehouse/kit-template/:id`、`POST /warehouse/kit-template`、`PUT /warehouse/kit-template/:id`。读：全部角色；写：`requireHuman` + `requireKeeper`。

- [ ] **Step 1: 写失败的测试**

```ts
it("新建模板带 3 行（设备、物资、备忘），读回来顺序和类别名都对", async () => {
  const cat = h.seed.category("顶管机");
  const { id } = await createKitTemplate(h.env, {
    name: "土压平衡", machine_type: "土压平衡",
    lines: [
      { section: "顶进设备", line_kind: "device", device_category_id: cat, name_text: "机头土压", unit: "台", default_qty: 1 },
      { section: "辅助设备", line_kind: "material", name_text: "排泥钢管", spec_text: "Φ114", unit: "米", default_qty: 120 },
      { section: "生活设施", line_kind: "text", name_text: "集装箱", note: "本地租" }
    ]
  }, "keeper");
  const t = await getKitTemplate(h.env, id);
  expect(t.lines.map((l) => [l.sort_order, l.line_kind, l.name_text, l.device_category_name ?? null]))
    .toEqual([[0, "device", "机头土压", "顶管机"], [1, "material", "排泥钢管", null], [2, "text", "集装箱", null]]);
});

it.each([
  [[{ section: "x", line_kind: "device", name_text: "机头" }], "第 1 行：设备行要选设备类别"],
  [[{ section: "x", line_kind: "device", device_category_id: 999, name_text: "机头" }], "第 1 行：设备类别不存在"],
  [[{ section: "x", line_kind: "device", device_category_id: CAT, name_text: "机头", default_qty: 1.5 }], "第 1 行：设备数量必须是整数"],
  [[{ section: "x", line_kind: "material", name_text: "管", default_qty: "25米" }], "第 1 行：数量"],
  [[{ section: "", line_kind: "text", name_text: "管" }], "第 1 行：分节不能为空"],
  [Array.from({ length: 301 }, () => ({ section: "x", line_kind: "text", name_text: "a" })), "最多 300 行"]
])("拒绝 %#", async (lines, message) => {
  await expect(createKitTemplate(h.env, { name: "x", lines }, "keeper"))
    .rejects.toMatchObject({ status: 400, message: expect.stringContaining(message) });
  expect(h.database.prepare("SELECT COUNT(*) AS n FROM kit_template").get().n).toBe(0);
});

it("修改：版本号不对 409；整体替换行；可以停用", async () => { /* version 0 ok → version 0 again → 409 数据已变化 */ });

it("接口：库管 201；经理、操作员 403；智能体令牌 403；所有人能读", async () => {});
```

- [ ] **Step 2: 运行，确认失败**

Run: `cd packages/api && npx vitest run test/warehouse-kit-template.test.ts`
Expected: FAIL，模块不存在

- [ ] **Step 3: 实现 `kit-lines.ts`、`kit-template.ts`、路由，并挂进 `wh-app.ts`**

- [ ] **Step 4: 运行，确认通过**

Run: `npx vitest run test/warehouse-kit-template.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/api/src/services/warehouse/kit-lines.ts packages/api/src/services/warehouse/kit-template.ts packages/api/src/routes/wh-kit-template.ts packages/api/src/routes/wh-app.ts packages/api/test/warehouse-kit-template.test.ts
git commit -m "feat: 配套清单模板"
```

---

### Task 3: 项目清单的建、改、提交、确认、作废

**Files:**
- Create: `packages/api/src/services/warehouse/kit.ts`（写）
- Create: `packages/api/src/services/warehouse/kit-query.ts`（读）
- Create: `packages/api/src/routes/wh-kit.ts`
- Modify: `packages/api/src/routes/wh-app.ts`
- Test: `packages/api/test/warehouse-kit.test.ts`

**Interfaces:**
- Consumes: `parseKitLines`、`assertCategoriesExist`、`assertMaterialsActive`、`MAX_KIT_LINES`（Task 2）；`getWarehouseCapabilities`、`requireHuman`（阶段 1）；`generateSerials(db, "PT", "project_kit", "kit_no", 1)`。
- Produces（`kit-query.ts`）：
  - `interface ProjectKitRow extends ProjectKit { project_name: string; project_manager_userid: string | null; template_name: string | null; line_count: number }`（`project_manager_userid` 给前端判断现场负责人能不能改）
  - `listProjectKits(env, query: { project_id?; status?; keyword?; page?; pageSize? }): Promise<Paged<ProjectKitRow>>`，按 `updated_at` 倒序
  - `interface ProjectKitLineView extends ProjectKitLine { material_code; material_name; material_spec; material_unit; material_status; category_name; spec_choices: { id: number; spec: string }[] }`（`spec_choices` 是同品名的在用物资，物资行"待选规格"时给前端下拉用）
  - `getProjectKit(env, id): Promise<(ProjectKitRow & { lines: ProjectKitLineView[] }) | null>`
- Produces（`kit.ts`）：
  - `createProjectKit(env, input, auth, caps): Promise<{ id: number; kit_no: string }>`。`input`：`project_id`（必填）、`title`（必填，≤60）、`remark`，以及三选一的来源：`template_id`、`copy_from_kit_id`、都不给（空清单）。
    - 从模板生成：物资行按 `name_text` 找在用物资；`spec_text` 非空且有一条规格相同的取它；否则只有一条同名的取它；否则 `material_id` 留空（待选规格）。`planned_qty = default_qty ?? 0`，`source = "warehouse"`。
    - 从另一份清单复制：照抄行（含 `material_id`、`planned_qty`、`source`）；被复制的清单可以是任何项目的。
  - `updateProjectKit(env, id, input, auth, caps): Promise<void>`：草稿或已提交时可改；`version` 必填；`title`、`remark` 传了才改；`lines` 传了就整体替换。
  - `submitProjectKit(env, id, { version }, auth, caps): Promise<{ status: "submitted" | "confirmed" }>`：草稿才能提交；库管提交直接确认（设计稿 7.1 第 3 条）。
  - `confirmProjectKit(env, id, { version }, userid): Promise<void>`：只有已提交的能确认。
  - `discardProjectKit(env, id, { version, reason }, auth, caps): Promise<void>`：草稿或已提交的作废，状态改成 `closed`，`close_reason` 必填。已确认清单的关闭在 Task 4（要先结清）。
  - 提交和确认时的校验 `assertKitReady(lines)`：至少一行；`planned_qty > 0` 的物资行必须有 `material_id`（"第 4 行：排泥钢管 还没选规格"）；物资未停用。计划数为 0 的行保留但不参与统计。
  - 谁能改：库管任何项目；经理任何项目；现场负责人只限 `project.manager_userid === auth.sub` 的项目（"只能给自己负责的项目建清单"）；其他人 403。确认只有库管。
- Produces（路由 `wh-kit.ts`）：`GET /warehouse/kit`、`GET /warehouse/kit/:id`、`POST /warehouse/kit`、`PUT /warehouse/kit/:id`、`POST /warehouse/kit/:id/submit`、`/confirm`、`/discard`。

- [ ] **Step 1: 写失败的测试**

```ts
it("从模板生成：唯一的同名物资自动选上；同名两种规格且模板没写规格时留空", async () => {
  h.seed.material({ name: "电焊条", spec: "J422" });
  h.seed.material({ name: "排泥钢管", spec: "Φ114" });
  h.seed.material({ name: "排泥钢管", spec: "Φ80" });
  const templateId = h.seed.kitTemplate({}, [
    { line_kind: "material", name_text: "电焊条", default_qty: 5 },
    { line_kind: "material", name_text: "排泥钢管", default_qty: 120 },
    { line_kind: "material", name_text: "排泥钢管", spec_text: "Φ80", default_qty: 60 }
  ]);
  const { id, kit_no } = await createProjectKit(h.env, { project_id: projectId, title: "临河 DN1200", template_id: templateId }, keeperAuth, keeperCaps);
  expect(kit_no).toMatch(/^PT-\d{8}-0001$/);
  const kit = await getProjectKit(h.env, id);
  expect(kit.status).toBe("draft");
  expect(kit.lines.map((l) => [l.name_text, l.material_spec ?? null, l.planned_qty, l.spec_choices.length]))
    .toEqual([["电焊条", "J422", 5, 1], ["排泥钢管", null, 120, 2], ["排泥钢管", "Φ80", 60, 2]]);
});

it("还没选规格的物资行不能提交，报出第几行；选好后库管提交直接确认", async () => {
  // 上面的清单 → submit → 400 "第 2 行：排泥钢管 还没选规格"
  // PUT 把第 2 行 material_id 改成 Φ114 → submit → { status: "confirmed" }，confirmed_by_userid = keeper
});

it("现场负责人：给自己的项目建清单并提交，状态待确认；给别人的项目建 403；库管确认", async () => {});
it("计划数为 0 的物资行不需要选规格", async () => {});
it("从另一份清单复制：行、规格、来源、计划数都照抄", async () => {});
it("已确认的清单不能再改，也不能作废（409）；作废必须写原因", async () => {});
it("版本号不对 409", async () => {});
it("接口：操作员建清单 403；经理 201；经理确认 403；智能体令牌 403；列表按项目和状态筛选", async () => {});
```

- [ ] **Step 2: 运行，确认失败**

Run: `cd packages/api && npx vitest run test/warehouse-kit.test.ts`
Expected: FAIL，模块不存在

- [ ] **Step 3: 实现 `kit-query.ts`、`kit.ts`、路由，挂进 `wh-app.ts`**

- [ ] **Step 4: 运行，确认通过**

Run: `npx vitest run test/warehouse-kit.test.ts test/warehouse-kit-template.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/api/src/services/warehouse/kit.ts packages/api/src/services/warehouse/kit-query.ts packages/api/src/routes/wh-kit.ts packages/api/src/routes/wh-app.ts packages/api/test/warehouse-kit.test.ts
git commit -m "feat: 项目配套清单的建、改、提交、确认"
```

---

### Task 4: 清单执行情况、项目物资页、关闭清单

**Files:**
- Create: `packages/api/src/services/warehouse/kit-allocation.ts`（纯函数）
- Create: `packages/api/src/services/warehouse/project-ledger.ts`
- Modify: `packages/api/src/services/warehouse/kit.ts`（加 `closeProjectKit`）
- Modify: `packages/api/src/routes/wh-kit.ts`（加 `GET /warehouse/kit/:id/fulfilment`、`POST /warehouse/kit/:id/close`）
- Modify: `packages/api/src/routes/wh-doc.ts`（加 `GET /warehouse/project/:projectId/ledger`，和阶段 1 的 holdings 放在一起）
- Test: `packages/api/test/warehouse-kit-allocation.test.ts`、`packages/api/test/warehouse-project-ledger.test.ts`

**Interfaces:**
- Produces（`kit-allocation.ts`）：
  - `type AllocKey = string`（物资 `m:<material_id>`，设备类别 `c:<device_category_id>`）
  - `interface AllocLine { line_id: number; key: AllocKey; planned: number }`（调用方按清单确认时间、`kit.id`、`sort_order`、`line.id` 排好序传进来）
  - `allocateShipped(lines: readonly AllocLine[], shipped: ReadonlyMap<AllocKey, number>): Map<number, number>`：同一个 key 按顺序依次分，每行最多分到它的计划数；已发是负数或 0 时都分 0。
- Produces（`project-ledger.ts`）：
  - `loadProjectShipped(env, projectId): Promise<Map<AllocKey, number>>`。口径（全部用带符号的列，冲销单自动抵消）：
    - 物资已发 = 该项目 `out` 单物资行 `-stock_delta` 之和 + `transfer` 单里 `wh_doc.to_project_id = 项目` 且 `line.project_id = 项目` 的 `project_delta` 之和。
    - 设备已发 = 该项目 `out` 单和转入该项目的 `transfer` 单的设备行，原单记 +1、冲销单（`reverses_doc_id` 非空）记 -1，按 `device.category_id` 汇总。
  - `interface LedgerMaterialRow { material_id; material_code; name; spec; unit; kind; planned; shipped; transferred_out; returned; lost; on_site: number | null; first_out_at: string | null; last_back_at: string | null; unit_price: number | null; loss_amount: number | null }`
    - `returned` = 返库单 `outcome = 'returned'` 行的 `stock_delta` 之和；`lost` = `outcome = 'lost'` 行的 `-project_delta` 之和；`transferred_out` = 转出单（`wh_doc.project_id = 项目`）该项目行的 `-project_delta` 之和；`on_site` 只对周转件给（`project_delta` 之和），消耗类为 `null`；`loss_amount = lost × unit_price`，没单价为 `null`。
    - `first_out_at`、`last_back_at` 只看没被冲销、本身也不是冲销单的单。
  - `interface LedgerDeviceRow { device_category_id; category_name; planned; shipped; on_site }`
  - `interface ProjectLedger { project_id; project_name; settled: boolean; devices_on_site: number; turnover_kinds_on_site: number; materials: LedgerMaterialRow[]; device_categories: LedgerDeviceRow[]; devices: DeviceRow[]; kits: ProjectKitRow[] }`
  - `getProjectLedger(env, projectId): Promise<ProjectLedger>`。"计划"只算已确认和已关闭清单里 `source = 'warehouse'` 的行。`settled` = 没有设备在这个项目且所有周转件在场数为 0。行的集合 = 计划过的 ∪ 动过的。
  - `interface KitFulfilmentLine extends ProjectKitLineView { shipped: number; pending: number; in_stock: number | null }`（`in_stock` 是物资的在库数；设备行是该类别现在"可用"的台数）
  - `getKitFulfilment(env, kitId): Promise<KitFulfilmentLine[]>`：清单是已确认或已关闭时，把这个项目所有已确认、已关闭清单的 `warehouse` 来源、计划数大于 0 的行按确认先后排好，用 `allocateShipped` 分；草稿和已提交的清单 `shipped = 0`、`pending = planned_qty`。其他来源和备忘行 `shipped = 0`、`pending = 0`。
- Produces（`kit.ts`）：`closeProjectKit(env, id, { version }, userid): Promise<void>`：只有已确认的能关；项目没结清时 409 "项目还有 2 台设备、3 种周转件在场，结清后才能关闭"。
- Produces（路由）：`GET /warehouse/kit/:id/fulfilment`、`POST /warehouse/kit/:id/close`（库管）、`GET /warehouse/project/:projectId/ledger`（全部角色）。

- [ ] **Step 1: 写失败的纯函数测试 `warehouse-kit-allocation.test.ts`**

```ts
it("同一物资两行：先分满第一行，余下给第二行", () => {
  const lines = [{ line_id: 1, key: "m:3", planned: 100 }, { line_id: 2, key: "m:3", planned: 50 }];
  expect([...allocateShipped(lines, new Map([["m:3", 120]]))]).toEqual([[1, 100], [2, 20]]);
});
it("发多了也不超过计划；没发的 key 分 0；负数当 0", () => {
  const lines = [{ line_id: 1, key: "m:3", planned: 10 }, { line_id: 2, key: "c:1", planned: 2 }, { line_id: 3, key: "m:4", planned: 5 }];
  expect([...allocateShipped(lines, new Map([["m:3", 15], ["m:4", -2]]))]).toEqual([[1, 10], [2, 0], [3, 0]]);
});
```

- [ ] **Step 2: 写失败的 SQL 测试 `warehouse-project-ledger.test.ts`**

用阶段 1 的 `createWhDoc`、`reverseWhDoc` 走真实单据：

```ts
it("主清单和追加清单都写了排泥钢管：计划相加，已发按确认先后分", async () => {
  // 清单 A（先确认）排泥钢管 100，清单 B（后确认）排泥钢管 50；发货 120
  // fulfilment(A) 该行 shipped 100 pending 0；fulfilment(B) 该行 shipped 20 pending 30
  // ledger 排泥钢管 planned 150 shipped 120 on_site 120
});
it("发货单冲销后，已发减少，待发恢复", async () => {});
it("没有清单直接发的货也算进已发", async () => {});
it("设备行：清单要 2 台顶管机，发了 1 台再转进来 1 台，已发 2；冲销转场后已发 1", async () => {});
it("返库退回 90、报损 10：returned 90、lost 10、on_site 0、报损金额 = 10 × 单价；没单价时为 null", async () => {});
it("消耗类：发出 20，退回 5：shipped 20、returned 5、on_site 为 null，不影响结清", async () => {});
it("转场：来源项目 transferred_out，目的项目 shipped；两边在场数对", async () => {});
it("结清：还有设备或周转件在场时 settled=false，关闭清单 409 并说明数量；全部返库后 settled=true，关闭成功", async () => {});
it("首次出库和最后退库日期不看冲销单", async () => {});
it("接口：所有角色能看项目物资和执行情况；关闭只有库管", async () => {});
```

- [ ] **Step 3: 运行，确认失败**

Run: `cd packages/api && npx vitest run test/warehouse-kit-allocation.test.ts test/warehouse-project-ledger.test.ts`
Expected: FAIL，模块不存在

- [ ] **Step 4: 实现 `kit-allocation.ts`、`project-ledger.ts`、`closeProjectKit` 和三个路由**

`project-ledger.ts` 的汇总用一条 `GROUP BY material_id` 的 SQL（`CASE WHEN doc_type = ... THEN ... END` 按上面的口径分列），不要逐单循环。

- [ ] **Step 5: 运行，确认通过**

Run: `npx vitest run test/warehouse-kit-allocation.test.ts test/warehouse-project-ledger.test.ts test/warehouse-kit.test.ts`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add packages/api/src/services/warehouse/kit-allocation.ts packages/api/src/services/warehouse/project-ledger.ts packages/api/src/services/warehouse/kit.ts packages/api/src/routes/wh-kit.ts packages/api/src/routes/wh-doc.ts packages/api/test/warehouse-kit-allocation.test.ts packages/api/test/warehouse-project-ledger.test.ts
git commit -m "feat: 清单执行情况、项目物资结清和关闭清单"
```

---

### Task 5: 按清单发货

**Files:**
- Modify: `packages/api/src/services/warehouse/doc-input.ts`（解析 `project_kit_id`）
- Modify: `packages/api/src/services/warehouse/doc-core.ts`（单头写 `project_kit_id`）
- Modify: `packages/api/src/services/warehouse/doc-move.ts`（发货时校验清单，批内断言）
- Modify: `packages/api/src/services/warehouse/doc-reverse.ts`（冲销单沿用原单的 `project_kit_id`）
- Modify: `packages/api/src/services/warehouse/doc-query.ts`（列表和详情带 `project_kit_id`、`kit_no`）
- Test: `packages/api/test/warehouse-doc-kit.test.ts`

**Interfaces:**
- Consumes: `ProjectKit`（Task 1）；`getKitFulfilment`（Task 4，只在测试里用来断言）。
- Produces：
  - `ParsedDoc.project_kit_id: number | null`；`DocHeader.project_kit_id: number | null`。
  - 只有 `out` 单能带 `project_kit_id`，其他类型带了 400 "只有发往项目的单能关联配套清单"。
  - 发货前普通查询给出具体错误：清单不存在 400；不属于这个项目 400 "配套清单不属于这个项目"；草稿或待确认 409 "配套清单还没确认"；已关闭 409 "配套清单已关闭"。
  - 批内断言：`SELECT 1 FROM project_kit WHERE id = ? AND project_id = ? AND status = 'confirmed'`。
  - `WhDocRow` 多 `project_kit_id: number | null`、`kit_no: string | null`。

- [ ] **Step 1: 写失败的测试**

```ts
it("带清单发货：单头记下清单，执行情况里已发增加", async () => {});
it.each([
  ["别的项目的清单", 400, "配套清单不属于这个项目"],
  ["草稿清单", 409, "配套清单还没确认"],
  ["已关闭的清单", 409, "配套清单已关闭"],
  ["返库单带清单", 400, "只有发往项目的单能关联配套清单"]
])("%s：拒绝，不生成单、数量不变", async () => {});
it("提交途中清单被关闭（批内断言）：整单回滚", async () => {
  // 用阶段 1 的做法包一层 env.DB.batch，在真正执行前把清单改成 closed
});
it("冲销按清单发的货：冲销单也带清单号，执行情况里已发恢复", async () => {});
it("单据列表和详情带清单号", async () => {});
```

- [ ] **Step 2: 运行，确认失败**

Run: `cd packages/api && npx vitest run test/warehouse-doc-kit.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现**

- [ ] **Step 4: 运行，确认通过，并跑阶段 1 的库房单测试确认没有改坏**

Run: `npx vitest run test/warehouse-doc-kit.test.ts test/warehouse-doc-inbound.test.ts test/warehouse-doc-move.test.ts test/warehouse-doc-reverse.test.ts test/warehouse-large-batches.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/api/src/services/warehouse/doc-input.ts packages/api/src/services/warehouse/doc-core.ts packages/api/src/services/warehouse/doc-move.ts packages/api/src/services/warehouse/doc-reverse.ts packages/api/src/services/warehouse/doc-query.ts packages/api/test/warehouse-doc-kit.test.ts
git commit -m "feat: 发货单关联配套清单"
```

---

### Task 6: 总览、企微机器人的设备汇总、权限矩阵

**Files:**
- Modify: `packages/api/src/services/warehouse/overview.ts`（加 `kits_to_confirm`）
- Modify: `packages/api/src/services/wecom-project-tools.ts`（`getEquipmentSummary` 加清单摘要，设计稿第 14 节）
- Modify: `packages/api/test/warehouse-overview.test.ts`、`packages/api/test/wecom-equipment-summary.test.ts`
- Modify: `packages/api/test/warehouse-permission-matrix.test.ts`

**Interfaces:**
- Produces: `WarehouseOverview.kits_to_confirm: number`（状态为 `submitted` 的清单数）。
- Produces: `get_equipment_summary` 的返回多一个 `kits: { kit_no; title; status_label; settled: boolean }[]`（这个项目没作废的清单；`status_label` 是中文，`settled` 取项目物资页的结清结果），原有字段不变。

- [ ] **Step 1: 写失败的测试**

- 总览：一份已提交、一份草稿、一份已确认 → `kits_to_confirm` 为 1。
- 企微机器人：项目有一份已确认的清单、一份作废的 → `kits` 只有一条，`status_label` 为"已确认"，`settled` 为 `true`（还没发货）。
- 权限矩阵加这些行（库管、经理、现场负责人自己的项目、现场负责人别人的项目、操作员、智能体令牌）：建模板、改模板、建清单、提交、确认、作废、关闭、带清单发货；读模板、清单、执行情况、项目物资。期望值照本计划 Global Constraints 的权限表。

- [ ] **Step 2: 运行，确认失败（`kits_to_confirm` 缺失；矩阵里新加的行若已通过，记一条 Ruling 说明它们作为回归网保留）**

Run: `cd packages/api && npx vitest run test/warehouse-overview.test.ts test/wecom-equipment-summary.test.ts test/warehouse-permission-matrix.test.ts`

- [ ] **Step 3: 实现，运行通过，提交**

```bash
git add packages/api/src/services/warehouse/overview.ts packages/api/src/services/wecom-project-tools.ts packages/api/test/warehouse-overview.test.ts packages/api/test/wecom-equipment-summary.test.ts packages/api/test/warehouse-permission-matrix.test.ts
git commit -m "feat: 总览和企微机器人显示配套清单，权限矩阵测试"
```

---

### Task 7: Web 接口封装、路由和页面辅助函数

**Files:**
- Create: `packages/web/src/api/wh/kit.ts`
- Modify: `packages/web/src/api/wh/types.ts`、`packages/web/src/api/wh/doc.ts`（`CreateWhDocInput.project_kit_id?`）
- Modify: `packages/web/src/router/modules/wh.ts`
- Create: `packages/web/src/views/wh/kit/kit-view.ts`（纯函数）
- Test: `packages/web/src/views/wh/kit/kit-view.test.ts`

**Interfaces:**
- Produces（`api/wh/kit.ts`）：`listKitTemplates`、`getKitTemplate`、`createKitTemplate`、`updateKitTemplate`、`listKits`、`getKit`、`createKit`、`updateKit`、`submitKit`、`confirmKit`、`discardKit`、`closeKit`、`getKitFulfilment`、`getProjectLedger`，参数和返回照 Task 2 到 Task 4 的接口。
- Produces（路由）：菜单"项目配套" `/wh/kit`（排在"总览"之后）；隐藏路由 `/wh/kit/:id`（清单详情）、`/wh/kit/project/:projectId`（项目物资）、`/wh/kit-template`（配套模板）。
- Produces（`kit-view.ts`）：
  - `KIT_STATUS_LABELS: Record<ProjectKitStatus, string>`：草稿、待确认、已确认、已关闭（作废的也是"已关闭"，详情里显示原因）。
  - `KIT_SOURCE_LABELS: Record<KitLineSource, string>`：库房发、现场采购、租赁、现场已有。
  - `KIT_LINE_KIND_LABELS`：设备、物资、备忘。
  - `kitActions(kit, viewer: { userid; caps; projectManagerUserid: string | null }): { canEdit; canSubmit; canConfirm; canDiscard; canClose; canShip }`
  - `kitLineProblems(lines): { index: number; message: string }[]`：和后端 `assertKitReady` 同样的规则，提交前在表单里标红。
  - `mapTemplateRows(table: string[][], categories: { id; name }[]): { rows: TemplateLineInput[]; errors: ImportRowError[] }`：粘贴的列名 `分节、类型、品名、规格、单位、默认数量、设备类别、备注`；类型认 `设备/按台`、`物资/周转/消耗`、`备忘`；设备类别按名字找，找不到报"第 3 行：设备类别不存在：泥浆泵，请先在库房设置里添加"；默认数量"若干""25米"这种报错。复用阶段 1 的 `shared/csv.ts` 的 `parseTable`。

- [ ] **Step 1: 写失败的测试 `kit-view.test.ts`**：`kitActions` 四种状态 × 库管、经理、现场负责人（自己的和别人的项目）、操作员；`kitLineProblems` 待选规格那一行；`mapTemplateRows` 一个完整的三行例子和三种错误。

- [ ] **Step 2: 运行，确认失败**

Run: `cd packages/web && npx vitest run src/views/wh/kit`

- [ ] **Step 3: 实现，运行通过，`npx vue-tsc --noEmit --skipLibCheck` 通过，提交**

```bash
git add packages/web/src/api/wh packages/web/src/router/modules/wh.ts packages/web/src/views/wh/kit/kit-view.ts packages/web/src/views/wh/kit/kit-view.test.ts
git commit -m "feat: Web 配套清单的接口封装、路由和页面辅助函数"
```

---

### Task 8: Web 配套模板页

**Files:**
- Create: `packages/web/src/views/wh/kit/template.vue`
- Create: `packages/web/src/views/wh/kit/components/KitLineTable.vue`（模板和清单共用的行编辑表格）
- Create: `packages/web/src/views/wh/kit/components/TemplateImportDialog.vue`

**Interfaces:**
- `KitLineTable.vue` props：`mode: "template" | "kit"`、`lines`（v-model）、`categories`、`readonly: boolean`、`fulfilment?: KitFulfilmentLine[]`；列：分节、类型、品名、规格（清单模式下物资行是同品名规格的下拉，来自 `spec_choices`；没选的标"待选规格"）、单位、数量、来源（清单模式）、备注；已确认的清单在只读模式下多"已发、待发、在库"三列。可加行、删行、按分节分组显示。

页面：模板列表（名称、机型、行数、状态）；点开编辑抬头和行，保存带 `version`；"粘贴导入"用 `mapTemplateRows`，有错误整批不进表格并逐行列出；停用。只有库管看到编辑按钮。

- [ ] **Step 1: 实现**
- [ ] **Step 2: 浏览器验证**（本地 api + web，库管账号）：新建"泥水平衡"模板；从 `mig/warehouse/泥水配套清单-工程对照.csv` 整理出的粘贴文本导入（类型列按草稿的"建议管法"填）；一行写了不存在的设备类别时报出行号且不导入；改好后导入成功、保存、刷新后行数和顺序不变；用两个标签页同时改，后保存的提示"数据已变化"。
- [ ] **Step 3: 提交**

```bash
git add packages/web/src/views/wh/kit
git commit -m "feat: Web 配套模板页"
```

---

### Task 9: Web 清单列表和清单详情

**Files:**
- Modify: `packages/web/src/views/wh/kit/index.vue`（新建，替换 Task 7 路由指向的占位）
- Create: `packages/web/src/views/wh/kit/detail.vue`
- Create: `packages/web/src/views/wh/kit/components/KitCreateDialog.vue`
- Modify: `packages/web/src/views/wh/overview/index.vue`（加"待确认清单"卡片，链到 `/wh/kit?status=submitted`）

页面：

- 列表：按状态页签（全部、草稿、待确认、已确认、已关闭）、项目筛选、关键字；列为清单号、项目、标题、模板、行数、状态、更新时间。`can_create_kit` 的人看到"新建清单"；库管看到"配套模板"按钮。
- 新建：选项目（现场负责人只列自己负责的项目）、标题，来源三选一：选模板 / 复制已有清单（可选任何项目的清单，列表显示项目名和标题）/ 空白。创建后进详情。
- 详情：抬头（清单号、项目、状态、创建人、提交人、确认人）；`KitLineTable`；按 `kitActions` 显示"保存""提交""确认""作废（写原因）""关闭"；已确认后显示执行情况和"按清单发货"（Task 10 接上）；"项目物资"链接。提交前用 `kitLineProblems` 把待选规格的行标红并滚动到第一行。所有写操作带 `version`，409 时提示"数据已变化，请刷新后重试"并重新加载。

- [ ] **Step 1: 实现**
- [ ] **Step 2: 浏览器验证**（库管 + 现场负责人两个账号，通讯录用页内补丁模拟；现场负责人账号用 `login/web` 的 `site_manager`，先在本地库把一个测试项目的 `manager_userid` 设成它）：
  1. 现场负责人从"泥水平衡"模板给自己的项目建清单；排泥钢管两行显示"待选规格"；直接提交被拦并定位到那一行；选好规格、改两处数量、把集装箱来源改成"租赁"，提交，状态"待确认"。
  2. 总览"待确认清单"显示 1，点进去是这份清单。
  3. 库管确认。现场负责人再打开，没有编辑按钮。
  4. 现场负责人给别人的项目建清单：项目下拉里没有那个项目。
  5. 复制这份清单给另一个项目：行和规格都带过来了。
- [ ] **Step 3: 提交**

```bash
git add packages/web/src/views/wh/kit packages/web/src/views/wh/overview/index.vue
git commit -m "feat: Web 项目配套清单列表和详情"
```

---

### Task 10: Web 按清单发货和项目物资页

**Files:**
- Modify: `packages/web/src/views/wh/doc/doc-form-model.ts`（加 `prefillOutFromKit`）
- Modify: `packages/web/src/views/wh/doc/doc-form-model.test.ts`
- Modify: `packages/web/src/views/wh/doc/components/DocFormDialog.vue`（可选 prop `kit`）
- Modify: `packages/web/src/views/wh/doc/components/DevicePicker.vue`（可选 prop `categoryId`）
- Modify: `packages/web/src/views/wh/doc/components/DocDetailDrawer.vue`（显示清单号）
- Modify: `packages/web/src/views/wh/kit/detail.vue`（"按清单发货"打开发货单）
- Create: `packages/web/src/views/wh/kit/project-ledger.vue`

**Interfaces:**
- `prefillOutFromKit(kit: { id; project_id }, fulfilment: KitFulfilmentLine[]): { form: DocFormState; deviceNeeds: { category_id; category_name; spec_text; count }[] }`：项目固定为清单的项目；只取 `source = warehouse`、`pending > 0` 的行；物资行数量默认 `pending`，`available` 是在库数（在库为 0 的行也列出，提交时表单拦"在库只有 0"）；设备行不预填具体设备，只给"需要几台什么"的提示；`project_kit_id` 进请求体。
- `DocFormDialog` 的新 prop：`kit?: { id: number; kit_no: string; project_id: number; fulfilment: KitFulfilmentLine[] }`。有它时标题是"按清单发货 PT-…"，项目不可改，设备区每个需求一行"机头土压 2400：还需 1 台"，旁边的设备选择器只列这个类别里可用的设备；清单外的东西仍然可以加。
- 项目物资页：抬头显示项目名和"已结清 / 未结清（2 台设备、3 种周转件在场）"；物资表列为编号、品名、规格、单位、管法、计划、已发、已转出、已退、报损、在场、首次出库、最后退库、报损金额，按分节分组，底部合计报损金额；设备类别表（计划、已发、在场）和在场设备列表；本项目的清单列表，已确认的清单在结清后显示"关闭"（库管）。"项目返库"按钮打开阶段 1 的返库单（在场清单自动带出）。

- [ ] **Step 1: 写失败的测试 `doc-form-model.test.ts`**：`prefillOutFromKit` 只取库房发、待发大于 0 的行；数量默认待发；设备需求按类别合并台数；请求体带 `project_kit_id`。
- [ ] **Step 2: 运行，确认失败；实现；运行通过**

Run: `cd packages/web && npx vitest run src/views/wh`

- [ ] **Step 3: 浏览器验证（这就是阶段 2 的完成标准，本地跑一遍）**：
  1. 上一任务确认的清单点"按清单发货"：物资行带出待发数，设备区提示"顶管机：还需 1 台"，选择器里只有可用的顶管机。少发一项、多加一样清单外的电焊条，提交。
  2. 清单执行情况：已发、待发正确；单据详情显示清单号。
  3. 建一份"追加"清单（同项目、再要 50 米排泥钢管），确认后再发 30：两份清单的已发按先后分摊。
  4. 项目物资页"未结清"。点"项目返库"：设备和周转件自动带出；排泥钢管退回一部分、报损一部分，提交。物资页报损数和报损金额正确（排泥钢管填了单价时有金额，没填的显示"-"）。
  5. 清单"关闭"按钮：还有东西在场时被拒绝并说明数量；把剩下的退回后，物资页显示"已结清"，两份清单都能关闭。
  6. 冲销一张发货单后，执行情况的已发恢复。
  控制台只有故意触发的 4xx。
- [ ] **Step 4: 提交**

```bash
git add packages/web/src/views/wh/doc packages/web/src/views/wh/kit
git commit -m "feat: Web 按清单发货和项目物资页"
```

---

### Task 11: 收尾和发布

**Files:**
- Modify: `doc/UI设计文档.md`（「J. 库房」加"项目配套"、清单详情、项目物资、配套模板；总览加待确认清单卡片）
- Modify: `doc/开发记录.md`（先补阶段 1 的上线记录：2026-11-11 迁移 0095、PR #24、`e5c35dcd`、Worker 版本 `e4344be9`；再写阶段 2）
- Modify: `docs/superpowers/specs/2026-11-11-warehouse-rebuild-design.md`（第 21 节加阶段 2 的实施记录和与设计不一致的地方）

- [ ] **Step 1: 全量校验**

```bash
cd packages/api && npm run typecheck && npm test && npm run lint && node scripts/check-migration-numbers.mjs
cd ../web && npm run typecheck && npm test && npm run build
cd ../mcp && npm test
```
Expected: 全部通过。

- [ ] **Step 2: 准备给李震的模板草稿（不进 git）**

把 `mig/warehouse/土压配套清单-工程对照.csv`、`泥水配套清单-工程对照.csv` 转成 Task 7 的粘贴格式（分节、类型、品名、规格、单位、默认数量、设备类别、备注），类型按 `物资档案草稿.csv` 的"建议管法"填（按台→设备、周转或消耗→物资、其余→备忘），存成 `mig/warehouse/模板草稿-土压.tsv`、`模板草稿-泥水.tsv`。这是草稿，李震核对前不导入生产。

- [ ] **Step 3: 更新文档，提交，推送，开 PR**

```bash
git add "doc/UI设计文档.md" "doc/开发记录.md" docs/superpowers/specs/2026-11-11-warehouse-rebuild-design.md
git commit -m "docs: 库房重做阶段 2 的记录和界面文档"
git push -u origin feat/warehouse-phase2-kits
```

PR 描述写清：新增迁移 0096（只加表）；合并前先跑迁移；本阶段没有通知和小程序页面。

- [ ] **Step 4: 发布（需要 owner 明确同意）**

1. `cd packages/api && npx wrangler d1 migrations list hybcdg-prod-db --remote --env prod`，确认待执行的只有 0096，然后 `apply`。
2. 合并 PR（合并即部署），`https://api.hybcdg.com/api/v1/system/health` 返回 `ok=true`。
3. 李震核对模板草稿后在 Web 上导入两套模板，用一个真实工程走完：出清单、发货、返库、报损、结清。
