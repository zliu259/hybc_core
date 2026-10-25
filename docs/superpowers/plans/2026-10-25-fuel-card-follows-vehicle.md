# 油卡跟车走 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 油卡从"绑人"改为"挂车"：任何人选车后只能选该车名下的卡申请额度，办公室在档案页维护车卡关系（绑定/转移/解绑，留历史）。

**Architecture:**
- 重建空表 `fuel_card_vehicle_binding`：一卡同时只挂一辆车，用部分唯一索引保证；历史按行保留。
- 绑定逻辑抽到新服务 `services/fleet-card-binding.ts`，`routes/fleet.ts` 只做参数校验、审计和响应。
- Web 申请页和小程序申请页改为"选车 → 按车拉卡"。两端各抽一个纯函数模块，写单测。

**Tech Stack:** Hono + Cloudflare D1（packages/api，Vitest）；Vue 3 + Element Plus（packages/web，Vitest + happy-dom）；原生企微小程序（packages/miniapp，`node` + `assert` 脚本）。

**Spec:** `docs/superpowers/specs/2026-10-25-fuel-card-follows-vehicle-design.md`。执行者需要和本计划一起读，规则和理由以 spec 为准。

## Global Constraints

- **分支：** 在功能分支或 worktree 上做（`superpowers:using-git-worktrees`）。push main 等于生产部署，只有 Task 9 才推送，而且要 owner 明确同意。
- **提交信息：** 格式为 `<type>: <description>`，type 取 feat/fix/refactor/docs/test/chore。**不加** Co-Authored-By 或任何 AI 署名（用户全局规则）。
- **禁止写法：** 不用 `@ts-ignore` / `as any`；时间字段用 ISO 8601 TEXT（`new Date().toISOString()`）；只软删，不 DELETE 业务数据。
- **新增错误信息：** 服务端直接返回中文。固定文案：
  - `所选车辆无效或已停用`
  - `所选油卡无效或已停用`
  - `该油卡不属于所选车辆`
  - `该油卡不属于该申请的车辆`
  - `该油卡当前未绑定车辆`
  - `油卡绑定已被他人修改，请刷新后重试`
- **页面提示：** 车辆未配卡时显示 `该车辆尚未配置油卡，请联系办公室`。
- **权限：** 绑定、解绑、绑定历史、余额流水仅限 `super_admin` / `manager` / `finance`；申请仍对五个角色开放。
- **不动的部分：**
  - `fuel_card_user_binding` 表不删不改，也不再读写；
  - 风控规则 `loadFuelRuleContext` 不改；
  - resubmit 接口逻辑不改。
- **迁移编号：** 用 `0090`。开工时先 `ls packages/api/migrations | tail -3`，如果已被占用就顺延，并运行 `node packages/api/scripts/check-migration-numbers.mjs`。
- **每个包改完都要本地通过：**
  - api：`npm run typecheck && npm test && npm run lint`
  - web：`npm run typecheck && npm test`，改动的文件过 `npx eslint`
  - miniapp：`npm run typecheck`

## Review Focus

前面 5 条在各自任务里都有测试钉住；第 6 条没有自动化测试，要做浏览器冒烟验证。

1. **历史在途单补充资料**（#41 这类：卡没有挂在申请单的车上）：resubmit 必须仍返回 200，不做绑定校验。由 Task 4 的 `resubmits legacy application whose card is not bound to its vehicle` 钉住。
2. **财务处理在途单时原样回传原卡**（处理工作台就是这么调用的）：不能因为"卡不属于该车"被拒。由 Task 4 的 `processes legacy application when fuel_card_id equals the current card` 钉住。
3. **`GET /fuel-cards?vehicle_id=abc` 或 `vehicle_id=0`**：必须 400。不能悄悄忽略参数、返回全部卡，否则前端会把别的车的卡列出来。由 Task 3 的 `rejects invalid vehicle_id filter` 钉住。
4. **旧版小程序请求 `fuel-cards?mine=true&status=active`**：要返回全部启用卡，不能返回空列表，否则旧版过渡期谁都申请不了。由 Task 3 的 `ignores legacy mine=true and lists all cards` 钉住。
5. **同一张卡重复绑到同一辆车**（双击按钮、重复提交）：结果是 `unchanged`，不写第二条审计、不插第二条绑定。由 Task 2 的 `returns unchanged without writes when already bound to the same vehicle` 和 Task 3 的 `does not audit unchanged bind` 钉住。
6. **快速连续换车**：上一辆车的卡列表晚到，不能覆盖当前车的列表。Task 5 和 Task 7 用请求序号守卫（沿用 `processing-workbench.vue` 里 `detailRequestSeq` 的写法），在浏览器冒烟里验证。

