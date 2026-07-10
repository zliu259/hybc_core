# 报销模块增强实施计划（拆单 / AI一键成批 / 草稿异常管理 / 详情页优化）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现报销拆单（含电子发票混入防护）、AI 一键创建终审批次、签收工作台"草稿与异常"管理 tab（批量废止/软删除）、信封详情页体验优化（分组操作区/加载态/智能核查置顶/全面汉化/图片缩放预览）。

**Architecture:** 后端在 `packages/api/src/routes/reimbursement.ts`（Hono + D1）新增端点，校验逻辑按仓库惯例抽成同目录纯策略函数 + vitest 单测；前端在 `packages/web/src/views/finance/reimbursement/` 增改 Vue 组件。批次"确认创建并送审"由**前端顺序编排既有端点**（创建→送审→触发AI审计），后端只新增只读 proposals 端点——避免重构 4900 行文件中的付款关键路径（对 spec 的已确认修订，见 Task 18 spec 修订记录）。

**Tech Stack:** Hono / Cloudflare D1 / vitest；Vue 3 + Element Plus + jsPDF + qrcode（均已有依赖）。

**Spec:** `docs/superpowers/specs/2026-07-10-reimbursement-enhancements-design.md`

**验证命令速查**（在对应 package 目录执行）：

```bash
cd packages/api && npx vitest run src/routes/<file>.test.ts   # 单测
cd packages/api && npm run typecheck                           # API 类型检查
cd packages/web && npm run typecheck                           # Web 类型检查
cd packages/api && npm run db:migrate:local                    # 本地迁移
```

**执行注意：** 下文引用的行号基于当前 HEAD（0efd68c），执行时以代码片段定位为准，行号仅作导航参考。

---

## 文件地图

| 文件 | 动作 | 职责 |
|---|---|---|
| `packages/api/migrations/0057_reimbursement_split_lineage.sql` | 新建 | 拆单溯源列 |
| `packages/api/src/types/reimbursement.ts` | 修改 | 信封类型加拆单字段；新增 Split/Precheck 请求类型 |
| `packages/api/src/services/event-bus.ts` | 修改 | 注册 3 个新领域事件（SPLIT / BULK_VOIDED / BULK_DELETED） |
| `packages/api/src/routes/reimbursement-split-policy.ts` + `.test.ts` | 新建 | 拆单资格/金额/附件校验 |
| `packages/api/src/routes/reimbursement-einvoice-guard.ts` + `.test.ts` | 新建 | 电子发票混入实物信封检测 |
| `packages/api/src/routes/reimbursement-bulk-lifecycle-policy.ts` + `.test.ts` | 新建 | 批量废止/删除状态机 |
| `packages/api/src/routes/reimbursement-batch-proposal-policy.ts` + `.test.ts` | 新建 | 同人同项目分组 + 收款人唯一匹配 |
| `packages/api/src/routes/reimbursement.ts` | 修改 | 新端点 split / batch proposals / void-batch / delete-batch；precheck 门槛；summary 超管计数；列表 exclude_unassigned |
| `packages/web/src/api/reimbursement.ts` | 修改 | 新端点封装 + 类型 |
| `packages/web/src/views/finance/reimbursement/reimbursement-labels.ts` | 修改 | 汉化标签统一 + 电子发票行标签 |
| `packages/web/src/views/finance/reimbursement/reimbursement-einvoice.ts` | 新建 | 前端电子发票检测镜像 |
| `packages/web/src/views/finance/reimbursement/envelope-print.ts` | 新建 | 单信封 QR→PDF→打印工具 |
| `packages/web/src/views/finance/reimbursement/components/SplitEnvelopeDialog.vue` | 新建 | 拆单弹窗 |
| `packages/web/src/views/finance/reimbursement/components/AiBatchProposalsDrawer.vue` | 新建 | AI 一键成批抽屉 |
| `packages/web/src/views/finance/reimbursement/detail.vue` | 修改 | 分组操作区/加载态/核查卡置顶/汉化/图片预览/拆单接入 |
| `packages/web/src/views/finance/reimbursement/batch.vue` | 修改 | 接入 AI 一键成批 |
| `packages/web/src/views/finance/reimbursement/office-workbench.vue` | 修改 | 草稿与异常 tab + 批量操作 |
| `packages/web/src/views/finance/reimbursement/precheck.vue` | 修改 | toast 汉化（一行） |
| `packages/web/src/views/finance/reimbursement/envelope-generator 2.vue` | 删除 | 无引用重复文件 |
| `doc/开发记录.md` / `doc/UI设计文档.md` / spec | 修改 | 文档同步 |

---

## Task 1: 迁移 0057 + 信封类型字段

**Files:**
- Create: `packages/api/migrations/0057_reimbursement_split_lineage.sql`
- Modify: `packages/api/src/types/reimbursement.ts`（`ReimbursementEnvelope` 接口）

- [ ] **Step 1: 写迁移文件**

```sql
-- 报销拆单溯源：记录新单由哪张原单拆出、拆单原因
ALTER TABLE reimbursement_envelope ADD COLUMN split_from_envelope_id INTEGER;
ALTER TABLE reimbursement_envelope ADD COLUMN split_reason TEXT;
CREATE INDEX idx_reimbursement_split_from ON reimbursement_envelope(split_from_envelope_id);
```

- [ ] **Step 2: 本地应用迁移并验证**

Run: `cd packages/api && npm run db:migrate:local`
Expected: 输出包含 `0057_reimbursement_split_lineage.sql` 应用成功。

- [ ] **Step 3: 类型字段**

在 `packages/api/src/types/reimbursement.ts` 的 `ReimbursementEnvelope` 接口中（`duplicate_override_reason: string | null;` 之后）加：

```ts
  split_from_envelope_id: number | null;
  split_reason: string | null;
```

- [ ] **Step 4: typecheck 通过后提交**

Run: `cd packages/api && npm run typecheck`

```bash
git add packages/api/migrations/0057_reimbursement_split_lineage.sql packages/api/src/types/reimbursement.ts
git commit -m "feat(api): 报销拆单溯源迁移与类型字段"
```

---

## Task 2: 拆单策略函数（TDD）

**Files:**
- Create: `packages/api/src/routes/reimbursement-split-policy.ts`
- Test: `packages/api/src/routes/reimbursement-split-policy.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from "vitest";

import { decideSplitEnvelope } from "./reimbursement-split-policy";

const baseEnvelope = {
  status: "received",
  batch_id: null,
  approval_instance_id: null,
  amount: 300
};

const baseInput = {
  envelope: baseEnvelope,
  newProjectId: 2,
  newAmount: 100,
  originalAmount: 200,
  attachmentIds: [11, 12],
  ownedActiveAttachmentIds: [11, 12, 13]
};

describe("decideSplitEnvelope", () => {
  it("allows splitting a received envelope and reports amount delta", () => {
    const decision = decideSplitEnvelope(baseInput);
    expect(decision).toEqual({ allowed: true, amountDelta: 0 });
  });

  it("reports non-zero delta when split amounts do not sum to previous amount", () => {
    const decision = decideSplitEnvelope({ ...baseInput, newAmount: 150 });
    expect(decision).toEqual({ allowed: true, amountDelta: 50 });
  });

  it.each(["draft", "unregistered", "batched", "pending_approval", "approved", "paid", "rejected", "cancelled"])(
    "rejects status %s",
    (status) => {
      const decision = decideSplitEnvelope({
        ...baseInput,
        envelope: { ...baseEnvelope, status }
      });
      expect(decision.allowed).toBe(false);
    }
  );

  it("rejects envelope already in a batch", () => {
    const decision = decideSplitEnvelope({
      ...baseInput,
      envelope: { ...baseEnvelope, batch_id: 9 }
    });
    expect(decision.allowed).toBe(false);
  });

  it("rejects envelope with approval instance", () => {
    const decision = decideSplitEnvelope({
      ...baseInput,
      envelope: { ...baseEnvelope, approval_instance_id: 5 }
    });
    expect(decision.allowed).toBe(false);
  });

  it("rejects invalid target project", () => {
    expect(decideSplitEnvelope({ ...baseInput, newProjectId: 0 }).allowed).toBe(false);
    expect(decideSplitEnvelope({ ...baseInput, newProjectId: Number.NaN }).allowed).toBe(false);
  });

  it("rejects non-positive amounts", () => {
    expect(decideSplitEnvelope({ ...baseInput, newAmount: 0 }).allowed).toBe(false);
    expect(decideSplitEnvelope({ ...baseInput, originalAmount: -1 }).allowed).toBe(false);
    expect(decideSplitEnvelope({ ...baseInput, newAmount: Number.NaN }).allowed).toBe(false);
  });

  it("rejects attachments that do not belong to the envelope", () => {
    const decision = decideSplitEnvelope({ ...baseInput, attachmentIds: [11, 99] });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.message).toContain("99");
    }
  });

  it("allows splitting without moving any attachment (paper receipts stay physical)", () => {
    const decision = decideSplitEnvelope({ ...baseInput, attachmentIds: [] });
    expect(decision).toEqual({ allowed: true, amountDelta: 0 });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/api && npx vitest run src/routes/reimbursement-split-policy.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 最小实现**

```ts
export const SPLIT_ALLOWED_STATUSES = new Set(["submitted", "received"]);

export type SplitEnvelopeSnapshot = {
  status: string;
  batch_id: number | null;
  approval_instance_id: number | null;
  amount: number;
};

export type SplitDecisionInput = {
  envelope: SplitEnvelopeSnapshot;
  newProjectId: number;
  newAmount: number;
  originalAmount: number;
  attachmentIds: number[];
  ownedActiveAttachmentIds: number[];
};

export type SplitDecision =
  | { allowed: true; amountDelta: number }
  | { allowed: false; message: string };

const isPositiveAmount = (value: number): boolean =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

export const decideSplitEnvelope = (input: SplitDecisionInput): SplitDecision => {
  if (!SPLIT_ALLOWED_STATUSES.has(input.envelope.status)) {
    return {
      allowed: false,
      message: `Envelope in status ${input.envelope.status} cannot be split`
    };
  }
  if (input.envelope.batch_id !== null) {
    return { allowed: false, message: "Envelope already belongs to a batch" };
  }
  if (input.envelope.approval_instance_id !== null) {
    return { allowed: false, message: "Envelope already linked to an approval instance" };
  }
  if (!Number.isFinite(input.newProjectId) || input.newProjectId <= 0) {
    return { allowed: false, message: "new_envelope.project_id is required" };
  }
  if (!isPositiveAmount(input.newAmount)) {
    return { allowed: false, message: "new_envelope.amount must be a positive number" };
  }
  if (!isPositiveAmount(input.originalAmount)) {
    return { allowed: false, message: "original_amount must be a positive number" };
  }

  const ownedSet = new Set(input.ownedActiveAttachmentIds);
  const foreign = input.attachmentIds.filter((id) => !ownedSet.has(id));
  if (foreign.length > 0) {
    return {
      allowed: false,
      message: `Attachments not found on envelope: ${foreign.join(", ")}`
    };
  }

  return {
    allowed: true,
    amountDelta: input.newAmount + input.originalAmount - input.envelope.amount
  };
};
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/api && npx vitest run src/routes/reimbursement-split-policy.test.ts`
Expected: PASS（10 用例）

- [ ] **Step 5: 提交**

```bash
git add packages/api/src/routes/reimbursement-split-policy.ts packages/api/src/routes/reimbursement-split-policy.test.ts
git commit -m "feat(api): 报销拆单资格校验策略函数（TDD）"
```

---

## Task 3: 电子发票混入检测（TDD）

**Files:**
- Create: `packages/api/src/routes/reimbursement-einvoice-guard.ts`
- Test: `packages/api/src/routes/reimbursement-einvoice-guard.test.ts`

背景：数电票（全面数字化电子发票）号码为 20 位纯数字；纸质增值税发票号码为 8 位。静默审查结果存于信封 `ocr_result_json`（含 `extracted_invoices[]`，每项有 `invoice_unique_no`/`invoice_no`），另有 `ocr_invoice_unique_no_hint` 顶层提示字段。

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from "vitest";

import { detectEInvoiceInPhysical, isElectronicInvoiceNumber } from "./reimbursement-einvoice-guard";

const ocrJson = (invoices: Record<string, unknown>[]): string =>
  JSON.stringify({ extracted_invoices: invoices });

describe("isElectronicInvoiceNumber", () => {
  it("accepts 20-digit numbers with surrounding whitespace", () => {
    expect(isElectronicInvoiceNumber("24312000000012345678")).toBe(true);
    expect(isElectronicInvoiceNumber(" 24312000000012345678 ")).toBe(true);
  });

  it("rejects paper invoice numbers and non-strings", () => {
    expect(isElectronicInvoiceNumber("12345678")).toBe(false);
    expect(isElectronicInvoiceNumber("2431200000001234567X")).toBe(false);
    expect(isElectronicInvoiceNumber(12345678)).toBe(false);
    expect(isElectronicInvoiceNumber(null)).toBe(false);
  });
});

describe("detectEInvoiceInPhysical", () => {
  it("detects a 20-digit e-invoice number inside a physical envelope", () => {
    const result = detectEInvoiceInPhysical({
      channel: "physical",
      ocrResultJson: ocrJson([{ invoice_unique_no: "24312000000012345678" }])
    });
    expect(result.detected).toBe(true);
    expect(result.matchedNumbers).toEqual(["24312000000012345678"]);
  });

  it("detects via top-level hint when extracted list is empty", () => {
    const result = detectEInvoiceInPhysical({
      channel: "physical",
      ocrResultJson: null,
      invoiceUniqueNoHint: "24312000000012345678"
    });
    expect(result.detected).toBe(true);
  });

  it("ignores electronic-channel envelopes", () => {
    const result = detectEInvoiceInPhysical({
      channel: "electronic",
      ocrResultJson: ocrJson([{ invoice_unique_no: "24312000000012345678" }])
    });
    expect(result.detected).toBe(false);
  });

  it("ignores paper invoice numbers", () => {
    const result = detectEInvoiceInPhysical({
      channel: "physical",
      ocrResultJson: ocrJson([{ invoice_no: "12345678", invoice_unique_no: "12345678" }])
    });
    expect(result.detected).toBe(false);
  });

  it("tolerates malformed json and missing fields", () => {
    expect(
      detectEInvoiceInPhysical({ channel: "physical", ocrResultJson: "not-json" }).detected
    ).toBe(false);
    expect(
      detectEInvoiceInPhysical({ channel: "physical", ocrResultJson: "{}" }).detected
    ).toBe(false);
  });

  it("deduplicates matched numbers", () => {
    const result = detectEInvoiceInPhysical({
      channel: "physical",
      ocrResultJson: ocrJson([
        { invoice_unique_no: "24312000000012345678" },
        { invoice_unique_no: "24312000000012345678" }
      ])
    });
    expect(result.matchedNumbers).toEqual(["24312000000012345678"]);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/api && npx vitest run src/routes/reimbursement-einvoice-guard.test.ts`
