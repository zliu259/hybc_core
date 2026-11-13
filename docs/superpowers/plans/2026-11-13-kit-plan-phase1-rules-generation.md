# 配套清单按项目参数生成 第一期：规则和生成 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新建配套清单时可以选「按项目参数生成」：确认机型、管径、长度、段数、套数等参数，系统按模板行上的规则算出主要设备和材料数量，生成一份带算式的草稿清单，库管照常调整和确认。这一期不含 AI。

**Architecture:** 规则存在模板行上（计算方式、系数、另加、每套一份、规格随管径、标记）。计算是一个不碰数据库的纯函数；生成器读模板、套参数、挑物资、列候选设备，给预览和创建共用。生成时的原样存进清单的 `plan_json`，读清单时按「分节、类型、品名、第几次出现」把算式配回每一行，所以清单行整份替换（包括小程序保存）不会丢算式。

**Tech Stack:** Hono + D1（`packages/api`）、Vue 3 + Element Plus（`packages/web`）、Vitest、`node:sqlite` 测试夹具（`createWarehouseHarness`）。

**Spec:** `docs/superpowers/specs/2026-11-13-kit-plan-from-project-params-design.md`（第 3 到 6 节、第 8 到 10 节、第 12 节的第一期、第 13 节的第 2 到 5 条和第 9 条）

**不在这一期：** AI 读参数（第二期）、AI 查漏（第三期）、设置里的开关、`project_kit_plan_extract` 和 `project_kit_review` 两张表。

## Global Constraints

- 迁移 `0101_kit_plan_rules.sql`：只加列和补数据，不动别的。跑 `node scripts/check-migration-numbers.mjs` 通过。生产上的迁移先于合并执行，需要 owner 同意。
- 计算方式只有四种：`fixed`、`per_total_metre`、`per_longest_metre`、`per_section`。标记只有三种：`main_machine`、`power`、`lodging`。
- 参数的范围：管径 300 到 5000 的整数；总长度和最长一段大于 0、不超过 20000，最长一段不超过总长度；段数和套数是 1 到 200 的整数，套数默认 1；「甲方提供」只能是 `power`、`lodging`。
- 数量向上取整。乘出来的数先四舍五入到小数点后 6 位再取整，避免 `0.1 × 30` 变成 4。
- 没配规则的行（固定、没勾每套一份、没标记、没勾规格随管径），按参数生成的结果必须和现在「选模板」逐行相同。
- 服务端自己算，不信页面传来的行。`plan` 必须和 `template_id` 一起出现。
- 清单行保存时整份替换这一点不改；`project_kit_line` 不加列。
- 不改小程序。`cd packages/miniapp && npm run test:wh` 必须照旧通过。
- 权限：取参数、预览、创建都要 `requireKitCreator`，而且过 `assertCanEditKitFor`（现场负责人只限自己负责的项目）。
- 单个路由、service、视图文件不超过 400 行。不用 `as any`、`@ts-ignore`。不改已有对象，返回新对象。
- 用到 `node:sqlite` 的测试包在 `describe.skipIf(!hasSqlite)` 里；纯函数的测试不包，让 CI（Node 20）也能跑到。
- 文档和界面文字用中文平实的话。提交信息格式 `<type>: <description>`，不加 AI 署名。
- 分支 `feat/kit-plan-phase1`，从 `origin/main` 切出，开 PR，不直接推 `main`。`KitCreateDialog.vue` 在分支 `fix/kit-create-project-order` 上也有改动（项目排序），谁后合并谁解决冲突。

## Review Focus

1. **同品名多次出现时算式配错行。** 模板里橡套电缆有 7 行、三通 3 行。保存、加行、删行、换顺序后，算式和「已改」要跟着原来那一行走。（任务 6）
2. **小数系数的取整。** `0.1 × 30` 应该是 3，`0.3 × 105` 应该是 32。（任务 3）
3. **缺参数和套数叠在一起。** 缺最长一段、套数 2、勾了每套一份：退回默认数量后仍然乘 2，算式说得清。（任务 3）
4. **模板没填管径。** 新建的模板 `diameter_mm` 是空的：勾了规格随管径的行一律按「管径不同」处理，不能悄悄沿用模板规格。（任务 5）
5. **越权看别的项目。** 现场负责人对不是自己负责的项目调取参数和预览，要 403，不能把项目的长度、管径露出去。（任务 4、5）

## File Structure

| 文件 | 负责什么 |
|---|---|
| `packages/api/migrations/0101_kit_plan_rules.sql` | 新列，给四个现有模板补管径和标记 |
| `packages/api/src/types/wh.ts` | 新字段的类型 |
| `packages/api/src/services/warehouse/kit-lines.ts` | 解析模板行上的规则字段 |
| `packages/api/src/services/warehouse/kit-template.ts` | 模板的管径和规则字段的读写 |
| `packages/api/src/services/warehouse/kit-plan-calc.ts`（新） | 参数校验、单行数量和算式。纯函数 |
| `packages/api/src/services/warehouse/kit-plan-source.ts`（新） | 从工作段和项目档案取参数 |
| `packages/api/src/services/warehouse/kit-plan-build.ts`（新） | 生成器：模板 + 参数 → 行、候选设备、提醒 |
| `packages/api/src/services/warehouse/kit-plan-match.ts`（新） | 把生成时的原样配回现在的行。纯函数 |
| `packages/api/src/services/warehouse/kit.ts`、`kit-query.ts` | 创建时收 `plan`；读清单时带出参数和算式 |
| `packages/api/src/routes/wh-kit.ts` | `GET /kit/plan/source`、`POST /kit/plan/preview` |
| `packages/web/src/api/wh/kit-types.ts`、`kit.ts` | 类型和请求 |
| `packages/web/src/views/wh/kit/kit-plan-view.ts`（新） | 页面用的纯函数：参数检查、选模板、规则的文字、标签 |
| `packages/web/src/views/wh/kit/template-paste.ts`（新） | 「粘贴模板行」的解析，从 `kit-view.ts` 挪过来并认新列 |
| `packages/web/src/views/wh/kit/components/TemplateRuleCell.vue`（新） | 模板行上的规则设置 |
| `packages/web/src/views/wh/kit/components/KitPlanForm.vue`、`KitPlanPreview.vue`（新） | 参数区和预览 |
| `packages/web/src/views/wh/kit/components/KitPlanSummary.vue`（新） | 清单详情顶部的参数 |
| `KitCreateDialog.vue`、`KitLineTable.vue`、`template.vue`、`detail.vue`、`TemplateImportDialog.vue` | 接上面的组件 |

---

### Task 1: 迁移 0101 和类型

**Files:**
- Create: `packages/api/migrations/0101_kit_plan_rules.sql`
- Modify: `packages/api/src/types/wh.ts`
- Test: `packages/api/test/warehouse-kit-plan-schema.test.ts`

**Interfaces:**
- Produces（列）：`kit_template.diameter_mm INTEGER`；`kit_template_line.qty_basis TEXT NOT NULL DEFAULT 'fixed'`、`qty_factor REAL`、`qty_extra REAL`、`qty_per_set INTEGER NOT NULL DEFAULT 0`、`spec_by_diameter INTEGER NOT NULL DEFAULT 0`、`role TEXT`；`project_kit.plan_json TEXT`。
- Produces（类型）：`KitQtyBasis = "fixed" | "per_total_metre" | "per_longest_metre" | "per_section"`；`KitLineRole = "main_machine" | "power" | "lodging"`；`KitTemplate.diameter_mm: number | null`；`KitTemplateLine` 多 `qty_basis`、`qty_factor: number | null`、`qty_extra: number | null`、`qty_per_set: 0 | 1`、`spec_by_diameter: 0 | 1`、`role: KitLineRole | null`；`ProjectKit.plan_json: string | null`。