---

### Task 1: 重建 `fuel_card_vehicle_binding` 迁移

**Files:**
- Create: `packages/api/migrations/0090_fuel_card_vehicle_binding_rebuild.sql`

**Interfaces:**
- Produces:
  - 表 `fuel_card_vehicle_binding`，列为 `id INTEGER PK AUTOINCREMENT, fuel_card_id INTEGER NOT NULL FK, vehicle_id INTEGER NOT NULL FK, status TEXT NOT NULL DEFAULT 'active', bound_at TEXT NOT NULL, bound_by_userid TEXT NOT NULL, unbound_at TEXT, unbound_by_userid TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL`；
  - 索引 `idx_fuel_card_vehicle_binding_active_card`：唯一索引，`(fuel_card_id) WHERE status = 'active'`；
  - 索引 `idx_fuel_card_vehicle_binding_vehicle`：普通索引，`(vehicle_id, status)`。

- [ ] **Step 1: 写迁移**

  不 DROP 旧表，改为 `ALTER TABLE fuel_card_vehicle_binding RENAME TO fuel_card_vehicle_binding_pre0090`，这样即使表里意外有数据也不会丢，满足 spec 5.1 "不要自动丢数据"的要求。改名前先 `DROP INDEX IF EXISTS` 两个旧索引：
  - `idx_fuel_card_vehicle_binding_unique`
  - `idx_fuel_card_vehicle_binding_vehicle_id`

  然后建新表和上面两个索引。文件开头注释写明：生产表 2026-10-25 核实为 0 行；旧唯一索引会挡住"转回原车"。

- [ ] **Step 2: 本地应用并验证索引语义**

  Run（在 `packages/api`）：`npm run db:migrate:local`

  然后用 `npx wrangler d1 execute hybcdg-prod-db --local --command "..."` 依次执行：
  - 插入 `(card 1, vehicle 1, active)` → 成功
  - 再插 `(card 1, vehicle 2, active)` → 报 UNIQUE constraint failed
  - 把第一行改成 inactive，再插 `(card 1, vehicle 2, active)` → 成功
  - 把它改成 inactive，再插 `(card 1, vehicle 1, active)` → 成功（转回原车）

  四步都和预期一致才算通过。最后清掉这些测试行（本地库可以 DELETE）。

- [ ] **Step 3: 编号检查**

  Run：`node packages/api/scripts/check-migration-numbers.mjs`，Expected：无违规输出，exit 0。

- [ ] **Step 4: Commit** — `feat(api): 重建油卡车辆绑定表，支持一卡一车与转移历史`

---

### Task 2: 车卡绑定服务

**Files:**
- Create: `packages/api/src/services/fleet-card-binding.ts`
- Test: `packages/api/src/services/fleet-card-binding.test.ts`

**Interfaces:**
- Consumes：Task 1 的表结构。
- Produces（导出）：

```ts
export type FuelCardBindOutcome = "unchanged" | "bound" | "transferred";
export type BindFuelCardResult =
  | { ok: true; outcome: FuelCardBindOutcome; previousVehicleId: number | null }
  | { ok: false; reason: "card_invalid" | "vehicle_invalid" | "conflict" };
export type FuelCardVehicleBindingHistoryRow = {
  id: number; vehicle_id: number; vehicle_plate_no: string | null; status: "active" | "inactive";
  bound_at: string; bound_by_userid: string; unbound_at: string | null; unbound_by_userid: string | null;
};
export const bindFuelCardToVehicle: (env: Env, input: { fuelCardId: number; vehicleId: number; operatorUserid: string }) => Promise<BindFuelCardResult>;
export const unbindFuelCardFromVehicle: (env: Env, input: { fuelCardId: number; operatorUserid: string }) => Promise<{ ok: true; previousVehicleId: number } | { ok: false; reason: "not_bound" | "conflict" }>;
export const isFuelCardBoundToVehicle: (env: Env, fuelCardId: number, vehicleId: number) => Promise<boolean>;
export const listFuelCardVehicleBindings: (env: Env, fuelCardId: number) => Promise<FuelCardVehicleBindingHistoryRow[]>;
```