Expected: FAIL

- [ ] **Step 3: 最小实现**

```ts
const E_INVOICE_NUMBER_PATTERN = /^\d{20}$/;

export const isElectronicInvoiceNumber = (value: unknown): boolean =>
  typeof value === "string" && E_INVOICE_NUMBER_PATTERN.test(value.trim());

export type EInvoiceDetectionInput = {
  channel: string;
  ocrResultJson: string | null;
  invoiceUniqueNoHint?: string | null;
};

export type EInvoiceDetectionResult = {
  detected: boolean;
  matchedNumbers: string[];
};

export const detectEInvoiceInPhysical = (
  input: EInvoiceDetectionInput
): EInvoiceDetectionResult => {
  if (input.channel !== "physical") {
    return { detected: false, matchedNumbers: [] };
  }

  const matched = new Set<string>();

  if (isElectronicInvoiceNumber(input.invoiceUniqueNoHint)) {
    matched.add(String(input.invoiceUniqueNoHint).trim());
  }

  if (input.ocrResultJson) {
    try {
      const parsed = JSON.parse(input.ocrResultJson) as Record<string, unknown>;
      const invoices = Array.isArray(parsed.extracted_invoices)
        ? (parsed.extracted_invoices as Record<string, unknown>[])
        : [];
      for (const invoice of invoices) {
        for (const candidate of [invoice.invoice_unique_no, invoice.invoice_no]) {
          if (isElectronicInvoiceNumber(candidate)) {
            matched.add(String(candidate).trim());
          }
        }
      }
    } catch {
      // 非法 JSON 视为无信号，不阻断
    }
  }

  return { detected: matched.size > 0, matchedNumbers: [...matched] };
};
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/api && npx vitest run src/routes/reimbursement-einvoice-guard.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/api/src/routes/reimbursement-einvoice-guard.ts packages/api/src/routes/reimbursement-einvoice-guard.test.ts
git commit -m "feat(api): 电子发票混入实物信封检测策略（TDD）"
```

---

## Task 4: 批量废止/删除状态机（TDD）

**Files:**
- Create: `packages/api/src/routes/reimbursement-bulk-lifecycle-policy.ts`
- Test: `packages/api/src/routes/reimbursement-bulk-lifecycle-policy.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from "vitest";

import { decideBulkLifecycle } from "./reimbursement-bulk-lifecycle-policy";

describe("decideBulkLifecycle", () => {
  it.each(["draft", "unregistered", "submitted", "received"])(
    "allows voiding status %s",
    (status) => {
      expect(decideBulkLifecycle("void", status)).toEqual({
        allowed: true,
        nextStatus: "cancelled"
      });
    }
  );

  it.each(["batched", "pending_approval", "approved", "paid", "cancelled", "deleted"])(
    "rejects voiding status %s",
    (status) => {
      expect(decideBulkLifecycle("void", status).allowed).toBe(false);
    }
  );

  it.each(["draft", "unregistered", "cancelled"])("allows deleting status %s", (status) => {
    expect(decideBulkLifecycle("delete", status)).toEqual({
      allowed: true,
      nextStatus: "deleted"
    });
  });

  it.each(["submitted", "received", "batched", "pending_approval", "approved", "paid", "deleted"])(
    "rejects deleting status %s (must void first or never entered flow)",
    (status) => {
      expect(decideBulkLifecycle("delete", status).allowed).toBe(false);
    }
  );
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/api && npx vitest run src/routes/reimbursement-bulk-lifecycle-policy.test.ts`
Expected: FAIL

- [ ] **Step 3: 最小实现**

```ts
export type BulkLifecycleAction = "void" | "delete";

const VOID_ALLOWED = new Set(["draft", "unregistered", "submitted", "received"]);
const DELETE_ALLOWED = new Set(["draft", "unregistered", "cancelled"]);

export type BulkLifecycleDecision =
  | { allowed: true; nextStatus: "cancelled" | "deleted" }
  | { allowed: false; message: string };

export const decideBulkLifecycle = (
  action: BulkLifecycleAction,
  status: string
): BulkLifecycleDecision => {
  if (action === "void") {
    return VOID_ALLOWED.has(status)
      ? { allowed: true, nextStatus: "cancelled" }
      : { allowed: false, message: `Envelope in status ${status} cannot be voided` };
  }
  return DELETE_ALLOWED.has(status)
    ? { allowed: true, nextStatus: "deleted" }
    : {
        allowed: false,
        message: `Envelope in status ${status} cannot be deleted (void it first)`
      };
};
```

- [ ] **Step 4: 运行确认通过并提交**

Run: `cd packages/api && npx vitest run src/routes/reimbursement-bulk-lifecycle-policy.test.ts`
Expected: PASS

```bash
git add packages/api/src/routes/reimbursement-bulk-lifecycle-policy.ts packages/api/src/routes/reimbursement-bulk-lifecycle-policy.test.ts
git commit -m "feat(api): 报销批量废止/软删除状态机策略（TDD）"
```

---

## Task 5: 批次建议分组策略（TDD）

**Files:**
- Create: `packages/api/src/routes/reimbursement-batch-proposal-policy.ts`
- Test: `packages/api/src/routes/reimbursement-batch-proposal-policy.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from "vitest";

import {
  groupBatchProposals,
  matchUniqueInternalPayee
} from "./reimbursement-batch-proposal-policy";

describe("groupBatchProposals", () => {
  it("groups envelopes by project and applicant with totals", () => {
    const groups = groupBatchProposals([
      { id: 1, project_id: 10, applicant_userid: "zhang", amount: 100 },
      { id: 2, project_id: 10, applicant_userid: "zhang", amount: 50.5 },
      { id: 3, project_id: 10, applicant_userid: "li", amount: 30 },
      { id: 4, project_id: 20, applicant_userid: "zhang", amount: 70 }
    ]);
    expect(groups).toHaveLength(3);
    const zhang10 = groups.find(
      (g) => g.project_id === 10 && g.applicant_userid === "zhang"
    );
    expect(zhang10?.envelope_ids).toEqual([1, 2]);
    expect(zhang10?.item_count).toBe(2);
    expect(zhang10?.total_amount).toBeCloseTo(150.5);
  });

  it("returns empty for no envelopes", () => {
    expect(groupBatchProposals([])).toEqual([]);
  });

  it("sorts groups by applicant then project for stable display", () => {
    const groups = groupBatchProposals([
      { id: 1, project_id: 20, applicant_userid: "zhang", amount: 1 },
      { id: 2, project_id: 10, applicant_userid: "li", amount: 1 },
      { id: 3, project_id: 10, applicant_userid: "zhang", amount: 1 }
    ]);
    expect(
      groups.map((g) => `${g.applicant_userid}:${g.project_id}`)
    ).toEqual(["li:10", "zhang:10", "zhang:20"]);
  });
});

describe("matchUniqueInternalPayee", () => {
  const payees = [
    { id: 1, linked_userid: "zhang", status: "active", type: "internal" },
    { id: 2, linked_userid: "li", status: "active", type: "internal" },
    { id: 3, linked_userid: "li", status: "active", type: "internal" },
    { id: 4, linked_userid: "wang", status: "inactive", type: "internal" }
  ];

  it("matches the unique active internal payee", () => {
    expect(matchUniqueInternalPayee(payees, "zhang")?.id).toBe(1);
  });

  it("returns null when multiple payees exist", () => {
    expect(matchUniqueInternalPayee(payees, "li")).toBeNull();
  });

  it("ignores inactive payees and unknown users", () => {
    expect(matchUniqueInternalPayee(payees, "wang")).toBeNull();
    expect(matchUniqueInternalPayee(payees, "zhao")).toBeNull();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/api && npx vitest run src/routes/reimbursement-batch-proposal-policy.test.ts`
Expected: FAIL

- [ ] **Step 3: 最小实现**

```ts
export type ProposalEnvelopeInput = {
  id: number;
  project_id: number;
  applicant_userid: string;
  amount: number;
};

export type BatchProposalGroup = {
  project_id: number;
  applicant_userid: string;
  envelope_ids: number[];
  item_count: number;
  total_amount: number;
};

export const groupBatchProposals = (
  envelopes: ProposalEnvelopeInput[]
): BatchProposalGroup[] => {
  const groups = new Map<string, BatchProposalGroup>();
  for (const envelope of envelopes) {
    const key = `${envelope.applicant_userid} ${envelope.project_id}`;
    const existing = groups.get(key);
    if (existing) {
      groups.set(key, {
        ...existing,
        envelope_ids: [...existing.envelope_ids, envelope.id],
        item_count: existing.item_count + 1,
        total_amount: existing.total_amount + (envelope.amount || 0)
      });
    } else {
      groups.set(key, {
        project_id: envelope.project_id,
        applicant_userid: envelope.applicant_userid,
        envelope_ids: [envelope.id],
        item_count: 1,
        total_amount: envelope.amount || 0
      });
    }
  }
  return [...groups.values()].sort((a, b) => {
    if (a.applicant_userid !== b.applicant_userid) {
      return a.applicant_userid < b.applicant_userid ? -1 : 1;
    }
    return a.project_id - b.project_id;
  });
};

export type PayeeCandidate = {
  id: number;
  linked_userid: string | null;
  status: string;
  type: string;
};

export const matchUniqueInternalPayee = <T extends PayeeCandidate>(
  payees: T[],
  applicantUserid: string
): T | null => {
  const candidates = payees.filter(
    (payee) =>
      payee.type === "internal" &&
      payee.status === "active" &&
      payee.linked_userid === applicantUserid
  );
  return candidates.length === 1 ? candidates[0] : null;
};
```

- [ ] **Step 4: 运行确认通过并提交**

Run: `cd packages/api && npx vitest run src/routes/reimbursement-batch-proposal-policy.test.ts`
Expected: PASS

```bash
git add packages/api/src/routes/reimbursement-batch-proposal-policy.ts packages/api/src/routes/reimbursement-batch-proposal-policy.test.ts
git commit -m "feat(api): 批次建议分组与收款人唯一匹配策略（TDD）"
```

---

## Task 6: 拆单端点 `POST /:id/split`

**Files:**
- Modify: `packages/api/src/types/reimbursement.ts`（加请求类型）
- Modify: `packages/api/src/services/event-bus.ts`（注册 `REIMBURSEMENT_ENVELOPE_SPLIT` 等 3 个事件类型）
- Modify: `packages/api/src/routes/reimbursement.ts`（新端点，插在 `POST /:id/void` 定义之后，约 4724 行处）

- [ ] **Step 0: 注册领域事件类型**

在 `packages/api/src/services/event-bus.ts` 的 `domainEventTypes` 数组中，紧跟现有的 `"REIMBURSEMENT_ENVELOPE_CANCELLED",` 之后加三行（保持信封级事件在批次级事件之前）：

```ts
  "REIMBURSEMENT_ENVELOPE_SPLIT",
  "REIMBURSEMENT_ENVELOPE_BULK_VOIDED",
  "REIMBURSEMENT_ENVELOPE_BULK_DELETED",
```

`publishEvent` 的 `type` 参数是 `DomainEventType` 字面量联合，未注册的事件名无法通过 `tsc`。Task 9 的 `REIMBURSEMENT_ENVELOPE_BULK_VOIDED` / `_BULK_DELETED` 一并在此注册，避免 Task 9 重复踩坑。

- [ ] **Step 1: 请求类型**

在 `types/reimbursement.ts` 中（`VerifyEnvelopeRequest` 附近）加：

```ts
export interface SplitEnvelopeRequest {
  new_envelope: {
    project_id: number;
    amount: number;
    category?: string;
    description?: string;
    expense_date?: string;
  };
  attachment_ids?: number[];
  original_amount: number;
  reason?: string;
}
```

- [ ] **Step 2: 端点实现**

在 `reimbursement.ts` 顶部 import 区加：

```ts
import { decideSplitEnvelope } from "./reimbursement-split-policy";
```

并在类型 import 列表中加入 `SplitEnvelopeRequest`。在 `POST /:id/void` 端点之后插入：

