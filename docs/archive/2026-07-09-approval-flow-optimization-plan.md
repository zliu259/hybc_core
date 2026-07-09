# 审批流转优化 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按已批准设计 [2026-07-09-approval-flow-optimization-design.md](./2026-07-09-approval-flow-optimization-design.md) 统一审批台、修复详情返回、监控台状态改 Tabs 并向 manager 只读开放。

**Architecture:** API 先行(新增 admin/summary 计数端点 + admin/all 放开 manager 读,TDD);web 封装;审批中心 index.vue 加内联审批动作并删除薄版 unified-tasklist;detail.vue 返回改来源感知;admin-monitor.vue 状态多选筛选改四页签。

**Tech Stack:** Hono + D1(vitest)/ Vue 3 + Element Plus + PureAdmin。

**部署与提交约定(重要):** 本仓库 push 到 main 即自动部署生产。每个 Task 完成后**本地 commit,不 push**;全部完成并通过最后一个 Task 的整体验证后一次性 push。无 D1 迁移。子代理**禁止运行 `git checkout`/`switch`/`reset`/`rebase`/`stash` 与 `npm run lint:eslint`(带 --fix 会污染工作区);只 `git add` + `git commit`,单文件 lint 用 `npx eslint <file>`。**

---

## 文件结构总览

| 动作 | 文件 | 职责 |
|---|---|---|
| Modify | `packages/api/src/routes/approval.ts` | 新增 admin/summary;admin/all 放开 manager |
| Create | `packages/api/src/routes/approval-admin-summary.test.ts` | summary 端点测试 |
| Create | `packages/api/src/routes/approval-admin-all-role.test.ts` | admin/all manager 读权限测试 |
| Modify | `packages/web/src/api/approval.ts` | admin summary 类型与封装 |
| Modify | `packages/web/src/views/approval/detail.vue` | 返回来源感知 |
| Modify | `packages/web/src/views/approval/index.vue` | 待审批行内联通过/驳回/转签 + 详情带 from |
| Rewrite | `packages/web/src/views/approval/admin-monitor.vue` | 状态改四页签 + 去 localStorage + 详情带 from |
| Delete | `packages/web/src/views/approval/unified-tasklist.vue` | 删除薄版 |
| Modify | `packages/web/src/router/modules/approval.ts` | unified-tasklist 改 redirect;monitor 加 manager |
| Modify | `doc/UI设计文档.md`、`doc/开发记录.md` | 文档同步 |

---

### Task 1: API — `GET /api/v1/approval/admin/summary`

**Files:**
- Test: `packages/api/src/routes/approval-admin-summary.test.ts`(新建)
- Modify: `packages/api/src/routes/approval.ts`(在 `admin/all` 路由约 637 行之前或之后注册,静态段先于 `/:id`)

- [ ] **Step 1: 写失败测试**

新建 `packages/api/src/routes/approval-admin-summary.test.ts`(mock 模式参照同目录 `payment-console-summary.test.ts`;approvalRoutes 从 `./approval` import):