- [ ] **Step 1: 写失败的测试**

```ts
describe.skipIf(!hasSqlite)("0101 配套模板的计算规则", () => {
  it("新列的默认值：固定、不勾、不标；管径和 plan_json 是空的", () => {
    const h = createWarehouseHarness();
    const templateId = h.seed.kitTemplate({ name: "甲" });
    const lineId = h.seed.kitTemplateLine(templateId, { name_text: "排泥钢管" });
    expect(h.database.prepare(
      "SELECT qty_basis, qty_factor, qty_extra, qty_per_set, spec_by_diameter, role FROM kit_template_line WHERE id = ?"
    ).get(lineId)).toEqual({ qty_basis: "fixed", qty_factor: null, qty_extra: null, qty_per_set: 0, spec_by_diameter: 0, role: null });
    expect(h.database.prepare("SELECT diameter_mm FROM kit_template WHERE id = ?").get(templateId)).toEqual({ diameter_mm: null });
  });

  it("不认的计算方式、标记和负数系数写不进去", () => {
    const h = createWarehouseHarness();
    const lineId = h.seed.kitTemplateLine(h.seed.kitTemplate({ name: "甲" }), { name_text: "x" });
    const set = (column, value) => h.database.prepare(`UPDATE kit_template_line SET ${column} = ? WHERE id = ?`).run(value, lineId);
    expect(() => set("qty_basis", "per_set")).toThrow(/CHECK/);
    expect(() => set("role", "boss")).toThrow(/CHECK/);
    expect(() => set("qty_factor", -1)).toThrow(/CHECK/);
    expect(() => set("qty_extra", -1)).toThrow(/CHECK/);
    expect(() => set("qty_per_set", 2)).toThrow(/CHECK/);
  });

  it("迁移给四个现有模板补管径，按名字给设备行和生活设施的行补标记，别的不动", () => {
    // 建「泥水平衡 DN1200」「泥水平衡 DN600」「土压平衡 DN2400」「土压平衡 DN1750 两套」「别的模板」，
    // 各有：类别叫 顶管机 的设备行、类别叫 发电机 的设备行、类别叫 油泵站 的设备行、分节 生活设施 的物资行、分节 工具 的物资行。
    // 只重跑迁移里的 UPDATE 语句（做法同 warehouse-device-code-prefix-schema.test.ts）。
    // 断言：四个模板的 diameter_mm 是 1200、600、2400、1750，「别的模板」是 null；
    //       顶管机行 role = main_machine，发电机行 = power，生活设施的行 = lodging，油泵站行和工具行 = null；
    //       「别的模板」里同名的行也被标上（标记按类别名和分节名认，不限模板）；已经有标记的行不被改。
  });
});
```

`h.seed.kitTemplate` 和 `h.seed.kitTemplateLine` 现在的夹具里叫什么照现有的用；没有就在 `test/helpers/warehouse-harness.ts` 里补上，写法同 `seed.category`。

- [ ] **Step 2: 跑测试，确认失败**

Run: `cd packages/api && npm test -- test/warehouse-kit-plan-schema.test.ts`
Expected: FAIL，`no such column: qty_basis`

- [ ] **Step 3: 写迁移和类型**

迁移里：七条 `ALTER TABLE ... ADD COLUMN`（`CHECK` 写在列定义上）；四条按模板名字补 `diameter_mm` 的 `UPDATE ... WHERE name = ? AND diameter_mm IS NULL`；三条补标记的 `UPDATE kit_template_line SET role = ? WHERE role IS NULL AND ...`（主机：`line_kind = 'device'` 且类别名是「顶管机」；发电：设备行且类别名是「发电机」；住宿：`section = '生活设施'`）。

- [ ] **Step 4: 跑测试和迁移编号检查**

Run: `cd packages/api && npm test -- test/warehouse-kit-plan-schema.test.ts && node scripts/check-migration-numbers.mjs`
Expected: PASS；编号检查没有新的重复

- [ ] **Step 5: 提交**

```bash
git add packages/api/migrations/0101_kit_plan_rules.sql packages/api/src/types/wh.ts packages/api/test
git commit -m "feat: 配套模板行加计算规则的列，清单加生成参数的列（迁移 0101）"
```

---

### Task 2: 模板接口读写规则字段

**Files:**
- Modify: `packages/api/src/services/warehouse/kit-lines.ts`、`kit-template.ts`
- Test: `packages/api/test/warehouse-kit-template.test.ts`

**Interfaces:**
- Consumes: 任务 1 的列和类型。
- Produces: `ParsedKitLine` 多一个 `rule: KitLineRule`，`interface KitLineRule { qty_basis: KitQtyBasis; qty_factor: number | null; qty_extra: number | null; qty_per_set: boolean; spec_by_diameter: boolean; role: KitLineRole | null }`。清单模式下 `rule` 恒为默认值。`createKitTemplate`、`updateKitTemplate` 认 `diameter_mm`；`getKitTemplate` 的行带出六个字段（`qty_per_set`、`spec_by_diameter` 转成布尔值再带出，库里存的是 0 和 1），模板带出 `diameter_mm`。

- [ ] **Step 1: 写失败的测试**（加在现有文件里，沿用它的 `call` 写法）

```ts
it("规则字段和管径：存进去读得回来；不传就是固定、不勾、不标", async () => {
  const made = await call("POST", "/warehouse/kit-template", {
    name: "泥水平衡 D1600", diameter_mm: 1600,
    lines: [
      { section: "顶进设备", line_kind: "device", device_category_id: categoryId, name_text: "机头泥水",
        default_qty: 1, qty_per_set: true, role: "main_machine" },
      { section: "辅助设备", line_kind: "material", name_text: "排泥钢管", unit: "米", default_qty: 120,
        qty_basis: "per_longest_metre", qty_factor: 2, qty_extra: 60, qty_per_set: true, spec_by_diameter: true },
      { section: "工具", line_kind: "material", name_text: "电焊机", default_qty: 1 }
    ]
  });
  const saved = (await call("GET", `/warehouse/kit-template/${made.body.data.id}`)).body.data;
  expect(saved.diameter_mm).toBe(1600);
  expect(saved.lines.map((l) => [l.qty_basis, l.qty_factor, l.qty_extra, l.qty_per_set, l.spec_by_diameter, l.role])).toEqual([
    ["fixed", null, null, true, false, "main_machine"],
    ["per_longest_metre", 2, 60, true, true, null],
    ["fixed", null, null, false, false, null]
  ]);
});

it.each([
  [{ qty_basis: "per_set" }, "第 1 行：计算方式不对"],
  [{ qty_factor: -1 }, "第 1 行：系数不能是负数"],
  [{ qty_extra: "多" }, "第 1 行：另加必须是数字"],
  [{ role: "boss" }, "第 1 行：标记不对"]
])("规则字段不对时 400：%j", async (patch, message) => {
  const result = await call("POST", "/warehouse/kit-template", {
    name: "x", lines: [{ section: "工具", line_kind: "material", name_text: "电焊机", ...patch }]
  });
  expect(result).toEqual({ status: 400, body: { success: false, error: { message } } });
});

it("管径不在 300 到 5000 之间时 400；传 null 是清掉", async () => { /* 100 → 400「管径必须是 300 到 5000 之间的整数」；null → 200 且读回 null */ });
```

