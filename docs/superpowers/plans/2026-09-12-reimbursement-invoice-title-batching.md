# 报销成批按发票抬头筛选与软约束 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给报销信封加上可信的「发票抬头主体」（OCR 预填 + 办公室修正 + 存量回填），成批页可按抬头筛选、混抬头需填理由，付款实体按抬头预填并在选款/打款时对不一致二次确认。

**Architecture:** 信封表新增三列（抬头主体 id / 原文 / 来源），批次表新增两列（抬头主体 / 混批理由）。纯函数策略模块负责名称归一化、主体匹配、批次抬头汇总与理由校验；OCR 折叠函数、信封更新、候选/建议/成批路由只做接线。Web 端成批页新增筛选与列，创建前用同一套汇总规则做预填/弹理由；批次详情、审批页、集中打款台对付款实体 ≠ 抬头主体做标红与二次确认。

**Tech Stack:** Cloudflare Workers + Hono + D1（SQLite/JSON1），vitest（api 与 web），Vue 3 + Element Plus（PureAdmin）。

**Spec:** `docs/superpowers/specs/2026-09-12-reimbursement-invoice-title-batching-design.md`

**约定（每个任务都适用）：**
- 仓库用 pnpm，脚本用 `npm run xxx` 即可；不要改依赖。
- 提交信息格式 `<type>(<scope>): <中文描述>`，不加任何 AI 署名尾注。
- 禁止 `as any` / `@ts-ignore`；不可变更新（返回新对象，不原地改）。
- API 路由文件 `packages/api/src/routes/reimbursement.ts` 很大（约 5800 行），下文用「锚点代码」定位，插入位置务必按锚点。
- 任务中所有相对路径以仓库根目录为准，命令里已写明 `cd`。

---

### Task 0: 独立工作区（worktree）

主工作区有大量未提交的其他改动，本计划在独立 worktree 上执行。

**Files:** 无代码改动。

- [ ] **Step 1: 创建 worktree 与分支**

```bash
cd /Users/zihaoliu/Documents/Code/hybc_core
git worktree add .claude/worktrees/reimbursement-invoice-title -b feat/reimbursement-invoice-title main
```

Expected: `Preparing worktree (new branch 'feat/reimbursement-invoice-title')`。

- [ ] **Step 2: 复用主工作区依赖与本地密钥（worktree 没有 node_modules）**

```bash
cd /Users/zihaoliu/Documents/Code/hybc_core/.claude/worktrees/reimbursement-invoice-title
ln -s /Users/zihaoliu/Documents/Code/hybc_core/node_modules node_modules
ln -s /Users/zihaoliu/Documents/Code/hybc_core/packages/api/node_modules packages/api/node_modules
ln -s /Users/zihaoliu/Documents/Code/hybc_core/packages/web/node_modules packages/web/node_modules
cp /Users/zihaoliu/Documents/Code/hybc_core/packages/api/.dev.vars packages/api/.dev.vars
```

- [ ] **Step 3: 基线验证**

```bash
cd /Users/zihaoliu/Documents/Code/hybc_core/.claude/worktrees/reimbursement-invoice-title/packages/api && npm run typecheck && npx vitest run src/routes/reimbursement-batch-proposal-policy.test.ts
```

Expected: typecheck 无输出（成功）；`Test Files 1 passed`。

后续所有任务的 `cd` 均指向该 worktree：`W=/Users/zihaoliu/Documents/Code/hybc_core/.claude/worktrees/reimbursement-invoice-title`。

---

### Task 1: 迁移 0087（新列 + 存量回填）

**Files:**
- Create: `packages/api/migrations/0087_reimbursement_invoice_title.sql`

- [ ] **Step 1: 写迁移文件**

```sql
-- 0087_reimbursement_invoice_title.sql
-- 报销信封「发票抬头（购买方）」：OCR 预填 + 办公室修正 + 存量回填。
-- 背景：报销款须由发票抬头对应的我方主体支付；2026-09-11 RM-20260911-0001 混抬头成批被迫解散。
-- 回填数据源：reimbursement_invoice_review.extraction_json.buyer_name（0037 建表，runner ocr_extract 已输出）。
-- 两条 UPDATE 均带守卫，幂等；本地 mock 库无识别数据时自然空跑。

ALTER TABLE reimbursement_envelope ADD COLUMN invoice_title_entity_id INTEGER;
ALTER TABLE reimbursement_envelope ADD COLUMN invoice_title_name TEXT;
ALTER TABLE reimbursement_envelope ADD COLUMN invoice_title_source TEXT;
CREATE INDEX idx_reimbursement_envelope_invoice_title_entity_id
  ON reimbursement_envelope(invoice_title_entity_id);

ALTER TABLE reimbursement_batch ADD COLUMN invoice_title_entity_id INTEGER;
ALTER TABLE reimbursement_batch ADD COLUMN mixed_title_reason TEXT;

-- 回填 1：抬头原文（每个信封取最新一轮、非空 buyer_name 的完成行）
UPDATE reimbursement_envelope
   SET invoice_title_name = (
         SELECT trim(json_extract(r.extraction_json, '$.buyer_name'))
           FROM reimbursement_invoice_review r
          WHERE r.envelope_id = reimbursement_envelope.id
            AND r.task_status = 'completed'
            AND json_valid(r.extraction_json)
            AND json_type(r.extraction_json, '$.buyer_name') = 'text'
            AND trim(json_extract(r.extraction_json, '$.buyer_name')) != ''
          ORDER BY r.review_round DESC, r.id DESC
          LIMIT 1
       ),
       invoice_title_source = 'ocr'
 WHERE status != 'deleted'
   AND invoice_title_source IS NULL
   AND EXISTS (
         SELECT 1
           FROM reimbursement_invoice_review r
          WHERE r.envelope_id = reimbursement_envelope.id
            AND r.task_status = 'completed'
            AND json_valid(r.extraction_json)
            AND json_type(r.extraction_json, '$.buyer_name') = 'text'
            AND trim(json_extract(r.extraction_json, '$.buyer_name')) != ''
       );

-- 回填 2：归一化（去半角/全角空格、半角括号转全角）后与 active 主体精确比对，恰好一个命中才写
UPDATE reimbursement_envelope
   SET invoice_title_entity_id = (
         SELECT e.id
           FROM entity e
          WHERE e.status = 'active'
            AND REPLACE(REPLACE(REPLACE(REPLACE(e.entity_name, ' ', ''), '　', ''), '(', '（'), ')', '）')
              = REPLACE(REPLACE(REPLACE(REPLACE(reimbursement_envelope.invoice_title_name, ' ', ''), '　', ''), '(', '（'), ')', '）')
          LIMIT 1
       )
 WHERE invoice_title_source = 'ocr'
   AND invoice_title_name IS NOT NULL
   AND invoice_title_entity_id IS NULL
   AND (
         SELECT COUNT(*)
           FROM entity e
          WHERE e.status = 'active'
            AND REPLACE(REPLACE(REPLACE(REPLACE(e.entity_name, ' ', ''), '　', ''), '(', '（'), ')', '）')
              = REPLACE(REPLACE(REPLACE(REPLACE(reimbursement_envelope.invoice_title_name, ' ', ''), '　', ''), '(', '（'), ')', '）')
       ) = 1;
```

- [ ] **Step 2: 本地应用并核对列**

```bash
cd $W/packages/api && npm run db:migrate:local
npx wrangler d1 execute hybcdg-prod-db --local --command "PRAGMA table_info(reimbursement_envelope)" | grep -c "invoice_title"
npx wrangler d1 execute hybcdg-prod-db --local --command "PRAGMA table_info(reimbursement_batch)" | grep -c "invoice_title_entity_id\|mixed_title_reason"
```

Expected: 第一条输出 `3`，第二条输出 `2`（PRAGMA 输出为表格，grep 统计行数）。

- [ ] **Step 3: 提交**

```bash
cd $W && git add packages/api/migrations/0087_reimbursement_invoice_title.sql && git commit -m "feat(api): 报销信封与批次新增发票抬头字段并回填存量（迁移0087）"
```

---

### Task 2: 领域类型

**Files:**
- Modify: `packages/api/src/types/reimbursement.ts`

- [ ] **Step 1: 在 `ReimbursementEnvelope` 接口 `split_reason: string | null;` 之后追加三列**

```ts
  invoice_title_entity_id: number | null;
  invoice_title_name: string | null;
  invoice_title_source: InvoiceTitleSource | null;
```

并在文件顶部 `export const taskStatuses = ...` 之后新增：

```ts
export const invoiceTitleSources = ["ocr", "manual"] as const;
export type InvoiceTitleSource = (typeof invoiceTitleSources)[number];
```

- [ ] **Step 2: 在 `ReimbursementBatch` 接口 `payee_id: number | null;` 之后追加**

```ts
  invoice_title_entity_id: number | null;
  mixed_title_reason: string | null;
```

- [ ] **Step 3: 请求体类型**

`UpdateEnvelopeRequest` 在 `attachments?: AttachmentInput[];` 之后追加（三态：缺省不改 / 数字设置 / null 清除）：

```ts
  /** 办公室指定发票抬头主体；null 表示清除、回到自动识别 */
  invoice_title_entity_id?: number | null;
```

`CreateReimbursementBatchRequest` 在 `payee_id?: number;` 之后追加：

```ts
  /** 所选信封发票抬头不一致时必填（2–200 字） */
  mixed_title_reason?: string;
```

- [ ] **Step 4: typecheck 并提交**

```bash
cd $W/packages/api && npm run typecheck
cd $W && git add packages/api/src/types/reimbursement.ts && git commit -m "feat(api): 报销发票抬头相关领域类型"
```

Expected: typecheck 通过（此时尚无使用方，仅类型扩展）。

---

### Task 3: 抬头匹配策略模块（纯函数 + 单测）

**Files:**
- Create: `packages/api/src/routes/reimbursement-invoice-title-policy.ts`
- Test: `packages/api/src/routes/reimbursement-invoice-title-policy.test.ts`

- [ ] **Step 1: 写失败的测试**

```ts
import { describe, expect, it } from "vitest";

import {
  matchInvoiceTitleEntity,
  normalizeInvoiceTitle,
  pickBuyerNameFromReviews,
  readInvoiceExtractionText,
  resolveOcrTitleUpdate
} from "./reimbursement-invoice-title-policy";

const entities = [
  { id: 6, entity_name: "廊坊市丰畅市政工程有限公司", status: "active" },
  { id: 11, entity_name: "北京鑫丰畅建设有限公司", status: "active" },
  { id: 12, entity_name: "恒越百川（北京）建设科技有限公司", status: "active" },
  { id: 5, entity_name: "test", status: "deleted" }
];

describe("normalizeInvoiceTitle", () => {
  it("去掉半角/全角空白并把半角括号转成全角", () => {
    expect(normalizeInvoiceTitle(" 恒越百川(北京) 建设科技　有限公司 ")).toBe(
      "恒越百川（北京）建设科技有限公司"
    );
  });

  it("空值与非字符串返回 null", () => {
    expect(normalizeInvoiceTitle("   ")).toBeNull();
    expect(normalizeInvoiceTitle(null)).toBeNull();
    expect(normalizeInvoiceTitle(12)).toBeNull();
  });
});

describe("matchInvoiceTitleEntity", () => {
  it("归一化后唯一命中 active 主体", () => {
    expect(matchInvoiceTitleEntity("恒越百川(北京)建设科技有限公司", entities)).toEqual({
      entityId: 12,
      name: "恒越百川(北京)建设科技有限公司"
    });
  });

  it("未命中时保留原文、id 为 null", () => {
    expect(matchInvoiceTitleEntity("刘相余", entities)).toEqual({ entityId: null, name: "刘相余" });
  });

  it("非 active 主体不参与匹配", () => {
    expect(matchInvoiceTitleEntity("test", entities).entityId).toBeNull();
  });

  it("多主体同名时不写 id", () => {
    const dup = [...entities, { id: 99, entity_name: "北京鑫丰畅建设有限公司", status: "active" }];
    expect(matchInvoiceTitleEntity("北京鑫丰畅建设有限公司", dup).entityId).toBeNull();
  });

  it("空输入返回全 null", () => {
    expect(matchInvoiceTitleEntity(null, entities)).toEqual({ entityId: null, name: null });
  });
});

describe("readInvoiceExtractionText / pickBuyerNameFromReviews", () => {
  const rows = [
    { task_status: "completed", extraction_json: JSON.stringify({ buyer_name: "  " }) },
    { task_status: "failed", extraction_json: JSON.stringify({ buyer_name: "失败行不算" }) },
    { task_status: "completed", extraction_json: JSON.stringify({ buyer_name: "北京鑫丰畅建设有限公司" }) },
    { task_status: "completed", extraction_json: "not json" }
  ];

  it("readInvoiceExtractionText 只返回非空字符串字段", () => {
    expect(readInvoiceExtractionText(rows[2].extraction_json, "buyer_name")).toBe("北京鑫丰畅建设有限公司");
    expect(readInvoiceExtractionText(rows[0].extraction_json, "buyer_name")).toBeNull();
    expect(readInvoiceExtractionText("not json", "buyer_name")).toBeNull();
    expect(readInvoiceExtractionText(null, "buyer_name")).toBeNull();
  });

  it("优先取指定的 bestRow，其次取第一条有抬头的完成行", () => {
    expect(pickBuyerNameFromReviews(rows, rows[2])).toBe("北京鑫丰畅建设有限公司");
    expect(pickBuyerNameFromReviews(rows, rows[0])).toBe("北京鑫丰畅建设有限公司");
    expect(pickBuyerNameFromReviews(rows, null)).toBe("北京鑫丰畅建设有限公司");
  });

  it("没有任何抬头时返回 null", () => {
    expect(pickBuyerNameFromReviews([rows[0], rows[1], rows[3]], null)).toBeNull();
  });
});

describe("resolveOcrTitleUpdate", () => {
  const matched = { entityId: 11, name: "北京鑫丰畅建设有限公司" };

  it("手工指定过的信封永不被 OCR 覆盖", () => {
    expect(
      resolveOcrTitleUpdate({ invoice_title_source: "manual" }, { buyerName: "x", pendingCount: 0 }, matched)
    ).toBeNull();
  });

  it("仍有识别任务进行中时不动", () => {
    expect(
      resolveOcrTitleUpdate({ invoice_title_source: null }, { buyerName: null, pendingCount: 2 }, matched)
    ).toBeNull();
  });

  it("本轮全部完成但没有抬头 → 清空", () => {
    expect(
      resolveOcrTitleUpdate({ invoice_title_source: "ocr" }, { buyerName: null, pendingCount: 0 }, { entityId: null, name: null })
    ).toEqual({ entityId: null, name: null, source: null });
  });

  it("有抬头 → 写入匹配结果，来源 ocr", () => {
    expect(
      resolveOcrTitleUpdate({ invoice_title_source: null }, { buyerName: "北京鑫丰畅建设有限公司", pendingCount: 0 }, matched)
    ).toEqual({ entityId: 11, name: "北京鑫丰畅建设有限公司", source: "ocr" });
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
cd $W/packages/api && npx vitest run src/routes/reimbursement-invoice-title-policy.test.ts
```

