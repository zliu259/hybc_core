# D1 事务降级加固 + 补偿失败巡检告警 实施计划

**Goal:** 消除 `runInTransaction` 在 D1 生产环境静默降级为非事务执行所导致的部分写入风险；让补偿失败从「只打 console.error」变成可查询、可告警、可巡检。

**背景：** `services/db-transaction.ts` 的 `runInTransaction` 在 D1 生产环境捕获 "BEGIN TRANSACTION 不支持" 后**降级为非事务执行**，`throw` 不回滚。本地 wrangler（better-sqlite3）支持事务，所以只有生产会炸。拆单端点已在上一批加固，本次收敛其余站点。

**核心事实（已查证 Cloudflare 官方文档）：** `db.batch([...])` 的语句是真正的 SQL 事务——任一语句**报错**即回滚整个序列。但**逻辑守卫（UPDATE 匹配 0 行）不是错误，不会触发回滚**，所以守卫要么放在 batch 之外，要么用 `EXISTS` 子查询复制进 batch 内每条语句。本仓库此前 `db.batch` 使用次数为 0。

**Tech Stack:** Hono / Cloudflare D1 / vitest。

---

## 风险分级（已逐站点读码确认）

| 站点 | 端点 | 写序列 | 降级模式下的部分写入后果 | 等级 |
|---|---|---|---|---|
| `reimbursement.ts:2136` | `POST /batch` | INSERT batch → 循环(INSERT item + 守卫 UPDATE envelope) | 幽灵批次：batch 行 + 部分 items + 部分信封被标记 batched | **HIGH** |
| `reimbursement.ts:4090` | `POST /:id/rebind-uuid` | 3× UPDATE envelope（UUID 三步交换） | 占位信封永久停留在随机 tempUuid，实体信封扫码失联 | **HIGH** |
| `reimbursement.ts:3172` | `PUT /batch/:id/items/:envelopeId/basic-info` | UPDATE envelope → UPDATE item → SELECT SUM → UPDATE batch | 信封金额已改而批次总额陈旧 → 财务金额漂移 | **HIGH** |
| `reimbursement.ts:2638` | `POST /batch/:id/submit-approval`（主路径） | 守卫 UPDATE batch → UPDATE envelopes | batch=pending_approval 而信封状态滞后 | MEDIUM |
| `reimbursement.ts:2507` | 同上（resubmit 路径） | UPDATE batch → UPDATE envelopes | 同上 | MEDIUM |
| `reimbursement.ts:2801` | `POST /batch/:id/mark-paid` | 守卫 UPDATE batch → UPDATE envelopes | batch=paid 而信封未 paid | MEDIUM |

**不自动回滚付款**：MEDIUM 站点一律**不做自动补偿**（自动撤销 `paid` 状态本身有害）。改用「守卫复制进每条语句 + 整体 db.batch」使其要么全写要么零写，从根上消灭部分写入。

---

## 文件地图

| 文件 | 动作 | 职责 |
|---|---|---|
| `packages/api/src/services/db-transaction.ts` | 修改 | 新增 `runAtomicBatch`；给 `runInTransaction` 加显著警告注释 |
| `packages/api/src/services/db-transaction.test.ts` | 修改 | 补 `runAtomicBatch` 测试 |
| `packages/api/src/services/transaction-recovery.ts` + `.test.ts` | 新建 | 补偿失败上报（审计日志 + 领域事件 + console.error） |
| `packages/api/src/services/reimbursement-integrity.ts` + `.test.ts` | 新建 | 数据一致性巡检查询 + 结果汇总（纯函数部分可测） |
| `packages/api/src/services/event-bus.ts` | 修改 | 注册 2 个新事件 |
| `packages/api/src/routes/reimbursement.ts` | 修改 | 6 个站点加固 |
| `packages/api/src/routes/reimbursement-tx-hardening.test.ts` | 新建 | 路由级回归测试（mock D1，断言 batch 用法与守卫） |
| `packages/api/src/routes/system.ts` | 修改 | 新增 `GET /integrity/reimbursement`（仅超管） |
| `packages/api/src/services/cron-jobs.ts` / `scheduled.ts` | 修改 | 每日巡检并在发现问题时告警 |
| `doc/开发记录.md` | 追加 | 记录 |