- [ ] **Step 2: 跑测试，确认失败**

Run: `cd packages/api && npm test -- test/warehouse-kit-template.test.ts`
Expected: FAIL，新用例读回的字段是 `undefined`

- [ ] **Step 3: 实现**

`kit-lines.ts`：`parseLine` 在模板模式下读六个字段（布尔值认 `true`、`false`、`1`、`0`）。`kit-template.ts`：`insertLine` 多写六列；`createKitTemplate`、`updateKitTemplate` 读写 `diameter_mm`（`"diameter_mm" in input` 才动，和 `machine_type` 同样的写法）。

- [ ] **Step 4: 跑测试**

Run: `cd packages/api && npm test -- test/warehouse-kit-template.test.ts test/warehouse-kit.test.ts`
Expected: PASS（原有用例一条不改）

- [ ] **Step 5: 提交**

```bash
git add packages/api/src/services/warehouse/kit-lines.ts packages/api/src/services/warehouse/kit-template.ts packages/api/test/warehouse-kit-template.test.ts
git commit -m "feat: 配套模板接口读写计算规则和管径"
```

---

### Task 3: 单行数量和算式（纯函数）

**Files:**
- Create: `packages/api/src/services/warehouse/kit-plan-calc.ts`
- Test: `packages/api/test/warehouse-kit-plan-calc.test.ts`（不包 `skipIf`）

**Interfaces:**
- Consumes: `KitLineRule`（任务 2）。
- Produces:
  - `interface PlanParams { machine_type: string | null; pipe_diameter_mm: number | null; total_length_m: number | null; longest_drive_m: number | null; section_count: number | null; set_count: number; soil: string | null; client_supplies: ("power" | "lodging")[] }`
  - `parsePlanParams(input: unknown): PlanParams`（不合格抛 `badRequest`，文字见下面的测试）
  - `calcLineQty(rule: KitLineRule, defaultQty: number | null, params: PlanParams): { qty: number; calc_text: string | null; missing: "total_length" | "longest_drive" | "section_count" | "factor" | null }`
  - `hasAnyRule(rules: readonly KitLineRule[]): boolean`（有一行不是固定或勾了每套一份就算有）

- [ ] **Step 1: 写失败的测试**

```ts
const rule = (patch = {}) => ({ qty_basis: "fixed", qty_factor: null, qty_extra: null, qty_per_set: false, spec_by_diameter: false, role: null, ...patch });
const params = (patch = {}) => ({ machine_type: "泥水平衡", pipe_diameter_mm: 1600, total_length_m: 105, longest_drive_m: 105,
  section_count: 1, set_count: 1, soil: null, client_supplies: [], ...patch });

describe("calcLineQty", () => {
  it.each([
    // 规则, 默认数量, 参数, 数量, 算式
    [rule(), 4, params(), 4, null],
    [rule(), null, params(), 0, null],
    [rule({ qty_per_set: true }), 1, params(), 1, null],
    [rule({ qty_per_set: true }), 1, params({ set_count: 2 }), 2, "每套一份：1 × 2 = 2"],
    [rule({ qty_basis: "per_longest_metre", qty_factor: 2, qty_extra: 60 }), 120, params(), 270, "按最长一段：2 × 105 + 60 = 270"],
    [rule({ qty_basis: "per_longest_metre", qty_factor: 2, qty_extra: 60, qty_per_set: true }), 120, params({ set_count: 2 }), 540,
      "按最长一段：2 × 105 + 60 = 270；每套一份 × 2 = 540"],
    [rule({ qty_basis: "per_total_metre", qty_factor: 0.3 }), 10, params(), 32, "按总长：0.3 × 105 = 31.5，取整 32"],
    [rule({ qty_basis: "per_total_metre", qty_factor: 0.3, qty_extra: 5 }), 10, params(), 37, "按总长：0.3 × 105 = 31.5，取整 32，另加 5，共 37"],
    [rule({ qty_basis: "per_total_metre", qty_factor: 0.1 }), 10, params({ total_length_m: 30 }), 3, "按总长：0.1 × 30 = 3"],
    [rule({ qty_basis: "per_section", qty_factor: 2 }), 1, params({ section_count: 22 }), 44, "按段：2 × 22 = 44"]
  ])("%j 默认 %s → %s", (r, defaultQty, p, qty, text) => {
    expect(calcLineQty(r, defaultQty, p)).toMatchObject({ qty, calc_text: text, missing: null });
  });

  it("缺参数时退回默认数量，说明缺什么；勾了每套一份仍然乘套数", () => {
    const r = rule({ qty_basis: "per_longest_metre", qty_factor: 2, qty_per_set: true });
    expect(calcLineQty(r, 120, params({ longest_drive_m: null }))).toEqual(
      { qty: 120, calc_text: "缺最长一段，用模板默认数量", missing: "longest_drive" });
    expect(calcLineQty(r, 120, params({ longest_drive_m: null, set_count: 2 }))).toEqual(
      { qty: 240, calc_text: "缺最长一段，用模板默认数量；每套一份 × 2 = 240", missing: "longest_drive" });
    expect(calcLineQty(rule({ qty_basis: "per_total_metre", qty_factor: 1 }), null, params({ total_length_m: null }))).toMatchObject(
      { qty: 0, calc_text: "缺总长度，用模板默认数量", missing: "total_length" });
    expect(calcLineQty(rule({ qty_basis: "per_section", qty_factor: 1 }), 3, params({ section_count: null }))).toMatchObject(
      { qty: 3, calc_text: "缺段数，用模板默认数量", missing: "section_count" });
  });

  it("没填系数时退回默认数量", () => {
    expect(calcLineQty(rule({ qty_basis: "per_section" }), 3, params())).toEqual(
      { qty: 3, calc_text: "没填系数，用模板默认数量", missing: "factor" });
  });
});

describe("parsePlanParams", () => {
  it("什么都不填也行：都是空的，套数 1", () => {
    expect(parsePlanParams({})).toEqual({ machine_type: null, pipe_diameter_mm: null, total_length_m: null, longest_drive_m: null,
      section_count: null, set_count: 1, soil: null, client_supplies: [] });
  });
  it.each([
    [{ pipe_diameter_mm: 299 }, "管径必须是 300 到 5000 之间的整数"],
    [{ pipe_diameter_mm: 1600.5 }, "管径必须是 300 到 5000 之间的整数"],
    [{ total_length_m: 0 }, "总长度必须大于 0，不超过 20000"],
    [{ longest_drive_m: 20001 }, "最长一段必须大于 0，不超过 20000"],
    [{ total_length_m: 100, longest_drive_m: 101 }, "最长一段不能超过总长度"],
    [{ section_count: 0 }, "段数必须是 1 到 200 的整数"],
    [{ set_count: 201 }, "套数必须是 1 到 200 的整数"],
    [{ client_supplies: ["crane"] }, "甲方提供只能是发电、住宿"]
  ])("%j → %s", (input, message) => {
    expect(() => parsePlanParams(input)).toThrow(message);
  });
  it("机型最长 20 字，土质最长 100 字；重复的甲方提供去重", () => { /* 超长 → 400；["power","power"] → ["power"] */ });
});
```

- [ ] **Step 2: 跑测试，确认失败**

Run: `cd packages/api && npm test -- test/warehouse-kit-plan-calc.test.ts`
Expected: FAIL，找不到 `kit-plan-calc`

- [ ] **Step 3: 实现 `kit-plan-calc.ts`**

数字的写法：整数不带小数点，小数最多留 3 位、去掉末尾的 0。乘出来的数先 `Math.round(x * 1e6) / 1e6` 再 `Math.ceil`。