- [ ] **Step 1: 写失败测试**

  测试文件里自建一个按 SQL 子串路由的假 DB（仿 `fleet-governance.test.ts` 的 `FleetRouteDb`）。配置项：
  - 卡的 status；
  - 车的 status；
  - 当前有效绑定（`{ id, vehicle_id } | null`）；
  - 关闭旧绑定的 UPDATE 返回的 `changes`；
  - INSERT 是否抛错。

  所有 `run` 调用都记下来，供断言。用例：
  - `rejects inactive or missing card`：卡不存在 → `{ ok:false, reason:"card_invalid" }`；卡 status 为 `inactive` → 同样结果。两种情况都没有任何 run。
  - `rejects inactive or missing vehicle` → `vehicle_invalid`，没有任何 run。
  - `binds an unbound card`：返回 `{ ok:true, outcome:"bound", previousVehicleId:null }`。只有一条 `INSERT INTO fuel_card_vehicle_binding`，参数里包含 fuelCardId、vehicleId、operatorUserid。
  - `returns unchanged without writes when already bound to the same vehicle`：返回 `outcome:"unchanged"`，`previousVehicleId` 为该车 id，没有任何 run。
  - `transfers a card bound to another vehicle`：先 UPDATE（SQL 含 `status = 'inactive'`、`unbound_at`、`unbound_by_userid`、`WHERE id = ? AND status = 'active'`），再 INSERT；返回 `outcome:"transferred"`，`previousVehicleId` 为旧车 id。
  - `returns conflict when closing the old binding changes 0 rows`：返回 `conflict`，没有 INSERT。
  - `returns conflict when insert hits the active-card unique index`：INSERT 抛出含 `UNIQUE constraint failed` 的错误 → 返回 `conflict`。其他错误要原样抛出。
  - `unbind returns not_bound when no active binding`；`unbind closes the active binding`：返回 `previousVehicleId`，UPDATE 带操作人。
  - `isFuelCardBoundToVehicle` 查询的 SQL 必须同时带 `fuel_card_id = ?`、`vehicle_id = ?`、`status = 'active'`。

- [ ] **Step 2: 运行确认失败**

  Run（`packages/api`）：`npm test -- src/services/fleet-card-binding.test.ts`，Expected：FAIL（模块不存在）。

- [ ] **Step 3: 实现 `packages/api/src/services/fleet-card-binding.ts`**

  卡和车的检查都用 `SELECT id, status FROM fuel_card / company_vehicle WHERE id = ?`。转移的顺序是：先按 `id + status='active'` 乐观关闭旧绑定，再插新行。D1 没有事务，见 spec 5.2；部分唯一索引兜底并发。

  `listFuelCardVehicleBindings` LEFT JOIN `company_vehicle` 取 `current_plate_no AS vehicle_plate_no`，按 `id DESC` 排序。

- [ ] **Step 4: 运行确认通过**

  Run：同 Step 2，Expected：PASS。

- [ ] **Step 5: Commit** — `feat(api): 新增油卡车辆绑定服务（绑定/转移/解绑/历史）`

---

### Task 3: 油卡/车辆查询与绑定接口

**Files:**
- Modify：
  - `packages/api/src/routes/fleet.ts`：`GET /vehicles`（约 249–273 行）、`GET /fuel-cards`（449–475）、`GET /fuel-cards/:id/balance-logs`（520–577）；删除 `POST /fuel-cards/:id/bind-user`（579–601）；重写 `POST /fuel-cards/:id/bind-vehicle`（603–623）；新增 unbind 和 history 两个路由。
  - `packages/api/src/services/fleet-governance.test.ts`：路由测试的假 DB 和 "fleet route access scoping" 一组用例。
- Test：`packages/api/src/services/fleet-governance.test.ts`