```ts
reimbursementRoutes.post(
  "/:id/split",
  requireRoles(["super_admin", "finance"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const auth = c.get("auth");
    const body = (await c.req.json()) as SplitEnvelopeRequest;

    const envelope = await c.env.DB.prepare(
      "SELECT * FROM reimbursement_envelope WHERE id = ? AND status != 'deleted'"
    )
      .bind(id)
      .first<ReimbursementEnvelope>();

    if (!envelope) {
      return c.json({ success: false, error: { message: "Envelope not found" } }, 404);
    }

    const ownedAttachments = await c.env.DB.prepare(
      "SELECT id FROM envelope_attachment WHERE envelope_id = ? AND status = 'active'"
    )
      .bind(id)
      .all<{ id: number }>();

    const attachmentIds = (body.attachment_ids ?? []).map((value) => Number(value));
    const decision = decideSplitEnvelope({
      envelope: {
        status: envelope.status,
        batch_id: envelope.batch_id,
        approval_instance_id: envelope.approval_instance_id,
        amount: envelope.amount
      },
      newProjectId: Number(body.new_envelope?.project_id),
      newAmount: Number(body.new_envelope?.amount),
      originalAmount: Number(body.original_amount),
      attachmentIds,
      ownedActiveAttachmentIds: (ownedAttachments.results ?? []).map((row) => row.id)
    });

    if (!decision.allowed) {
      return c.json({ success: false, error: { message: decision.message } }, 400);
    }

    const idempotencyKey = c.req.header("Idempotency-Key");
    const idempotency = await beginIdempotentRequest<{
      success: boolean;
      data: {
        new_envelope: { id: number; envelope_no: string; envelope_uuid: string };
        original: { id: number; amount: number };
        amount_delta: number;
      };
    }>(c.env.DB, `reimbursement:split:${id}`, auth.sub, idempotencyKey);
    if (idempotency.kind === "replay") {
      return c.json(idempotency.payload, { status: idempotency.statusCode as 201 });
    }
    if (idempotency.kind === "pending") {
      return c.json({ success: false, error: { message: "Split already in progress" } }, 409);
    }

    const now = nowIso();
    const newUuid = crypto.randomUUID();
    let newId = 0;

    try {
      await runInTransaction(c.env.DB, async () => {
        const insert = await c.env.DB.prepare(
          `INSERT INTO reimbursement_envelope
             (envelope_no, envelope_uuid, project_id, applicant_userid, channel,
              expense_date, amount, category, description,
              status, precheck_status, verification_status, verification_note,
              split_from_envelope_id, split_reason,
              submitted_at, received_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'none', ?, ?, ?, ?, ?, ?, ?, ?)`
        )
          .bind(
            newUuid,
            newUuid,
            Number(body.new_envelope.project_id),
            envelope.applicant_userid,
            envelope.channel,
            body.new_envelope.expense_date ?? null,
            Number(body.new_envelope.amount),
            body.new_envelope.category ?? null,
            body.new_envelope.description ?? null,
            envelope.status,
            envelope.verification_status,
            envelope.verification_note,
            id,
            body.reason ?? null,
            envelope.submitted_at,
            envelope.received_at,
            now,
            now
          )
          .run();
        newId = insert.meta.last_row_id as number;

        if (attachmentIds.length > 0) {
          const placeholders = attachmentIds.map(() => "?").join(", ");
          const moved = await c.env.DB.prepare(
            `UPDATE envelope_attachment SET envelope_id = ?
              WHERE id IN (${placeholders}) AND envelope_id = ? AND status = 'active'`
          )
            .bind(newId, ...attachmentIds, id)
            .run();
          if ((moved.meta.changes ?? 0) !== attachmentIds.length) {
            throw new Error("Attachment transfer mismatch, split aborted");
          }
        }

        const updated = await c.env.DB.prepare(
          `UPDATE reimbursement_envelope
              SET amount = ?, precheck_status = 'none', updated_at = ?
            WHERE id = ? AND batch_id IS NULL AND status = ?`
        )
          .bind(Number(body.original_amount), now, id, envelope.status)
          .run();
        if ((updated.meta.changes ?? 0) !== 1) {
          throw new Error("Envelope changed during split, aborted");
        }
      });
    } catch (error) {
      await abandonIdempotentRequest(
        c.env.DB,
        `reimbursement:split:${id}`,
        auth.sub,
        idempotencyKey
      );
      throw error;
    }

    // 拆单后自动核查：两边各自重新静默审查（票据识别+重复校验+合理性）
    await enqueueEnvelopeAiAudit(c.env, id, {
      forceRerun: true,
      triggeredBy: auth.sub,
      reason: "envelope_split_source"
    });
    await enqueueEnvelopeAiAudit(c.env, newId, {
      forceRerun: true,
      triggeredBy: auth.sub,
      reason: "envelope_split_child"
    });

    await publishEvent(c.env, "REIMBURSEMENT_ENVELOPE_SPLIT", "reimbursement_envelope", {
      source_envelope_id: id,
      new_envelope_id: newId,
      new_envelope_uuid: newUuid,
      moved_attachment_ids: attachmentIds,
      operator: auth.sub
    });

    await writeAuditLog(c.env.DB, {
      actorUserId: auth.sub,
      actorRoles: auth.roles,
      action: "reimbursement.envelope.split",
      targetType: "reimbursement_envelope",
      targetId: id,
      detail: {
        new_envelope_id: newId,
        new_envelope_uuid: newUuid,
        new_project_id: Number(body.new_envelope.project_id),
        new_amount: Number(body.new_envelope.amount),
        original_amount: Number(body.original_amount),
        moved_attachment_ids: attachmentIds,
        reason: body.reason ?? null,
        amount_delta: decision.amountDelta
      }
    });

    const payload = {
      success: true,
      data: {
        new_envelope: { id: newId, envelope_no: newUuid, envelope_uuid: newUuid },
        original: { id, amount: Number(body.original_amount) },
        amount_delta: decision.amountDelta
      }
    };
    await completeIdempotentRequest(
      c.env.DB,
      `reimbursement:split:${id}`,
      auth.sub,
      idempotencyKey,
      201,
      payload
    );
    return c.json(payload, 201);
  }
);
```

注意：`enqueueEnvelopeAiAudit` 签名为 `(env, envelopeId, options?: { file_key?; forceRerun?; triggeredBy?; reason? })`，已在同文件 795 行定义，直接复用。

- [ ] **Step 3: 验证**

Run: `cd packages/api && npm run typecheck && npx vitest run`
Expected: 类型通过，全部测试 PASS。

- [ ] **Step 4: 提交**

```bash
git add packages/api/src/types/reimbursement.ts packages/api/src/routes/reimbursement.ts
git commit -m "feat(api): 报销拆单端点（附件转移+溯源+自动核查+幂等）"
```

---

## Task 7: 复核通过的电子发票门槛

**Files:**
- Modify: `packages/api/src/types/reimbursement.ts`（`PrecheckEnvelopeRequest` 加字段）
- Modify: `packages/api/src/routes/reimbursement.ts`（precheck 端点，约 3600-3728 行）

- [ ] **Step 1: 请求类型加可选强制通过字段**

找到 `PrecheckEnvelopeRequest`（types/reimbursement.ts），加：

```ts
  /** 电子发票混入实物信封时的强制通过理由（仅 finance/super_admin） */
  override_einvoice_reason?: string;
```

- [ ] **Step 2: precheck 端点扩展查询列**

`reimbursement.ts` precheck 端点内（约 3615 行），把 SELECT 改为：

```ts
    const envelope = await c.env.DB.prepare(
      `SELECT id, status, duplicate_check_status, duplicate_override_requested, applicant_userid,
              channel, ocr_result_json, ocr_invoice_unique_no_hint
         FROM reimbursement_envelope
        WHERE id = ? AND status != 'deleted'`
    )
      .bind(id)
      .first<{
        id: number;
        status: string;
        duplicate_check_status: string;
        duplicate_override_requested: number;
        applicant_userid: string;
        channel: string;
        ocr_result_json: string | null;
        ocr_invoice_unique_no_hint: string | null;
      }>();
```

- [ ] **Step 3: 加门槛逻辑**

顶部 import：

```ts
import { detectEInvoiceInPhysical } from "./reimbursement-einvoice-guard";
```

在 `if (body.action === "approved") { ... }` 块的**末尾**（重复风险 override 检查之后、块结束大括号之前）插入：

```ts
      const einvoice = detectEInvoiceInPhysical({
        channel: envelope.channel,
        ocrResultJson: envelope.ocr_result_json,
        invoiceUniqueNoHint: envelope.ocr_invoice_unique_no_hint
      });
      if (einvoice.detected) {
        const overrideReason =
          typeof body.override_einvoice_reason === "string"
            ? body.override_einvoice_reason.trim()
            : "";
        const canOverride =
          auth.roles.includes("super_admin") || auth.roles.includes("finance");
        if (!overrideReason || !canOverride) {
          return c.json(
            {
              success: false,
              error: {
                message:
                  "Electronic invoice detected in a physical envelope. Reject the precheck and ask the applicant to resubmit via the electronic channel, or override with a reason (finance/super_admin only)."
              },
              data: {
                einvoice_in_physical: true,
                matched_invoice_nos: einvoice.matchedNumbers
              }
            },
            400
          );
        }
        await writeAuditLog(c.env.DB, {
          actorUserId: auth.sub,
          actorRoles: auth.roles,
          action: "reimbursement.envelope.precheck_einvoice_override",
          targetType: "reimbursement_envelope",
          targetId: id,
          detail: {
            reason: overrideReason,
            matched_invoice_nos: einvoice.matchedNumbers
          }
        });
      }
```

- [ ] **Step 4: 验证并提交**

Run: `cd packages/api && npm run typecheck && npx vitest run`
Expected: PASS

```bash
git add packages/api/src/types/reimbursement.ts packages/api/src/routes/reimbursement.ts
git commit -m "feat(api): 复核通过拦截电子发票混入实物信封（可留痕强制通过）"
```

---

## Task 8: `GET /batch/proposals` + 列表 `exclude_unassigned` 参数

**Files:**
- Modify: `packages/api/src/routes/reimbursement.ts`

- [ ] **Step 1: proposals 端点**

⚠️ **必须注册在 `GET /batch/:id`（约 1597 行）之前**，与 `GET /batch/candidates`（约 1563 行）相邻插入。顶部 import：

```ts
import {
  groupBatchProposals,
  matchUniqueInternalPayee
} from "./reimbursement-batch-proposal-policy";
```

端点代码：

```ts
reimbursementRoutes.get(
  "/batch/proposals",
  requireRoles(["super_admin", "manager", "site_manager", "finance"]),
  async (c) => {
    const eligible = await c.env.DB.prepare(
      `SELECT
         e.id, e.envelope_no, e.project_id, e.applicant_userid, e.amount,
         e.description, e.channel,
         (
           SELECT CASE MAX(
             CASE d.risk_level WHEN 'high' THEN 3 WHEN 'medium' THEN 2 WHEN 'low' THEN 1 ELSE 0 END
           ) WHEN 3 THEN 'high' WHEN 2 THEN 'medium' WHEN 1 THEN 'low' ELSE NULL END
             FROM reimbursement_duplicate_check d
            WHERE d.envelope_id = e.id
         ) AS duplicate_risk_level
       FROM reimbursement_envelope e
       WHERE e.status = 'received'
         AND e.precheck_status = 'approved'
         AND e.batch_id IS NULL
         AND e.approval_instance_id IS NULL
       ORDER BY e.applicant_userid ASC, e.project_id ASC, e.id ASC`
    ).all<{
      id: number;
      envelope_no: string;
      project_id: number;
      applicant_userid: string;
      amount: number;
      description: string | null;
      channel: string;
      duplicate_risk_level: "high" | "medium" | "low" | null;
    }>();

    const rows = eligible.results ?? [];
    const groups = groupBatchProposals(rows);

    const applicantIds = [...new Set(rows.map((row) => row.applicant_userid))];
    let payees: {
      id: number;
      name: string;
      bank_name: string;
      bank_account: string;
      linked_userid: string | null;
      status: string;
      type: string;
    }[] = [];
    if (applicantIds.length > 0) {
      const placeholders = applicantIds.map(() => "?").join(", ");
      const payeeRows = await c.env.DB.prepare(
        `SELECT id, name, bank_name, bank_account, linked_userid, status, type
           FROM payee
          WHERE type = 'internal' AND status = 'active' AND linked_userid IN (${placeholders})`
      )
        .bind(...applicantIds)
        .all<(typeof payees)[number]>();
      payees = payeeRows.results ?? [];
    }

    const envelopeById = new Map(rows.map((row) => [row.id, row]));
    const requirePayee =
      (c.env.REIMBURSEMENT_REQUIRE_PAYEE ?? "false").toLowerCase() === "true";

    const proposals = groups.map((group) => {
      const matched = matchUniqueInternalPayee(payees, group.applicant_userid);
      return {
        project_id: group.project_id,
        applicant_userid: group.applicant_userid,
        item_count: group.item_count,
        total_amount: group.total_amount,
        envelopes: group.envelope_ids.map((envelopeId) => {
          const row = envelopeById.get(envelopeId);
          return {
            id: envelopeId,
            envelope_no: row?.envelope_no ?? "",
            amount: row?.amount ?? 0,
            description: row?.description ?? null,
            channel: row?.channel ?? "physical",
            duplicate_risk_level: row?.duplicate_risk_level ?? null
          };
        }),
        matched_payee: matched
          ? {
              id: matched.id,
              name: matched.name,
              bank_name: matched.bank_name,
              bank_account: matched.bank_account
            }
          : null,
        payee_required: requirePayee,
        suggested_payment_method: "personal_transfer"
      };
    });

    return c.json({ success: true, data: proposals });
  }
);
```

- [ ] **Step 2: 列表 `exclude_unassigned` 参数**

`GET /`（约 1304 行）中，在 `excludeCancelled` 解析之后加：

```ts
  const excludeUnassigned = ["1", "true", "yes"].includes(
    (c.req.query("exclude_unassigned") ?? "").toLowerCase()
  );
```

在 `if (legacyDataId) {...}` 块之后加：

```ts
  if (excludeUnassigned) {
    sql += " AND e.applicant_userid != ?";
    countSql += " AND e.applicant_userid != ?";
    params.push(UNASSIGNED_APPLICANT);
  }
```

背景：信封生成器预生成的空白信封为 `unregistered` + `applicant_userid='__UNASSIGNED__'`，属于库存而非垃圾，"草稿/未登记"管理页必须排除。

- [ ] **Step 3: 验证并提交**

Run: `cd packages/api && npm run typecheck && npx vitest run`
Expected: PASS

```bash
git add packages/api/src/routes/reimbursement.ts
git commit -m "feat(api): 批次建议只读端点与列表排除未分配空白信封参数"
```

---

## Task 9: 批量废止/软删除端点

**Files:**
- Modify: `packages/api/src/routes/reimbursement.ts`（插在 `POST /:id/void` 之前）

> 备注：事件类型 `REIMBURSEMENT_ENVELOPE_BULK_VOIDED` / `_BULK_DELETED` 已在 Task 6 于 `event-bus.ts` 注册，本任务无需再改该文件。

- [ ] **Step 1: 实现两个端点**

顶部 import：

```ts
import { decideBulkLifecycle, type BulkLifecycleAction } from "./reimbursement-bulk-lifecycle-policy";
```