- [ ] **Step 4: 跑测试**

Run: `cd packages/api && npm test -- test/warehouse-kit-plan-calc.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/api/src/services/warehouse/kit-plan-calc.ts packages/api/test/warehouse-kit-plan-calc.test.ts
git commit -m "feat: 配套清单按参数算数量和算式的纯函数"
```

---

### Task 4: 从工作段和项目档案取参数

**Files:**
- Create: `packages/api/src/services/warehouse/kit-plan-source.ts`
- Modify: `packages/api/src/routes/wh-kit.ts`、`packages/api/src/services/warehouse/kit.ts`（只是把 `assertCanEditKitFor` 的导出用起来，它已经导出）
- Test: `packages/api/test/warehouse-kit-plan-source.test.ts`

**Interfaces:**
- Consumes: `PlanParams`（任务 3）、`assertCanEditKitFor(env, auth, caps, projectId)`（现有）。
- Produces:
  - `type PlanParamKey = "machine_type" | "pipe_diameter_mm" | "total_length_m" | "longest_drive_m" | "section_count" | "soil"`
  - `interface PlanSource { params: Partial<Pick<PlanParams, PlanParamKey>>; sources: Partial<Record<PlanParamKey, { from: "section" | "project" }>>; has_text: boolean }`
  - `loadPlanSource(env: Env, projectId: number): Promise<PlanSource>`（项目不存在抛 404「项目不存在」）
  - `GET /api/v1/warehouse/kit/plan/source?project_id=` → `{ success: true, data: PlanSource }`

- [ ] **Step 1: 写失败的测试**

```ts
describe.skipIf(!hasSqlite)("按项目参数生成：取参数", () => {
  it("有工作段时从工作段取：段数、总长、最长一段、管径、土质、机型", async () => {
    // 项目档案：machine_type 土压平衡、pipe_spec D2000、geotech_soil 细砂（应该被工作段盖过）
    // 三个工作段：长度 80、105、null；管径都是 1600；soil_type 粉质粘土、粉质粘土、粘土；assigned_machine_type 都是 泥水平衡
    expect(await loadPlanSource(h.env, projectId)).toEqual({
      params: { section_count: 3, total_length_m: 185, longest_drive_m: 105, pipe_diameter_mm: 1600, soil: "粉质粘土、粘土", machine_type: "泥水平衡" },
      sources: { section_count: { from: "section" }, total_length_m: { from: "section" }, longest_drive_m: { from: "section" },
        pipe_diameter_mm: { from: "section" }, soil: { from: "section" }, machine_type: { from: "section" } },
      has_text: false
    });
  });

  it("工作段的管径或机型不一致时不取这一项，改从项目档案取", async () => {
    // 两个工作段管径 1600 和 1200、机型一个空一个 泥水平衡；项目档案 pipe_spec「D1600」、machine_type「泥水平衡」
    // → pipe_diameter_mm 1600 来自 project，machine_type 泥水平衡 来自 section（非空的只有一种）
  });

  it("没有工作段时从项目档案取；pipe_spec 取里面第一段 3 到 4 位的数字", async () => {
    // pipe_spec「DN800」→ 800；「D1550*2」→ 1550；「钢管」→ 不取；geotech_soil「粘土,粉土」→ soil
    // 没有段数和长度；project_briefing 有字 → has_text true
  });

  it("接口：现场负责人只能取自己负责的项目，别的项目 403", async () => {
    // GET /warehouse/kit/plan/source?project_id=<别人的> → 403「只能给自己负责的项目建清单」
    // 操作员（没有建清单的权限）→ 403；project_id 不是数字 → 400；项目不存在 → 404
  });
});
```

- [ ] **Step 2: 跑测试，确认失败**

Run: `cd packages/api && npm test -- test/warehouse-kit-plan-source.test.ts`
Expected: FAIL，找不到 `kit-plan-source`

- [ ] **Step 3: 实现**

工作段：`SELECT section_length, pipe_diameter_mm, soil_type, assigned_machine_type, jacking_method FROM project_section WHERE project_id = ?`。机型先看 `assigned_machine_type`，都空再看 `jacking_method`；非空的值只有一种才取。土质把非空的不同值用顿号连起来，超过 100 字截断。管径四舍五入成整数，不在 300 到 5000 之间的不取。`has_text`：`project_briefing` 或 `legacy_note` 有非空白的字。路由挂在 `/kit/:id` 之前。

- [ ] **Step 4: 跑测试**

Run: `cd packages/api && npm test -- test/warehouse-kit-plan-source.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/api/src/services/warehouse/kit-plan-source.ts packages/api/src/routes/wh-kit.ts packages/api/test/warehouse-kit-plan-source.test.ts
git commit -m "feat: 新建清单时从工作段和项目档案取参数"
```

---

### Task 5: 生成器和预览接口

**Files:**
- Create: `packages/api/src/services/warehouse/kit-plan-build.ts`
- Modify: `packages/api/src/routes/wh-kit.ts`
- Test: `packages/api/test/warehouse-kit-plan-build.test.ts`

**Interfaces:**
- Consumes: `calcLineQty`、`hasAnyRule`、`parsePlanParams`（任务 3）；`pickMaterial`、`linesFromTemplate`（`kit-build.ts`，现有）；`loadSpecChoices`（`kit-query.ts`，现有）。
- Produces:
  - `interface PlannedLine extends ParsedKitLine { calc_text: string | null; needs_spec: boolean; material_label: string | null }`
  - `interface PlanDevice { name_text: string; qty: number; candidates: { device_code: string; name: string; diameter_mm: number | null }[] }`
  - `interface PlanResult { template: { id: number; version: number; name: string; diameter_mm: number | null }; lines: PlannedLine[]; devices: PlanDevice[]; warnings: string[] }`
  - `buildPlan(env: Env, templateId: number, params: PlanParams): Promise<PlanResult>`（模板不存在 400「模板不存在」，停用 400「模板已停用」）
  - `POST /api/v1/warehouse/kit/plan/preview`，请求体 `{ project_id, template_id, params }`，返回 `{ success: true, data: PlanResult }`。不写库。

- [ ] **Step 1: 写失败的测试**

夹具（`beforeEach`）：类别 顶管机、油泵站、发电机；设备 `DG-012`「唐兴1600」（顶管机、泥水平衡、1600、在库）、`DG-007`「伟诚1200」（顶管机、泥水平衡、1200、在库）、`DG-020`「土压1600」（顶管机、土压平衡、1600、在库）、`DG-030`「在外1600」（顶管机、泥水平衡、1600、在项目上）；物资 `护口铁 DN1200`、`护口铁 D1600`、`排泥钢管 Φ114`、`止水圈 1200*1900`、`止水圈 DN600*1400`、`电焊机 400A`、`上下床`；模板「泥水平衡 DN1200」（`diameter_mm` 1200），行依次是：

| 分节 | 类型 | 品名 | 规格 | 默认 | 规则 |
|---|---|---|---|---|---|
| 顶进设备 | 设备（顶管机） | 机头泥水 | DN1200 | 1 | 每套一份，标记主机 |
| 顶进设备 | 设备（油泵站） | 油泵站 | 唐兴6组 | 1 | 每套一份 |
| 顶进设备 | 物资 | 护口铁 | DN1200 | 1 | 规格随管径 |
| 顶进设备 | 物资 | 止水圈 | 1200*1900 | 1 | 规格随管径，按段 系数 1 |
| 辅助设备 | 设备（发电机） | 发电机 | 150KW | 空 | 标记发电 |
| 辅助设备 | 物资 | 排泥钢管 | Φ114 | 120 | 按最长一段 系数 2 另加 60，每套一份 |
| 工具 | 物资 | 电焊机 | 400A | 1 | （没配） |
| 生活设施 | 物资 | 上下床 | 空 | 3 | 标记住宿 |

