import { describe, expect, it } from "vitest";

import { runInTransaction } from "./db-transaction";

const createDb = (options?: {
  beginError?: Error;
  rollbackError?: Error;
}): { db: D1Database; calls: string[] } => {
  const calls: string[] = [];

  const db = {
    exec: async (sql: string) => {
      calls.push(sql);
      if (sql === "BEGIN IMMEDIATE TRANSACTION" && options?.beginError) {
        throw options.beginError;
      }
      if (sql === "ROLLBACK" && options?.rollbackError) {
        throw options.rollbackError;
      }
      return {
        count: 0,
        duration: 0
      };
    }
  } as unknown as D1Database;

  return { db, calls };
};

describe("runInTransaction", () => {
  it("runs BEGIN and COMMIT in supported runtime", async () => {
    const { db, calls } = createDb();

    const result = await runInTransaction(db, async () => {
      calls.push("work");
      return "ok";
    });

    expect(result).toBe("ok");
    expect(calls).toEqual(["BEGIN IMMEDIATE TRANSACTION", "work", "COMMIT"]);
  });

  it("falls back to non-transactional execution when explicitly enabled", async () => {
    const { db, calls } = createDb({
      beginError: new Error(
        "D1_EXEC_ERROR: BEGIN IMMEDIATE TRANSACTION: To execute a transaction, please use the state.storage.transaction() APIs instead of the SQL BEGIN TRANSACTION or SAVEPOINT statements"
      )
    });

    const result = await runInTransaction(
      db,
      async () => {
        calls.push("work");
        return 16;
      },
      { allowUnsupportedFallback: true }
    );

    expect(result).toBe(16);
    expect(calls).toEqual(["BEGIN IMMEDIATE TRANSACTION", "work"]);
  });

  it("rethrows unsupported SQL transaction error by default", async () => {
    const unsupportedError = new Error(
      "D1_EXEC_ERROR: BEGIN IMMEDIATE TRANSACTION: To execute a transaction, please use the state.storage.transaction() APIs instead of the SQL BEGIN TRANSACTION or SAVEPOINT statements"
    );
    const { db, calls } = createDb({ beginError: unsupportedError });

    await expect(
      runInTransaction(db, async () => {
        calls.push("work");
        return 16;
      })
    ).rejects.toThrow("state.storage.transaction()");

    expect(calls).toEqual(["BEGIN IMMEDIATE TRANSACTION"]);
  });

  it("rolls back when work throws in supported runtime", async () => {
    const { db, calls } = createDb();

    await expect(
      runInTransaction(db, async () => {
        calls.push("work");
        throw new Error("work failed");
      })
    ).rejects.toThrow("work failed");

    expect(calls).toEqual(["BEGIN IMMEDIATE TRANSACTION", "work", "ROLLBACK"]);
  });

  it("rethrows non-compat BEGIN errors", async () => {
    const { db, calls } = createDb({
      beginError: new Error("database unavailable")
    });

    await expect(
      runInTransaction(db, async () => {
        calls.push("work");
        return "never";
      })
    ).rejects.toThrow("database unavailable");

    expect(calls).toEqual(["BEGIN IMMEDIATE TRANSACTION"]);
  });
});
