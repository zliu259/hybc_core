# 对外付款 UI/UX 优化(付款处理台)实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按已批准设计 [2026-07-08-payment-uiux-console-design.md](./2026-07-08-payment-uiux-console-design.md) 落地付款处理台:创建统一走向导、列表按阶段页签管理、详情页拆分瘦身、小程序两页对齐。

**Architecture:** API 先行(列表补 `approval_status` 字段 + 新增 `console-summary` 聚合端点,均 TDD);Web 端重构列表页为阶段式处理台、拆分 1847 行详情页为容器+4 组件、旧创建路由重定向向导;小程序付款查询加阶段页签、付款申请改三步分段。

**Tech Stack:** Hono + D1(vitest 测试)/ Vue 3 + Element Plus + PureAdmin / 企微小程序原生。

**部署与提交约定(重要):** 本仓库 push 到 main 即自动部署生产。因此:每个 Task 完成后**本地 commit,不 push**;全部 Task 完成并通过 Task 10 的整体验证后,一次性 push。无 D1 迁移。

---

## 文件结构总览

| 动作 | 文件 | 职责 |
|---|---|---|
| Modify | `packages/api/src/routes/payment.ts` | 列表 JOIN approval_status;新增 console-summary 路由 |
| Create | `packages/api/src/routes/payment-list-approval-status.test.ts` | 列表新字段测试 |
| Create | `packages/api/src/routes/payment-console-summary.test.ts` | 汇总端点测试(含角色门槛) |
| Modify | `packages/web/src/api/payment.ts` | PaymentRequest 补字段;新增 summary 类型与请求 |
| Create | `packages/web/src/views/finance/payment/payment-labels.ts` | 共享状态/方式标签映射与时间格式化 |
| Rewrite | `packages/web/src/views/finance/payment/index.vue` | 付款处理台(汇总条+阶段页签+行内动作) |
| Modify | `packages/web/src/router/modules/finance.ts` / `workspace.ts` | detail/create → wizard 重定向 |
| Create | `packages/web/src/views/finance/payment/components/AdminEditPanel.vue` | 超管编辑模式卡片 |
| Create | `packages/web/src/views/finance/payment/components/ApprovalActionPanel.vue` | 审批轨迹/风险展示与跳转 |
| Create | `packages/web/src/views/finance/payment/components/PayoutPanel.vue` | 标记付款/作废/激活/付款主体调整 |
| Create | `packages/web/src/views/finance/payment/components/PaymentInfoCard.vue` | 申请信息展示/编辑/附件/提审 |
| Rewrite | `packages/web/src/views/finance/payment/detail.vue` | 容器(<800 行),废除创建模式,支持 ?edit=1 |
| Modify | `packages/miniapp/pages/query-payment/index.{js,wxml,wxss}` | 阶段页签 + 退回件去修改 |
| Modify | `packages/miniapp/utils/returned-approval.js`(+test) | 确认/补充 payment_request 支持 |
| Modify | `packages/miniapp/pages/payment-apply/index.{js,wxml,wxss}` | 三步分段 |
| Modify | `doc/UI设计文档.md`、`doc/开发记录.md` | 文档同步 |

---

### Task 1: API — 付款列表返回 `approval_status`

**Files:**
- Test: `packages/api/src/routes/payment-list-approval-status.test.ts`(新建)
- Modify: `packages/api/src/routes/payment.ts:495-586`(GET `/` 列表路由)

- [ ] **Step 1: 写失败测试**

新建 `packages/api/src/routes/payment-list-approval-status.test.ts`(mock 模式仿照同目录 `payment-returned-edit.test.ts`):

```ts
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import type { AuthTokenPayload } from "../types/auth";
import type { Env } from "../types/env";
import { paymentRoutes } from "./payment";

const mockAuthState = vi.hoisted(() => ({
  payload: {
    sub: "finance-a",
    username: "finance-a",
    nickname: "Finance A",
    avatar: "",
    roles: ["finance"],
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

class ListStatement {
  private params: unknown[] = [];

  constructor(
    private readonly db: ListDb,
    private readonly sql: string
  ) {}

  bind(...params: unknown[]) {
    this.params = params;
    return this;
  }

  async first<T>(): Promise<T | null> {
    if (this.sql.includes("COUNT(*) as total")) {
      return { total: 1 } as T;
    }
    return null;
  }

  async all<T>(): Promise<{ results: T[] }> {
    this.db.listSql = this.sql;
    return {
      results: [
        {
          id: 108,
          serial_no: "PAY-108",
          status: "draft",
          approval_instance_id: 191,
          approval_status: "returned",
          amount: 500
        } as T
      ]
    };
  }

  async run() {
    return { meta: { last_row_id: 1, changes: 1 } };
  }
}

class ListDb {
  listSql = "";

  prepare(sql: string) {
    return new ListStatement(this, sql);
  }
}

const createEnv = (db: ListDb) =>
  ({
    DB: db,
    KV: {
      async get() {
        return "session";
      }
    }
  }) as unknown as Env & { DB: ListDb };

describe("payment list approval_status", () => {
  it("left-joins approval_instance and returns approval_status per row", async () => {
    const db = new ListDb();
    const app = new Hono<{ Bindings: Env }>();
    app.route("/payment", paymentRoutes);

    const response = await app.request(
      "/payment/?page=1&pageSize=20",
      { headers: { authorization: "Bearer test-token" } },
      createEnv(db)
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      data: Array<{ approval_status: string | null }>;
    };
    expect(payload.data[0].approval_status).toBe("returned");
    expect(db.listSql).toContain("LEFT JOIN approval_instance");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/api && npx vitest run src/routes/payment-list-approval-status.test.ts`
