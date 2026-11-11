import { describe, expect, it } from "vitest";

import { createSqliteD1, hasSqlite } from "./helpers/sqlite-d1";

const D1_MAX_BOUND_PARAMS = 100;

describe.skipIf(!hasSqlite)("node:sqlite 上的 D1 外壳", () => {
  const open = async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const database = new DatabaseSync(":memory:");
    database.exec("CREATE TABLE t (id INTEGER PRIMARY KEY)");
    return createSqliteD1(database);
  };
  const inList = (n: number) =>
    `SELECT id FROM t WHERE id IN (${Array.from({ length: n }, () => "?").join(", ")})`;
  const ids = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

  it("和真实 D1 一样，一条语句最多绑定 100 个参数", async () => {
    const db = await open();
    await expect(
      db
        .prepare(inList(D1_MAX_BOUND_PARAMS))
        .bind(...ids(D1_MAX_BOUND_PARAMS))
        .all()
    ).resolves.toMatchObject({ success: true });
    await expect(
      db
        .prepare(inList(D1_MAX_BOUND_PARAMS + 1))
        .bind(...ids(D1_MAX_BOUND_PARAMS + 1))
        .all()
    ).rejects.toThrow("too many SQL variables");
    await expect(
      db
        .prepare(inList(D1_MAX_BOUND_PARAMS + 1))
        .bind(...ids(D1_MAX_BOUND_PARAMS + 1))
        .first()
    ).rejects.toThrow("too many SQL variables");
    await expect(
      db.batch([db.prepare(inList(D1_MAX_BOUND_PARAMS + 1)).bind(...ids(D1_MAX_BOUND_PARAMS + 1))])
    ).rejects.toThrow("too many SQL variables");
  });
});
