# 库房重做 阶段 3：小程序和通知 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 李震用手机完成发货、返库、入库、派活、确认；项目负责人用手机出清单、看项目在场；该知道的人收到企微卡片，点开直达小程序里对应的页面。

**Architecture:** 小程序主包只留库房 tab 页，其余 9 个页面放进新分包 `packageWarehouse`；页面逻辑写成分包里的纯函数模块并配 node 测试，页面本身只做取数和 `setData`。后端不加新业务，只加三样：首页聚合接口、任务详情带设备位置、通知。通知是一个新事件 `WAREHOUSE_NOTICE`：写接口成功后发进现有事件队列，队列消费者再查库、定收件人、发企微模板卡片；由库房设置里的开关控制，默认关，新版小程序发布后再打开。

**Tech Stack:** 原生企微小程序（JS + 已内置的 TDesign）、Hono + D1 + Queue（`packages/api`）、Vue 3（只改设置页一个开关）、Vitest、`node:sqlite` 测试夹具、小程序的 node assert 测试脚本。

**Spec:** `docs/superpowers/specs/2026-11-11-warehouse-rebuild-design.md`（4 操作步数目标、7、9、10、13、14、15 的阶段 3、18、21）

**前置：** 阶段 1、2 已上线（迁移 0095、0096，PR #24、#25）。两个阶段的台账 `.superpowers/sdd/2026-11-11-warehouse-phase{1-core,2-kits}/progress.md` 里有全部 Ruling，本计划沿用其中的约定（`guarded`、`handleWarehouseError`、`queryIn`、批内断言、`client_request_id`）。

## Global Constraints

- 本阶段**没有数据库迁移**。通知开关存在 `system_config`（和另外两个库房设置一样），通知走现有事件队列。
- 页面路径写进企微卡片后不能再改。本阶段定下的路径见下面"页面路径"表，实施中不得改名。
- 分包独用的模块放 `packageWarehouse/common/`，不放 `utils/`：主包紧贴 2MB 上限，分包页面 `require` 主包文件会把它算进主包。主包只新增 `utils/wh-home-view.js`、`utils/wh-scan.js`，并从 `utils/attachment-open.js` 多导出两个已有函数。
- 小程序里所有"忙"状态用 `try/finally` 复位；列表下标判断用 `Number.isInteger`，不用 `|| -1`、`|| 0`。
- 图片地址一律经 `signAttachmentUrl(key, resolveAttachmentUrl("", key))` 取签名地址，不直接拼相对路径。
- 库房单的 `client_request_id` 在录单页打开时生成一次，提交失败重试用同一个，提交成功后才换新的。
- 长列表选择用 `hy-search-picker`（物资用它的远程模式 `remote` + `bind:search`；人员、模板、类别用本地模式）。项目用 `hy-project-picker`。
- 接口失败一律 `wx.showToast({ title: <后端的中文 message>, icon: "none" })`；`request` 抛出的 `error.message` 已经是中文。
- `t-button` 的样式只写在它自己那层的 class 上；两个按钮并排用全局的 `.btn-fill`。不要给 `app.json` 加回 `"style": "v2"`。
- 界面上不出现英文枚举值和数字 ID。状态、类型的中文和 Web 一致，照抄 `packages/web/src/views/wh/**` 里对应的常量。
- 通知发不出去不影响业务写入：`publishWarehouseNotice` 永不抛出。不通知操作人自己。
- 后端新接口沿用阶段 1、2 的约定：返回 `{ success, data }`，`message` 中文，路由用 `guarded()`，挂进 `mountWarehouseRoutes`。
- 单个路由、service、页面 JS、视图模块文件不超过 400 行。
- 用到 `node:sqlite` 的后端测试包在 `describe.skipIf(!hasSqlite)` 里，推送前本地必须跑。小程序测试不在 CI 里，只能本地跑：`cd packages/miniapp && npm run test:wh`。
- 提交信息格式 `<type>: <description>`，不加 AI 署名。
- 分支 `feat/warehouse-phase3-miniapp`，从最新的 `origin/main` 切出，开 PR，不直接推 `main`。
- 本阶段不做：盘点页（阶段 5）、资料页以及设备页和任务里的资料入口（阶段 4）、每日摘要（阶段 5）、微盘镜像暂停通知（阶段 4）、MCP 工具改造（阶段 5）。
- 留在 Web 上、手机不做的：设备和物资主数据的新建和导入、模板维护、冲销、报废、库房设置。

**页面路径（定下后不能改）：**

| 路径 | 参数 | 用途 | 任务 |
|---|---|---|---|
| `pages/warehouse/index` | 无 | 库房 tab 页 | 5 |
| `packageWarehouse/device/index` | `id` | 设备卡片 | 6 |
| `packageWarehouse/task-list/index` | `tab=mine\|confirm\|unassigned\|all` | 任务列表 | 7 |
| `packageWarehouse/task-detail/index` | `id` | 任务详情 | 7、8 |
| `packageWarehouse/task-new/index` | `deviceId`（可选） | 新建任务 | 8 |
| `packageWarehouse/kit-list/index` | `status`、`projectId`、`create=1`（都可选） | 清单列表、新建清单 | 9 |
| `packageWarehouse/kit/index` | `id` | 清单详情 | 9 |
| `packageWarehouse/ship/index` | `type=out\|back\|transfer\|in`，可选 `projectId`、`kitId`、`deviceId` | 发货、返库、转场、入库 | 10 |
| `packageWarehouse/project/index` | `projectId` | 项目在场 | 11 |
| `packageWarehouse/material/index` | `low=1`（可选） | 库存 | 11 |

以后的阶段再加：`packageWarehouse/stocktake/index`（阶段 5）、`docs/index`、`doc-view/index`、`doc-upload/index`（阶段 4）。

**设计稿没写死、本计划定下的地方（实施时如有不同意见，先改这里）：**

1. 分包多了设计稿没列的三个页面：`kit-list/index`（库管跨项目看待确认和已确认的清单、新建清单）、`project/index`（项目在场，也是发货、返库、转场卡片点开的页面）、`task-new/index`（手机上建任务）。
2. 分包独用的视图模块放 `packageWarehouse/common/wh-*-view.js`，不是设计稿写的 `utils/wh-*-view.js`（原因见上面第三条约束）。
3. 通知有总开关 `warehouse.notify_enabled`，默认关。卡片点开的页面只在新版小程序里有，所以要等新版发布后由经理在 Web 设置页打开。
4. "全体库管"指 `warehouse_member` 里角色是库管的人；超管不在名单里就不收。名单为空时不发，不报错。
5. 不通知操作人自己：库管给自己派的任务、自己提交自己确认的清单都不发卡片。
6. 一张返库单生成多个检查任务时，同一个执行人只收一张卡片，写"N 个待办"，点开是"我的任务"。
7. 冲销发货、返库、转场单时，给这张单的项目负责人发一张"库房单已冲销"，否则他们手里的信息是错的。
8. 首页用一个聚合接口 `GET /warehouse/home`，一次返回权限、我的任务、我的项目、库管的待办数。
9. 旧接口占位（`warehouse-legacy-stub.ts`）本阶段只删小程序用的路径，`GET /warehouse/stock-order` 留到阶段 5（已安装的 MCP 的 `list_stock_orders` 还在调）。而且要等新版小程序发布之后才删，所以是单独的 Task 14，另开 PR。

**手机上谁能做什么（后端已经按设计稿第 9 节校验，这里只是页面上显示哪些按钮）：**

| 动作 | 库管 | 经理 | 现场负责人 | 执行人 | 其他人 |
|---|---|---|---|---|---|
| 扫码看设备、看任务、看清单、看项目在场、查库存 | 是 | 是 | 是 | 是 | 是 |
| 发货、返库、转场、入库 | 是 | 否 | 否 | 否 | 否 |
| 建任务、派工、确认、退回、取消 | 是 | 否 | 否 | 否 | 否 |
| 传照片、提交任务 | 是 | 否 | 否 | 派给自己的 | 否 |
| 建清单、改、提交、作废 | 是 | 是 | 自己负责的项目 | 否 | 否 |
| 确认清单、关闭清单、按清单发货 | 是 | 否 | 否 | 否 | 否 |

## Review Focus

1. **扫到的不是设备码、设备码查不到、扫码时断网。** 三种情况各有一句中文提示，扫码按钮恢复可点；连续扫码时不会把同一台设备加两次。Task 4、10。
2. **录单页连点两次提交，或者提交超时后再点一次。** 只生成一张库房单（同一个 `client_request_id`），第二次提示成功并回到上一页，不会多扣库存。Task 10。
3. **通知发不出去（bridge 不通、企微返回错误）。** 业务接口照常返回成功，数据已经写入；队列消息重试，`event_log` 里留一行 `warehouse_notice_failed`。Task 2、3。
4. **没人可通知：开关关着、库管名单为空、项目没有负责人、收件人就是操作人。** 不发、不报错、消息正常确认，不会一直重试。Task 2。
5. **两个人同时改同一份清单，或任务在别处已经被处理。** 手机上提示"数据已变化，请刷新后重试"并自动重新加载，不覆盖别人的改动，页面不卡在忙碌状态。Task 7、9。

---

### Task 1: 首页聚合接口，任务详情带设备位置

**Files:**
- Create: `packages/api/src/services/warehouse/home.ts`
- Modify: `packages/api/src/services/warehouse/overview.ts`（拆出 `getOverviewCounts`）
- Modify: `packages/api/src/services/warehouse/task-query.ts`（`SELECT_TASK` 多三列，并导出）
- Modify: `packages/api/src/services/warehouse/project-ledger.ts`（`ProjectLedger` 多 `project_manager_userid`）
- Modify: `packages/api/src/routes/wh-settings.ts`（加 `GET /home`）
- Test: `packages/api/test/warehouse-home.test.ts`

**Interfaces:**
- Produces（`overview.ts`）：`type OverviewCounts = Omit<WarehouseOverview, "recent_docs">`，`getOverviewCounts(env: Env): Promise<OverviewCounts>`；`getWarehouseOverview` 改成"counts + 最近 10 张单"，返回值不变。
- Produces（`home.ts`）：

```ts
export interface HomeProject {
  project_id: number;
  project_name: string;
  devices_on_site: number;
  /** 在场数大于 0 的周转件有几种 */
  materials_on_site: number;
  /** 草稿和待确认的清单数 */
  kits_open: number;
  kits_confirmed: number;
}
export interface WarehouseHome {
  caps: WarehouseCapabilities;
  my_tasks: { todo: number; items: TaskRow[] };
  my_projects: HomeProject[];
  keeper: OverviewCounts | null;
}
export const getWarehouseHome: (env: Env, auth: AuthTokenPayload) => Promise<WarehouseHome>;
```

- Produces（`task-query.ts`）：`TaskRow` 多 `device_location: DeviceLocation | null`、`device_project_name: string | null`、`device_storage_note: string | null`（`LEFT JOIN project dp ON dp.id = d.current_project_id`）。
- Produces（`project-ledger.ts`）：`ProjectLedger` 多 `project_manager_userid: string | null`（小程序的项目页用它判断现场负责人能不能给这个项目建清单）。
- 路由：`GET /api/v1/warehouse/home`，`requireRoles(ALL_ROLES)`。

规则：
- `my_tasks`：执行人是我、状态 `todo`。`todo` 是总数；`items` 最多 3 条，有期限的在前、期限早的在前，再按 id。
- `my_projects`：`project.manager_userid` 是我，并且（状态不是 `archived`，或者还有设备或周转件在场）。按项目名排序，最多 50 个。
- `keeper`：`caps.is_keeper` 为真时是 `getOverviewCounts` 的结果，否则 `null`。

- [ ] **Step 1: 写失败的测试**

```ts
describe.skipIf(!hasSqlite)("warehouse home", () => {
  it("普通员工只看到自己的待办，keeper 为 null", async () => {
    const h = createWarehouseHarness();
    h.seed.task({ assignee_userid: "wang", due_date: "2026-11-20" });
    h.seed.task({ assignee_userid: "wang", due_date: "2026-11-15" });
    h.seed.task({ assignee_userid: "wang", due_date: null });
    h.seed.task({ assignee_userid: "wang", due_date: "2026-11-18" });
    h.seed.task({ assignee_userid: "wang", status: "done" });
    h.seed.task({ assignee_userid: "other" });
    const home = await getWarehouseHome(h.env, authPayload("wang", ["operator"]));
    expect(home.keeper).toBeNull();
    expect(home.my_tasks.todo).toBe(4);
    expect(home.my_tasks.items.map((t) => t.due_date)).toEqual(["2026-11-15", "2026-11-18", "2026-11-20"]);
    expect(home.my_projects).toEqual([]);
  });

  it("库管带待办数", async () => {
    const h = createWarehouseHarness();
    h.seed.member("lz", "keeper");
    h.seed.task({ status: "submitted" });
    h.seed.kit({ status: "submitted", confirmed_at: null });
    const home = await getWarehouseHome(h.env, authPayload("lz", ["operator"]));
    expect(home.keeper).toMatchObject({ tasks_to_confirm: 1, kits_to_confirm: 1 });
    expect(home.keeper).not.toHaveProperty("recent_docs");
  });

  it("我的项目带在场数和清单数，归档且无在场的不出现", async () => {
    const h = createWarehouseHarness();
    h.seed.member("lz", "keeper");
    const mine = h.seed.project("一号工程", "zhang");
    const archivedEmpty = h.seed.project("旧工程", "zhang");
    const archivedBusy = h.seed.project("收尾工程", "zhang");
    h.database.prepare("UPDATE project SET status = 'archived' WHERE id IN (?, ?)").run(archivedEmpty, archivedBusy);
    h.seed.project("别人的工程", "li");
    const pipe = h.seed.material({ kind: "turnover", quantity: 10 });
    const device = h.seed.device();
    const other = h.seed.device();
    await createWhDoc(h.env, { doc_type: "out", client_request_id: "home-out-1", project_id: mine,
      device_lines: [{ device_id: device }], material_lines: [{ material_id: pipe, quantity: 4 }] }, "lz");
    await createWhDoc(h.env, { doc_type: "out", client_request_id: "home-out-2", project_id: archivedBusy,
      device_lines: [{ device_id: other }], material_lines: [] }, "lz");
    h.seed.kit({ project_id: mine, status: "draft", confirmed_at: null });
    h.seed.kit({ project_id: mine });
    const home = await getWarehouseHome(h.env, authPayload("zhang", ["site_manager"]));
    expect(home.my_projects.map((p) => p.project_name)).toEqual(["一号工程", "收尾工程"]);
    expect(home.my_projects[0]).toMatchObject({ devices_on_site: 1, materials_on_site: 1, kits_open: 1, kits_confirmed: 1 });
  });

  it("任务详情带设备位置", async () => {
    const h = createWarehouseHarness();
    const project = h.seed.project("一号工程");
    const device = h.seed.device({ location: "project", current_project_id: project, storage_note: "A 区" });
    const taskId = h.seed.task({ device_id: device });
    const task = await getTask(h.env, taskId);
    expect(task).toMatchObject({ device_location: "project", device_project_name: "一号工程", device_storage_note: "A 区" });
  });

  it("项目物资带项目负责人", async () => {
    const h = createWarehouseHarness();
    const project = h.seed.project("一号工程", "zhang");
    expect((await getProjectLedger(h.env, project)).project_manager_userid).toBe("zhang");
  });
});
```

