# 报销付款工作台三步流水线 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按已批准设计 [2026-07-08-reimbursement-office-workbench-design.md](./2026-07-08-reimbursement-office-workbench-design.md) 把财务中心报销工作台重构为办公室三步流水线,消除状态混乱。

**Architecture:** API 先行(新增 workbench-summary 聚合端点,TDD);抽取共享标签模块;新建 office-workbench.vue(三步流水线+第①步子页签+全流程查询,嵌入现有 batch.vue/payout.vue),财务中心路由切到新组件,员工 list.vue 动线保持不变,最后清理 list.vue 死代码。

**Tech Stack:** Hono + D1(vitest)/ Vue 3 + Element Plus + PureAdmin。

**部署与提交约定(重要):** 本仓库 push 到 main 即自动部署生产。每个 Task 完成后**本地 commit,不 push**;全部完成并通过 Task 10 整体验证后一次性 push。无 D1 迁移。

---

## 文件结构总览

| 动作 | 文件 | 职责 |
|---|---|---|
| Modify | `packages/api/src/routes/reimbursement.ts` | 新增 GET `/workbench-summary` 路由 |
| Create | `packages/api/src/routes/reimbursement-workbench-summary.test.ts` | 聚合端点测试 |
| Modify | `packages/web/src/api/reimbursement.ts` | summary 类型与请求封装 |
| Create | `packages/web/src/views/finance/reimbursement/reimbursement-labels.ts` | 共享:状态 tag、异常标签、高风险行类 |
| Modify | `packages/web/src/views/finance/reimbursement/list.vue` | 改用共享标签模块(Task 3);清理死代码(Task 8) |
| Create | `packages/web/src/views/finance/reimbursement/reimbursement-station.ts` | 纯函数:由信封状态派生「当前站点」 |
| Create | `packages/web/src/views/finance/reimbursement/office-workbench.vue` | 财务中心三步流水线容器 |
| Modify | `packages/web/src/router/modules/finance.ts` | 财务中心路由指向 office-workbench |
| Modify | `doc/UI设计文档.md`、`doc/开发记录.md` | 文档同步 |

---

### Task 1: API — `GET /api/v1/reimbursement/workbench-summary`

**Files:**
- Test: `packages/api/src/routes/reimbursement-workbench-summary.test.ts`(新建)
- Modify: `packages/api/src/routes/reimbursement.ts`(在 GET `/` 路由 1279 行之后、任何 `/:id` 路由之前注册)

- [ ] **Step 1: 写失败测试**

新建 `packages/api/src/routes/reimbursement-workbench-summary.test.ts`(mock 模式参照同目录 `payment-console-summary.test.ts`):

```ts
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthTokenPayload } from "../types/auth";
import type { Env } from "../types/env";
import { reimbursementRoutes } from "./reimbursement";

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
  constructor(
    private readonly db: SummaryDb,
    private readonly sql: string
  ) {}

  bind() {
    return this;
  }

  async first<T>(): Promise<T | null> {
    this.db.capturedSql.push(this.sql);
    if (this.sql.includes("to_receive")) {
      return this.db.envelopeRow as T;
    }
    if (this.sql.includes("batches_to_submit")) {
      return this.db.batchRow as T;
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
  envelopeRow: unknown = { to_receive: 3, to_precheck: 2, to_batch: 2 };
  batchRow: unknown = { batches_to_submit: 1, batches_to_pay: 1 };

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
  app.route("/reimbursement", reimbursementRoutes);
  return app.request(
    "/reimbursement/workbench-summary",
    { headers: { authorization: "Bearer test-token" } },
    createEnv(db)
  );
};

describe("reimbursement workbench summary", () => {
  beforeEach(() => {
    mockAuthState.payload = { ...mockAuthState.payload, roles: ["finance"] };
  });

  it("returns five stage counts for finance role", async () => {
    const db = new SummaryDb();
    const response = await requestSummary(db);

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      data: {
        to_receive: number;
        to_precheck: number;
        to_batch: number;
        batches_to_submit: number;
        batches_to_pay: number;
      };
    };
    expect(payload.data).toEqual({
      to_receive: 3,
      to_precheck: 2,
      to_batch: 2,
      batches_to_submit: 1,
      batches_to_pay: 1
    });
  });

  it("pins the precheck bucket SQL semantics", async () => {
    const db = new SummaryDb();
    await requestSummary(db);
    const envelopeSql = db.capturedSql.find(s => s.includes("to_receive")) ?? "";
    expect(envelopeSql).toContain("precheck_status IN ('none', 'pending', 'supplement')");
    expect(envelopeSql).toContain("batch_id IS NULL");
  });

  it("falls back to all-zero when aggregate rows are null", async () => {
    const db = new SummaryDb();
    db.envelopeRow = null;
    db.batchRow = null;
    const response = await requestSummary(db);

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { data: Record<string, number> };
    expect(payload.data).toEqual({
      to_receive: 0,
      to_precheck: 0,
      to_batch: 0,
      batches_to_submit: 0,
      batches_to_pay: 0
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

Run: `cd packages/api && npx vitest run src/routes/reimbursement-workbench-summary.test.ts`
Expected: FAIL(404 路由不存在)

- [ ] **Step 3: 实现路由**

在 `reimbursement.ts` 的 `reimbursementRoutes.get("/", ...)`(约 1279 行)**之前**插入。`requireRoles` 已在文件顶部 import(`middleware/rbac`):

```ts
reimbursementRoutes.get(
  "/workbench-summary",
  requireRoles(["super_admin", "manager", "finance"]),
  async (c) => {
    const envelopeRow = await c.env.DB.prepare(
      `SELECT
         SUM(CASE WHEN status = 'submitted' THEN 1 ELSE 0 END) AS to_receive,
         SUM(CASE WHEN status = 'received' AND precheck_status IN ('none', 'pending', 'supplement') THEN 1 ELSE 0 END) AS to_precheck,
         SUM(CASE WHEN status = 'received' AND precheck_status = 'approved' AND batch_id IS NULL THEN 1 ELSE 0 END) AS to_batch
       FROM reimbursement_envelope
       WHERE status != 'deleted'`
    ).first<{
      to_receive: number | null;
      to_precheck: number | null;
      to_batch: number | null;
    }>();

    const batchRow = await c.env.DB.prepare(
      `SELECT
         SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) AS batches_to_submit,
         SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) AS batches_to_pay
       FROM reimbursement_batch`
    ).first<{
      batches_to_submit: number | null;
      batches_to_pay: number | null;
    }>();

    return c.json({
      success: true,
      data: {
        to_receive: envelopeRow?.to_receive ?? 0,
        to_precheck: envelopeRow?.to_precheck ?? 0,
        to_batch: envelopeRow?.to_batch ?? 0,
        batches_to_submit: batchRow?.batches_to_submit ?? 0,
        batches_to_pay: batchRow?.batches_to_pay ?? 0
      }
    });
  }
);
```

说明:注册在 GET `/` 之前,静态段先于 `/:id`(约 3694 行)匹配,双保险。权限显式限三角色(全局积压不暴露给 site_manager/operator,与付款 console-summary 同口径)。

- [ ] **Step 4: 测试通过 + typecheck + lint**

Run: `cd packages/api && npx vitest run src/routes/reimbursement-workbench-summary.test.ts && npm run typecheck && npx eslint src/routes/reimbursement.ts`
Expected: 全 PASS

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/routes/reimbursement.ts packages/api/src/routes/reimbursement-workbench-summary.test.ts
git commit -m "feat(api): 新增报销工作台聚合汇总端点 workbench-summary"
```

