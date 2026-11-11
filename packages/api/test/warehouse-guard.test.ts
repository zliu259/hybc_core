import { beforeEach, describe, expect, it } from "vitest";

import {
  assertInBatch,
  isCheckFailure,
  isGuardFailure,
  releaseGuards
} from "../src/services/warehouse/guard";
import { createSqliteD1, hasSqlite } from "./helpers/sqlite-d1";

// 库房的多步写入靠"批内断言 + 约束"保证原子：条件不成立或约束报错，整批回滚。
// 这里用真实 SQLite 证明这件事；生产 D1 上的同样验证见 scripts/verify-d1-batch.mjs。

const sqlite = await import("node:sqlite").catch(() => null);

describe.skipIf(!hasSqlite)("库房批内断言", () => {
  let database;
  let db;

  beforeEach(() => {
    database = new sqlite.DatabaseSync(":memory:");
    database.exec(`
      CREATE TABLE wh_guard (ok INTEGER NOT NULL);
      CREATE TABLE demo (
        id INTEGER PRIMARY KEY,
        qty REAL NOT NULL,
        CONSTRAINT demo_qty_non_negative CHECK (qty >= 0)
      );
      INSERT INTO demo (id, qty) VALUES (1, 5);
    `);
    db = createSqliteD1(database);
  });

  const qty = () => database.prepare("SELECT qty FROM demo WHERE id = 1").get().qty;

  it("断言为假时整批回滚", async () => {
    const batch = db.batch([
      db.prepare("UPDATE demo SET qty = qty + 10 WHERE id = 1"),
      assertInBatch(db, "SELECT 1 FROM demo WHERE id = ? AND qty < 0", [1]),
      releaseGuards(db)
    ]);
    await expect(batch).rejects.toSatisfy(isGuardFailure);
    expect(qty()).toBe(5);
  });

  it("断言为真时提交，并且不留断言行", async () => {
    await db.batch([
      assertInBatch(db, "SELECT 1 FROM demo WHERE id = ? AND qty >= ?", [1, 5]),
      db.prepare("UPDATE demo SET qty = qty - 5 WHERE id = 1"),
      releaseGuards(db)
    ]);
    expect(qty()).toBe(0);
    expect(database.prepare("SELECT COUNT(*) AS n FROM wh_guard").get().n).toBe(0);
  });

  it("违反 CHECK 约束时整批回滚，并能认出是哪个约束", async () => {
    const batch = db.batch([
      db.prepare("INSERT INTO demo (id, qty) VALUES (2, 1)"),
      db.prepare("UPDATE demo SET qty = qty - 6 WHERE id = 1")
    ]);
    await expect(batch).rejects.toSatisfy((error) => isCheckFailure(error, "demo_qty_non_negative"));
    expect(database.prepare("SELECT COUNT(*) AS n FROM demo").get().n).toBe(1);
  });

  it("普通报错不会被误认成断言失败或约束失败", () => {
    expect(isGuardFailure(new Error("no such table: x"))).toBe(false);
    expect(isCheckFailure(new Error("no such table: x"), "demo_qty_non_negative")).toBe(false);
    expect(isGuardFailure("wh_guard.ok")).toBe(false);
  });

  it("CHECK 失败只认对应的约束名", () => {
    const error = new Error("CHECK constraint failed: demo_qty_non_negative");
    expect(isCheckFailure(error, "demo_qty_non_negative")).toBe(true);
    expect(isCheckFailure(error, "material_quantity_non_negative")).toBe(false);
  });
});
