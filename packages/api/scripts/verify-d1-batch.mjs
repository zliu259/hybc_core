#!/usr/bin/env node
/**
 * 在本地 workerd 的 D1 上验证库房写入依赖的两件事：
 *   1. 批内断言（条件不成立时插入 NULL 触发 NOT NULL 约束）会让整批回滚；
 *   2. 违反 CHECK 约束会让整批回滚，并且报错里带约束名。
 * 同时把 D1 的真实报错文案打印出来，供 src/services/warehouse/guard.ts 的匹配规则对照。
 *
 * 用法：cd packages/api && node scripts/verify-d1-batch.mjs
 * 只碰本地 D1 的两张临时表，结束时删除。
 */
import { getPlatformProxy } from "wrangler";

const GUARD_TABLE = "tmp_wh_guard";
const DEMO_TABLE = "tmp_wh_demo";
const CHECK_NAME = "tmp_wh_demo_qty_non_negative";

const errorText = (error) => {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause instanceof Error ? ` ${error.cause.message}` : "";
  return `${error.message}${cause}`;
};
const isGuardFailure = (error) => errorText(error).includes(`${GUARD_TABLE}.ok`);
const isCheckFailure = (error, name) =>
  errorText(error).includes("CHECK constraint failed") && errorText(error).includes(name);

const fail = (reason) => {
  console.log(`FAIL ${reason}`);
  process.exitCode = 1;
};

const proxy = await getPlatformProxy({ configPath: "wrangler.toml" });
const db = proxy.env.DB;

const qty = async () =>
  (await db.prepare(`SELECT qty FROM ${DEMO_TABLE} WHERE id = 1`).first("qty")) ?? null;
const rowCount = async () =>
  (await db.prepare(`SELECT COUNT(*) AS n FROM ${DEMO_TABLE}`).first("n")) ?? null;

try {
  await db.batch([
    db.prepare(`DROP TABLE IF EXISTS ${GUARD_TABLE}`),
    db.prepare(`DROP TABLE IF EXISTS ${DEMO_TABLE}`),
    db.prepare(`CREATE TABLE ${GUARD_TABLE} (ok INTEGER NOT NULL)`),
    db.prepare(
      `CREATE TABLE ${DEMO_TABLE} (id INTEGER PRIMARY KEY, qty REAL NOT NULL, CONSTRAINT ${CHECK_NAME} CHECK (qty >= 0))`
    ),
    db.prepare(`INSERT INTO ${DEMO_TABLE} (id, qty) VALUES (1, 5)`)
  ]);

  let guardError = null;
  try {
    await db.batch([
      db.prepare(`UPDATE ${DEMO_TABLE} SET qty = qty + 10 WHERE id = 1`),
      db
        .prepare(
          `INSERT INTO ${GUARD_TABLE} (ok) VALUES ((SELECT 1 WHERE EXISTS (SELECT 1 FROM ${DEMO_TABLE} WHERE id = ? AND qty < 0)))`
        )
        .bind(1),
      db.prepare(`DELETE FROM ${GUARD_TABLE}`)
    ]);
  } catch (error) {
    guardError = error;
  }
  console.log(`guard error: ${guardError ? errorText(guardError) : "(none)"}`);
  if (!guardError) fail("guard batch did not throw");
  else if (!isGuardFailure(guardError)) fail("guard error text not recognised");
  const afterGuard = await qty();
  if (afterGuard !== 5) fail(`guard batch not rolled back, qty=${afterGuard}`);

  let checkError = null;
  try {
    await db.batch([
      db.prepare(`INSERT INTO ${DEMO_TABLE} (id, qty) VALUES (2, 1)`),
      db.prepare(`UPDATE ${DEMO_TABLE} SET qty = qty - 6 WHERE id = 1`)
    ]);
  } catch (error) {
    checkError = error;
  }
  console.log(`check error: ${checkError ? errorText(checkError) : "(none)"}`);
  if (!checkError) fail("check batch did not throw");
  else if (!isCheckFailure(checkError, CHECK_NAME)) fail("check error text not recognised");
  const afterCheck = await rowCount();
  if (afterCheck !== 1) fail(`check batch not rolled back, rows=${afterCheck}`);

  if (!process.exitCode) console.log("PASS d1 batch rollback (guard, check)");
} finally {
  await db.batch([
    db.prepare(`DROP TABLE IF EXISTS ${GUARD_TABLE}`),
    db.prepare(`DROP TABLE IF EXISTS ${DEMO_TABLE}`)
  ]);
  await proxy.dispose();
}