```ts
it("阳坊的例子：D1600、泥水平衡、105 米、1 段、甲方提供发电和住宿", async () => {
  const plan = await buildPlan(h.env, templateId, parsePlanParams({ machine_type: "泥水平衡", pipe_diameter_mm: 1600,
    total_length_m: 105, longest_drive_m: 105, section_count: 1, client_supplies: ["power", "lodging"] }));
  const row = (name) => plan.lines.find((l) => l.name_text === name);
  expect(row("机头泥水")).toMatchObject({ qty: 1, spec_text: "D1600",
    note: "生成时在库：DG-012 唐兴1600（1600）、DG-007 伟诚1200（1200）；模板规格：DN1200" });
  expect(plan.devices[0]).toMatchObject({ name_text: "机头泥水", qty: 1,
    candidates: [{ device_code: "DG-012" }, { device_code: "DG-007" }] });       // 土压的和在项目上的不列
  expect(row("护口铁")).toMatchObject({ material_id: huKou1600, spec_text: "D1600", needs_spec: false });
  expect(row("止水圈")).toMatchObject({ material_id: null, spec_text: null, needs_spec: true, qty: 1, note: "模板规格：1200*1900" });
  expect(row("发电机")).toMatchObject({ source: "on_site", qty: 0 });
  expect(row("上下床")).toMatchObject({ source: "on_site", qty: 3 });
  expect(row("排泥钢管")).toMatchObject({ qty: 270, calc_text: "按最长一段：2 × 105 + 60 = 270", material_id: paiNi114 });
  expect(row("电焊机")).toMatchObject({ qty: 1, calc_text: null, source: "warehouse" });
  expect(plan.warnings).toEqual(["模板是 DN1200，本项目 D1600", "1 行要重新选规格"]);
});

it("套数 2：勾了每套一份的翻倍，没勾的不变", async () => { /* 机头 2、油泵站 2、排泥钢管 540、止水圈 1、电焊机 1 */ });

it("缺最长一段：用到它的行退回默认数量，提醒里写明几行", async () => {
  /* 排泥钢管 120；warnings 含「缺最长一段，1 行用了模板默认数量」 */ });

it("管径和模板相同：规格随管径的行照模板找物资，没有管径不同的提醒", async () => { /* D1200 → 护口铁 DN1200、止水圈 1200*1900 */ });

it("不填管径：机头规格不改，规格随管径的行照模板找物资", async () => {});

it("模板没填管径：规格随管径的行一律按不同处理", async () => {
  /* 把模板 diameter_mm 置空，参数 D1200 → 护口铁（档案里含 1200 的只有一条）选上，止水圈（含 1200 的只有 1200*1900）选上；
     参数 D1600 → 止水圈待选。提醒不出现「模板是 DN…」这一句 */ });

it("一条规则都没配的模板：结果和 linesFromTemplate 逐行相同，并提醒", async () => {
  /* 另建一个模板，行同上但都不配规则；expect(strip(plan.lines)).toEqual(await linesFromTemplate(h.env, id))；
     warnings 是 ["这个模板还没配计算规则，数量都是模板默认数量"] */ });

it("停用的物资不会被选上；停用的模板 400", async () => {});

it("候选设备写进备注时不超过 200 字，模板原来的备注接在后面", async () => {});

it("预览接口：不写库；现场负责人对别人的项目 403；参数不对 400", async () => {
  /* 调用前后 project_kit 的行数相同；{ pipe_diameter_mm: 99999 } → 400「管径必须是 300 到 5000 之间的整数」 */ });
```

- [ ] **Step 2: 跑测试，确认失败**

Run: `cd packages/api && npm test -- test/warehouse-kit-plan-build.test.ts`
Expected: FAIL，找不到 `kit-plan-build`

- [ ] **Step 3: 实现 `buildPlan`**

每一行按这个顺序处理：

1. 数量和算式：`calcLineQty`。备忘行不算，数量 0。
2. 标了主机而且有管径：`spec_text = "D" + 管径`；模板原来的规格和它不同时，备注末尾加「模板规格：…」。候选：`SELECT device_code, name, diameter_mm FROM device WHERE category_id = ? AND location = 'warehouse'`，有机型就加 `AND machine_type = ?`；有管径按 `ABS(COALESCE(diameter_mm, 999999) - ?)` 排，否则按 `diameter_mm`；再按 `device_code`；最多 5 台。备注是「生成时在库：编号 名称（口径）、…」，一台都没有时是「生成时库里没有同机型的在库设备」，后面用分号接模板原来的备注，整段不超过 200 字（放不下就少列几台）。
3. 标了发电而且甲方提供发电、或标了住宿而且甲方提供住宿：`source = "on_site"`。
4. 物资行找物资。勾了规格随管径、有项目管径、而且模板管径是空的或和项目不同：在同品名的在用物资里找规格匹配 `(^|[^0-9])<管径>([^0-9]|$)` 的，正好一条就选它并把 `spec_text` 换成它的规格；否则 `material_id = null`、`spec_text = null`、`needs_spec = true`，模板原来有规格时备注开头加「模板规格：…」。其余情况用现有的 `pickMaterial`。

提醒按这个顺序、这些字：`模板是 DN<模板管径>，本项目 D<项目管径>`（两个管径都有而且不同时）；`<n> 行要重新选规格`；`缺总长度，<n> 行用了模板默认数量`、`缺最长一段，…`、`缺段数，…`；`<n> 行没填系数，用了模板默认数量`；`这个模板还没配计算规则，数量都是模板默认数量`。

`devices` 只列设备行。文件超过 400 行就把候选设备那一段拆到 `kit-plan-devices.ts`。

- [ ] **Step 4: 跑测试**

Run: `cd packages/api && npm test -- test/warehouse-kit-plan-build.test.ts test/warehouse-kit.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/api/src/services/warehouse/kit-plan-build.ts packages/api/src/routes/wh-kit.ts packages/api/test/warehouse-kit-plan-build.test.ts
git commit -m "feat: 配套清单按项目参数生成的生成器和预览接口"
```

---

### Task 6: 创建时存下生成的原样，读清单时把算式配回去

**Files:**
- Create: `packages/api/src/services/warehouse/kit-plan-match.ts`
- Modify: `packages/api/src/services/warehouse/kit.ts`、`kit-query.ts`
- Test: `packages/api/test/warehouse-kit-plan-match.test.ts`（纯函数，不包 `skipIf`）、`packages/api/test/warehouse-kit-plan-create.test.ts`

**Interfaces:**
- Consumes: `buildPlan`、`PlanResult`（任务 5）、`parsePlanParams`（任务 3）。
- Produces:
  - `interface PlanSnapshotLine { section: string; line_kind: KitLineKind; name_text: string; spec_text: string | null; qty: number; calc_text: string | null }`
  - `interface KitPlanRecord { v: 1; params: PlanParams; sources: Record<string, { from: "section" | "project" | "ai" | "manual"; quote?: string }>; template: PlanResult["template"]; generated: PlanSnapshotLine[] }`
  - `matchGenerated<T extends { section: string; line_kind: KitLineKind; name_text: string }>(lines: readonly T[], generated: readonly PlanSnapshotLine[]): (T & { calc_text: string | null; generated_qty: number | null })[]`
  - `createProjectKit` 认 `plan: { params, sources? }`；`getProjectKit` 的返回多 `plan: Omit<KitPlanRecord, "generated"> | null`，每行多 `calc_text`、`generated_qty`。