Expected: FAIL(`listSql` 不含 LEFT JOIN;mock 行虽带字段但断言 SQL 失败)

- [ ] **Step 3: 改列表 SQL(全部列限定 `p.` 前缀)**

`payment.ts` GET `/` 内(512-517 行起)替换:

```ts
let sql = includeCancelled
  ? "SELECT p.*, ai.status AS approval_status FROM payment_request p LEFT JOIN approval_instance ai ON ai.id = p.approval_instance_id WHERE 1=1"
  : "SELECT p.*, ai.status AS approval_status FROM payment_request p LEFT JOIN approval_instance ai ON ai.id = p.approval_instance_id WHERE p.status != 'cancelled'";
let countSql = includeCancelled
  ? "SELECT COUNT(*) as total FROM payment_request p WHERE 1=1"
  : "SELECT COUNT(*) as total FROM payment_request p WHERE p.status != 'cancelled'";
```

随后把该路由内**所有**追加条件的列名加 `p.` 前缀(sql 与 countSql 共用同一批字符串,别名一致后两边都合法):`p.contract_id`、`p.project_id`、`p.status`、`p.serial_no`、`p.content`、`p.legacy_data_id`、`p.applicant_userid`、`p.expected_payment_date`;项目名子查询改为 `p.project_id IN (SELECT ...)`;排序改 `ORDER BY p.id DESC`。行类型:

```ts
type PaymentRequestListRow = PaymentRequest & { approval_status: string | null };
// rows 查询处:
const rows = await c.env.DB.prepare(sql)
  .bind(...params, pageSize, offset)
  .all<PaymentRequestListRow>();
```

- [ ] **Step 4: 测试通过 + 无回归**

Run: `cd packages/api && npx vitest run src/routes/payment-list-approval-status.test.ts src/routes/payment-returned-edit.test.ts src/routes/payment-submit-reconcile.test.ts`
Expected: 全 PASS

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/routes/payment.ts packages/api/src/routes/payment-list-approval-status.test.ts
git commit -m "feat(api): 付款列表返回 approval_status 以区分草稿与退回"
```

---

### Task 2: API — `GET /api/v1/payment/console-summary`

**Files:**
- Test: `packages/api/src/routes/payment-console-summary.test.ts`(新建)
- Modify: `packages/api/src/routes/payment.ts`(在 GET `/` 之前注册,务必先于 `/:id`)

- [ ] **Step 1: 写失败测试**

```ts
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthTokenPayload } from "../types/auth";
import type { Env } from "../types/env";
import { paymentRoutes } from "./payment";

