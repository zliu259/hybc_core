import { contractDirections, type ContractDirection } from "../types/contract";
import { invoiceContractAmountSql } from "./receipt-invoice-amount";

/**
 * 合同总览的进度分档。档位在 SQL 里算，这样按档筛选和汇总都不受分页限制；
 * 列表每行也带上同一个结果，页面不用再实现一遍阈值。
 *
 * 付款合同：不到 80% 正常，80%~95% 接近额度，超过 95% 即将付满（沿用原执行监控页的阈值）。
 * 收款合同：没有额度风险，只看到账走到哪了。
 * 金额是 REAL，差一分钱以内算付清，避免浮点误差把付清的合同分到别的档。
 */
export const executionBands = [
  "normal",
  "warning",
  "critical",
  "not_started",
  "collecting",
  "settled",
  "over",
  "unpriced"
] as const;
export type ExecutionBand = (typeof executionBands)[number];

export const isExecutionBand = (value: string): value is ExecutionBand =>
  (executionBands as readonly string[]).includes(value);

export const EXECUTION_BAND_SQL = `CASE
    WHEN total_amount <= 0 THEN 'unpriced'
    WHEN direction = 'inbound' THEN CASE
      WHEN received_amount > total_amount + 0.005 THEN 'over'
      WHEN received_amount >= total_amount - 0.005 THEN 'settled'
      WHEN received_amount > 0 THEN 'collecting'
      ELSE 'not_started'
    END
    WHEN paid_amount > total_amount + 0.005 THEN 'over'
    WHEN paid_amount >= total_amount - 0.005 THEN 'settled'
    WHEN paid_amount * 100 > total_amount * 95 THEN 'critical'
    WHEN paid_amount * 100 >= total_amount * 80 THEN 'warning'
    ELSE 'normal'
  END`;

/**
 * 在执行的合同：生效过的，加上还没生效却已经有钱进出的（线上确有草稿合同已付满的情况，
 * 不算进来就看不到）。已终止的不再有风险，未付款的草稿和待审批也还谈不上执行。
 */
export const IN_EXECUTION_SQL = `status NOT IN ('deleted', 'terminated')
    AND (status IN ('active', 'completed') OR paid_amount > 0 OR received_amount > 0)`;

/** 按档筛选时把最接近上限的排在前面 */
export const EXECUTION_PROGRESS_ORDER_SQL = `CASE
    WHEN total_amount <= 0 THEN 0
    WHEN direction = 'inbound' THEN received_amount / total_amount
    ELSE paid_amount / total_amount
  END DESC`;

export const CONTRACT_KEYWORD_SQL = "(contract_no LIKE ? OR counterparty LIKE ? OR remark LIKE ?)";

export const contractKeywordParams = (keyword: string): string[] => {
  const pattern = `%${keyword}%`;
  return [pattern, pattern, pattern];
};

export type ContractOverviewFilters = {
  direction: ContractDirection;
  projectId: number | null;
  keyword: string | null;
};

export type ContractOverviewBand = {
  band: ExecutionBand;
  count: number;
  total_amount: number;
  done_amount: number;
};

export type ContractOverview = {
  direction: ContractDirection;
  status_counts: Record<string, number>;
  total_count: number;
  execution: {
    count: number;
    total_amount: number;
    /** 付款合同是已付，收款合同是已到账 */
    done_amount: number;
    /** 按合同逐份算，超付的合同不会抵掉别的合同的未付额 */
    remaining_amount: number;
    /** 只有收款合同有 */
    invoiced_amount: number;
    bands: ContractOverviewBand[];
  };
};

export const parseContractOverviewQuery = (query: {
  direction?: string;
  project_id?: string;
  keyword?: string;
}): { ok: true; value: ContractOverviewFilters } | { ok: false; message: string } => {
  const direction = query.direction || "outbound";
  if (!(contractDirections as readonly string[]).includes(direction)) {
    return { ok: false, message: "合同方向只能是付款或收款" };
  }
  const projectId = query.project_id ? Number(query.project_id) : null;
  if (projectId !== null && (!Number.isInteger(projectId) || projectId <= 0)) {
    return { ok: false, message: "项目编号无效" };
  }
  return {
    ok: true,
    value: {
      direction: direction as ContractDirection,
      projectId,
      keyword: query.keyword?.trim() || null
    }
  };
};

const buildScope = ({
  direction,
  projectId,
  keyword
}: ContractOverviewFilters): { sql: string; params: (string | number)[] } => ({
  sql: [
    "direction = ?",
    ...(projectId === null ? [] : ["project_id = ?"]),
    ...(keyword === null ? [] : [CONTRACT_KEYWORD_SQL])
  ].join(" AND "),
  params: [
    direction,
    ...(projectId === null ? [] : [projectId]),
    ...(keyword === null ? [] : contractKeywordParams(keyword))
  ]
});

type BandRow = {
  band: ExecutionBand;
  count: number;
  total_amount: number | null;
  done_amount: number | null;
  remaining_amount: number | null;
};

const sumBy = <T>(rows: readonly T[], pick: (row: T) => number | null): number =>
  rows.reduce((sum, row) => sum + (pick(row) ?? 0), 0);

export const loadContractOverview = async (
  db: D1Database,
  filters: ContractOverviewFilters
): Promise<ContractOverview> => {
  const scope = buildScope(filters);
  const doneColumn = filters.direction === "inbound" ? "received_amount" : "paid_amount";

  const [statusRows, bandRows, invoiced] = await Promise.all([
    db
      .prepare(
        `SELECT status, COUNT(*) AS count
           FROM contract
          WHERE status != 'deleted' AND ${scope.sql}
          GROUP BY status`
      )
      .bind(...scope.params)
      .all<{ status: string; count: number }>(),
    db
      .prepare(
        `SELECT ${EXECUTION_BAND_SQL} AS band,
                COUNT(*) AS count,
                SUM(total_amount) AS total_amount,
                SUM(${doneColumn}) AS done_amount,
                SUM(CASE WHEN total_amount > ${doneColumn} THEN total_amount - ${doneColumn} ELSE 0 END) AS remaining_amount
           FROM contract
          WHERE ${IN_EXECUTION_SQL} AND ${scope.sql}
          GROUP BY band`
      )
      .bind(...scope.params)
      .all<BandRow>(),
    filters.direction === "inbound"
      ? db
          .prepare(
            `SELECT IFNULL(SUM(${invoiceContractAmountSql}), 0) AS total
               FROM invoice
              WHERE status != 'deleted'
                AND contract_id IN (SELECT id FROM contract WHERE ${IN_EXECUTION_SQL} AND ${scope.sql})`
          )
          .bind(...scope.params)
          .first<{ total: number }>()
      : Promise.resolve(null)
  ]);

  const statuses = statusRows.results ?? [];
  const bands = bandRows.results ?? [];

  return {
    direction: filters.direction,
    status_counts: Object.fromEntries(statuses.map((row) => [row.status, row.count])),
    total_count: sumBy(statuses, (row) => row.count),
    execution: {
      count: sumBy(bands, (row) => row.count),
      total_amount: sumBy(bands, (row) => row.total_amount),
      done_amount: sumBy(bands, (row) => row.done_amount),
      remaining_amount: sumBy(bands, (row) => row.remaining_amount),
      invoiced_amount: invoiced?.total ?? 0,
      bands: bands.map((row) => ({
        band: row.band,
        count: row.count,
        total_amount: row.total_amount ?? 0,
        done_amount: row.done_amount ?? 0
      }))
    }
  };
};
