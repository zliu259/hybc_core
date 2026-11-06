# 报销多附件统一与详情页改版 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 提交后每个附件都有识别结果或明确失败；两端都能一次传多个；详情页第一眼看到一句结论和该做什么。

**Architecture:** 识别流程从路由移到 `services/reimbursement/`，提交请求只改状态并发事件，由队列和 Cron 幂等补任务。结论和附件状态由服务端纯函数算好，两端共用。网页详情页拆成小组件，外部接口不变。

**Tech Stack:** Hono、Cloudflare Workers、D1、Queues、R2、Vue 3、Element Plus、企微小程序、Python runner。

**Spec:** [docs/superpowers/specs/2026-11-06-reimbursement-multi-attachment-design.md](../specs/2026-11-06-reimbursement-multi-attachment-design.md)，样稿在同目录 `2026-11-06-reimbursement-detail-mock.html`。实现前两份都要读。

## Global Constraints

- 分三个 PR，按 Part 1、2、3 顺序。推送到 `main` 就是部署，合并由 owner 决定。
- 生产迁移和生产查询每次都要 owner 明确同意。迁移在推送依赖它的代码之前跑：`cd packages/api && npx wrangler d1 migrations apply hybcdg-prod-db --remote --env prod`。
- 提交格式 `<type>: <description>`，不加 `Co-Authored-By` 或任何 AI 署名。
- 依赖用 pnpm。不用 `as any`、`@ts-ignore`。API 路径前缀 `/api/v1`。单文件不超过 800 行，新文件目标 200 到 400 行。
- 多步写入用 `DB.batch()`，不用 `runInTransaction`（生产不回滚）。
- `packages/web` 的 stylelint 只看不用 `--fix`（会把 `@media` 移到基础规则之前）。
- `test/` 下的真实 SQL 测试需要 Node 22.5 以上。CI 是 Node 20，会跳过，所以推送前必须本地跑。纯逻辑测试放 `src/`，CI 能跑。
- 小程序测试不在 CI：`cd packages/miniapp && node utils/<name>.test.js`。
- 用户可见文字一律中文，来自 spec 第 6 节的说法逐字照抄。
- 计划里的行号以写计划时的 `main`（`ee434ba`）为准。Task 1 搬移后行号会变，以函数名和路由路径为准。

## Review Focus

1. **30 个文件里断网几个：** 其余继续传，失败的单独重试，全部结束前提交不可点。测试在 Task 13、Task 17。
2. **文件名：** `.PDF`、`.JPG` 大写后缀要接受；没有后缀、中文名含多个点、`.heic` 要给出清楚的中文报错。测试在 Task 9。
3. **轮询和手动输入：** 上传中轮询不能冲掉进度行；手动改过金额后，识别结果回来不能覆盖。测试在 Task 16、Task 17。
4. **拆单后：** 附件移到子单，两边不互报重复，识别状态都正确。测试在 Task 5。
5. **历史数据：** 没有识别行、`silent_review_result` 为空、没有 `document_type`、已付款的老单，详情页不能报错，也不能给出错误的结论。测试在 Task 3、Task 11。

---

# Part 1：提交链路（PR 1）

### Task 1: 搬出识别代码和真实 SQL 测试工具

纯搬移，不改行为。

**Files:**
- Create: `packages/api/src/services/reimbursement/review-helpers.ts`
- Create: `packages/api/src/services/reimbursement/duplicate-checks.ts`
- Create: `packages/api/src/services/reimbursement/review-pipeline.ts`
- Create: `packages/api/test/helpers/reimbursement-harness.ts`
- Create: `packages/api/test/reimbursement-harness.test.ts`
- Modify: `packages/api/src/routes/reimbursement.ts:109-267,491-1331`

**Interfaces:**
- Produces: `review-helpers.ts` 导出 `parseTaskResult`、`parseStoredJson`、`normalizeHintValue`、`extractInvoiceRecognitionHints`、`normalizeInvoiceNo`、`normalizeInvoiceDate`、`toAmountValue`、`parseQrInvoiceHints`、`supportsInvoiceReviewTable`、`isMissingInvoiceReviewTableError`、`InvoiceReviewRow`。`readInvoiceExtractionText` 已在 `routes/reimbursement-invoice-title-policy.ts`，不动。
- Produces: `duplicate-checks.ts` 导出 `applyDuplicateChecks`、`applyInvoiceReviewDuplicateChecks`。
- Produces: `review-pipeline.ts` 导出 `enqueueEnvelopeAiAudit`、`syncEnvelopeAuditState`。
- Produces: 测试工具 `createReimbursementHarness()` 返回 `{ env, db, drainQueue, seedEnvelope(fields), seedAttachment(envelopeId, fields), finishTask(taskId, status, output?), listTasks(), listReviews(envelopeId) }`。

- [ ] **Step 1: 写测试工具的失败测试** `test/reimbursement-harness.test.ts`，`describe.skipIf(!sqlite)`：

```ts
it("跑完全部迁移后能写入和批量回滚", async () => {
  const h = createReimbursementHarness();
  const id = await h.seedEnvelope({ status: "draft", amount: 100 });
  const bad = h.env.DB.prepare("INSERT INTO no_such_table VALUES (1)");
  const ok = h.env.DB.prepare("UPDATE reimbursement_envelope SET amount = 1 WHERE id = ?").bind(id);
  await expect(h.env.DB.batch([ok, bad])).rejects.toThrow();
  const row = await h.env.DB.prepare("SELECT amount FROM reimbursement_envelope WHERE id = ?").bind(id).first();
  expect(row.amount).toBe(100);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/api && npx vitest run test/reimbursement-harness.test.ts`
Expected: FAIL，找不到 harness

- [ ] **Step 3: 实现 harness。** 照 `test/approval-timeout-dedupe.test.ts:128` 的 `createSqliteD1`，用 `node:sqlite` 的 `DatabaseSync(":memory:", { enableForeignKeyConstraints: false })`。迁移按文件名排序全部执行（已验证 94 个全部能在 node:sqlite 跑通）。`batch` 用 `BEGIN`、`COMMIT`，出错 `ROLLBACK` 后重新抛出。`EVENT_QUEUE.send` 累积消息，`drainQueue()` 交给真实的 `queue()`。`FILES.head(key)` 由测试预置。

- [ ] **Step 4: 运行确认通过**

Run: `cd packages/api && npx vitest run test/reimbursement-harness.test.ts`
Expected: PASS

- [ ] **Step 5: 搬移代码。** 只移动并改 import，函数体不变。路由文件从新模块导入。

- [ ] **Step 6: 确认行为没变**

Run: `cd packages/api && npm test && npm run typecheck`
Expected: 全部通过，没有修改任何现有测试

- [ ] **Step 7: Commit**

```bash
git add packages/api/src/services/reimbursement packages/api/src/routes/reimbursement.ts packages/api/test/helpers/reimbursement-harness.ts packages/api/test/reimbursement-harness.test.ts
git commit -m "refactor: 把报销识别流程移到服务层，加真实 SQL 测试工具"
```

### Task 2: 任务和识别行一起写入

**Files:**
- Create: `packages/api/migrations/0092_reimbursement_review_unique.sql`
- Modify: `packages/api/src/services/ai-slot.ts`（在 `createTask` 后）
- Modify: `packages/api/src/services/reimbursement/review-pipeline.ts`
- Test: `packages/api/test/reimbursement-review-pipeline.test.ts`