---

## Task 1: `runAtomicBatch` helper（TDD）

**Files:** `services/db-transaction.ts`、`services/db-transaction.test.ts`

- [ ] **Step 1: 先写失败测试**（追加到既有 test 文件）

覆盖：
1. 把 statements 原样传给 `db.batch` 并按序返回结果；
2. `db.batch` 抛错时原样向上抛（不吞）；
3. 空数组直接返回 `[]` 且**不调用** `db.batch`。

- [ ] **Step 2: 跑测试确认 RED**

Run: `cd packages/api && npx vitest run src/services/db-transaction.test.ts`

- [ ] **Step 3: 实现**

```ts
/**
 * D1 上唯一真正原子的写原语。
 *
 * `db.batch()` 的语句在一个隐式 SQL 事务中顺序执行；任一语句**报错**即回滚整个序列
 * （Cloudflare 官方文档）。
 *
 * ⚠️ 注意：带守卫的 UPDATE 匹配 0 行属于「成功执行、影响 0 行」，**不是错误**，
 * 因此不会触发回滚。逻辑守卫要么置于 batch 之外先行判定，要么用 EXISTS 子查询
 * 复制进 batch 内的每一条语句。
 *
 * 优先用本函数替代 {@link runInTransaction}（后者在 D1 生产环境不回滚）。
 */
export const runAtomicBatch = async (
  db: D1Database,
  statements: D1PreparedStatement[]
): Promise<D1Result[]> => {
  if (statements.length === 0) return [];
  return db.batch(statements);
};
```

同时给 `runInTransaction` 的 JSDoc 顶部加醒目警告，指向 `runAtomicBatch`。

- [ ] **Step 4: GREEN + 提交**

```bash
git commit -m "feat(api): 新增 runAtomicBatch，D1 上唯一真正原子的写原语"
```

---

## Task 2: 补偿失败上报服务（TDD）

**Files:** `services/transaction-recovery.ts` + `.test.ts`、`services/event-bus.ts`

- [ ] **Step 1: 注册事件类型**

`event-bus.ts` 的 `domainEventTypes` 追加（放在 REIMBURSEMENT_* 之后）：

```ts
  "TRANSACTION_COMPENSATION_FAILED",
  "REIMBURSEMENT_INTEGRITY_ISSUES_FOUND",
```

- [ ] **Step 2: 先写失败测试**

覆盖 `reportCompensationFailure`：
1. 写审计日志，`action === "system.transaction.compensation_failed"`；
2. 发布 `TRANSACTION_COMPENSATION_FAILED` 事件；
3. **上报自身失败时不得抛出**（吞掉并 console.error）——因为它总是在 catch 里被调用，抛出会掩盖原始错误；
4. detail 中包含 `operation` / `originalError` / `compensationError` 的字符串化信息。

- [ ] **Step 3: RED** → **Step 4: 实现**