Expected: FAIL，`Failed to resolve import "./reimbursement-invoice-title-policy"`。

- [ ] **Step 3: 实现模块**

```ts
import type { InvoiceTitleSource } from "../types/reimbursement";

export type InvoiceTitleEntityCandidate = {
  id: number;
  entity_name: string;
  status: string;
};

export type InvoiceTitleMatch = {
  entityId: number | null;
  name: string | null;
};

export type InvoiceReviewTitleRow = {
  task_status: string;
  extraction_json: string | null;
};

export type OcrTitleOutcome = {
  buyerName: string | null;
  pendingCount: number;
};

export type OcrTitleUpdate = {
  entityId: number | null;
  name: string | null;
  source: InvoiceTitleSource | null;
};

/** 去首尾及内部空白（含全角空格），半角括号转全角；空串返回 null */
export const normalizeInvoiceTitle = (raw: unknown): string | null => {
  if (typeof raw !== "string") return null;
  const normalized = raw
    .replace(/[\s　]+/g, "")
    .replace(/\(/g, "（")
    .replace(/\)/g, "）");
  return normalized || null;
};

/** 只在 active 主体中按归一化名精确比对；唯一命中才给 entityId，原文始终保留 */
export const matchInvoiceTitleEntity = (
  raw: unknown,
  entities: InvoiceTitleEntityCandidate[]
): InvoiceTitleMatch => {
  const name = typeof raw === "string" && raw.trim() ? raw.trim() : null;
  const normalized = normalizeInvoiceTitle(raw);
  if (!normalized) return { entityId: null, name };
  const hits = entities.filter(
    (entity) =>
      entity.status === "active" && normalizeInvoiceTitle(entity.entity_name) === normalized
  );
  return { entityId: hits.length === 1 ? hits[0].id : null, name };
};

/** 从识别行的 extraction_json 读取一个非空字符串字段（如 buyer_name / seller_name） */
export const readInvoiceExtractionText = (
  extractionJson: string | null | undefined,
  field: string
): string | null => {
  if (!extractionJson) return null;
  try {
    const parsed = JSON.parse(extractionJson) as Record<string, unknown>;
    const value = parsed?.[field];
    return typeof value === "string" && value.trim() ? value.trim() : null;
  } catch {
    return null;
  }
};

/** 优先取与发票号提示同源的 bestRow，否则取第一条有 buyer_name 的完成行 */
export const pickBuyerNameFromReviews = (
  rows: InvoiceReviewTitleRow[],
  preferred: InvoiceReviewTitleRow | null | undefined
): string | null => {
  const preferredName = preferred ? readInvoiceExtractionText(preferred.extraction_json, "buyer_name") : null;
  if (preferredName) return preferredName;
  for (const row of rows) {
    if (row.task_status !== "completed") continue;
    const name = readInvoiceExtractionText(row.extraction_json, "buyer_name");
    if (name) return name;
  }
  return null;
};

/**
 * OCR 同步是否/如何写抬头：
 * - 手工指定过 → null（不写）
 * - 仍有识别任务进行中 → null（不动）
 * - 全部完成但无抬头 → 三列清空
 * - 有抬头 → 写匹配结果，来源 ocr
 */
export const resolveOcrTitleUpdate = (
  envelope: { invoice_title_source: string | null },
  outcome: OcrTitleOutcome,
  match: InvoiceTitleMatch
): OcrTitleUpdate | null => {
  if (envelope.invoice_title_source === "manual") return null;
  if (outcome.pendingCount > 0) return null;
  if (!outcome.buyerName) return { entityId: null, name: null, source: null };
  return { entityId: match.entityId, name: match.name, source: "ocr" };
};
```

- [ ] **Step 4: 运行确认通过**

```bash
cd $W/packages/api && npx vitest run src/routes/reimbursement-invoice-title-policy.test.ts
```

Expected: `Tests 14 passed`。

- [ ] **Step 5: 提交**

```bash
cd $W && git add packages/api/src/routes/reimbursement-invoice-title-policy.ts packages/api/src/routes/reimbursement-invoice-title-policy.test.ts && git commit -m "feat(api): 发票抬头归一化与主体匹配策略模块"
```

---

### Task 4: 批次抬头汇总策略（纯函数 + 单测）

**Files:**
- Create: `packages/api/src/routes/reimbursement-batch-title-policy.ts`
- Test: `packages/api/src/routes/reimbursement-batch-title-policy.test.ts`

- [ ] **Step 1: 写失败的测试**

```ts
import { describe, expect, it } from "vitest";

import {
  summarizeBatchTitles,
  validateMixedTitleReason
} from "./reimbursement-batch-title-policy";

describe("summarizeBatchTitles", () => {
  it("空集合 → empty", () => {
    expect(summarizeBatchTitles([])).toEqual({ kind: "empty", entityId: null, counts: [] });
  });

  it("全部同一主体 → uniform，带该主体 id", () => {
    const summary = summarizeBatchTitles([
      { invoice_title_entity_id: 11, invoice_title_name: "北京鑫丰畅建设有限公司" },
      { invoice_title_entity_id: 11, invoice_title_name: "北京鑫丰畅建设有限公司" }
    ]);
    expect(summary.kind).toBe("uniform");
    expect(summary.entityId).toBe(11);
    expect(summary.counts).toEqual([
      { entity_id: 11, name: "北京鑫丰畅建设有限公司", count: 2 }
    ]);
  });

  it("全部未识别 → unknown，不算混合", () => {
    const summary = summarizeBatchTitles([
      { invoice_title_entity_id: null, invoice_title_name: null },
      { invoice_title_entity_id: null, invoice_title_name: "刘相余" }
    ]);
    expect(summary.kind).toBe("unknown");
    expect(summary.entityId).toBeNull();
    expect(summary.counts).toEqual([{ entity_id: null, name: "刘相余", count: 2 }]);
  });

  it("两个主体 → mixed，计数按数量降序", () => {
    const summary = summarizeBatchTitles([
      { invoice_title_entity_id: 6, invoice_title_name: "廊坊市丰畅市政工程有限公司" },
      { invoice_title_entity_id: 11, invoice_title_name: "北京鑫丰畅建设有限公司" },
      { invoice_title_entity_id: 11, invoice_title_name: "北京鑫丰畅建设有限公司" }
    ]);
    expect(summary.kind).toBe("mixed");
    expect(summary.entityId).toBeNull();
    expect(summary.counts.map((c) => [c.entity_id, c.count])).toEqual([
      [11, 2],
      [6, 1]
    ]);
  });

  it("已识别 + 未识别 → mixed", () => {
    expect(
      summarizeBatchTitles([
        { invoice_title_entity_id: 11, invoice_title_name: "北京鑫丰畅建设有限公司" },
        { invoice_title_entity_id: null, invoice_title_name: null }
      ]).kind
    ).toBe("mixed");
  });
});

describe("validateMixedTitleReason", () => {
  it("2–200 字（去空白后）有效并返回裁剪值", () => {
    expect(validateMixedTitleReason("  两家公司  ")).toBe("两家公司");
  });

  it("过短、过长、非字符串无效", () => {
    expect(validateMixedTitleReason("短")).toBeNull();
    expect(validateMixedTitleReason("长".repeat(201))).toBeNull();
    expect(validateMixedTitleReason(undefined)).toBeNull();
    expect(validateMixedTitleReason(12)).toBeNull();
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
cd $W/packages/api && npx vitest run src/routes/reimbursement-batch-title-policy.test.ts
```

Expected: FAIL，找不到模块。

- [ ] **Step 3: 实现模块**

```ts
export type BatchTitleEnvelope = {
  invoice_title_entity_id: number | null;
  invoice_title_name: string | null;
};

export type BatchTitleKind = "uniform" | "mixed" | "unknown" | "empty";

export type BatchTitleCount = {
  entity_id: number | null;
  name: string | null;
  count: number;
};

export type BatchTitleSummary = {
  kind: BatchTitleKind;
  entityId: number | null;
  counts: BatchTitleCount[];
};

export const MIXED_TITLE_REASON_MIN_LENGTH = 2;
export const MIXED_TITLE_REASON_MAX_LENGTH = 200;

/**
 * 汇总一组信封的抬头：
 * - empty：无信封
 * - uniform：全部同一非空主体
 * - unknown：全部未识别（不算混合）
 * - mixed：其余（含「已识别 + 未识别」）
 * counts 按数量降序；未识别桶的 name 取第一条有原文的信封。
 */
export const summarizeBatchTitles = (envelopes: BatchTitleEnvelope[]): BatchTitleSummary => {
  if (envelopes.length === 0) return { kind: "empty", entityId: null, counts: [] };

  const buckets = envelopes.reduce<Map<string, BatchTitleCount>>((map, envelope) => {
    const entityId = envelope.invoice_title_entity_id ?? null;
    const key = entityId === null ? "none" : String(entityId);
    const existing = map.get(key);
    const next: BatchTitleCount = existing
      ? {
          ...existing,
          count: existing.count + 1,
          name: existing.name ?? envelope.invoice_title_name ?? null
        }
      : { entity_id: entityId, name: envelope.invoice_title_name ?? null, count: 1 };
    return new Map(map).set(key, next);
  }, new Map());

  const counts = [...buckets.values()].sort((a, b) => b.count - a.count);
  if (counts.length === 1) {
    const only = counts[0];
    return only.entity_id === null
      ? { kind: "unknown", entityId: null, counts }
      : { kind: "uniform", entityId: only.entity_id, counts };
  }
  return { kind: "mixed", entityId: null, counts };
};

/** 去空白后 2–200 字有效，返回裁剪后的理由；否则 null */
export const validateMixedTitleReason = (reason: unknown): string | null => {
  if (typeof reason !== "string") return null;
  const trimmed = reason.trim();
  if (trimmed.length < MIXED_TITLE_REASON_MIN_LENGTH) return null;
  if (trimmed.length > MIXED_TITLE_REASON_MAX_LENGTH) return null;
  return trimmed;
};
```

- [ ] **Step 4: 运行确认通过**

```bash
cd $W/packages/api && npx vitest run src/routes/reimbursement-batch-title-policy.test.ts
```

Expected: `Tests 7 passed`。

- [ ] **Step 5: 提交**

```bash
cd $W && git add packages/api/src/routes/reimbursement-batch-title-policy.ts packages/api/src/routes/reimbursement-batch-title-policy.test.ts && git commit -m "feat(api): 批次发票抬头汇总与混批理由校验策略"
```

---

### Task 5: OCR 同步写入抬头（独立小模块 + 接线）

**Files:**
- Create: `packages/api/src/routes/reimbursement-invoice-title-sync.ts`
- Test: `packages/api/src/routes/reimbursement-invoice-title-sync.test.ts`
- Modify: `packages/api/src/routes/reimbursement.ts`（`syncEnvelopeAuditState`，约 970–1300 行）

- [ ] **Step 1: 写失败的测试（假 D1 捕获 SQL）**