**Interfaces:**
- Consumes：Task 2 导出的全部函数。
- Produces（HTTP 契约，Task 5–7 依赖）：
  - `GET /api/v1/fleet/vehicles`：每行在原有字段外加 `fuel_card_count: number`（该车有效绑定且卡 active 的数量）和 `fuel_card_nos: string`（逗号分隔，没有卡时为 `''`）。原有 `status` / `entity_id` / `keyword` 过滤保留（列名加 `v.` 前缀）。
  - `GET /api/v1/fleet/fuel-cards?status=&vehicle_id=`：
    - 所有已登录角色都能看全部卡。
    - 每行是 `fuel_card` 的全部字段，加 `vehicle_id: number | null`、`vehicle_plate_no: string | null`（当前有效绑定）。
    - `vehicle_id` 必须是正整数，否则返回 400（`vehicle_id must be a positive integer`）。
    - `mine` 参数忽略。
    - 不再返回 `bind_userids` / `bind_user_count`。
  - `POST /api/v1/fleet/fuel-cards/:id/bind-vehicle`，body 为 `{ vehicle_id: number }`：
    - 成功返回 200，`{ success:true, data:{ outcome, previous_vehicle_id } }`。
    - `card_invalid` / `vehicle_invalid` 返回 400，带对应中文文案；`conflict` 返回 409。
  - `POST /api/v1/fleet/fuel-cards/:id/unbind-vehicle`：
    - 成功返回 200，`{ success:true, data:{ previous_vehicle_id } }`。
    - `not_bound` 返回 400（`该油卡当前未绑定车辆`），`conflict` 返回 409。
  - `GET /api/v1/fleet/fuel-cards/:id/vehicle-bindings` → `{ success:true, data: FuelCardVehicleBindingHistoryRow[] }`
  - 审计：
    - action 为 `fuel_card_bind_vehicle` / `fuel_card_unbind_vehicle`，`target_type:"fuel_card"`，`target_id` 为卡 id；
    - detail 为 `{ outcome, from_vehicle_id, to_vehicle_id }` 或 `{ from_vehicle_id }`；
    - `unchanged` 不写审计。

- [ ] **Step 1: 改假 DB**

  在 `FleetRouteDb` 的 options 里去掉 `cardBinding`，新增两项：
  - `vehicle?: { status: string } | null`：`SELECT … FROM company_vehicle WHERE id = ?` 返回 `{ id, status:"active", ...vehicle }`，配置为 null 时返回 null；
  - `vehicleBinding?: { vehicle_id: number } | null`：默认 null。SQL 含 `FROM fuel_card_vehicle_binding` 时返回 `{ id: 1, vehicle_id }`。如果 SQL 含 `vehicle_id = ?`，只有绑定参数等于 `vehicleBinding.vehicle_id` 才返回这行。

- [ ] **Step 2: 写失败测试**

  把 "forces operators to list only their own fuel cards" 和 "rejects operator balance log access for unbound cards" 两条替换掉，新增：
  - `lets operators list all fuel cards with their bound vehicle`：operator 调 `GET /fleet/fuel-cards?status=active`，SQL 含 `fuel_card_vehicle_binding`，不含 `bind_userid`，参数里没有 operator 的 userid。
  - `ignores legacy mine=true and lists all cards`：`?mine=true&status=active` 的 SQL 和参数，与不带 mine 时完全相同。
  - `filters fuel cards by vehicle_id`：`?vehicle_id=8` 时参数含 8，SQL 含 `vb.vehicle_id = ?`。
  - `rejects invalid vehicle_id filter`：`abc`、`0`、`-1` 都返回 400，且 `env.DB.alls` 为空。
  - `rejects operator balance log access`：operator 调 `GET /fleet/fuel-cards/9/balance-logs` 返回 403。
  - `binds a card to a vehicle and audits`：finance 调 bind-vehicle（假 DB 无绑定）返回 200，`data.outcome === "bound"`；有一条 `INSERT INTO api_audit_log`，action 为 `fuel_card_bind_vehicle`。
  - `does not audit unchanged bind`：`vehicleBinding:{vehicle_id:8}`，body 为 `{vehicle_id:8}` → 200，`outcome:"unchanged"`，没有 audit INSERT。
  - `rejects bind for operator`：operator 返回 403。
  - `rejects bind to inactive vehicle`：`vehicle:{status:"inactive"}` 返回 400，message 为 `所选车辆无效或已停用`。
  - `unbind returns 400 when card is not bound`。
  - `bind-user route is gone`：`POST /fleet/fuel-cards/9/bind-user` 返回 404。

- [ ] **Step 3: 运行确认失败**

  Run：`npm test -- src/services/fleet-governance.test.ts`，Expected：上述新用例 FAIL。

- [ ] **Step 4: 实现路由改动**

  - `GET /fuel-cards` 用 LEFT JOIN 取有效绑定及车牌，`vehicle_id` 过滤写在 WHERE。
  - `GET /vehicles` 用 LEFT JOIN、`COUNT`、`GROUP_CONCAT`，再 `GROUP BY v.id`。
  - balance-logs 改用 `requireRoles(["super_admin","manager","finance"])`，删掉其中的用户绑定分支。
  - 路由 id 统一用现有的 `parsePositiveInteger` 解析。

- [ ] **Step 5: 运行确认通过**

  Run：`npm test && npm run typecheck && npm run lint`，Expected：全部通过。

- [ ] **Step 6: Commit** — `feat(api): 油卡按车查询与车卡绑定/转移/解绑接口，下线员工绑卡`