**Interfaces:**
- Consumes: Task 1 的 harness。
- Produces: `createTaskWithCompanions(env: Env, request: CreateTaskRequest, companions: (taskCode: string) => D1PreparedStatement[]): Promise<TaskQueueItem | null>`。任务和附带语句放进同一个 `DB.batch()`。`task_code` 撞唯一约束时重新生成，最多 3 次；附带语句撞唯一约束返回 `null`，不留下任务。
- Produces: `ensureInvoiceReviews(env: Env, envelopeId: number, options?: { forceNewRound?: boolean }): Promise<{ round: number; created: number; latestTaskId: number | null }>`。

- [ ] **Step 1: 写失败测试**（`describe.skipIf(!sqlite)`）

```ts
it("每个有效附件恰好一个任务一条识别行", /* 3 个附件，其中 1 个已删：created=2，listTasks 2 条，listReviews 2 条，task_id 都非空 */);
it("重复调用不多建", /* 连调两次：第二次 created=0，任务数不变 */);
it("识别行写入冲突时任务也不留下", /* 预插同附件同轮识别行：created=0，task_queue 没有新行 */);
it("failed 行不自动重建", /* 把识别行设为 failed：再调 created=0 */);
it("forceNewRound 开新一轮并全部新建", /* round=2，created 等于有效附件数 */);
it("迁移把同轮重复行挪走且不丢数据", /* 迁移前同附件同轮两行：保留 id 大的，另一行 review_round=-id */);
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/api && npx vitest run test/reimbursement-review-pipeline.test.ts`
Expected: FAIL

- [ ] **Step 3: 写迁移。** 不删数据：

```sql
UPDATE reimbursement_invoice_review
   SET review_round = -id
 WHERE id NOT IN (
   SELECT MAX(id) FROM reimbursement_invoice_review
    GROUP BY envelope_id, attachment_id, review_round
 );
CREATE UNIQUE INDEX IF NOT EXISTS idx_reimbursement_invoice_review_attachment_round
  ON reimbursement_invoice_review(envelope_id, attachment_id, review_round);
```

- [ ] **Step 4: 实现两个函数。** 识别行语句的 `task_id` 用 `(SELECT id FROM task_queue WHERE task_code = ?)`。任务的 payload、优先级、超时和现在的 `createInvoiceReviewTasks` 相同。`created > 0` 时更新 `ocr_task_id`、`ocr_status = 'pending'`。`ensureInvoiceReviews` 只跳过已有行（含 failed），删除旧的 `createInvoiceReviewTasks`，`enqueueEnvelopeAiAudit` 改为调用它。

- [ ] **Step 5: 运行确认通过**

Run: `cd packages/api && npx vitest run test/reimbursement-review-pipeline.test.ts && npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/api/migrations/0092_reimbursement_review_unique.sql packages/api/src/services/ai-slot.ts packages/api/src/services/reimbursement/review-pipeline.ts packages/api/test/reimbursement-review-pipeline.test.ts
git commit -m "fix: 报销识别任务和识别记录一起写入，重复调用不多建"
```

### Task 3: 附件状态和合计，修同步

**Files:**
- Create: `packages/api/src/services/reimbursement/attachment-state.ts`
- Create: `packages/api/src/services/reimbursement/attachment-state.test.ts`
- Modify: `packages/api/src/services/reimbursement/review-pipeline.ts`（`syncEnvelopeAuditState`）
- Test: `packages/api/test/reimbursement-review-pipeline.test.ts`

**Interfaces:**
- Produces:

```ts
export type AttachmentReviewState =
  "recognizing" | "recognized" | "not_invoice" | "no_amount" | "failed" | "not_recognized";

export interface AttachmentReviewView {
  attachment_id: number;
  file_key: string;
  file_name: string | null;
  file_size: number | null;
  state: AttachmentReviewState;
  display_name: string; // 销售方，没有用文件名，再没有用「附件 {id}」
  amount: number | null;
  invoice_no: string | null;
  invoice_date: string | null;
  seller_name: string | null;
  raw_text_summary: string | null;
  duplicates: { match_type: string; risk_level: string; summary: string | null; matched_envelope_id: number | null }[];
  attention: string | null;
}

export interface ReviewTotals {
  attachment_count: number;
  recognized_count: number;
  recognizing_count: number;
  failed_count: number;
  no_amount_count: number;
  not_invoice_count: number;
  extracted_total: number;
  declared_amount: number;
  complete: boolean;       // 所有附件都是 recognized
  delta: number | null;    // extracted_total - declared_amount，保留两位；complete 为 false 时是 null
  mismatch: boolean;       // complete 且 |delta| > 0.01
}

export function buildAttachmentViews(input: {
  attachments: EnvelopeAttachment[];
  reviews: InvoiceReviewRow[];
  duplicates: ReimbursementDuplicateCheck[];
  anomalies: { attachment_id: number | null; level: string; reason: string }[];
  envelopeStatus: string;
}): AttachmentReviewView[];

export function computeReviewTotals(views: AttachmentReviewView[], declaredAmount: number): ReviewTotals;
```

- [ ] **Step 1: 写纯函数失败测试**（`src/`，CI 能跑）

```ts
it("322：全部读出，票面比申报多 0.04", () => {
  const t = computeReviewTotals(viewsWithAmounts([1000, 568.95]), 1568.91);
  expect(t).toMatchObject({ complete: true, delta: 0.04, mismatch: true });
});
it("327：没读全时不比差额", () => {
  const t = computeReviewTotals(viewsWithStates(["not_invoice", "not_invoice"]), 2300);
  expect(t).toMatchObject({ complete: false, delta: null, mismatch: false, extracted_total: 0 });
});
it("金额 0 算没读到", /* completed，invoice_amount 0，无 document_type → no_amount */);
it("document_type 是 receipt 算 not_invoice，并带 raw_text_summary", /* ... */);
it("没有识别行：已过 received 是 not_recognized，否则 recognizing", /* paid → not_recognized；submitted → recognizing */);
it("每个附件只取一行，不把负轮次算进来", /* ... */);
it("已删附件不在列表里", /* attachments 不含它，reviews 含它 → views 长度不变 */);
it("历史数据 extraction_json 为空不抛错", /* ... */);
it("failed 和 timeout 行都显示 failed", /* task_status failed → failed */);
```

- [ ] **Step 2: 写同步的失败测试**（`test/`）

```ts
it("删除附件后合计和结论更新", /* 两张都完成后删一张再 sync：silent_review_result.amount_consistency.extracted_total 变化 */);
it("结论不再冻结", /* 先 sync 写入一次，再加附件并完成，再 sync：summary、invoice_review.total 更新；ai_reasonability 保留 */);
it("有附件没有识别行时 ocr_status 是 pending", /* ... */);
it("没读全不报金额不一致", /* 一张有金额一张没有：summary 不含「不一致」，mismatch=false */);
it("有重试额度的 timeout 不标 failed", /* task.status=timeout, retry_count<max_retries：row 不变为 failed，ocr_status=pending */);
it("failed 行的任务后来完成了能写回结果", /* row=failed，task=completed：sync 后 row=completed 且有金额 */);
it("重试用完的 timeout 标 failed", /* retry_count=max_retries：row=failed */);
```

- [ ] **Step 3: 运行确认失败**

Run: `cd packages/api && npx vitest run src/services/reimbursement/attachment-state.test.ts test/reimbursement-review-pipeline.test.ts`
Expected: FAIL

- [ ] **Step 4: 实现。** 同步按 spec 4.3：只取有效附件和当前轮次最新一行；`ocr_status` 有 `recognizing` 就是 pending；用 `computeReviewTotals` 算合计；把第 1168 行的 `COALESCE` 改成覆盖 `summary`、`invoice_review`、`amount_consistency`，保留 `ai_reasonability`、`ai_reasonability_summary`，JSON 字段名不变。`amount_consistency.delta` 的符号保持现状（申报减票面），只有 `ReviewTotals.delta` 用新符号。`hasReviewRows` 为假的旧分支不动。