```ts
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthTokenPayload } from "../types/auth";
import type { Env } from "../types/env";
import { approvalRoutes } from "./approval";

const mockAuthState = vi.hoisted(() => ({
  payload: {
    sub: "mgr-a",
    username: "mgr-a",
    nickname: "Manager A",
    avatar: "",
    roles: ["manager"],
    permissions: [],
    tokenId: "token-a",
    type: "access",
    auth_method: "wecom_oauth",
    wecom_verified_at: "2026-07-01T00:00:00.000Z",
    exp: 4102444800,
    iat: 1770000000
  } as AuthTokenPayload
}));

vi.mock("../services/auth", () => ({
  verifyToken: async (): Promise<AuthTokenPayload> => mockAuthState.payload
}));

class SummaryStatement {
  constructor(
    private readonly db: SummaryDb,
    private readonly sql: string
  ) {}

  bind() {
    return this;
  }

  async first<T>(): Promise<T | null> {
    this.db.capturedSql.push(this.sql);
    if (this.sql.includes("in_progress")) {
      return this.db.row as T;
    }
    return null;
  }

  async all<T>(): Promise<{ results: T[] }> {
    return { results: [] as T[] };
  }

  async run() {
    return { meta: { last_row_id: 1, changes: 1 } };
  }
}

class SummaryDb {
  capturedSql: string[] = [];
  row: unknown = { in_progress: 12, approved: 340, rejected: 18, total: 402 };

  prepare(sql: string) {
    return new SummaryStatement(this, sql);
  }
}

const createEnv = (db: SummaryDb) =>
  ({
    DB: db,
    KV: {
      async get() {
        return "session";
      }
    }
  }) as unknown as Env;

const requestSummary = (db: SummaryDb) => {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/approval", approvalRoutes);
  return app.request(
    "/approval/admin/summary",
    { headers: { authorization: "Bearer test-token" } },
    createEnv(db)
  );
};

describe("approval admin summary", () => {
  beforeEach(() => {
    mockAuthState.payload = { ...mockAuthState.payload, roles: ["manager"] };
  });

  it("returns four counts for manager", async () => {
    const db = new SummaryDb();
    const response = await requestSummary(db);

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      data: { in_progress: number; approved: number; rejected: number; total: number };
    };
    expect(payload.data).toEqual({
      in_progress: 12,
      approved: 340,
      rejected: 18,
      total: 402
    });
  });

  it("pins the aggregate SQL semantics", async () => {
    const db = new SummaryDb();
    await requestSummary(db);
    const sql = db.capturedSql.find(s => s.includes("in_progress")) ?? "";
    expect(sql).toContain("status = 'in_progress'");
    expect(sql).toContain("status = 'approved'");
    expect(sql).toContain("status = 'rejected'");
    expect(sql).toContain("COUNT(*)");
  });

  it("falls back to zero when the aggregate row is null", async () => {
    const db = new SummaryDb();
    db.row = null;
    const response = await requestSummary(db);

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { data: Record<string, number> };
    expect(payload.data).toEqual({
      in_progress: 0,
      approved: 0,
      rejected: 0,
      total: 0
    });
  });

  it("rejects operator role", async () => {
    mockAuthState.payload = { ...mockAuthState.payload, roles: ["operator"] };
    const response = await requestSummary(new SummaryDb());
    expect(response.status).toBe(403);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/api && npx vitest run src/routes/approval-admin-summary.test.ts`
Expected: FAIL(404 路由不存在)

- [ ] **Step 3: 实现路由**

先通读 `approval.ts` 的 `admin/all` 路由(约 637 行)确认 `approvalRoutes` 变量名与 `authMiddleware` 挂载方式。在 `admin/all` 路由**之前**插入(静态段 `/admin/summary` 先于 `/:id` 匹配):

```ts
approvalRoutes.get("/admin/summary", async (c) => {
  const auth = c.get("auth");
  if (!auth.roles.includes("super_admin") && !auth.roles.includes("manager")) {
    return c.json({ success: false, error: { message: "Forbidden" } }, 403);
  }

  const row = await c.env.DB.prepare(
    `SELECT
       SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress,
       SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) AS approved,
       SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS rejected,
       COUNT(*) AS total
     FROM approval_instance`
  ).first<{
    in_progress: number | null;
    approved: number | null;
    rejected: number | null;
    total: number | null;
  }>();

  return c.json({
    success: true,
    data: {
      in_progress: row?.in_progress ?? 0,
      approved: row?.approved ?? 0,
      rejected: row?.rejected ?? 0,
      total: row?.total ?? 0
    }
  });
});
```

- [ ] **Step 4: 测试通过 + typecheck + lint**

Run: `cd packages/api && npx vitest run src/routes/approval-admin-summary.test.ts && npm run typecheck && npx eslint src/routes/approval.ts`
Expected: 全 PASS

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/routes/approval.ts packages/api/src/routes/approval-admin-summary.test.ts
git commit -m "feat(api): 新增审批监控台聚合计数端点 admin/summary"
```

---

### Task 2: API — `admin/all` 放开 manager 读

**Files:**
- Test: `packages/api/src/routes/approval-admin-all-role.test.ts`(新建)
- Modify: `packages/api/src/routes/approval.ts`(admin/all 路由角色判定,约 639 行)

- [ ] **Step 1: 写失败测试**

新建 `packages/api/src/routes/approval-admin-all-role.test.ts`(同上 mock 骨架,DB 的 `first` 对 count 返回 `{ total: 0 }`、`all` 返回 `{ results: [] }`):

```ts
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthTokenPayload } from "../types/auth";
import type { Env } from "../types/env";
import { approvalRoutes } from "./approval";

