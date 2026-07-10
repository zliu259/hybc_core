const isSqlTransactionUnsupportedError = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false;
  return (
    error.message.includes("state.storage.transaction()") ||
    error.message.includes("instead of the SQL BEGIN TRANSACTION or SAVEPOINT statements")
  );
};

let hasWarnedUnsupportedSqlTransaction = false;

type RunInTransactionOptions = {
  allowUnsupportedFallback?: boolean;
};

/**
 * ⚠️ WARNING: does NOT roll back in production on D1.
 *
 * D1 does not support SQL `BEGIN TRANSACTION`. By default (`allowUnsupportedFallback: true`)
 * this function silently degrades to non-transactional execution when it detects that
 * unsupported-transaction error, so a failure partway through `work()` leaves whatever was
 * already written in place — there is no rollback. Local wrangler (better-sqlite3) *does*
 * support SQL transactions, so this failure mode only reproduces in production, never locally.
 *
 * Prefer {@link runAtomicBatch} for any new write sequence that must be atomic on D1 — it is
 * the only write primitive that is actually atomic there.
 */
export const runInTransaction = async <T>(
  db: D1Database,
  work: () => Promise<T>,
  options: RunInTransactionOptions = {}
): Promise<T> => {
  // D1 (Cloudflare Workers) does not support SQL BEGIN/COMMIT transactions, so the
  // unsupported-transaction error must degrade to non-transactional execution by default.
  // Pass allowUnsupportedFallback: false only to deliberately fail loud (e.g. in tests).
  const allowFallback = options.allowUnsupportedFallback ?? true;
  try {
    await db.exec("BEGIN IMMEDIATE TRANSACTION");
  } catch (error) {
    if (isSqlTransactionUnsupportedError(error) && allowFallback) {
      if (!hasWarnedUnsupportedSqlTransaction) {
        console.warn(
          "SQL BEGIN/COMMIT transactions are unsupported in this runtime; fallback to non-transactional execution"
        );
        hasWarnedUnsupportedSqlTransaction = true;
      }
      return work();
    }
    throw error;
  }

  try {
    const result = await work();
    await db.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      await db.exec("ROLLBACK");
    } catch (rollbackError) {
      console.error("Failed to rollback SQL transaction", rollbackError);
    }
    throw error;
  }
};

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