插入共享处理函数与两个端点（放在 `POST /:id/void` 定义之前）：

```ts
const MAX_BULK_LIFECYCLE_IDS = 500;

const handleBulkLifecycle = async (
  c: Parameters<Parameters<typeof reimbursementRoutes.post>[2]>[0],
  action: BulkLifecycleAction
) => {
  const auth = c.get("auth");
  const body = (await c.req.json().catch(() => ({}))) as {
    envelope_ids?: unknown;
    reason?: string;
  };

  const ids = Array.isArray(body.envelope_ids)
    ? [...new Set(body.envelope_ids.map((value) => Number(value)))].filter(
        (value) => Number.isInteger(value) && value > 0
      )
    : [];
  if (ids.length === 0) {
    return c.json({ success: false, error: { message: "envelope_ids is required" } }, 400);
  }
  if (ids.length > MAX_BULK_LIFECYCLE_IDS) {
    return c.json(
      {
        success: false,
        error: { message: `At most ${MAX_BULK_LIFECYCLE_IDS} envelopes per request` }
      },
      400
    );
  }

  const now = nowIso();
  const results: { id: number; ok: boolean; status?: string; error?: string }[] = [];

  for (const envelopeId of ids) {
    const envelope = await c.env.DB.prepare(
      "SELECT id, status, envelope_uuid FROM reimbursement_envelope WHERE id = ?"
    )
      .bind(envelopeId)
      .first<{ id: number; status: string; envelope_uuid: string }>();

    if (!envelope) {
      results.push({ id: envelopeId, ok: false, error: "not_found" });
      continue;
    }

    const decision = decideBulkLifecycle(action, envelope.status);
    if (!decision.allowed) {
      results.push({ id: envelopeId, ok: false, error: decision.message });
      continue;
    }

    const updated = await c.env.DB.prepare(
      "UPDATE reimbursement_envelope SET status = ?, updated_at = ? WHERE id = ? AND status = ?"
    )
      .bind(decision.nextStatus, now, envelopeId, envelope.status)
      .run();
    if ((updated.meta.changes ?? 0) !== 1) {
      results.push({ id: envelopeId, ok: false, error: "status_changed_concurrently" });
      continue;
    }

    await writeAuditLog(c.env.DB, {
      actorUserId: auth.sub,
      actorRoles: auth.roles,
      action:
        action === "void"
          ? "reimbursement.envelope.bulk_void"
          : "reimbursement.envelope.bulk_delete",
      targetType: "reimbursement_envelope",
      targetId: envelopeId,
      detail: {
        envelope_uuid: envelope.envelope_uuid,
        previous_status: envelope.status,
        next_status: decision.nextStatus,
        reason: body.reason ?? null
      }
    });
    results.push({ id: envelopeId, ok: true, status: decision.nextStatus });
  }

  const succeeded = results.filter((row) => row.ok).length;
  await publishEvent(
    c.env,
    action === "void"
      ? "REIMBURSEMENT_ENVELOPE_BULK_VOIDED"
      : "REIMBURSEMENT_ENVELOPE_BULK_DELETED",
    "reimbursement_envelope",
    {
      requested: ids.length,
      succeeded,
      failed: ids.length - succeeded,
      operator: auth.sub,
      reason: body.reason ?? null
    }
  );

  return c.json({
    success: true,
    data: { results, succeeded, failed: ids.length - succeeded }
  });
};

reimbursementRoutes.post("/void-batch", requireRoles(["super_admin"]), (c) =>
  handleBulkLifecycle(c, "void")
);

reimbursementRoutes.post("/delete-batch", requireRoles(["super_admin"]), (c) =>
  handleBulkLifecycle(c, "delete")
);
```

如 `Parameters<...>` 上下文类型写法与 Hono 版本不匹配导致类型报错，退化为在两个路由内各自内联同一逻辑（保持行为一致），或将 `c` 参数类型改为 `Context<{ Bindings: Env; Variables: AuthVariables }>`（文件内已有该 import 风格）。

- [ ] **Step 2: 验证并提交**

Run: `cd packages/api && npm run typecheck && npx vitest run`
Expected: PASS

```bash
git add packages/api/src/routes/reimbursement.ts
git commit -m "feat(api): 报销批量废止与软删除端点（仅超管，逐条审计）"
```

---

## Task 10: workbench-summary 超管计数

**Files:**
- Modify: `packages/api/src/routes/reimbursement.ts`（workbench-summary，约 1264-1302 行）

- [ ] **Step 1: 扩展端点**

在 batchRow 查询之后、`return c.json` 之前加（`auth` 需在 handler 开头取：`const auth = c.get("auth");`）：

```ts
    let adminCounts: {
      admin_draft: number;
      admin_returned: number;
      admin_cancelled: number;
    } | null = null;
    if (auth.roles.includes("super_admin")) {
      const adminRow = await c.env.DB.prepare(
        `SELECT
           SUM(CASE WHEN status IN ('draft', 'unregistered') AND applicant_userid != ? THEN 1 ELSE 0 END) AS admin_draft,
           SUM(CASE WHEN status = 'submitted' AND precheck_status IN ('rejected', 'supplement') THEN 1 ELSE 0 END) AS admin_returned,
           SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS admin_cancelled
         FROM reimbursement_envelope
         WHERE status != 'deleted'`
      )
        .bind(UNASSIGNED_APPLICANT)
        .first<{
          admin_draft: number | null;
          admin_returned: number | null;
          admin_cancelled: number | null;
        }>();
      adminCounts = {
        admin_draft: adminRow?.admin_draft ?? 0,
        admin_returned: adminRow?.admin_returned ?? 0,
        admin_cancelled: adminRow?.admin_cancelled ?? 0
      };
    }
```

响应 data 里追加（保持旧字段不变）：

```ts
        ...(adminCounts ?? {})
```

- [ ] **Step 2: 验证并提交**

Run: `cd packages/api && npm run typecheck && npx vitest run`
Expected: PASS

```bash
git add packages/api/src/routes/reimbursement.ts
git commit -m "feat(api): 工作台摘要新增超管草稿/退回/废止计数"
```

---

## Task 11: Web API 封装扩展

**Files:**
- Modify: `packages/web/src/api/reimbursement.ts`

- [ ] **Step 1: 类型与函数**

`ReimbursementEnvelope` type 加字段：

```ts
  split_from_envelope_id?: number | null;
  split_reason?: string | null;
```

`listReimbursementEnvelopes` params 加 `exclude_unassigned?: boolean;`。

`ReimbursementWorkbenchSummary` 加：

```ts
  admin_draft?: number;
  admin_returned?: number;
  admin_cancelled?: number;
```

`precheckEnvelope` 的 data 参数类型改为：

```ts
  data: {
    action: "approved" | "supplement" | "rejected";
    comment?: string;
    override_einvoice_reason?: string;
  }
```

文件末尾追加：

```ts
export type SplitEnvelopeResult = {
  new_envelope: { id: number; envelope_no: string; envelope_uuid: string };
  original: { id: number; amount: number };
  amount_delta: number;
};

export const splitReimbursementEnvelope = (
  id: number,
  data: {
    new_envelope: {
      project_id: number;
      amount: number;
      category?: string;
      description?: string;
      expense_date?: string;
    };
    attachment_ids?: number[];
    original_amount: number;
    reason?: string;
  },
  options?: { idempotencyKey?: string }
) => {
  return http.request<{ success: boolean; data: SplitEnvelopeResult }>(
    "post",
    `/api/v1/reimbursement/${id}/split`,
    {
      data,
      headers: options?.idempotencyKey
        ? { "Idempotency-Key": options.idempotencyKey }
        : undefined
    }
  );
};

export type ReimbursementBatchProposal = {
  project_id: number;
  applicant_userid: string;
  item_count: number;
  total_amount: number;
  envelopes: {
    id: number;
    envelope_no: string;
    amount: number;
    description: string | null;
    channel: string;
    duplicate_risk_level: "high" | "medium" | "low" | null;
  }[];
  matched_payee: {
    id: number;
    name: string;
    bank_name: string;
    bank_account: string;
  } | null;
  payee_required: boolean;
  suggested_payment_method: string;
};

export const listReimbursementBatchProposals = () => {
  return http.request<{ success: boolean; data: ReimbursementBatchProposal[] }>(
    "get",
    "/api/v1/reimbursement/batch/proposals"
  );
};

export type BulkLifecycleResult = {
  results: { id: number; ok: boolean; status?: string; error?: string }[];
  succeeded: number;
  failed: number;
};

export const bulkVoidReimbursementEnvelopes = (data: {
  envelope_ids: number[];
  reason?: string;
}) => {
  return http.request<{ success: boolean; data: BulkLifecycleResult }>(
    "post",
    "/api/v1/reimbursement/void-batch",
    { data }
  );
};

export const bulkDeleteReimbursementEnvelopes = (data: {
  envelope_ids: number[];
  reason?: string;
}) => {
  return http.request<{ success: boolean; data: BulkLifecycleResult }>(
    "post",
    "/api/v1/reimbursement/delete-batch",
    { data }
  );
};
```

- [ ] **Step 2: 验证并提交**

Run: `cd packages/web && npm run typecheck`
Expected: PASS

```bash
git add packages/web/src/api/reimbursement.ts
git commit -m "feat(web): 报销拆单/批次建议/批量废止删除 API 封装"
```

---

## Task 12: 标签汉化统一 + 电子发票行标签

**Files:**
- Modify: `packages/web/src/views/finance/reimbursement/reimbursement-labels.ts`
- Create: `packages/web/src/views/finance/reimbursement/reimbursement-einvoice.ts`
- Modify: `office-workbench.vue`、`precheck.vue`（toast 修复）、`batch.vue`、`batch-detail.vue`、`list.vue`（改用模块标签，逐文件替换 import）

**决策说明**：`utils/enum-labels.ts` 的 `precheckStatusLabel`/`statusLabel` 被其他业务域共用（措辞如 pending=待检查），为避免跨域影响，报销域的规范标签集中在模块内 `reimbursement-labels.ts`，报销页面统一改从此处 import（spec 措辞"统一到共享映射"的落地方式，见 Task 18 spec 修订记录）。

- [ ] **Step 1: 前端电子发票检测镜像（新文件 `reimbursement-einvoice.ts`）**

```ts
const E_INVOICE_NUMBER_PATTERN = /^\d{20}$/;

const isElectronicInvoiceNumber = (value: unknown): boolean =>
  typeof value === "string" && E_INVOICE_NUMBER_PATTERN.test(value.trim());

/** 与 API 端 reimbursement-einvoice-guard 保持一致的检测逻辑（前端展示用） */
export const detectEInvoiceInPhysical = (input: {
  channel?: string | null;
  ocrResultJson?: string | null;
  invoiceUniqueNoHint?: string | null;
}): boolean => {
  if (input.channel !== "physical") return false;
  if (isElectronicInvoiceNumber(input.invoiceUniqueNoHint)) return true;
  if (!input.ocrResultJson) return false;
  try {
    const parsed = JSON.parse(input.ocrResultJson) as {
      extracted_invoices?: { invoice_unique_no?: unknown; invoice_no?: unknown }[];
    };
    return (parsed.extracted_invoices ?? []).some(
      item =>
        isElectronicInvoiceNumber(item.invoice_unique_no) ||
        isElectronicInvoiceNumber(item.invoice_no)
    );
  } catch {
    return false;
  }
};
```

- [ ] **Step 2: reimbursement-labels.ts 加规范映射与动作标签**

在文件中追加（保留现有导出）：

```ts
import { detectEInvoiceInPhysical } from "./reimbursement-einvoice";

export const reimbursementStatusLabel = (v?: string | null): string => {
  const m: Record<string, string> = {
    unregistered: "未登记",
    draft: "草稿",
    submitted: "已提交",
    received: "已收件",
    batched: "已成批",
    pending_approval: "待审批",
    approved: "已审批",
    paid: "已打款",
    rejected: "已驳回",
    cancelled: "已废止",
    deleted: "已删除"
  };
  if (!v) return "草稿";
  return m[v] ?? v;
};

export const reimbursementPrecheckStatusLabel = (v?: string | null): string => {
  const m: Record<string, string> = {
    none: "未复核",
    pending: "待复核",
    approved: "复核通过",
    supplement: "待补充",
    rejected: "复核驳回"
  };
  if (!v) return "未复核";
  return m[v] ?? v;
};

export const reimbursementVerificationStatusLabel = (v?: string | null): string => {
  const m: Record<string, string> = {
    pending: "待核对",
    verified: "核对通过",
    mismatch: "核对异常"
  };
  if (!v) return "待核对";
  return m[v] ?? v;
};

export const reimbursementTaskStatusLabel = (v?: string | null): string => {
  const m: Record<string, string> = {
    none: "未触发",
    pending: "排队中",
    assigned: "已分派",
    running: "处理中",
    queued: "排队中",
    completed: "已完成",
    failed: "失败"
  };
  if (!v) return "未触发";
  return m[v] ?? v;
};

export const precheckActionLabel = (
  action: "approved" | "supplement" | "rejected"
): string => {
  const m = {
    approved: "复核通过",
    supplement: "要求补充材料",
    rejected: "复核驳回"
  } as const;
  return m[action];
};
```

并在 `rowAnomalyTags` 中（`verification_status === "mismatch"` 判断之前）加：

```ts
  if (
    detectEInvoiceInPhysical({
      channel: row.channel,
      ocrResultJson: row.ocr_result_json ?? null,
      invoiceUniqueNoHint: row.ocr_invoice_unique_no_hint ?? null
    })
  ) {
    tags.push({ label: "电子发票混入", type: "danger" });
  }
```

- [ ] **Step 3: 修复三处 toast 英文原值**

- `office-workbench.vue:294`：`message(\`复核已处理：${action}\`` → `message(\`复核已处理：${precheckActionLabel(action)}\``（import 自 `./reimbursement-labels`）。
- `precheck.vue:72`：`message(\`复核完成：${action}\`` → 同上方式。
- `detail.vue:968` 在 Task 15 重构中一并处理（该文件本任务不动，避免冲突）。

- [ ] **Step 4: 报销页面切换到模块标签**