```ts
import { writeAuditLog } from "./audit-log";
import { publishEvent } from "./event-bus";
import type { Env } from "../types/env";

const toMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export type CompensationFailureReport = {
  operation: string;
  targetType: string;
  targetId: number;
  actorUserId?: string;
  actorRoles?: string[];
  originalError: unknown;
  compensationError: unknown;
  context?: Record<string, unknown>;
};

/**
 * 补偿逻辑自身失败时的上报：留下可查询、可告警的持久痕迹。
 * 本函数**永不抛出**——它总是在 catch 中被调用，抛出会掩盖原始错误。
 */
export const reportCompensationFailure = async (
  env: Env,
  report: CompensationFailureReport
): Promise<void> => {
  const detail = {
    operation: report.operation,
    original_error: toMessage(report.originalError),
    compensation_error: toMessage(report.compensationError),
    ...report.context
  };

  console.error("Transaction compensation failed", {
    target: `${report.targetType}#${report.targetId}`,
    ...detail
  });

  try {
    await writeAuditLog(env.DB, {
      actorUserId: report.actorUserId ?? "system",
      actorRoles: report.actorRoles ?? [],
      action: "system.transaction.compensation_failed",
      targetType: report.targetType,
      targetId: report.targetId,
      detail
    });
  } catch (auditError) {
    console.error("Failed to persist compensation-failure audit log", auditError);
  }

  try {
    await publishEvent(env, "TRANSACTION_COMPENSATION_FAILED", report.targetType, {
      ...detail,
      target_id: report.targetId
    });
  } catch (eventError) {
    console.error("Failed to publish compensation-failure event", eventError);
  }
};
```

- [ ] **Step 5: 把拆单端点的裸 `console.error` 换成本函数**

`reimbursement.ts` 的 `POST /:id/split` 补偿 catch 块内两处 `console.error(...)` → `await reportCompensationFailure(c.env, {...})`，`operation: "reimbursement.envelope.split"`，`targetType: "reimbursement_envelope"`，`targetId: id`，`context: { new_envelope_id: newId, moved_attachment_ids: attachmentIds }`，带上 `actorUserId: auth.sub` / `actorRoles: auth.roles`。

- [ ] **Step 6: GREEN + 提交**

```bash
git commit -m "feat(api): 补偿失败上报服务（审计日志+领域事件），拆单端点接入"
```

---

## Task 3: rebind-uuid 改为真原子（HIGH）

**Files:** `routes/reimbursement.ts`（约 4089-4108）

三条 UPDATE 之间**没有中间读取**，可直接整体 `runAtomicBatch`。

- [ ] **Step 1: 先写路由级失败测试**（写入 `routes/reimbursement-tx-hardening.test.ts`）

**必须仿照既有的 `routes/reimbursement-detail-status-guard.test.ts` 的做法**：先读那个文件学习它如何 mock D1（记录 `prepare` 调用的 SQL 与 bind 参数）并驱动真实 Hono 路由。

断言：
1. rebind-uuid 走到「UUID 三步交换」分支时，调用了 `DB.batch` **恰好一次**，且传入 3 条语句；
2. **没有**调用 `db.exec("BEGIN IMMEDIATE TRANSACTION")`；
3. 三条语句的 bind 参数顺序为：`(tempUuid, tempUuid, now, occupied.id)`、`(nextUuid, nextUuid, now, envelope.id)`、`(oldUuid, oldUuid, now, occupied.id)`。

失败信息要写明：「拆成多次 prepare().run() 会在 D1 生产环境留下 tempUuid 孤儿，实体信封扫码失联」。

- [ ] **Step 2: RED** → **Step 3: 实现**

把 `runInTransaction(...)` 替换为：

```ts
      await runAtomicBatch(c.env.DB, [
        c.env.DB.prepare(
          "UPDATE reimbursement_envelope SET envelope_uuid = ?, envelope_no = ?, updated_at = ? WHERE id = ?"
        ).bind(tempUuid, tempUuid, now, occupied.id),
        c.env.DB.prepare(
          "UPDATE reimbursement_envelope SET envelope_uuid = ?, envelope_no = ?, updated_at = ? WHERE id = ?"
        ).bind(nextUuid, nextUuid, now, envelope.id),
        c.env.DB.prepare(
          "UPDATE reimbursement_envelope SET envelope_uuid = ?, envelope_no = ?, updated_at = ? WHERE id = ?"
        ).bind(envelope.envelope_uuid, envelope.envelope_uuid, now, occupied.id)
      ]);