再加一条路由用例：`callWh(h, mountWarehouseRoutes, "GET", "/warehouse/home")` 返回 200 且 `body.data.caps` 存在（身份用 `vi.mock("../src/services/auth")`，写法照 `warehouse-permission-matrix.test.ts`）。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/api && npm test -- test/warehouse-home.test.ts`
Expected: FAIL，`getWarehouseHome` 不存在（找不到模块 `home`）。

- [ ] **Step 3: 实现**

`overview.ts` 把现有五个查询里除"最近的单"以外的四个移进 `getOverviewCounts`。`home.ts` 用 `Promise.all` 并行取 `getWarehouseCapabilities`、我的任务两条查询（计数、前 3 条，复用 `task-query.ts` 的 `SELECT_TASK`）、我的项目一条查询（在场设备数、在场周转件种数、两种清单数都用相关子查询；在场周转件按 `wh_doc_line` 的 `project_delta` 汇总大于 0 计）。`keeper` 取到权限后再决定查不查。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/api && npm test -- test/warehouse-home.test.ts test/warehouse-overview.test.ts test/warehouse-task.test.ts test/warehouse-project-ledger.test.ts`
Expected: PASS（后三个文件是回归）。

- [ ] **Step 5: 提交**

```bash
git add packages/api/src/services/warehouse/home.ts packages/api/src/services/warehouse/overview.ts packages/api/src/services/warehouse/task-query.ts packages/api/src/services/warehouse/project-ledger.ts packages/api/src/routes/wh-settings.ts packages/api/test/warehouse-home.test.ts
git commit -m "feat: 库房首页聚合接口，任务详情带设备位置"
```

---

### Task 2: 通知的事件、开关、收件人和卡片

**Files:**
- Modify: `packages/api/src/services/event-bus.ts`（`domainEventTypes` 加 `"WAREHOUSE_NOTICE"`）
- Modify: `packages/api/src/services/warehouse/settings.ts`（加 `notify_enabled`）
- Modify: `packages/api/src/services/wecom-approval-push.ts`（导出 `resolveWeComLinkTargets`）
- Create: `packages/api/src/services/warehouse/notice.ts`（类型、发布、解析）
- Create: `packages/api/src/services/warehouse/notice-cards.ts`（纯函数：卡片、收件人）
- Create: `packages/api/src/services/warehouse/notice-deliver.ts`（查库、发送）
- Modify: `packages/api/src/queue-handler.ts`（加一个 `case`）
- Test: `packages/api/test/warehouse-notice-cards.test.ts`、`packages/api/test/warehouse-notice-deliver.test.ts`、`packages/api/src/queue-handler-warehouse-notice.test.ts`

**Interfaces:**
- Produces（`settings.ts`）：`WarehouseSettings` 多 `notify_enabled: boolean`，键 `warehouse.notify_enabled`，存 `"1"`/`"0"`，没有记录时是 `false`；`saveWarehouseSettings` 接受布尔值，其他类型报"通知开关只能是开或关"。
- Produces（`wecom-approval-push.ts`）：`resolveWeComLinkTargets(env: Env): Promise<{ miniAppId: string | null; webBaseUrl: string | null }>`。`webBaseUrl` 取 `resolveRouteConfig` 的 `webBaseUrl`，没有时退到 `WECHAT_REDIRECT_URI` 的 origin，都没有是 `null`；去掉结尾的 `/`。
- Produces（`notice.ts`）：

```ts
export type WarehouseNotice =
  | { kind: "kit_submitted" | "kit_confirmed"; kit_id: number }
  | { kind: "tasks_assigned"; task_ids: number[] }
  | { kind: "task_sent_back" | "task_submitted" | "repair_created"; task_id: number }
  | { kind: "doc_posted"; doc_id: number };
export type QueuedWarehouseNotice = WarehouseNotice & { actor_userid: string };

/** 发进事件队列。永不抛出：失败只记 console.error。 */
export const publishWarehouseNotice: (env: Env, notice: WarehouseNotice, actorUserid: string) => Promise<void>;
/** 队列里取出来的 payload 当外部数据校验；不认识的返回 null。 */
export const parseWarehouseNotice: (payload: unknown) => QueuedWarehouseNotice | null;
```

- Produces（`notice-cards.ts`）：

```ts
export interface NoticeLinks { miniAppId: string | null; webBaseUrl: string | null }
export interface NoticeCardInput {
  title: string;
  desc: string;
  lines: { keyname: string; value: string }[];
  /** 小程序页面路径，不带开头的斜杠 */
  pagePath: string;
  /** Web 的 hash 路径，如 "/wh/kit/12" */
  webPath: string;
}
export const NOTICE_PAGES: {
  kit: (id: number) => string;        // packageWarehouse/kit/index?id=<id>
  task: (id: number) => string;       // packageWarehouse/task-detail/index?id=<id>
  myTasks: string;                    // packageWarehouse/task-list/index?tab=mine
  project: (id: number) => string;    // packageWarehouse/project/index?projectId=<id>
};
/** 两种跳转都没配时返回 null。 */
export const buildNoticeCard: (input: NoticeCardInput, links: NoticeLinks) => Record<string, unknown> | null;
/** 去掉空值、重复和操作人。 */
export const recipientsExcept: (userids: readonly (string | null)[], actor: string) => string[];
export const clip: (text: string, max: number) => string;
```

- Produces（`notice-deliver.ts`）：

```ts
export type NoticeSender = typeof sendWeComTemplateCard;
export interface NoticeDeps {
  send?: NoticeSender;
  loadNames?: () => Promise<Map<string, string>>;
  /** 默认是 resolveWeComLinkTargets */
  resolveLinks?: (env: Env) => Promise<NoticeLinks>;
}
export interface NoticeOutcome { sent: number; skipped: "disabled" | "invalid" | "no_recipient" | "no_link" | "gone" | null }
export const deliverWarehouseNotice: (env: Env, payload: unknown, deps?: NoticeDeps) => Promise<NoticeOutcome>;
```

卡片是 `text_notice`：`source.desc` 固定"库房"；`main_title.title` 最多 26 字、`main_title.desc` 最多 30 字；`horizontal_content_list` 最多 6 行，`keyname` 最多 5 字、`value` 最多 26 字，超长用 `clip` 截断加"…"。有 `miniAppId` 时 `card_action` 是 `{ type: 2, appid, pagepath }`，否则 `{ type: 1, url: webBaseUrl + "/#" + webPath }`；`jump_list` 把两种都列上（有哪个列哪个）。

各种通知的内容、收件人、页面：

| kind | 标题 | 副标题 | 明细行（keyname：value） | 收件人（都要去掉操作人） | 小程序页面 / Web 路径 |
|---|---|---|---|---|---|
| `kit_submitted` | 配套清单待确认 | 项目名 | 清单：`<kit_no> <title>`；提交人：姓名；行数：`<n> 行` | 库管名单 | `kit(id)` / `/wh/kit/<id>` |
| `kit_confirmed` | 配套清单已确认 | 项目名 | 清单：同上；确认人：姓名 | `submitted_by_userid` | 同上 |
| `tasks_assigned`，某执行人 1 个 | `库房任务：<任务标题>` | `<设备编号> <设备名>`，没有设备写"无设备" | 类型；期限（没有写"无"）；照片：`至少 <n> 张`（0 张不列） | 该任务现在的执行人 | `task(id)` / `/wh/task` |
| `tasks_assigned`，某执行人多个 | `库房任务：<n> 个待办` | 前 3 个设备编号，用"、"连接 | 最早期限 | 同上 | `myTasks` / `/wh/task` |
| `task_sent_back` | 任务被退回，请补充 | 任务标题 | 要求：`review_note`；设备 | 执行人 | `task(id)` / `/wh/task` |
| `task_submitted` | 库房任务待确认 | 任务标题 | 执行人：姓名；结果：合格/不合格（检查任务才列）；设备 | 库管名单 | 同上 |
| `repair_created` | 检查不合格，已生成维修任务 | `<设备编号> <设备名>` | 任务：任务号；说明：`description` | 库管名单 | `task(id)` / `/wh/task` |
| `doc_posted`，`out` | 库房已发货 | 项目名 | 单号；设备：`<n> 台`；物资：`<m> 项`；经手人：姓名 | `project_id` 的负责人 | `project(项目 id)` / `/wh/kit/project/<项目 id>` |
| `doc_posted`，`back` | 项目物资已返库 | 项目名 | 单号；设备；物资；报损：`<k> 项`（有才列） | 同上 | 同上 |
| `doc_posted`，`transfer` | 设备物资转场 | `<来源项目> → <目的项目>` | 单号；设备；物资 | 两个项目的负责人，各发一张，各自打开自己的项目页 | 同上 |
| `doc_posted`，冲销单（`reverses_doc_id` 不为空，原单是上面三种） | 库房单已冲销 | 项目名 | 原单：原单号；冲销单：单号 | 同原单类型的规则 | 同上 |

其余规则：
- `deliverWarehouseNotice` 的顺序：解析（不合法返回 `invalid`）→ 开关关着返回 `disabled` → 查业务行（查不到返回 `gone`）→ 定收件人（空返回 `no_recipient`）→ 取跳转（`buildNoticeCard` 返回 `null` 时返回 `no_link`）→ 逐张发送，`touser` 用 `|` 连接。这些"不发"的情况都**不抛出**，消息会被正常确认。
- `tasks_assigned` 只算现在状态是 `todo`、有执行人的任务，按执行人分组，每人一张。
- `doc_posted` 遇到其他类型的单（入库、期初、调账、报废）返回 `no_recipient`。
- 发送失败：先往 `event_log` 写一行（`event_type` 是 `warehouse_notice_failed`，`event_source` 是 `warehouse-notice`，payload 带 `kind`、业务 id、错误文案），再把错误抛出去，让队列重试（`max_retries = 3`）。企微的重复消息检查（`sendWeComTemplateCard` 默认开）会挡住重试造成的重复卡片。
- 姓名：`deps.loadNames` 默认从 `getWeComContactBook(env)` 取 userid → 姓名，取不到（抛错）就用空表，卡片上显示 userid。
- `queue-handler.ts`：`case "WAREHOUSE_NOTICE": await deliverWarehouseNotice(env, event.payload); break;`，不包 try/catch，抛出时由外层的 `msg.retry()` 处理。

- [ ] **Step 1: 写卡片纯函数的失败测试**（`warehouse-notice-cards.test.ts`）

```ts
const input = { title: "配套清单待确认", desc: "一号工程", lines: [{ keyname: "清单", value: "PT-20261112-001 主清单" }],
  pagePath: NOTICE_PAGES.kit(12), webPath: "/wh/kit/12" };

it("有小程序时点卡片进小程序，Web 也列在跳转里", () => {
  const card = buildNoticeCard(input, { miniAppId: "wx1", webBaseUrl: "https://web.hybcdg.com" });
  expect(card).toMatchObject({
    card_type: "text_notice",
    source: { desc: "库房" },
    main_title: { title: "配套清单待确认", desc: "一号工程" },
    card_action: { type: 2, appid: "wx1", pagepath: "packageWarehouse/kit/index?id=12" }
  });
  expect(card?.jump_list).toHaveLength(2);
});
it("没配小程序时进 Web 的 hash 路径", () => {
  const card = buildNoticeCard(input, { miniAppId: null, webBaseUrl: "https://web.hybcdg.com" });
  expect(card?.card_action).toEqual({ type: 1, url: "https://web.hybcdg.com/#/wh/kit/12" });
});
it("两种都没配返回 null", () => {
  expect(buildNoticeCard(input, { miniAppId: null, webBaseUrl: null })).toBeNull();
});
it("超长的字段被截断", () => {
  const card = buildNoticeCard({ ...input, title: "长".repeat(40), lines: [{ keyname: "要求要求要求", value: "很".repeat(60) }] },
    { miniAppId: "wx1", webBaseUrl: null });
  const main = card?.main_title as { title: string };
  const line = (card?.horizontal_content_list as { keyname: string; value: string }[])[0];
  expect(main.title).toHaveLength(26);
  expect(main.title.endsWith("…")).toBe(true);
  expect(line.keyname).toHaveLength(5);
  expect(line.value).toHaveLength(26);
});
it("收件人去空、去重、去掉操作人", () => {
  expect(recipientsExcept(["lz", null, "wang", "lz", "zhang"], "zhang")).toEqual(["lz", "wang"]);
});
it("页面路径是定死的", () => {
  expect(NOTICE_PAGES.task(7)).toBe("packageWarehouse/task-detail/index?id=7");
  expect(NOTICE_PAGES.myTasks).toBe("packageWarehouse/task-list/index?tab=mine");
  expect(NOTICE_PAGES.project(3)).toBe("packageWarehouse/project/index?projectId=3");
});
```

- [ ] **Step 2: 写发送的失败测试**（`warehouse-notice-deliver.test.ts`，`describe.skipIf(!hasSqlite)`）

公共准备：`enable(h)` 往 `system_config` 写 `warehouse.notify_enabled = "1"`（调 `saveWarehouseSettings(h.env, { notify_enabled: true }, "seed")`）；`const sent = []; const send = async (_env, input) => { sent.push(input); return { msgid: "m", invaliduser: null, unlicenseduser: null }; }`；`const deps = { send, loadNames: async () => new Map([["lz", "李震"], ["zhang", "张工"]]), resolveLinks: async () => ({ miniAppId: "wx-test", webBaseUrl: null }) }`。

每条用例一个断言主题：