`office-workbench.vue`、`batch.vue`、`batch-detail.vue`、`list.vue` 中，将 `import { channelLabel, precheckStatusLabel, statusLabel, aiAuditStatusLabel } from "@/utils/enum-labels"` 里的 `precheckStatusLabel`/`statusLabel` 用法替换为 `reimbursementPrecheckStatusLabel`/`reimbursementStatusLabel`（从 `./reimbursement-labels` import；`channelLabel`、`aiAuditStatusLabel` 维持原 import）。逐文件全局替换模板中的调用名。

- [ ] **Step 5: 验证并提交**

Run: `cd packages/web && npm run typecheck`
Expected: PASS

```bash
git add packages/web/src/views/finance/reimbursement/
git commit -m "fix(web): 报销状态标签模块级统一汉化，修复复核 toast 英文原值，新增电子发票混入标签"
```

---

## Task 13: 单信封打印工具

**Files:**
- Create: `packages/web/src/views/finance/reimbursement/envelope-print.ts`

- [ ] **Step 1: 实现（从 envelope-generator.vue 的画布/打印逻辑收敛为单信封版本）**

```ts
import QRCode from "qrcode";
import { jsPDF } from "jspdf";

const PAGE_W_MM = 230;
const PAGE_H_MM = 120;

const mmToPx = (mm: number) => (mm * 96) / 25.4;

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image_load_failed"));
    img.src = src;
  });

const renderSingleEnvelopeCanvas = async (
  uuid: string,
  title: string
): Promise<HTMLCanvasElement> => {
  const scale = 2;
  const widthPx = Math.max(1, Math.round(mmToPx(PAGE_W_MM)));
  const heightPx = Math.max(1, Math.round(mmToPx(PAGE_H_MM)));

  const canvas = document.createElement("canvas");
  canvas.width = widthPx * scale;
  canvas.height = heightPx * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas_context_failed");

  ctx.scale(scale, scale);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, widthPx, heightPx);

  const margin = mmToPx(8);
  const now = new Date();
  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate()
  ).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(
    now.getMinutes()
  ).padStart(2, "0")}`;

  ctx.fillStyle = "#685f54";
  ctx.font = `${Math.round(mmToPx(3.3))}px sans-serif`;
  ctx.fillText(`生成时间：${stamp}`, margin, margin + mmToPx(2));

  ctx.fillStyle = "#1f1f1f";
  ctx.textAlign = "center";
  ctx.font = `700 ${Math.round(mmToPx(4.4))}px sans-serif`;
  ctx.fillText(title, widthPx / 2, margin + mmToPx(12));

  const qrDataUrl = await QRCode.toDataURL(uuid, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 160
  });
  const qrSize = mmToPx(30);
  const qrX = margin;
  const qrY = margin + mmToPx(16);
  ctx.drawImage(await loadImage(qrDataUrl), qrX, qrY, qrSize, qrSize);

  const textX = qrX + qrSize + mmToPx(8);
  const textY = qrY + mmToPx(1);
  const bodyFont = Math.round(mmToPx(4.1));
  ctx.textAlign = "left";
  ctx.font = `${bodyFont}px sans-serif`;

  const uuidMaxWidth = widthPx - textX - margin;
  const chunks: string[] = [];
  let start = 0;
  while (start < uuid.length) {
    let end = start + 1;
    while (
      end <= uuid.length &&
      ctx.measureText(uuid.slice(start, end)).width <= uuidMaxWidth
    ) {
      end += 1;
    }
    chunks.push(uuid.slice(start, Math.max(start + 1, end - 1)));
    start = Math.max(start + 1, end - 1);
  }
  chunks.forEach((line, index) => {
    ctx.fillText(line, textX, textY + bodyFont + index * Math.round(bodyFont * 1.35));
  });

  const lineStartY = textY + Math.round(bodyFont * 1.35) * Math.max(2, chunks.length + 1);
  ctx.fillText("封装日期：________年____月____日", textX, lineStartY);
  ctx.fillText("签收日期：________年____月____日", textX, lineStartY + Math.round(bodyFont * 1.6));
  ctx.fillText("填 报 人：________________", textX, lineStartY + Math.round(bodyFont * 3.2));

  return canvas;
};

/**
 * 单信封打印：渲染 QR + UUID 到 PDF 并调起浏览器打印。
 * @returns true=已打开打印窗口；false=弹窗被拦截（调用方提示用户允许弹窗）
 */
export const printSingleEnvelope = async (
  uuid: string,
  options?: { title?: string }
): Promise<boolean> => {
  const title = options?.title?.trim() || "恒越百川报销信封（拆单新签）";
  const canvas = await renderSingleEnvelopeCanvas(uuid, title);
  const pdf = new jsPDF({
    orientation: "landscape",
    unit: "mm",
    format: [PAGE_W_MM, PAGE_H_MM]
  });
  pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, PAGE_W_MM, PAGE_H_MM, undefined, "FAST");

  const blobUrl = URL.createObjectURL(pdf.output("blob"));
  const win = window.open(blobUrl, "_blank");
  if (!win) {
    URL.revokeObjectURL(blobUrl);
    return false;
  }
  const tryPrint = () => {
    try {
      win.focus();
      win.print();
    } finally {
      setTimeout(() => URL.revokeObjectURL(blobUrl), 3000);
    }
  };
  win.addEventListener("load", tryPrint, { once: true });
  setTimeout(tryPrint, 1200);
  return true;
};
```

（envelope-generator.vue 的多信封逻辑暂不回收到此工具，YAGNI。）

- [ ] **Step 2: 验证并提交**

Run: `cd packages/web && npm run typecheck`
Expected: PASS

```bash
git add packages/web/src/views/finance/reimbursement/envelope-print.ts
git commit -m "feat(web): 单信封二维码打印工具（拆单新信封用）"
```

---

## Task 14: 拆单弹窗组件

**Files:**
- Create: `packages/web/src/views/finance/reimbursement/components/SplitEnvelopeDialog.vue`

- [ ] **Step 1: 完整组件**

```vue
<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { message } from "@/utils/message";
import { useProjectOptions } from "@/composables/useProjectOptions";
import {
  splitReimbursementEnvelope,
  type ReimbursementEnvelopeDetail,
  type SplitEnvelopeResult
} from "@/api/reimbursement";
import { printSingleEnvelope } from "../envelope-print";

defineOptions({ name: "SplitEnvelopeDialog" });

const props = defineProps<{
  visible: boolean;
  detail: ReimbursementEnvelopeDetail;
}>();

const emit = defineEmits<{
  (event: "update:visible", value: boolean): void;
  (event: "done"): void;
  (event: "open-envelope", id: number): void;
}>();

const { projects, loadProjects } = useProjectOptions();

const submitting = ref(false);
const result = ref<SplitEnvelopeResult | null>(null);
const selectedAttachmentIds = ref<number[]>([]);
const form = ref({
  project_id: undefined as number | undefined,
  amount: 0,
  category: "",
  description: "",
  expense_date: "",
  original_amount: 0,
  reason: ""
});

const activeAttachments = computed(() =>
  (props.detail.attachments || []).filter(item => item.status === "active")
);

const amountSum = computed(
  () => Number(form.value.amount || 0) + Number(form.value.original_amount || 0)
);
const amountMismatch = computed(
  () => Math.abs(amountSum.value - Number(props.detail.amount || 0)) > 0.005
);

const resetForm = () => {
  result.value = null;
  selectedAttachmentIds.value = [];
  form.value = {
    project_id: undefined,
    amount: 0,
    category: props.detail.category || "",
    description: "",
    expense_date: props.detail.expense_date || "",
    original_amount: Number(props.detail.amount || 0),
    reason: ""
  };
};

watch(
  () => props.visible,
  async value => {
    if (value) {
      resetForm();
      await loadProjects();
    }
  }
);

watch(
  () => form.value.amount,
  value => {
    const rest = Number(props.detail.amount || 0) - Number(value || 0);
    form.value.original_amount = Number(rest > 0 ? rest.toFixed(2) : 0);
  }
);

const onSelectionChange = (rows: { id: number }[]) => {
  selectedAttachmentIds.value = rows.map(row => row.id);
};

const close = () => emit("update:visible", false);

const submit = async () => {
  if (!form.value.project_id) {
    message("请选择拆出新单的所属项目", { type: "warning" });
    return;
  }
  if (!(Number(form.value.amount) > 0) || !(Number(form.value.original_amount) > 0)) {
    message("新单金额与原单调整后金额都必须大于 0", { type: "warning" });
    return;
  }
  submitting.value = true;
  try {
    const res = await splitReimbursementEnvelope(
      props.detail.id,
      {
        new_envelope: {
          project_id: form.value.project_id,
          amount: Number(form.value.amount),
          category: form.value.category || undefined,
          description: form.value.description || undefined,
          expense_date: form.value.expense_date || undefined
        },
        attachment_ids: selectedAttachmentIds.value,
        original_amount: Number(form.value.original_amount),
        reason: form.value.reason || undefined
      },
      { idempotencyKey: `reimbursement-split-${crypto.randomUUID()}` }
    );
    result.value = res.data;
    message("拆单成功，两张单据已自动触发智能核查", { type: "success" });
    emit("done");
  } catch (error) {
    const err = error as { response?: { data?: { error?: { message?: string } } } };
    message(err.response?.data?.error?.message || "拆单失败，请稍后重试", {
      type: "error"
    });
  } finally {
    submitting.value = false;
  }
};

const printNewEnvelope = async () => {
  if (!result.value) return;
  const opened = await printSingleEnvelope(result.value.new_envelope.envelope_uuid);
  if (!opened) {
    message("浏览器拦截了打印窗口，请允许弹窗后重试", { type: "warning" });
  }
};

const openNewEnvelope = () => {
  if (!result.value) return;
  emit("open-envelope", result.value.new_envelope.id);
  close();
};
</script>

<template>
  <el-dialog
    :model-value="props.visible"
    :title="result ? '拆单完成' : `拆单 - ${props.detail.envelope_no}`"
    width="720px"
    append-to-body
    :close-on-click-modal="false"
    @update:model-value="value => emit('update:visible', value)"
  >
    <template v-if="!result">
      <el-alert
        type="info"
        :closable="false"
        title="拆单用于纠正混报：勾选要拆走的附件，为其指定正确的项目与金额；拆单后两张单据都会重新进入复核并自动触发智能核查。"
        class="mb-3"
      />

      <div class="split-section-title">1. 选择要转移到新单的附件（可不选）</div>
      <el-table
        :data="activeAttachments"
        size="small"
        max-height="220"
        @selection-change="onSelectionChange"
      >
        <el-table-column type="selection" width="48" />
        <el-table-column prop="file_name" label="文件名" min-width="220" show-overflow-tooltip />
        <el-table-column prop="attachment_type" label="类型" width="100" />
      </el-table>

      <div class="split-section-title">2. 新单信息</div>
      <el-form label-width="120px">
        <el-form-item label="所属项目" required>
          <el-select
            v-model="form.project_id"
            filterable
            placeholder="选择正确的项目"
            style="width: 320px"
          >
            <el-option
              v-for="item in projects"
              :key="item.id"
              :label="item.project_name"
              :value="item.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="新单金额" required>
          <el-input-number v-model="form.amount" :min="0" :precision="2" :step="100" />
        </el-form-item>
        <el-form-item label="费用类别">
          <el-input v-model="form.category" style="width: 320px" />
        </el-form-item>
        <el-form-item label="费用日期">
          <el-date-picker
            v-model="form.expense_date"
            type="date"
            value-format="YYYY-MM-DD"
            style="width: 220px"
          />
        </el-form-item>
        <el-form-item label="新单说明">
          <el-input v-model="form.description" type="textarea" :rows="2" />
        </el-form-item>
        <el-form-item label="原单调整后金额" required>
          <el-input-number
            v-model="form.original_amount"
            :min="0"
            :precision="2"
            :step="100"
          />
        </el-form-item>
        <el-form-item label="拆单原因">
          <el-input v-model="form.reason" placeholder="例如：员工混报两个项目" />
        </el-form-item>
      </el-form>

      <el-alert
        v-if="amountMismatch"
        type="warning"
        :closable="false"
        :title="`提示：新单 + 原单 = ¥${amountSum.toFixed(2)}，与原申报金额 ¥${Number(
          props.detail.amount || 0
        ).toFixed(2)} 不一致（允许提交，请确认无误）`"
      />
    </template>

    <template v-else>
      <el-result icon="success" title="拆单成功">
        <template #sub-title>
          <div>新单编号：{{ result.new_envelope.envelope_no }}</div>
          <div>请打印新信封并将对应票据移入</div>
        </template>
      </el-result>
    </template>

    <template #footer>
      <template v-if="!result">
        <el-button @click="close">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="submit">确认拆单</el-button>
      </template>
      <template v-else>
        <el-button @click="close">关闭</el-button>
        <el-button type="success" @click="printNewEnvelope">打印新信封</el-button>
        <el-button type="primary" @click="openNewEnvelope">打开新单详情</el-button>
      </template>
    </template>
  </el-dialog>
</template>

<style scoped>
.split-section-title {
  margin: 12px 0 8px;
  font-weight: 600;
  color: #1f2937;
}
.mb-3 {
  margin-bottom: 12px;
}
</style>
```

- [ ] **Step 2: 验证并提交**

Run: `cd packages/web && npm run typecheck`
Expected: PASS

```bash
git add packages/web/src/views/finance/reimbursement/components/SplitEnvelopeDialog.vue
git commit -m "feat(web): 报销拆单弹窗组件（附件转移+新信封打印）"
```

---

## Task 15: detail.vue 重构

**Files:**
- Modify: `packages/web/src/views/finance/reimbursement/detail.vue`

按子步骤依次改，每步后跑 `cd packages/web && npm run typecheck`。

- [ ] **Step 1: script 增量**

imports 增加：

```ts
import SplitEnvelopeDialog from "./components/SplitEnvelopeDialog.vue";
import { detectEInvoiceInPhysical } from "./reimbursement-einvoice";
import { precheckActionLabel } from "./reimbursement-labels";
```