```

- [ ] **Step 4: GREEN + 提交**

```bash
git commit -m "fix(api): 信封UUID三步交换改用 db.batch 原子提交，消除 tempUuid 孤儿风险"
```

---

## Task 4: basic-info 改为真原子（HIGH）

**Files:** `routes/reimbursement.ts`（约 3172 起）

当前中间夹了一次 `SELECT SUM/COUNT` 再回写 batch。把该聚合改写为 UPDATE 内的子查询，三条 UPDATE 即可整体原子。

- [ ] **Step 1: 先写失败测试**（追加到 `reimbursement-tx-hardening.test.ts`）

断言：
1. 调用 `DB.batch` 一次、传入 3 条语句；
2. 第三条语句的 SQL 同时包含 `SUM(amount)` 与 `COUNT(*)` 子查询（即总额在同一原子序列内重算，而非先读后写）；
3. 未调用 `BEGIN IMMEDIATE TRANSACTION`。

失败信息写明：「先 SELECT 再 UPDATE 在降级模式下会让信封金额与批次总额漂移」。

- [ ] **Step 2: RED** → **Step 3: 实现**

```ts
    await runAtomicBatch(c.env.DB, [
      c.env.DB.prepare(
        `UPDATE reimbursement_envelope
            SET invoice_unique_no = ?, invoice_no = ?, expense_date = ?,
                amount = ?, category = ?, description = ?, updated_at = ?
          WHERE id = ?`
      ).bind(
        sanitizeInvoiceUniqueNo(nextInvoiceNo),
        nextInvoiceNo,
        nextExpenseDate,
        nextAmount,
        nextCategory,
        nextDescription,
        now,
        envelopeId
      ),
      c.env.DB.prepare(
        "UPDATE reimbursement_batch_item SET amount = ? WHERE batch_id = ? AND envelope_id = ?"
      ).bind(nextAmount, id, envelopeId),
      // 总额/条数在同一原子序列内由子查询重算，避免「先读后写」的漂移窗口
      c.env.DB.prepare(
        `UPDATE reimbursement_batch
            SET total_amount = (
                  SELECT COALESCE(SUM(amount), 0) FROM reimbursement_batch_item
                   WHERE batch_id = ? AND status = 'active'
                ),
                item_count = (
                  SELECT COUNT(*) FROM reimbursement_batch_item
                   WHERE batch_id = ? AND status = 'active'
                ),
                updated_at = ?
          WHERE id = ?`
      ).bind(id, id, now, id)
    ]);
```

若原代码在事务后使用了 `totalRow` 的值构造响应，改为**事务后单独 SELECT 一次**再返回（读一致性不影响正确性）。请按实际代码调整并在报告中说明。

- [ ] **Step 4: GREEN + 提交**

```bash
git commit -m "fix(api): 批次条目基础信息编辑改用 db.batch，总额在原子序列内重算"
```

---

## Task 5: submit-approval 与 mark-paid 改为「守卫内嵌 + 全原子」（MEDIUM）

**Files:** `routes/reimbursement.ts`（2507、2638、2801）

**模式**：把守卫条件复制进 batch 内的**每一条**语句，并把「改变守卫所依赖状态」的那条排在**最后**。这样守卫不成立时两条都影响 0 行、零写入；守卫成立时全部写入。整体 `runAtomicBatch`，无需自动补偿（**绝不自动撤销 paid 状态**）。

以 mark-paid（2801）为例：

```ts
    const results = await runAtomicBatch(c.env.DB, [
      // 先改信封，其守卫依赖批次的「旧」状态（此刻尚未被下一条改写）
      c.env.DB.prepare(
        `UPDATE reimbursement_envelope
            SET status = 'paid', updated_at = ?
          WHERE batch_id = ?
            AND EXISTS (SELECT 1 FROM reimbursement_batch WHERE id = ? AND status = 'approved')`
      ).bind(now, id, id),
      // 再改批次本身（同一守卫）
      c.env.DB.prepare(
        `UPDATE reimbursement_batch
            SET status = 'paid', paid_at = ?, ..., updated_at = ?
          WHERE id = ? AND status = 'approved'`
      ).bind(/* ... */)
    ]);

    const batchChanges = results[results.length - 1]?.meta?.changes ?? 0;
    if (batchChanges !== 1) {
      return c.json(
        { success: false, error: { message: "Batch is no longer in approved status" } },
        400
      );
    }
