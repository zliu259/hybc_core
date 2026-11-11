/**
 * 库房多步写入的批内断言。
 *
 * 生产 D1 不支持 BEGIN，唯一原子的写法是 db.batch()：任一语句报错，整批回滚。
 * 但带条件的 UPDATE 匹配 0 行不算报错。所以把前置条件写成一条插入：
 * 条件成立时插入 1，不成立时子查询为空、插入 NULL，wh_guard.ok 的 NOT NULL 约束报错，整批回滚。
 * 每个批处理的最后一条用 releaseGuards 清空 wh_guard，让它永远是空表。
 */

export type GuardParam = string | number | null;

const GUARD_COLUMN = "wh_guard.ok";
const CHECK_FAILED = "CHECK constraint failed";

/** 条件不成立时让整批回滚：existsSql 查不到行，NOT NULL 约束报错。 */
export const assertInBatch = (
  db: D1Database,
  existsSql: string,
  params: readonly GuardParam[]
): D1PreparedStatement =>
  db
    .prepare(`INSERT INTO wh_guard (ok) VALUES ((SELECT 1 WHERE EXISTS (${existsSql})))`)
    .bind(...params);

/** 放在每个批处理的最后一条，保持 wh_guard 永远为空。 */
export const releaseGuards = (db: D1Database): D1PreparedStatement =>
  db.prepare("DELETE FROM wh_guard");

const errorText = (error: unknown): string => {
  if (!(error instanceof Error)) return "";
  const cause = error.cause instanceof Error ? ` ${error.cause.message}` : "";
  return `${error.message}${cause}`;
};

export const isGuardFailure = (error: unknown): boolean => errorText(error).includes(GUARD_COLUMN);

export const isCheckFailure = (error: unknown, constraintName: string): boolean => {
  const text = errorText(error);
  return text.includes(CHECK_FAILED) && text.includes(constraintName);
};
