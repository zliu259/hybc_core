/**
 * 报销数据一致性巡检。
 *
 * runInTransaction 在 D1 生产环境降级为非事务执行（见 db-transaction.ts），
 * 历史上可能已经产生过部分写入；补偿逻辑本身也可能失败（见
 * transaction-recovery.ts）。本服务提供主动巡检，发现（而不是等待业务方
 * 撞见）以下五类不一致，供只读端点查询与每日 cron 告警使用。
 */

export type IntegrityIssueKind =
  | "batch_totals_mismatch"
  | "envelope_no_uuid_mismatch"
  | "envelope_batched_without_batch"
  | "envelope_batch_missing"
  | "orphan_split_child";

export type IntegritySeverity = "high" | "medium";

export type IntegrityIssue = {
  kind: IntegrityIssueKind;
  severity: IntegritySeverity;
  count: number;
  ids: number[];
};

export type IntegritySummary = {
  total: number;
  bySeverity: Partial<Record<IntegritySeverity, number>>;
};

// 每类问题最多回传的 id 数量，避免响应体过大；count 字段仍是真实总数。
const MAX_IDS_PER_ISSUE = 50;

// total_amount 是 REAL，累加/多次更新后会有浮点误差；直接 != 比较会假阳性,
// 因此用一个小容差判断"是否真的不一致"。
const AMOUNT_TOLERANCE = 0.005;

const ISSUE_SEVERITY: Record<IntegrityIssueKind, IntegritySeverity> = {
  batch_totals_mismatch: "high",
  envelope_no_uuid_mismatch: "high",
  envelope_batched_without_batch: "medium",
  envelope_batch_missing: "medium",
  orphan_split_child: "medium"
};

type IssueQuery = {
  kind: IntegrityIssueKind;
  sql: string;
  params?: unknown[];
};

// 每类问题恰好一条 SQL；除 batch_totals_mismatch（见下方专门说明）外，
// 其余四类都排除 status = 'deleted' 的信封。
const ISSUE_QUERIES: IssueQuery[] = [
  {
    kind: "batch_totals_mismatch",
    params: [AMOUNT_TOLERANCE],
    // 本查询的「期望总额/条数」口径必须与运行时重算保持逐字一致，否则会产生
    // 误报或漏报。运行时权威重算只按
    // `reimbursement_batch_item WHERE batch_id = ? AND status = 'active'` 聚合
    // ——不 JOIN reimbursement_envelope、不排除已软删的信封（见
    // routes/reimbursement.ts 的 `PUT /batch/:id/items/:envelopeId/basic-info`
    // 端点内 UPDATE reimbursement_batch 的子查询，以及 `POST /batch` 批次创建时
    // 对 selected 的 JS reduce 求和）。曾经这里 JOIN 了 reimbursement_envelope
    // 并加了 `e.status != 'deleted'` 过滤，导致「active 的 batch_item 但其信封
    // 已被软删」的批次被误报 total_amount 不符——因为运行时权威值仍把该 item
    // 计入，而巡检的期望值把它剔除了。因此这里刻意不 JOIN 信封表。
    sql: `-- kind: batch_totals_mismatch
      SELECT b.id as id
      FROM reimbursement_batch b
      WHERE ABS(b.total_amount - COALESCE((
              SELECT SUM(bi.amount)
              FROM reimbursement_batch_item bi
              WHERE bi.batch_id = b.id AND bi.status = 'active'
            ), 0)) > ?
         OR b.item_count != (
              SELECT COUNT(*)
              FROM reimbursement_batch_item bi
              WHERE bi.batch_id = b.id AND bi.status = 'active'
            )`
  },
  {
    kind: "envelope_no_uuid_mismatch",
    // 本检查断言的是「envelope_no 恒等于 envelope_uuid」这条代码库不变式——
    // 所有写路径（create-new / bind-existing，见
    // routes/reimbursement-create-policy.ts；batch-generate；以及 rebind-uuid
    // 三步交换的每一条 UPDATE）都成对写入相同的值。它检测的是**该不变式被
    // 破坏**，不是 rebind-uuid 部分失败的特征信号——这是本检查曾经的错误声明：
    // rebind-uuid 中途失败即使真的发生过，占位信封也会卡在
    // envelope_no == envelope_uuid == tempUuid 上，二者仍然相等，本查询根本
    // 发现不了，因此不能拿它当 rebind 部分失败的信号。
    // 加固后（rebind-uuid 已改用 db.batch 原子提交）rebind 部分失败已不可能
    // 再发生；历史上若已产生过卡死在 tempUuid 上的占位信封，无法用纯数据库
    // 谓词判定（它与正常信封形状相同），只能靠
    // `reimbursement.envelope.rebind_uuid` 审计日志人工比对。
    sql: `-- kind: envelope_no_uuid_mismatch
      SELECT id FROM reimbursement_envelope
      WHERE status != 'deleted' AND envelope_no != envelope_uuid`
  },
  {
    kind: "envelope_batched_without_batch",
    sql: `-- kind: envelope_batched_without_batch
      SELECT id FROM reimbursement_envelope
      WHERE status != 'deleted' AND status = 'batched' AND batch_id IS NULL`
  },
  {
    kind: "envelope_batch_missing",
    sql: `-- kind: envelope_batch_missing
      SELECT e.id as id
      FROM reimbursement_envelope e
      WHERE e.status != 'deleted'
        AND e.batch_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM reimbursement_batch b WHERE b.id = e.batch_id)`
  },
  {
    kind: "orphan_split_child",
    sql: `-- kind: orphan_split_child
      SELECT e.id as id
      FROM reimbursement_envelope e
      WHERE e.status != 'deleted'
        AND e.split_from_envelope_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM reimbursement_envelope parent
          WHERE parent.id = e.split_from_envelope_id AND parent.status != 'deleted'
        )`
  }
];

/**
 * 逐类跑一致性检查 SQL；每类最多保留 50 个 id（避免响应过大），
 * count 字段仍为真实命中总数。没有问题的种类不会出现在结果数组里。
 */
export const findReimbursementIntegrityIssues = async (
  db: D1Database
): Promise<IntegrityIssue[]> => {
  const issues: IntegrityIssue[] = [];

  for (const query of ISSUE_QUERIES) {
    const statement = query.params?.length
      ? db.prepare(query.sql).bind(...query.params)
      : db.prepare(query.sql);
    const rows = await statement.all<{ id: number }>();
    const matched = rows.results ?? [];

    if (matched.length === 0) {
      continue;
    }

    issues.push({
      kind: query.kind,
      severity: ISSUE_SEVERITY[query.kind],
      count: matched.length,
      ids: matched.slice(0, MAX_IDS_PER_ISSUE).map((row) => row.id)
    });
  }

  return issues;
};

/**
 * 纯函数：按严重度汇总问题条目。空数组返回 { total: 0, bySeverity: {} }。
 */
export const summarizeIntegrityIssues = (issues: IntegrityIssue[]): IntegritySummary => {
  const bySeverity: Partial<Record<IntegritySeverity, number>> = {};
  let total = 0;

  for (const issue of issues) {
    total += issue.count;
    bySeverity[issue.severity] = (bySeverity[issue.severity] ?? 0) + issue.count;
  }

  return { total, bySeverity };
};