1. 开关没开：`deliverWarehouseNotice(h.env, { kind: "kit_submitted", kit_id, actor_userid: "zhang" }, deps)` 返回 `{ sent: 0, skipped: "disabled" }`，`sent` 为空。
2. `kit_submitted`：两个库管 `lz`、`k2`，操作人 `zhang` → 一次发送，`touser === "lz|k2"`，`card_action.pagepath === NOTICE_PAGES.kit(kitId)`，标题"配套清单待确认"，明细里有"提交人：张工"。
3. `kit_confirmed`，提交人就是操作人 → `{ sent: 0, skipped: "no_recipient" }`。
4. `tasks_assigned`，三个任务都派给 `wang` → 一次发送，标题"库房任务：3 个待办"，`pagepath === NOTICE_PAGES.myTasks`；其中一个任务改成 `done` 后再发 → 标题变"2 个待办"。
5. `tasks_assigned`，两个任务分属 `wang`、`zhao` → 两次发送，各自 `pagepath` 是自己那个任务的详情。
6. `tasks_assigned`，任务派给操作人自己 → `no_recipient`。
7. `task_submitted`，库管名单为空 → `no_recipient`，不抛出。
8. `repair_created` → 发给库管，副标题是设备编号加名称，明细有任务号。
9. `doc_posted`，转场单，两个项目负责人 `zhang`、`li`，操作人 `lz` → 两次发送，`touser` 各是一人，`pagepath` 各是自己的项目；来源项目没有负责人时只发一次。
10. `doc_posted`，入库单 → `no_recipient`。
11. `doc_posted`，发货单的冲销单 → 标题"库房单已冲销"，明细有原单号。
12. `send` 抛错 → `deliverWarehouseNotice` reject，`event_log` 里有一行 `warehouse_notice_failed` 且 payload 含 `"kind":"kit_submitted"`。
13. payload 是 `{ kind: "nope" }` 或 `null` → `{ sent: 0, skipped: "invalid" }`。
14. 业务行不存在（`kit_id: 99999`）→ `skipped: "gone"`。
15. `resolveLinks` 返回两个都是 `null` → `skipped: "no_link"`，没有发送。
16. 发布失败不抛出：`publishWarehouseNotice({ DB: { prepare() { throw new Error("db down"); } }, EVENT_QUEUE: { send: async () => { throw new Error("queue down"); } } } as unknown as Env, { kind: "kit_submitted", kit_id: 1 }, "zhang")` resolve 为 `undefined`。
17. `resolveWeComLinkTargets`：`env.WECOM_MINIAPP_APPID = "wx1"`、`env.WECHAT_REDIRECT_URI = "https://web.hybcdg.com/login/callback"` 且没配 `WECOM_APPROVAL_WEB_BASE_URL` → `{ miniAppId: "wx1", webBaseUrl: "https://web.hybcdg.com" }`；三个都没配 → 两个都是 `null`。

发货、转场、冲销的单用 `createWhDoc`、`reverseWhDoc` 真实生成，不手插行。

- [ ] **Step 3: 写队列消费者的失败测试**（`src/queue-handler-warehouse-notice.test.ts`，写法照 `src/queue-handler-single-log.test.ts` 的 `deliver` 夹具）

```ts
vi.mock("./services/warehouse/notice-deliver", () => ({ deliverWarehouseNotice: vi.fn() }));

it("发送成功就确认消息", async () => {
  vi.mocked(deliverWarehouseNotice).mockResolvedValue({ sent: 1, skipped: null });
  const result = await deliver({ type: "WAREHOUSE_NOTICE", source: "warehouse", payload: { kind: "kit_submitted", kit_id: 1, actor_userid: "a" }, timestamp: "2026-11-12T00:00:00.000Z" });
  expect(result).toEqual({ acks: 1, retries: 0 });
});
it("发送失败就重试", async () => {
  vi.mocked(deliverWarehouseNotice).mockRejectedValue(new Error("bridge down"));
  const result = await deliver({ type: "WAREHOUSE_NOTICE", source: "warehouse", payload: { kind: "kit_submitted", kit_id: 1, actor_userid: "a" }, timestamp: "2026-11-12T00:00:00.000Z" });
  expect(result).toEqual({ acks: 0, retries: 1 });
});
```

- [ ] **Step 4: 跑三个测试文件确认失败**

Run: `cd packages/api && npm test -- test/warehouse-notice-cards.test.ts test/warehouse-notice-deliver.test.ts src/queue-handler-warehouse-notice.test.ts`
Expected: FAIL，找不到 `notice-cards`、`notice-deliver`。

- [ ] **Step 5: 实现**

按上面的 Interfaces 和表格实现五个文件的改动。`publishWarehouseNotice` 用 `publishEvent(env, "WAREHOUSE_NOTICE", "warehouse", { ...notice, actor_userid })`，整个包在 `try/catch` 里。`notice-deliver.ts` 每种 `kind` 一个内部函数，返回 `{ touser: string[]; input: NoticeCardInput }[]`，主函数统一建卡片和发送；超过 400 行就把 `doc_posted` 那部分拆到 `notice-doc.ts`。

- [ ] **Step 6: 跑测试确认通过，再跑类型检查**

Run: `cd packages/api && npm test -- test/warehouse-notice-cards.test.ts test/warehouse-notice-deliver.test.ts src/queue-handler-warehouse-notice.test.ts src/queue-handler-single-log.test.ts && npm run typecheck`
Expected: PASS，类型检查无错误。

- [ ] **Step 7: 提交**

```bash
git add packages/api/src/services/event-bus.ts packages/api/src/services/warehouse/settings.ts packages/api/src/services/wecom-approval-push.ts packages/api/src/services/warehouse/notice.ts packages/api/src/services/warehouse/notice-cards.ts packages/api/src/services/warehouse/notice-deliver.ts packages/api/src/queue-handler.ts packages/api/test/warehouse-notice-cards.test.ts packages/api/test/warehouse-notice-deliver.test.ts packages/api/src/queue-handler-warehouse-notice.test.ts
git commit -m "feat: 库房企微通知的事件、收件人和卡片"
```

---

### Task 3: 写接口接上通知，Web 设置页加开关

**Files:**
- Modify: `packages/api/src/routes/wh-kit.ts`、`packages/api/src/routes/wh-task.ts`、`packages/api/src/routes/wh-doc.ts`
- Modify: `packages/web/src/api/wh/types.ts`（设置类型加 `notify_enabled`）、`packages/web/src/views/wh/settings/index.vue`（加开关）
- Test: `packages/api/test/warehouse-notice-routes.test.ts`

**Interfaces:**
- Consumes: `publishWarehouseNotice(env, notice, actorUserid)`（Task 2）。

每个写接口在 service 调用成功之后发布，发布不影响返回：

| 接口 | 条件 | 通知 |
|---|---|---|
| `POST /kit/:id/submit` | 返回的 `status` 是 `submitted` | `kit_submitted` |
| `POST /kit/:id/confirm` | 总是 | `kit_confirmed` |
| `POST /task` | 总是（没有执行人时投递端会跳过） | `tasks_assigned`，`task_ids: [新 id]` |
| `POST /task/:id/assign` | 总是 | `tasks_assigned` |
| `POST /task/:id/submit` | 返回的 `status` 是 `submitted` | `task_submitted` |
| `POST /task/:id/submit`、`/confirm` | 返回的 `followup_task_id` 不为空 | `repair_created`，`task_id` 是新生成的维修任务 |
| `POST /task/:id/send-back` | 总是 | `task_sent_back` |
| `POST /doc` | `replayed` 为假 | `doc_posted`；`created_task_ids` 不为空时再发 `tasks_assigned` |
| `POST /doc/:id/reverse` | `replayed` 为假 | `doc_posted`，`doc_id` 是冲销单 |

`wh-task.ts` 里 `keeperAction` 的回调已经拿到 `c`、`id`、返回值，在回调里发布即可，不改 `keeperAction` 的签名。

Web 设置页：在"返库检查照片数"下面加一行 `el-switch`，标签"企微通知"，说明文字"新版小程序发布后再打开。打开后，清单、任务、发货返库会给相关的人发企微卡片。"；保存走现有的 `PUT /warehouse/settings`。

- [ ] **Step 1: 写失败的测试**（`describe.skipIf(!hasSqlite)`；身份用 `vi.mock("../src/services/auth")`，写法照 `warehouse-permission-matrix.test.ts`）

辅助：`const notices = (h) => h.queued.filter((m) => m.type === "WAREHOUSE_NOTICE").map((m) => m.payload);`

1. 现场负责人提交自己项目的清单 → `notices(h)` 是 `[{ kind: "kit_submitted", kit_id, actor_userid: "zhang" }]`。
2. 库管提交清单（直接确认）→ 没有 `kit_submitted`。
3. 库管确认清单 → `kit_confirmed`。
4. 建任务、派工 → 各一条 `tasks_assigned`。
5. 执行人（不是库管）提交任务 → `task_submitted`；库管确认一个结果是不合格的检查任务 → `repair_created`，`task_id` 等于接口返回的 `followup_task_id`。
6. 退回补充 → `task_sent_back`。
7. 发货单 → `doc_posted`；同一个 `client_request_id` 再发一次（重放）→ 通知条数不变。
8. 返库单（带一台设备）→ `doc_posted` 加 `tasks_assigned`，`task_ids` 等于返回的 `created_task_ids`。
9. 冲销 → `doc_posted`，`doc_id` 是冲销单的 id。
10. 队列坏了也不影响写入：把 `h.env.EVENT_QUEUE.send` 换成抛错的函数，再发货 → 仍然 201，库存已扣。（事件日志写不进去的情况在 Task 2 第 16 条测过。）
11. `PUT /warehouse/settings` 传 `{ notify_enabled: true }`（经理身份）→ 200，`GET /warehouse/settings` 返回 `notify_enabled: true`；传 `"yes"` → 400。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/api && npm test -- test/warehouse-notice-routes.test.ts`
Expected: FAIL，`notices(h)` 为空（第 11 条在 Task 2 之后已经能过）。

- [ ] **Step 3: 实现路由里的发布**

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/api && npm test -- test/warehouse-notice-routes.test.ts test/warehouse-permission-matrix.test.ts test/warehouse-kit.test.ts test/warehouse-task.test.ts test/warehouse-doc-kit.test.ts`
Expected: PASS。

- [ ] **Step 5: 加 Web 开关并检查**

Run: `cd packages/web && npm run typecheck && npm test -- src/views/wh`
Expected: 类型检查无错误，现有用例 PASS。

- [ ] **Step 6: 提交**

```bash
git add packages/api/src/routes/wh-kit.ts packages/api/src/routes/wh-task.ts packages/api/src/routes/wh-doc.ts packages/api/test/warehouse-notice-routes.test.ts packages/web/src/api/wh/types.ts packages/web/src/views/wh/settings/index.vue
git commit -m "feat: 清单、任务、库房单写入后发企微通知，设置页加通知开关"
```

---

### Task 4: 小程序地基：公共模块、扫码、测试夹具

**Files:**
- Create: `packages/miniapp/packageWarehouse/common/wh-api.js`
- Create: `packages/miniapp/packageWarehouse/common/wh-labels.js`
- Create: `packages/miniapp/packageWarehouse/common/wh-format.js`
- Create: `packages/miniapp/packageWarehouse/common/wh-test-harness.js`（只给测试用）
- Create: `packages/miniapp/utils/wh-scan.js`
- Modify: `packages/miniapp/utils/attachment-open.js`（多导出 `resolveAttachmentUrl`、`signAttachmentUrl`）
- Modify: `packages/miniapp/project.config.json`（`packOptions.ignore` 加 `{ "type": "file", "value": "packageWarehouse/common/wh-test-harness.js" }`）
- Modify: `packages/miniapp/package.json`（加脚本 `test:wh`）
- Test: `packages/miniapp/utils/wh-scan.test.js`、`packages/miniapp/packageWarehouse/common/wh-format.test.js`、`packages/miniapp/packageWarehouse/common/wh-api.test.js`

**Interfaces:**
- Produces（`wh-api.js`）：
  - `whGet(path, query?) → Promise<envelope>`：`request({ method: "GET", path: "/api/v1/warehouse" + path + 查询串 })`，返回整个响应（`data`、`pagination`）。查询串跳过 `undefined`、`null`、空串，值做 `encodeURIComponent`。
  - `whSend(method, path, data?) → Promise<envelope>`。
  - `newRequestId() → string`：`<时间戳 36 进制>-<12 位随机十六进制>`，长度在 8 到 64 之间。
- Produces（`wh-labels.js`）：`TASK_KIND_LABELS`、`TASK_STATUS_LABELS`、`TASK_SYSTEM_LABELS`、`KIT_STATUS_LABELS`、`KIT_SOURCE_LABELS`、`KIT_LINE_KIND_LABELS`、`DOC_TYPE_LABELS`、`DEVICE_STATE_THEME`（设备状态 → `hy-status-chip` 的 `theme`）。中文照抄 Web 的对应常量。
- Produces（`wh-format.js`）：
  - `formatQty(value) → string`：最多 3 位小数，去掉结尾的 0；不是数字返回 `"0"`。
  - `formatTime(iso) → string`：北京时间 `MM-DD HH:mm`；空值返回 `"-"`。
  - `beijingToday() → "YYYY-MM-DD"`，`isOverdue(dueDate, today) → boolean`。
  - `deviceLocationText({ location, project_name, storage_note }) → string`：`"在库"`、`"在库 · <库位>"`、`"在项目：<项目名>"`、`"已报废"`。
  - `toQty(text) → number | null`：空串返回 `null`；不是数字、负数、超过 3 位小数返回 `NaN`。
- Produces（`utils/wh-scan.js`）：
  - `DEVICE_CODE_PREFIX = "HYBC:D:"`
  - `parseDeviceCode(text) → { ok: true, code } | { ok: false, message: "不是设备码" }`：去首尾空白；前缀不分大小写；前缀后面为空也算不是设备码。
  - `scanDevice() → Promise<device | null>`：调 `wxScanCode()`，用户取消（`errMsg` 含 `cancel`）返回 `null`；不是设备码抛 `Error("不是设备码")`；`GET /api/v1/warehouse/device/by-code/<编号>` 返回 404 时抛 `Error("没有这台设备：<编号>")`；其他错误原样抛出。
- Produces（`wh-test-harness.js`）：

```js
/**
 * 页面流程测试的夹具：真实页面代码，只替换接口、登录态、上传、扫码和 wx。
 * @param {{ page: string, profile?: object }} options  page 相对小程序根目录，如 "packageWarehouse/device/index"
 * @returns {{
 *   state: { calls: {method: string, path: string, data: any}[], navigations: string[], toasts: string[],
 *            backs: number, scans: (string|Error)[], images: string[][], uploads: string[], modalConfirm: boolean, modalInput: string },
 *   respond: (method: string, pathIncludes: string, response: object | ((call: object) => object)) => void,
 *   fail: (method: string, pathIncludes: string, message: string, statusCode?: number) => void,
 *   open: (query?: object) => Promise<object>,   // 调 onLoad(query)、onShow()，返回带 setData 的页面对象
 *   flush: () => Promise<void>
 * }}
 */
const createPageHarness = (options) => { /* ... */ };
```