- [ ] **Step 5: 运行确认通过**

Run: `cd packages/api && npx vitest run src/services/reimbursement/attachment-state.test.ts test/reimbursement-review-pipeline.test.ts && npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/services/reimbursement packages/api/test/reimbursement-review-pipeline.test.ts
git commit -m "fix: 报销结论随附件更新，已删附件不计入，超时重试能读回结果"
```

### Task 4: 提交只发事件，队列和 Cron 补任务

**Files:**
- Create: `packages/api/src/services/reimbursement/review-reconcile.ts`
- Create: `packages/api/test/reimbursement-submit-recovery.test.ts`
- Modify: `packages/api/src/routes/reimbursement.ts:5240-5373`（提交路由）
- Modify: `packages/api/src/services/event-bus.ts:33`
- Modify: `packages/api/src/queue-handler.ts:820`
- Modify: `packages/api/src/scheduled.ts`（`*/2` 分支）

**Interfaces:**
- Consumes: `ensureInvoiceReviews`、`syncEnvelopeAuditState`。
- Produces: 事件 `REIMBURSEMENT_ENVELOPE_SUBMITTED`，payload `{ envelope_id, envelope_uuid, submitted_by }`。
- Produces: `reconcileReimbursementReviews(env: Env, limit?: number): Promise<{ ensured: number; synced: number }>`，默认 `limit = 10`。永不抛出，错误用 `console.error`。

- [ ] **Step 1: 写失败测试**

```ts
it("提交请求不建任务", /* 路由：createTask 未被调用，publishEvent 收到 REIMBURSEMENT_ENVELOPE_SUBMITTED，状态 submitted，precheck_status 和 duplicate_check_status 都是 pending */);
it("发事件失败提交仍成功", /* EVENT_QUEUE.send 和 logEvent 抛错：返回 200，状态 submitted */);
it("队列消费后每个附件都有任务", /* 30 个附件，drainQueue 后 listTasks 30 条 */);
it("队列重投不多建", /* drain 两遍，任务数不变 */);
it("提交中断后 Cron 补齐", /* 直接把状态改 submitted 不发事件，reconcile 后每个附件都有任务和识别行 */);
it("Cron 不碰老草稿", /* 附件 created_at 是 2 天前的 draft：不建任务；1 小时前的：建 */);
it("Cron 不碰已复核通过和已成批", /* precheck_status=approved 或 batch_id 非空：不建 */);
it("Cron 同步任务已结束的单", /* row=pending，task=completed：synced=1，row=completed */);
it("TASK_COMPLETED 触发同步", /* ocr_extract 任务完成并 drain：row=completed，无需 GET */);
it("提交被中断后同一个 Idempotency-Key 重试成功", /* 幂等行 pending，状态 submitted：返回 already_submitted，幂等行 completed */);
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/api && npx vitest run test/reimbursement-submit-recovery.test.ts`
Expected: FAIL

- [ ] **Step 3: 改提交路由。** 去掉 `enqueueEnvelopeAiAudit`。状态 `UPDATE` 同时写 `precheck_status = 'pending'`、`duplicate_check_status = 'pending'`。`publishEvent` 包 try/catch，失败只记 `console.error`。保留 `REIMBURSEMENT_ENVELOPE_SCANNED`（同样 try/catch）。幂等结果为 `pending` 时，如果信封已是 submitted，调 `completeIdempotentRequest` 并返回 `already_submitted`。

- [ ] **Step 4: 加事件和队列分支。** `REIMBURSEMENT_ENVELOPE_SUBMITTED`：`ensureInvoiceReviews`、`syncEnvelopeAuditState`、有新任务时 `wakeRunner`。`TASK_COMPLETED` 在现有逻辑后：`biz_type === "reimbursement_envelope"` 且 `task_type` 是 `ocr_extract` 或 `reimbursement_anomaly` 时 `syncEnvelopeAuditState(env, biz_id)`。

- [ ] **Step 5: 实现对账。** 两个查询，都按 `limit` 截断：

```sql
-- 缺识别行
SELECT DISTINCT e.id FROM reimbursement_envelope e
  JOIN envelope_attachment a ON a.envelope_id = e.id AND a.status = 'active'
 WHERE e.batch_id IS NULL AND e.precheck_status != 'approved'
   AND (e.status IN ('submitted','received')
        OR (e.status IN ('draft','unregistered') AND a.created_at >= ?)) -- 24 小时前
   AND NOT EXISTS (
     SELECT 1 FROM reimbursement_invoice_review r
      WHERE r.attachment_id = a.id AND r.envelope_id = e.id
        AND r.review_round = (SELECT MAX(review_round) FROM reimbursement_invoice_review WHERE envelope_id = e.id))
 LIMIT ?;
-- 待同步
SELECT DISTINCT r.envelope_id FROM reimbursement_invoice_review r
  JOIN task_queue t ON t.id = r.task_id
  JOIN reimbursement_envelope e ON e.id = r.envelope_id
 WHERE e.status NOT IN ('cancelled','deleted')
   AND ((r.task_status IN ('pending','assigned','running') AND t.status IN ('completed','failed','timeout'))
     OR (r.task_status = 'failed' AND t.status = 'completed'))
 LIMIT ?;
```

在 `scheduled.ts` 的 `*/2` 分支调用，和 `reconcileStuckPrechecks` 一样 `.catch` 兜底。

- [ ] **Step 6: 运行确认通过**

Run: `cd packages/api && npx vitest run test/reimbursement-submit-recovery.test.ts && npm test`
Expected: PASS。`reimbursement-submit-duplicate-response.test.ts` 如断言了内部调用，只改断言，不改 409 的响应内容。

- [ ] **Step 7: Commit**

```bash
git add packages/api/src/services/reimbursement/review-reconcile.ts packages/api/test/reimbursement-submit-recovery.test.ts packages/api/src/routes/reimbursement.ts packages/api/src/services/event-bus.ts packages/api/src/queue-handler.ts packages/api/src/scheduled.ts
git commit -m "fix: 报销提交不再在请求里建识别任务，队列和定时任务补齐"
```

### Task 5: 查重按每张发票

**Files:**
- Modify: `packages/api/src/services/reimbursement/duplicate-checks.ts`
- Modify: `packages/api/src/routes/reimbursement.ts`（提交路由、`/:id/precheck` 4047-4085）
- Test: `packages/api/test/reimbursement-duplicates.test.ts`

**Interfaces:**
- Consumes: `syncEnvelopeAuditState`、`ensureInvoiceReviews`。
- Produces: `match_type = 'same_envelope'`；每条发票级记录的 `evidence_json` 含 `attachment_id`（同单重复再含 `other_attachment_id`）。`applyDuplicateChecks` 和 `applyInvoiceReviewDuplicateChecks` 返回值不变。

- [ ] **Step 1: 写失败测试**