---

### Task 2: Web API 封装

**Files:**
- Modify: `packages/web/src/api/reimbursement.ts`

- [ ] **Step 1: 补类型与请求函数**

在 `listReimbursementEnvelopes` 定义之后(约 95 行)新增:

```ts
export type ReimbursementWorkbenchSummary = {
  to_receive: number;
  to_precheck: number;
  to_batch: number;
  batches_to_submit: number;
  batches_to_pay: number;
};

export const getReimbursementWorkbenchSummary = () => {
  return http.request<{ success: boolean; data: ReimbursementWorkbenchSummary }>(
    "get",
    "/api/v1/reimbursement/workbench-summary"
  );
};
```

- [ ] **Step 2: typecheck + commit**

Run: `cd packages/web && npm run typecheck`
Expected: PASS

```bash
git add packages/web/src/api/reimbursement.ts
git commit -m "feat(web): 报销工作台汇总接口封装"
```

---

### Task 3: 抽取共享标签模块 `reimbursement-labels.ts`

**Files:**
- Create: `packages/web/src/views/finance/reimbursement/reimbursement-labels.ts`
- Modify: `packages/web/src/views/finance/reimbursement/list.vue`(改为 import,删除本地重复定义)

- [ ] **Step 1: 新建共享模块**

内容从 list.vue 的现有定义(第 25、88-160 行)平移:

```ts
import type { ReimbursementEnvelope } from "@/api/reimbursement";

export type ReimbursementTagType =
  | "primary"
  | "success"
  | "warning"
  | "danger"
  | "info";

export const reimbursementStatusTagType: Record<string, ReimbursementTagType> = {
  unregistered: "info",
  draft: "info",
  submitted: "warning",
  received: "success",
  batched: "primary",
  pending_approval: "warning",
  approved: "success",
  paid: "primary",
  rejected: "danger",
  cancelled: "info"
};

const riskTagTypeMap: Record<string, ReimbursementTagType> = {
  high: "danger",
  medium: "warning",
  low: "success"
};

const toDuplicateCount = (value: unknown): number => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
};

const duplicateRiskLabel = (level: unknown): string => {
  if (level === "high") return "高风险重复";
  if (level === "medium") return "中风险重复";
  if (level === "low") return "低风险重复";
  return "重复风险";
};

const toDuplicateRiskTagType = (level: unknown): ReimbursementTagType => {
  if (typeof level !== "string") return "warning";
  return riskTagTypeMap[level] ?? "warning";
};

export const rowAnomalyTags = (
  row: ReimbursementEnvelope
): Array<{ label: string; type: ReimbursementTagType }> => {
  const tags: Array<{ label: string; type: ReimbursementTagType }> = [];
  const duplicateCount = toDuplicateCount(row.duplicate_count);
  if (duplicateCount > 0) {
    tags.push({
      label: `${duplicateRiskLabel(row.duplicate_risk_level)} x${duplicateCount}`,
      type: toDuplicateRiskTagType(row.duplicate_risk_level)
    });
  }
  if (row.verification_status === "mismatch") {
    tags.push({ label: "收件核对异常", type: "danger" });
  }
  if (row.precheck_status === "supplement") {
    tags.push({ label: "待补充材料", type: "warning" });
  }
  if (row.precheck_status === "rejected") {
    tags.push({ label: "复核驳回", type: "danger" });
  }
  return tags;
};

export const isHighRiskRow = (row: ReimbursementEnvelope): boolean => {
  const duplicateCount = toDuplicateCount(row.duplicate_count);
  return (
    (duplicateCount > 0 && row.duplicate_risk_level === "high") ||
    row.verification_status === "mismatch" ||
    row.precheck_status === "rejected"
  );
};

export const tableRowClassName = ({
  row
}: {
  row: ReimbursementEnvelope;
}): string => (isHighRiskRow(row) ? "reimbursement-row-high-risk" : "");
```