夹具替换的模块：`utils/request.js`（`request`、`buildUrl`）、`utils/auth.js`（`getUserProfile`、`getToken`）、`utils/upload.js`（`uploadFileToR2` 返回 `{ key: "<category>/<文件名>" }` 并记入 `state.uploads`）、`utils/wx.js`（`wxScanCode` 依次吐出 `state.scans`，是 `Error` 就 reject；`wxChooseMediaImage` 依次吐出 `state.images`）、`utils/user-names.js`（`loadUserNameMap` 返回空表，`toUserName` 返回 userid）、`utils/attachment-open.js`（`signAttachmentUrl` 返回 `"signed:" + key`）。全局 `wx`：`navigateTo`、`redirectTo`、`navigateBack`、`showToast`、`showModal`（按 `state.modalConfirm` 回调，`editable` 时带 `content: state.modalInput`）、`showLoading`、`hideLoading`、`previewImage`、`stopPullDownRefresh`、`setNavigationBarTitle`。写法参考 `utils/workbench-page.test.js`。没有匹配的 `respond` 时，GET 返回 `{ success: true, data: [] }`。

`test:wh` 脚本：`for f in utils/wh-*.test.js packageWarehouse/common/*.test.js; do node "$f" || exit 1; done`。

- [ ] **Step 1: 写失败的测试**

`utils/wh-scan.test.js`（`require.cache` 替换 `./wx.js`、`./request.js`）：

```js
assert.deepStrictEqual(parseDeviceCode("HYBC:D:DG-1200-03"), { ok: true, code: "DG-1200-03" });
assert.deepStrictEqual(parseDeviceCode("  hybc:d:DG-1200-03 \n"), { ok: true, code: "DG-1200-03" });
assert.deepStrictEqual(parseDeviceCode("https://example.com/x"), { ok: false, message: "不是设备码" });
assert.deepStrictEqual(parseDeviceCode("HYBC:D:"), { ok: false, message: "不是设备码" });
assert.deepStrictEqual(parseDeviceCode(undefined), { ok: false, message: "不是设备码" });
// scanDevice：
// 1. 扫到设备码且查得到 → 返回设备，请求路径是 /api/v1/warehouse/device/by-code/DG-1200-03
// 2. 用户取消（reject { errMsg: "scanCode:fail cancel" }）→ 返回 null，没有发请求
// 3. 扫到普通二维码 → reject，message 是 "不是设备码"，没有发请求
// 4. 接口 404 → reject，message 是 "没有这台设备：DG-9999"
// 5. 接口网络失败（Error("网络连接失败")）→ 原样 reject
```

`wh-format.test.js`：

```js
assert.strictEqual(formatQty(3), "3");
assert.strictEqual(formatQty(2.5), "2.5");
assert.strictEqual(formatQty(1.2345), "1.235");
assert.strictEqual(formatQty("abc"), "0");
assert.strictEqual(formatTime("2026-11-12T01:05:00.000Z"), "11-12 09:05");
assert.strictEqual(formatTime(null), "-");
assert.strictEqual(isOverdue("2026-11-11", "2026-11-12"), true);
assert.strictEqual(isOverdue("2026-11-12", "2026-11-12"), false);
assert.strictEqual(isOverdue(null, "2026-11-12"), false);
assert.strictEqual(deviceLocationText({ location: "warehouse", storage_note: null }), "在库");
assert.strictEqual(deviceLocationText({ location: "warehouse", storage_note: "A 区" }), "在库 · A 区");
assert.strictEqual(deviceLocationText({ location: "project", project_name: "一号工程" }), "在项目：一号工程");
assert.strictEqual(deviceLocationText({ location: "scrapped" }), "已报废");
assert.strictEqual(toQty(""), null);
assert.strictEqual(toQty("2.5"), 2.5);
assert.ok(Number.isNaN(toQty("-1")));
assert.ok(Number.isNaN(toQty("1.2345")));
assert.ok(Number.isNaN(toQty("abc")));
```

`wh-api.test.js`：`whGet("/task", { scope: "mine", status: "", page: 1, keyword: "排泥 管" })` 的请求路径是 `/api/v1/warehouse/task?scope=mine&page=1&keyword=%E6%8E%92%E6%B3%A5%20%E7%AE%A1`；`whSend("POST", "/doc", { a: 1 })` 的 method、path、data 正确；`newRequestId()` 两次不同、长度在 8 到 64 之间。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/miniapp && node utils/wh-scan.test.js; node packageWarehouse/common/wh-format.test.js; node packageWarehouse/common/wh-api.test.js`
Expected: 三个都报 `Cannot find module`。

- [ ] **Step 3: 实现公共模块、扫码、夹具，加 `test:wh` 脚本和打包忽略项**

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/miniapp && npm run test:wh && npm run typecheck`
Expected: 三个测试文件都无输出错误地结束，`tsc` 无错误。

- [ ] **Step 5: 提交**

```bash
git add packages/miniapp/packageWarehouse/common packages/miniapp/utils/wh-scan.js packages/miniapp/utils/wh-scan.test.js packages/miniapp/utils/attachment-open.js packages/miniapp/project.config.json packages/miniapp/package.json
git commit -m "feat: 小程序库房分包的公共模块、扫码和页面测试夹具"
```

---

### Task 5: 库房 tab 页

**Files:**
- Rewrite: `packages/miniapp/pages/warehouse/index.js`、`index.wxml`、`index.wxss`、`index.json`
- Create: `packages/miniapp/utils/wh-home-view.js`
- Test: `packages/miniapp/utils/wh-home-view.test.js`、`packages/miniapp/utils/wh-home-page.test.js`

**Interfaces:**
- Consumes: `GET /api/v1/warehouse/home`（Task 1）、`scanDevice()`（Task 4）、`GET /api/v1/warehouse/device?keyword=&pageSize=10`。tab 页在主包，直接用 `utils/request.js`，不引分包的 `wh-api.js`。
- Produces（`wh-home-view.js`）：

```js
/**
 * @param {object} home  GET /warehouse/home 的 data
 * @returns {{
 *   myTasks: { count: number, items: { id, title, deviceText, dueText, overdue }[] },
 *   projects: { projectId, name, summary }[],          // summary 如 "设备 2 台 · 周转件 5 种 · 清单 1 份待确认"
 *   showProjects: boolean,                             // 有我负责的项目，或者有建清单的权限且不是库管
 *   tiles: { key, label, count, url }[],               // 只有库管有；count 为 0 的也显示
 *   actions: { key, label, url }[]                     // 只有库管有
 * }}
 */
const buildHomeView = (home, today) => { /* ... */ };
```

库管的 `tiles`（顺序固定）：待确认清单 → `/packageWarehouse/kit-list/index?status=submitted`；待确认任务 → `/packageWarehouse/task-list/index?tab=confirm`；待派工 → `…/task-list/index?tab=unassigned`；超期任务 → `…/task-list/index?tab=all`；低库存 → `/packageWarehouse/material/index?low=1`。
库管的 `actions`：按清单发货 → `/packageWarehouse/kit-list/index?status=confirmed`；直接发货 → `/packageWarehouse/ship/index?type=out`；项目返库 → `…/ship/index?type=back`；转场 → `…/ship/index?type=transfer`；入库 → `…/ship/index?type=in`；查库存 → `/packageWarehouse/material/index`；全部任务 → `…/task-list/index?tab=all`。
所有人都有：扫一扫；搜设备的输入框；我的任务（点一条进 `…/task-detail/index?id=`，点"全部"进 `…/task-list/index?tab=mine`）。项目行点开进 `/packageWarehouse/project/index?projectId=`。

页面行为：`onShow` 加载；下拉刷新；加载失败显示一行"加载失败，下拉重试"并提示后端的话，原有内容保留；扫码结果进 `/packageWarehouse/device/index?id=<id>`；搜索框输入后停 300ms 查设备，结果列在输入框下面（编号、名称、状态），点一条进设备页，清空输入收起列表。

- [ ] **Step 1: 写视图模块的失败测试**

```js
const base = { caps: { is_keeper: false, can_create_kit: false }, my_tasks: { todo: 0, items: [] }, my_projects: [], keeper: null };

// 普通员工：没有 tiles、actions、项目
let view = buildHomeView(base, "2026-11-12");
assert.deepStrictEqual(view.tiles, []);
assert.deepStrictEqual(view.actions, []);
assert.strictEqual(view.showProjects, false);

// 我的任务：超期标记和设备文字
view = buildHomeView({ ...base, my_tasks: { todo: 5, items: [
  { id: 1, title: "返库检查", device_code: "DG-01", device_name: "顶管机", due_date: "2026-11-10" },
  { id: 2, title: "整理库房", device_code: null, device_name: null, due_date: null }
] } }, "2026-11-12");
assert.strictEqual(view.myTasks.count, 5);
assert.deepStrictEqual(view.myTasks.items[0], { id: 1, title: "返库检查", deviceText: "DG-01 顶管机", dueText: "11-10 到期", overdue: true });
assert.deepStrictEqual(view.myTasks.items[1], { id: 2, title: "整理库房", deviceText: "", dueText: "", overdue: false });

// 库管：五个数字、七个动作，数字是 0 也在
view = buildHomeView({ ...base, caps: { is_keeper: true, can_create_kit: true },
  keeper: { kits_to_confirm: 2, tasks_to_confirm: 0, tasks_unassigned: 1, tasks_overdue: 0, low_stock_count: 3,
            devices_pending_inspection: 0, devices_repairing: 0, devices_on_project: 0 } }, "2026-11-12");
assert.deepStrictEqual(view.tiles.map((t) => [t.label, t.count]), [["待确认清单", 2], ["待确认任务", 0], ["待派工", 1], ["超期任务", 0], ["低库存", 3]]);
assert.strictEqual(view.tiles[0].url, "/packageWarehouse/kit-list/index?status=submitted");
assert.strictEqual(view.actions.length, 7);
assert.strictEqual(view.showProjects, false);

// 现场负责人：项目摘要
view = buildHomeView({ ...base, caps: { is_keeper: false, can_create_kit: true }, my_projects: [
  { project_id: 3, project_name: "一号工程", devices_on_site: 2, materials_on_site: 5, kits_open: 1, kits_confirmed: 1 },
  { project_id: 4, project_name: "二号工程", devices_on_site: 0, materials_on_site: 0, kits_open: 0, kits_confirmed: 0 }
] }, "2026-11-12");
assert.strictEqual(view.showProjects, true);
assert.strictEqual(view.projects[0].summary, "设备 2 台 · 周转件 5 种 · 清单 1 份待确认");
assert.strictEqual(view.projects[1].summary, "还没有发货");
```

- [ ] **Step 2: 写页面流程的失败测试**（`utils/wh-home-page.test.js`，这一页在主包，照 `utils/workbench-page.test.js` 自己替换模块，不用分包的夹具）

1. 打开页面请求了 `/api/v1/warehouse/home`，`data.view.myTasks.count` 正确，`data.loading` 最后是 `false`。
2. 接口失败 → `data.loadFailed` 为真，`toasts` 里有后端的话，`data.loading` 是 `false`；再次 `onShow` 成功后 `loadFailed` 变回假。
3. 扫码成功 → 跳到 `/packageWarehouse/device/index?id=7`；扫到非设备码 → 提示"不是设备码"，没有跳转，`data.scanning` 是 `false`；用户取消 → 没有提示。
4. 搜索输入"DG" → 请求 `/api/v1/warehouse/device?keyword=DG&pageSize=10`，结果进 `data.searchResults`；点第一条 → 跳到设备页，`searchResults` 清空。

- [ ] **Step 3: 跑测试确认失败**

Run: `cd packages/miniapp && node utils/wh-home-view.test.js; node utils/wh-home-page.test.js`
Expected: 第一个报 `Cannot find module './wh-home-view'`；第二个断言失败（旧页面请求的是旧接口）。

- [ ] **Step 4: 实现视图模块和页面**

版式由实施者定，参考 `pages/index/index`（工作台）的卡片和数字格写法。旧页面里的 `defaultKpis`、`buildActions`、`buildSecondaryActions` 整段删掉。

- [ ] **Step 5: 跑测试确认通过**

Run: `cd packages/miniapp && npm run test:wh && npm run typecheck`
Expected: 全部通过。

- [ ] **Step 6: 提交**

```bash
git add packages/miniapp/pages/warehouse packages/miniapp/utils/wh-home-view.js packages/miniapp/utils/wh-home-view.test.js packages/miniapp/utils/wh-home-page.test.js
git commit -m "feat: 小程序库房首页按身份显示任务、项目和库管待办"
```

---

### Task 6: 设备卡片页

**Files:**
- Create: `packages/miniapp/packageWarehouse/device/index.js`、`index.wxml`、`index.wxss`、`index.json`
- Create: `packages/miniapp/packageWarehouse/common/wh-device-view.js`
- Modify: `packages/miniapp/app.json`（`subPackages` 加 `{ "root": "packageWarehouse", "pages": ["device/index"] }`；后面的任务往这个数组里加页面）
- Test: `packages/miniapp/packageWarehouse/common/wh-device-view.test.js`、`packages/miniapp/packageWarehouse/common/wh-device-page.test.js`

**Interfaces:**
- Consumes: `GET /warehouse/device/:id`（`DeviceDetail`：设备字段加 `state`、`state_label`、`category_name`、`project_name`、`open_tasks`、`events`、`usage_records`、`usage_meters_total`）、`GET /warehouse/me`、`POST /warehouse/doc`、`POST /warehouse/device/:id/note`（请求体 `{ summary }`，最多 300 字）、Task 4 的公共模块。
- Produces（`wh-device-view.js`）：

```js
/**
 * @returns {{
 *   header: { code, name, alias, stateLabel, stateTheme, locationText, categoryName, specText },
 *   openTasks: { id, title, kindLabel, statusLabel, blocking }[],
 *   timeline: { id, summary, timeText, operatorName }[],
 *   usage: { rows: { projectName, timeText, metersText, soilType }[], totalText },   // 没有记录时 rows 为空
 *   actions: { canReturn, canShip, canNote, canNewTask }
 * }}
 */
const buildDeviceView = (detail, caps, toUserName) => { /* ... */ };
/** 单台返库的请求体。usageMeters、soilType 是输入框里的字符串。填错返回 { error }。 */
const buildSingleReturn = (detail, { usageMeters, soilType }, requestId) => { /* ... */ };
```