const mockAuthState = vi.hoisted(() => ({
  payload: {
    sub: "mgr-a",
    username: "mgr-a",
    nickname: "Manager A",
    avatar: "",
    roles: ["manager"],
    permissions: [],
    tokenId: "token-a",
    type: "access",
    auth_method: "wecom_oauth",
    wecom_verified_at: "2026-07-01T00:00:00.000Z",
    exp: 4102444800,
    iat: 1770000000
  } as AuthTokenPayload
}));

vi.mock("../services/auth", () => ({
  verifyToken: async (): Promise<AuthTokenPayload> => mockAuthState.payload
}));

class Stmt {
  constructor(private readonly sql: string) {}
  bind() {
    return this;
  }
  async first<T>(): Promise<T | null> {
    if (this.sql.includes("COUNT(*)")) return { total: 0 } as T;
    return null;
  }
  async all<T>(): Promise<{ results: T[] }> {
    return { results: [] as T[] };
  }
  async run() {
    return { meta: { last_row_id: 1, changes: 1 } };
  }
}

const createEnv = () =>
  ({
    DB: { prepare: (sql: string) => new Stmt(sql) },
    KV: { async get() { return "session"; } }
  }) as unknown as Env;

const requestAll = () => {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/approval", approvalRoutes);
  return app.request(
    "/approval/admin/all?page=1&pageSize=30",
    { headers: { authorization: "Bearer test-token" } },
    createEnv()
  );
};