- [ ] **Step 2: list.vue 改用共享模块**

在 list.vue 中:删除本地 `statusTagType`、`riskTagTypeMap`、`toDuplicateCount`、`duplicateRiskLabel`、`toDuplicateRiskTagType`、`rowAnomalyTags`、`isHighRiskRow`、`tableRowClassName` 定义(第 88-160 行区域),改为在 import 区加:

```ts
import {
  reimbursementStatusTagType,
  rowAnomalyTags,
  tableRowClassName
} from "./reimbursement-labels";
```

模板中 `statusTagType[...]` 改为 `reimbursementStatusTagType[...]`(list.vue 模板搜 `statusTagType` 替换,应仅状态列一处)。`type TagType` 若仅被已删除的 helper 使用则一并删除;若模板/其他 computed 仍用,保留或改 import `ReimbursementTagType`。`isHighRiskRow` 若 list.vue 其他处未直接引用则不必单独 import(已被 tableRowClassName 封装)。

- [ ] **Step 3: 验证**

Run: `cd packages/web && npm run typecheck && npm run build`
Expected: PASS。dev 手测 `/workspace/my-reimbursement` 与 `/finance/reimbursement` 现状不变(高风险标红、异常标签、状态色照旧)。

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/views/finance/reimbursement/
git commit -m "refactor(web): 抽取报销状态与异常标签共享模块"
```

---

### Task 4: 站点派生纯函数 `reimbursement-station.ts`

**Files:**
- Create: `packages/web/src/views/finance/reimbursement/reimbursement-station.ts`

- [ ] **Step 1: 新建模块**

```ts
import type { ReimbursementEnvelope } from "@/api/reimbursement";

export type ReimbursementStation = {
  label: string;
  batchId: number | null;
};

/**
 * 由信封的 status / precheck_status / batch_id 派生「当前站点」,
 * 用于全流程查询回答「这单到哪了」。纯前端派生,不改后端。
 */
export const resolveStation = (
  env: Pick<
    ReimbursementEnvelope,
    "status" | "precheck_status" | "batch_id"
  >
): ReimbursementStation => {
  const batchId = env.batch_id ?? null;
  switch (env.status) {
    case "unregistered":
    case "draft":
      return { label: "提交人手中", batchId: null };
    case "submitted":
      return { label: "待签收(办公室)", batchId: null };
    case "received":
      if (env.precheck_status === "approved") {
        return batchId
          ? { label: "审批中", batchId }
          : { label: "待成批(办公室)", batchId: null };
      }
      return { label: "待复核(办公室)", batchId: null };
    case "batched":
    case "pending_approval":
      return { label: "审批中", batchId };
    case "approved":
      return { label: "待付款", batchId };
    case "paid":
      return { label: "已付款", batchId };
    case "rejected":
      return { label: "已驳回", batchId };
    case "cancelled":
      return { label: "已废弃", batchId };
    default:
      return { label: env.status, batchId };
  }
};
```

- [ ] **Step 2: typecheck + commit**

Run: `cd packages/web && npm run typecheck`
Expected: PASS(web 无单测运行器,纯函数以 typecheck + Task 6 手测覆盖)

```bash
git add packages/web/src/views/finance/reimbursement/reimbursement-station.ts
git commit -m "feat(web): 报销信封当前站点派生纯函数"
```

---

### Task 5: 新建 `office-workbench.vue`(三步流水线,不含查询)

**Files:**
- Create: `packages/web/src/views/finance/reimbursement/office-workbench.vue`

先通读现 `list.vue` 的办公室表格(601-730 行)与动作函数(`onTriggerAnomaly`/`onRerunSilentReview`/`onPrecheck` 约 330-380 行)以复用其逻辑与文案。本组件把它们迁入,但按三步流水线重组;第②③步嵌入 `batch.vue`/`payout.vue`。

**组件行为契约(锁定):**
- 顶部动作:代员工发起(`/finance/reimbursement/detail/create`)、UUID 快速签收(现有 `resolveReimbursementEnvelopeByUuid` 弹窗→打开详情抽屉)、信封生成器(`/finance/reimbursement/envelope-generator`)。全流程查询框在 Task 6 加入,本任务先留占位注释。
- 步骤条三步(可点击,徽标):① 签收与复核 = `to_receive + to_precheck`;② 成批送审 = `to_batch + batches_to_submit`;③ 付款 = `batches_to_pay`。徽标来自 `getReimbursementWorkbenchSummary`,失败显示 `-` 不阻塞。
- 第①步三子页签(各带计数):
  - 待签收(`status='submitted'`,行内:签收=打开详情抽屉、详情)
  - 待复核(`status='received'` 且 `precheck_status IN none/pending/supplement`,行内:复核通过/补充材料/复核驳回/智能核查/二次静默审查/详情)
  - 待成批(`status='received'` 且 `precheck_status='approved'` 且 `batch_id` 空,行内:去成批→切换第②步、详情)
- 第②步嵌入 `<ReimbursementBatchCenter />`,第③步嵌入 `<ReimbursementPayoutCenter />`。
- 动作成功后 `Promise.all([loadData(), loadSummary()])`。

完整 SFC:

```vue
<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { message } from "@/utils/message";
import {
  channelLabel,
  precheckStatusLabel,
  statusLabel
} from "@/utils/enum-labels";
import { listProjects, type Project } from "@/api/project";
import { useWecomUserOptions } from "@/composables/useWecomUserOptions";
import {
  getReimbursementWorkbenchSummary,
  listReimbursementEnvelopes,
  precheckEnvelope,
  resolveReimbursementEnvelopeByUuid,
  triggerEnvelopeAnomalyCheck,
  type ReimbursementEnvelope,
  type ReimbursementWorkbenchSummary
} from "@/api/reimbursement";
import {
  reimbursementStatusTagType,
  rowAnomalyTags,
  tableRowClassName
} from "./reimbursement-labels";
import ReimbursementBatchCenter from "./batch.vue";
import ReimbursementPayoutCenter from "./payout.vue";
import ReimbursementDetail from "./detail.vue";