```

对 2638（submit-approval 主路径，守卫 `status='draft'`）与 2507（resubmit 路径）套用同一模式，守卫状态按各自原有条件填写。**保持各自原有的 400/409 错误语义与文案不变。**

- [ ] **Step 1: 先写失败测试**（追加到 `reimbursement-tx-hardening.test.ts`）

对三个站点各断言：
1. 用了 `DB.batch`；
2. batch 内**每条**语句的 SQL 都含守卫（`status = 'approved'` / `'draft'` 或 `EXISTS (... status = ...)`）；
3. 改变批次状态的语句是 batch 的**最后一条**；
4. 守卫不成立（mock 让最后一条 `meta.changes = 0`）时返回原有的 400，且**不做**任何补偿性写入。

- [ ] **Step 2: RED** → **Step 3: 实现** → **Step 4: GREEN**

- [ ] **Step 5: 提交**

```bash
git commit -m "fix(api): 批次送审与标记付款改用守卫内嵌的 db.batch，杜绝部分写入且不自动撤销付款"
```

---

## Task 6: 批次创建改为「先原子认领 + 失败补偿」（HIGH）

**Files:** `routes/reimbursement.ts`（约 2134-2200）

需要 `last_row_id`，无法整体 batch。改为三段式：

1. `INSERT INTO reimbursement_batch (...) VALUES (...)` → 拿 `batchId`（单语句，本身原子）。
2. **单条多行认领 UPDATE**（原子）：
   ```sql
   UPDATE reimbursement_envelope
      SET batch_id = ?, status = 'batched', updated_at = ?
    WHERE id IN (...)
      AND batch_id IS NULL
      AND status = 'received'
      AND precheck_status = 'approved'
   ```
   `changes` 必须等于 `selected.length`，否则**补偿并抛错**。
3. `runAtomicBatch([...每条 item 的 INSERT])`（原子）。失败也走补偿。

**补偿**（按写入相反顺序，每步吞自身异常）：
```
DELETE FROM reimbursement_batch_item WHERE batch_id = ?
UPDATE reimbursement_envelope SET batch_id = NULL, status = 'received', updated_at = ? WHERE batch_id = ?
DELETE FROM reimbursement_batch WHERE id = ?
```
补偿自身失败 → `reportCompensationFailure(c.env, { operation: "reimbursement.batch.create", targetType: "reimbursement_batch", targetId: batchId, ... })`。
随后仍走既有的 `abandonIdempotentRequest` 并重抛。

- [ ] **Step 1: 先写失败测试**

断言：
1. 认领 UPDATE 是**单条多行**语句（SQL 含 `id IN (`），且带三条资格守卫；
2. `changes !== selected.length` 时执行补偿三步（断言这三条 SQL 被 prepare 过）并抛错；
3. items 用 `DB.batch` 一次性插入；
4. 补偿自身失败时调用了 `reportCompensationFailure`（可用 vi.mock 该模块断言）。

失败信息写明：「逐条 INSERT+UPDATE 在降级模式下会留下幽灵批次（batch 行 + 部分 items + 部分信封被标记 batched）」。

- [ ] **Step 2: RED** → **Step 3: 实现** → **Step 4: GREEN**

保持既有的 `publishEvent` / `writeAuditLog` / 幂等键行为与响应体**完全不变**。

- [ ] **Step 5: 提交**

```bash
git commit -m "fix(api): 批次创建改为原子认领+失败补偿，消除幽灵批次"
```

---

## Task 7: 报销数据一致性巡检（TDD）

**Files:** `services/reimbursement-integrity.ts` + `.test.ts`

- [ ] **Step 1: 先写失败测试**

对纯函数 `summarizeIntegrityIssues(issues)` 测试：分组计数、按严重度排序、空数组返回 `{ total: 0, bySeverity: {} }`。
对 `findReimbursementIntegrityIssues(db)` 用 mock D1 测试：每类问题各造一行，断言返回的 `kind` / `severity` / `ids` 正确。

- [ ] **Step 2: RED** → **Step 3: 实现**

导出：
```ts
export type IntegrityIssueKind =
  | "batch_totals_mismatch"        // batch.total_amount/item_count 与 active items 不符
  | "envelope_batched_without_batch" // status='batched' 但 batch_id IS NULL
  | "envelope_batch_missing"       // batch_id 指向不存在的批次
  | "envelope_no_uuid_mismatch"    // envelope_no != envelope_uuid（rebind 部分失败的特征）
  | "orphan_split_child";          // split_from_envelope_id 指向不存在/已删除的信封

export type IntegritySeverity = "high" | "medium";

export type IntegrityIssue = {
  kind: IntegrityIssueKind;
  severity: IntegritySeverity;
  count: number;
  ids: number[];   // 最多保留 50 个，避免响应过大
};

export const findReimbursementIntegrityIssues = async (
  db: D1Database
): Promise<IntegrityIssue[]> => { /* 每类一条 SQL，status != 'deleted' */ };

export const summarizeIntegrityIssues = (issues: IntegrityIssue[]) => ({ ... });
```

严重度：`batch_totals_mismatch` / `envelope_no_uuid_mismatch` = high；其余 medium。
所有查询都要排除 `status = 'deleted'` 的信封。

- [ ] **Step 4: GREEN + 提交**

```bash
git commit -m "feat(api): 报销数据一致性巡检服务（TDD）"
```

---

## Task 8: 巡检端点 + 每日 cron 告警

**Files:** `routes/system.ts`、`services/cron-jobs.ts`、`scheduled.ts`

- [ ] **Step 1: 只读端点**

`system.ts` 新增（**仅超管**）：
```ts
systemRoutes.get("/integrity/reimbursement", requireRoles(["super_admin"]), async (c) => {
  const issues = await findReimbursementIntegrityIssues(c.env.DB);
  return c.json({ success: true, data: { issues, summary: summarizeIntegrityIssues(issues) } });
});
```
注意 `system.ts` 现有的 import 与鉴权风格，照抄既有端点写法。

- [ ] **Step 2: cron 任务**

`services/cron-jobs.ts` 新增 `runReimbursementIntegrityCheck(env)`：
- 调用 `findReimbursementIntegrityIssues`；
- 若 `issues.length > 0`：`writeAuditLog`（`action: "system.integrity.reimbursement_issues_found"`，`actorUserId: "system"`）+ `publishEvent("REIMBURSEMENT_INTEGRITY_ISSUES_FOUND", "system", { summary, issues })`；
- 若无问题：不产生噪音（不写日志、不发事件）。
- 本函数**不得抛出**（cron 里任何异常都要吞掉并 console.error），避免拖垮同批其它 cron 任务。

`scheduled.ts` 挂到既有的每日 `"0 18 * * *"` 分支里，与其它日常任务并列。

- [ ] **Step 3: 验证 + 提交**

```bash
git commit -m "feat(api): 报销一致性巡检端点与每日 cron 告警"
```

---

## Task 9: 文档与全量验证

- [ ] **Step 1:** `doc/开发记录.md` **追加**一条（勿新建文件），记录：
  - `runInTransaction` 在 D1 生产降级不回滚的系统性风险与本次收敛范围；
  - `db.batch` 是 D1 唯一真原子写原语（附官方文档结论），以及「逻辑守卫 0 行不触发回滚」这一陷阱；
  - 六个站点的处置方式（三个改真原子、三个守卫内嵌、批次创建补偿）；
  - 为何 MEDIUM 站点**不自动撤销付款**；
  - 新增巡检端点与每日 cron 告警；
  - 验证结果与提交列表。

- [ ] **Step 2: 全量验证**

```bash
cd packages/api && npm run typecheck && npm run lint && npx vitest run
```
三条全绿；测试数应 > 327（基线）。

- [ ] **Step 3: 提交**

```bash
git commit -m "docs: D1 事务加固与一致性巡检开发记录"
```

**不要 push。** 部署由用户确认后另行执行。

---

## 硬约束（全程）

- 禁止 `@ts-ignore` / `as any`。
- 所有信封查询带 `status != 'deleted'`。
- 保持所有既有端点的**响应体、错误文案、HTTP 状态码、幂等行为**不变——本次只改写入的原子性与可观测性。
- 时间用 `nowIso()`。
- `reportCompensationFailure` 永不抛出。
- cron 任务永不抛出。