本地标签映射（statusLabelMap 等 4 个 map 与 4 个 to*Label 函数，76-128 行）**替换**为从 `./reimbursement-labels` import：

```ts
import {
  precheckActionLabel,
  reimbursementPrecheckStatusLabel as toPrecheckStatusLabel,
  reimbursementStatusLabel as toStatusLabel,
  reimbursementTaskStatusLabel as toTaskStatusLabel,
  reimbursementVerificationStatusLabel as toVerificationStatusLabel
} from "./reimbursement-labels";
```

（别名保持原函数名，模板零改动。）

新增状态与 computed（放在 `voiding` 定义附近）：

```ts
const verifyingAction = ref<null | "verified" | "mismatch">(null);
const precheckAction = ref<null | "approved" | "supplement" | "rejected">(null);
const splitDialogVisible = ref(false);

const officeActionBusy = computed(
  () =>
    verifyingAction.value !== null ||
    precheckAction.value !== null ||
    rerunningSilentReview.value ||
    voiding.value
);

const isFinanceOrSuperAdmin = computed(
  () => roleSet.value.has("super_admin") || roleSet.value.has("finance")
);

const canSplit = computed(
  () =>
    !isCreate.value &&
    !!detail.value &&
    isFinanceOrSuperAdmin.value &&
    !isWorkspaceView.value &&
    ["submitted", "received"].includes(detail.value.status) &&
    !detail.value.batch_id &&
    !detail.value.approval_instance_id
);

const einvoiceDetected = computed(() =>
  detectEInvoiceInPhysical({
    channel: detail.value?.channel,
    ocrResultJson: detail.value?.ocr_result_json ?? null,
    invoiceUniqueNoHint: detail.value?.ocr_invoice_unique_no_hint ?? null
  })
);

const highestRiskLevel = computed<"high" | "medium" | "low" | "none">(() => {
  if (einvoiceDetected.value) return "high";
  const levels = (detail.value?.duplicate_checks ?? []).map(item => item.risk_level);
  if (levels.includes("high")) return "high";
  if (levels.includes("medium")) return "medium";
  if (levels.includes("low")) return "low";
  return "none";
});

const stageHint = computed(() => {
  if (isCreate.value) return "当前：新建草稿 → 下一步：保存后提交";
  const s = detail.value?.status;
  const p = detail.value?.precheck_status;
  if (s === "draft" || s === "unregistered")
    return "当前：草稿/未登记 → 下一步：完善信息并提交报销";
  if (s === "submitted") {
    if (p === "rejected") return "当前：复核驳回已退回 → 下一步：修改后重新提交，或由办公室拆单/废止";
    if (p === "supplement") return "当前：待补充材料 → 下一步：补充后重新提交";
    return "当前：待签收 → 下一步：办公室核查签收或标记核查异常";
  }
  if (s === "received") return "当前：已签收待复核 → 下一步：复核通过 / 要求补充 / 复核驳回";
  if (s === "batched") return "当前：已进入批次 → 后续在批次详情中送审";
  if (s === "pending_approval") return "当前：批次审批中";
  if (s === "approved") return "当前：审批通过，等待付款";
  if (s === "paid") return "当前：已打款，流程结束";
  if (s === "rejected") return "当前：已驳回";
  if (s === "cancelled") return "当前：已废止，不再流转";
  return "";
});
```

- [ ] **Step 2: verify / submitPrecheck 加 per-action loading 与电子发票拦截处理**

`verify` 函数替换为：

```ts
const verify = async (result: "verified" | "mismatch") => {
  if (!detail.value || verifyingAction.value) return;
  verifyingAction.value = result;
  try {
    await verifyReimbursementEnvelope({
      envelope_id: detail.value.id,
      result,
      note: verifyNote.value || undefined
    });
    message(result === "verified" ? "收件核对通过" : "已标记核对异常", {
      type: result === "verified" ? "success" : "warning"
    });
    await loadDetail();
    notifyChanged();
  } finally {
    verifyingAction.value = null;
  }
};
```

`submitPrecheck` 替换为（保留 wait_for_audit 分支，新增 einvoice 分支与 loading）：

```ts
const submitPrecheck = async (
  action: "approved" | "supplement" | "rejected",
  overrideEInvoiceReason?: string
) => {
  if (!detail.value || precheckAction.value) return;
  precheckAction.value = action;
  try {
    await precheckEnvelope(detail.value.id, {
      action,
      comment: verifyNote.value || undefined,
      override_einvoice_reason: overrideEInvoiceReason
    });
    message(`复核已更新：${precheckActionLabel(action)}`, {
      type: action === "approved" ? "success" : "warning"
    });
    await loadDetail();
    notifyChanged();
  } catch (error) {
    const err = error as {
      response?: {
        status?: number;
        data?: {
          data?: { wait_for_audit?: boolean; einvoice_in_physical?: boolean };
        };
      };
    };
    const waitForAudit =
      err.response?.status === 409 &&
      err.response?.data?.data?.wait_for_audit === true;
    const einvoiceBlocked =
      err.response?.status === 400 &&
      err.response?.data?.data?.einvoice_in_physical === true;

    if (einvoiceBlocked) {
      await handleEInvoiceBlocked();
      return;
    }
    if (!waitForAudit) throw error;
    message("后台静默审查尚未完成，系统已自动触发处理，请稍后再执行复核通过", {
      type: "warning"
    });
    await loadDetail();
    notifyChanged();
    ensureAuditPolling("审计任务处理中，系统将自动刷新状态");
  } finally {
    precheckAction.value = null;
  }
};

const handleEInvoiceBlocked = async () => {
  if (!isFinanceOrSuperAdmin.value) {
    message("检测到电子发票混入实物信封，复核通过被拦截。请复核驳回并引导员工走电子发票通道。", {
      type: "error"
    });
    return;
  }
  try {
    const { value } = await ElMessageBox.prompt(
      "检测到电子发票混入实物信封。常规处置为复核驳回并让员工改走电子发票通道；如确认是识别误判，可填写理由强制通过（将记录审计日志）。",
      "电子发票混入拦截",
      {
        confirmButtonText: "强制通过",
        cancelButtonText: "取消",
        inputPlaceholder: "强制通过理由（必填）",
        inputValidator: (input: string) =>
          input.trim() ? true : "理由不能为空",
        type: "warning"
      }
    );
    await submitPrecheck("approved", value.trim());
  } catch {
    // 用户取消
  }
};
```

`submitPrecheck` 引用了后声明的 `handleEInvoiceBlocked`（函数声明顺序：把 `handleEInvoiceBlocked` 放在 `submitPrecheck` 之前定义即可）。

- [ ] **Step 3: 修复 el-card 加载 bug**

1029 行 `<el-card shadow="never" :loading="loading" ...>` 改为：

```vue
  <el-card
    v-loading="loading"
    element-loading-text="正在加载报销详情…"
    shadow="never"
    class="reimbursement-detail-page"
    style="background: #fffaf2"
  >
```

- [ ] **Step 4: 智能核查卡置顶（不可折叠）+ 员工端电子发票提示**

在 `detail-summary-grid` 结束标签之后、`<el-row :gutter="16">` 之前插入：

```vue
    <el-card
      v-if="detail && canSeeOfficeReview"
      shadow="never"
      class="review-card mt-3"
      :class="`review-card--${highestRiskLevel}`"
    >
      <template #header>智能核查与风险提示</template>
      <el-alert
        v-if="einvoiceDetected"
        type="error"
        :closable="false"
        title="检测到电子发票混入实物信封：复核通过将被拦截。请复核驳回并引导员工改用电子发票通道提交。"
        style="margin-bottom: 12px"
      />
      <el-descriptions :column="1" border>
        <el-descriptions-item
          v-for="item in recognitionHintRows"
          :key="item.label"
          :label="item.label"
        >
          {{ item.value }}
        </el-descriptions-item>
        <el-descriptions-item label="智能核查摘要">
          <pre class="review-pre">{{ reviewSummaryText }}</pre>
        </el-descriptions-item>
        <el-descriptions-item label="识别结果（可读版）">
          <pre class="review-pre">{{ recognitionRawText }}</pre>
        </el-descriptions-item>
      </el-descriptions>

      <el-table
        v-if="detail.duplicate_checks.length > 0"
        :data="detail.duplicate_checks"
        style="margin-top: 12px"
        size="small"
      >
        <el-table-column prop="match_type" label="匹配类型" width="120" />
        <el-table-column prop="risk_level" label="风险等级" width="120">
          <template #default="scope">
            <el-tag :type="toRiskLevelTagType(scope.row.risk_level)" size="small">
              {{ toRiskLevelLabel(scope.row.risk_level) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="matched_invoice_no" label="匹配发票号" width="200" />
        <el-table-column prop="summary" label="说明" min-width="240" />
      </el-table>
    </el-card>

    <el-alert
      v-else-if="detail && einvoiceDetected"
      type="warning"
      :closable="false"
      title="检测到您上传的是电子发票（数电票）：实物信封通道不接受电子发票，请改用电子发票通道重新提交。"
      class="mt-3"
    />
```

并**删除**原底部整个 `<el-collapse ...>…</el-collapse>` 块（1464-1511 行）。

style 里加：

```css
.review-card {
  border-left: 4px solid #e5e7eb;
}
.review-card--high {
  border-left-color: #ef4444;
}
.review-card--medium {
  border-left-color: #f59e0b;
}
.review-card--low {
  border-left-color: #10b981;
}
```

- [ ] **Step 5: 操作区分组重构**

原 `<el-card shadow="never" header="操作区" class="mt-3">…</el-card>`（1318-1435 行）整体替换为：

```vue
    <el-card shadow="never" class="mt-3">
      <template #header>
        <div class="action-header">
          <span>操作区</span>
          <span v-if="stageHint" class="stage-hint">{{ stageHint }}</span>
        </div>
      </template>

      <!-- 员工操作 -->
      <div
        v-if="isCreate || (detail && submittableStatuses.has(detail.status)) || canEdit"
        class="action-group"
      >
        <div class="action-group__title">
          员工操作
          <span class="action-group__desc">保存修改、登记信封并提交报销</span>
        </div>
        <el-space wrap>
          <el-button type="primary" :loading="saving" :disabled="!canEdit" @click="save"
            >保存</el-button
          >
          <template v-if="!isCreate && detail">
            <el-button
              v-if="
                detail.channel === 'physical' && submittableStatuses.has(detail.status)
              "
              @click="scanSubmit"
              >扫码登记并绑定填报人</el-button
            >
            <el-button
              v-if="submittableStatuses.has(detail.status)"
              type="primary"
              :loading="submitting"
              :disabled="submitting"
              @click="submitEnvelope"
            >
              {{
                detail.channel === "physical"
                  ? "提交报销并寄送实物信封"
                  : "提交电子发票报销"
              }}
            </el-button>
          </template>
        </el-space>
      </div>

      <!-- 办公室签收与复核 -->
      <div
        v-if="
          !isCreate &&
          detail &&
          canSeeOfficeReview &&
          ['submitted', 'received'].includes(detail.status)
        "
        class="action-group"
      >
        <div class="action-group__title">
          办公室签收与复核
          <span class="action-group__desc"
            >先核对实物/票据并签收；签收后进行复核或拆单</span
          >
        </div>
        <el-space wrap>
          <el-input
            v-model="verifyNote"
            style="width: 240px"
            placeholder="办公室核查备注（可选）"
          />
          <el-button
            type="success"
            :loading="verifyingAction === 'verified'"
            :disabled="officeActionBusy"
            @click="verify('verified')"
            >核查签收</el-button
          >
          <el-button
            type="warning"
            :loading="verifyingAction === 'mismatch'"
            :disabled="officeActionBusy"
            @click="verify('mismatch')"
            >核查异常</el-button
          >
          <template v-if="detail.status === 'received'">
            <el-button
              type="success"
              :loading="precheckAction === 'approved'"
              :disabled="officeActionBusy"
              @click="submitPrecheck('approved')"
              >复核通过</el-button
            >
            <el-button
              type="warning"
              :loading="precheckAction === 'supplement'"
              :disabled="officeActionBusy"
              @click="submitPrecheck('supplement')"
              >补充材料</el-button
            >
            <el-button
              type="danger"
              :loading="precheckAction === 'rejected'"
              :disabled="officeActionBusy"
              @click="submitPrecheck('rejected')"
              >复核驳回</el-button
            >
          </template>
          <el-button v-if="canSplit" type="warning" plain @click="splitDialogVisible = true"
            >拆单</el-button
          >
          <el-button
            type="info"
            :loading="rerunningSilentReview"
            :disabled="officeActionBusy"
            @click="rerunSilentReview"
            >二次静默审查</el-button
          >
          <el-button v-if="detail.channel === 'electronic'" @click="refreshOcrStatus"
            >刷新识别状态</el-button
          >
        </el-space>
      </div>

      <!-- 管理操作 -->
      <div
        v-if="
          !isCreate &&
          detail &&
          isSuperAdmin &&
          ['draft', 'submitted', 'received', 'unregistered'].includes(detail.status)
        "
        class="action-group action-group--danger"
      >
        <div class="action-group__title">
          管理操作
          <span class="action-group__desc">危险操作：废止后单据不再参与流转</span>
        </div>
        <el-space wrap>
          <el-button type="danger" plain :loading="voiding" @click="voidEnvelope">
            废止报销提交
          </el-button>
        </el-space>
      </div>

      <el-alert
        v-if="hasDuplicateRisks"
        type="warning"
        :closable="false"
        style="margin-top: 10px"
        title="检测到疑似重复报销。若申请人坚持提交，系统会记录坚持提交标记并要求办公室复核。"
      />
    </el-card>

    <SplitEnvelopeDialog
      v-if="detail"
      v-model:visible="splitDialogVisible"
      :detail="detail"
      @done="
        async () => {
          await loadDetail();
          notifyChanged();
        }
      "
      @open-envelope="
        (id: number) => {
          if (props.drawerMode) {
            emit('close');
          }
          router.push(
            isWorkspaceView
              ? `/workspace/my-reimbursement/detail/${id}`
              : `/finance/reimbursement/detail/${id}`
          );
        }
      "
    />
```

style 里加：