defineOptions({ name: "ReimbursementOfficeWorkbench" });

type Step = "intake" | "batch" | "payout";
type IntakeTab = "to_receive" | "to_precheck" | "to_batch";

const INTAKE_QUERY: Record<IntakeTab, { status: string[]; precheck?: string[] }> = {
  to_receive: { status: ["submitted"] },
  to_precheck: { status: ["received"], precheck: ["none", "pending", "supplement"] },
  to_batch: { status: ["received"], precheck: ["approved"] }
};

const router = useRouter();
const { wecomUsers, loadWecomUsers } = useWecomUserOptions();

const step = ref<Step>("intake");
const intakeTab = ref<IntakeTab>("to_receive");
const loading = ref(false);
const list = ref<ReimbursementEnvelope[]>([]);
const projects = ref<Project[]>([]);
const page = ref(1);
const pageSize = ref(20);
const total = ref(0);
const summary = ref<ReimbursementWorkbenchSummary | null>(null);

const quickScanVisible = ref(false);
const quickScanUuid = ref("");
const detailDrawerVisible = ref(false);
const activeDetailId = ref<number | null>(null);

const createIdempotencyKey = (scope: string) => `${scope}-${crypto.randomUUID()}`;

const projectMap = computed(() => {
  const map: Record<number, string> = {};
  projects.value.forEach(item => {
    map[item.id] = item.project_name;
  });
  return map;
});

const userNameMap = computed(() => {
  const map = new Map<string, string>();
  wecomUsers.value.forEach(item => map.set(item.userid, item.name || item.userid));
  return map;
});

const toApplicantLabel = (userid: string | null | undefined) =>
  userid ? (userNameMap.value.get(userid) ?? userid) : "-";

const steps = computed(() => [
  {
    key: "intake" as Step,
    label: "① 签收与复核",
    count: (summary.value?.to_receive ?? 0) + (summary.value?.to_precheck ?? 0)
  },
  {
    key: "batch" as Step,
    label: "② 成批送审",
    count: (summary.value?.to_batch ?? 0) + (summary.value?.batches_to_submit ?? 0)
  },
  {
    key: "payout" as Step,
    label: "③ 付款",
    count: summary.value?.batches_to_pay ?? 0
  }
]);

const intakeTabs = computed(() => [
  { key: "to_receive" as IntakeTab, label: "待签收", count: summary.value?.to_receive },
  { key: "to_precheck" as IntakeTab, label: "待复核", count: summary.value?.to_precheck },
  { key: "to_batch" as IntakeTab, label: "待成批", count: summary.value?.to_batch }
]);

const badge = (n: number | undefined) =>
  summary.value === null ? "-" : String(n ?? 0);

const loadSummary = async () => {
  try {
    const result = await getReimbursementWorkbenchSummary();
    summary.value = result.data;
  } catch {
    summary.value = null;
  }
};

const loadData = async () => {
  if (step.value !== "intake") return;
  loading.value = true;
  try {
    const preset = INTAKE_QUERY[intakeTab.value];
    const result = await listReimbursementEnvelopes({
      page: page.value,
      pageSize: pageSize.value,
      status: preset.status.join(","),
      exclude_cancelled: false
    });
    // 待复核/待成批需按 precheck_status 二次过滤(列表 API 无 precheck 参数)
    const rows = result.data;
    list.value = preset.precheck
      ? rows.filter(r => preset.precheck!.includes(r.precheck_status))
      : rows;
    total.value = preset.precheck ? list.value.length : result.pagination.total;
  } finally {
    loading.value = false;
  }
};

const switchStep = (next: Step) => {
  step.value = next;
  if (next === "intake") {
    page.value = 1;
    loadData();
  }
};

const switchIntakeTab = (tab: IntakeTab) => {
  intakeTab.value = tab;
  page.value = 1;
  loadData();
};

