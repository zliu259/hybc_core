const isSqlTransactionUnsupportedError = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false;
  return (
    error.message.includes("state.storage.transaction()") ||
    error.message.includes(
      "instead of the SQL BEGIN TRANSACTION or SAVEPOINT statements"
    )
  );
};

let hasWarnedUnsupportedSqlTransaction = false;

type RunInTransactionOptions = {
  allowUnsupportedFallback?: boolean;
};

export const runInTransaction = async <T>(
  db: D1Database,
  work: () => Promise<T>,
  options: RunInTransactionOptions = {}
): Promise<T> => {
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