- [ ] **Step 1: 写失败的测试**

```ts
// warehouse-kit-plan-match.test.ts
const gen = (name, qty, calc = null, section = "控制照明系统") => ({ section, line_kind: "material", name_text: name, spec_text: null, qty, calc_text: calc });
const cur = (name, section = "控制照明系统") => ({ section, line_kind: "material", name_text: name });

it("同品名出现多次，按第几次出现配对", () => {
  const generated = [gen("橡套电缆", 20, "a"), gen("橡套电缆", 100, "b"), gen("控制线", 200, "c")];
  expect(matchGenerated([cur("橡套电缆"), cur("橡套电缆"), cur("控制线")], generated).map((l) => [l.generated_qty, l.calc_text]))
    .toEqual([[20, "a"], [100, "b"], [200, "c"]]);
});
it("中间加了一行别的品名、删了一行、两行不同品名换了位置：其余行不串", () => {
  const generated = [gen("橡套电缆", 20, "a"), gen("控制线", 200, "c"), gen("视频线", 400, "d")];
  expect(matchGenerated([cur("视频线"), cur("新加的"), cur("橡套电缆")], generated).map((l) => l.generated_qty)).toEqual([400, null, 20]);
});
it("品名相同但分节或类型不同，不配对", () => {
  expect(matchGenerated([cur("三通", "注浆设备")], [gen("三通", 4, null, "辅助设备")])[0].generated_qty).toBeNull();
});
it("同品名现在比生成时多一行，多出来的那行配不上", () => {
  expect(matchGenerated([cur("三通"), cur("三通")], [gen("三通", 4)]).map((l) => l.generated_qty)).toEqual([4, null]);
});
it("不改传进来的数组和对象", () => {});
```

```ts
// warehouse-kit-plan-create.test.ts（describe.skipIf(!hasSqlite)，夹具同任务 5）
it("带 plan 创建：行是服务端算的，plan_json 存了参数、来源、模板版本和生成时的原样", async () => {
  const { id } = await createProjectKit(h.env, { project_id: projectId, title: "阳坊", template_id: templateId,
    plan: { params: { machine_type: "泥水平衡", pipe_diameter_mm: 1600, total_length_m: 105, longest_drive_m: 105, section_count: 1 },
      sources: { pipe_diameter_mm: { from: "manual" } } },
    lines: [{ section: "x", line_kind: "material", name_text: "页面塞进来的行", planned_qty: 999 }] }, auth, caps);
  const kit = await getProjectKit(h.env, id);
  expect(kit.lines.some((l) => l.name_text === "页面塞进来的行")).toBe(false);
  expect(kit.plan).toMatchObject({ v: 1, params: { pipe_diameter_mm: 1600, set_count: 1 }, template: { id: templateId, diameter_mm: 1200 } });
  expect(kit.plan.generated).toBeUndefined();
  const pipe = kit.lines.find((l) => l.name_text === "排泥钢管");
  expect(pipe).toMatchObject({ planned_qty: 270, generated_qty: 270, calc_text: "按最长一段：2 × 105 + 60 = 270" });
});

it("库管改数量后保存（请求里不带任何新字段，小程序就是这样）：算式还在，generated_qty 不变", async () => {
  // 取回行，把排泥钢管改成 300，只带现有的十个字段调 updateProjectKit；再读：planned_qty 300、generated_qty 270、算式还在
});

it("plan 没有 template_id、或者同时给了 copy_from_kit_id → 400「按项目参数生成要选模板」", async () => {});
it("来源只认 section、project、ai、manual；原文片段最长 100 字", async () => {});
it("不带 plan 的三条路（选模板、复制、空白）：plan 是 null，每行 calc_text 和 generated_qty 是 null", async () => {});
it("plan_json 坏了（不是 JSON）时读清单不报错，当作没有", async () => {});
```

- [ ] **Step 2: 跑测试，确认失败**

Run: `cd packages/api && npm test -- test/warehouse-kit-plan-match.test.ts test/warehouse-kit-plan-create.test.ts`
Expected: FAIL，找不到 `kit-plan-match`

- [ ] **Step 3: 实现**

`matchGenerated`：键是 `分节 + "\u0000" + 类型 + "\u0000" + 品名`，同一个键下按出现的先后一一对应。`createProjectKit`：有 `plan` 时校验后调 `buildPlan`，行用它的结果，`INSERT INTO project_kit` 多写 `plan_json`。`getProjectKit`：解析 `plan_json`，行过一遍 `matchGenerated`，头上带出不含 `generated` 的 `plan`。`kit.ts` 现在 326 行，加完如果超过 400，把创建那一段拆到 `kit-create.ts`。

- [ ] **Step 4: 跑测试**

Run: `cd packages/api && npm test -- test/warehouse-kit-plan-match.test.ts test/warehouse-kit-plan-create.test.ts test/warehouse-kit.test.ts test/warehouse-kit-allocation.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/api/src/services/warehouse packages/api/test
git commit -m "feat: 按参数生成的清单存下生成时的原样，读的时候把算式配回每一行"
```

---

### Task 7: Web 的类型、请求和纯函数

**Files:**
- Create: `packages/web/src/views/wh/kit/kit-plan-view.ts`、`kit-plan-view.test.ts`、`template-paste.ts`、`template-paste.test.ts`
- Modify: `packages/web/src/api/wh/kit-types.ts`、`packages/web/src/api/wh/kit.ts`、`packages/web/src/views/wh/kit/kit-view.ts`、`kit-view.test.ts`、`components/TemplateImportDialog.vue`

**Interfaces:**
- Consumes: 任务 2、4、5、6 的接口形状。
- Produces（`kit-types.ts`）：`KitQtyBasis`、`KitLineRole`、`KitLineRule`（布尔字段用 `boolean`）、`TemplateLineInput` 多六个规则字段、`KitTemplateRow.diameter_mm`、`KitPlanParams`、`KitPlanSources`（`Partial<Record<keyof KitPlanParams, { from: "section" | "project" | "ai" | "manual"; quote?: string }>>`）、`KitPlanSource`、`KitPlanPreview`、`ProjectKitLine` 多 `calc_text` 和 `generated_qty`、`ProjectKitDetail.plan`。
- Produces（`kit.ts`）：`getKitPlanSource(projectId: number)`、`previewKitPlan(data: { project_id: number; template_id: number; params: KitPlanParams })`；`createKit` 的参数多 `plan?: { params: KitPlanParams; sources: KitPlanSources }`；`createKitTemplate`、`updateKitTemplate` 的参数多 `diameter_mm?: number | null`。
- Produces（`kit-plan-view.ts`）：
  - `emptyPlanParams(): KitPlanParams`
  - `planParamProblems(params: KitPlanParams): string[]`（文字和服务端相同）
  - `pickTemplateFor(templates: readonly KitTemplateRow[], machineType: string | null, diameter: number | null): number | null`
  - `ruleSummary(rule: KitLineRule): string`
  - `lineChanged(line: { planned_qty: number; generated_qty: number | null }): boolean`
  - `BASIS_LABELS`、`ROLE_LABELS`、`SOURCE_FROM_LABELS`
- Produces（`template-paste.ts`）：`mapTemplateRows`（从 `kit-view.ts` 原样挪过来，再认新列）。`EditableKitLine` 多一个 `rule: KitLineRule`，`newEditableLine`、`editableFromTemplate`、`toTemplateLines` 带着它走。