const refreshAll = async () => {
  await Promise.all([loadData(), loadSummary()]);
};

const goCreate = () => router.push("/finance/reimbursement/detail/create");
const goEnvelopeGenerator = () =>
  router.push("/finance/reimbursement/envelope-generator");

const openDetail = (id: number) => {
  activeDetailId.value = id;
  detailDrawerVisible.value = true;
};
const onDetailDrawerClosed = () => {
  activeDetailId.value = null;
};
const onDetailChanged = async () => {
  await refreshAll();
};

const openQuickScan = () => {
  quickScanUuid.value = "";
  quickScanVisible.value = true;
};
const submitQuickScan = async () => {
  if (!quickScanUuid.value.trim()) {
    message("请填写信封UUID", { type: "warning" });
    return;
  }
  const result = await resolveReimbursementEnvelopeByUuid(quickScanUuid.value.trim());
  message("已打开对应报销信封", { type: "success" });
  quickScanVisible.value = false;
  openDetail(result.data.id);
};

const onTriggerAnomaly = async (id: number) => {
  await triggerEnvelopeAnomalyCheck(id);
  message("已触发智能核查", { type: "success" });
  await refreshAll();
};

const onRerunSilentReview = async (id: number) => {
  await triggerEnvelopeAnomalyCheck(
    id,
    { rerun_full: true, reason: "office_manual_second_silent_review" },
    { idempotencyKey: createIdempotencyKey("reimbursement-rerun-silent-review") }
  );
  message("已触发二次静默审查", { type: "success" });
  await refreshAll();
};

const onPrecheck = async (
  id: number,
  action: "approved" | "supplement" | "rejected"
) => {
  try {
    await precheckEnvelope(id, { action });
    message(`复核已处理：${action}`, {
      type: action === "approved" ? "success" : "warning"
    });
    await refreshAll();
  } catch (error) {
    const err = error as {
      response?: { status?: number; data?: { data?: { wait_for_audit?: boolean } } };
    };
    const waitForAudit =
      err.response?.status === 409 &&
      err.response?.data?.data?.wait_for_audit === true;
    if (!waitForAudit) throw error;
    message("后台静默审查尚未完成，系统已自动触发处理，请稍后再执行复核通过", {
      type: "warning"
    });
    await refreshAll();
  }
};

const goToBatchStep = () => switchStep("batch");

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