```ts
it("同一单传两次同一张发票能查出", /* 两行同发票号同日期：same_envelope，risk high，evidence 含两个 attachment_id */);
it("已删其中一张后不再报", /* 删除后 sync：same_envelope 消失 */);
it("和已提交的单比", /* 另一单 submitted 有同发票：invoice_no_date，evidence.attachment_id 指向本单附件 */);
it("不和草稿比", /* 另一单 draft：不报，唯一编号、发票号、二维码、模糊金额四种都验证 */);
it("不和已废止的单比", /* 另一单 cancelled：不报 */);
it("不和别单已删的附件比", /* 另一单附件 deleted：不报 */);
it("两张草稿同发票，后提交的报", /* A 提交不报；B 提交返回 409 require_force_submit */);
it("拆单后两边不互报", /* 附件 envelope_id 改到子单、强制新一轮：源单和子单都没有该发票的重复记录 */);
it("提交时算每张发票", /* 草稿已识别出重复发票：提交返回 409，duplicate_count>=1 */);
it("复核通过只等识别", /* 识别完成、合理性任务 running：不返回 wait_for_audit */);
it("合理性任务失败不拦复核", /* anomaly task failed：duplicate_check_status 仍 completed，复核通过成功 */);
it("识别没结束时复核返回等待", /* 有 recognizing 附件：409 wait_for_audit，响应结构不变 */);
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/api && npx vitest run test/reimbursement-duplicates.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现。** 比对条件加 `JOIN envelope_attachment a ON a.id = r.attachment_id AND a.envelope_id = r.envelope_id AND a.status = 'active'` 和 `e.status NOT IN ('draft','unregistered','cancelled','deleted')`，结果去重。`applyInvoiceReviewDuplicateChecks` 只用每个有效附件当前轮次的最新行。删除语句的 `match_type` 列表加 `same_envelope`。去掉 `applyDuplicateChecks` 末尾写 `completed`（832）。`syncEnvelopeAuditState` 里 `duplicate_check_status` 只由识别进度决定，去掉写 `failed`（1325）。提交路由查重时也算识别结果。`/:id/precheck` 先 `syncEnvelopeAuditState`，等待时调 `ensureInvoiceReviews`，`task_id` 返回最新识别任务。

- [ ] **Step 4: 运行确认通过**

Run: `cd packages/api && npx vitest run test/reimbursement-duplicates.test.ts && npm test`
Expected: PASS。`reimbursement-precheck-duplicate-override.test.ts` 的放行规则不变。

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/services/reimbursement/duplicate-checks.ts packages/api/src/services/reimbursement/review-pipeline.ts packages/api/src/routes/reimbursement.ts packages/api/test/reimbursement-duplicates.test.ts
git commit -m "fix: 报销查重按每张发票，能查出同单重复，不和草稿比"
```

### Task 6: 合理性审查等识别完，修风险等级和 document_type

**Files:**
- Create: `packages/api/src/services/reimbursement/anomaly-result.ts`
- Create: `packages/api/src/services/reimbursement/anomaly-result.test.ts`
- Create: `packages/api/migrations/0093_reimbursement_anomaly_prompt_v2.sql`
- Modify: `packages/api/src/services/reimbursement/review-pipeline.ts`
- Modify: `packages/api/src/routes/admin.ts:166-172`
- Modify: `packages/api/src/routes/reimbursement.ts:3905,4068,4495,4553,4984,5777,5782`
- Modify: `task-runner/runner/executor.py:415-421`
- Modify: `.cf-runner-container/runner/executor.py`（和上面相同的改动）
- Test: `packages/api/test/reimbursement-review-pipeline.test.ts`

**Interfaces:**
- Produces: `normalizeAnomalyResult(raw: Record<string, unknown> | null): { risk_level: "low" | "medium" | "high" | null; summary: string | null; anomalies: { attachment_id: number | null; level: "low" | "medium" | "high"; reason: string }[]; recommendation: string | null }`。
- Produces: `ensureAnomalyReview(env: Env, envelopeId: number, options?: { force?: boolean }): Promise<number | null>`。
- Produces: `restartEnvelopeReview(env: Env, envelopeId: number): Promise<void>`：`precheck_status`、`duplicate_check_status` 改 pending，`silent_review_result` 清空，`ensureInvoiceReviews(..., { forceNewRound: true })`。
- `enqueueEnvelopeAiAudit` 删除。

- [ ] **Step 1: 写失败测试**

```ts
// anomaly-result.test.ts（src/）
it.each([["低","low"],["中","medium"],["中等","medium"],["待核验","medium"],["高","high"],["high","high"],["未知",null]])("%s 映射为 %s", /* ... */);
it("anomalies 缺 level 或 reason 的丢弃", /* ... */);
it("attachment_id 可为 null", /* ... */);

// review-pipeline（test/）
it("识别完才建合理性任务", /* 一张还在识别：null；全部结束：建一个，payload.invoices 有识别内容和 attachment_id */);
it("全部失败不建", /* 全 failed：null */);
it("草稿不建", /* draft 全部结束：null */);
it("指纹相同不重复建", /* 连续 sync：只有一个 anomaly 任务 */);
it("加附件后重跑", /* 加附件完成后 sync：第二个 anomaly 任务 */);
it("上次失败不自动重跑，force 可以", /* ... */);
it("结果写入 silent_review_result 时已规范", /* output risk_level=中 → ai_reasonability.risk_level=medium */);
it("OCR 全部完成后经 TASK_COMPLETED 建任务", /* 走 drainQueue */);
it("旧路径传附件仍把已退回的单交回办公室", /* PUT 带附件，precheck_status=supplement → pending；none 不变 */);
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/api && npx vitest run src/services/reimbursement/anomaly-result.test.ts test/reimbursement-review-pipeline.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 `ensureAnomalyReview`。** 条件：`force` 或（status 是 submitted、received，所有有效附件的识别已结束，至少一张 completed）。指纹是排序后的 `attachment_id:task_id` 列表，写入 payload 的 `review_fingerprint`；和最新 anomaly 任务的相同就返回 null。payload 在现有字段上加 `invoices[]`（`attachment_id`、`file_name`、`seller_name`、`buyer_name`、`invoice_no`、`invoice_date`、`amount`、`document_type`）。`syncEnvelopeAuditState` 末尾调用它，读取结果时过 `normalizeAnomalyResult`。

- [ ] **Step 4: 替换调用点。** 3905：`rerun_full !== false` 走 `restartEnvelopeReview`，否则 `ensureAnomalyReview(env, id, { force: true })`。4495、4553、5777、5782 走 `restartEnvelopeReview`。4068 走 `ensureInvoiceReviews`（Task 5 已改）。4984（`PUT`）：`precheck_status` 在 approved、supplement、rejected 时改 pending，然后 `ensureInvoiceReviews`。

- [ ] **Step 5: 提示词。** `admin.ts` 的 `prompt-reimbursement-anomaly-v1` 和迁移 0093 文本逐字相同（迁移写法照 0084，模板优先）。

system：

```text
你是企业报销审计助手，结果展示给办公室核查人员。只依据输入数据判断，不编造。所有文字用中文业务用语，不照抄英文字段名。只输出一个JSON对象，不要markdown代码块。字段固定为risk_level、summary、anomalies、recommendation。
```

user：

```text
请检查这张报销的费用是否合理。输入JSON={{payload_json}}
其中invoices是每个附件的识别结果，amount是申报金额，category和description是费用类别和说明。
重点看：发票内容和费用说明是否明显不相关、开票日期是否异常、同一销售方金额是否异常。金额合计和重复发票由系统另行核对，不要重复判断。发票号或金额为空只说明没读出来，不算异常。
输出JSON：{"risk_level":"low|medium|high","summary":"不超过60字","anomalies":[{"attachment_id":附件编号或null,"level":"low|medium|high","reason":"不超过40字"}],"recommendation":"不超过40字"}
没有问题时anomalies给空数组。
```

- [ ] **Step 6: runner 提示词。** `executor.py` 的输出结构加 `"document_type":"invoice|receipt|other"`，说明加：`document_type: invoice for tax invoices, receipt for handwritten or printed receipts and expense vouchers, other for anything else.`。`.cf-runner-container` 同步。

- [ ] **Step 7: 运行确认通过**

Run: `cd packages/api && npm test && npm run typecheck`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add packages/api/src/services/reimbursement packages/api/migrations/0093_reimbursement_anomaly_prompt_v2.sql packages/api/src/routes/admin.ts packages/api/src/routes/reimbursement.ts packages/api/test/reimbursement-review-pipeline.test.ts task-runner/runner/executor.py .cf-runner-container/runner/executor.py
git commit -m "fix: 费用合理性审查等识别完再跑，并能看到识别结果"
```