按钮规则：`canReturn` = 库管且 `state` 是 `on_project`；`canShip` = 库管且 `state` 是 `available`；`canNote`、`canNewTask` = 库管且没报废。
`buildSingleReturn` 返回 `{ payload: { doc_type: "back", client_request_id, project_id: detail.current_project_id, device_lines: [{ device_id, usage_meters, soil_type }], material_lines: [] } }`；顶进距离不是非负数字时返回 `{ error: "顶进距离只填数字（米）" }`，空着就是 `null`。

页面行为：
- 参数 `id`。加载设备详情和权限。
- "返库"：弹出底部面板，两个选填输入框（顶进距离、土质）和"确认返库"。请求号在打开面板时生成，失败重试用同一个。成功后提示"已返库，已生成检查任务"并重新加载。这就是设计稿的"扫码，点返库，确认"三步。
- "发货"：跳 `/packageWarehouse/ship/index?type=out&deviceId=<id>`。
- "记事"：`wx.showModal({ editable: true })` 输入，空的不提交。
- "建任务"：跳 `/packageWarehouse/task-new/index?deviceId=<id>`。
- 未完成的任务点开进任务详情。时间线默认显示 10 条，点"展开"显示全部。

- [ ] **Step 1: 写视图模块的失败测试**

覆盖：四种 `state`（`available`、`on_project`、`pending_inspection`、`scrapped`）下库管和非库管的 `actions`；`locationText` 用 `deviceLocationText`；时间线的操作人经 `toUserName`；没有维修使用记录时 `usage.rows` 为空、`totalText` 为空串，有记录时 `totalText` 是"累计 235.5 米"；`buildSingleReturn` 的三种输入（空、`"120.5"`、`"abc"`）。每个断言写出完整的期望值，例如：

```js
const detail = { id: 7, device_code: "DG-01", name: "顶管机", alias: null, state: "on_project", state_label: "在项目",
  location: "project", project_name: "一号工程", current_project_id: 3, storage_note: null, category_name: "顶管机",
  spec: "DN1200", open_tasks: [], events: [], usage_records: [], usage_meters_total: 0 };
assert.deepStrictEqual(buildDeviceView(detail, { is_keeper: true }, (u) => u).actions,
  { canReturn: true, canShip: false, canNote: true, canNewTask: true });
assert.deepStrictEqual(buildDeviceView(detail, { is_keeper: false }, (u) => u).actions,
  { canReturn: false, canShip: false, canNote: false, canNewTask: false });
assert.deepStrictEqual(buildSingleReturn(detail, { usageMeters: "120.5", soilType: " 粉质黏土 " }, "req-12345678"),
  { payload: { doc_type: "back", client_request_id: "req-12345678", project_id: 3,
      device_lines: [{ device_id: 7, usage_meters: 120.5, soil_type: "粉质黏土" }], material_lines: [] } });
assert.deepStrictEqual(buildSingleReturn(detail, { usageMeters: "abc", soilType: "" }, "req-12345678"),
  { error: "顶进距离只填数字（米）" });
```

- [ ] **Step 2: 写页面流程的失败测试**（用 `createPageHarness({ page: "packageWarehouse/device/index" })`）

1. `open({ id: "7" })` → 请求了 `/device/7` 和 `/me`，`data.view.header.code` 是 `DG-01`。
2. 设备不存在（`fail("GET", "/device/7", "设备不存在", 404)`）→ `data.notFound` 为真，提示"设备不存在"。
3. 返库：打开面板 → 确认 → `POST /doc` 的 `data` 等于 `buildSingleReturn` 的结果；成功后重新请求 `/device/7`，`data.busy` 是 `false`。
4. 返库失败（409"数据已变化，请刷新后重试"）→ 提示这句话，`busy` 复位，面板还在；再点一次确认 → 第二次 `POST` 的 `client_request_id` 和第一次相同。
5. 非库管看不到四个按钮（`data.view.actions` 全假）。

- [ ] **Step 3: 跑测试确认失败**

Run: `cd packages/miniapp && node packageWarehouse/common/wh-device-view.test.js; node packageWarehouse/common/wh-device-page.test.js`
Expected: `Cannot find module`。

- [ ] **Step 4: 实现视图模块、页面，注册分包**

- [ ] **Step 5: 跑测试确认通过**

Run: `cd packages/miniapp && npm run test:wh && npm run typecheck`
Expected: 全部通过。

- [ ] **Step 6: 提交**

```bash
git add packages/miniapp/packageWarehouse/device packages/miniapp/packageWarehouse/common/wh-device-view.js packages/miniapp/packageWarehouse/common/wh-device-view.test.js packages/miniapp/packageWarehouse/common/wh-device-page.test.js packages/miniapp/app.json
git commit -m "feat: 小程序设备卡片页，扫码后三步返库"
```

---

### Task 7: 任务列表和任务详情（执行人这一侧）

**Files:**
- Create: `packages/miniapp/packageWarehouse/task-list/index.{js,wxml,wxss,json}`
- Create: `packages/miniapp/packageWarehouse/task-detail/index.{js,wxml,wxss,json}`
- Create: `packages/miniapp/packageWarehouse/common/wh-task-view.js`
- Modify: `packages/miniapp/app.json`（分包加 `task-list/index`、`task-detail/index`）
- Test: `packages/miniapp/packageWarehouse/common/wh-task-view.test.js`、`wh-task-list-page.test.js`、`wh-task-detail-page.test.js`（都在 `common/`）

**Interfaces:**
- Consumes: `GET /warehouse/task`（参数 `scope=mine|all`、`status`、`assigned=yes|no`、`page`、`pageSize`）、`GET /warehouse/task/:id`（`TaskRow` 加 `photos: { id, file_key, uploaded_by_userid, created_at }[]`，Task 1 之后带设备位置三列）、`POST /warehouse/task/:id/photo`（`{ file_key }`，key 必须以 `wh-task/` 开头）、`DELETE /warehouse/task/:id/photo/:photoId`、`POST /warehouse/task/:id/submit`（`{ version, result?, systems?, result_note }`，返回 `{ status, followup_task_id }`）。
- Produces（`wh-task-view.js`）：

```js
const TASK_TABS = [
  { key: "mine", label: "我的", query: { scope: "mine", status: "todo" } },
  { key: "confirm", label: "待确认", query: { status: "submitted" }, keeperOnly: true },
  { key: "unassigned", label: "待派工", query: { status: "todo", assigned: "no" }, keeperOnly: true },
  { key: "all", label: "全部", query: {}, keeperOnly: true }
];
/** 这个人能看到哪些页签；非库管只有"我的"。 */
const tabsFor = (caps) => { /* ... */ };
/** 列表行。 */
const toTaskRow = (task, today, toUserName) => ({ id, title, kindLabel, statusLabel, deviceText, assigneeName, dueText, overdue, photoText });
/**
 * 详情页。
 * actions: { canWork, canAssign, canConfirm, canSendBack, canCancel }
 *   canWork = 状态 todo 且（库管 或 执行人是我）；后四个只有库管：
 *   canAssign 状态 todo；canConfirm、canSendBack 状态 submitted；canCancel 状态 todo 或 submitted。
 */
const buildTaskDetail = (task, viewer /* { userid, caps } */, today, toUserName) => ({
  header: { taskNo, title, kindLabel, statusLabel, blocking },
  device: null | { id, code, name, locationText },
  description, reviewNote, supplementRound, assigneeName, dueText, overdue,
  photo: { count, required, missing, text },                 // text 如 "已传 2 张，还差 1 张"
  result: null | { label, note, systemsText },               // 已提交或已完成时
  needsResult, needsSystems,                                 // 检查任务要选合格或不合格；维修任务要勾系统
  actions
});
/** 提交前检查，返回第一条问题的中文，没有问题返回 ""。 */
const submitProblem = (task, photoCount, form /* { result, systems, resultNote } */) => "";
/** 提交的请求体。 */
const toSubmitPayload = (task, form) => ({ version, result_note, result?, systems? });
```

`submitProblem` 的顺序和文案：照片不够 → `还差 <n> 张照片`；检查任务没选结果 → `请选择合格或不合格`；维修任务没勾系统 → `请选择维修涉及的系统`；简报为空 → `请填写简报`。

任务列表页：页签按 `tabsFor`；参数 `tab` 决定初始页签，非库管传了别的页签也落到"我的"；每页 20 条，触底加载下一页，下拉刷新；库管右下角有"新建任务"进 `task-new/index`。

任务详情页（执行人）：
- 照片：点"拍照/选图"一次最多选 9 张（`wxChooseMediaImage({ count: 9 })`），逐张 `uploadFileToR2(path, { category: "wh-task" })` 再 `POST /photo`；某一张失败时提示"第 N 张上传失败"，已成功的保留，然后重新加载任务。缩略图地址用 `signAttachmentUrl`；点缩略图 `wx.previewImage`；自己传的照片右上角有删除（确认后 `DELETE`）。任务不是 `todo` 时不能加删。
- 提交区（`canWork` 时显示）：合格/不合格（检查任务）、系统多选（维修任务）、简报。提交成功：返回 `done` 提示"已完成"，返回 `submitted` 提示"已提交，等库管确认"；`followup_task_id` 不为空时再提示"已生成维修任务"。然后重新加载。
- 409 时提示后端的话并重新加载。

- [ ] **Step 1: 写视图模块的失败测试**

覆盖：`tabsFor`（库管 4 个、其他人 1 个）；`toTaskRow` 的超期、没有设备、没有执行人（`assigneeName` 是"未派工"）；`buildTaskDetail` 在"执行人是我 + todo""库管 + submitted""旁观者 + todo""已完成"四种情况下的 `actions`；`photo.text` 的三种情况（不要求照片、够了、还差）；`submitProblem` 的四条文案各一例和通过的一例；`toSubmitPayload` 对检查、维修、其他三种任务的字段。例如：

```js
const task = { id: 9, task_no: "KFR-20261112-001", kind: "inspection", status: "todo", title: "返库检查", blocking: 1,
  required_photo_count: 3, photo_count: 1, assignee_userid: "wang", due_date: "2026-11-14", version: 2,
  device_id: 7, device_code: "DG-01", device_name: "顶管机", device_location: "warehouse", device_storage_note: null,
  device_project_name: null, description: null, review_note: null, supplement_round: 0, result: null, result_note: null, systems_json: null, photos: [] };
const mine = buildTaskDetail(task, { userid: "wang", caps: { is_keeper: false } }, "2026-11-12", (u) => u);
assert.deepStrictEqual(mine.actions, { canWork: true, canAssign: false, canConfirm: false, canSendBack: false, canCancel: false });
assert.deepStrictEqual(mine.photo, { count: 1, required: 3, missing: 2, text: "已传 1 张，还差 2 张" });
assert.deepStrictEqual(mine.device, { id: 7, code: "DG-01", name: "顶管机", locationText: "在库" });
assert.strictEqual(submitProblem(task, 1, { result: "pass", systems: [], resultNote: "正常" }), "还差 2 张照片");
assert.strictEqual(submitProblem(task, 3, { result: "", systems: [], resultNote: "正常" }), "请选择合格或不合格");
assert.strictEqual(submitProblem(task, 3, { result: "pass", systems: [], resultNote: "  " }), "请填写简报");
assert.strictEqual(submitProblem(task, 3, { result: "pass", systems: [], resultNote: "正常" }), "");
assert.deepStrictEqual(toSubmitPayload(task, { result: "fail", systems: [], resultNote: " 漏油 " }),
  { version: 2, result: "fail", result_note: "漏油" });
```

- [ ] **Step 2: 写两个页面流程的失败测试**

列表页：
1. 非库管 `open({ tab: "confirm" })` → 只有"我的"页签，请求带 `scope=mine&status=todo`。
2. 库管切到"待派工" → 请求带 `status=todo&assigned=no`，列表被替换。
3. 触底 → 请求 `page=2`，结果追加；总数取完后再触底不再请求。
4. 加载失败 → 提示，`loading` 复位。

详情页：
1. 选 3 张图 → 3 次上传、3 次 `POST /photo`（`file_key` 以 `wh-task/` 开头），之后重新加载；`uploading` 复位。
2. 第 2 张上传失败 → 提示"第 2 张上传失败"，第 1 张的 `POST /photo` 已发出，第 3 张不再传，`uploading` 复位。
3. 照片不够时点提交 → 提示"还差 2 张照片"，没有发 `submit`。
4. 提交成功且返回 `followup_task_id` → 两句提示都有，重新加载。
5. 提交返回 409 → 提示"数据已变化，请刷新后重试"，重新加载，`busy` 复位。
6. 删除自己的照片 → 确认后发 `DELETE /task/9/photo/5`；别人的照片没有删除按钮（`data.photos[i].canDelete` 为假）。

- [ ] **Step 3: 跑测试确认失败**

Run: `cd packages/miniapp && for f in packageWarehouse/common/wh-task-*.test.js; do node "$f"; done`
Expected: `Cannot find module`。

- [ ] **Step 4: 实现视图模块和两个页面**（详情页先只做执行人这一侧；库管动作在 Task 8）

- [ ] **Step 5: 跑测试确认通过**

Run: `cd packages/miniapp && npm run test:wh && npm run typecheck`
Expected: 全部通过。

- [ ] **Step 6: 提交**

```bash
git add packages/miniapp/packageWarehouse/task-list packages/miniapp/packageWarehouse/task-detail packages/miniapp/packageWarehouse/common/wh-task-view.js packages/miniapp/packageWarehouse/common/wh-task-*.test.js packages/miniapp/app.json
git commit -m "feat: 小程序库房任务列表和任务详情，执行人拍照提交"
```

---

### Task 8: 任务详情的库管动作，新建任务

**Files:**
- Modify: `packages/miniapp/packageWarehouse/task-detail/index.{js,wxml,wxss}`
- Create: `packages/miniapp/packageWarehouse/task-new/index.{js,wxml,wxss,json}`
- Modify: `packages/miniapp/packageWarehouse/common/wh-task-view.js`（加新建任务的表单函数）
- Modify: `packages/miniapp/app.json`（分包加 `task-new/index`）
- Test: `packages/miniapp/packageWarehouse/common/wh-task-keeper-page.test.js`、`wh-task-new-page.test.js`；`wh-task-view.test.js` 补用例

**Interfaces:**
- Consumes: `POST /warehouse/task/:id/assign`（`{ version, assignee_userid }`，传 `null` 是取消派工）、`/confirm`（`{ version }`，返回 `{ followup_task_id }`）、`/send-back`（`{ version, review_note }`）、`/cancel`（`{ version, reason }`）、`POST /warehouse/task`（`{ kind, title, description?, device_id?, assignee_userid?, due_date?, required_photo_count?, blocking? }`，返回 `{ id, task_no }`）、`GET /api/v1/auth/wecom/contacts`（经 `utils/user-names.js` 的 `loadUserNameMap`）、`GET /warehouse/device?keyword=`。
- Produces（`wh-task-view.js` 新增）：