```css
.action-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.stage-hint {
  font-size: 13px;
  font-weight: 600;
  color: #2563eb;
}
.action-group {
  padding: 10px 12px;
  margin-bottom: 10px;
  background: #fafafa;
  border: 1px solid #f0f0f0;
  border-radius: 8px;
}
.action-group--danger {
  background: #fef2f2;
  border-color: #fecaca;
}
.action-group__title {
  margin-bottom: 8px;
  font-weight: 600;
  color: #1f2937;
}
.action-group__desc {
  margin-left: 8px;
  font-size: 12px;
  font-weight: 400;
  color: #9ca3af;
}
```

注意：原操作区中"二次静默审查/刷新识别状态"的旧按钮位置删除（已迁入分组），确保不重复渲染。

- [ ] **Step 6: 底部状态表汉化**

1456-1461 行（发票识别状态/智能核查状态两个 descriptions-item）改为：

```vue
      <el-descriptions-item v-if="canSeeOfficeReview" label="发票识别状态">{{
        toTaskStatusLabel(ocrStatusText)
      }}</el-descriptions-item>
      <el-descriptions-item v-if="canSeeOfficeReview" label="智能核查状态">{{
        toTaskStatusLabel(anomalyStatusText)
      }}</el-descriptions-item>
```

- [ ] **Step 7: 附件图片预览缩放**

script 增加：

```ts
const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".gif"];
const previewIsImage = computed(() => {
  const lower = previewFileName.value.toLowerCase();
  return IMAGE_EXTENSIONS.some(ext => lower.endsWith(ext));
});
```

预览抽屉模板（1513-1535 行）改为：

```vue
    <el-drawer v-model="previewDrawerVisible" title="附件预览" size="70%">
      <div style="height: calc(100vh - 120px)">
        <div style="margin-bottom: 8px; color: #666">{{ previewFileName }}</div>
        <template v-if="previewIsImage">
          <el-image
            :src="previewFileUrl"
            :preview-src-list="[previewFileUrl]"
            :initial-index="0"
            preview-teleported
            fit="contain"
            style="width: 100%; height: calc(100% - 48px)"
          />
          <div style="margin-top: 8px; font-size: 12px; color: #999">
            点击图片进入全屏查看，支持滚轮缩放、旋转与拖拽
          </div>
        </template>
        <template v-else-if="previewInline">
          <iframe
            :src="previewFileUrl"
            style="width: 100%; height: 100%; border: none"
          />
        </template>
        <template v-else>
          <el-alert
            type="info"
            :closable="false"
            title="该文件类型暂不支持内嵌预览，请使用下载打开"
          />
          <div style="margin-top: 12px">
            <el-link :href="previewFileUrl" target="_blank" type="primary"
              >下载附件</el-link
            >
          </div>
        </template>
      </div>
    </el-drawer>
```

- [ ] **Step 8: 验证并提交**

Run: `cd packages/web && npm run typecheck && npm run lint:eslint`
Expected: PASS

```bash
git add packages/web/src/views/finance/reimbursement/detail.vue
git commit -m "feat(web): 报销详情页重构——分组操作区/加载态/核查卡置顶/汉化/图片缩放/拆单接入"
```

---

## Task 16: AI 一键成批抽屉 + batch.vue 接入

**Files:**
- Create: `packages/web/src/views/finance/reimbursement/components/AiBatchProposalsDrawer.vue`
- Modify: `packages/web/src/views/finance/reimbursement/batch.vue`

- [ ] **Step 1: 抽屉组件（完整代码）**

```vue
<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ElMessageBox } from "element-plus";
import { message } from "@/utils/message";
import {
  createReimbursementBatch,
  listReimbursementBatchProposals,
  submitBatchApproval,
  triggerBatchAudit,
  type ReimbursementBatchProposal
} from "@/api/reimbursement";
import { listPayees, type Payee } from "@/api/payment";

defineOptions({ name: "AiBatchProposalsDrawer" });

const props = defineProps<{
  visible: boolean;
  projectNameMap: Record<number, string>;
  userNameMap: Map<string, string>;
}>();

const emit = defineEmits<{
  (event: "update:visible", value: boolean): void;
  (event: "done"): void;
  (event: "open-batch", id: number): void;
}>();

type ProposalRow = ReimbursementBatchProposal & {
  key: string;
  selected: boolean;
  payment_method: string;
  payee_id: number | undefined;
  payeeOptions: Payee[];
  result?: { ok: boolean; batch_no?: string; batch_id?: number; error?: string };
};

const loading = ref(false);
const confirming = ref(false);
const rows = ref<ProposalRow[]>([]);
const finished = ref(false);

const selectedRows = computed(() => rows.value.filter(row => row.selected));
const selectedTotal = computed(() =>
  selectedRows.value.reduce((sum, row) => sum + row.total_amount, 0)
);

const toProjectLabel = (id: number) => props.projectNameMap[id] || `项目#${id}`;
const toUserLabel = (userid: string) => props.userNameMap.get(userid) ?? userid;

const riskSummary = (row: ProposalRow) => {
  const high = row.envelopes.filter(e => e.duplicate_risk_level === "high").length;
  const medium = row.envelopes.filter(e => e.duplicate_risk_level === "medium").length;
  if (high > 0) return { label: `高风险重复 x${high}`, type: "danger" as const };
  if (medium > 0) return { label: `中风险重复 x${medium}`, type: "warning" as const };
  return null;
};

const load = async () => {
  loading.value = true;
  finished.value = false;
  try {
    const res = await listReimbursementBatchProposals();
    const applicants = [...new Set(res.data.map(item => item.applicant_userid))];
    const payeesByUser = new Map<string, Payee[]>();
    await Promise.all(
      applicants.map(async userid => {
        try {
          const payeeRes = await listPayees({ type: "internal", linked_userid: userid });
          payeesByUser.set(userid, payeeRes.data);
        } catch {
          payeesByUser.set(userid, []);
        }
      })
    );
    rows.value = res.data.map(item => ({
      ...item,
      key: `${item.applicant_userid}-${item.project_id}`,
      selected: true,
      payment_method: item.suggested_payment_method || "personal_transfer",
      payee_id: item.matched_payee?.id,
      payeeOptions: payeesByUser.get(item.applicant_userid) ?? []
    }));
  } catch {
    message("加载建议批次失败，请稍后重试", { type: "error" });
  } finally {
    loading.value = false;
  }
};

watch(
  () => props.visible,
  value => {
    if (value) load();
  }
);

const close = () => emit("update:visible", false);

const confirmAll = async () => {
  const targets = selectedRows.value;
  if (targets.length === 0) {
    message("请至少保留一个建议批次", { type: "warning" });
    return;
  }
  const missingPayee = targets.filter(row => row.payee_required && !row.payee_id);
  if (missingPayee.length > 0) {
    message(
      `有 ${missingPayee.length} 个批次缺少收款人（系统要求必填），请先补充`,
      { type: "warning" }
    );
    return;
  }
  try {
    await ElMessageBox.confirm(
      `即将创建并送审 ${targets.length} 个批次，合计 ¥${selectedTotal.value.toFixed(2)}。每个批次创建后将自动触发 AI 审计摘要供审批人查看。`,
      "二次确认：一键创建并送审",
      { type: "warning", confirmButtonText: "确认执行", cancelButtonText: "取消" }
    );
  } catch {
    return;
  }

  confirming.value = true;
  try {
    for (const row of targets) {
      try {
        const created = await createReimbursementBatch(
          {
            project_id: row.project_id,
            applicant_userid: row.applicant_userid,
            envelope_ids: row.envelopes.map(item => item.id),
            payment_method: row.payment_method,
            payee_id: row.payee_id
          },
          { idempotencyKey: `ai-batch-create-${crypto.randomUUID()}` }
        );
        await submitBatchApproval(
          created.data.id,
          { payment_method: row.payment_method, payee_id: row.payee_id },
          { idempotencyKey: `ai-batch-submit-${crypto.randomUUID()}` }
        );
        try {
          await triggerBatchAudit(created.data.id);
        } catch {
          // AI 审计触发失败不阻断：批次详情内可手动触发
        }
        row.result = {
          ok: true,
          batch_no: created.data.batch_no,
          batch_id: created.data.id
        };
      } catch (error) {
        const err = error as {
          response?: { data?: { error?: { message?: string } } };
        };
        row.result = {
          ok: false,
          error: err.response?.data?.error?.message || "创建或送审失败"
        };
      }
    }
    finished.value = true;
    const failed = targets.filter(row => row.result && !row.result.ok).length;
    message(
      failed === 0
        ? `全部 ${targets.length} 个批次已创建并送审`
        : `完成：成功 ${targets.length - failed} 个，失败 ${failed} 个（详见列表）`,
      { type: failed === 0 ? "success" : "warning" }
    );
    emit("done");
  } finally {
    confirming.value = false;
  }
};
</script>

<template>
  <el-drawer
    :model-value="props.visible"
    title="AI 一键成批（同人同项目终审批次）"
    size="60%"
    append-to-body
    @update:model-value="value => emit('update:visible', value)"
  >
    <el-alert
      type="info"
      :closable="false"
      class="mb-3"
      title="系统已按「同人 + 同项目 + 复核通过 + 未入批」自动分组。确认后逐组创建批次并送审，AI 审计摘要将自动附加到批次供审批人查看。"
    />

    <div v-loading="loading">
      <el-empty v-if="!loading && rows.length === 0" description="当前没有可成批的报销" />

      <div v-for="row in rows" :key="row.key" class="proposal-card">
        <div class="proposal-card__head">
          <el-checkbox v-model="row.selected" :disabled="confirming || finished">
            <strong>{{ toUserLabel(row.applicant_userid) }}</strong>
            · {{ toProjectLabel(row.project_id) }}
          </el-checkbox>
          <div class="proposal-card__meta">
            <el-tag v-if="riskSummary(row)" :type="riskSummary(row)!.type" size="small">
              {{ riskSummary(row)!.label }}
            </el-tag>
            <span>{{ row.item_count }} 条</span>
            <strong>¥{{ row.total_amount.toFixed(2) }}</strong>
          </div>
        </div>

        <div class="proposal-card__body">
          <el-select
            v-model="row.payment_method"
            size="small"
            style="width: 140px"
            :disabled="confirming || finished"
          >
            <el-option label="转账" value="personal_transfer" />
            <el-option label="对公转账" value="transfer" />
            <el-option label="现金" value="cash" />
            <el-option label="票据" value="bill" />
            <el-option label="其他" value="other" />
          </el-select>
          <el-select
            v-model="row.payee_id"
            size="small"
            clearable
            filterable
            :placeholder="row.payee_required ? '收款人（必填）' : '收款人（可选）'"
            style="width: 280px"
            :disabled="confirming || finished"
          >
            <el-option
              v-for="p in row.payeeOptions"
              :key="p.id"
              :label="`${p.name} | ${p.bank_name} | ${p.bank_account}`"
              :value="p.id"
            />
          </el-select>
          <el-tag v-if="row.matched_payee && row.payee_id === row.matched_payee.id" type="success" size="small">
            已自动匹配收款人
          </el-tag>
        </div>

        <el-table :data="row.envelopes" size="small" max-height="180">
          <el-table-column prop="envelope_no" label="信封编号" width="180" />
          <el-table-column prop="amount" label="金额" width="100" />
          <el-table-column prop="description" label="报销内容" min-width="160" show-overflow-tooltip />
          <el-table-column label="风险" width="110">
            <template #default="scope">
              <el-tag
                v-if="scope.row.duplicate_risk_level"
                :type="
                  scope.row.duplicate_risk_level === 'high'
                    ? 'danger'
                    : scope.row.duplicate_risk_level === 'medium'
                      ? 'warning'
                      : 'success'
                "
                size="small"
              >
                {{
                  scope.row.duplicate_risk_level === "high"
                    ? "高风险"
                    : scope.row.duplicate_risk_level === "medium"
                      ? "中风险"
                      : "低风险"
                }}
              </el-tag>
              <span v-else>-</span>
            </template>
          </el-table-column>
        </el-table>

        <el-alert
          v-if="row.result"
          :type="row.result.ok ? 'success' : 'error'"
          :closable="false"
          class="proposal-card__result"
        >
          <template #title>
            <template v-if="row.result.ok">
              已创建并送审：{{ row.result.batch_no }}
              <el-link
                type="primary"
                style="margin-left: 8px"
                @click="emit('open-batch', row.result!.batch_id!)"
                >查看批次</el-link
              >
            </template>
            <template v-else>失败：{{ row.result.error }}</template>
          </template>
        </el-alert>
      </div>
    </div>

    <template #footer>
      <div class="drawer-footer">
        <span v-if="rows.length > 0">
          已选 {{ selectedRows.length }} / {{ rows.length }} 组，合计 ¥{{
            selectedTotal.toFixed(2)
          }}
        </span>
        <el-space>
          <el-button @click="close">{{ finished ? "关闭" : "取消" }}</el-button>
          <el-button
            v-if="!finished"
            type="primary"
            :loading="confirming"
            :disabled="rows.length === 0"
            @click="confirmAll"
          >
            确认全部创建并送审
          </el-button>
        </el-space>
      </div>
    </template>
  </el-drawer>
</template>