---

### Task 4: 申请与处理按车卡绑定校验

**Files:**
- Modify：`packages/api/src/routes/fleet.ts`：`POST /fuel-applications`（约 681–816 行）和 `POST /fuel-applications/:id/process`（1083–1257）
- Test：`packages/api/src/services/fleet-governance.test.ts`

**Interfaces:**
- Consumes：
  - `isFuelCardBoundToVehicle`（Task 2）；
  - Task 3 改过的假 DB 配置项（`vehicle`、`vehicleBinding`、`fuelCard`）。
- Produces：
  - 申请接口的校验顺序：
    1. 字段类型（沿用原有 400）
    2. 车存在且 active，否则 `所选车辆无效或已停用`
    3. 卡存在且 active，否则 `所选油卡无效或已停用`
    4. 卡有效挂在该车上，否则 `该油卡不属于所选车辆`

    以上失败都返回 400，并且不写任何东西。
  - 处理接口：
    - 只有 body 里的 `fuel_card_id` 是数字、且不等于申请单当前的 `fuel_card_id` 时，才要求新卡挂在申请单的 `vehicle_id` 上，否则返回 400（`该油卡不属于该申请的车辆`）。为此，读申请单的 SELECT 要加上 `vehicle_id`。
    - 原有"卡必须 active"的校验保留。

- [ ] **Step 1: 写失败测试**（新建 describe "fleet route fuel card follows vehicle"）

  申请类用例用 operator 账号，body 为 `{ vehicle_id: 8, fuel_card_id: 9, requested_amount: 500, vehicle_mileage_km: 35000, photo_keys_json: "[\"a.jpg\"]" }`：
  - `submits when the card is bound to the chosen vehicle`：`vehicleBinding:{vehicle_id:8}` → 201；有一条 `INSERT INTO fuel_quota_application`；SQL 和参数里都不出现 `fuel_card_user_binding`。
  - `submits for an applicant who has no personal binding`：同上配置，换成 `sub:"someone-else"` → 201。用来钉住"任何人都能申请"。
  - `rejects a card bound to another vehicle`：`vehicleBinding:{vehicle_id:5}` → 400，message 为 `该油卡不属于所选车辆`，没有 `INSERT INTO fuel_quota_application`。
  - `rejects an unbound card`：`vehicleBinding:null` → 400，文案同上。
  - `rejects inactive vehicle`：`vehicle:{status:"inactive"}` → 400（`所选车辆无效或已停用`）。
  - `rejects inactive card`：`fuelCard:{status:"inactive"}` → 400（`所选油卡无效或已停用`）。

  处理类用例用 finance 账号：
  - `processes legacy application when fuel_card_id equals the current card`：`application:{status:"pending", vehicle_id:8, fuel_card_id:9}`，`vehicleBinding:null`，body 为 `{ status:"processed", fuel_card_id:9, latest_card_balance:800 }` → 200。
  - `rejects switching to a card of another vehicle`：同一申请单，`vehicleBinding:{vehicle_id:5}`，body 里 `fuel_card_id:10` → 400（`该油卡不属于该申请的车辆`），且没有 `UPDATE fuel_quota_application SET`。
  - `allows switching to another card of the same vehicle`：`vehicleBinding:{vehicle_id:8}`，`fuel_card_id:10` → 200。

  补充资料类用例：
  - `resubmits legacy application whose card is not bound to its vehicle`：默认 needs_info 申请单，`vehicleBinding:null` → 200。

- [ ] **Step 2: 运行确认失败**

  Run：`npm test -- src/services/fleet-governance.test.ts`，Expected：新用例 FAIL（补充资料那条应该本来就 PASS，保留它作为回归保护）。

- [ ] **Step 3: 实现两处校验**

- [ ] **Step 4: 运行确认通过**

  Run：`npm test && npm run typecheck && npm run lint`，Expected：全部通过。

- [ ] **Step 5: Commit** — `feat(api): 油卡申请按车卡绑定校验，任何人可为任何车申请`

---

### Task 5: Web 接口封装与申请页按车选卡

**Files:**
- Modify：`packages/web/src/api/fleet.ts`
- Create：`packages/web/src/views/finance/fleet/fuel-card-selection.ts`
- Test：`packages/web/src/views/finance/fleet/fuel-card-selection.test.ts`
- Modify：`packages/web/src/views/finance/fleet/application.vue`