```ts
import { describe, expect, it } from "vitest";

import { syncEnvelopeInvoiceTitle } from "./reimbursement-invoice-title-sync";

type Executed = { sql: string; params: unknown[] };

class FakeStatement {
  private params: unknown[] = [];
  constructor(
    private readonly db: FakeDb,
    private readonly sql: string
  ) {}
  bind(...params: unknown[]) {
    this.params = params;
    return this;
  }
  async all<T>(): Promise<{ results: T[] }> {
    this.db.executed.push({ sql: this.sql, params: this.params });
    return { results: this.db.entities as T[] };
  }
  async run() {
    this.db.executed.push({ sql: this.sql, params: this.params });
    return { meta: { changes: 1, last_row_id: 0 } };
  }
}

class FakeDb {
  executed: Executed[] = [];
  entities: Array<{ id: number; entity_name: string; status: string }> = [
    { id: 11, entity_name: "北京鑫丰畅建设有限公司", status: "active" }
  ];
  prepare(sql: string) {
    return new FakeStatement(this, sql);
  }
}

const asD1 = (db: FakeDb) => db as unknown as D1Database;

describe("syncEnvelopeInvoiceTitle", () => {
  it("有抬头且未手工指定：查主体并写入三列，带 manual 守卫", async () => {
    const db = new FakeDb();
    const update = await syncEnvelopeInvoiceTitle(asD1(db), {
      envelopeId: 237,
      currentSource: null,
      buyerName: "北京鑫丰畅建设有限公司",
      pendingCount: 0
    });
    expect(update).toEqual({ entityId: 11, name: "北京鑫丰畅建设有限公司", source: "ocr" });
    const write = db.executed.find((item) => item.sql.includes("UPDATE reimbursement_envelope"));
    expect(write?.sql).toContain("invoice_title_entity_id = ?");
    expect(write?.sql).toContain("!= 'manual'");
    expect(write?.params).toEqual([11, "北京鑫丰畅建设有限公司", "ocr", 237]);
  });

  it("手工指定过：不查主体、不写库", async () => {
    const db = new FakeDb();
    const update = await syncEnvelopeInvoiceTitle(asD1(db), {
      envelopeId: 237,
      currentSource: "manual",
      buyerName: "北京鑫丰畅建设有限公司",
      pendingCount: 0
    });
    expect(update).toBeNull();
    expect(db.executed).toHaveLength(0);
  });

  it("识别仍在进行：不写库", async () => {
    const db = new FakeDb();
    await syncEnvelopeInvoiceTitle(asD1(db), {
      envelopeId: 237,
      currentSource: "ocr",
      buyerName: null,
      pendingCount: 1
    });
    expect(db.executed).toHaveLength(0);
  });

  it("全部完成且无抬头：清空三列（不查主体）", async () => {
    const db = new FakeDb();
    const update = await syncEnvelopeInvoiceTitle(asD1(db), {
      envelopeId: 237,
      currentSource: "ocr",
      buyerName: null,
      pendingCount: 0
    });
    expect(update).toEqual({ entityId: null, name: null, source: null });
    expect(db.executed).toHaveLength(1);
    expect(db.executed[0].params).toEqual([null, null, null, 237]);
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
cd $W/packages/api && npx vitest run src/routes/reimbursement-invoice-title-sync.test.ts
```

Expected: FAIL，找不到模块。

- [ ] **Step 3: 实现模块**

```ts
import {
  matchInvoiceTitleEntity,
  resolveOcrTitleUpdate,
  type InvoiceTitleEntityCandidate,
  type OcrTitleUpdate
} from "./reimbursement-invoice-title-policy";

export type SyncEnvelopeInvoiceTitleInput = {
  envelopeId: number;
  currentSource: string | null;
  buyerName: string | null;
  pendingCount: number;
};

const loadActiveEntities = async (db: D1Database): Promise<InvoiceTitleEntityCandidate[]> => {
  const rows = await db
    .prepare("SELECT id, entity_name, status FROM entity WHERE status = 'active'")
    .all<InvoiceTitleEntityCandidate>();
  return rows.results ?? [];
};

/**
 * OCR 同步阶段写抬头。手工指定过 / 识别未完成时不写；
 * UPDATE 自带 `!= 'manual'` 守卫，防止装载后办公室刚好手工指定的竞态。
 * 返回实际决定（便于调用方记录/测试）。
 */
export const syncEnvelopeInvoiceTitle = async (
  db: D1Database,
  input: SyncEnvelopeInvoiceTitleInput
): Promise<OcrTitleUpdate | null> => {
  if (input.currentSource === "manual") return null;
  if (input.pendingCount > 0) return null;

  const match = input.buyerName
    ? matchInvoiceTitleEntity(input.buyerName, await loadActiveEntities(db))
    : { entityId: null, name: null };
  const update = resolveOcrTitleUpdate(
    { invoice_title_source: input.currentSource },
    { buyerName: input.buyerName, pendingCount: input.pendingCount },
    match
  );
  if (!update) return null;

  await db
    .prepare(
      `UPDATE reimbursement_envelope
          SET invoice_title_entity_id = ?, invoice_title_name = ?, invoice_title_source = ?
        WHERE id = ? AND COALESCE(invoice_title_source, '') != 'manual'`
    )
    .bind(update.entityId, update.name, update.source, input.envelopeId)
    .run();
  return update;
};
```

- [ ] **Step 4: 运行确认通过**

```bash
cd $W/packages/api && npx vitest run src/routes/reimbursement-invoice-title-sync.test.ts
```

Expected: `Tests 4 passed`。

- [ ] **Step 5: 接线到 `syncEnvelopeAuditState`（识别表路径）**

在 `packages/api/src/routes/reimbursement.ts` 顶部 import 区追加：

```ts
import {
  pickBuyerNameFromReviews,
  readInvoiceExtractionText
} from "./reimbursement-invoice-title-policy";
import { syncEnvelopeInvoiceTitle } from "./reimbursement-invoice-title-sync";
```

找到锚点（约 1108 行）：

```ts
    const hints = {
      invoice_unique_no: bestRow?.invoice_unique_no ?? null,
```

在 `result_json: JSON.stringify({ ... extracted_invoices: completedRows.map((row) => ({` 的对象里，`risk_hint: row.risk_hint` 之后追加两个字段：

```ts
          risk_hint: row.risk_hint,
          buyer_name: readInvoiceExtractionText(row.extraction_json, "buyer_name"),
          seller_name: readInvoiceExtractionText(row.extraction_json, "seller_name")
```

找到该路径末尾的 `.run();`（紧跟 `nowIso(), envelopeId ) .run();` 的那一次，即写 `ocr_status = ?` 的 UPDATE 之后、`if (!hasReviewRows && envelope.ocr_task_id) {` 之前），插入：

```ts
    await syncEnvelopeInvoiceTitle(env.DB, {
      envelopeId,
      currentSource: envelope.invoice_title_source ?? null,
      buyerName: pickBuyerNameFromReviews(completedRows, bestRow ?? null),
      pendingCount
    });
```

- [ ] **Step 6: 接线到单任务回退路径**

锚点（约 1210 行）：

```ts
      await applyDuplicateChecks(env, envelopeId, hints);
    }
```

这是 `if (ocrTask?.status === "completed" && envelope.ocr_status !== "completed") { ... }` 块的结尾；在 `await applyDuplicateChecks(env, envelopeId, hints);` 之后、块结束 `}` 之前插入：

```ts
      const fallbackBuyerName =
        typeof ocrResult?.buyer_name === "string" && ocrResult.buyer_name.trim()
          ? ocrResult.buyer_name.trim()
          : null;
      if (fallbackBuyerName) {
        await syncEnvelopeInvoiceTitle(env.DB, {
          envelopeId,
          currentSource: envelope.invoice_title_source ?? null,
          buyerName: fallbackBuyerName,
          pendingCount: 0
        });
      }
```

- [ ] **Step 7: typecheck + 全量 api 单测 + 提交**

```bash
cd $W/packages/api && npm run typecheck && npx vitest run
cd $W && git add packages/api/src/routes/reimbursement-invoice-title-sync.ts packages/api/src/routes/reimbursement-invoice-title-sync.test.ts packages/api/src/routes/reimbursement.ts && git commit -m "feat(api): OCR 同步时按购买方名称预填信封发票抬头"
```

Expected: typecheck 通过；vitest 全部通过（原有测试不受影响）。

---

### Task 6: 办公室手工指定抬头（PUT /:id）+ 拆单继承

**Files:**
- Modify: `packages/api/src/routes/reimbursement.ts`（`PUT /:id` 约 4700–4790 行；`POST /:id/split` 的 INSERT 约 5460 行）
- Test: `packages/api/src/routes/reimbursement-invoice-title-routes.test.ts`（本任务新建，Task 7/8 继续追加用例）

- [ ] **Step 1: 写失败的路由测试**

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

type Row = Record<string, unknown>;
type Executed = { sql: string; params: unknown[] };

class FakeStatement {
  private params: unknown[] = [];
  constructor(
    private readonly db: FakeDb,
    private readonly sql: string
  ) {}
  bind(...params: unknown[]) {
    this.params = params;
    return this;
  }
  async first<T>(): Promise<T | null> {
    this.db.executed.push({ sql: this.sql, params: this.params });
    return (this.db.firstHandler(this.sql, this.params) as T | null) ?? null;
  }
  async all<T>(): Promise<{ results: T[] }> {
    this.db.executed.push({ sql: this.sql, params: this.params });
    return { results: this.db.allHandler(this.sql, this.params) as T[] };
  }
  async run() {
    this.db.executed.push({ sql: this.sql, params: this.params });
    return { meta: { changes: 1, last_row_id: 1 } };
  }
}

export class FakeDb {
  executed: Executed[] = [];
  firstHandler: (sql: string, params: unknown[]) => Row | null = () => null;
  allHandler: (sql: string, params: unknown[]) => Row[] = () => [];
  prepare(sql: string) {
    return new FakeStatement(this, sql);
  }
  async batch(statements: FakeStatement[]) {
    return statements.map(() => ({ meta: { changes: 1, last_row_id: 1 } }));
  }
}

const createEnv = (db: FakeDb) =>
  ({
    DB: db,
    KV: {
      async get() {
        return "session";
      }
    }
  }) as unknown as Env;

const request = (
  db: FakeDb,
  path: string,
  init?: { method?: string; body?: string }
) => {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/reimbursement", reimbursementRoutes);
  return app.request(
    path,
    {
      method: init?.method ?? "GET",
      body: init?.body,
      headers: {
        authorization: "Bearer test-token",
        "content-type": "application/json"
      }
    },
    createEnv(db)
  );
};

const envelopeRow = (overrides: Row = {}): Row => ({
  id: 5,
  envelope_no: "e-5",
  envelope_uuid: "e-5",
  project_id: 144,
  applicant_userid: "LuShuMing",
  channel: "electronic",
  status: "received",
  precheck_status: "approved",
  batch_id: null,
  approval_instance_id: null,
  invoice_title_entity_id: null,
  invoice_title_name: null,
  invoice_title_source: null,
  ...overrides
});

