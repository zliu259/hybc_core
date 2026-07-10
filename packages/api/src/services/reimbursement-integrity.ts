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

// 每类问题恰好一条 SQL；所有查询都排除 status = 'deleted' 的信封。
const ISSUE_QUERIES: IssueQuery[] = [
  {
    kind: "batch_totals_mismatch",
    params: [AMOUNT_TOLERANCE],
    sql: `-- kind: batch_totals_mismatch
      SELECT b.id as id
      FROM reimbursement_batch b
      WHERE ABS(b.total_amount - COALESCE((
              SELECT SUM(bi.amount)
              FROM reimbursement_batch_item bi
              JOIN reimbursement_envelope e ON e.id = bi.envelope_id
              WHERE bi.batch_id = b.id AND bi.status = 'active' AND e.status != 'deleted'
            ), 0)) > ?
         OR b.item_count != (
              SELECT COUNT(*)
              FROM reimbursement_batch_item bi
              JOIN reimbursement_envelope e ON e.id = bi.envelope_id
              WHERE bi.batch_id = b.id AND bi.status = 'active' AND e.status != 'deleted'
            )`
  },
  {
    kind: "envelope_no_uuid_mismatch",
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