**Interfaces:**
- Consumes：Task 3、Task 4 的 HTTP 契约。
- Produces：
  - 类型改动：
    - `FleetVehicle` 加 `fuel_card_count?: number; fuel_card_nos?: string`
    - `FuelCard` 加 `vehicle_id: number | null; vehicle_plate_no: string | null`
    - 新增 `type FuelCardVehicleBinding`（字段同 Task 2 的 `FuelCardVehicleBindingHistoryRow`）
  - 函数改动：
    - `listFuelCards(params?: { status?: string; vehicle_id?: number })`
    - 新增 `bindFuelCardVehicle(fuelCardId: number, data: { vehicle_id: number })`
    - 新增 `unbindFuelCardVehicle(fuelCardId: number)`
    - 新增 `listFuelCardVehicleBindings(fuelCardId: number)`
    - 删除 `listMyFuelCards`
  - 暂不删除：`FuelCard.bind_userids` / `bind_user_count` 字段和 `bindFuelCardUser`。`vehicles.vue` 还在用它们，到 Task 6 再删，保证每个任务结束时 typecheck 都能通过。
  - `fuel-card-selection.ts` 导出：
    - `resolveFuelCardSelection(cards: FuelCard[], previousCardId?: number): number | undefined`
    - `fuelCardOptionLabel(card: FuelCard): string`
    - `vehicleOptionLabel(vehicle: FleetVehicle): string`

- [ ] **Step 1: 写失败测试**（`fuel-card-selection.test.ts`）

  - `keeps the previous card when it is still in the list`：卡 [3,5]，previousCardId 为 5 → 5。
  - `auto-selects the only card`：卡 [7]，previousCardId 为 undefined → 7；卡 [7]，previousCardId 为 99 → 7。
  - `leaves selection empty for multiple cards without a valid previous`：卡 [3,5]、previousCardId 为 undefined → undefined；空列表 → undefined。
  - `fuelCardOptionLabel`：`{ card_no:"1000111300013742430", latest_balance:1000 }` → `1000111300013742430（余额 1000.00）`。
  - `vehicleOptionLabel`：
    - `{ current_plate_no:"京MKG902", vehicle_model:"福田（轻型普通货车）", fuel_card_count:2 }` → `京MKG902 · 福田（轻型普通货车）`
    - `fuel_card_count:0` 时末尾加 `（未配卡）`
    - `vehicle_model` 为 null 时只显示车牌。

- [ ] **Step 2: 运行确认失败**

  Run（`packages/web`）：`npm test -- src/views/finance/fleet/fuel-card-selection.test.ts`，Expected：FAIL。

- [ ] **Step 3: 实现 `fuel-card-selection.ts` 和 `api/fleet.ts` 的改动**

- [ ] **Step 4: 改 `application.vue`**

  - 车辆 `el-select` 加 `filterable`，label 用 `vehicleOptionLabel`。
  - 车辆 `@change` 时清空 `form.fuel_card_id`，然后调 `listFuelCards({ status:"active", vehicle_id })`，用请求序号丢弃过期响应，结果写进 `fuelCards`，再用 `resolveFuelCardSelection(cards)` 设置 `form.fuel_card_id`。
  - 没选车时油卡下拉禁用。
  - 选中的车没有卡时：显示 `el-alert`（type 为 warning，文案见 Global Constraints），并禁用提交按钮。
  - `loadData` 不再拉卡。
  - 提交成功后，表单重置时一并清空 `fuelCards`。

- [ ] **Step 5: 运行确认通过**

  Run：`npm test && npm run typecheck && npx eslint src/api/fleet.ts src/views/finance/fleet/application.vue src/views/finance/fleet/fuel-card-selection.ts`，Expected：全部通过。

- [ ] **Step 6: 浏览器冒烟**

  按记忆 `local-web-preview-login-trick` 的做法登录本地 web，本地库挂好一两条车卡绑定。逐条验证：
  - 单卡车自动选中；
  - 多卡车需要手选；
  - 无卡车出现提示，且提交被禁用；
  - 快速连续切换两辆车，最终下拉显示的是后选那辆车的卡；
  - 提交成功。

- [ ] **Step 7: Commit** — `feat(web): 油卡申请页按车选卡，单卡自动选中，无卡提示`

---

### Task 6: Web 车辆油卡档案维护车卡关系

**Files:**
- Modify：`packages/web/src/views/finance/fleet/vehicles.vue`
- Modify：`packages/web/src/api/fleet.ts`：删除 `bindFuelCardUser`，以及 `FuelCard` 的 `bind_userids` / `bind_user_count` 字段