<style scoped>
.mb-3 {
  margin-bottom: 12px;
}
.proposal-card {
  padding: 12px;
  margin-bottom: 12px;
  border: 1px solid #ebeef5;
  border-radius: 8px;
}
.proposal-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}
.proposal-card__meta {
  display: flex;
  align-items: center;
  gap: 10px;
  color: #374151;
}
.proposal-card__body {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.proposal-card__result {
  margin-top: 8px;
}
.drawer-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
</style>
```

- [ ] **Step 2: batch.vue 接入**

script 增加：

```ts
import AiBatchProposalsDrawer from "./components/AiBatchProposalsDrawer.vue";

const aiProposalsVisible = ref(false);
const userNameMap = computed(() => {
  const map = new Map<string, string>();
  wecomUsers.value.forEach(item => map.set(item.userid, item.name || item.userid));
  return map;
});
const onAiProposalsDone = async () => {
  await Promise.all([loadData(), loadHistory(), loadCandidates()]);
};
```

模板页头 `el-space`（"刷新候选/创建并送审"按钮处）最前面加：

```vue
        <el-button type="success" @click="aiProposalsVisible = true">
          AI 一键成批
        </el-button>
```

模板末尾（新建收款人 dialog 之后）加：

```vue
    <AiBatchProposalsDrawer
      v-model:visible="aiProposalsVisible"
      :project-name-map="projectMap"
      :user-name-map="userNameMap"
      @done="onAiProposalsDone"
      @open-batch="openDetail"
    />
```

- [ ] **Step 3: 验证并提交**

Run: `cd packages/web && npm run typecheck && npm run lint:eslint`
Expected: PASS

```bash
git add packages/web/src/views/finance/reimbursement/components/AiBatchProposalsDrawer.vue packages/web/src/views/finance/reimbursement/batch.vue
git commit -m "feat(web): AI一键成批——建议批次确认抽屉与逐组创建送审编排"
```

---

## Task 17: 工作台"草稿与异常"tab + 批量操作

**Files:**
- Modify: `packages/web/src/views/finance/reimbursement/office-workbench.vue`

- [ ] **Step 1: script 增量**

imports 增加 `bulkVoidReimbursementEnvelopes, bulkDeleteReimbursementEnvelopes`（自 `@/api/reimbursement`）、`ElMessageBox`（自 element-plus）、`reimbursementStatusLabel, reimbursementPrecheckStatusLabel`（Task 12 已改）。

类型与查询预设：

```ts
type IntakeTab = "to_receive" | "to_precheck" | "to_batch" | "admin_zone";
type AdminSubTab = "draft" | "returned" | "cancelled";

const ADMIN_QUERY: Record<
  AdminSubTab,
  { status: string[]; precheck?: string[]; excludeUnassigned?: boolean }
> = {
  draft: { status: ["draft", "unregistered"], excludeUnassigned: true },
  returned: { status: ["submitted"], precheck: ["rejected", "supplement"] },
  cancelled: { status: ["cancelled"] }
};

const adminSubTab = ref<AdminSubTab>("draft");
const adminSelectedIds = ref<number[]>([]);
const bulkActing = ref(false);

const isSuperAdmin = computed(() =>
  (userStore.roles ?? []).includes("super_admin")
);
```

`office-workbench.vue` 目前未引入 userStore，需补：

```ts
import { useUserStoreHook } from "@/store/modules/user";
const userStore = useUserStoreHook();
```

`intakeTabs` computed 改为（追加第 4 项，仅超管可见）：

```ts
const intakeTabs = computed(() => {
  const tabs = [
    { key: "to_receive" as IntakeTab, label: "待签收", count: summary.value?.to_receive },
    { key: "to_precheck" as IntakeTab, label: "待复核", count: summary.value?.to_precheck },
    { key: "to_batch" as IntakeTab, label: "待成批", count: summary.value?.to_batch }
  ];
  if (isSuperAdmin.value) {
    tabs.push({
      key: "admin_zone" as IntakeTab,
      label: "草稿与异常",
      count:
        (summary.value?.admin_draft ?? 0) + (summary.value?.admin_returned ?? 0)
    });
  }
  return tabs;
});
```

`loadData` 改为按 tab 分派（替换 preset 取值三行）：

```ts
    const preset =
      intakeTab.value === "admin_zone"
        ? ADMIN_QUERY[adminSubTab.value]
        : INTAKE_QUERY[intakeTab.value];
    const result = await listReimbursementEnvelopes({
      page: page.value,
      pageSize: pageSize.value,
      status: preset.status.join(","),
      precheck_status: preset.precheck?.join(","),
      exclude_cancelled: false,
      exclude_unassigned:
        "excludeUnassigned" in preset ? preset.excludeUnassigned : undefined
    });
```

（`INTAKE_QUERY` 类型同步放宽为与 `ADMIN_QUERY` 值类型一致。）切 tab / 子筛选时清空选择：

```ts
const switchAdminSubTab = (tab: AdminSubTab) => {
  adminSubTab.value = tab;
  adminSelectedIds.value = [];
  page.value = 1;
  loadData();
};

const onAdminSelectionChange = (rowsSelected: ReimbursementEnvelope[]) => {
  adminSelectedIds.value = rowsSelected.map(row => row.id);
};
```

滞留天数与批量操作：

```ts
const staleDays = (row: ReimbursementEnvelope) => {
  const updated = new Date(row.updated_at).getTime();
  if (!Number.isFinite(updated)) return "-";
  const days = Math.floor((Date.now() - updated) / 86400000);
  return days < 0 ? "0 天" : `${days} 天`;
};

const fetchAllAdminIds = async (): Promise<number[]> => {
  const preset = ADMIN_QUERY[adminSubTab.value];
  const ids: number[] = [];
  let currentPage = 1;
  for (;;) {
    const result = await listReimbursementEnvelopes({
      page: currentPage,
      pageSize: 100,
      status: preset.status.join(","),
      precheck_status: preset.precheck?.join(","),
      exclude_cancelled: false,
      exclude_unassigned: preset.excludeUnassigned
    });
    result.data.forEach(row => ids.push(row.id));
    if (
      ids.length >= 500 ||
      result.data.length === 0 ||
      currentPage * 100 >= result.pagination.total
    ) {
      break;
    }
    currentPage += 1;
  }
  return ids.slice(0, 500);
};

const selectAllMatching = async () => {
  const ids = await fetchAllAdminIds();
  adminSelectedIds.value = ids;
  message(`已按当前筛选选中全部 ${ids.length} 条（上限 500）`, { type: "success" });
};

const runBulkLifecycle = async (action: "void" | "delete") => {
  if (adminSelectedIds.value.length === 0) {
    message("请先勾选要操作的报销单", { type: "warning" });
    return;
  }
  const label = action === "void" ? "废止" : "删除";
  try {
    await ElMessageBox.confirm(
      `确认${label}所选 ${adminSelectedIds.value.length} 条报销？${
        action === "delete"
          ? "删除为软删除：列表不再可见，数据与审计日志保留。仅草稿/未登记/已废止的单据可删除。"
          : "废止后单据不再参与流转，可在「已废止」子页查看。"
      }`,
      `一键${label}`,
      { type: "warning", confirmButtonText: `确认${label}`, cancelButtonText: "取消" }
    );
  } catch {
    return;
  }
  bulkActing.value = true;
  try {
    const request =
      action === "void"
        ? bulkVoidReimbursementEnvelopes
        : bulkDeleteReimbursementEnvelopes;
    const res = await request({
      envelope_ids: adminSelectedIds.value,
      reason: `管理员批量${label}`
    });
    const { succeeded, failed } = res.data;
    message(
      failed === 0
        ? `已${label} ${succeeded} 条`
        : `${label}完成：成功 ${succeeded} 条，失败 ${failed} 条（状态不允许的单已跳过）`,
      { type: failed === 0 ? "success" : "warning" }
    );
    adminSelectedIds.value = [];
    await refreshAll();
  } finally {
    bulkActing.value = false;
  }
};
```

- [ ] **Step 2: 模板增量**

第①步 section 内、`el-tabs` 之后加子筛选与批量操作条（仅 admin tab 显示）：

```vue
        <div v-if="intakeTab === 'admin_zone'" class="admin-zone-bar">
          <el-radio-group
            :model-value="adminSubTab"
            @update:model-value="value => switchAdminSubTab(value as AdminSubTab)"
          >
            <el-radio-button value="draft"
              >草稿/未登记（{{ summary?.admin_draft ?? 0 }}）</el-radio-button
            >
            <el-radio-button value="returned"
              >退回滞留（{{ summary?.admin_returned ?? 0 }}）</el-radio-button
            >
            <el-radio-button value="cancelled"
              >已废止（{{ summary?.admin_cancelled ?? 0 }}）</el-radio-button
            >
          </el-radio-group>
          <el-space wrap>
            <el-button :disabled="bulkActing" @click="selectAllMatching"
              >全选全部（≤500）</el-button
            >
            <el-button
              v-if="adminSubTab !== 'cancelled'"
              type="warning"
              :loading="bulkActing"
              :disabled="adminSelectedIds.length === 0"
              @click="runBulkLifecycle('void')"
              >一键废止所选（{{ adminSelectedIds.length }}）</el-button
            >
            <el-button
              v-if="adminSubTab !== 'returned'"
              type="danger"
              :loading="bulkActing"
              :disabled="adminSelectedIds.length === 0"
              @click="runBulkLifecycle('delete')"
              >一键删除所选（{{ adminSelectedIds.length }}）</el-button
            >
          </el-space>
        </div>
```

主表格 `el-table` 加 `row-key="id"` 与选择列（放在最前，仅 admin tab 显示）：

```vue
          <el-table-column
            v-if="intakeTab === 'admin_zone'"
            type="selection"
            width="48"
          />
```

并给 `el-table` 加 `@selection-change="onAdminSelectionChange"`。

操作列内加 admin tab 分支（"详情"按钮已有，复用）：

```vue
              <template v-if="intakeTab === 'admin_zone'">
                <span class="stale-days">滞留 {{ staleDays(scope.row) }}</span>
              </template>
```

（也可加独立"滞留天数"列，放在"状态"列后：）

```vue
          <el-table-column
            v-if="intakeTab === 'admin_zone'"
            label="滞留天数"
            width="100"
          >
            <template #default="scope">{{ staleDays(scope.row) }}</template>
          </el-table-column>
```

二者取其一，推荐独立列。style 加：

```css
.admin-zone-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}
```

- [ ] **Step 3: 验证并提交**

Run: `cd packages/web && npm run typecheck && npm run lint:eslint`
Expected: PASS

```bash
git add packages/web/src/views/finance/reimbursement/office-workbench.vue
git commit -m "feat(web): 工作台新增草稿与异常管理tab（批量废止/软删除，仅超管）"
```

---

## Task 18: 清理、文档与全量验证

**Files:**
- Delete: `packages/web/src/views/finance/reimbursement/envelope-generator 2.vue`
- Modify: `doc/开发记录.md`（追加）、`doc/UI设计文档.md`、spec 文档

- [ ] **Step 1: 删除无引用重复文件**

```bash
git rm "packages/web/src/views/finance/reimbursement/envelope-generator 2.vue"
```

- [ ] **Step 2: spec 修订记录**

在 `docs/superpowers/specs/2026-07-10-reimbursement-enhancements-design.md` 末尾追加：

```markdown
## 实施修订（2026-07-10 计划阶段确认）

1. **批次确认改前端编排**：`POST /batch/proposals/confirm` 不实现；前端逐组调用既有
   `POST /batch` → `POST /batch/:id/submit-approval` → `POST /batch/:id/trigger-audit`。
   理由：避免重构 4900 行路由文件中的付款关键路径；逐组独立成败语义天然保留。
2. **标签统一位置**：报销域规范汉化标签集中在模块内 `reimbursement-labels.ts` 而非全局
   `utils/enum-labels.ts`（后者被其他业务域共用，措辞不同，避免跨域影响）。
3. **新增 `exclude_unassigned` 列表参数**：信封生成器预生成的空白信封
   （`unregistered` + `__UNASSIGNED__`）属于库存，"草稿/未登记"管理页必须排除。
```

- [ ] **Step 3: 更新 doc/开发记录.md（追加，不新建文件）与 doc/UI设计文档.md**

开发记录追加条目涵盖：四个功能、关键决策（拆单角色、电子发票门槛、软删除语义、前端编排修订）、迁移 0057、新端点清单。UI设计文档更新：工作台第4个tab、详情页操作区分组与核查卡置顶、批次页 AI 一键成批入口。

- [ ] **Step 4: 全量验证**

```bash
cd packages/api && npm run typecheck && npm run lint && npx vitest run
cd ../web && npm run typecheck && npm run lint:eslint
```

Expected: 全部通过。

- [ ] **Step 5: 本地冒烟（dev 环境）**

启动 `npm run dev:api` + `npm run dev:web`，用种子数据（`npm run db:seed:mock:local`）人工验证：

1. 详情页：分组操作区渲染、加载遮罩、状态表全中文、图片预览可缩放、智能核查卡在概要下方且不可折叠；
2. 拆单：finance 账号对 received 信封拆单 → 新单生成 → 打印弹窗 → 两单核查状态变为处理中；
3. AI 一键成批：建议分组正确、确认后批次创建并送审、批次详情可见 AI 审计任务；
4. 草稿与异常 tab：超管可见、三个子筛选计数正确、批量废止/删除逐条结果正确、空白信封不出现在"草稿/未登记"；
5. 电子发票门槛：对含 20 位数电票号码识别结果的实物信封点"复核通过"被拦截，强制通过需理由。

- [ ] **Step 6: 提交收尾**

```bash
git add doc/开发记录.md doc/UI设计文档.md docs/superpowers/specs/2026-07-10-reimbursement-enhancements-design.md
git commit -m "docs: 报销模块增强开发记录与UI文档同步，spec实施修订记录"
```

- [ ] **Step 7: 部署备忘（待用户确认后执行）**

```bash
cd packages/api && npx wrangler d1 migrations apply hybcdg-prod-db --remote   # 先迁移
git push origin main                                                          # 推 main 即部署
# 验证：https://api.hybcdg.com/api/v1/system/health 期待 ok=true
```

---

## 计划自审记录

- **Spec 覆盖**：拆单（Task 1/2/6/13/14/15）、电子发票门槛（Task 3/7/12/15）、AI一键成批（Task 5/8/16）、草稿异常tab（Task 4/9/10/17）、详情页优化（Task 12/15）、横切（Task 11/18）。全部映射。
- **占位符**：无 TBD/TODO；所有代码步骤含完整代码。
- **类型一致性**：`decideSplitEnvelope`/`detectEInvoiceInPhysical`/`decideBulkLifecycle`/`groupBatchProposals`/`matchUniqueInternalPayee` 签名在策略定义与端点调用处一致；web 端 `splitReimbursementEnvelope`/`bulkVoid…`/`bulkDelete…`/`listReimbursementBatchProposals` 与组件调用一致；`toTaskStatusLabel` 等别名保持 detail.vue 模板兼容。