<template>
  <el-card shadow="never" style="background: #fffaf2">
    <!-- 顶部动作区(全流程查询在 Task 6 加入此处) -->
    <div class="office-toolbar">
      <el-space wrap>
        <el-button type="success" @click="goCreate">代员工发起</el-button>
        <el-button @click="openQuickScan">UUID 快速签收</el-button>
        <el-button @click="goEnvelopeGenerator">信封生成器</el-button>
      </el-space>
    </div>

    <!-- 步骤条 -->
    <div class="office-steps">
      <button
        v-for="s in steps"
        :key="s.key"
        type="button"
        class="office-step"
        :class="{ 'office-step--active': step === s.key }"
        @click="switchStep(s.key)"
      >
        <span>{{ s.label }}</span>
        <el-badge
          v-if="s.count > 0"
          :value="s.count"
          :max="99"
          class="office-step__badge"
        />
      </button>
    </div>

    <!-- 第①步:签收与复核 -->
    <section v-if="step === 'intake'">
      <el-tabs
        :model-value="intakeTab"
        @tab-change="key => switchIntakeTab(key as IntakeTab)"
      >
        <el-tab-pane
          v-for="tab in intakeTabs"
          :key="tab.key"
          :name="tab.key"
        >
          <template #label>
            {{ tab.label
            }}<el-badge
              v-if="tab.count"
              :value="tab.count"
              :max="99"
              class="tab-badge"
            />
          </template>
        </el-tab-pane>
      </el-tabs>

      <el-table
        :data="list"
        v-loading="loading"
        :row-class-name="tableRowClassName"
      >
        <el-table-column prop="envelope_no" label="信封编号" width="150" />
        <el-table-column label="项目" width="160">
          <template #default="scope">{{
            projectMap[scope.row.project_id] || scope.row.project_id
          }}</template>
        </el-table-column>
        <el-table-column label="填报人" width="130">
          <template #default="scope">{{
            toApplicantLabel(scope.row.applicant_userid)
          }}</template>
        </el-table-column>
        <el-table-column label="通道" width="90">
          <template #default="scope">
            <el-tag
              :type="scope.row.channel === 'physical' ? 'info' : 'success'"
              effect="light"
            >
              {{ channelLabel(scope.row.channel) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="amount" label="金额" width="100" />
        <el-table-column label="报销内容" min-width="160" show-overflow-tooltip>
          <template #default="scope">{{ scope.row.description || "-" }}</template>
        </el-table-column>
        <el-table-column label="异常提示" min-width="200">
          <template #default="scope">
            <el-space wrap>
              <el-tag
                v-for="tag in rowAnomalyTags(scope.row)"
                :key="tag.label"
                :type="tag.type"
                size="small"
                effect="light"
              >
                {{ tag.label }}
              </el-tag>
              <span v-if="rowAnomalyTags(scope.row).length === 0">-</span>
            </el-space>
          </template>
        </el-table-column>
        <el-table-column label="复核" width="90">
          <template #default="scope">{{
            precheckStatusLabel(scope.row.precheck_status)
          }}</template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="scope">
            <el-tag :type="reimbursementStatusTagType[scope.row.status] || 'info'">{{
              statusLabel(scope.row.status)
            }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="300" fixed="right">
          <template #default="scope">
            <el-button
              v-if="intakeTab === 'to_receive'"
              link
              type="success"
              @click="openDetail(scope.row.id)"
              >签收</el-button
            >
            <template v-if="intakeTab === 'to_precheck'">
              <el-button link type="success" @click="onPrecheck(scope.row.id, 'approved')"
                >复核通过</el-button
              >
              <el-button link type="warning" @click="onPrecheck(scope.row.id, 'supplement')"
                >补充材料</el-button
              >
              <el-button link type="danger" @click="onPrecheck(scope.row.id, 'rejected')"
                >复核驳回</el-button
              >
              <el-button link @click="onTriggerAnomaly(scope.row.id)">智能核查</el-button>
              <el-button link type="info" @click="onRerunSilentReview(scope.row.id)"
                >二次静默审查</el-button
              >
            </template>
            <el-button
              v-if="intakeTab === 'to_batch'"
              link
              type="primary"
              @click="goToBatchStep"
              >去成批 →</el-button
            >
            <el-button link type="primary" @click="openDetail(scope.row.id)">详情</el-button>
          </template>
        </el-table-column>
      </el-table>

      <el-pagination
        v-if="intakeTab === 'to_receive'"
        class="pagination"
        background
        layout="prev, pager, next, total"
        :current-page="page"
        :page-size="pageSize"
        :total="total"
        @current-change="
          (val: number) => {
            page = val;
            loadData();
          }
        "
      />
    </section>

    <!-- 第②步:成批送审 -->
    <section v-else-if="step === 'batch'" class="embedded-workflow">
      <ReimbursementBatchCenter />
    </section>

    <!-- 第③步:付款 -->
    <section v-else-if="step === 'payout'" class="embedded-workflow">
      <ReimbursementPayoutCenter />
    </section>

    <el-dialog v-model="quickScanVisible" title="UUID 快速签收" width="420px">
      <el-input v-model="quickScanUuid" placeholder="粘贴信封UUID" clearable />
      <template #footer>
        <el-button @click="quickScanVisible = false">取消</el-button>
        <el-button type="primary" @click="submitQuickScan">打开信封</el-button>
      </template>
    </el-dialog>

    <el-drawer
      v-model="detailDrawerVisible"
      title="报销信封详情"
      size="70%"
      @closed="onDetailDrawerClosed"
    >
      <ReimbursementDetail
        v-if="activeDetailId !== null"
        :envelope-id="activeDetailId"
        drawer-mode
        @close="detailDrawerVisible = false"
        @changed="onDetailChanged"
      />
    </el-drawer>
  </el-card>
</template>

<style scoped>
.office-toolbar {
  margin-bottom: 12px;
}
.office-steps {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
}
.office-step {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 14px 12px;
  background: #f8fafc;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  cursor: pointer;
  font-size: 15px;
  font-weight: 600;
}
.office-step--active {
  border-color: #2563eb;
  color: #2563eb;
  box-shadow: 0 2px 10px rgb(37 99 235 / 12%);
}
.office-step__badge,
.tab-badge {
  margin-left: 2px;
}
.pagination {
  margin-top: 12px;
  justify-content: flex-end;
}
.embedded-workflow {
  margin-top: 8px;
}
:deep(.reimbursement-row-high-risk) {
  background: #fef2f2;
}
</style>
```

**实现核对(已核准,勿改):** `ReimbursementDetail`(detail.vue)的 props 为 `envelopeId?: number|string`、`drawerMode?: boolean`、`workspaceView?: boolean`;emit 为 `close`/`changed`/`created`。抽屉里用 `:envelope-id`、`drawer-mode`、`@close`、`@changed`(financ 中心非 workspace,`workspace-view` 省略即 false,与 list.vue 财务中心用法一致)。`useWecomUserOptions` 的 `wecomUsers` 项含 `userid`/`name`(付款处理台已复用验证)。

- [ ] **Step 1: 写组件**(上面完整 SFC)

- [ ] **Step 2: 验证**

Run: `cd packages/web && npm run typecheck && npm run build`
Expected: PASS(注意:此时组件尚未接入路由,仅编译验证;下个任务加查询,Task 7 接路由后手测)

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/views/finance/reimbursement/office-workbench.vue
git commit -m "feat(web): 报销办公室三步流水线工作台(签收复核/成批/付款)"
```

---

### Task 6: office-workbench 加全流程查询

**Files:**
- Modify: `packages/web/src/views/finance/reimbursement/office-workbench.vue`

- [ ] **Step 1: script 增加查询状态与逻辑**

在 `<script setup>` 内新增(放在 `list`/`loadData` 附近):

```ts
import { resolveStation } from "./reimbursement-station";

const queryMode = ref(false);
const queryKeyword = ref("");
const queryList = ref<ReimbursementEnvelope[]>([]);
const queryLoading = ref(false);

const runQuery = async () => {
  const kw = queryKeyword.value.trim();
  if (!kw) {
    message("请输入信封号 / UUID / 发票号 / 事由关键字", { type: "warning" });
    return;
  }
  queryMode.value = true;
  queryLoading.value = true;
  try {
    const result = await listReimbursementEnvelopes({
      page: 1,
      pageSize: 50,
      keyword: kw,
      exclude_cancelled: false
    });
    queryList.value = result.data;
  } finally {
    queryLoading.value = false;
  }
};

const exitQuery = () => {
  queryMode.value = false;
  queryKeyword.value = "";
  queryList.value = [];
};

const stationLabel = (row: ReimbursementEnvelope) => resolveStation(row).label;

const goBatchDetail = (row: ReimbursementEnvelope) => {
  const station = resolveStation(row);
  if (station.batchId) {
    router.push(`/finance/reimbursement/batch/${station.batchId}`);
  } else {
    openDetail(row.id);
  }
};
```

- [ ] **Step 2: 模板加查询框与结果区**

在顶部动作区 `office-toolbar` 内(代员工发起按钮组同一行或上方)加查询框:

```html
<el-input
  v-model="queryKeyword"
  placeholder="全流程查询:信封号 / UUID / 发票号 / 事由"
  clearable
  style="width: 320px; margin-right: 12px"
  @keyup.enter="runQuery"
  @clear="exitQuery"
>
  <template #append>
    <el-button @click="runQuery">查询</el-button>
  </template>
</el-input>
```

把「步骤条 + 三步内容」整体用 `v-if="!queryMode"` 包裹;新增查询结果区 `v-else`:

```html
<section v-else class="query-panel">
  <div class="query-panel__head">
    <span>全流程查询结果（{{ queryList.length }}）</span>
    <el-button link type="primary" @click="exitQuery">返回工作台</el-button>
  </div>
  <el-table :data="queryList" v-loading="queryLoading">
    <el-table-column prop="envelope_no" label="信封编号" width="150" />
    <el-table-column label="填报人" width="130">
      <template #default="scope">{{
        toApplicantLabel(scope.row.applicant_userid)
      }}</template>
    </el-table-column>
    <el-table-column label="项目" width="160">
      <template #default="scope">{{
        projectMap[scope.row.project_id] || scope.row.project_id
      }}</template>
    </el-table-column>
    <el-table-column prop="amount" label="金额" width="100" />
    <el-table-column label="状态" width="110">
      <template #default="scope">
        <el-tag :type="reimbursementStatusTagType[scope.row.status] || 'info'">{{
          statusLabel(scope.row.status)
        }}</el-tag>
      </template>
    </el-table-column>
    <el-table-column label="当前站点" min-width="150">
      <template #default="scope">
        <strong>{{ stationLabel(scope.row) }}</strong>
      </template>
    </el-table-column>
    <el-table-column label="操作" width="160" fixed="right">
      <template #default="scope">
        <el-button link type="primary" @click="openDetail(scope.row.id)">详情</el-button>
        <el-button
          v-if="scope.row.batch_id"
          link
          type="warning"
          @click="goBatchDetail(scope.row)"
          >批次详情</el-button
        >
      </template>
    </el-table-column>
  </el-table>
</section>
```

对应样式:

```css
.query-panel__head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  font-weight: 600;
}
```

- [ ] **Step 3: 验证**

Run: `cd packages/web && npm run typecheck && npm run build`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/views/finance/reimbursement/office-workbench.vue
git commit -m "feat(web): 报销工作台全流程查询(当前站点直达)"
```

---

### Task 7: 财务中心路由切到 office-workbench

**Files:**
- Modify: `packages/web/src/router/modules/finance.ts`(约 25-32 行 `ReimbursementList` 条目)

- [ ] **Step 1: 改 component**

把 `/finance/reimbursement` 的 `component` 由 `list.vue` 改为 `office-workbench.vue`:

```ts
{
  path: "/finance/reimbursement",
  name: "ReimbursementList",
  component: () =>
    import("@/views/finance/reimbursement/office-workbench.vue"),
  meta: {
    title: "报销付款工作台",
    roles: ["super_admin", "manager", "finance"]
  }
},
```

`/workspace/my-reimbursement`(workspace.ts)保持指向 `list.vue`,不动。

- [ ] **Step 2: 验证**

Run: `cd packages/web && npm run typecheck && npm run build`
Expected: PASS。dev 手测:
- `/finance/reimbursement`:三步流水线、子页签计数、签收(打开抽屉)、复核三动作、去成批跳第②步、②③步嵌入 batch/payout、全流程查询与站点、UUID 快速签收、代发起。
- `/workspace/my-reimbursement`:员工视图**与改造前完全一致**(报销提交列表、发起报销)。

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/router/modules/finance.ts
git commit -m "feat(web): 财务中心报销入口切换到三步流水线工作台"
```

---

### Task 8: list.vue 死代码清理

**Files:**
- Modify: `packages/web/src/views/finance/reimbursement/list.vue`

**前提确认(实现前先验证):** 员工路由 `/workspace/my-reimbursement` 下 list.vue 只走 `submission` 视图——`workflowFromQuery()` 对 workspace 返回 null(`if (isWorkspaceRoute.value) return null`),`onMounted` 对 workspace 恒取 `submission`。财务中心已于 Task 7 切走。故 `office`/`approval`/`payout` 三视图分支对所有剩余消费者(仅员工 workspace)均为死代码。

- [ ] **Step 1: 移除死分支**

在 list.vue 中删除:
- `WorkflowView` 联合类型收窄为 `"submission"`(或若模板简化后不再需要该类型则移除相关切换 UI);
- 模板中 `workflowView === 'office' | 'approval' | 'payout'` 相关分支(含步骤条、summary-grid、嵌入 `<ReimbursementBatchCenter />` `<ReimbursementPayoutCenter />`、office 专属操作列按钮);
- `import ReimbursementBatchCenter` / `ReimbursementPayoutCenter`(office-workbench 已独立引用,list 不再需要);
- `applyWorkflowPreset` 中 office/approval/payout 分支;`workflowStepItems`/`isEnvelopeWorkflow`/`canOfficeOps`/`canFinanceCenter` 等仅服务于已删视图的逻辑按实际引用情况精简。
- 保留:submission 视图完整能力(员工发起、我的提交列表、状态多选筛选、详情跳转)。

**约束:** 仅删除确证不被 submission/workspace 动线引用的代码。删除后员工视图行为字节级不变。若某 helper 同时被 submission 使用,保留。遇到边界模糊停下报告,不强删。

- [ ] **Step 2: 验证**

Run: `cd packages/web && npm run typecheck && npm run build && npx eslint src/views/finance/reimbursement/list.vue`
Expected: PASS,无 unused 变量告警。dev 手测 `/workspace/my-reimbursement` 全流程不变。

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/views/finance/reimbursement/list.vue
git commit -m "refactor(web): 报销 list.vue 移除财务中心视图死代码"
```

---

### Task 9: 文档同步归档

**Files:**
- Modify: `doc/UI设计文档.md`(F. 报销付款工作台 节)
- Modify: `doc/开发记录.md`(文末追加)
- Move: 本设计与计划 → `docs/archive/`;更新两处 README

- [ ] **Step 1: UI设计文档**:F 节(报销付款工作台 `views/finance/reimbursement/list.vue`)改写:财务中心入口改为 `office-workbench.vue` 三步流水线(步骤条徽标口径、第①步三子页签口径、②③嵌入 batch/payout、全流程查询与当前站点、代发起/UUID签收/生成器入口);注明 `/workspace/my-reimbursement` 仍用 list.vue 员工视图;API 补 `/api/v1/reimbursement/workbench-summary`。

- [ ] **Step 2: 开发记录**文末追加 `## 2026-07-08 <时:分> (AEST)`,含目标/变更(API/Web 两块,列全部提交)/验证(先实跑 `cd packages/api && npx vitest run 2>&1 | tail -3` 取真实数字)/上线(随 push 自动部署,无迁移)。

- [ ] **Step 3: 移档 + commit**

```bash
git mv docs/planned/2026-07-08-reimbursement-office-workbench-design.md docs/archive/
git mv docs/planned/2026-07-08-reimbursement-office-workbench-plan.md docs/archive/
# docs/planned/README.md:清单恢复「暂无待实现计划。」
# docs/archive/README.md:按其既有列表格式补记这两个文档
git add doc/ docs/
git commit -m "docs: 报销工作台三步流水线实现记录与设计归档"
```

---

### Task 10: 整体验证与发布

- [ ] **Step 1: 全量测试** — `cd packages/api && npx vitest run && npm run typecheck && npm run lint`(全 PASS)
- [ ] **Step 2: Web 构建** — `cd packages/web && npm run typecheck && npm run build`(PASS)
- [ ] **Step 3: 关键动线手测**
  - 财务中心:三步切换与徽标、待签收/待复核/待成批子页签计数与流转、签收抽屉、复核三动作后计数刷新、去成批跳转、②③嵌入、全流程查询各站点(含 cancelled/审批中/已付)、批次详情跳转、UUID 快速签收、代发起。
  - 员工 `/workspace/my-reimbursement` 回归:提交列表、发起报销、筛选、详情——与改造前一致。
- [ ] **Step 4: 一次性 push(即部署)**

```bash
git push
```

推送后:`https://api.hybcdg.com/api/v1/system/health` 返回 ok=true;线上抽查 workbench-summary 与三步动线。

---

## Self-Review 记录

- 规格覆盖:设计一(路由结构)→Task 7;二(三步+子页签)→Task 5;三(全流程查询+站点)→Task 4+6;四(workbench-summary)→Task 1-2;五(测试文档)→Task 9-10;死代码清理(设计风险节)→Task 8;共享标签 DRY(设计未强制但减重叠)→Task 3。
- 占位符:无 TBD;Task 5/6 提供完整 SFC 与增量代码;Task 8 以「前提确认+仅删死分支+边界模糊即停」表述。
- 类型一致性:`ReimbursementWorkbenchSummary` 五字段贯穿 API 返回、web 类型、组件徽标;`Step`/`IntakeTab` 联合类型在 Task 5/6 一致;`resolveStation` 返回 `{label,batchId}` 在 Task 4 定义、Task 6 消费一致;`INTAKE_QUERY` 的 precheck 二次过滤口径与后端 summary 的 to_precheck/to_batch 口径一致。
- 已知取舍:列表 API 无 precheck_status 参数,待复核/待成批子页签用前端二次过滤(仅取当前页),与徽标(服务端精确计数)在跨页时可能有观感差——与设计「计数来自 summary、列表来自现有 API」一致,Task 5 已注释;若后续需精确分页,另加后端 precheck_status 参数(不在本期)。
