import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// 真实 SQL 测试工具：node:sqlite 跑全部迁移文件，外面包一层 D1 的最小接口。
// CI 是 Node 20，没有 node:sqlite，用到它的测试要 describe.skipIf(!hasSqlite)，推送前必须本地跑。

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const migrationsDir = resolve(apiRoot, "migrations");

const sqlite = await import("node:sqlite").catch(() => null);

export const hasSqlite = Boolean(sqlite);

export const readMigration = (name) => readFileSync(resolve(migrationsDir, name), "utf8");

export const listMigrationNames = () =>
  readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort();

export const normalizeParam = (value) => {
  if (typeof value === "boolean") return value ? 1 : 0;
  return value;
};

const returnsRows = (sql) => /^\s*(SELECT|WITH|PRAGMA)\b/i.test(sql) || /\bRETURNING\b/i.test(sql);

const executeStatement = (database, sql, params) => {
  const prepared = database.prepare(sql);
  const bound = params.map(normalizeParam);
  if (returnsRows(sql)) {
    return {
      success: true,
      results: prepared.all(...bound).map((row) => ({ ...row })),
      meta: { changes: 0, last_row_id: 0 }
    };
  }
  const info = prepared.run(...bound);
  return {
    success: true,
    results: [],
    meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) }
  };
};

const createStatement = (database, sql, params, hooks) => ({
  sql,
  params,
  bind: (...next) => createStatement(database, sql, next, hooks),
  async first(column) {
    hooks.beforeStatement?.();
    const row = database.prepare(sql).get(...params.map(normalizeParam));
    if (!row) return null;
    return column ? (row[column] ?? null) : { ...row };
  },
  async all() {
    hooks.beforeStatement?.();
    return { success: true, results: database.prepare(sql).all(...params.map(normalizeParam)).map((row) => ({ ...row })), meta: {} };
  },
  async run() {
    hooks.beforeStatement?.();
    return executeStatement(database, sql, params);
  }
});

/**
 * node:sqlite 上的 D1 外壳。和真实 D1 一样，prepare 不校验 SQL，执行时才报错。
 * hooks.beforeStatement 在每次和数据库往返前调用：别的请求只能插在这些点上，batch 算一次往返。
 */
export const createSqliteD1 = (database, hooks = {}) => ({
  prepare: (sql) => createStatement(database, sql, [], hooks),
  async batch(statements) {
    hooks.beforeStatement?.();
    database.exec("BEGIN");
    try {
      const results = statements.map((statement) =>
        executeStatement(database, statement.sql, statement.params)
      );
      database.exec("COMMIT");
      return results;
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  },
  async exec(sql) {
    database.exec(sql);
    return { count: 1, duration: 0 };
  }
});

export const createMigratedDatabase = (options = {}) => {
  const database = new sqlite.DatabaseSync(":memory:", { enableForeignKeyConstraints: false });
  for (const name of listMigrationNames()) {
    if (options.stopBefore && name >= options.stopBefore) break;
    database.exec(readMigration(name));
  }
  return database;
};