const mockAuthState = vi.hoisted(() => ({
  payload: {
    sub: "finance-a",
    username: "finance-a",
    nickname: "Finance A",
    avatar: "",
    roles: ["finance"],
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
  constructor(private readonly sql: string) {}

  bind() {
    return this;
  }

  async first<T>(): Promise<T | null> {
    if (this.sql.includes("pending_count")) {
      return {
        pending_count: 5,
        returned_count: 2,
        in_approval_count: 8,
        to_pay_count: 3,
        to_pay_total: 1280000,
        overdue_count: 3,
        paid_month_total: 860000
      } as T;
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

const createEnv = () =>
  ({
    DB: { prepare: (sql: string) => new SummaryStatement(sql) },
    KV: {
      async get() {
        return "session";
      }
    }
  }) as unknown as Env;

const requestSummary = () => {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/payment", paymentRoutes);
  return app.request(
    "/payment/console-summary",
    { headers: { authorization: "Bearer test-token" } },
    createEnv()
  );
};

describe("payment console summary", () => {
  beforeEach(() => {
    mockAuthState.payload = { ...mockAuthState.payload, roles: ["finance"] };
  });

  it("returns aggregated stage counts and totals for finance role", async () => {
    const response = await requestSummary();

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      data: { to_pay_total: number; returned_count: number; overdue_count: number };
    };
    expect(payload.data.to_pay_total).toBe(1280000);
    expect(payload.data.returned_count).toBe(2);
    expect(payload.data.overdue_count).toBe(3);
  });

  it("rejects operator role (global totals must not leak)", async () => {
    mockAuthState.payload = { ...mockAuthState.payload, roles: ["operator"] };

    const response = await requestSummary();

    expect(response.status).toBe(403);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/api && npx vitest run src/routes/payment-console-summary.test.ts`
Expected: FAIL(404,路由不存在)

- [ ] **Step 3: 实现路由**

在 `payment.ts` 的 GET `/` 路由(495 行)之前插入。复用状态语义中心化(`RESUBMITTABLE_STATUSES` 已在文件 import 行补充):

```ts
import { isApprovalActive, isOwnerReworkState, isResubmittable, RESUBMITTABLE_STATUSES } from "../services/approval/status";

const RESUBMITTABLE_SQL_LIST = RESUBMITTABLE_STATUSES.map((s) => `'${s}'`).join(", ");

paymentRoutes.get(
  "/console-summary",
  requireRoles(["super_admin", "manager", "finance"]),
  async (c) => {
    const row = await c.env.DB.prepare(
      `SELECT
         SUM(CASE WHEN p.status = 'draft' THEN 1 ELSE 0 END) AS pending_count,
         SUM(CASE WHEN p.status = 'draft' AND ai.status IN (${RESUBMITTABLE_SQL_LIST}) THEN 1 ELSE 0 END) AS returned_count,
         SUM(CASE WHEN p.status = 'pending_approval' THEN 1 ELSE 0 END) AS in_approval_count,
         SUM(CASE WHEN p.status = 'approved' THEN 1 ELSE 0 END) AS to_pay_count,
         SUM(CASE WHEN p.status = 'approved' THEN p.amount ELSE 0 END) AS to_pay_total,
         SUM(CASE WHEN p.status = 'approved' AND p.expected_payment_date < date('now') THEN 1 ELSE 0 END) AS overdue_count,
         SUM(CASE WHEN p.status = 'paid' AND substr(p.paid_at, 1, 7) = strftime('%Y-%m', 'now') THEN p.amount ELSE 0 END) AS paid_month_total
       FROM payment_request p
       LEFT JOIN approval_instance ai ON ai.id = p.approval_instance_id
       WHERE p.status != 'cancelled'`
    ).first<{
      pending_count: number | null;
      returned_count: number | null;
      in_approval_count: number | null;
      to_pay_count: number | null;
      to_pay_total: number | null;
      overdue_count: number | null;
      paid_month_total: number | null;
    }>();

    return c.json({
      success: true,
      data: {
        pending_count: row?.pending_count ?? 0,
        returned_count: row?.returned_count ?? 0,
        in_approval_count: row?.in_approval_count ?? 0,
        to_pay_count: row?.to_pay_count ?? 0,
        to_pay_total: row?.to_pay_total ?? 0,
        overdue_count: row?.overdue_count ?? 0,
        paid_month_total: row?.paid_month_total ?? 0
      }
    });
  }
);
```

说明:`requireRoles` 本文件已 import(PUT 路由在用);路由注册在 `/:id`(现 588 行)之前,静态段优先匹配,双保险。

- [ ] **Step 4: 测试通过 + typecheck + lint**

Run: `cd packages/api && npx vitest run src/routes/payment-console-summary.test.ts && npm run typecheck && npx eslint src/routes/payment.ts`
Expected: 全 PASS / 无错误

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/routes/payment.ts packages/api/src/routes/payment-console-summary.test.ts
git commit -m "feat(api): 新增付款处理台聚合汇总端点 console-summary"
```

---

### Task 3: Web API 封装

**Files:**
- Modify: `packages/web/src/api/payment.ts`

- [ ] **Step 1: 补类型与请求函数**

`PaymentRequest` type(第 4-31 行)`updated_at` 后追加:

```ts
  approval_status?: string | null;
```

`listPaymentRequests` 之后新增:

```ts
export type PaymentConsoleSummary = {
  pending_count: number;
  returned_count: number;
  in_approval_count: number;
  to_pay_count: number;
  to_pay_total: number;
  overdue_count: number;
  paid_month_total: number;
};

export const getPaymentConsoleSummary = () => {
  return http.request<{ success: boolean; data: PaymentConsoleSummary }>(
    "get",
    "/api/v1/payment/console-summary"
  );
};
```

- [ ] **Step 2: typecheck 后提交**

Run: `cd packages/web && npm run typecheck`
Expected: PASS

```bash
git add packages/web/src/api/payment.ts
git commit -m "feat(web): 付款汇总接口封装与 approval_status 字段类型"
```

---

### Task 4: Web — 共享标签模块 + 付款处理台重构

**Files:**
- Create: `packages/web/src/views/finance/payment/payment-labels.ts`
- Rewrite: `packages/web/src/views/finance/payment/index.vue`

- [ ] **Step 1: 新建共享标签模块**

`payment-labels.ts`(内容从现 index.vue 提取,后续 detail 拆分组件复用):

```ts
export type PaymentTagType = "primary" | "success" | "warning" | "danger" | "info";

export const paymentStatusTagType: Record<string, PaymentTagType> = {
  draft: "info",
  pending_approval: "warning",
  approved: "success",
  paid: "primary",
  rejected: "danger",
  cancelled: "info"
};

export const paymentStatusLabelMap: Record<string, string> = {
  draft: "草稿",
  pending_approval: "待审批",
  approved: "已审批",
  paid: "已付款",
  rejected: "已拒绝",
  cancelled: "已取消"
};

export const paymentMethodLabelMap: Record<string, string> = {
  bank_transfer: "对公转账",
  cash: "现金",
  bill: "票据",
  other: "其他",
  对公转账: "对公转账",
  现金: "现金",
  票据: "票据",
  其他: "其他"
};

export const toPaymentStatusLabel = (value: string | null | undefined): string =>
  value ? (paymentStatusLabelMap[value] ?? value) : "-";

export const toPaymentMethodLabel = (value: string | null | undefined): string =>
  value ? (paymentMethodLabelMap[value] ?? value) : "-";

export const formatBeijingDateTime = (value: string | null | undefined): string => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date
    .toLocaleString("zh-CN", {
      timeZone: "Asia/Shanghai",
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    })
    .replace(/\//g, "-");
};
```

- [ ] **Step 2: 重写 index.vue 为付款处理台**

要点(完整结构如下,行内动作/页签/汇总条按此实现;AI 风险列、金额大写列保留原样迁移):

```vue
<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { message } from "@/utils/message";
import {
  getPaymentConsoleSummary,
  listPaymentRequests,
  markPaymentPaid,
  type PaymentConsoleSummary,
  type PaymentRequest
} from "@/api/payment";
import { listProjects, type Project } from "@/api/project";
import { useWecomUserOptions } from "@/composables/useWecomUserOptions";
import {
  formatBeijingDateTime,
  paymentStatusTagType,
  toPaymentMethodLabel,
  toPaymentStatusLabel
} from "./payment-labels";

defineOptions({ name: "PaymentList" });

type Stage = "pending" | "in_approval" | "to_pay" | "paid" | "all";

const STAGE_STATUS: Record<Stage, string> = {
  pending: "draft",
  in_approval: "pending_approval",
  to_pay: "approved",
  paid: "paid",
  all: ""
};

const RESUBMITTABLE = new Set(["returned", "pending", "withdrawn"]);

const router = useRouter();
const loading = ref(false);
const list = ref<PaymentRequest[]>([]);
const projects = ref<Project[]>([]);
const { wecomUsers, loadWecomUsers } = useWecomUserOptions();
const summary = ref<PaymentConsoleSummary | null>(null);
const stage = ref<Stage>("pending");
const page = ref(1);
const pageSize = ref(20);
const total = ref(0);
const filters = ref({
  project_id: undefined as number | undefined,
  applicant_userid: "",
  keyword: ""
});

const todayStr = new Date().toISOString().slice(0, 10);

const isReturned = (row: PaymentRequest) =>
  row.status === "draft" && RESUBMITTABLE.has(row.approval_status ?? "");

const isOverdue = (row: PaymentRequest) =>
  row.status === "approved" && row.expected_payment_date < todayStr;

const displayList = computed(() => {
  if (stage.value !== "to_pay") return list.value;
  return [...list.value].sort((a, b) => Number(isOverdue(b)) - Number(isOverdue(a)));
});

const projectMap = computed(() => {
  const map: Record<number, string> = {};
  projects.value.forEach(item => {
    map[item.id] = item.project_name;
  });
  return map;
});

const stageTabs = computed(() => [
  { key: "pending" as Stage, label: "待处理", count: summary.value?.pending_count },
  { key: "in_approval" as Stage, label: "审批中", count: summary.value?.in_approval_count },
  { key: "to_pay" as Stage, label: "待付款", count: summary.value?.to_pay_count },
  { key: "paid" as Stage, label: "已付款", count: undefined },
  { key: "all" as Stage, label: "全部", count: undefined }
]);

const formatMoney = (value: number | null | undefined) =>
  value === null || value === undefined
    ? "-"
    : value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const loadSummary = async () => {
  try {
    const result = await getPaymentConsoleSummary();
    summary.value = result.data;
  } catch {
    summary.value = null; // 汇总失败不阻塞列表,显示 "-"
  }
};

const loadData = async () => {
  loading.value = true;
  try {
    const result = await listPaymentRequests({
      page: page.value,
      pageSize: pageSize.value,
      project_id: filters.value.project_id,
      applicant_userid: filters.value.applicant_userid || undefined,
      status: STAGE_STATUS[stage.value] || undefined,
      keyword: filters.value.keyword || undefined
    });
    list.value = result.data;
    total.value = result.pagination.total;
  } finally {
    loading.value = false;
  }
};

const switchStage = (next: Stage) => {
  stage.value = next;
  page.value = 1;
  loadData();
};

const onHeaderSearch = () => {
  page.value = 1;
  loadData();
};

const goCreate = () => router.push("/finance/payment/wizard");
const goDetail = (id: number) => router.push(`/finance/payment/detail/${id}`);
const goEdit = (id: number) => router.push(`/finance/payment/detail/${id}?edit=1`);
const goApproval = (row: PaymentRequest) => {
  if (row.approval_instance_id) router.push(`/approval/detail/${row.approval_instance_id}`);
};

const onMarkPaid = async (id: number) => {
  await markPaymentPaid(id);
  message("已标记为已付款", { type: "success" });
  await Promise.all([loadData(), loadSummary()]);
};

onMounted(async () => {
  await Promise.all([
    listProjects({ page: 1, pageSize: 300 }).then(res => {
      projects.value = res.data;
    }),
    loadWecomUsers(),
    loadSummary()
  ]);
  await loadData();
});
</script>
```

模板结构(替换原模板;省略号处沿用原表格列:流水号/所属项目/付款内容+表头搜索/金额/金额大写/付款方式/状态/AI风险/申请时间/支付时间):

```vue
<template>
  <el-card shadow="never" style="background: #fffaf2">
    <!-- 汇总条:4 块可点击 -->
    <el-row :gutter="12" class="summary-strip">
      <el-col :md="6" :xs="12">
        <button class="summary-block" type="button" @click="switchStage('to_pay')">
          <span>待付总额</span><strong>¥ {{ formatMoney(summary?.to_pay_total) }}</strong>
        </button>
      </el-col>
      <el-col :md="6" :xs="12">
        <button class="summary-block" type="button" @click="switchStage('paid')">
          <span>本月已付</span><strong>¥ {{ formatMoney(summary?.paid_month_total) }}</strong>
        </button>
      </el-col>
      <el-col :md="6" :xs="12">
        <button class="summary-block summary-block--alert" type="button" @click="switchStage('to_pay')">
          <span>超期未付</span><strong>{{ summary?.overdue_count ?? "-" }} 笔</strong>
        </button>
      </el-col>
      <el-col :md="6" :xs="12">
        <button class="summary-block summary-block--alert" type="button" @click="switchStage('pending')">
          <span>退回待改</span><strong>{{ summary?.returned_count ?? "-" }} 笔</strong>
        </button>
      </el-col>
    </el-row>

    <!-- 阶段页签 + 筛选 -->
    <div class="console-toolbar">
      <el-tabs :model-value="stage" @tab-change="key => switchStage(key as Stage)">
        <el-tab-pane v-for="tab in stageTabs" :key="tab.key" :name="tab.key">
          <template #label>
            {{ tab.label }}<el-badge v-if="tab.count" :value="tab.count" :max="99" class="tab-badge" />
          </template>
        </el-tab-pane>
      </el-tabs>
      <el-space wrap>
        <el-select v-model="filters.project_id" clearable filterable placeholder="所属项目" style="width: 200px" @change="onHeaderSearch">
          <el-option v-for="item in projects" :key="item.id" :label="item.project_name" :value="item.id" />
        </el-select>
        <el-select v-model="filters.applicant_userid" clearable filterable placeholder="申请人" style="width: 160px" @change="onHeaderSearch">
          <el-option v-for="item in wecomUsers" :key="item.userid" :label="item.name || item.userid" :value="item.userid" />
        </el-select>
        <el-button type="primary" @click="goCreate">发起付款</el-button>
      </el-space>
    </div>

    <el-table :data="displayList" :loading="loading" :row-class-name="({ row }) => (isOverdue(row) ? 'payment-row-overdue' : '')">
      <!-- …原有列照搬(含付款内容表头搜索)… -->
      <el-table-column label="标签" width="110">
        <template #default="scope">
          <el-tag v-if="isReturned(scope.row)" type="danger">已退回</el-tag>
          <el-tag v-else-if="isOverdue(scope.row)" type="danger">超期</el-tag>
          <el-tag v-else :type="paymentStatusTagType[scope.row.status] || 'info'">
            {{ toPaymentStatusLabel(scope.row.status) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="200" fixed="right">
        <template #default="scope">
          <el-button v-if="stage === 'pending'" link type="danger" @click="goEdit(scope.row.id)">去修改</el-button>
          <el-button v-if="isReturned(scope.row) || stage === 'in_approval'" link type="warning" @click="goApproval(scope.row)">审批详情</el-button>
          <el-button v-if="scope.row.status === 'approved'" link type="success" @click="onMarkPaid(scope.row.id)">标记付款</el-button>
          <el-button link type="primary" @click="goDetail(scope.row.id)">详情</el-button>
        </template>
      </el-table-column>
    </el-table>
    <!-- 分页沿用,current-change 里 page=val; loadData() -->
  </el-card>
</template>

<style scoped>
.summary-strip { margin-bottom: 12px; }
.summary-block {
  width: 100%; text-align: left; padding: 12px 16px;
  background: #f8fafc; border: 1px solid #e5e7eb; border-radius: 8px; cursor: pointer;
}
.summary-block span { display: block; font-size: 13px; color: #6b7280; }
.summary-block strong { display: block; margin-top: 6px; font-size: 20px; }
.summary-block--alert { background: #fef2f2; border-color: #fecaca; }
.summary-block--alert strong { color: #dc2626; }
.console-toolbar { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
.tab-badge { margin-left: 4px; }
:deep(.payment-row-overdue) { background: #fef2f2; }
</style>
```

移除:关联合同筛选、`listContracts` import、`contracts`/`contractMap`。

- [ ] **Step 3: 验证**

Run: `cd packages/web && npm run typecheck && npm run build`
Expected: PASS。dev 手测:五页签切换、汇总块跳页签、退回行「去修改」、待付款行「标记付款」、表头搜索。

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/views/finance/payment/
git commit -m "feat(web): 付款管理重构为阶段式付款处理台"
```

---

### Task 5: 创建路径统一(路由重定向)

**Files:**
- Modify: `packages/web/src/router/modules/finance.ts`(detail/:id 路由之前)
- Modify: `packages/web/src/router/modules/workspace.ts`(payment/detail/:id 路由之前)

- [ ] **Step 1: 加静态重定向路由**

finance.ts,插在 `path: "/finance/payment/detail/:id"` 条目之前:

```ts
{
  path: "/finance/payment/detail/create",
  name: "PaymentDetailCreateRedirect",
  redirect: "/finance/payment/wizard",
  meta: { title: "发起付款", showLink: false }
},
```

workspace.ts,插在 `path: "/workspace/payment/detail/:id"` 条目之前:

```ts
{
  path: "/workspace/payment/detail/create",
  name: "WorkspacePaymentDetailCreateRedirect",
  redirect: "/workspace/payment/wizard",
  meta: { title: "发起对外付款", showLink: false }
},
```

- [ ] **Step 2: typecheck + commit**

Run: `cd packages/web && npm run typecheck`

```bash
git add packages/web/src/router/modules/finance.ts packages/web/src/router/modules/workspace.ts
git commit -m "feat(web): 付款创建路径统一重定向到智能向导"
```

---

### Task 6: 详情页拆分(容器 + 4 组件,废除创建模式)

**Files:**
- Create: `packages/web/src/views/finance/payment/components/AdminEditPanel.vue`
- Create: `packages/web/src/views/finance/payment/components/ApprovalActionPanel.vue`
- Create: `packages/web/src/views/finance/payment/components/PayoutPanel.vue`
- Create: `packages/web/src/views/finance/payment/components/PaymentInfoCard.vue`
- Rewrite: `packages/web/src/views/finance/payment/detail.vue`(现 1847 行 → 容器 <800 行)

先通读 `detail.vue` 全文,然后按下面边界迁移。**每抽一个组件跑一次 typecheck,单独 commit**(4+1 次提交)。对外行为不变;全程禁止改动业务逻辑本身。

**组件接口(锁定,后续步骤不得偏离):**

```ts
// AdminEditPanel.vue —— 超管编辑模式卡(现模板 ~1283-1300 行 + superEditMode/superEditNote)
defineProps<{ visible: boolean }>();
const editMode = defineModel<boolean>("editMode", { required: true });
const editNote = defineModel<string>("editNote", { required: true });

// ApprovalActionPanel.vue —— 风险报告 descriptions(~1585-1605)+ 审批 descriptions(~1607-1690)+ 跳审批详情按钮
defineProps<{
  detail: PaymentRequestDetail | null;
  approvalDetail: ApprovalDetailResponse | null;
  riskStatus: string;
  riskReport: Record<string, unknown> | null;
}>();
// 迁入:approvalStatusLabelMap/nodeTypeLabelMap/nodeStatusLabelMap/aiReviewStatusLabelMap/
//       aiOutcomeLabelMap/riskTagType/riskStatusLabelMap/goToApprovalDetail

// PayoutPanel.vue —— 付款主体与账户调整卡(~1222-1276)+ 标记付款/作废/重新激活动作
defineProps<{
  detail: PaymentRequestDetail | null;
  entities: Entity[];
  entityBankAccountMap: Record<number, EntityBankAccount[]>;
  inApprovalFlow: boolean;
}>();
const emit = defineEmits<{ (e: "refresh"): void }>();
// 迁入:onPayoutEntityChange/onPayoutAccountChange/savePayoutSelection/
//       onMarkPaid/onVoidPayment/onReactivatePayment(内部完成后 emit("refresh"))

// PaymentInfoCard.vue —— 申请信息表单/展示 descriptions(~1532-1580)/附件区(~1459-1530)/提审
defineProps<{
  detail: PaymentRequestDetail | null;
  contracts: Contract[];
  payees: Payee[];
  projects: Project[];
  entities: Entity[];
  entityBankAccountMap: Record<number, EntityBankAccount[]>;
  canEditFields: boolean;
  superEditMode: boolean;
  superEditNote: string;
  autoEdit: boolean; // 容器由 ?edit=1 传入,加载后自动展开编辑
}>();
const emit = defineEmits<{ (e: "refresh"): void }>();
// 迁入:form/attachmentItems/相关 computed(selectedContract/selectedPayee/remainingAmount/amountDisplay 等)、
//       onSave/onSubmitApproval/onRiskAssessment/uploadAttachment/removeAttachment/openAttachmentPreview、
//       预览 drawer(~1692-1716)、toChineseAmount、快照与幂等键辅助
```

**容器 `detail.vue` 保留:** 路由解析(`requestId`,删除 `isCreate` 及其全部分支)、`loadRefs/loadDetail/loadApprovalDetail`、`detail/approvalDetail/riskStatus/riskReport/contracts/payees/projects/entities/entityBankAccountMap` 状态、权限 computed(`canEditFields` 去掉 `isCreate.value ||` 项、`inApprovalFlow`、`approvalFinishedLock`)、`superEditMode/superEditNote`、`autoEdit = computed(() => route.query.edit === "1")`、返回按钮与页头。组件间经 props 下发 + `@refresh="loadDetail"` 回流。

- [ ] **Step 1: 抽 AdminEditPanel** → typecheck → `git commit -m "refactor(web): 付款详情拆出超管编辑面板"`
- [ ] **Step 2: 抽 ApprovalActionPanel** → typecheck → `git commit -m "refactor(web): 付款详情拆出审批与风险面板"`
- [ ] **Step 3: 抽 PayoutPanel** → typecheck → `git commit -m "refactor(web): 付款详情拆出付款执行面板"`
- [ ] **Step 4: 抽 PaymentInfoCard(含 ?edit=1 自动展开)** → typecheck → `git commit -m "refactor(web): 付款详情拆出申请信息卡"`
- [ ] **Step 5: 容器收尾——删除 isCreate 分支与创建态代码,确认 detail.vue < 800 行**

Run: `cd packages/web && npm run typecheck && npm run build && wc -l src/views/finance/payment/detail.vue`
Expected: PASS;行数 < 800。dev 手测:详情查看、draft/退回单编辑保存、提审、标记付款、超管编辑模式、`?edit=1` 直达编辑、附件上传/预览。

```bash
git add packages/web/src/views/finance/payment/
git commit -m "refactor(web): 付款详情页容器化,废除创建模式"
```

---

### Task 7: 小程序付款查询——阶段页签 + 退回件去修改

**Files:**
- Modify: `packages/miniapp/pages/query-payment/index.js`
- Modify: `packages/miniapp/pages/query-payment/index.wxml`
- Modify: `packages/miniapp/pages/query-payment/index.wxss`
- Verify/Modify: `packages/miniapp/utils/returned-approval.js` + `returned-approval.test.js`

- [ ] **Step 1: 确认退回编辑页支持 payment_request**

打开 `packages/miniapp/utils/returned-approval.js`,确认 `RETURNED_APPROVAL_EDIT_BIZ_TYPES` 含 `"payment_request"`;若无则加入并在 `returned-approval.test.js` 补断言:

```js
expect(RETURNED_APPROVAL_EDIT_BIZ_TYPES).toContain("payment_request");
```

Run: `cd packages/miniapp && node --test utils/returned-approval.test.js`(按该文件现有运行方式执行)

- [ ] **Step 2: js 加阶段状态**

`index.js` 顶部常量区新增:

```js
const STAGE_TABS = [
  { key: "all", label: "全部" },
  { key: "pending", label: "待处理" },
  { key: "in_approval", label: "审批中" },
  { key: "to_pay", label: "待付款" },
  { key: "paid", label: "已付款" }
];

const STAGE_STATUS = {
  all: "",
  pending: "draft",
  in_approval: "pending_approval",
  to_pay: "approved",
  paid: "paid"
};

const RESUBMITTABLE = ["returned", "pending", "withdrawn"];
```

`data` 增加 `stage: "all", stageTabs: STAGE_TABS`;新增事件:

```js
onStageTap(e) {
  const key = String(e.currentTarget.dataset.key || "all");
  if (key === this.data.stage) return;
  this.setData({ stage: key, page: 1 }, () => this.loadList());
},

goReturnedEdit(e) {
  const { approvalId, bizId } = e.currentTarget.dataset;
  wx.navigateTo({
    url: `/pages/returned-approval-edit/index?approvalId=${approvalId}&bizType=payment_request&bizId=${bizId}`
  });
},
```

`loadList` 的查询串追加 `status`(空则不传),并在列表项映射处补退回标记:

```js
const stageStatus = STAGE_STATUS[this.data.stage] || "";
// path 拼接处:stageStatus ? `&status=${stageStatus}` : ""
// item 映射处新增:
isReturned: item.status === "draft" && RESUBMITTABLE.includes(item.approval_status || ""),
approvalInstanceId: item.approval_instance_id || 0,
```

- [ ] **Step 3: wxml 加页签与去修改**

工具栏上方插入:

```xml
<scroll-view scroll-x class="stage-tabs">
  <view
    wx:for="{{stageTabs}}"
    wx:key="key"
    class="stage-tab {{stage === item.key ? 'stage-tab--active' : ''}}"
    data-key="{{item.key}}"
    bindtap="onStageTap"
  >{{item.label}}</view>
</scroll-view>
```

列表项卡片内(金额行后)加:

```xml
<view wx:if="{{item.isReturned}}" class="item-returned">
  <text class="item-returned-text">已退回,待修改重提</text>
  <t-button
    size="extra-small"
    theme="danger"
    variant="outline"
    catchtap="goReturnedEdit"
    data-approval-id="{{item.approvalInstanceId}}"
    data-biz-id="{{item.id}}"
  >去修改</t-button>
</view>
```

- [ ] **Step 4: wxss**

```css
.stage-tabs { display: flex; white-space: nowrap; margin-bottom: 16rpx; }
.stage-tab {
  display: inline-block; padding: 10rpx 24rpx; margin-right: 12rpx;
  border-radius: 999rpx; background: #f3f4f6; color: #4b5563; font-size: 26rpx;
}
.stage-tab--active { background: #2563eb; color: #fff; }
.item-returned { display: flex; align-items: center; justify-content: space-between; margin-top: 8rpx; }
.item-returned-text { color: #dc2626; font-size: 24rpx; }
```

- [ ] **Step 5: 手测 + Commit**

微信开发者工具:五页签切换查询、退回件显示与跳转编辑页。

```bash
git add packages/miniapp/pages/query-payment/ packages/miniapp/utils/
git commit -m "feat(miniapp): 付款查询加阶段页签与退回件去修改入口"
```

---

### Task 8: 小程序付款申请——三步分段

**Files:**
- Modify: `packages/miniapp/pages/payment-apply/index.js`
- Modify: `packages/miniapp/pages/payment-apply/index.wxml`
- Modify: `packages/miniapp/pages/payment-apply/index.wxss`

现页为阈值驱动单页长表单(金额 → 直付流程 section 或 合同流程 section)。分步与 Web 向导同构:**① 金额识别 → ② 信息填写(直付/合同,由阈值决定) → ③ 确认提交**。与设计文档"项目与合同→金额与内容→收款与方式"的字面顺序不同,原因:金额必须先行才能判定走哪条流程(与 Web 向导第一步"金额识别"一致),实现时以此为准。

- [ ] **Step 1: js 增加步骤状态与导航**

`data` 增加 `currentStep: 0`(0=金额,1=信息填写,2=确认);新增:

```js
goNextStep() {
  if (this.data.currentStep === 0) {
    const amount = Number(this.data.form.amount || 0);
    if (!(amount > 0)) {
      wx.showToast({ title: "请先填写预计付款总额", icon: "none" });
      return;
    }
  }
  if (this.data.currentStep === 1 && !this.validateFlowFields()) return;
  this.setData({ currentStep: Math.min(this.data.currentStep + 1, 2) });
},

goPrevStep() {
  this.setData({ currentStep: Math.max(this.data.currentStep - 1, 0) });
},

validateFlowFields() {
  // 复用 submitDirect/submitContract 现有的字段校验分支,仅校验不提交:
  // 直付流程:payee_id/expected_payment_date/category/payment_method/content 必填
  // 合同流程:entity_id/counterparty/handler_userid/contract_date/contract_type 必填
  // 校验失败 wx.showToast 并 return false;通过 return true
},
```

`validateFlowFields` 的具体判断从现有 `submitDirect`(843 行起)与合同提交函数的开头校验代码中原样搬移(保持提示文案一致),提交函数内改为调用它。

- [ ] **Step 2: wxml 分段包裹**

- 第 0 步容器:`<view wx:if="{{currentStep === 0}}">` 包住「预计付款总额」输入与阈值提示(现 wxml 4-18 行区域);
- 第 1 步容器:`<view wx:if="{{currentStep === 1}}">` 包住「快速添加外部收款人」「直付流程」「合同流程」三个 section(现 20-270 行区域,内部 wx:if 阈值分支不动);
- 第 2 步容器:新增确认页,展示关键字段汇总 + 现有提交按钮移入:

```xml
<view wx:if="{{currentStep === 2}}" class="confirm-panel">
  <view class="section-title">确认提交</view>
  <view class="confirm-row">金额:¥{{form.amount}}</view>
  <view class="confirm-row">流程:{{exceedsThreshold ? '合同流程(超阈值)' : '直付流程'}}</view>
  <view class="confirm-row">付款事由:{{form.content || '-'}}</view>
  <view class="confirm-row">付款日期:{{form.expected_payment_date || '-'}}</view>
  <!-- 提交按钮:沿用现有 bindtap(submitDirect / submitContract 按流程分支) -->
</view>
<view class="step-nav">
  <t-button wx:if="{{currentStep > 0}}" variant="outline" bindtap="goPrevStep">上一步</t-button>
  <t-button wx:if="{{currentStep < 2}}" theme="primary" bindtap="goNextStep">下一步</t-button>
</view>
```

顶部加步骤指示:

```xml
<view class="step-indicator">
  <view class="step-dot {{currentStep >= 0 ? 'on' : ''}}">1 金额</view>
  <view class="step-dot {{currentStep >= 1 ? 'on' : ''}}">2 信息</view>
  <view class="step-dot {{currentStep >= 2 ? 'on' : ''}}">3 提交</view>
</view>
```

- [ ] **Step 3: wxss**

```css
.step-indicator { display: flex; gap: 16rpx; margin-bottom: 20rpx; }
.step-dot { flex: 1; text-align: center; padding: 12rpx 0; border-radius: 8rpx; background: #f3f4f6; color: #9ca3af; font-size: 26rpx; }
.step-dot.on { background: #dbeafe; color: #1d4ed8; font-weight: 600; }
.step-nav { display: flex; gap: 20rpx; margin-top: 24rpx; }
.confirm-panel .confirm-row { padding: 8rpx 0; font-size: 28rpx; color: #374151; }
```

- [ ] **Step 4: 手测 + Commit**

微信开发者工具:三步来回切换、阈值内直付提交、超阈值合同流程提交、每步校验提示。

```bash
git add packages/miniapp/pages/payment-apply/
git commit -m "feat(miniapp): 付款申请改三步分段,与 Web 向导同构"
```

---

### Task 9: 文档同步

**Files:**
- Modify: `doc/UI设计文档.md`(F. 对外付款申请列表、G. 详情两节 + 小程序节)
- Modify: `doc/开发记录.md`(追加实现记录)
- Move: `docs/planned/2026-07-08-payment-uiux-console-design.md` 与本计划 → `docs/archive/`,更新两处 README 清单

- [ ] **Step 1: 更新 UI设计文档**:F 节改写为付款处理台(汇总条口径、五页签、行内动作表);G 节标注创建模式已废除、组件化结构、?edit=1;小程序节补两页改动。
- [ ] **Step 2: 开发记录追加**:目标/变更/验证/上线四段,列出全部提交。
- [ ] **Step 3: 移档 + commit**

```bash
git mv docs/planned/2026-07-08-payment-uiux-console-design.md docs/archive/
git mv docs/planned/2026-07-08-payment-uiux-console-plan.md docs/archive/
# 编辑 docs/planned/README.md(清单移除)与 docs/archive/README.md(如有清单则补记)
git add doc/ docs/
git commit -m "docs: 付款处理台实现记录与设计文档归档"
```

---

### Task 10: 整体验证与发布

- [ ] **Step 1: 全量测试**

Run: `cd packages/api && npx vitest run && npm run typecheck && npm run lint`
Expected: 全 PASS(基线 233 + 本次新增)

- [ ] **Step 2: Web 构建**

Run: `cd packages/web && npm run typecheck && npm run build`
Expected: PASS

- [ ] **Step 3: 关键动线手测清单**

- 列表页签×5、汇总块跳转、超期标红置顶、退回行去修改(?edit=1 直达编辑)、标记付款后汇总刷新;
- `/finance/payment/detail/create` 与 `/workspace/payment/detail/create` 重定向向导;向导提交后回列表;
- 详情:查看/编辑保存/提审/标记付款/超管编辑模式(admin_edit_mode 门槛不回归——仅审批中/终态要求);
- 小程序:查询页签、退回件跳编辑、申请三步提交(直付与合同两条流程)。

- [ ] **Step 4: 一次性 push(即部署)**

```bash
git push
```

推送后:`https://api.hybcdg.com/api/v1/system/health` 返回 ok=true;线上抽查 console-summary 返回与列表页签。

---

## Self-Review 记录

- 规格覆盖:设计文档一~六节 → Task 1-2(五节 API)、3-5(一、二节增+查管)、6(三节详情)、7(四节查询页)、8(四节申请页)、9-10(六节验证与文档)。「不做」清单未引入任何任务 ✓。
- 占位符:无 TBD;Task 6 以「迁移边界+锁定接口」表述,迁移内容按现文件函数/模板行区间点名 ✓。
- 类型一致性:`PaymentConsoleSummary` 字段与 console-summary 返回一致;`approval_status` 在 API 行类型、web 类型、miniapp 映射三处同名 ✓。