**Interfaces:**
- Consumes：Task 5 的 API 封装（`bindFuelCardVehicle`、`unbindFuelCardVehicle`、`listFuelCardVehicleBindings`，以及带 `vehicle_id` / `vehicle_plate_no` 的 `FuelCard`）。

- [ ] **Step 1: 改"油卡管理"页签**

  - 删掉"绑定员工"表单、`bindForm`、`submitBinding`、`formatBoundUsers` 和"绑定员工"列。`useWecomUserOptions` 保留，余额流水的操作人列还要用。
  - 新增"所属车辆"列，显示 `vehicle_plate_no`，没有时显示 `未绑定`。
  - 操作列：
    - "绑定车辆"/"转移"按钮：打开弹窗，在 `vehicles` 里筛出 `status === "active"` 的车供选择。如果卡已挂在别的车上，先 `ElMessageBox.confirm`，文案为 `该油卡当前在 {旧车牌}，确定转移到 {新车牌}？`。
    - 已绑定的卡显示"解绑"按钮，确认后调用 `unbindFuelCardVehicle`。
  - 收到 409 时提示 `油卡绑定已被他人修改，请刷新后重试` 并刷新。
  - 每次操作后 `loadData`。

- [ ] **Step 2: 改"车辆档案"页签**

  新增"油卡"列，显示 `fuel_card_nos`，为空时显示 `未配卡`。

- [ ] **Step 3: 操作记录弹窗**

  打开时并行调用 `listFuelCardBalanceLogs` 和 `listFuelCardVehicleBindings`，在余额表下方加"车辆绑定记录"表，列为：车牌、状态、绑定时间、绑定人、解绑时间、解绑人。人名用 `resolveUserName` 显示。

- [ ] **Step 4: 检查**

  Run：`npm run typecheck && npm test && npx eslint src/views/finance/fleet/vehicles.vue src/api/fleet.ts`，Expected：通过；`grep -rn "bindFuelCardUser\|listMyFuelCards\|bind_userids" src` 没有结果。

- [ ] **Step 5: 浏览器冒烟**

  逐条验证：
  - 绑定后两个页签的列同时更新；
  - 转移时出现确认框；
  - 转回原车成功；
  - 解绑后卡显示"未绑定"；
  - 记录弹窗里能看到绑定历史。

- [ ] **Step 6: Commit** — `feat(web): 车辆油卡档案支持油卡绑定/转移/解绑车辆，下线绑定员工`

---

### Task 7: 小程序申请页按车选卡

**Files:**
- Create：`packages/miniapp/utils/fuel-card-selection.js`
- Test：`packages/miniapp/utils/fuel-card-selection.test.js`
- Modify：`packages/miniapp/packageFinance/fuel-apply/index.js`、`index.wxml`、`index.json`（如需注册组件；`hy-search-picker` 已在 `app.json` 全局注册时不用改）

**Interfaces:**
- Consumes：Task 3 的 `GET /fuel-cards?status=active&vehicle_id=`、`GET /vehicles` 的 `fuel_card_count`，以及 `GET /fuel-applications` 已经返回的 `card_no`、`card_latest_balance`。
- Produces（CommonJS 导出）：
  - `resolveFuelCardIndex(cards, previousCardId) -> number`：picker 下标，0 为占位"请选择油卡"。规则和 Web 的 `resolveFuelCardSelection` 一致：保留仍在列表里的上一张卡，否则只有一张时选它，否则返回 0。
  - `fuelCardLabel(card) -> string`
  - `vehicleLabel(vehicle) -> string`

  后两者的文案和 Web 的 `fuelCardOptionLabel` / `vehicleOptionLabel` 完全相同。

- [ ] **Step 1: 写失败测试**（`assert` 脚本，用例和 Task 5 Step 1 一一对应，注意下标比 id 多一层占位换算）

- [ ] **Step 2: 运行确认失败**

  Run（`packages/miniapp`）：`node utils/fuel-card-selection.test.js`，Expected：抛出 `Cannot find module`。

- [ ] **Step 3: 实现 `utils/fuel-card-selection.js`**