- [ ] **Step 1: 写失败的测试**

```ts
// kit-plan-view.test.ts
const tpl = (id, machine_type, diameter_mm, status = "active") => ({ id, machine_type, diameter_mm, status });
describe("pickTemplateFor", () => {
  const list = [tpl(1, "泥水平衡", 1200), tpl(2, "泥水平衡", 600), tpl(3, "土压平衡", 2400), tpl(4, "土压平衡", 1750), tpl(5, "泥水平衡", null)];
  it.each([
    ["泥水平衡", 1600, 1],   // 最接近的
    ["泥水平衡", 800, 2],
    ["泥水平衡", 900, 1],    // 一样近时取大的
    ["土压平衡", 2000, 4],
    ["泥水平衡", null, 1],   // 没有管径：同机型里排最前的
    ["砾石破碎", 1600, null],
    [null, 1600, null]
  ])("%s %s → %s", (machine, diameter, id) => expect(pickTemplateFor(list, machine, diameter)).toBe(id));
  it("同机型的模板都没填管径时取第一个；停用的不选", () => {});
});

describe("ruleSummary", () => {
  it.each([
    [{}, ""],
    [{ qty_per_set: true }, "每套一份"],
    [{ qty_basis: "per_longest_metre", qty_factor: 2, qty_extra: 60, qty_per_set: true }, "按最长一段 ×2 +60 · 每套一份"],
    [{ qty_basis: "per_section", qty_factor: 1, spec_by_diameter: true, role: "main_machine" }, "按段 ×1 · 规格随管径 · 主机"],
    [{ qty_basis: "per_total_metre" }, "按总长（没填系数）"]
  ])("%j → %s", (patch, text) => expect(ruleSummary({ ...emptyRule(), ...patch })).toBe(text));
});

it("lineChanged：生成时的数量是空的不算改过；数量不同才算", () => {});
it("planParamProblems：和服务端相同的八句话", () => {});
```

```ts
// template-paste.test.ts：原来 kit-view.test.ts 里 mapTemplateRows 的用例整段挪过来，再加
it("认六个可选的列：计算方式、系数、另加、每套一份、规格随管径、标记", () => {
  const table = parseTable(["分节\t类型\t品名\t计算方式\t系数\t另加\t每套一份\t规格随管径\t标记",
    "辅助设备\t物资\t排泥钢管\t按最长一段\t2\t60\t是\t是\t", "顶进设备\t设备\t机头泥水\t\t\t\t是\t\t主机"].join("\n"));
  // 第二行缺设备类别列 → 这一行报「设备行要填设备类别」；第一行的 rule 是
  // { qty_basis: "per_longest_metre", qty_factor: 2, qty_extra: 60, qty_per_set: true, spec_by_diameter: true, role: null }
});
it("没有这些列时都是固定、不勾、不标", () => {});
it.each([["计算方式", "按套", "计算方式只能填 固定、按总长、按最长一段、按段：按套"], ["系数", "两", "系数不是数字：两"],
  ["每套一份", "也许", "每套一份只能填 是 或 否：也许"], ["标记", "老板", "标记只能填 主机、发电、住宿：老板"]])("%s 填错：%s", () => {});
```

`kit-view.test.ts`：给 `editableFromTemplate` → `toTemplateLines` 加一条「规则字段原样来回」。

- [ ] **Step 2: 跑测试，确认失败**

Run: `cd packages/web && npm test -- src/views/wh/kit`
Expected: FAIL，找不到 `kit-plan-view`、`template-paste`

- [ ] **Step 3: 实现**

「是」「否」之外，`每套一份`、`规格随管径` 也认 `1`、`0`、`√` 和空（空是否）。`TemplateImportDialog.vue` 改从 `template-paste.ts` 导入，提示文字里加上六个可选的列名。`kit-view.ts` 挪走 `mapTemplateRows` 后不超过 400 行。

- [ ] **Step 4: 跑测试和类型检查**

Run: `cd packages/web && npm test -- src/views/wh/kit && npm run typecheck`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/web/src/api/wh packages/web/src/views/wh/kit
git commit -m "feat: 按参数生成清单的前端类型、请求和纯函数；粘贴模板行认规则的列"
```

---

### Task 8: 模板编辑页配规则

**Files:**
- Create: `packages/web/src/views/wh/kit/components/TemplateRuleCell.vue`、`TemplateRuleCell.test.ts`
- Modify: `packages/web/src/views/wh/kit/components/KitLineTable.vue`、`packages/web/src/views/wh/kit/template.vue`

**Interfaces:**
- Consumes: `KitLineRule`、`ruleSummary`、`BASIS_LABELS`、`ROLE_LABELS`（任务 7）。
- Produces: `TemplateRuleCell`，`v-model: KitLineRule`，props `{ lineKind: KitLineKind; readonly: boolean }`。平时显示 `ruleSummary` 的文字（空的显示「固定」），点开是一个小面板，里面六样设置。备忘行不显示。

- [ ] **Step 1: 写失败的测试**（写法照 `views/wh/settings/components/CategoryPanel.test.ts`）

```ts
it("平时显示规则的文字；没配时显示「固定」", () => {});
it("选了按最长一段、填系数 2、另加 60、勾每套一份：发出的新值是这四样，别的不变；不改传进来的对象", () => {});
it("计算方式改回固定时，系数和另加清空", () => {});
it("只读时点不开", () => {});
it("备忘行什么都不渲染", () => {});
```

- [ ] **Step 2: 跑测试，确认失败**

Run: `cd packages/web && npm test -- src/views/wh/kit/components/TemplateRuleCell.test.ts`
Expected: FAIL，找不到组件

- [ ] **Step 3: 实现**

`KitLineTable.vue` 在模板模式下多一列「计算规则」，放 `TemplateRuleCell`；清单模式不显示这一列。`template.vue` 的表头多一个「管径（毫米）」输入框，保存时带上 `diameter_mm`（空是 `null`）；保存行时 `toTemplateLines` 已经带着规则。模板列表多一列管径。

- [ ] **Step 4: 跑测试、类型检查和 lint**

Run: `cd packages/web && npm test -- src/views/wh/kit && npm run typecheck && npx eslint src/views/wh/kit`
Expected: PASS，没有新的 lint 错误

- [ ] **Step 5: 提交**

```bash
git add packages/web/src/views/wh/kit
git commit -m "feat: 配套模板编辑页可以配每一行的计算规则和模板的管径"
```

---

### Task 9: 新建清单对话框的「按项目参数生成」

**Files:**
- Create: `packages/web/src/views/wh/kit/components/KitPlanForm.vue`、`KitPlanPreview.vue`、`KitCreateDialog.test.ts`
- Modify: `packages/web/src/views/wh/kit/components/KitCreateDialog.vue`

**Interfaces:**
- Consumes: `getKitPlanSource`、`previewKitPlan`、`createKit`（任务 7）；`pickTemplateFor`、`planParamProblems`、`emptyPlanParams`、`SOURCE_FROM_LABELS`（任务 7）。
- Produces:
  - `KitPlanForm`：`v-model:params: KitPlanParams`、`v-model:templateId: number | null`，props `{ sources: KitPlanSources; templates: KitTemplateRow[]; loading: boolean }`。七项参数加「甲方提供」两个勾选；每项下面一行小字标来源（「工作段」「项目档案」，手改过的不标）；模板下拉。
  - `KitPlanPreview`：props `{ preview: KitPlanPreview }`。主要设备（品名、台数、候选）、行数、待选规格的行数、提醒。

- [ ] **Step 1: 写失败的测试**（`vi.mock("@/api/wh/kit")`、`vi.mock("@/composables/useProjectOptions")`）

```ts
it("「从哪来」第一项是按项目参数生成，默认选中；原来三项还在", async () => {});
it("选了项目就取参数并填进去，按机型和管径预选模板；来源标在每一项下面", async () => {
  // getKitPlanSource 返回 { params: { machine_type: "泥水平衡", pipe_diameter_mm: 1600, section_count: 1 }, sources: {…section…}, has_text: true }
  // 模板列表有 泥水 1200、泥水 600 → 预选 1200；页面上有「工作段」的小字
});
it("取参数失败只提示一句，参数区照样能手填", async () => {});
it("参数不对时「预览」点不了，并显示那句话", async () => { /* 最长一段 200、总长 100 → 「最长一段不能超过总长度」 */ });
it("点预览：用现在的参数调 previewKitPlan，显示主要设备和提醒；改了任何参数或模板，预览作废，要重新点", async () => {});
it("点创建：createKit 带 template_id 和 plan（参数和来源；手改过的那项来源是 manual），不带 lines", async () => {});
it("换成「选模板」再创建：请求里没有 plan", async () => {});
```

- [ ] **Step 2: 跑测试，确认失败**

Run: `cd packages/web && npm test -- src/views/wh/kit/components/KitCreateDialog.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现**