describe("PUT /reimbursement/:id invoice_title_entity_id", () => {
  beforeEach(() => {
    mockAuthState.payload = { ...mockAuthState.payload, sub: "finance-a", roles: ["finance"] };
  });

  it("办公室角色指定主体：写三列（来源 manual）并记审计", async () => {
    const db = new FakeDb();
    db.firstHandler = (sql) => {
      if (sql.includes("FROM reimbursement_envelope WHERE id = ?")) return envelopeRow();
      if (sql.includes("FROM entity WHERE id = ?")) {
        return { id: 11, entity_name: "北京鑫丰畅建设有限公司" };
      }
      return null;
    };
    const response = await request(db, "/reimbursement/5", {
      method: "PUT",
      body: JSON.stringify({ invoice_title_entity_id: 11 })
    });
    expect(response.status).toBe(200);
    const titleWrite = db.executed.find((item) => item.sql.includes("invoice_title_source = ?"));
    expect(titleWrite?.params.slice(0, 3)).toEqual([11, "北京鑫丰畅建设有限公司", "manual"]);
    expect(titleWrite?.params[4]).toBe(5);
    const audit = db.executed.find((item) => item.sql.includes("INSERT INTO api_audit_log"));
    expect(audit?.params).toContain("reimbursement.envelope.set_invoice_title");
  });

  it("传 null 清除三列", async () => {
    const db = new FakeDb();
    db.firstHandler = (sql) =>
      sql.includes("FROM reimbursement_envelope WHERE id = ?")
        ? envelopeRow({ invoice_title_entity_id: 11, invoice_title_source: "manual" })
        : null;
    const response = await request(db, "/reimbursement/5", {
      method: "PUT",
      body: JSON.stringify({ invoice_title_entity_id: null })
    });
    expect(response.status).toBe(200);
    const titleWrite = db.executed.find((item) => item.sql.includes("invoice_title_source = ?"));
    expect(titleWrite?.params.slice(0, 3)).toEqual([null, null, null]);
  });

  it("非 active 主体 → 400", async () => {
    const db = new FakeDb();
    db.firstHandler = (sql) =>
      sql.includes("FROM reimbursement_envelope WHERE id = ?") ? envelopeRow() : null;
    const response = await request(db, "/reimbursement/5", {
      method: "PUT",
      body: JSON.stringify({ invoice_title_entity_id: 999 })
    });
    expect(response.status).toBe(400);
  });

  it("申请人本人（operator）不能指定抬头 → 403", async () => {
    mockAuthState.payload = { ...mockAuthState.payload, sub: "LuShuMing", roles: ["operator"] };
    const db = new FakeDb();
    db.firstHandler = (sql) =>
      sql.includes("FROM reimbursement_envelope WHERE id = ?")
        ? envelopeRow({ status: "submitted" })
        : null;
    const response = await request(db, "/reimbursement/5", {
      method: "PUT",
      body: JSON.stringify({ invoice_title_entity_id: 11 })
    });
    expect(response.status).toBe(403);
    expect(db.executed.some((item) => item.sql.includes("invoice_title_source = ?"))).toBe(false);
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
cd $W/packages/api && npx vitest run src/routes/reimbursement-invoice-title-routes.test.ts
```

Expected: FAIL（前两个用例找不到 `invoice_title_source = ?` 语句，第三个返回 200 而非 400，第四个返回 200 而非 403）。

- [ ] **Step 3: 修改 `PUT /:id`**

锚点（约 4745 行）：

```ts
    if (body.channel && body.channel !== existing.channel) {
      return c.json(
        {
          success: false,
          error: { message: "Envelope channel cannot be changed after creation" }
        },
        400
      );
    }
```

在其后插入：

```ts
    const hasInvoiceTitleField = Object.prototype.hasOwnProperty.call(
      body,
      "invoice_title_entity_id"
    );
    let invoiceTitleEntity: { id: number; entity_name: string } | null = null;
    if (hasInvoiceTitleField) {
      if (!isPrivileged) {
        return c.json(
          { success: false, error: { message: "Only office roles can set invoice title" } },
          403
        );
      }
      const rawTitleEntityId = body.invoice_title_entity_id;
      if (rawTitleEntityId !== null) {
        if (!Number.isInteger(rawTitleEntityId) || (rawTitleEntityId as number) <= 0) {
          return c.json(
            {
              success: false,
              error: { message: "invoice_title_entity_id must be a positive integer or null" }
            },
            400
          );
        }
        invoiceTitleEntity = await c.env.DB.prepare(
          "SELECT id, entity_name FROM entity WHERE id = ? AND status = 'active'"
        )
          .bind(rawTitleEntityId)
          .first<{ id: number; entity_name: string }>();
        if (!invoiceTitleEntity) {
          return c.json(
            { success: false, error: { message: "invoice title entity not found or inactive" } },
            400
          );
        }
      }
    }
```

锚点（主 UPDATE 之后，约 4780 行）：

```ts
    if (body.attachments && body.attachments.length > 0) {
      await insertAttachments(c.env.DB, id, body.attachments);
```

在这个 `if` 之前插入：

```ts
    if (hasInvoiceTitleField) {
      const nextTitle = {
        entity_id: invoiceTitleEntity?.id ?? null,
        name: invoiceTitleEntity?.entity_name ?? null,
        source: invoiceTitleEntity ? "manual" : null
      };
      await c.env.DB.prepare(
        `UPDATE reimbursement_envelope
            SET invoice_title_entity_id = ?, invoice_title_name = ?, invoice_title_source = ?,
                updated_at = ?
          WHERE id = ?`
      )
        .bind(nextTitle.entity_id, nextTitle.name, nextTitle.source, nowIso(), id)
        .run();
      const previousTitle = {
        entity_id: existing.invoice_title_entity_id ?? null,
        name: existing.invoice_title_name ?? null,
        source: existing.invoice_title_source ?? null
      };
      if (
        previousTitle.entity_id !== nextTitle.entity_id ||
        previousTitle.source !== nextTitle.source
      ) {
        await writeAuditLog(c.env.DB, {
          actorUserId: auth.sub,
          actorRoles: auth.roles,
          action: "reimbursement.envelope.set_invoice_title",
          targetType: "reimbursement_envelope",
          targetId: id,
          detail: { before: previousTitle, after: nextTitle }
        });
      }
    }
```

- [ ] **Step 4: 拆单继承父信封抬头**

锚点（约 5460 行，`POST /:id/split` 内）：

```ts
            `INSERT INTO reimbursement_envelope
               (envelope_no, envelope_uuid, project_id, applicant_userid, channel,
                expense_date, amount, category, description,
                status, precheck_status, verification_status, verification_note,
                split_from_envelope_id, split_reason,
                submitted_at, received_at, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'none', ?, ?, ?, ?, ?, ?, ?, ?)`
```

改为：

```ts
            `INSERT INTO reimbursement_envelope
               (envelope_no, envelope_uuid, project_id, applicant_userid, channel,
                expense_date, amount, category, description,
                status, precheck_status, verification_status, verification_note,
                split_from_envelope_id, split_reason,
                invoice_title_entity_id, invoice_title_name, invoice_title_source,
                submitted_at, received_at, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'none', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
```

对应 `.bind(` 中，在 `body.reason ?? null,` 之后、`envelope.submitted_at,` 之前插入：

```ts
              envelope.invoice_title_entity_id ?? null,
              envelope.invoice_title_name ?? null,
              envelope.invoice_title_source ?? null,
```

- [ ] **Step 5: 运行测试、typecheck、提交**

```bash
cd $W/packages/api && npx vitest run src/routes/reimbursement-invoice-title-routes.test.ts && npm run typecheck
cd $W && git add packages/api/src/routes/reimbursement.ts packages/api/src/routes/reimbursement-invoice-title-routes.test.ts && git commit -m "feat(api): 办公室可手工指定信封发票抬头，拆单继承抬头"
```

Expected: `Tests 4 passed`；typecheck 通过。

---

### Task 7: 候选按抬头过滤 + 建议分组按抬头拆

**Files:**
- Modify: `packages/api/src/routes/reimbursement-batch-proposal-policy.ts`
- Modify: `packages/api/src/routes/reimbursement-batch-proposal-policy.test.ts`
- Modify: `packages/api/src/routes/reimbursement.ts`（`GET /batch/candidates` 约 1633 行；`GET /batch/proposals` 约 1667 行）
- Modify: `packages/api/src/routes/reimbursement-invoice-title-routes.test.ts`（追加候选过滤用例）

- [ ] **Step 1: 建议分组策略测试（追加到 `reimbursement-batch-proposal-policy.test.ts` 的 `describe("groupBatchProposals")` 内）**

```ts
  it("同人同项目不同抬头拆成不同组，组内带抬头 id", () => {
    const groups = groupBatchProposals([
      { id: 1, project_id: 144, applicant_userid: "lu", amount: 1348, invoice_title_entity_id: 11 },
      { id: 2, project_id: 144, applicant_userid: "lu", amount: 18, invoice_title_entity_id: 6 },
      { id: 3, project_id: 144, applicant_userid: "lu", amount: 31.5, invoice_title_entity_id: null },
      { id: 4, project_id: 144, applicant_userid: "lu", amount: 212, invoice_title_entity_id: 11 }
    ]);
    expect(groups.map((g) => [g.invoice_title_entity_id, g.envelope_ids])).toEqual([
      [6, [2]],
      [11, [1, 4]],
      [null, [3]]
    ]);
  });

  it("未传抬头字段时视为未识别，仍按人+项目分组", () => {
    const groups = groupBatchProposals([
      { id: 1, project_id: 10, applicant_userid: "zhang", amount: 1 },
      { id: 2, project_id: 10, applicant_userid: "zhang", amount: 1 }
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].invoice_title_entity_id).toBeNull();
  });
```

- [ ] **Step 2: 运行确认失败**

```bash
cd $W/packages/api && npx vitest run src/routes/reimbursement-batch-proposal-policy.test.ts
```

Expected: FAIL（`invoice_title_entity_id` 为 undefined / 分组数不符）。

- [ ] **Step 3: 改策略模块（整段替换 `groupBatchProposals` 及其类型）**

```ts
export type ProposalEnvelopeInput = {
  id: number;
  project_id: number;
  applicant_userid: string;
  amount: number;
  invoice_title_entity_id?: number | null;
};

export type BatchProposalGroup = {
  project_id: number;
  applicant_userid: string;
  invoice_title_entity_id: number | null;
  envelope_ids: number[];
  item_count: number;
  total_amount: number;
};

export const groupBatchProposals = (
  envelopes: ProposalEnvelopeInput[]
): BatchProposalGroup[] => {
  const groups = new Map<string, BatchProposalGroup>();
  for (const envelope of envelopes) {
    const titleEntityId = envelope.invoice_title_entity_id ?? null;
    const key = `${envelope.applicant_userid} ${envelope.project_id} ${titleEntityId ?? "none"}`;
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
        invoice_title_entity_id: titleEntityId,
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
    if (a.project_id !== b.project_id) {
      return a.project_id - b.project_id;
    }
    // 未识别抬头排最后，其余按主体 id 升序
    if (a.invoice_title_entity_id === null) return b.invoice_title_entity_id === null ? 0 : 1;
    if (b.invoice_title_entity_id === null) return -1;
    return a.invoice_title_entity_id - b.invoice_title_entity_id;
  });
};
```

（`matchUniqueInternalPayee` 及其类型保持不变。）

- [ ] **Step 4: 运行确认通过**

```bash
cd $W/packages/api && npx vitest run src/routes/reimbursement-batch-proposal-policy.test.ts
```

Expected: `Tests 8 passed`。

- [ ] **Step 5: 候选路由测试（追加到 `reimbursement-invoice-title-routes.test.ts` 末尾）**

```ts
describe("GET /reimbursement/batch/candidates invoice_title_entity_id", () => {
  beforeEach(() => {
    mockAuthState.payload = { ...mockAuthState.payload, sub: "finance-a", roles: ["finance"] };
  });

  const candidatesSql = (db: FakeDb) =>
    db.executed.find((item) => item.sql.includes("FROM reimbursement_envelope") && item.sql.includes("batch_id IS NULL"));

  it("none → IS NULL", async () => {
    const db = new FakeDb();
    const response = await request(
      db,
      "/reimbursement/batch/candidates?project_id=144&applicant_userid=LuShuMing&invoice_title_entity_id=none"
    );
    expect(response.status).toBe(200);
    expect(candidatesSql(db)?.sql).toContain("invoice_title_entity_id IS NULL");
  });

  it("数字 → = ? 且绑定该 id", async () => {
    const db = new FakeDb();
    const response = await request(
      db,
      "/reimbursement/batch/candidates?project_id=144&applicant_userid=LuShuMing&invoice_title_entity_id=11"
    );
    expect(response.status).toBe(200);
    const executed = candidatesSql(db);
    expect(executed?.sql).toContain("invoice_title_entity_id = ?");
    expect(executed?.params).toEqual([144, "LuShuMing", 11]);
  });

  it("缺省 → 不加过滤", async () => {
    const db = new FakeDb();
    await request(db, "/reimbursement/batch/candidates?project_id=144&applicant_userid=LuShuMing");
    expect(candidatesSql(db)?.sql).not.toContain("invoice_title_entity_id");
  });

  it("非法值 → 400", async () => {
    const db = new FakeDb();
    const response = await request(
      db,
      "/reimbursement/batch/candidates?project_id=144&applicant_userid=LuShuMing&invoice_title_entity_id=abc"
    );
    expect(response.status).toBe(400);
  });
});
```

- [ ] **Step 6: 运行确认失败**

```bash
cd $W/packages/api && npx vitest run src/routes/reimbursement-invoice-title-routes.test.ts
```

Expected: 新增 4 个用例中 3 个 FAIL（none/数字/非法值），缺省用例通过。

- [ ] **Step 7: 改 `GET /batch/candidates`（整段替换 handler 内 `const rows = ...` 之前到查询）**

锚点：

```ts
    if (!applicantUserid) {
      return c.json({ success: false, error: { message: "applicant_userid is required" } }, 400);
    }

    const rows = await c.env.DB.prepare(
      `SELECT *
         FROM reimbursement_envelope
        WHERE status = 'received'
          AND precheck_status = 'approved'
          AND batch_id IS NULL
          AND project_id = ?
          AND applicant_userid = ?
        ORDER BY updated_at DESC, id DESC`
    )
      .bind(projectId, applicantUserid)
      .all<ReimbursementEnvelope>();
```

替换为：

```ts
    if (!applicantUserid) {
      return c.json({ success: false, error: { message: "applicant_userid is required" } }, 400);
    }

    // 发票抬头过滤：正整数 = 该主体；none = 未识别；缺省不过滤
    const titleFilterRaw = c.req.query("invoice_title_entity_id")?.trim() ?? "";
    let titleClause = "";
    const titleParams: number[] = [];
    if (titleFilterRaw === "none") {
      titleClause = " AND invoice_title_entity_id IS NULL";
    } else if (titleFilterRaw) {
      const titleEntityId = Number(titleFilterRaw);
      if (!Number.isInteger(titleEntityId) || titleEntityId <= 0) {
        return c.json(
          {
            success: false,
            error: { message: "invoice_title_entity_id must be a positive integer or 'none'" }
          },
          400
        );
      }
      titleClause = " AND invoice_title_entity_id = ?";
      titleParams.push(titleEntityId);
    }

    const rows = await c.env.DB.prepare(
      `SELECT *
         FROM reimbursement_envelope
        WHERE status = 'received'
          AND precheck_status = 'approved'
          AND batch_id IS NULL
          AND project_id = ?
          AND applicant_userid = ?${titleClause}
        ORDER BY updated_at DESC, id DESC`
    )
      .bind(projectId, applicantUserid, ...titleParams)
      .all<ReimbursementEnvelope>();
```

- [ ] **Step 8: 改 `GET /batch/proposals`**

SELECT 列表锚点：

```ts
      `SELECT
         e.id, e.envelope_no, e.project_id, e.applicant_userid, e.amount,
         e.description, e.channel,
```

改为：

```ts
      `SELECT
         e.id, e.envelope_no, e.project_id, e.applicant_userid, e.amount,
         e.description, e.channel, e.invoice_title_entity_id, e.invoice_title_name,
```

`.all<{ ... duplicate_risk_level: "high" | "medium" | "low" | null; }>()` 的泛型对象里追加：

```ts
      invoice_title_entity_id: number | null;
      invoice_title_name: string | null;
```

`const proposals = groups.map((group) => {` 内返回对象：在 `applicant_userid: group.applicant_userid,` 之后追加：

```ts
        invoice_title_entity_id: group.invoice_title_entity_id,
        invoice_title_name:
          group.envelope_ids
            .map((envelopeId) => envelopeById.get(envelopeId)?.invoice_title_name ?? null)
            .find((name) => Boolean(name)) ?? null,
```

`envelopes: group.envelope_ids.map((envelopeId) => { ... return { ... duplicate_risk_level: row?.duplicate_risk_level ?? null` 之后追加：

```ts
            duplicate_risk_level: row?.duplicate_risk_level ?? null,
            invoice_title_entity_id: row?.invoice_title_entity_id ?? null,
            invoice_title_name: row?.invoice_title_name ?? null
```

- [ ] **Step 9: 运行、typecheck、提交**

```bash
cd $W/packages/api && npx vitest run src/routes/reimbursement-invoice-title-routes.test.ts src/routes/reimbursement-batch-proposal-policy.test.ts && npm run typecheck
cd $W && git add packages/api/src/routes/reimbursement-batch-proposal-policy.ts packages/api/src/routes/reimbursement-batch-proposal-policy.test.ts packages/api/src/routes/reimbursement.ts packages/api/src/routes/reimbursement-invoice-title-routes.test.ts && git commit -m "feat(api): 成批候选按发票抬头过滤，建议分组按抬头拆分"
```

Expected: 两个测试文件全部通过；typecheck 通过。

---

### Task 8: 创建批次软约束 + 批次抬头落库 + 详情/冻结上下文

**Files:**
- Modify: `packages/api/src/routes/reimbursement.ts`（`POST /batch` 约 2040–2364；`POST /batch/:id/submit-approval` 约 2668–2735；`GET /batch/:id` 约 1929、2030）
- Modify: `packages/api/src/routes/reimbursement-invoice-title-routes.test.ts`（追加混批 400 用例）

- [ ] **Step 1: 混批 400 路由测试（追加到测试文件末尾）**

```ts
describe("POST /reimbursement/batch 混抬头软约束", () => {
  beforeEach(() => {
    mockAuthState.payload = { ...mockAuthState.payload, sub: "finance-a", roles: ["finance"] };
  });

  const mixedEnvelopes = [
    envelopeRow({ id: 237, amount: 1348, invoice_title_entity_id: 11, invoice_title_name: "北京鑫丰畅建设有限公司" }),
    envelopeRow({ id: 241, amount: 18, invoice_title_entity_id: 6, invoice_title_name: "廊坊市丰畅市政工程有限公司" })
  ];

  it("抬头不一致且无理由 → 400 MIXED_INVOICE_TITLE，附各抬头计数，且未写库", async () => {
    const db = new FakeDb();
    db.allHandler = (sql) => (sql.includes("FROM reimbursement_envelope") ? mixedEnvelopes : []);
    const response = await request(db, "/reimbursement/batch", {
      method: "POST",
      body: JSON.stringify({ project_id: 144, applicant_userid: "LuShuMing", envelope_ids: [237, 241] })
    });
    expect(response.status).toBe(400);
    const payload = (await response.json()) as {
      error: { code: string; title_counts: Array<{ entity_id: number | null; count: number }> };
    };
    expect(payload.error.code).toBe("MIXED_INVOICE_TITLE");
    expect(payload.error.title_counts).toHaveLength(2);
    expect(db.executed.some((item) => item.sql.includes("INSERT INTO reimbursement_batch"))).toBe(false);
  });

  it("理由过短同样 400", async () => {
    const db = new FakeDb();
    db.allHandler = (sql) => (sql.includes("FROM reimbursement_envelope") ? mixedEnvelopes : []);
    const response = await request(db, "/reimbursement/batch", {
      method: "POST",
      body: JSON.stringify({
        project_id: 144,
        applicant_userid: "LuShuMing",
        envelope_ids: [237, 241],
        mixed_title_reason: "急"
      })
    });
    expect(response.status).toBe(400);
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
cd $W/packages/api && npx vitest run src/routes/reimbursement-invoice-title-routes.test.ts
```

Expected: 两个新用例 FAIL（当前会继续走到幂等/建批逻辑，状态码不是 400 或 code 不符）。

- [ ] **Step 3: `POST /batch` 加软约束**

顶部 import 追加：

```ts
import {
  summarizeBatchTitles,
  validateMixedTitleReason
} from "./reimbursement-batch-title-policy";
```

锚点（`selected.length === 0` 的 400 返回之后、`if (typeof body.payee_id === "number" && body.payee_id > 0) {` 之前）插入：

```ts
    // 发票抬头软约束：混抬头必须带理由；全部未识别不算混合
    const titleSummary = summarizeBatchTitles(selected);
    const mixedTitleReason = validateMixedTitleReason(body.mixed_title_reason);
    if (titleSummary.kind === "mixed" && !mixedTitleReason) {
      return c.json(
        {
          success: false,
          error: {
            code: "MIXED_INVOICE_TITLE",
            message: "所选报销条目发票抬头不一致，需填写混批理由（2–200 字）",
            title_counts: titleSummary.counts
          }
        },
        400
      );
    }
    const batchTitleEntityId = titleSummary.kind === "uniform" ? titleSummary.entityId : null;
    const batchMixedTitleReason = titleSummary.kind === "mixed" ? mixedTitleReason : null;
```

INSERT 锚点：

```ts
        `INSERT INTO reimbursement_batch
          (batch_no, project_id, applicant_userid, total_amount, item_count, status, ai_audit_status,
           payment_method, payment_entity_id, payment_entity_bank_account_id, payment_account,
           payee_id,
           created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'draft', 'none', ?, ?, ?, ?, ?, ?, ?)`
```

改为：

```ts
        `INSERT INTO reimbursement_batch
          (batch_no, project_id, applicant_userid, total_amount, item_count, status, ai_audit_status,
           payment_method, payment_entity_id, payment_entity_bank_account_id, payment_account,
           payee_id, invoice_title_entity_id, mixed_title_reason,
           created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'draft', 'none', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
```

对应 `.bind(` 中 `body.payee_id ?? null,` 之后插入：

```ts
          batchTitleEntityId,
          batchMixedTitleReason,
```

`publishEvent(c.env, "REIMBURSEMENT_BATCH_CREATED", ...)` 的 payload 末尾追加：

```ts
      payment_entity_bank_account_id: payoutPlan.value.payment_entity_bank_account_id,
      invoice_title_entity_id: batchTitleEntityId
```

`writeAuditLog(... action: "reimbursement.batch.create" ...)` 的 `detail` 末尾追加：

```ts
        payment_entity_bank_account_id: payoutPlan.value.payment_entity_bank_account_id,
        invoice_title: {
          kind: titleSummary.kind,
          entity_id: batchTitleEntityId,
          counts: titleSummary.counts,
          mixed_title_reason: batchMixedTitleReason
        }
```

- [ ] **Step 4: `POST /batch/:id/submit-approval` 冻结上下文带抬头**

锚点：

```ts
    const batchItems = await c.env.DB.prepare(
      `SELECT e.id, e.envelope_no, e.invoice_no, e.amount, e.category, e.description
       FROM reimbursement_batch_item bi
```

改为：

```ts
    const batchItems = await c.env.DB.prepare(
      `SELECT e.id, e.envelope_no, e.invoice_no, e.amount, e.category, e.description,
              e.invoice_title_entity_id, e.invoice_title_name
       FROM reimbursement_batch_item bi
```

其 `.all<Pick<ReimbursementEnvelope, "id" | "envelope_no" | "invoice_no" | "amount" | "category" | "description">>()` 改为：

```ts
      .all<
        Pick<
          ReimbursementEnvelope,
          | "id"
          | "envelope_no"
          | "invoice_no"
          | "amount"
          | "category"
          | "description"
          | "invoice_title_entity_id"
          | "invoice_title_name"
        >
      >();
```

`context.batch` 对象在 `payment_account: payoutPlan.value.payment_account` 之后追加：

```ts
              payment_account: payoutPlan.value.payment_account,
              invoice_title_entity_id: batch.invoice_title_entity_id ?? null,
              mixed_title_reason: batch.mixed_title_reason ?? null
```

`items: (batchItems.results ?? []).map(item => ({ ... description: item.description` 之后追加：

```ts
              description: item.description,
              invoice_title_entity_id: item.invoice_title_entity_id ?? null,
              invoice_title_name: item.invoice_title_name ?? null
```

- [ ] **Step 5: `GET /batch/:id` 返回抬头主体**

锚点（`const paymentEntity = batch.payment_entity_id ? ... : null;`）之后插入：

```ts
    const invoiceTitleEntity = batch.invoice_title_entity_id
      ? await c.env.DB.prepare(
          "SELECT id, entity_code, entity_name FROM entity WHERE id = ?"
        )
          .bind(batch.invoice_title_entity_id)
          .first<{ id: number; entity_code: string; entity_name: string }>()
      : null;
```

响应 `data: { ...batch, items: enrichedItems, ... payment_entity: paymentEntity,` 之后追加：

```ts
        payment_entity: paymentEntity,
        invoice_title_entity: invoiceTitleEntity,
```

（条目 `e.*` 已含三列，无需改。）

- [ ] **Step 6: 运行、typecheck、全量单测、提交**

```bash
cd $W/packages/api && npx vitest run && npm run typecheck && npm run lint
cd $W && git add packages/api/src/routes/reimbursement.ts packages/api/src/routes/reimbursement-invoice-title-routes.test.ts && git commit -m "feat(api): 创建批次混抬头需填理由，批次记录抬头主体并冻结进审批上下文"
```

Expected: vitest 全部通过（含 tx-hardening 既有用例）；typecheck、lint 通过。

---

### Task 9: AI 关卡上下文附带抬头

**Files:**
- Modify: `packages/api/src/services/ai-slot.ts`（`if (instance.biz_type === "reimbursement_batch") {` 块，约 231–330 行）

- [ ] **Step 1: 条目查询与映射加字段**

SELECT 锚点：

```ts
      `SELECT e.id, e.envelope_no, e.invoice_no, e.amount, e.category, e.description,
              e.precheck_status, e.precheck_comment, e.silent_review_result, e.ocr_status
         FROM reimbursement_batch_item bi
```

改为：

```ts
      `SELECT e.id, e.envelope_no, e.invoice_no, e.amount, e.category, e.description,
              e.precheck_status, e.precheck_comment, e.silent_review_result, e.ocr_status,
              e.invoice_title_entity_id, e.invoice_title_name
         FROM reimbursement_batch_item bi
```

其 `.all<{ ... ocr_status: string; }>()` 泛型追加：

```ts
        ocr_status: string;
        invoice_title_entity_id: number | null;
        invoice_title_name: string | null;
```

`return { envelope_id: row.id, ... ai_reasonability_summary: silentReviewSummary };` 追加：

```ts
        ai_reasonability_summary: silentReviewSummary,
        invoice_title_entity_id: row.invoice_title_entity_id ?? null,
        invoice_title_name: row.invoice_title_name ?? null
```

- [ ] **Step 2: 批次级抬头**

在 `const itemReviewSummary = ...` 之前插入：

```ts
    const batchTitleRow = await env.DB.prepare(
      "SELECT invoice_title_entity_id, mixed_title_reason FROM reimbursement_batch WHERE id = ?"
    )
      .bind(instance.biz_id)
      .first<{ invoice_title_entity_id: number | null; mixed_title_reason: string | null }>();
```

`context = { ...context, reimbursement_item_reviews: itemReviewSummary, review_focus: "reasonability_summary" };` 改为：

```ts
    context = {
      ...context,
      reimbursement_item_reviews: itemReviewSummary,
      reimbursement_batch_title: {
        invoice_title_entity_id: batchTitleRow?.invoice_title_entity_id ?? null,
        mixed_title_reason: batchTitleRow?.mixed_title_reason ?? null
      },
      review_focus: "reasonability_summary"
    };
```

- [ ] **Step 3: typecheck、相关单测、提交**

```bash
cd $W/packages/api && npm run typecheck && npx vitest run src/services
cd $W && git add packages/api/src/services/ai-slot.ts && git commit -m "feat(ai): 报销批次 AI 关卡上下文附带发票抬头"
```

Expected: 通过（不改提示词，仅数据）。

---

### Task 10: Web 类型、标签与抬头汇总纯函数（+ 单测）

**Files:**
- Modify: `packages/web/src/api/reimbursement.ts`
- Modify: `packages/web/src/views/finance/reimbursement/reimbursement-labels.ts`
- Create: `packages/web/src/views/finance/reimbursement/reimbursement-title.ts`
- Test: `packages/web/src/views/finance/reimbursement/reimbursement-title.test.ts`

- [ ] **Step 1: 写失败的测试**

```ts
import { describe, expect, it } from "vitest";

import {
  describeTitleCounts,
  invoiceTitleDisplay,
  summarizeTitles
} from "./reimbursement-title";

describe("summarizeTitles", () => {
  it("空 → empty", () => {
    expect(summarizeTitles([]).kind).toBe("empty");
  });

  it("同一主体 → uniform", () => {
    const summary = summarizeTitles([
      { invoice_title_entity_id: 11, invoice_title_name: "北京鑫丰畅建设有限公司" },
      { invoice_title_entity_id: 11, invoice_title_name: "北京鑫丰畅建设有限公司" }
    ]);
    expect(summary.kind).toBe("uniform");
    expect(summary.entityId).toBe(11);
  });

  it("全部未识别 → unknown", () => {
    expect(
      summarizeTitles([{ invoice_title_entity_id: null, invoice_title_name: null }]).kind
    ).toBe("unknown");
  });

  it("已识别 + 未识别 → mixed，计数降序", () => {
    const summary = summarizeTitles([
      { invoice_title_entity_id: null, invoice_title_name: "刘相余" },
      { invoice_title_entity_id: 11, invoice_title_name: "北京鑫丰畅建设有限公司" },
      { invoice_title_entity_id: 11, invoice_title_name: "北京鑫丰畅建设有限公司" }
    ]);
    expect(summary.kind).toBe("mixed");
    expect(summary.counts.map(c => c.count)).toEqual([2, 1]);
  });
});

describe("invoiceTitleDisplay", () => {
  it("匹配主体：优先主体名", () => {
    expect(
      invoiceTitleDisplay(
        { invoice_title_entity_id: 11, invoice_title_name: "北京鑫丰畅建设有限公司" },
        "北京鑫丰畅建设有限公司"
      )
    ).toEqual({ text: "北京鑫丰畅建设有限公司", tag: "matched" });
  });

  it("只有原文：未匹配", () => {
    expect(
      invoiceTitleDisplay({ invoice_title_entity_id: null, invoice_title_name: "刘相余" })
    ).toEqual({ text: "刘相余", tag: "unmatched" });
  });

  it("都没有：未识别", () => {
    expect(
      invoiceTitleDisplay({ invoice_title_entity_id: null, invoice_title_name: null })
    ).toEqual({ text: "未识别", tag: "unknown" });
  });
});

describe("describeTitleCounts", () => {
  it("拼成可读的中文摘要", () => {
    const text = describeTitleCounts(
      [
        { entity_id: 11, name: "北京鑫丰畅建设有限公司", count: 2 },
        { entity_id: null, name: "刘相余", count: 1 },
        { entity_id: null, name: null, count: 1 }
      ],
      id => (id === 11 ? "北京鑫丰畅建设有限公司" : undefined)
    );
    expect(text).toBe("北京鑫丰畅建设有限公司 × 2；刘相余（未匹配）× 1；未识别 × 1");
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
cd $W/packages/web && npx vitest run src/views/finance/reimbursement/reimbursement-title.test.ts
```

Expected: FAIL，找不到模块。

- [ ] **Step 3: 实现 `reimbursement-title.ts`（与 API 的 `summarizeBatchTitles` 规则逐字一致）**

```ts
export type TitleFields = {
  invoice_title_entity_id?: number | null;
  invoice_title_name?: string | null;
};

export type TitleSummaryKind = "uniform" | "mixed" | "unknown" | "empty";

export type TitleCount = {
  entity_id: number | null;
  name: string | null;
  count: number;
};

export type TitleSummary = {
  kind: TitleSummaryKind;
  entityId: number | null;
  counts: TitleCount[];
};

/** 与 API reimbursement-batch-title-policy.summarizeBatchTitles 口径一致 */
export const summarizeTitles = (rows: TitleFields[]): TitleSummary => {
  if (rows.length === 0) return { kind: "empty", entityId: null, counts: [] };

  const buckets = rows.reduce<Map<string, TitleCount>>((map, row) => {
    const entityId = row.invoice_title_entity_id ?? null;
    const key = entityId === null ? "none" : String(entityId);
    const existing = map.get(key);
    const next: TitleCount = existing
      ? {
          ...existing,
          count: existing.count + 1,
          name: existing.name ?? row.invoice_title_name ?? null
        }
      : { entity_id: entityId, name: row.invoice_title_name ?? null, count: 1 };
    return new Map(map).set(key, next);
  }, new Map());

  const counts = [...buckets.values()].sort((a, b) => b.count - a.count);
  if (counts.length === 1) {
    const only = counts[0];
    return only.entity_id === null
      ? { kind: "unknown", entityId: null, counts }
      : { kind: "uniform", entityId: only.entity_id, counts };
  }
  return { kind: "mixed", entityId: null, counts };
};

export type TitleDisplay = {
  text: string;
  tag: "matched" | "unmatched" | "unknown";
};

export const invoiceTitleDisplay = (
  row: TitleFields,
  entityName?: string | null
): TitleDisplay => {
  if (row.invoice_title_entity_id) {
    return {
      text:
        entityName ||
        row.invoice_title_name ||
        `主体#${row.invoice_title_entity_id}`,
      tag: "matched"
    };
  }
  if (row.invoice_title_name) {
    return { text: row.invoice_title_name, tag: "unmatched" };
  }
  return { text: "未识别", tag: "unknown" };
};

export const describeTitleCounts = (
  counts: TitleCount[],
  entityName: (id: number) => string | undefined
): string =>
  counts
    .map(item => {
      if (item.entity_id) {
        return `${entityName(item.entity_id) || item.name || `主体#${item.entity_id}`} × ${item.count}`;
      }
      if (item.name) return `${item.name}（未匹配）× ${item.count}`;
      return `未识别 × ${item.count}`;
    })
    .join("；");
```

- [ ] **Step 4: 运行确认通过**

```bash
cd $W/packages/web && npx vitest run src/views/finance/reimbursement/reimbursement-title.test.ts
```

Expected: `Tests 8 passed`。

- [ ] **Step 5: 标签函数（`reimbursement-labels.ts` 在 `reimbursementVerificationStatusLabel` 之后追加）**

```ts
export const invoiceTitleSourceLabel = (v?: string | null): string => {
  const m: Record<string, string> = {
    ocr: "OCR识别",
    manual: "手工指定"
  };
  if (!v) return "未识别";
  return m[v] ?? v;
};
```

- [ ] **Step 6: API 类型（`packages/web/src/api/reimbursement.ts`）**

`ReimbursementEnvelope` 在 `split_reason?: string | null;` 之后追加：

```ts
  invoice_title_entity_id?: number | null;
  invoice_title_name?: string | null;
  invoice_title_source?: "ocr" | "manual" | null;
```

`updateReimbursementEnvelope` 的 `data` 类型在 `status?: string;` 之后追加：

```ts
    /** null = 清除、回到自动识别 */
    invoice_title_entity_id?: number | null;
```

`ReimbursementBatch` 在 `payee_id: number | null;` 之后追加：

```ts
  invoice_title_entity_id?: number | null;
  mixed_title_reason?: string | null;
```

`ReimbursementBatchDetail` 在 `payment_entity?: {...} | null;` 之后追加：

```ts
  invoice_title_entity?: {
    id: number;
    entity_code: string;
    entity_name: string;
  } | null;
```

`listReimbursementBatchCandidates` 参数改为：

```ts
export const listReimbursementBatchCandidates = (params: {
  project_id: number;
  applicant_userid: string;
  invoice_title_entity_id?: number | "none";
}) => {
```

`createReimbursementBatch` 的 `data` 在 `payee_id?: number;` 之后追加：

```ts
    mixed_title_reason?: string;
```

`ReimbursementBatchProposal` 在 `applicant_userid: string;` 之后追加，且 `envelopes` 元素在 `duplicate_risk_level` 之后追加同名两字段：

```ts
  invoice_title_entity_id: number | null;
  invoice_title_name: string | null;
```

- [ ] **Step 7: typecheck、lint、提交**

```bash
cd $W/packages/web && npm run typecheck && npm run lint:eslint
cd $W && git add packages/web/src/api/reimbursement.ts packages/web/src/views/finance/reimbursement/reimbursement-labels.ts packages/web/src/views/finance/reimbursement/reimbursement-title.ts packages/web/src/views/finance/reimbursement/reimbursement-title.test.ts && git commit -m "feat(web): 报销发票抬头类型、标签与汇总纯函数"
```

Expected: typecheck 通过；eslint 无报错（`--fix` 可能自动整理格式，提交前 `git diff --stat` 确认只动了上述文件）。

---

### Task 11: 成批页（batch.vue）筛选、列、预填与混批理由

**Files:**
- Modify: `packages/web/src/views/finance/reimbursement/batch.vue`

无自动化单测（页面逻辑）；汇总规则已在 Task 10 单测覆盖。完成后按 Step 8 冒烟。

- [ ] **Step 1: 引入与状态**

import 区（`from "./reimbursement-labels";` 之后）追加：

```ts
import {
  describeTitleCounts,
  invoiceTitleDisplay,
  summarizeTitles
} from "./reimbursement-title";
```

`const filters = ref({ ... payee_id: undefined as number | undefined });` 内追加一项：

```ts
  payee_id: undefined as number | undefined,
  invoice_title_entity_id: undefined as number | "none" | undefined
```

- [ ] **Step 2: 计算属性与单元格辅助（放在 `selectedCandidateTotal` 之后）**

```ts
const selectedCandidateRows = computed(() =>
  candidates.value.filter(item => candidateSelectedIds.value.includes(item.id))
);

const selectedTitleSummary = computed(() =>
  summarizeTitles(selectedCandidateRows.value)
);

const selectedTitleLabel = computed(() => {
  const summary = selectedTitleSummary.value;
  if (summary.kind === "uniform" && summary.entityId) {
    return entityNameMap.value.get(summary.entityId) ?? `主体#${summary.entityId}`;
  }
  if (summary.kind === "mixed") return "混合抬头";
  if (summary.kind === "unknown") return "未识别";
  return "-";
});

const titleCellFor = (row: ReimbursementEnvelope) =>
  invoiceTitleDisplay(
    row,
    row.invoice_title_entity_id
      ? entityNameMap.value.get(row.invoice_title_entity_id)
      : null
  );
```

- [ ] **Step 3: 候选查询带抬头过滤**

`loadCandidates` 内 `listReimbursementBatchCandidates({ ... })` 改为：

```ts
    const result = await listReimbursementBatchCandidates({
      project_id: filters.value.project_id,
      applicant_userid: filters.value.applicant_userid.trim(),
      invoice_title_entity_id: filters.value.invoice_title_entity_id
    });
```

在文件末尾既有 `watch(() => [filters.value.project_id, filters.value.applicant_userid], ...)` 之后追加：

```ts
watch(
  () => filters.value.invoice_title_entity_id,
  () => {
    loadCandidates();
  }
);
```

- [ ] **Step 4: 「自动勾选可送审」尊重抬头筛选**

整段替换 `autoSelectSubmittable`：

```ts
const matchesTitleFilter = (item: ReimbursementEnvelope) => {
  const titleFilter = filters.value.invoice_title_entity_id;
  if (titleFilter === undefined) return true;
  if (titleFilter === "none") return !item.invoice_title_entity_id;
  return item.invoice_title_entity_id === titleFilter;
};

const autoSelectSubmittable = () => {
  candidateSelectedIds.value = candidates.value
    .filter(
      item =>
        item.status === "received" &&
        item.precheck_status === "approved" &&
        !item.batch_id &&
        matchesTitleFilter(item)
    )
    .map(item => item.id);
  if (
    filters.value.invoice_title_entity_id === undefined &&
    selectedTitleSummary.value.kind === "mixed"
  ) {
    message("已勾选条目发票抬头不一致，建议先按抬头筛选后再成批", {
      type: "warning"
    });
  }
};
```

- [ ] **Step 5: 创建前的混批理由与付款实体预填**

在 `submitCreateAndApproval` 之前新增两个辅助：

```ts
type CreateBatchErrorShape = {
  response?: {
    data?: {
      error?: {
        code?: string;
        title_counts?: Array<{
          entity_id: number | null;
          name: string | null;
          count: number;
        }>;
      };
    };
  };
};

const promptMixedTitleReason = async (
  counts: Array<{ entity_id: number | null; name: string | null; count: number }>
): Promise<string | null> => {
  try {
    const { value } = await ElMessageBox.prompt(
      `所选条目发票抬头不一致：${describeTitleCounts(counts, id => entityNameMap.value.get(id))}。\n按规定应按抬头分批（付款主体须与发票抬头一致）。如确需混批，请填写理由（2–200 字）。`,
      "发票抬头不一致",
      {
        type: "warning",
        confirmButtonText: "仍要混批",
        cancelButtonText: "取消",
        inputPlaceholder: "混批理由",
        inputValidator: (value: string) => {
          const trimmed = value.trim();
          return trimmed.length >= 2 && trimmed.length <= 200
            ? true
            : "理由需 2–200 字";
        }
      }
    );
    return value.trim();
  } catch {
    return null;
  }
};
```

在 `submitCreateAndApproval` 内，锚点：

```ts
  const selectedRows = candidates.value.filter(item =>
    candidateSelectedIds.value.includes(item.id)
  );
```

紧接其后插入（在计算 `paymentEntityLabel` 之前，保证预填后确认框显示的是预填值）：

```ts
  const titleSummary = summarizeTitles(selectedRows);
  let mixedTitleReason: string | undefined;
  if (titleSummary.kind === "mixed") {
    const reason = await promptMixedTitleReason(titleSummary.counts);
    if (!reason) return;
    mixedTitleReason = reason;
  }
  if (
    titleSummary.kind === "uniform" &&
    titleSummary.entityId &&
    !filters.value.payment_entity_id
  ) {
    filters.value.payment_entity_id = titleSummary.entityId;
    await onPaymentEntityChange();
    message(
      `已按发票抬头预填付款实体：${entityNameMap.value.get(titleSummary.entityId) ?? titleSummary.entityId}`,
      { type: "info" }
    );
  }
```

把创建调用改为可带理由重试一次：锚点

```ts
    const createKey = `reimbursement-batch-create-${crypto.randomUUID()}`;
    const result = await createReimbursementBatch(
      {
        project_id: filters.value.project_id,
        applicant_userid: filters.value.applicant_userid.trim(),
        payment_method: filters.value.payment_method || undefined,
        payment_entity_id: filters.value.payment_entity_id,
        payment_entity_bank_account_id:
          filters.value.payment_entity_bank_account_id,
        payment_account: filters.value.payment_account.trim(),
        payee_id: filters.value.payee_id,
        envelope_ids:
          candidateSelectedIds.value.length > 0
            ? candidateSelectedIds.value
            : undefined
      },
      { idempotencyKey: createKey }
    );
```

替换为：

```ts
    const buildCreatePayload = (reason?: string) => ({
      project_id: filters.value.project_id as number,
      applicant_userid: filters.value.applicant_userid.trim(),
      payment_method: filters.value.payment_method || undefined,
      payment_entity_id: filters.value.payment_entity_id,
      payment_entity_bank_account_id:
        filters.value.payment_entity_bank_account_id,
      payment_account: filters.value.payment_account.trim(),
      payee_id: filters.value.payee_id,
      envelope_ids:
        candidateSelectedIds.value.length > 0
          ? candidateSelectedIds.value
          : undefined,
      mixed_title_reason: reason
    });

    let result: Awaited<ReturnType<typeof createReimbursementBatch>>;
    try {
      result = await createReimbursementBatch(
        buildCreatePayload(mixedTitleReason),
        { idempotencyKey: `reimbursement-batch-create-${crypto.randomUUID()}` }
      );
    } catch (error) {
      // 并发下候选抬头已变化：服务端二次判定为混合，补一次理由后重试一次
      const shape = error as CreateBatchErrorShape;
      if (shape.response?.data?.error?.code !== "MIXED_INVOICE_TITLE") throw error;
      const reason = await promptMixedTitleReason(
        shape.response?.data?.error?.title_counts ?? []
      );
      if (!reason) return;
      result = await createReimbursementBatch(buildCreatePayload(reason), {
        idempotencyKey: `reimbursement-batch-create-${crypto.randomUUID()}`
      });
    }
```

说明：`filters.value.project_id as number` 在函数开头已被非空校验（`if (!filters.value.project_id ...) return;`），断言仅为满足类型；若 eslint 规则禁止该断言，改为在函数开头 `const projectId = filters.value.project_id; if (!projectId || ...) return;` 并在 payload 中使用 `projectId`。

- [ ] **Step 6: 模板——筛选项、汇总块、候选列**

在表单区「被报销人」`</el-form-item>` 之后、「付款方式」之前插入：

```vue
          <el-form-item label="发票抬头">
            <el-select
              v-model="filters.invoice_title_entity_id"
              clearable
              filterable
              placeholder="全部抬头"
            >
              <el-option label="未识别抬头" value="none" />
              <el-option
                v-for="item in activeEntities"
                :key="item.id"
                :label="item.entity_name"
                :value="item.id"
              />
            </el-select>
          </el-form-item>
```

`summary-grid` 内「勾选合计」块之后追加一块：

```vue
      <div class="summary-tile">
        <span>勾选抬头</span>
        <strong>{{ selectedTitleLabel }}</strong>
      </div>
```

候选表「通道」列之后、「发票号」列之前插入：

```vue
        <el-table-column label="发票抬头" min-width="200">
          <template #default="scope">
            <el-tag
              v-if="titleCellFor(scope.row).tag === 'unknown'"
              size="small"
              type="warning"
              effect="plain"
              >未识别</el-tag
            >
            <template v-else>
              <span>{{ titleCellFor(scope.row).text }}</span>
              <el-tag
                v-if="titleCellFor(scope.row).tag === 'unmatched'"
                size="small"
                type="info"
                effect="plain"
                style="margin-left: 6px"
                >未匹配主体</el-tag
              >
            </template>
          </template>
        </el-table-column>
```

页面副标题 `按项目和被报销人汇总候选报销，确认后创建批次并送审。` 改为 `按项目、被报销人和发票抬头汇总候选报销，确认后创建批次并送审；抬头不一致需填写混批理由。`

- [ ] **Step 7: typecheck + lint**

```bash
cd $W/packages/web && npm run typecheck && npm run lint:eslint
```

Expected: 通过。

- [ ] **Step 8: 本地冒烟（api + web）**

```bash
cd $W/packages/api && npm run db:seed:mock:local
```

然后在两个终端分别 `cd $W/packages/api && npm run dev`、`cd $W/packages/web && npm run dev`，浏览器打开 `http://localhost:8849`，登录后进入「财务 → 报销集中审批」：
1. 「发票抬头」下拉可见，选择「未识别抬头」后候选列表自动刷新（本地 mock 数据抬头均为空，全部落在未识别）。
2. 候选表出现「发票抬头」列，显示「未识别」标签。
3. 勾选若干条后「勾选抬头」显示「未识别」；创建并送审不弹理由（全部未识别不算混合）。
4. 用 `npx wrangler d1 execute hybcdg-prod-db --local --command "UPDATE reimbursement_envelope SET invoice_title_entity_id = (SELECT id FROM entity WHERE status='active' LIMIT 1), invoice_title_name='测试抬头', invoice_title_source='ocr' WHERE id = (SELECT MIN(id) FROM reimbursement_envelope WHERE status='received' AND precheck_status='approved' AND batch_id IS NULL)"` 给一条候选设抬头，刷新后勾选它和一条未识别的 → 点「创建并送审」弹出理由输入框；取消则不创建；填理由后创建成功，批次详情能看到混批理由（Task 13 完成后可见）。

- [ ] **Step 9: 提交**

```bash
cd $W && git add packages/web/src/views/finance/reimbursement/batch.vue && git commit -m "feat(web): 成批页按发票抬头筛选，混抬头填理由，付款实体按抬头预填"
```

---

### Task 12: 信封详情页展示与办公室指定抬头

**Files:**
- Modify: `packages/web/src/views/finance/reimbursement/detail.vue`

- [ ] **Step 1: 引入**

import 区追加：

```ts
import { listEntities, type Entity } from "@/api/entity";
```

`from "./reimbursement-labels";` 的导入列表追加 `invoiceTitleSourceLabel,`（按字母序放在 `attachmentTypeLabel,` 之后）。

- [ ] **Step 2: 状态与计算属性（放在 `const isSuperAdmin = computed(...)` 之后）**

```ts
const entities = ref<Entity[]>([]);
const activeEntities = computed(() =>
  entities.value.filter(item => item.status === "active")
);
const entityNameById = computed(() => {
  const map = new Map<number, string>();
  entities.value.forEach(item => map.set(item.id, item.entity_name));
  return map;
});

const titleEntityId = ref<number | undefined>(undefined);
const savingInvoiceTitle = ref(false);

const titleLockedStatuses = new Set([
  "batched",
  "pending_approval",
  "approved",
  "paid",
  "cancelled",
  "deleted"
]);

const canEditInvoiceTitle = computed(
  () =>
    !isCreate.value &&
    canOfficeAudit.value &&
    !!detail.value &&
    !titleLockedStatuses.has(detail.value.status)
);

const invoiceTitleText = computed(() => {
  const current = detail.value;
  if (!current) return "-";
  if (current.invoice_title_entity_id) {
    return (
      entityNameById.value.get(current.invoice_title_entity_id) ||
      current.invoice_title_name ||
      `主体#${current.invoice_title_entity_id}`
    );
  }
  return current.invoice_title_name
    ? `${current.invoice_title_name}（未匹配主体）`
    : "未识别";
});

const invoiceTitleDirty = computed(
  () =>
    (titleEntityId.value ?? null) !==
    (detail.value?.invoice_title_entity_id ?? null)
);

const invoiceTitleSourceTagType = computed(() => {
  const source = detail.value?.invoice_title_source;
  if (source === "manual") return "success";
  if (source === "ocr") return "primary";
  return "info";
});

const saveInvoiceTitle = async () => {
  if (!detail.value || !canEditInvoiceTitle.value) return;
  savingInvoiceTitle.value = true;
  try {
    await updateReimbursementEnvelope(detail.value.id, {
      invoice_title_entity_id: titleEntityId.value ?? null
    });
    message(
      titleEntityId.value ? "发票抬头已指定" : "发票抬头已清除，回到自动识别",
      { type: "success" }
    );
    await loadDetail();
    notifyChanged();
  } catch {
    message("保存发票抬头失败", { type: "error" });
  } finally {
    savingInvoiceTitle.value = false;
  }
};
```

- [ ] **Step 3: 装载**

`loadDetail` 中 `detail.value = result.data;` 之后追加一行：

```ts
    titleEntityId.value = result.data.invoice_title_entity_id ?? undefined;
```

`onMounted` 中 `await Promise.all([loadProjects(), loadWecomUsers()]);` 改为：

```ts
    await Promise.all([
      loadProjects(),
      loadWecomUsers(),
      listEntities()
        .then(result => {
          entities.value = result.data;
        })
        .catch(() => {
          entities.value = [];
        })
    ]);
```

- [ ] **Step 4: 模板——右栏「信封标识」卡片之后新增卡片**

锚点：`<el-card shadow="never" header="状态总览" class="mt-3">`。在其之前插入：

```vue
        <el-card
          v-if="!isCreate"
          shadow="never"
          header="发票抬头（购买方）"
          class="mt-3"
        >
          <el-descriptions :column="1" border>
            <el-descriptions-item label="抬头主体">{{
              invoiceTitleText
            }}</el-descriptions-item>
            <el-descriptions-item label="识别原文">{{
              detail?.invoice_title_name || "-"
            }}</el-descriptions-item>
            <el-descriptions-item label="来源">
              <el-tag size="small" :type="invoiceTitleSourceTagType">{{
                invoiceTitleSourceLabel(detail?.invoice_title_source)
              }}</el-tag>
            </el-descriptions-item>
            <el-descriptions-item v-if="canEditInvoiceTitle" label="办公室指定">
              <el-space
                direction="vertical"
                alignment="stretch"
                style="width: 100%"
              >
                <el-select
                  v-model="titleEntityId"
                  filterable
                  clearable
                  placeholder="选择我方主体；清除=回到自动识别"
                  style="width: 100%"
                >
                  <el-option
                    v-for="item in activeEntities"
                    :key="item.id"
                    :label="item.entity_name"
                    :value="item.id"
                  />
                </el-select>
                <el-button
                  type="primary"
                  plain
                  :loading="savingInvoiceTitle"
                  :disabled="!invoiceTitleDirty"
                  @click="saveInvoiceTitle"
                  >保存抬头</el-button
                >
              </el-space>
            </el-descriptions-item>
            <el-descriptions-item label="说明">
              报销款须由发票抬头对应的我方主体支付；OCR 自动识别，办公室可修正，手工指定后不再被识别结果覆盖
            </el-descriptions-item>
          </el-descriptions>
        </el-card>
```

- [ ] **Step 5: typecheck、lint、冒烟、提交**

```bash
cd $W/packages/web && npm run typecheck && npm run lint:eslint
```

冒烟：打开任一「已收件」信封详情，右栏出现「发票抬头（购买方）」卡片，办公室角色可选主体并保存，刷新后来源显示「手工指定」；清除后来源回到「未识别」。

```bash
cd $W && git add packages/web/src/views/finance/reimbursement/detail.vue && git commit -m "feat(web): 信封详情展示发票抬头，办公室可指定或清除"
```

---

### Task 13: 批次详情 / 审批页 / 集中打款台的不一致提示与二次确认

**Files:**
- Modify: `packages/web/src/views/finance/reimbursement/batch-detail.vue`
- Modify: `packages/web/src/views/approval/detail.vue`
- Modify: `packages/web/src/views/finance/reimbursement/payout.vue`

- [ ] **Step 1: batch-detail.vue——引入 ElMessageBox 与计算属性**

第 2 行 `import type { UploadRequestOptions } from "element-plus";` 改为：

```ts
import { ElMessageBox, type UploadRequestOptions } from "element-plus";
```

在 `const payoutEdit = ref({...});` 之后追加：

```ts
const titleEntityName = computed(() => {
  const current = detail.value;
  if (!current) return "-";
  if (current.invoice_title_entity) return current.invoice_title_entity.entity_name;
  if (current.mixed_title_reason) return "混合抬头";
  return "未识别";
});

const savedTitleMismatch = computed(() => {
  const current = detail.value;
  return Boolean(
    current?.invoice_title_entity_id &&
      current.payment_entity_id &&
      current.payment_entity_id !== current.invoice_title_entity_id
  );
});

const editTitleMismatch = computed(() => {
  const current = detail.value;
  return Boolean(
    current?.invoice_title_entity_id &&
      payoutEdit.value.payment_entity_id &&
      payoutEdit.value.payment_entity_id !== current.invoice_title_entity_id
  );
});
```

- [ ] **Step 2: batch-detail.vue——保存前二次确认**

`saveSecondaryEdit` 中，锚点：

```ts
  if (Object.keys(payload).length === 0) {
    message("请至少填写一个可更新字段", { type: "warning" });
    return;
  }
```

之后插入：

```ts
  if (editTitleMismatch.value) {
    try {
      await ElMessageBox.confirm(
        `所选付款实体与批次发票抬头主体（${titleEntityName.value}）不一致。报销款应由发票抬头对应主体支付，确定仍要保存？`,
        "付款实体与发票抬头不一致",
        { type: "warning", confirmButtonText: "仍要保存", cancelButtonText: "取消" }
      );
    } catch {
      return;
    }
  }
```

- [ ] **Step 3: batch-detail.vue——模板**

「收付款信息」描述列表中「付款实体」项之前插入：

```vue
            <el-descriptions-item label="发票抬头主体">
              {{ titleEntityName }}
              <el-tag
                v-if="savedTitleMismatch"
                type="danger"
                size="small"
                style="margin-left: 8px"
                >与付款实体不一致</el-tag
              >
            </el-descriptions-item>
            <el-descriptions-item
              v-if="detail.mixed_title_reason"
              label="混批理由"
              >{{ detail.mixed_title_reason }}</el-descriptions-item
            >
```

超管二次编辑表单「付款实体」的 `</el-select>` 之后插入：

```vue
              <el-tag
                v-if="editTitleMismatch"
                type="danger"
                size="small"
                style="margin-left: 8px"
                >与发票抬头主体（{{ titleEntityName }}）不一致</el-tag
              >
```

- [ ] **Step 4: approval/detail.vue——计算属性、二次确认、模板**

import 区追加（该文件当前未引入 ElMessageBox）：

```ts
import { ElMessageBox } from "element-plus";
```

在 `const savePayoutSelection = async () => {` 之前插入：

```ts
const reimbursementTitleEntityName = computed(
  () => reimbursementBatchDetail.value?.invoice_title_entity?.entity_name ?? null
);

const reimbursementTitleMismatch = computed(() => {
  const batch = reimbursementBatchDetail.value;
  return Boolean(
    batch?.invoice_title_entity_id &&
      payoutForm.value.payment_entity_id &&
      payoutForm.value.payment_entity_id !== batch.invoice_title_entity_id
  );
});
```

`savePayoutSelection` 开头（`actionLoading.value = true;` 之前）插入：

```ts
  if (reimbursementTitleMismatch.value) {
    try {
      await ElMessageBox.confirm(
        `所选付款主体与批次发票抬头主体（${reimbursementTitleEntityName.value ?? "-"}）不一致。报销款应由发票抬头对应主体支付，确定仍要保存？`,
        "付款主体与发票抬头不一致",
        { type: "warning", confirmButtonText: "仍要保存", cancelButtonText: "取消" }
      );
    } catch {
      return;
    }
  }
```

模板「审批台支付方案」表单中「支付方式」`</el-form-item>` 之后插入：

```vue
            <el-form-item
              v-if="reimbursementTitleEntityName"
              label="发票抬头主体"
            >
              <span>{{ reimbursementTitleEntityName }}</span>
              <el-tag
                v-if="reimbursementTitleMismatch"
                type="danger"
                size="small"
                style="margin-left: 8px"
                >与所选付款主体不一致</el-tag
              >
            </el-form-item>
```

- [ ] **Step 5: payout.vue——提示与二次确认**

第 2 行改为：

```ts
import { ElMessageBox, type UploadRequestOptions } from "element-plus";
```

在 `const selectedAmount = computed(...)` 之后插入：

```ts
const entityNameById = computed(() => {
  const map = new Map<number, string>();
  entities.value.forEach(item => map.set(item.id, item.entity_name));
  return map;
});

const payTargets = computed(() =>
  rows.value.filter(row => payTargetIds.value.includes(row.id))
);

const titleMismatchTargets = computed(() =>
  payTargets.value.filter(
    row =>
      row.invoice_title_entity_id &&
      payForm.value.payment_entity_id &&
      row.invoice_title_entity_id !== payForm.value.payment_entity_id
  )
);

const titleLabelOf = (row: ReimbursementBatch) =>
  row.invoice_title_entity_id
    ? entityNameById.value.get(row.invoice_title_entity_id) ??
      `主体#${row.invoice_title_entity_id}`
    : row.mixed_title_reason
      ? "混合抬头"
      : "未识别";
```

`submitMarkPaid` 中，锚点：

```ts
  if (
    !payForm.value.payment_entity_id ||
    !payForm.value.payment_entity_bank_account_id
  ) {
    message("请选择支付实体和支付账号", { type: "warning" });
    return;
  }
```

之后插入：

```ts
  if (titleMismatchTargets.value.length > 0) {
    try {
      await ElMessageBox.confirm(
        `以下批次的发票抬头主体与所选支付实体不一致：${titleMismatchTargets.value
          .map(row => `${row.batch_no}（${titleLabelOf(row)}）`)
          .join("、")}。报销款应由发票抬头对应主体支付，确定仍要登记打款？`,
        "支付实体与发票抬头不一致",
        { type: "warning", confirmButtonText: "仍要登记", cancelButtonText: "取消" }
      );
    } catch {
      return;
    }
  }
```

模板「登记打款」抽屉表单中「支付实体」`</el-form-item>` 之后插入：

```vue
      <el-form-item label="批次抬头">
        <div style="line-height: 1.8">
          <div v-for="row in payTargets" :key="row.id">
            {{ row.batch_no }}：{{ titleLabelOf(row) }}
          </div>
        </div>
      </el-form-item>
      <el-alert
        v-if="titleMismatchTargets.length > 0"
        type="error"
        :closable="false"
        style="margin-bottom: 12px"
        :title="`有 ${titleMismatchTargets.length} 个批次的发票抬头主体与所选支付实体不一致`"
      />
```

- [ ] **Step 6: typecheck、lint、冒烟、提交**

```bash
cd $W/packages/web && npm run typecheck && npm run lint:eslint
```

冒烟：用 Task 11 Step 8 创建的批次，打开批次详情看到「发票抬头主体」和（若混批）「混批理由」；超管二次编辑把付款实体改成其他主体出现红标，保存弹确认；审批详情页支付方案同样出现红标与确认；集中打款台登记打款时选择不同实体出现 alert 与确认。

```bash
cd $W && git add packages/web/src/views/finance/reimbursement/batch-detail.vue packages/web/src/views/approval/detail.vue packages/web/src/views/finance/reimbursement/payout.vue && git commit -m "feat(web): 付款实体与发票抬头主体不一致时标红并二次确认"
```

---

### Task 14: 办公室工作台「待成批」抬头列 + AI 一键成批抽屉显示抬头

**Files:**
- Modify: `packages/web/src/views/finance/reimbursement/office-workbench.vue`
- Modify: `packages/web/src/views/finance/reimbursement/components/AiBatchProposalsDrawer.vue`

- [ ] **Step 1: 工作台列（「通道」列 `</el-table-column>` 之后、`<el-table-column prop="amount" label="金额" width="100" />` 之前插入）**

```vue
          <el-table-column
            v-if="intakeTab === 'to_batch'"
            label="发票抬头"
            min-width="180"
            show-overflow-tooltip
          >
            <template #default="scope">
              <span v-if="scope.row.invoice_title_name">{{
                scope.row.invoice_title_name
              }}</span>
              <el-tag v-else size="small" type="warning" effect="plain"
                >未识别</el-tag
              >
            </template>
          </el-table-column>
```

（列表接口 `SELECT e.*` 已带新列，无需改 API。）

- [ ] **Step 2: 抽屉——分组 key 与抬头标签**

`load` 中 `key: \`${item.applicant_userid}-${item.project_id}\`,` 改为：

```ts
      key: `${item.applicant_userid}-${item.project_id}-${item.invoice_title_entity_id ?? "none"}`,
```

模板 `el-alert` 的 `title` 改为：

```
系统已按「同人 + 同项目 + 同发票抬头 + 复核通过 + 未入批」自动分组。确认后逐组创建批次并送审，AI 审计摘要将自动附加到批次供审批人查看。
```

抽屉标题 `title="AI 一键成批（同人同项目终审批次）"` 改为 `title="AI 一键成批（同人同项目同抬头）"`。

卡片头部 `proposal-card__meta` 内、`<span>{{ row.item_count }} 条</span>` 之前插入：

```vue
            <el-tag
              size="small"
              :type="row.invoice_title_entity_id ? 'primary' : 'warning'"
              effect="plain"
            >
              {{ row.invoice_title_name || "未识别抬头" }}
            </el-tag>
```

- [ ] **Step 3: typecheck、lint、冒烟、提交**

```bash
cd $W/packages/web && npm run typecheck && npm run lint:eslint
```

冒烟：工作台「② 成批送审 → 待成批」列表出现「发票抬头」列；「AI 一键成批」抽屉每组显示抬头标签，且 Task 11 Step 8 设了抬头的那条与未识别的分在两组。

```bash
cd $W && git add packages/web/src/views/finance/reimbursement/office-workbench.vue packages/web/src/views/finance/reimbursement/components/AiBatchProposalsDrawer.vue && git commit -m "feat(web): 待成批列表与 AI 建议批次显示发票抬头"
```

---

### Task 15: 文档更新与整体验证

**Files:**
- Modify: `doc/UI设计文档.md`（F-5 节，约 328–338 行）
- Modify: `doc/开发记录.md`（文末追加）

- [ ] **Step 1: UI 设计文档（F-5 节末尾追加一条）**

```markdown
- **按发票抬头成批**（2026-09-12 新增）：候选筛选栏新增「发票抬头」（各 active 主体 + 未识别），候选表新增「发票抬头」列（主体名 / 原文+「未匹配主体」/「未识别」），汇总区新增「勾选抬头」；创建时所选信封抬头全部一致则自动预填付款实体，出现两种以上（含已识别+未识别）弹输入框要求填写 2–200 字混批理由（`POST /batch` 返回 400 `MIXED_INVOICE_TITLE` 时同样补理由重试一次），全部未识别不算混合。信封抬头由 OCR 购买方名称自动匹配我方主体，办公室可在信封详情「发票抬头（购买方）」卡片指定或清除（`PUT /reimbursement/:id` 的 `invoice_title_entity_id`）；批次详情、审批页支付方案、集中打款台在付款实体 ≠ 批次抬头主体时标红并二次确认，不硬拦。AI 一键成批分组键增加抬头。
```

- [ ] **Step 2: 开发记录（文末追加）**

```markdown
### 报销成批按发票抬头筛选与软约束（2026-09-12）

- **诱因**：RM-20260911-0001 把鑫丰畅与丰畅两家抬头的发票合成一批送审，报销款须由抬头对应主体支付，只能直连生产库退回解散。
- **数据**：迁移 0087 给信封加 `invoice_title_entity_id/invoice_title_name/invoice_title_source`、批次加 `invoice_title_entity_id/mixed_title_reason`，并从 `reimbursement_invoice_review.extraction_json.buyer_name` 回填存量（半角括号归一化后与 active 主体唯一精确匹配）。
- **API**：`reimbursement-invoice-title-policy.ts`（归一化/匹配/OCR 写入决策）、`reimbursement-invoice-title-sync.ts`（带 manual 守卫的写入）、`reimbursement-batch-title-policy.ts`（uniform/mixed/unknown 汇总与理由校验）；OCR 折叠两条路径写抬头；`PUT /:id` 办公室指定（三态）；拆单继承；候选 `invoice_title_entity_id` 过滤；建议分组按抬头拆；`POST /batch` 混合无理由 400 `MIXED_INVOICE_TITLE`；批次详情与冻结 route_context、AI 关卡上下文带抬头。
- **Web**：成批页筛选/列/汇总/预填/理由弹窗；信封详情抬头卡片；批次详情、审批页、集中打款台不一致标红与二次确认；工作台待成批列与 AI 建议抽屉抬头标签。
- **验证**：api vitest 全绿（新增 5 个测试文件）、typecheck/lint 通过；web vitest/typecheck/eslint 通过；本地冒烟。
- **上线**：先远程应用迁移 0087（含回填，核对匹配数），再 push main。小程序本期不改。
```

- [ ] **Step 3: 全量验证**

```bash
cd $W/packages/api && npm run typecheck && npm run lint && npx vitest run
cd $W/packages/web && npm run typecheck && npm run lint:eslint && npx vitest run
```

Expected: 全部通过。任何失败先修实现，不改既有测试断言（除非测试本身错误）。

- [ ] **Step 4: 提交**

```bash
cd $W && git add doc/UI设计文档.md doc/开发记录.md && git commit -m "docs: 报销成批按发票抬头筛选与软约束的 UI 说明与开发记录"
```

---

### Task 16: 合并与上线（需 owner 确认后执行 push）

**Files:** 无代码改动。

- [ ] **Step 1: 变基到最新 main 并合并**

```bash
cd /Users/zihaoliu/Documents/Code/hybc_core && git fetch origin && git checkout main && git pull --ff-only origin main
git merge --no-ff feat/reimbursement-invoice-title -m "merge: 报销成批按发票抬头筛选与软约束"
```

若主工作区仍有未提交改动（与本功能无关的其他工作），`git merge` 只要求这些文件不与本分支冲突；本分支只改 `packages/api`、`packages/web/src/views/finance/reimbursement`、`packages/web/src/views/approval/detail.vue`、`packages/web/src/api/reimbursement.ts`、`doc/`、`docs/`。如冲突，停下让 owner 处理。

- [ ] **Step 2: 生产迁移（push 之前）**

```bash
cd /Users/zihaoliu/Documents/Code/hybc_core/packages/api && npx wrangler d1 migrations apply hybcdg-prod-db --remote
npx wrangler d1 execute hybcdg-prod-db --remote --command "SELECT COUNT(*) AS with_name FROM reimbursement_envelope WHERE invoice_title_name IS NOT NULL; SELECT COUNT(*) AS matched FROM reimbursement_envelope WHERE invoice_title_entity_id IS NOT NULL; SELECT invoice_title_entity_id, COUNT(*) AS n FROM reimbursement_envelope WHERE invoice_title_entity_id IS NOT NULL GROUP BY invoice_title_entity_id"
```

Expected: `with_name` 约 140、`matched` 约 110（以实际为准）；分组只出现 6/11/12 等 active 主体 id；信封 237 → 11、241 → 6：

```bash
npx wrangler d1 execute hybcdg-prod-db --remote --command "SELECT id, invoice_title_entity_id, invoice_title_name, invoice_title_source FROM reimbursement_envelope WHERE id IN (237,241)"
```

- [ ] **Step 3: 推送 main（push 即部署，先向 owner 确认）**

```bash
cd /Users/zihaoliu/Documents/Code/hybc_core && git push origin main
```

约 90 秒后：

```bash
curl -s https://api.hybcdg.com/api/v1/system/health
```

Expected: 响应含 `"ok":true`。随后在生产成批页按验收标准（规格第 14 节）逐条核对。

- [ ] **Step 4: 清理 worktree**

```bash
cd /Users/zihaoliu/Documents/Code/hybc_core && git worktree remove .claude/worktrees/reimbursement-invoice-title && git branch -d feat/reimbursement-invoice-title
```