```js
const newTaskForm = (device /* 可为 null */) => ({ kind: "maintenance", title: "", description: "", deviceId, deviceText, assigneeUserid: "", dueDate: "", requiredPhotoCount: 0 });
/** 返回第一条问题，没有返回 ""：标题为空 → "请填写任务标题"；照片数不是 0 到 9 的整数 → "照片要求填 0 到 9"。 */
const newTaskProblem = (form) => "";
const toNewTaskPayload = (form) => ({ /* 空的选填项传 null */ });
/** 通讯录 → hy-search-picker 的 range（第 0 项是"不指定"）和下标对应的 userid。 */
const assigneeOptions = (nameMap) => ({ range: string[], userids: string[] });
```

任务详情页的库管动作：
- "派工"/"改派"：`hy-search-picker`（本地模式，`range` 是 `assigneeOptions` 的结果）选人后直接提交。
- "确认完成"：确认框后提交；返回 `followup_task_id` 时提示"已完成，检查不合格，已生成维修任务"，否则"已完成"。
- "退回补充"：`wx.showModal({ editable: true, title: "退回补充", placeholderText: "写清楚要补什么" })`，空的提示"请写退回要求"不提交。
- "取消任务"：同样的输入框，空的提示"请写取消原因"；阻塞任务的确认框多一句"取消后这台设备不再被这个任务卡住"。
- 四个动作成功后都重新加载；409 提示后端的话并重新加载。

新建任务页：类型（维修、保养、其他、检查，原生 `picker` 即可，只有 4 项）、标题、说明、设备（带参数 `deviceId` 时预填并锁定；否则可扫码或输入关键字搜）、执行人（`hy-search-picker`）、期限（原生日期 `picker`，不早于今天）、照片要求。提交成功后 `wx.redirectTo` 到新任务的详情页。

- [ ] **Step 1: 写失败的测试**

视图模块补：`newTaskProblem` 两条文案和通过的一例；`toNewTaskPayload` 把空的说明、设备、执行人、期限转成 `null`；`assigneeOptions` 第 0 项是"不指定"且 `userids[0] === ""`。

库管动作页面测试：
1. 派工：选第 2 项 → `POST /task/9/assign` 带 `{ version, assignee_userid }`，之后重新加载。
2. 确认完成，返回 `followup_task_id: 12` → 提示含"已生成维修任务"。
3. 退回补充输入为空 → 提示"请写退回要求"，没有请求；输入"补一张铭牌照片" → `POST /send-back` 带 `review_note`。
4. 取消任务输入原因 → `POST /cancel` 带 `reason`。
5. 任一动作返回 409 → 提示并重新加载，`busy` 复位。
6. 非库管打开同一个任务 → `data.view.actions.canAssign` 等四个都是假。

新建任务页面测试：
1. `open({ deviceId: "7" })` → 请求 `/device/7`，表单里设备已填。
2. 标题为空点提交 → 提示"请填写任务标题"，没有请求。
3. 填好提交 → `POST /task` 的 `data` 等于 `toNewTaskPayload(form)`；成功后 `redirectTo` 到 `/packageWarehouse/task-detail/index?id=<新 id>`。
4. 提交失败 → 提示，`busy` 复位，表单内容还在。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/miniapp && node packageWarehouse/common/wh-task-view.test.js; node packageWarehouse/common/wh-task-keeper-page.test.js; node packageWarehouse/common/wh-task-new-page.test.js`
Expected: 新用例断言失败或 `Cannot find module`。

- [ ] **Step 3: 实现**

任务详情页的 JS 超过 400 行时，把库管动作拆到 `packageWarehouse/task-detail/keeper-actions.js`，导出一组方法在 `Page({ ...keeperActions })` 里展开。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/miniapp && npm run test:wh && npm run typecheck`
Expected: 全部通过。

- [ ] **Step 5: 提交**

```bash
git add packages/miniapp/packageWarehouse/task-detail packages/miniapp/packageWarehouse/task-new packages/miniapp/packageWarehouse/common/wh-task-view.js packages/miniapp/packageWarehouse/common/wh-task-*.test.js packages/miniapp/app.json
git commit -m "feat: 小程序上库管派工、确认、退回、取消任务，新建任务"
```

---

### Task 9: 清单列表、新建清单、清单详情

**Files:**
- Create: `packages/miniapp/packageWarehouse/kit-list/index.{js,wxml,wxss,json}`
- Create: `packages/miniapp/packageWarehouse/kit/index.{js,wxml,wxss,json}`
- Create: `packages/miniapp/packageWarehouse/common/wh-kit-view.js`
- Modify: `packages/miniapp/app.json`（分包加 `kit-list/index`、`kit/index`）
- Test: `packages/miniapp/packageWarehouse/common/wh-kit-view.test.js`、`wh-kit-list-page.test.js`、`wh-kit-page.test.js`

**Interfaces:**
- Consumes:
  - `GET /warehouse/kit`（`project_id`、`status`、`keyword`、分页；行带 `project_name`、`project_manager_userid`、`template_name`、`line_count`）
  - `GET /warehouse/kit/:id`（行带 `material_name`、`material_spec`、`material_unit`、`material_kind`、`category_name`、`spec_choices: { id, spec }[]`）
  - `POST /warehouse/kit`（`{ project_id, title, remark?, template_id? | copy_from_kit_id? | lines? }`）
  - `PUT /warehouse/kit/:id`（`{ version, title, remark, lines }`，行整体替换）
  - `POST /warehouse/kit/:id/submit`（`{ version }`，返回 `{ status }`）、`/confirm`（`{ version }`）、`/discard`（`{ version, reason }`）、`/close`（`{ version }`）
  - `GET /warehouse/kit/:id/fulfilment`（每行多 `shipped`、`pending`、`in_stock`）
  - `GET /warehouse/kit-template`
- Produces（`wh-kit-view.js`，规则和 Web 的 `packages/web/src/views/wh/kit/kit-view.ts` 一样，逐条对照移植）：

```js
/** 和 Web 的 kitActions 同样的规则。viewer: { userid, roles, caps } */
const kitActions = (kit, viewer) => ({ canEdit, canSubmit, canConfirm, canDiscard, canClose, canShip });
/** 提交前要处理的行；和 Web 的 kitLineProblems 同样的规则和文案。 */
const kitLineProblems = (lines) => [{ index, message }];
/** 接口的行 → 页面上可编辑的行（qty 是字符串，方便输入框）。 */
const toEditableLines = (lines) => [{ key, id, section, lineKind, deviceCategoryId, materialId, nameText, specText, unit, qty, source, note, specChoices, kindLabel, sourceLabel, materialLabel }];
/** 可编辑的行 → PUT 的 lines。qty 空串按 0。 */
const toKitLines = (rows) => [{ section, line_kind, device_category_id, material_id, name_text, spec_text, unit, planned_qty, source, note }];
/** 按分节分组，保持原顺序；每组带行数和"有问题的行数"。 */
const groupBySection = (rows, problems) => [{ section, rows: [{ ...row, index, problem }], count, problemCount }];
/** 已确认清单的执行情况，行上显示"计划 / 已发 / 待发"。 */
const withFulfilment = (rows, fulfilment) => [{ ...row, shippedText, pendingText, done }];
/** 新建清单表单的检查：没选项目 → "请选择项目"；标题为空 → "请填写清单标题"。 */
const newKitProblem = (form) => "";
```

清单列表页：
- 参数 `status`、`projectId` 是初始筛选；顶部状态页签：全部、草稿、待确认、已确认、已关闭。每页 20 条，触底加载。
- 行显示：项目名、清单号和标题、状态、行数；点开进 `kit/index?id=`。
- 有建清单权限（`caps.can_create_kit`）时有"新建清单"：底部面板里选项目（`hy-project-picker`，带参数 `projectId` 时预选）、选模板（`hy-search-picker` 本地模式，第 0 项"空白清单"）、填标题（默认"主清单"）。提交 `POST /kit`，成功后进新清单的详情。参数 `create=1` 时进页面自动打开这个面板。
- 现场负责人选了不是自己负责的项目，后端返回 403，照常提示后端的话。

清单详情页：
- 头部：清单号、状态、项目、来源（模板名、复制、空白）、提交人和确认人。
- 行按分节折叠显示（195 行的清单一次全展开没法用）：默认全部收起，分节标题显示"<分节名>（<行数>）"，有问题的分节标红并自动展开。
- 能改时（`canEdit`）：每行改计划数（数字输入）、来源（原生 `picker`，4 项）、"待选规格"的物资行选规格（`picker`，选项来自 `specChoices`，选了就填上 `materialId`）。手机上不加行、不删行、不改品名：计划数填 0 就是这个工程不用。加行删行在 Web 上做。
- "保存"：`PUT`。"提交"：先 `kitLineProblems`，有问题就提示"有 N 行要先处理"并展开对应分节；没有问题就先保存再提交（保存失败就停下）。返回 `confirmed` 提示"已提交并确认"，返回 `submitted` 提示"已提交，等库管确认"。
- "确认"（库管）：能改时先查行、先保存，再确认。"作废"：输入原因，空的不提交。"关闭清单"（库管，已确认的）：确认框后提交；项目没结清时后端返回 409 和原因，照常提示。
- 已确认和已关闭的清单加载 `fulfilment`，行上显示"计划 / 已发 / 待发"。库管在已确认的清单上有"按清单发货"，进 `/packageWarehouse/ship/index?type=out&kitId=<id>`；"项目在场"进 `/packageWarehouse/project/index?projectId=`。
- 409 提示后端的话并重新加载。离开页面时有没保存的改动不拦（小程序拦不住返回），但"保存"按钮在有改动时高亮。

- [ ] **Step 1: 写视图模块的失败测试**

把 Web 的 `packages/web/src/views/wh/kit/kit-view.test.ts` 里 `kitActions`、`kitLineProblems`、`toKitLines` 的用例逐条搬过来（同样的输入、同样的期望），再加：
- `groupBySection`：三行两个分节，顺序不变，第二个分节有一行有问题时 `problemCount` 是 1。
- `withFulfilment`：计划 10、已发 4 → `shippedText: "4"`、`pendingText: "6"`、`done: false`；已发 10 → `done: true`；备忘行三个字段是空串。
- `toEditableLines` 再 `toKitLines` 往返一份含设备行、已选规格的物资行、待选规格的物资行、备忘行的清单，结果等于原来的行（只比 `toKitLines` 输出的字段）。
- `newKitProblem` 的两条文案。

- [ ] **Step 2: 写两个页面流程的失败测试**

列表页：
1. `open({ status: "submitted" })` → 请求带 `status=submitted`，"待确认"页签选中。
2. `open({ create: "1", projectId: "3" })` → 新建面板已打开，项目预选。
3. 新建：没选项目点确定 → 提示"请选择项目"；选好提交 → `POST /kit` 带 `{ project_id, title, template_id }`，成功后跳 `kit/index?id=<新 id>`。
4. 没有建清单权限 → `data.canCreate` 为假。

详情页（现场负责人，草稿）：
1. 打开 → 分节全部收起（`data.groups.every((g) => !g.open)`）。
2. 改一行数量后点保存 → `PUT /kit/5` 的 `lines` 里那一行 `planned_qty` 是新值，其余行原样；成功后重新加载。
3. 有一行物资没选规格、计划数大于 0 时点提交 → 提示"有 1 行要先处理"，没有任何请求，那个分节被展开。
4. 给那一行选了规格再提交 → 先 `PUT` 再 `POST /submit`，顺序正确；第二个请求用的是保存后重新加载得到的 `version`。
5. 保存返回 409 → 提示"数据已变化，请刷新后重试"，重新加载，没有发 `submit`，`busy` 复位。

详情页（库管）：
6. 待确认的清单上改了数量再点确认 → 先 `PUT` 再 `POST /confirm`。
7. 已确认的清单 → 请求了 `/fulfilment`，行上有 `pendingText`；点"按清单发货"跳到 `ship/index?type=out&kitId=5`。
8. 关闭清单返回 409"项目还有 1 台设备、2 种周转件在场，结清后才能关闭" → 原样提示。
9. 作废：原因为空不提交；填了 → `POST /discard` 带 `reason`。

- [ ] **Step 3: 跑测试确认失败**

Run: `cd packages/miniapp && for f in packageWarehouse/common/wh-kit-*.test.js; do node "$f"; done`
Expected: `Cannot find module`。

- [ ] **Step 4: 实现视图模块和两个页面**

- [ ] **Step 5: 跑测试确认通过**

Run: `cd packages/miniapp && npm run test:wh && npm run typecheck`
Expected: 全部通过。

- [ ] **Step 6: 提交**

```bash
git add packages/miniapp/packageWarehouse/kit-list packages/miniapp/packageWarehouse/kit packages/miniapp/packageWarehouse/common/wh-kit-view.js packages/miniapp/packageWarehouse/common/wh-kit-*.test.js packages/miniapp/app.json
git commit -m "feat: 小程序配套清单列表、新建和详情，项目方提交、库管确认"
```

---

### Task 10: 发货、返库、转场、入库

**Files:**
- Create: `packages/miniapp/packageWarehouse/ship/index.{js,wxml,wxss,json}`
- Create: `packages/miniapp/packageWarehouse/common/wh-ship-view.js`
- Modify: `packages/miniapp/app.json`（分包加 `ship/index`）
- Test: `packages/miniapp/packageWarehouse/common/wh-ship-view.test.js`、`wh-ship-page.test.js`

**Interfaces:**
- Consumes:
  - `POST /warehouse/doc`：`{ doc_type: "out"|"back"|"transfer"|"inbound", client_request_id, project_id?, to_project_id?, project_kit_id?, counterparty?, handover_name?, remark?, photo_keys?, device_lines: [{ device_id, usage_meters?, soil_type?, note? }], material_lines: [{ material_id, quantity, outcome?: "returned"|"lost", note? }] }`，返回 `{ id, doc_no, replayed, created_task_ids }`。`project_id`：发货是发往的项目，返库和转场是来源项目；`to_project_id` 只有转场带，是目的项目；入库两个都不带。只有 `out` 能带 `project_kit_id`；只有 `back` 的物资行带 `outcome`（周转件 `returned` 或 `lost`，耗材只能 `returned`）。
  - `GET /warehouse/kit/:id`、`GET /warehouse/kit/:id/fulfilment`（按清单带出）
  - `GET /warehouse/project/:projectId/holdings`（返回 `{ devices: DeviceRow[], materials: { material_id, material_code, name, spec, unit, holding }[] }`，返库和转场带出）
  - `GET /warehouse/material?keyword=&status=active&pageSize=20`（加清单外的物资）、`GET /warehouse/device/:id`、`scanDevice()`