- [ ] **Step 4: 改 `fuel-apply` 页**

  - `loadData` 删掉 `fuel-cards?mine=true` 请求，车辆标签改用 `vehicleLabel`。
  - 车辆选择改成 `<hy-search-picker range="{{vehicleLabels}}" value="{{vehicleIndex}}" bindchange="onVehicleChange">`（下标语义和原生 picker 相同）。
  - `onVehicleChange`：
    - 清空卡；
    - 请求 `/api/v1/fleet/fuel-cards?status=active&vehicle_id=X`，用请求序号守卫；
    - 设置 `fuelCards`、`fuelCardLabels`、`fuelCardIndex = resolveFuelCardIndex(cards)`、`form.fuel_card_id`；
    - 卡列表为空时设 `noCardForVehicle = true`。
  - `noCardForVehicle` 为 true 时：wxml 显示提示（复用 `notice-warning` 样式），提交按钮 disabled，`submit()` 里也再拦一次。
  - `startResubmit`：把 `fuelCards` 设成只含 `{ id: target.fuel_card_id, card_no: target.card_no, latest_balance: target.card_latest_balance }` 的单元素数组，下标为 1，`noCardForVehicle = false`，不发拉卡请求。
  - `cancelResubmit` 和提交成功后：清空 `fuelCards`，标签恢复为 `["请选择油卡"]`。

- [ ] **Step 5: 检查**

  Run：`node utils/fuel-card-selection.test.js && npm run typecheck`，Expected：没有断言失败，tsc 通过。

  然后在微信开发者工具里手工验证（Claude 无法操作时，请 owner 验证并如实记录）：
  - 单卡自动选中；
  - 无卡出现提示，且禁止提交；
  - 补充资料时显示原卡。

- [ ] **Step 6: Commit** — `feat(miniapp): 油卡申请按车选卡，补充资料锁定原卡`

---

### Task 8: 文档

**Files:**
- Modify：
  - `doc/开发记录.md`：末尾追加一条，写明目的、改动、迁移、上线步骤；只追加，不新建日志文件。
  - `doc/UI设计文档.md`：第 8 节（约 1484–1510 行）。把油卡绑定员工的描述改为车卡绑定，更新 API 列表（含 bind/unbind/vehicle-bindings）。
  - `doc/guide/04-现场操作员手册.md`：第 33 行，"本人绑定油卡"改为"所选车辆名下的油卡；车辆未配卡时联系办公室"。
  - `doc/guide/05-财务手册.md`：油卡处理工作台一节之后，加一段"车辆配卡"说明（在车辆油卡档案里绑定、转移、解绑，记录可查）。

- [ ] **Step 1: 写文档**
- [ ] **Step 2: Commit** — `docs: 油卡跟车走的开发记录、UI 设计与操作手册更新`

---

### Task 9: 上线

**不能由子代理执行。每个对外动作都要先征得 owner 同意。**

owner 2026-10-25 决定：上线不写初始绑定，所有卡保持未绑定，办公室 2026-10-26（周一）在档案页手动绑卡。原计划的"拿到对应关系""写入初始绑定""对照核对"三步取消。

- [ ] **Step 1: 确认上线时间**

  上线后到办公室绑完卡之前，所有车都申请不了。向 owner 确认推送时间，并提醒办公室周一要先绑卡。

- [ ] **Step 2: 合并前全量检查**

  在功能分支上依次运行：
  - api：`npm run typecheck && npm test && npm run lint`
  - web：`npm run typecheck && npm test && npm run build`
  - miniapp：`npm run typecheck`

  全部通过才继续。另外查一下 cloudflarestatus（记忆 `deploy-skew-and-cf-incident-check`）。

- [ ] **Step 3: 生产预检**

  执行 `npx wrangler d1 execute hybcdg-prod-db --remote --env prod --json --command "SELECT COUNT(*) AS n FROM fuel_card_vehicle_binding"`，Expected：`n = 0`。不是 0 就停下来报告。

- [ ] **Step 4: 应用迁移**

  执行 `cd packages/api && npx wrangler d1 migrations apply hybcdg-prod-db --remote --env prod`，Expected：0090 applied。

- [ ] **Step 5: 推送**

  征得 owner 同意后，合并到 main 并 push。约 90 秒后访问 `https://api.hybcdg.com/api/v1/system/health`，Expected：`ok=true`。

- [ ] **Step 6: 上线后只读核对**

  执行 `SELECT COUNT(*) AS n FROM fuel_card_vehicle_binding`，Expected：`n = 0`（等办公室绑卡）。确认 `GET /api/v1/fleet/fuel-cards` 能返回 10 张卡，且 `vehicle_plate_no` 都为 null。

- [ ] **Step 7: 办公室绑卡后复核（2026-10-26 之后）**

  owner 告知办公室绑完后，只读查询每张卡的当前车辆，并列出仍未绑定的卡和没有卡的车，交给 owner 核对。

- [ ] **Step 8: 小程序上传与提审**

  告知 owner 上传、提审小程序。过渡期旧版小程序仍可申请：选错组合时，后端会返回中文错误。