`form.source` 多一个值 `"plan"`，放第一个，默认它。选「按项目参数生成」时对话框宽 760px；没看过预览或预览已作废时「创建」点不了。换项目时重新取参数，清掉预览。项目没选时参数区不显示。`KitCreateDialog.vue` 不超过 400 行，参数区和预览都在子组件里。

- [ ] **Step 4: 跑测试、类型检查和 lint**

Run: `cd packages/web && npm test -- src/views/wh/kit && npm run typecheck && npx eslint src/views/wh/kit`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/web/src/views/wh/kit
git commit -m "feat: 新建清单可以按项目参数生成：参数、选模板、预览、创建"
```

---

### Task 10: 清单详情显示参数、算式和「已改」

**Files:**
- Create: `packages/web/src/views/wh/kit/components/KitPlanSummary.vue`、`KitPlanSummary.test.ts`
- Modify: `packages/web/src/views/wh/kit/components/KitLineTable.vue`、`packages/web/src/views/wh/kit/detail.vue`、`packages/web/src/views/wh/kit/kit-view.ts`、`kit-view.test.ts`

**Interfaces:**
- Consumes: `ProjectKitDetail.plan`、行上的 `calc_text` 和 `generated_qty`、`lineChanged`（任务 7）。
- Produces: `KitPlanSummary`，props `{ plan: NonNullable<ProjectKitDetail["plan"]> }`，一行只读的文字。`EditableKitLine` 多 `calc_text: string | null`、`generated_qty: number | null`，`editableFromKit` 带上；`toKitLines` **不**带这两个字段。

- [ ] **Step 1: 写失败的测试**

```ts
// KitPlanSummary.test.ts
it("把参数写成一行：泥水平衡 · D1600 · 总长 105 米 · 最长一段 105 米 · 1 段 · 1 套 · 粉质粘土 · 甲方提供发电、住宿；模板 泥水平衡 DN1200", () => {});
it("空着的参数不出现；甲方什么都不提供时不出现那一段", () => {});

// kit-view.test.ts
it("editableFromKit 带上算式和生成时的数量；toKitLines 的每一行只有原来那十个字段", () => {
  expect(Object.keys(toKitLines(editableFromKit([line]))[0]).sort()).toEqual(
    ["device_category_id", "line_kind", "material_id", "name_text", "note", "planned_qty", "section", "source", "spec_text", "unit"]);
});
```

`KitLineTable` 的显示加一条组件测试：有 `calc_text` 的行数量下面有那句算式；数量和 `generated_qty` 不同时有「已改」；`generated_qty` 是空的行什么都不多显示。

- [ ] **Step 2: 跑测试，确认失败**

Run: `cd packages/web && npm test -- src/views/wh/kit`
Expected: FAIL

- [ ] **Step 3: 实现**

`detail.vue` 现在 384 行：只加 `KitPlanSummary` 的引入和一处使用，`kit.plan` 是空的不渲染。算式用灰色小字放在数量输入框下面，「已改」用 `el-tag` 的 `info` 小号。

- [ ] **Step 4: 跑测试、类型检查和 lint**

Run: `cd packages/web && npm test && npm run typecheck && npx eslint src/views/wh/kit`
Expected: 全部 PASS

- [ ] **Step 5: 提交**

```bash
git add packages/web/src/views/wh/kit
git commit -m "feat: 清单详情显示生成时的参数、每行的算式和已改"
```

---

### Task 11: 走一遍、文档、规则草稿表

**Files:**
- Modify: `docs/superpowers/specs/2026-11-13-kit-plan-from-project-params-design.md`（状态）、`doc/UI设计文档.md`（库房的项目配套一节）、`doc/开发记录.md`（追加）、`CLAUDE.md`（Key Conventions 里加一条按参数生成的说明）
- Create（不进 git）：`mig/warehouse/配套模板-规则草稿-2026-11-13.xlsx`

- [ ] **Step 1: 全量检查**

Run: `cd packages/api && npm test && npm run typecheck && npm run lint`
Run: `cd packages/web && npm test && npm run typecheck && npm run build`
Run: `cd packages/miniapp && npm run test:wh`
Expected: 全部通过；小程序的测试一条没改也通过

- [ ] **Step 2: 本地浏览器走一遍**（`preview_start` 的 `api` 和 `web`，本地库先 `npm run db:migrate:local`）

按设计稿第 13 节的第 2 到 5 条和第 9 条走：建一个带规则的模板（或粘贴导入），项目填上工作段，新建清单选「按项目参数生成」，看参数、来源、预选的模板、预览的提醒；创建后看算式；改一行数量保存，看「已改」；再用「选模板」建一份，确认和以前一样。把看到的写进开发记录。有对不上的地方先修再往下。

- [ ] **Step 3: 出规则草稿表**

读 `mig/warehouse/配套模板-2026-11-13/导入内容-2026-11-13.json` 里的四个模板，每个模板一张工作表，列是「粘贴模板行」认的全部列（原来八列加六个规则列），外加一列「依据」。建议这样填，其余留空给李震：

- 机头、油泵站：默认数量 1，每套一份。机头标主机。
- 发电机标发电；「生活设施」的行标住宿。
- 两份泥水表里规格不同的同一行：勾规格随管径。两份土压表同理。
- 大同（两套）的数量正好是张家口（单套）两倍的行：建议每套一份，依据里写「两套表是单套的 2 倍」。
- 计算方式和系数一律不猜，留空；依据里注明「要有带长度的样本才能定」。

第一张工作表写说明：每一列是什么、怎么填、填完怎么导回（复制整张表，在模板编辑页点「粘贴模板行」）。

- [ ] **Step 4: 更新文档并提交**

```bash
git add docs doc CLAUDE.md
git commit -m "docs: 配套清单按项目参数生成第一期的设计状态、界面说明和开发记录"
```

- [ ] **Step 5: 上线顺序写进 PR（每一步要 owner 同意）**

在只含本批改动的分支上跑生产迁移 `0101`（先 `migrations list` 确认只有它待跑）→ 合并 PR → 健康检查 → 生产上打开一个模板，确认管径和标记已经补上、能配规则。规则本身等李震核对草稿表、owner 提供的新样本到了以后再导。