### Task 7: 重新提交真正生效

**Files:**
- Modify: `packages/api/src/routes/reimbursement.ts`（提交路由）
- Test: `packages/api/test/reimbursement-submit-recovery.test.ts`

**Interfaces:**
- Consumes: `publishEvent`、`REIMBURSEMENT_ENVELOPE_SUBMITTED`。
- Produces: 响应 `data: { id, status: "submitted", resubmitted: true }`。

- [ ] **Step 1: 写失败测试**

```ts
it.each(["supplement", "rejected"])("%s 的单重新提交回到办公室", /* status=submitted：precheck_status 和 verification_status 都变 pending，resubmitted=true，写 reimbursement.envelope.resubmit 审计，发事件 */);
it("普通已提交的单仍返回 already_submitted", /* precheck_status=pending：不改状态 */);
it("重新提交也要过查重", /* 有阻断重复且未 force：409 require_force_submit，状态不变 */);
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/api && npx vitest run test/reimbursement-submit-recovery.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现。** 在 `envelope.status === "submitted"` 分支判断 `precheck_status`。`writeAuditLog` 的 `action` 是 `reimbursement.envelope.resubmit`。

- [ ] **Step 4: 运行确认通过**

Run: `cd packages/api && npx vitest run test/reimbursement-submit-recovery.test.ts && npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/routes/reimbursement.ts packages/api/test/reimbursement-submit-recovery.test.ts
git commit -m "fix: 被退回的报销重新提交后真正回到办公室"
```

### Task 8: Part 1 上线

- [ ] **Step 1: 本地全量验证**

Run: `cd packages/api && npm test && npm run typecheck && npm run lint`
Expected: 全部通过；真实 SQL 测试没有被跳过（Node 22.5 以上）

Run: `cd packages/api && npm run db:migrate:local`
Expected: 0092、0093 应用成功

- [ ] **Step 2: 写开发记录。** `doc/开发记录.md` 追加本批内容。主工作区里未提交的 2026-11-06 20:50 条目一起带进本分支。

- [ ] **Step 3: 开 PR**，描述包含测试计划，末尾 `🤖 Generated with [Claude Code](https://claude.com/claude-code)`。

- [ ] **Step 4: 等 owner 同意后依次：** 查生产同轮重复行数量（只读）；应用迁移 0092、0093；合并；部署 runner（见记忆 `cf-runner-container-deploy`）。

- [ ] **Step 5: 验证。** `https://api.hybcdg.com/api/v1/system/health` 返回 `ok=true`。经 owner 同意后抽查下一批真实提交：任务数等于附件数，合理性任务在识别之后创建。

---

# Part 2：多附件和结论接口（PR 2）

### Task 9: 附件规则和新接口

**Files:**
- Create: `packages/api/src/services/reimbursement/attachment-rules.ts`
- Create: `packages/api/src/services/reimbursement/attachment-rules.test.ts`
- Create: `packages/api/src/routes/reimbursement-attachments.ts`
- Modify: `packages/api/src/routes/reimbursement.ts`（`POST /`、`PUT /:id`、`/electronic-upload`、删除路由、注册子路由）
- Test: `packages/api/test/reimbursement-attachments.test.ts`

**Interfaces:**
- Produces: `MAX_ATTACHMENTS_PER_ENVELOPE = 30`、`MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024`、`ALLOWED_ATTACHMENT_EXTENSIONS = ["pdf","jpg","jpeg","png"]`、`REIMBURSEMENT_KEY_PREFIX = "reimbursement/"`。
- Produces: `validateNewAttachments(env: Env, envelopeId: number | null, attachments: NewAttachmentInput[]): Promise<{ ok: true; attachments: NewAttachmentInput[] } | { ok: false; message: string }>`，用 `env.FILES.head` 回填实际大小。
- Produces: `POST /api/v1/reimbursement/:id/attachments` body `{ attachments: NewAttachmentInput[] }`，返回 `{ attachment_ids: number[] }`。
- Produces: `POST /api/v1/reimbursement/:id/attachments/:attachmentId/rerecognize`，返回 `{ task_id: number }`。

- [ ] **Step 1: 写失败测试**

```ts
// attachment-rules.test.ts
it.each(["a.pdf","A.PDF","a.JPG","a.jpeg","发票.2026.10.png"])("接受 %s", /* ... */);
it.each([["a.heic","只支持 PDF、JPG、PNG"],["a.webp","只支持 PDF、JPG、PNG"],["noext","只支持 PDF、JPG、PNG"]])("拒绝 %s", /* message 含文件名和该句 */);
it("超过 20MB 拒绝", /* head.size=20MB+1：message 含「不能超过 20MB」 */);
it("正好 20MB 接受", /* ... */);
it("第 31 个拒绝", /* 已有 30 个有效附件：message 含「最多 30 个」；已删的不计 */);
it("key 前缀不对拒绝", /* contract/x.pdf */);
it("R2 里不存在拒绝", /* head 返回 null */);
it("用实际大小，不信客户端", /* file_size=1，head.size=100：结果 100 */);

// reimbursement-attachments.test.ts
it("绑定后建识别任务，不跑合理性，不开新轮", /* ... */);
it("相同 file_key 重试返回已有记录", /* attachment_ids 相同，行数不变 */);
it("已复核通过的单增删后退出成批候选", /* approved → pending，candidates 不含它 */);
it("被退回的单增附件不自动交回", /* supplement 不变 */);
it("删除：draft 和被退回可以，普通已提交不行", /* ... */);
it("重新识别：只对 failed；已复核通过不行", /* recognized → 400；failed → 同一行新 task_id、状态 pending */);
it("重新识别权限", /* 申请人本人 draft 或被退回可以；别人 403；办公室角色 submitted、received 可以 */);
it("POST / 和 PUT 带附件走同样的规则并建识别任务", /* heic 400；pdf 建任务 */);
it("/electronic-upload 只加格式检查，其他不变", /* heic 400；已有发票且 replace 未传仍 409 */);
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/api && npx vitest run src/services/reimbursement/attachment-rules.test.ts test/reimbursement-attachments.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现。** 错误信息格式：`{文件名}：只支持 PDF、JPG、PNG`、`{文件名}：不能超过 20MB`、`一张报销最多 30 个附件`。权限沿用 spec 第 5 节的表。唤醒 runner 用 `c.executionCtx.waitUntil`，取不到时跳过（照 `routes/agent.ts:239`）。`/electronic-upload` 只加 `validateNewAttachments`。

- [ ] **Step 4: 运行确认通过**

Run: `cd packages/api && npm test && npm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/services/reimbursement/attachment-rules.ts packages/api/src/services/reimbursement/attachment-rules.test.ts packages/api/src/routes/reimbursement-attachments.ts packages/api/src/routes/reimbursement.ts packages/api/test/reimbursement-attachments.test.ts
git commit -m "feat: 报销附件统一规则，新增批量绑定和单张重新识别接口"
```

### Task 10: 废止原因

**Files:**
- Create: `packages/api/migrations/0094_reimbursement_void_reason.sql`
- Modify: `packages/api/src/routes/reimbursement.ts:5490-5526`
- Modify: `packages/api/src/types/reimbursement.ts`
- Test: `packages/api/test/reimbursement-attachments.test.ts`

**Interfaces:**
- Produces: `reimbursement_envelope.void_reason TEXT`；`POST /:id/void` 接受 `{ reason?: string }`。旧页面不传，所以接口不强制；必填在新弹窗。

- [ ] **Step 1: 写失败测试**

```ts
it("废止时保存原因并写进审计", /* void_reason='重复提交'，audit detail.reason 相同 */);
it("不传原因仍能废止", /* void_reason 为 null */);
it("原因超过 200 字拒绝", /* 400 */);
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/api && npx vitest run test/reimbursement-attachments.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现。** 迁移：`ALTER TABLE reimbursement_envelope ADD COLUMN void_reason TEXT;`

- [ ] **Step 4: 运行确认通过**

Run: `cd packages/api && npx vitest run test/reimbursement-attachments.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/api/migrations/0094_reimbursement_void_reason.sql packages/api/src/routes/reimbursement.ts packages/api/src/types/reimbursement.ts packages/api/test/reimbursement-attachments.test.ts
git commit -m "feat: 废止报销时保存原因"
```

### Task 11: 结论和提醒

**Files:**
- Create: `packages/api/src/services/reimbursement/guidance.ts`
- Create: `packages/api/src/services/reimbursement/guidance.test.ts`
- Modify: `packages/api/src/routes/reimbursement.ts:4209-4247`（`GET /:id`）
- Test: `packages/api/test/reimbursement-attachments.test.ts`

**Interfaces:**
- Consumes: `AttachmentReviewView`、`ReviewTotals`、`buildAttachmentViews`、`computeReviewTotals`、`normalizeAnomalyResult`。
- Produces:

```ts
export type GuidanceActionKey =
  | "verify" | "mark_mismatch" | "precheck_approve" | "precheck_supplement" | "precheck_reject"
  | "submit" | "resubmit" | "rerecognize_failed" | "scan_register" | "view_batch" | "open_batching";

export interface GuidanceAction { key: GuidanceActionKey; label: string; disabled?: boolean }

export interface Guidance {
  tone: "normal" | "warn" | "done";
  headline: string;
  next_step: string;
  note: string | null;
  actions: GuidanceAction[];
}

export interface EnvelopeGuidance { applicant: Guidance; office: Guidance | null }

export function buildEnvelopeGuidance(input: {
  envelope: Pick<ReimbursementEnvelope,
    "status" | "channel" | "amount" | "envelope_uuid" | "precheck_status" | "precheck_comment"
    | "verification_status" | "verification_note" | "batch_id" | "duplicate_check_status"> & { void_reason: string | null };
  views: AttachmentReviewView[];
  totals: ReviewTotals;
  envelopeDuplicateCount: number; // 阻断级且没有 attachment_id 的整单匹配
  einvoiceDetected: boolean;
  batchStatus: string | null;
  canOfficeAudit: boolean;
}): EnvelopeGuidance;
```

- `GET /:id` 新增返回 `guidance`、`attachment_views`、`review_totals`。申请人（`canOfficeAudit` 为假）收到的 `attachment_views` 里 `attention` 一律为 null。其他字段不变。
- 按钮文字：`verify` 核查签收、`mark_mismatch` 标记异常、`precheck_approve` 复核通过、`precheck_supplement` 要求补充、`precheck_reject` 驳回、`submit` 提交报销、`resubmit` 重新提交、`rerecognize_failed` 重新识别、`scan_register` 扫码登记、`view_batch` 查看批次、`open_batching` 去成批。
- `tone`：结论是问题（重复、混入电子发票、失败、没金额、差额、异常、驳回、被驳回批次）为 `warn`；`paid` 和 `cancelled` 为 `done`；其余 `normal`。
- 金额格式 `¥1,568.95`。

- [ ] **Step 1: 写失败测试。** 表驱动，spec 第 6 节**每一行一个用例**，断言 `headline`、`next_step`、`actions` 的键和顺序，每行的说法逐字来自 spec。另加：

```ts
it("优先级：重复优先于差额", /* 有重复又有差额：显示重复 */);
it("批次被驳回优先于已复核", /* received + approved + batchStatus=rejected：所在批次被驳回 */);
it("草稿和未登记 office 为 null", /* canOfficeAudit=true：office=null */);
it("不能自审时 office 为 null", /* canOfficeAudit=false */);
it("只有整单级重复时说法不同", /* envelopeDuplicateCount=1，无发票级：这张报销疑似和其他报销重复 */);
it("手写收据和没读出金额说法不同", /* not_invoice：N 个附件是手写收据；no_amount：N 个附件没读出金额 */);
it("废止没有原因只显示后一句", /* next_step='不再流转。' */);
it("留意只进 office.note，不改结论", /* attention 有值：headline 不变，note 以「需要留意：」开头；applicant.note 为 null */);
it("历史已付款老单没有识别行不报错", /* views 全 not_recognized，paid：已打款 ¥X */);
it("电子发票已提交只显示前一句", /* 现在不用做什么。 */);
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/api && npx vitest run src/services/reimbursement/guidance.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现。** 申请人和办公室各一个按序匹配的规则列表。`canOfficeAudit` 口径同网页 `canOfficeAudit`（`detail.vue:165`）：`hasOfficeRole && (!isApplicant || super_admin || finance)`。`einvoiceDetected` 用现有 `detectEInvoiceInPhysical`。

- [ ] **Step 4: 接到 `GET /:id`**，加测试：响应带三个新字段，申请人看不到 `attention`。

- [ ] **Step 5: 运行确认通过**

Run: `cd packages/api && npm test && npm run typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/services/reimbursement/guidance.ts packages/api/src/services/reimbursement/guidance.test.ts packages/api/src/routes/reimbursement.ts packages/api/test/reimbursement-attachments.test.ts
git commit -m "feat: 报销详情接口返回结论、提醒和每个附件的状态"
```

### Task 12: 旧网页页面支持多选

**Files:**
- Modify: `packages/web/src/views/finance/reimbursement/detail.vue:1803-1817,890-935`

- [ ] **Step 1: 改 `el-upload`。** 加 `multiple`，`accept=".pdf,.jpg,.jpeg,.png"`。`uploadingAttachment` 改成进行中计数，避免一个结束就解除按钮。`attachmentItems` 用不可变更新。

- [ ] **Step 2: 验证。** `cd packages/web && npm run typecheck && npm test`，通过。用 `preview_start` 起 `api` 和 `web`（登录做法见记忆 `local-web-preview-login-trick`），一次传 3 个文件，确认保存后接口返回 3 个附件。

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/views/finance/reimbursement/detail.vue
git commit -m "feat: 网页报销可以一次选多个附件"
```

### Task 13: 小程序上传队列和视图

**Files:**
- Create: `packages/miniapp/utils/upload-queue.js`
- Create: `packages/miniapp/utils/upload-queue.test.js`
- Create: `packages/miniapp/utils/reimbursement-view.js`
- Create: `packages/miniapp/utils/reimbursement-view.test.js`

**Interfaces:**
- Produces: `createUploadQueue({ concurrency, uploadOne, onChange })`，返回 `{ add(files), retry(localId), getItems(), isBusy() }`。`items` 每项 `{ localId, name, size, status: "waiting" | "uploading" | "failed" | "done", error }`。文件名和大小都相同的跳过并在 `add` 的返回值 `skipped` 里列出。
- Produces: `buildReimbursementView(detail, { uploadItems })`，返回 `{ headline, nextStep, tone, actions, rows, totalsText, canSubmit, declaredAmountDefault }`。`rows` 合并上传项和 `attachment_views`，上传中和失败的在最前。没有 `guidance` 时（接口未升级）回退到中性文案。
- Produces: `validatePickedFile(name)`，后缀不在 pdf、jpg、jpeg、png 时返回错误文案。

- [ ] **Step 1: 写失败测试**（node assert，照 `utils/contract-detail-page.test.js`）

```js
// upload-queue
"同时最多 2 个";
"一个失败其余继续，isBusy 到全部结束才为 false";
"retry 只重传失败的那个";
"重复文件被跳过";
// reimbursement-view
"上传中覆盖结论为「还有 N 张发票没传完」，canSubmit=false";
"有失败项时 canSubmit=false";
"显示 guidance.applicant 的结论和按钮";
"金额默认等于已识别合计；手动改过不覆盖";
"大写后缀通过；heic 报错";
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/miniapp && node utils/upload-queue.test.js`
Expected: 报错退出

- [ ] **Step 3: 实现** 两个模块。

- [ ] **Step 4: 运行确认通过**

Run: `cd packages/miniapp && node utils/upload-queue.test.js && node utils/reimbursement-view.test.js`
Expected: 正常退出

- [ ] **Step 5: Commit**

```bash
git add packages/miniapp/utils/upload-queue.js packages/miniapp/utils/upload-queue.test.js packages/miniapp/utils/reimbursement-view.js packages/miniapp/utils/reimbursement-view.test.js
git commit -m "feat: 小程序报销的上传队列和页面视图"
```

### Task 14: 小程序报销页

**Files:**
- Modify: `packages/miniapp/packageFinance/reimbursement/index.js`、`index.wxml`、`index.wxss`
- Create: `packages/miniapp/utils/reimbursement-page.test.js`

**Interfaces:**
- Consumes: Task 13 的三个函数，`POST /:id/attachments`、`/rerecognize`、`/delete`、`guidance`、`attachment_views`、`review_totals`。
- 路由 `packageFinance/reimbursement/index` 和入口参数不变。

- [ ] **Step 1: 写页面流程失败测试**（真实页面代码，只替换接口和文件选择，照 `contract-detail-page.test.js`）

```js
"一次选 3 张：3 次绑定，只调 POST /attachments，不调 /electronic-upload";
"电子通道第一张传完自动建草稿，后面传到同一单";
"传的过程中提交不可点，传完可点";
"失败的可重试，成功后提交可点";
"被退回时显示办公室原话，按钮是重新提交，并能删除附件";
"已提交时没有提交按钮";
"提交返回 require_force_submit 时仍走坚持提交确认";
"绑定时带 file_size";
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/miniapp && node utils/reimbursement-page.test.js`
Expected: 报错退出

- [ ] **Step 3: 改页面。** 按 spec 第 8 节的顺序排布。选择器：`wxChooseMediaImage({ count: 9 })`、`wxChooseMessageFile({ count: 30, type: "file" })`、`wxChooseLocalFile({ count: 30, extension: ["pdf","jpg","jpeg","png"] })`。`uploadFileToR2` 的 `category` 保持 `"reimbursement"`。去掉 spec 第 8 节列出的元素。逻辑放到 `utils/`，`index.js` 降到 800 行以内。

- [ ] **Step 4: 运行确认通过**

Run: `cd packages/miniapp && node utils/reimbursement-page.test.js && npx tsc --noEmit`
Expected: 正常退出。其余小程序测试也跑一遍。

- [ ] **Step 5: 模拟器验证。** 用「企业微信小程序」编译模式（见记忆 `miniapp-desktop-simulator-login-fails`），一次传多张并提交。

- [ ] **Step 6: Commit**

```bash
git add packages/miniapp/packageFinance/reimbursement packages/miniapp/utils/reimbursement-page.test.js
git commit -m "feat: 小程序报销页显示结论和提醒，可一次传多个附件"
```

### Task 15: Part 2 上线

- [ ] **Step 1: 本地全量验证**

Run: `cd packages/api && npm test && npm run typecheck && npm run lint`
Expected: 通过

Run: `cd packages/web && npm test && npm run typecheck`
Expected: 通过

- [ ] **Step 2: 写文档。** `doc/开发记录.md` 追加；`doc/UI设计文档.md` 更新小程序报销页。

- [ ] **Step 3: 开 PR。**

- [ ] **Step 4: 等 owner 同意后：** 应用迁移 0094；合并；验证 `system/health`。小程序由 owner 真机验证和提审。

---

# Part 3：网页详情页（PR 3）

### Task 16: 页面逻辑

**Files:**
- Create: `packages/web/src/views/finance/reimbursement/detail/view-model.ts`
- Create: `packages/web/src/views/finance/reimbursement/detail/view-model.test.ts`
- Modify: `packages/web/src/api/reimbursement.ts`

**Interfaces:**
- Consumes: Task 11 接口字段。在 `api/reimbursement.ts` 加同名类型（`AttachmentReviewView`、`ReviewTotals`、`Guidance`、`EnvelopeGuidance`），`ReimbursementEnvelopeDetail` 加 `guidance`、`attachment_views`、`review_totals`，并加 `addEnvelopeAttachments`、`rerecognizeAttachment`、`deleteEnvelopeAttachment`；`voidReimbursementEnvelope(id, reason?)`。
- Produces:

```ts
export type PickerSelection = { kind: "info" } | { kind: "attachment"; attachmentId: number };
export function sortAttachmentViews(views: AttachmentReviewView[]): AttachmentReviewView[];
export function defaultSelection(views: AttachmentReviewView[], usingOfficeGuidance: boolean, isEditableDraft: boolean): PickerSelection;
export function resolveGuidance(detail: ReimbursementEnvelopeDetail | null, ctx: { workspaceView: boolean; uploadingCount: number; isCreate: boolean }): Guidance;
export function declaredAmountDefault(input: { storedAmount: number; extractedTotal: number; touched: boolean; currentValue: number }): number;
export function totalsDisplay(totals: ReviewTotals): { extracted: string; declared: string; delta: string | null; tone: "ok" | "warn" | "none" };
export function pickerGroupTitle(views: AttachmentReviewView[]): string; // 发票 N 张 或 附件 N 个
```

- [ ] **Step 1: 写失败测试**

```ts
it("排序：有问题的在前，然后留意，再按金额从大到小", /* ... */);
it("办公室默认选有问题的；没有问题选金额最大的", /* ... */);
it("草稿默认选报销信息", /* isEditableDraft=true → info */);
it("工作台用 applicant；其他入口有 office 用 office；office 为 null 用 applicant", /* ... */);
it("上传中覆盖结论", /* uploadingCount=2：还有 2 张发票没传完；传完确认金额，就可以提交了。；submit disabled */);
it("新建时结论", /* isCreate=true：先选项目，再把发票传上来 */);
it("金额没改过时跟着识别合计，改过不覆盖", /* touched=true 不变 */);
it("已保存的金额优先于识别合计", /* storedAmount=100，extractedTotal=120，touched=false → 100 */);
it("没读全显示「算不出」", /* recognized_count=0 → extracted='算不出'，tone none */);
it("部分读出显示合计和缺几个", /* extracted 含「另有 1 个没有金额」 */);
it("有差额显示多或少", /* delta=0.04 → 多 ¥0.04，warn；delta=-1 → 少 ¥1.00 */);
it("分组标题", /* 全是发票：发票 3 张；有 not_invoice：附件 3 个 */);
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/web && npm test -- src/views/finance/reimbursement/detail/view-model.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现**，全部是纯函数，不可变。

- [ ] **Step 4: 运行确认通过**

Run: `cd packages/web && npm test -- src/views/finance/reimbursement/detail/view-model.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/views/finance/reimbursement/detail/view-model.ts packages/web/src/views/finance/reimbursement/detail/view-model.test.ts packages/web/src/api/reimbursement.ts
git commit -m "feat: 报销详情页的排序、默认选中和合计显示逻辑"
```

### Task 17: 上传 composable

**Files:**
- Create: `packages/web/src/views/finance/reimbursement/detail/useEnvelopeUploads.ts`
- Create: `packages/web/src/views/finance/reimbursement/detail/useEnvelopeUploads.test.ts`

**Interfaces:**
- Produces: `useEnvelopeUploads(options: { ensureEnvelopeId: () => Promise<number>; onBound: () => Promise<void> }): { items: Ref<UploadItem[]>; uploadingCount: ComputedRef<number>; hasFailed: ComputedRef<boolean>; addFiles(files: File[]): { skipped: string[]; rejected: { name: string; message: string }[] }; retry(localId: string): void; dismiss(localId: string): void }`。
- `UploadItem`: `{ localId: string; file: File; name: string; progress: number; status: "waiting" | "uploading" | "failed" | "done"; error: string | null }`。进度用 `XMLHttpRequest.upload.onprogress`。

- [ ] **Step 1: 写失败测试**（mock 签名、上传、绑定）

```ts
it("同时最多 3 个", /* ... */);
it("一个失败其余继续，uploadingCount 到全部结束才为 0", /* ... */);
it("retry 只重传失败的", /* ... */);
it("相同文件名和大小跳过", /* skipped 含它 */);
it("后缀不对当场拒绝且不上传", /* a.heic → rejected */);
it("大于 20MB 当场拒绝", /* ... */);
it("多个文件同时开始也只建一个草稿", /* ensureEnvelopeId 被并发调用，真正创建只发生一次 */);
it("绑定成功后从 items 移除并通知刷新", /* onBound 调用；items 少一项 */);
it("轮询刷新不影响进度", /* 外部刷新 detail 期间 items 不变 */);
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/web && npm test -- src/views/finance/reimbursement/detail/useEnvelopeUploads.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现。** `ensureEnvelopeId` 的并发去重放在 composable 内部，缓存同一个 Promise。

- [ ] **Step 4: 运行确认通过**

Run: `cd packages/web && npm test -- src/views/finance/reimbursement/detail/useEnvelopeUploads.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/views/finance/reimbursement/detail/useEnvelopeUploads.ts packages/web/src/views/finance/reimbursement/detail/useEnvelopeUploads.test.ts
git commit -m "feat: 报销详情页的多文件上传逻辑"
```

### Task 18: 搬出操作逻辑

纯搬移，版面还不变。

**Files:**
- Create: `packages/web/src/views/finance/reimbursement/detail/useEnvelopeActions.ts`
- Modify: `packages/web/src/views/finance/reimbursement/detail.vue`

**Interfaces:**
- Produces: `useEnvelopeActions(deps)`，导出 `save`、`scanSubmit`、`submitEnvelope`（含坚持提交流程）、`voidEnvelope(reason)`、`verify`、`rerunSilentReview`、`submitPrecheck`（含重复和电子发票放行）、`submitRebindEnvelopeUuid`、`onSwitchChannel`、`saveInvoiceTitle`，以及现有 `canSplit`、`canRebindUuid`、`canSwitchChannel`、`canEditInvoiceTitle`、`canEdit`、`canOfficeAudit`。

- [ ] **Step 1: 搬移。** 函数体不变（`detail.vue:251,804,838,966,1037,1067,1153,1180,1210,1248,1278,1315`）。`voidEnvelope` 增加原因参数。

- [ ] **Step 2: 验证**

Run: `cd packages/web && npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/views/finance/reimbursement/detail
git commit -m "refactor: 把报销详情页的操作逻辑移到 composable"
```

### Task 19: 新版面

**Files:**
- Create: `packages/web/src/views/finance/reimbursement/detail/VerdictHeader.vue`
- Create: `packages/web/src/views/finance/reimbursement/detail/AttachmentPicker.vue`
- Create: `packages/web/src/views/finance/reimbursement/detail/AttachmentViewer.vue`
- Create: `packages/web/src/views/finance/reimbursement/detail/EnvelopeInfoPanel.vue`
- Create: `packages/web/src/views/finance/reimbursement/detail/TotalsBar.vue`
- Create: `packages/web/src/views/finance/reimbursement/detail/MoreActionsMenu.vue`
- Create: `packages/web/src/views/finance/reimbursement/detail/ActionDialogs.vue`
- Modify: `packages/web/src/views/finance/reimbursement/detail.vue`（变成薄入口）

**Interfaces:**
- Consumes: Task 16、17、18。
- `detail.vue` 的 props（`envelopeId`、`drawerMode`、`workspaceView`）和 emits（`close`、`changed`、`created`）不变。

- [ ] **Step 1: 写组件。** 版面、色值、字号按 spec 7.1 和样稿。按钮来自 `guidance.actions`，第一个是主按钮，按键名映射到 `useEnvelopeActions`。spec 7.3 的表逐行落实。原件用 `resolveViewableFileUrl`，图片 `<img>`，PDF `<iframe>`，每次切换重新取地址。复用现有 `ensureAuditPolling`，识别中才轮询，不再有手动刷新。上下排列用容器查询（`container-type: inline-size`，`@container (max-width: 860px)`），不用 `@media`，因为页面也放在抽屉里。不新增全局样式。

- [ ] **Step 2: 验证类型和测试**

Run: `cd packages/web && npm run typecheck && npm test && npm run lint:check`
Expected: 类型和测试通过；lint 没有新增错误（不用 `--fix`）

- [ ] **Step 3: 本地浏览器核对。** 起 `api` 和 `web`（做法见记忆 `local-web-preview-login-trick`），`npm run db:seed:mock:local` 后用 SQL 造数据，逐项核对并截图：
  - 322 的情况：差额结论，默认选中金额最大的发票
  - 新建：选项目，拖 4 个文件，一个失败可重试，提交在传完前不可点
  - 327 的情况：显示「算不出」和系统读到的内容
  - 被退回的单：办公室原话，重新提交生效
  - 抽屉模式（`batch.vue`、`office-workbench.vue`）：窄宽度上下排列，没有横向滚动
  - 手机宽度 375px
  - 更多菜单：换绑、切换通道、拆单、全部重新识别、废止（必填原因）
  - 报销信息：抬头保存、费用日期、PDF 状态、批次

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/views/finance/reimbursement/detail packages/web/src/views/finance/reimbursement/detail.vue
git commit -m "feat: 重做报销详情页，上方结论和提醒，下方边看边核"
```

### Task 20: Part 3 上线

- [ ] **Step 1: 本地全量验证**

Run: `cd packages/web && npm test && npm run typecheck && npm run build`
Expected: 通过

- [ ] **Step 2: 写文档。** `doc/UI设计文档.md` 更新报销详情页；`doc/开发记录.md` 追加。

- [ ] **Step 3: 开 PR，owner 看过后合并。** 推送前查 `cloudflarestatus`（见记忆 `deploy-skew-and-cf-incident-check`）。

- [ ] **Step 4: 线上验证。** 经 owner 同意后打开 323、322、327，确认结论和样稿一致。