- Produces（`wh-ship-view.js`）：

```js
const SHIP_TYPES = {
  out: { title: "发往项目", docType: "out", needsProject: true },
  back: { title: "项目返库", docType: "back", needsProject: true },
  transfer: { title: "项目间转场", docType: "transfer", needsProject: true, needsToProject: true },
  in: { title: "入库", docType: "inbound", needsProject: false }
};
/** 空表单。type 不认识时按 out。 */
const newShipForm = (type, requestId) => ({ type, requestId, projectId: null, toProjectId: null, kitId: null, kitNo: "",
  devices: [], materials: [], deviceNeeds: [], counterparty: "", handoverName: "", remark: "", photoKeys: [] });
/**
 * 按清单带出。规则和 Web 的 prefillOutFromKit 一样：只取来源是"库房发"且待发大于 0 的行；
 * 同一物资的几行合并成一行（数量相加，保留 3 位小数）；设备行按类别汇总成"还需几台"。
 */
const prefillFromKit = (form, kit, fulfilment) => form;
/** 按项目在场带出：返库和转场默认整单（设备全带上，周转件 returned = 在场数、lost = 0）。 */
const prefillFromHoldings = (form, holdings) => form;
/**
 * 加一台设备。返回 { form } 或 { error }：
 *   已经在单里 → "<编号> 已经加过了"
 *   发货时状态不是可用 → "<编号> 现在是<状态>，不能发出"
 *   返库或转场时不在所选项目 → "<编号> 不在这个项目"
 *   入库单 → "入库单不加设备，新设备在 Web 的设备台账里新建"
 */
const addDevice = (form, device) => ({ form }) || ({ error });
const removeDevice = (form, deviceId) => form;
/** 加一条物资；已经有了就不重复加，返回 { error: "<品名 规格> 已经在单里" }。 */
const addMaterial = (form, material) => ({ form }) || ({ error });
/** 改一行的数量。field: "quantity" | "returned" | "lost"；text 是输入框里的字符串。 */
const setMaterialQty = (form, materialId, field, text) => form;
/** 设备还需几台的提示，随已加的设备减少。 */
const deviceNeedHints = (form) => [{ categoryName, need, picked, text }];   // text 如 "顶管机：还需 1 台（已选 1 台）"
/**
 * 提交前检查，返回第一条问题或 ""：
 *   "请选择项目"、"请选择目的项目"、"来源和目的不能是同一个项目"、"请至少添加一行"、
 *   "<品名 规格> 的数量不对"、"<品名 规格> 退回加报损超过在场数 <n>"（只查周转件）、"<品名 规格> 库存只有 <n>"（只查发货）
 */
const shipProblem = (form) => "";
/** 请求体。数量为 0 的行不带；返库的周转件拆成 returned 和 lost 两行。 */
const toDocPayload = (form) => ({});
```

物资行在表单里的形状：`{ materialId, name, spec, unit, kind, available /* 在库数或在场数 */, quantity, returned, lost }`，三个数量都是字符串。

页面行为：
- 参数 `type`（必有）、`projectId`、`kitId`、`deviceId`。请求号在 `onLoad` 生成。
- 带 `kitId`：加载清单和执行情况，`prefillFromKit`，项目锁定为清单的项目，标题下显示"按清单 <清单号>"。
- 返库、转场选了项目后：加载在场清单，`prefillFromHoldings`；换项目时清空再带出。
- 带 `deviceId`：加载这台设备并 `addDevice`。
- "扫码加设备"：连续扫，扫到一台加一台并震动提示，直到用户取消；加不进去的（重复、状态不对）提示原因后继续扫。不是设备码也是提示后继续。
- 设备也可以输入关键字搜（`GET /device?keyword=`），点一条 `addDevice`。
- 发货时设备行上方显示 `deviceNeedHints`。
- 物资行：发货和入库一列数量；返库两列（退回、报损），旁边显示在场数；转场一列数量，默认在场数。消耗类物资在返库页只有"退回"一列。
- "加物资"（发货、入库、返库）：`hy-search-picker` 远程模式搜物资，选中后 `addMaterial`。返库页加物资是为了退没用完的耗材：加进来的耗材只有"退回"一列，没有在场数上限。加进来的是周转件而它不在在场清单里时，后端会因为在场数不够拒绝，照常提示。转场不能加物资（耗材不能转场，周转件已经全带出）。
- 入库：可填供应商，可拍送货单（最多 9 张，`uploadFileToR2(path, { category: "wh-doc" })`，key 放进 `photoKeys`）。发货：可填领料人。都可填备注。
- "提交"：`shipProblem` 有问题就提示；没有就 `POST /doc`。成功（包括 `replayed`）提示"已提交 <单号>"，换一个新请求号，`wx.navigateBack`。失败提示后端的话，`busy` 复位，表单和请求号都保留。
- 返库成功且 `created_task_ids` 不为空：提示里加"已生成 N 个检查任务"。

- [ ] **Step 1: 写视图模块的失败测试**

逐个函数覆盖，期望值写全。至少包括：

```js
// 按清单带出：同一物资两行合并，现场采购的行不带，待发为 0 的不带，设备按类别汇总
const fulfilment = [
  { line_kind: "material", material_id: 1, name_text: "排泥钢管", material_name: "排泥钢管", material_spec: "Φ114", material_unit: "根", material_kind: "turnover", source: "warehouse", pending: 60, in_stock: 100 },
  { line_kind: "material", material_id: 1, name_text: "排泥钢管", material_name: "排泥钢管", material_spec: "Φ114", material_unit: "根", material_kind: "turnover", source: "warehouse", pending: 20.5, in_stock: 100 },
  { line_kind: "material", material_id: 2, name_text: "膨润土", material_name: "膨润土", material_spec: "", material_unit: "袋", material_kind: "consumable", source: "site_purchase", pending: 30, in_stock: 0 },
  { line_kind: "material", material_id: 3, name_text: "注浆管", material_name: "注浆管", material_spec: "DN25", material_unit: "根", material_kind: "turnover", source: "warehouse", pending: 0, in_stock: 50 },
  { line_kind: "device", device_category_id: 9, category_name: "顶管机", spec_text: "DN1200", source: "warehouse", pending: 2, in_stock: 3 },
  { line_kind: "text", name_text: "记得带图纸", source: "warehouse", pending: 0, in_stock: null }
];
const form = prefillFromKit(newShipForm("out", "req-12345678"), { id: 5, kit_no: "PT-1", project_id: 3 }, fulfilment);
assert.strictEqual(form.projectId, 3);
assert.strictEqual(form.kitId, 5);
assert.deepStrictEqual(form.materials.map((m) => [m.materialId, m.quantity, m.available]), [[1, "80.5", 100]]);
assert.deepStrictEqual(form.deviceNeeds, [{ categoryId: 9, categoryName: "顶管机", specText: "DN1200", count: 2, available: 3 }]);

// 加设备
const device = { id: 7, device_code: "DG-01", name: "顶管机", category_id: 9, state: "available", state_label: "可用", current_project_id: null };
let result = addDevice(form, device);
assert.strictEqual(result.form.devices.length, 1);
assert.deepStrictEqual(addDevice(result.form, device), { error: "DG-01 已经加过了" });
assert.deepStrictEqual(addDevice(form, { ...device, state: "pending_inspection", state_label: "待检" }), { error: "DG-01 现在是待检，不能发出" });
assert.strictEqual(deviceNeedHints(result.form)[0].text, "顶管机：还需 1 台（已选 1 台）");

// 返库：整单带出，改一行报损
let back = prefillFromHoldings({ ...newShipForm("back", "req-22345678"), projectId: 3 },
  { devices: [{ ...device, state: "on_project", current_project_id: 3 }], materials: [{ material_id: 1, name: "排泥钢管", spec: "Φ114", unit: "根", holding: 80 }] });
assert.strictEqual(back.devices.length, 1);
assert.deepStrictEqual(back.materials.map((m) => [m.returned, m.lost, m.available]), [["80", "0", 80]]);
back = setMaterialQty(back, 1, "returned", "70");
back = setMaterialQty(back, 1, "lost", "11");
assert.strictEqual(shipProblem(back), "排泥钢管 Φ114 退回加报损超过在场数 80");
back = setMaterialQty(back, 1, "lost", "10");
assert.strictEqual(shipProblem(back), "");
assert.deepStrictEqual(toDocPayload(back).material_lines, [
  { material_id: 1, quantity: 70, outcome: "returned" },
  { material_id: 1, quantity: 10, outcome: "lost" }
]);
assert.deepStrictEqual(addDevice(back, { ...device, id: 8, device_code: "DG-02", state: "on_project", current_project_id: 4 }), { error: "DG-02 不在这个项目" });
```

再覆盖：返库单 `addMaterial` 一种耗材、退回 5 → `shipProblem` 通过，`toDocPayload` 里是 `{ material_id, quantity: 5, outcome: "returned" }`；转场的 `toDocPayload` 带 `project_id`（来源）和 `to_project_id`（目的）；`shipProblem` 的其余五条文案各一例（没选项目、转场没选目的、来源目的相同、一行都没有、发货数量超过在库）；数量填 `"abc"` 报"数量不对"；`toDocPayload` 不带数量为 0 的行、`out` 带 `project_kit_id`、`in` 的 `doc_type` 是 `inbound` 且带 `counterparty` 和 `photo_keys`；入库单 `addDevice` 的提示；`addMaterial` 重复的提示；所有函数不改传入的 `form`（调用前后 `JSON.stringify(form)` 相同）。

- [ ] **Step 2: 写页面流程的失败测试**

1. `open({ type: "out", kitId: "5" })` → 请求了 `/kit/5` 和 `/kit/5/fulfilment`，物资行已带出，项目锁定。
2. 连续扫码：`state.scans = ["HYBC:D:DG-01", "HYBC:D:DG-01", "hello", cancelError]` → 加了 1 台，提示里有"DG-01 已经加过了"和"不是设备码"，`data.scanning` 最后是 `false`。
3. 提交成功 → `POST /doc` 的 `data` 等于 `toDocPayload(form)`，提示含单号，`navigateBack` 一次。
4. **连点两次提交** → 只发了一次 `POST /doc`（第二次点击时 `busy` 为真）。
5. **提交失败后重试** → 第一次失败（`fail("POST", "/doc", "网络连接失败")`），`busy` 复位，表单还在；再点提交 → 第二次请求的 `client_request_id` 和第一次相同；这次返回 `replayed: true` 也按成功处理。
6. `open({ type: "back" })`，选项目 → 请求 `/project/3/holdings`，带出整单；提交成功且 `created_task_ids: [11, 12]` → 提示含"已生成 2 个检查任务"。
7. `open({ type: "out", deviceId: "7" })` → 设备已在单里。
8. `open({ type: "in" })` → 没有项目选择、没有扫码加设备；拍两张送货单 → `photo_keys` 两个，都以 `wh-doc/` 开头。
9. 库存不足（后端返回 400"库存不足"）→ 原样提示，`busy` 复位。

- [ ] **Step 3: 跑测试确认失败**

Run: `cd packages/miniapp && node packageWarehouse/common/wh-ship-view.test.js; node packageWarehouse/common/wh-ship-page.test.js`
Expected: `Cannot find module`。

- [ ] **Step 4: 实现视图模块和页面**

页面 JS 超过 400 行时，把扫码和搜索加设备拆到 `packageWarehouse/ship/device-adder.js`。

- [ ] **Step 5: 跑测试确认通过**

Run: `cd packages/miniapp && npm run test:wh && npm run typecheck`
Expected: 全部通过。

- [ ] **Step 6: 提交**

```bash
git add packages/miniapp/packageWarehouse/ship packages/miniapp/packageWarehouse/common/wh-ship-view.js packages/miniapp/packageWarehouse/common/wh-ship-*.test.js packages/miniapp/app.json
git commit -m "feat: 小程序发货、返库、转场、入库，连续扫码加设备"
```

---

### Task 11: 项目在场页和库存页

**Files:**
- Create: `packages/miniapp/packageWarehouse/project/index.{js,wxml,wxss,json}`
- Create: `packages/miniapp/packageWarehouse/material/index.{js,wxml,wxss,json}`
- Create: `packages/miniapp/packageWarehouse/common/wh-project-view.js`
- Modify: `packages/miniapp/app.json`（分包加 `project/index`、`material/index`）
- Test: `packages/miniapp/packageWarehouse/common/wh-project-view.test.js`、`wh-project-page.test.js`、`wh-material-page.test.js`

**Interfaces:**
- Consumes:
  - `GET /warehouse/project/:projectId/ledger`：`{ project_id, project_name, project_manager_userid（Task 1 加的）, settled, devices_on_site, turnover_kinds_on_site, materials: [{ material_id, material_code, name, spec, unit, category, kind, planned, shipped, transferred_out, returned, lost, on_site（耗材是 null）, first_out_at, last_back_at, loss_amount }], device_categories, devices: DeviceRow[], kits: ProjectKitRow[] }`。清单和项目名都在里面，不用另外请求。
  - `GET /warehouse/doc?project_id=&pageSize=10`（行有 `doc_no`、`doc_type`、`occurred_at`、`project_name`、`to_project_name`、`line_count`、`reverses_doc_id`、`reversed_by_doc_no`）、`GET /warehouse/me`
  - `GET /warehouse/material`（`keyword`、`low_stock=1`、`status=active`、分页；行有 `material_code`、`name`、`spec`、`unit`、`kind`、`quantity`、`min_stock`）
- Produces（`wh-project-view.js`）：

```js
/**
 * @returns {{
 *   settled: boolean, settledText: string,                 // "已结清" 或 "设备 2 台、周转件 5 种在场"
 *   devices: { id, code, name, stateLabel }[],
 *   materials: { materialId, label, unit, onSiteText, shippedText, returnedText, lostText }[],   // 只列在场数大于 0 的周转件
 *   kits: { id, kitNo, title, statusLabel }[],
 *   docs: { id, docNo, typeLabel, timeText, summary, reversed }[],   // summary 如 "一号工程 → 二号工程 · 5 行"；被冲销的和冲销单 reversed 为真，页面上划掉
 *   actions: { canShip, canReturn, canTransfer, canCreateKit }
 * }}
 */
const buildProjectView = (ledger, docs, viewer /* { userid, roles, caps } */) => ({});
/** 库存行：低库存的标出来。 */
const toMaterialRow = (material) => ({ id, label, unit, quantityText, low, minStockText });
```

按钮规则：`canShip`、`canTransfer` = 库管；`canReturn` = 库管且没结清；`canCreateKit` 和 `kitActions` 里"能不能改这个项目的清单"同一条规则（库管、经理，或者现场负责人且 `ledger.project_manager_userid` 是自己）。