describe("approval admin/all role access", () => {
  beforeEach(() => {
    mockAuthState.payload = { ...mockAuthState.payload, roles: ["manager"] };
  });

  it("allows manager (read-only monitoring)", async () => {
    const response = await requestAll();
    expect(response.status).toBe(200);
  });

  it("allows super_admin", async () => {
    mockAuthState.payload = { ...mockAuthState.payload, roles: ["super_admin"] };
    const response = await requestAll();
    expect(response.status).toBe(200);
  });

  it("rejects operator", async () => {
    mockAuthState.payload = { ...mockAuthState.payload, roles: ["operator"] };
    const response = await requestAll();
    expect(response.status).toBe(403);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/api && npx vitest run src/routes/approval-admin-all-role.test.ts`
Expected: FAIL(manager 现在被 403)

- [ ] **Step 3: 放开 manager**

`approval.ts` 的 `admin/all` 路由内,把:

```ts
  if (!auth.roles.includes("super_admin")) {
    return c.json({ success: false, error: { message: "Forbidden" } }, 403);
  }
```

改为:

```ts
  if (!auth.roles.includes("super_admin") && !auth.roles.includes("manager")) {
    return c.json({ success: false, error: { message: "Forbidden" } }, 403);
  }
```

其余逻辑不动。

- [ ] **Step 4: 测试通过 + 无回归**

Run: `cd packages/api && npx vitest run src/routes/approval-admin-all-role.test.ts src/routes/approval-admin-summary.test.ts && npm run typecheck`
Expected: 全 PASS

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/routes/approval.ts packages/api/src/routes/approval-admin-all-role.test.ts
git commit -m "feat(api): 审批监控 admin/all 放开 manager 只读"
```

---

### Task 3: Web API 封装

**Files:**
- Modify: `packages/web/src/api/approval.ts`

- [ ] **Step 1: 补类型与请求函数**

在 `listAllApprovalInstances` 定义之后(约 210 行)新增:

```ts
export type ApprovalAdminSummary = {
  in_progress: number;
  approved: number;
  rejected: number;
  total: number;
};

export const getApprovalAdminSummary = () => {
  return http.request<{ success: boolean; data: ApprovalAdminSummary }>(
    "get",
    "/api/v1/approval/admin/summary"
  );
};
```

- [ ] **Step 2: typecheck + commit**

Run: `cd packages/web && npm run typecheck`
Expected: PASS

```bash
git add packages/web/src/api/approval.ts
git commit -m "feat(web): 审批监控台汇总接口封装"
```

---

### Task 4: detail.vue 返回来源感知

**Files:**
- Modify: `packages/web/src/views/approval/detail.vue`

- [ ] **Step 1: 改返回逻辑**

`detail.vue` 中:保留 `pendingApprovalRoute`(第 58 行)与 `notifySuccessAndGoPending`(动作完成后回个人待办,不动)。把 `goBack`(第 1305 行 `const goBack = () => router.push(pendingApprovalRoute);`)替换为来源感知:

```ts
const goBack = () => {
  const from = route.query.from;
  if (from === "monitor") {
    router.push({ path: "/approval/admin-monitor" });
    return;
  }
  if (from === "desk") {
    router.push({ path: "/approval/index" });
    return;
  }
  if (typeof window !== "undefined" && window.history.length > 1) {
    router.back();
    return;
  }
  router.push(pendingApprovalRoute);
};
```

`route` 已在文件顶部 `const route = useRoute();`(第 55 行)存在,`useRoute` 已 import。`el-page-header @back="goBack"` 不变。

- [ ] **Step 2: 验证**

Run: `cd packages/web && npm run typecheck && npx eslint src/views/approval/detail.vue`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/views/approval/detail.vue
git commit -m "fix(web): 审批详情返回改为来源感知(修监控台返回丢失)"
```

---

### Task 5: index.vue 待审批行内联审批 + 详情带 from

**Files:**
- Modify: `packages/web/src/views/approval/index.vue`

先通读现 `index.vue`(待审批表格约 219-295 行、`gotoDetail` 约 118 行、脚本区 import 约 4-14 行)。

- [ ] **Step 1: script 增加内联审批动作**

import 区补入(现有从 `@/api/approval` import 的清单里加):

```ts
import {
  listPendingApprovals,
  listProcessedApprovals,
  listCcApprovals,
  approveApproval,
  rejectApproval,
  transferApproval,
  type PendingApprovalItem,
  type ProcessedApprovalItem,
  type ApprovalInstance
} from "@/api/approval";
import { message } from "@/utils/message";
```

`message` 若已 import 则不重复;`wecomUsers` 已由 `useWecomUserOptions()` 提供(第 19 行)。在 `gotoDetail` 附近新增内联动作状态与处理:

```ts
type QuickAction = "approve" | "reject" | "transfer";

const quickDialogVisible = ref(false);
const quickAction = ref<QuickAction>("approve");
const quickRow = ref<PendingApprovalItem | null>(null);
const quickComment = ref("");
const quickTransferTo = ref("");
const quickLoading = ref(false);

const quickDialogTitle = computed(() => {
  if (quickAction.value === "approve") return "通过审批";
  if (quickAction.value === "reject") return "驳回审批";
  return "转签审批";
});

const openQuickAction = (row: PendingApprovalItem, action: QuickAction) => {
  quickRow.value = row;
  quickAction.value = action;
  quickComment.value = "";
  quickTransferTo.value = "";
  quickDialogVisible.value = true;
};

const submitQuickAction = async () => {
  const row = quickRow.value;
  if (!row) return;
  const comment = quickComment.value.trim();
  if (quickAction.value === "reject" && !comment) {
    message("驳回时请填写意见", { type: "warning" });
    return;
  }
  if (quickAction.value === "transfer") {
    if (!quickTransferTo.value.trim()) {
      message("请选择转签对象", { type: "warning" });
      return;
    }
    if (!comment) {
      message("转签时请填写原因", { type: "warning" });
      return;
    }
  }
  quickLoading.value = true;
  try {
    if (quickAction.value === "approve") {
      await approveApproval(row.id, { comment: comment || undefined });
      message("已通过", { type: "success" });
    } else if (quickAction.value === "reject") {
      await rejectApproval(row.id, { comment });
      message("已驳回", { type: "success" });
    } else {
      await transferApproval(row.id, {
        to_userid: quickTransferTo.value.trim(),
        reason: comment
      });
      message("已转签", { type: "success" });
    }
    quickDialogVisible.value = false;
    await loadPending();
  } finally {
    quickLoading.value = false;
  }
};
```

`gotoDetail` 改为带来源:

```ts
const gotoDetail = (id: number) => {
  router.push(`/approval/detail/${id}?from=desk`);
};
```

- [ ] **Step 2: 待审批表格加操作列**

在待审批 `<el-table>`(name="pending")最后一列「状态」之后追加操作列(注意该表格有 `@row-click` 进详情,内联按钮需 `@click.stop`):

```vue
<el-table-column label="操作" width="220" fixed="right">
  <template #default="{ row }">
    <el-button link type="success" @click.stop="openQuickAction(row, 'approve')">通过</el-button>
    <el-button link type="danger" @click.stop="openQuickAction(row, 'reject')">驳回</el-button>
    <el-button link type="warning" @click.stop="openQuickAction(row, 'transfer')">转签</el-button>
    <el-button link type="primary" @click.stop="gotoDetail(row.id)">详情</el-button>
  </template>
</el-table-column>
```

在 `</el-tabs>` 之后、`</el-card>` 之前加内联审批对话框:

```vue
<el-dialog v-model="quickDialogVisible" :title="quickDialogTitle" width="520px">
  <div v-if="quickRow" style="margin-bottom: 10px; color: #6b7280; font-size: 13px">
    {{ bizTypeLabel(quickRow.biz_type) }} · {{ quickRow.biz_summary }}
  </div>
  <el-select
    v-if="quickAction === 'transfer'"
    v-model="quickTransferTo"
    clearable
    filterable
    placeholder="选择转签人员"
    style="width: 100%; margin-bottom: 10px"
  >
    <el-option
      v-for="item in wecomUsers"
      :key="item.userid"
      :label="`${item.name} (${item.userid})`"
      :value="item.userid"
    />
  </el-select>
  <el-input
    v-model="quickComment"
    type="textarea"
    :rows="3"
    :placeholder="
      quickAction === 'approve'
        ? '审批意见(可选)'
        : quickAction === 'reject'
          ? '驳回意见(必填)'
          : '转签原因(必填)'
    "
  />
  <template #footer>
    <el-button @click="quickDialogVisible = false">取消</el-button>
    <el-button type="primary" :loading="quickLoading" @click="submitQuickAction">确认</el-button>
  </template>
</el-dialog>
```

- [ ] **Step 3: 验证**

Run: `cd packages/web && npm run typecheck && npm run build && npx eslint src/views/approval/index.vue`
Expected: PASS。dev 手测:待审批行 通过/驳回(必填意见)/转签(选人+原因)后条目流出;详情跳转带 `?from=desk`;已处理/抄送页签行为不变。

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/views/approval/index.vue
git commit -m "feat(web): 审批中心待审批行内联通过/驳回/转签"
```

---

### Task 6: admin-monitor.vue 状态改四页签 + 去 localStorage

**Files:**
- Rewrite(局部大改): `packages/web/src/views/approval/admin-monitor.vue`

先通读现文件(尤其 40-195 行的 filter/localStorage 逻辑、340-408 行的 filter 表单、449-469 行操作列、强制通过/转签对话框全部保留)。

- [ ] **Step 1: script 改状态为页签,移除 localStorage**

删除:`import { storageLocal } from "@pureadmin/utils";`、`AdminMonitorFilterState` 中的 `status`、`defaultStatusFilter`、`filterStorageKey`、`restoreFilters`、`persistFilters`、`watch(filters, persistFilters)`、`statusOptions`。`filters` 收敛为不含 status:

```ts
const filters = reactive({
  biz_type: "",
  initiator: "",
  keyword: ""
});
```

新增页签与计数:

```ts
import { getApprovalAdminSummary, type ApprovalAdminSummary } from "@/api/approval";

type MonitorTab = "in_progress" | "approved" | "rejected" | "all";

const TAB_STATUS: Record<MonitorTab, string> = {
  in_progress: "in_progress",
  approved: "approved",
  rejected: "rejected",
  all: ""
};

const activeTab = ref<MonitorTab>("in_progress");
const summary = ref<ApprovalAdminSummary | null>(null);

const monitorTabs = computed(() => [
  { key: "in_progress" as MonitorTab, label: "进行中", count: summary.value?.in_progress },
  { key: "approved" as MonitorTab, label: "已通过", count: summary.value?.approved },
  { key: "rejected" as MonitorTab, label: "已驳回", count: summary.value?.rejected },
  { key: "all" as MonitorTab, label: "全部", count: undefined }
]);

const loadSummary = async () => {
  try {
    const result = await getApprovalAdminSummary();
    summary.value = result.data;
  } catch {
    summary.value = null;
  }
};
```

`loadList` 改为按当前页签传 status(其余 biz_type/initiator/keyword 不变):

```ts
const loadList = async () => {
  loading.value = true;
  try {
    const statusParam = TAB_STATUS[activeTab.value];
    const result = await listAllApprovalInstances({
      biz_type: filters.biz_type || undefined,
      status: statusParam || undefined,
      initiator: filters.initiator.trim() || undefined,
      keyword: filters.keyword.trim() || undefined,
      page: page.value,
      pageSize: pageSize.value
    });
    list.value = result.data;
    total.value = result.pagination.total;
  } finally {
    loading.value = false;
  }
};

const switchTab = (tab: MonitorTab) => {
  activeTab.value = tab;
  page.value = 1;
  loadList();
};
```

`handleSearch` 保留(次级筛选查询,page 归零后 loadList);`handleReset` 改为只重置 biz_type/initiator/keyword(不含 status):

```ts
const handleReset = async () => {
  filters.biz_type = "";
  filters.initiator = "";
  filters.keyword = "";
  page.value = 1;
  await loadList();
};
```

`onMounted` 改为:

```ts
onMounted(async () => {
  await Promise.all([loadWecomUsers(), loadSummary(), loadList()]);
});
```

动作成功后(submitForceApprove / submitForceTransfer 里的 `await loadList()`)追加 `await loadSummary()` 以刷新徽标。

- [ ] **Step 2: 模板加页签、去状态筛选、详情带 from**

在 `<el-form inline>` 之前插入页签条:

```vue
<el-tabs :model-value="activeTab" @tab-change="key => switchTab(key as MonitorTab)" style="margin-bottom: 8px">
  <el-tab-pane v-for="tab in monitorTabs" :key="tab.key" :name="tab.key">
    <template #label>
      {{ tab.label
      }}<el-badge v-if="tab.count" :value="tab.count" :max="999" style="margin-left: 4px" />
    </template>
  </el-tab-pane>
</el-tabs>
```

删除筛选表单里的「状态」`<el-form-item label="状态">...</el-form-item>` 整块;biz_type/发起人/关键字/查询/重置/刷新保留。操作列的详情链接改带 from:

```vue
<router-link :to="`/approval/detail/${row.id}?from=monitor`">查看详情</router-link>
```

强制通过/强制转签按钮(`v-if="isSuperAdmin && row.status === 'in_progress'"`)与两个对话框全部保留不动。

- [ ] **Step 3: 验证**

Run: `cd packages/web && npm run typecheck && npm run build && npx eslint src/views/approval/admin-monitor.vue`
Expected: PASS。dev 手测:四页签切换 + 徽标;次级筛选;超管强制通过/转签仍可用;详情链接带 `?from=monitor`。

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/views/approval/admin-monitor.vue
git commit -m "feat(web): 审批监控台状态改四页签并移除筛选记忆"
```

---

### Task 7: 删除 unified-tasklist + 路由收敛

**Files:**
- Delete: `packages/web/src/views/approval/unified-tasklist.vue`
- Modify: `packages/web/src/router/modules/approval.ts`

- [ ] **Step 1: grep 确认无残留引用**

Run: `cd packages/web && grep -rn "unified-tasklist\|ApprovalUnifiedTasklist" src/`
预期:仅路由定义 + 文件自身。若有其它跳转(如菜单硬链接)记录并在 Step 2 一并处理。

- [ ] **Step 2: 删除文件 + 改路由**

删除 `packages/web/src/views/approval/unified-tasklist.vue`。

`packages/web/src/router/modules/approval.ts` 中,`/approval/unified-tasklist` 条目改为 redirect(移除 component,加 showLink:false):

```ts
{
  path: "/approval/unified-tasklist",
  name: "ApprovalUnifiedTasklist",
  redirect: "/approval/index",
  meta: {
    title: "统一审批台(旧路径)",
    showLink: false
  }
},
```

`/approval/admin-monitor` 条目 meta.roles 由 `["super_admin"]` 改为 `["super_admin", "manager"]`。

- [ ] **Step 3: 验证**

Run: `cd packages/web && npm run typecheck && npm run build`
Expected: PASS。dev 手测:`/approval/unified-tasklist` 302 到 `/approval/index`;导航菜单不再有「统一审批台」;manager 账号可进 `/approval/admin-monitor`。

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/views/approval/ packages/web/src/router/modules/approval.ts
git commit -m "refactor(web): 删除薄版统一审批台并放开监控台 manager 访问"
```

---

### Task 8: 文档同步归档

**Files:**
- Modify: `doc/UI设计文档.md`(审批相关章节)、`doc/开发记录.md`(文末追加)
- Move: 本设计与计划 → `docs/archive/`;更新两处 README

- [ ] **Step 1: UI设计文档**:找到审批中心/审批台/监控台相关节改写:审批中心成为唯一审批台(待审批行内联通过/驳回/转签);统一审批台已删除(旧路径 302);监控台状态改四页签 + biz_type/发起人/关键字次级筛选 + manager 只读 + admin/summary 计数;详情返回来源感知(?from=)。风格与文档现有条目一致。
- [ ] **Step 2: 开发记录**文末追加 `## 2026-07-09 <时:分> (AEST)`,含目标/根因(两台重复、返回硬编码、监控用筛选)/变更(API/Web 两块列全部提交)/验证(先实跑 `cd packages/api && npx vitest run 2>&1 | tail -3` 取真实数字)/上线(随 push 自动部署,无迁移)。
- [ ] **Step 3: 移档 + commit**

```bash
git mv docs/planned/2026-07-09-approval-flow-optimization-design.md docs/archive/
git mv docs/planned/2026-07-09-approval-flow-optimization-plan.md docs/archive/
# docs/planned/README.md:清单恢复「暂无待实现计划。」
# docs/archive/README.md:按其既有列表格式补记这两个文档
git add doc/ docs/
git commit -m "docs: 审批流转优化实现记录与设计归档"
```

---

### Task 9: 整体验证与发布

- [ ] **Step 1: 全量测试** — `cd packages/api && npx vitest run && npm run typecheck && npm run lint`(全 PASS)
- [ ] **Step 2: Web 构建** — `cd packages/web && npm run typecheck && npm run build`(PASS)
- [ ] **Step 3: 关键动线手测**
  - 审批中心:待审批行内联 通过/驳回(必填意见)/转签(选人+原因)后条目流出;详情往返(带 from=desk 返回回审批中心);已处理/抄送不回归。
  - 监控台:四页签切换 + 徽标计数 + 次级筛选;manager 只读进入、无强制按钮;超管强制通过/转签可用;详情往返(from=monitor 返回回监控台)。
  - 返回 bug:监控台→详情→返回→监控台;审批中心→详情→返回→审批中心;直开详情 URL(无 from)→返回→ router.back 或 /approval/index。
  - `/approval/unified-tasklist` 旧链接 302 到 /approval/index;导航无「统一审批台」。
- [ ] **Step 4: 一次性 push(即部署)**

```bash
git push
```

推送后:`https://api.hybcdg.com/api/v1/system/health` 返回 ok=true;线上抽查 admin/summary 与监控台页签、审批中心内联动作。

---

## Self-Review 记录

- 规格覆盖:设计一(统一台)→Task 5+7;二(返回修复)→Task 4(+ Task 5/6 补 from);三(监控台 Tabs + manager)→Task 6+7+Task 2;四(API)→Task 1-3;五(测试文档)→Task 8-9。
- 占位符:无 TBD;每个改动给出完整代码或精确锚点(detail.vue goBack 全量、index.vue 内联动作全量 SFC 片段、admin-monitor 局部改法逐条)。
- 类型一致性:`ApprovalAdminSummary` 四字段贯穿 API 返回、web 类型、monitor 徽标;`MonitorTab`/`TAB_STATUS`/`QuickAction` 联合类型在各自任务内自洽;`approveApproval/rejectApproval/transferApproval` 签名与现 web api 一致(approve/reject 收 `{comment}`,transfer 收 `{to_userid, reason}`)。
- 已知取舍:内联审批复用 unified-tasklist 已验证的调用(approve/reject/transfer 按当前用户解析待办任务),仅迁移 UI 位置;`?from=` 缺省回退与现状一致,老入口零回归。
