export const runInTransaction = async <T>(db: D1Database, work: () => Promise<T>): Promise<T> => {
  await db.exec("BEGIN IMMEDIATE TRANSACTION");
  try {
    const result = await work();
    await db.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      await db.exec("ROLLBACK");
    } catch {}
    throw error;
  }
};