项目在场页：参数 `projectId`。三段：在场设备（点开进设备页）、在场周转件、这个项目的清单（点开进清单详情）；下面是最近 10 张库房单（只读）。按钮："项目返库" → `ship/index?type=back&projectId=`；"发货" → `ship/index?type=out&projectId=`；"转场" → `ship/index?type=transfer&projectId=`；"新建清单" → `kit-list/index?projectId=<id>&create=1`。`ledger` 和库房单两个接口并行加载，一个失败不影响另一个：`ledger` 失败时上面三段显示"加载失败，下拉重试"，库房单照常显示，反过来也一样。

库存页：搜索框（停 300ms 查）、"只看低库存"开关（参数 `low=1` 时默认开）、每页 30 条触底加载。行显示品名规格、在库数和单位、低库存标记和最低库存数。只读。

- [ ] **Step 1: 写视图模块的失败测试**

覆盖：结清和没结清的 `settledText`；`materials` 只列 `on_site > 0` 的周转件，消耗类不列；`docs` 的 `summary` 对发货、返库、转场三种单的写法，被冲销的单 `reversed` 为真；四个按钮在库管、经理、项目自己的现场负责人、别的项目的现场负责人、操作员五种身份下的值；`toMaterialRow` 的低库存判断（`min_stock` 为空不算低，`quantity <= min_stock` 算低）。期望值写全，写法同前面的任务。

- [ ] **Step 2: 写两个页面流程的失败测试**

项目页：
1. `open({ projectId: "3" })` → 请求了 `/project/3/ledger`、`/doc?project_id=3`、`/me`，四段都有数据，导航栏标题是项目名。
2. `ledger` 失败 → 设备、周转件、清单三段显示加载失败，库房单一段正常；`loading` 复位。
3. 库管点"项目返库" → 跳 `ship/index?type=back&projectId=3`；已结清时没有这个按钮。
4. 现场负责人（自己的项目）点"新建清单" → 跳 `kit-list/index?projectId=3&create=1`。

库存页：
1. `open({ low: "1" })` → 请求带 `low_stock=1&status=active`，开关是开的。
2. 输入"钢管" → 请求带 `keyword=%E9%92%A2%E7%AE%A1`，列表被替换。
3. 触底加载第 2 页并追加；关掉开关后回到第 1 页重新加载。

- [ ] **Step 3: 跑测试确认失败**

Run: `cd packages/miniapp && node packageWarehouse/common/wh-project-view.test.js; node packageWarehouse/common/wh-project-page.test.js; node packageWarehouse/common/wh-material-page.test.js`
Expected: `Cannot find module`。

- [ ] **Step 4: 实现**

- [ ] **Step 5: 跑测试确认通过**

Run: `cd packages/miniapp && npm run test:wh && npm run typecheck`
Expected: 全部通过。

- [ ] **Step 6: 提交**

```bash
git add packages/miniapp/packageWarehouse/project packages/miniapp/packageWarehouse/material packages/miniapp/packageWarehouse/common/wh-project-view.js packages/miniapp/packageWarehouse/common/wh-project-*.test.js packages/miniapp/packageWarehouse/common/wh-material-page.test.js packages/miniapp/app.json
git commit -m "feat: 小程序项目在场页和库存页"
```

---

### Task 12: 删掉旧页面，改工作台入口和退回编辑

**Files:**
- Delete: `packages/miniapp/pages/warehouse-task/`、`warehouse-stock-order/`、`warehouse-inventory/`、`warehouse-dispatch/`、`warehouse-stocktake/`、`pages/asset/`
- Delete: `packages/miniapp/assets/workbench/asset.png`（并改同目录的 `README.md`）
- Modify: `packages/miniapp/app.json`（`pages` 去掉这六个）
- Modify: `packages/miniapp/utils/workbench-view.js`（去掉"设备查验"入口和三处角色列表里的 `asset`；"库房任务"待办格的路径改成 `/packageWarehouse/task-list/index?tab=mine`）
- Modify: `packages/miniapp/pages/index/index.js`（`TODO_LOADERS.tasks` 改成 `{ path: "/api/v1/warehouse/task?scope=mine&status=todo&page=1&pageSize=1", read: totalOf }`）
- Modify: `packages/miniapp/pages/returned-approval-edit/index.js`（删掉 `stock_order`、`warehouse_asset_work_order` 两个配置和第 427 行附近 `stock_order` 的分支，以及用不到的 `orderTypeLabel`、`workOrderTypeLabel` 引入）
- Test: `packages/miniapp/utils/workbench-view.test.js`、`packages/miniapp/utils/workbench-page.test.js`（改现有用例）

`utils/enum-labels.js` 里 `stock_order`、`warehouse_asset_work_order` 的中文名**保留**：历史审批记录还要显示。`orderTypeLabel`、`workOrderTypeLabel` 没有别处引用就删掉，有就留。

- [ ] **Step 1: 先改测试**

`workbench-view.test.js`：任何角色的入口里都没有 `asset`；"库房任务"待办格的 `path` 是 `/packageWarehouse/task-list/index?tab=mine`。
`workbench-page.test.js`：库房任务数来自 `/api/v1/warehouse/task?scope=mine&status=todo` 的 `pagination.total`（响应 `{ success: true, data: [{}], pagination: { total: 4 } }` → 数字是 4）；不再请求 `/warehouse/work-order/mobile/my-tasks`。
再加一个小检查脚本 `packages/miniapp/utils/wh-app-json.test.js`：读 `app.json`，断言 `pages` 里没有那六个旧路径，`subPackages` 里 `packageWarehouse` 的 `pages` 正好是页面路径表里那 9 个，并且每个页面的 `.js`、`.wxml`、`.json` 文件都存在；全仓库（排除 `node_modules`、`miniprogram_npm`、`tdesign-miniprogram`、`*.test.js`）没有字符串 `pages/warehouse-` 和 `pages/asset/`。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/miniapp && node utils/workbench-view.test.js; node utils/workbench-page.test.js; node utils/wh-app-json.test.js`
Expected: 三个都断言失败。

- [ ] **Step 3: 删页面、改入口和退回编辑**

- [ ] **Step 4: 跑全部小程序测试**

Run: `cd packages/miniapp && npm run test:wh && for f in utils/*.test.js; do node "$f" || echo "FAILED $f"; done && npm run typecheck`
Expected: 没有 `FAILED`，`tsc` 无错误。（`utils/` 下带空格的 ` 2.js` 文件是别的会话留下的未跟踪文件，不要动，也不要提交。）

- [ ] **Step 5: 提交**

```bash
git add -A packages/miniapp/pages packages/miniapp/assets/workbench packages/miniapp/app.json packages/miniapp/utils/workbench-view.js packages/miniapp/utils/workbench-view.test.js packages/miniapp/utils/workbench-page.test.js packages/miniapp/utils/wh-app-json.test.js
git commit -m "refactor: 小程序删掉旧库房和资产页面，工作台入口改到新任务列表"
```

提交前 `git status` 确认暂存区里没有带空格的 ` 2.` 文件。

---

### Task 13: 文档、整体验证、开 PR

**Files:**
- Modify: `doc/UI设计文档.md`（小程序库房部分整段重写：tab 页和 9 个分包页面，各页的入口、按身份显示的内容、主要动作）
- Modify: `doc/开发记录.md`（追加两条：补记阶段 2 的上线——迁移 0096、PR #25、合并提交 `acd411c0`、Worker 版本 `5138f849`；阶段 3 的内容、没做的、真机清单）
- Modify: `docs/superpowers/specs/2026-11-11-warehouse-rebuild-design.md`（第 21 节把阶段 2 的状态改成已上线，加"阶段 3"小节：状态，以及本计划"设计稿没写死"那 9 条和实施中新定的）
- Modify: `CLAUDE.md`（Mini-app 一段的分包列表加 `packageWarehouse`；测试命令加 `cd packages/miniapp && npm run test:wh`）

- [ ] **Step 1: 跑全部检查**

```bash
cd packages/api && npm run typecheck && npm run lint && npm test
cd ../web && npm run typecheck && npm test && npm run build
cd ../miniapp && npm run typecheck && npm run test:wh && for f in utils/*.test.js; do node "$f" || echo "FAILED $f"; done
cd ../mcp && npm test
```

Expected: 全部通过，没有 `FAILED`。把各包的用例数记下来写进 PR。

- [ ] **Step 2: 本地联调通知**

起本地 api（`preview_start`，不要用 Bash 起服务）。用本地账号（`admin` 是库管）在 Web 设置页打开通知开关，建一个任务派给 `site_manager`，然后查本地库：

```bash
cd packages/api && npx wrangler d1 execute hybcdg-prod-db --local --command "SELECT event_type, event_payload FROM event_log ORDER BY id DESC LIMIT 5"
```

Expected: 有一行 `WAREHOUSE_NOTICE`，payload 是 `{"kind":"tasks_assigned",...}`。本地没有 bridge，卡片发不出去，接着会有 `warehouse_notice_failed`，任务本身建成功——这正是 Review Focus 第 3 条要的结果。真实卡片只能上线后在生产上验证（Task 14）。

- [ ] **Step 3: 看版式**

小程序页面没法在浏览器里跑。两种办法都做：
- 微信开发者工具用"企业微信小程序"编译模式打开 `packages/miniapp`，逐页看：tab 页、设备页、任务列表和详情、清单列表和详情、录单页四种类型、项目页、库存页。这个模式连的是生产接口，**只看不写**；生产接口还没有 `/warehouse/home` 时 tab 页会显示加载失败，属于预期。
- 开发者工具打不开的页面状态（例如有数据的清单详情），照记忆里"小程序版式静态预览"的做法，用真实 WXML/WXSS 加假数据渲染成静态页看。
- 在开发者工具"代码依赖分析"里看主包体积，要比改动前小（删了六个页面）；超过 2MB 不能上传。

把看到的问题当场改掉，改完重跑 Step 1 里小程序那一行。

- [ ] **Step 4: 写文档并提交**

```bash
git add doc/UI设计文档.md doc/开发记录.md docs/superpowers/specs/2026-11-11-warehouse-rebuild-design.md CLAUDE.md
git commit -m "docs: 记录库房阶段 3（小程序和通知）和阶段 2 的上线"
```

`doc/开发记录.md` 里写给 owner 的**真机清单**（提审前逐条过）：
1. 库管：首页五个数字和七个动作；扫一台在项目的设备 → 返库 → 设备变待检、生成检查任务。
2. 库管：按清单发货，连续扫两台设备，改一行数量，提交；项目页的在场数对得上。
3. 库管：项目返库，改一行报损；入库拍一张送货单。
4. 执行人（非库管的账号）：从"我的任务"进检查任务，拍 3 张照片，选不合格，提交；库管确认后生成维修任务。
5. 现场负责人：新建清单（选模板），改数量，选规格，提交；库管确认。
6. 断网时点提交：有提示，恢复网络后再点只生成一张单。
7. 退回补充、取消任务、作废清单、设备记事的输入框（`wx.showModal` 的 `editable`）在企微手机端能输入；不能的话改成底部面板加文本框。
8. 打开通知开关后：上面第 4、5 步里，对应的人收到卡片，点开进到正确的页面。

- [ ] **Step 5: 整分支审查**

按 executing-plans 的 Final Review 做：`review-package` 生成审查包，派一个新开的审查子代理（用最强的模型），把本计划的 Review Focus 五条原样给它。Critical 和 Important 一轮修完，每个修复先写失败的测试。

- [ ] **Step 6: 推送并开 PR（要 owner 明确同意）**

PR 说明里写清楚：没有迁移；合并即部署 API 和 Web，通知开关默认关，对线上没有可见变化；小程序要另外上传提审；旧接口占位这次不删。

---

### Task 14: 发布，然后删旧接口占位（每一步都要 owner 确认）

这是发布顺序，不是写代码；第 4 步有一个小改动，另开分支和 PR。

- [ ] **Step 1: 合并 PR。** 合并前看 `cloudflarestatus.com` 有没有影响构建和部署的事故。合并后确认 `https://api.hybcdg.com/api/v1/system/health` 返回 `ok=true`，并用自己的账号请求一次 `GET /api/v1/warehouse/home` 返回 200。
- [ ] **Step 2: owner 上传小程序、过真机清单、提审、发布。** 小程序是原生强制更新（`utils/update.js`），发布后用户下次冷启动就会换到新版。
- [ ] **Step 3: 经理在 Web 的库房设置里打开"企微通知"。** 然后走一遍阶段 3 的完成标准：李震用手机完成一次发货、返库、检查；执行人收到卡片并提交任务。发不出去时查 `event_log` 里的 `warehouse_notice_failed`（查生产库要先经 owner 同意）。
- [ ] **Step 4: 新版发布满一周后，删旧接口占位里小程序用的路径。**

**Files:**
- Modify: `packages/api/src/routes/warehouse-legacy-stub.ts`
- Test: `packages/api/test/warehouse-legacy-stub.test.ts`（已有，改写）

改成只保留一条：`GET /api/v1/warehouse/stock-order` 返回 `{ success: true, data: [] }`（已安装的 MCP 的 `list_stock_orders` 和 `agent-readonly.ts` 的白名单还在用，阶段 5 一起换掉）。其余旧路径不再接，落到全局的 404。`index.ts` 里 `app.route("/api/v1/asset", warehouseLegacyStubRoutes)` 这一行去掉，`/api/v1/warehouse` 那一行保留（仍然要挂在 `mountWarehouseRoutes(app)` 之后）。文件头的注释改成现在的情况。

先写测试再改：

```ts
it("MCP 还在用的旧列表路径返回空数组", async () => {
  const res = await call("GET", "/api/v1/warehouse/stock-order");
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ success: true, data: [] });
});
it.each([
  ["GET", "/api/v1/warehouse/work-order/mobile/my-tasks"],
  ["GET", "/api/v1/warehouse/stocktake"],
  ["GET", "/api/v1/asset"],
  ["POST", "/api/v1/warehouse/stock-order"]
])("%s %s 不再有占位", async (method, path) => {
  const res = await call(method, path);
  expect(res.status).toBe(404);
});
it("新库房接口不受影响", async () => {
  const res = await call("GET", "/api/v1/warehouse/me");
  expect(res.status).toBe(200);
});
```

Run: `cd packages/api && npm test -- test/warehouse-legacy-stub.test.ts`
Expected: 改之前第二组 FAIL（现在返回 200 或 410），改之后全部 PASS。

提交：`refactor: 旧库房接口占位只保留 MCP 还在用的一条`。分支 `chore/warehouse-legacy-stub-trim`，开 PR，owner 同意后合并。
