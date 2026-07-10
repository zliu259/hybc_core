import { describe, expect, it, vi } from "vitest";

import { runAtomicBatch, runInTransaction } from "./db-transaction";

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

  it("falls back to non-transactional execution by default on D1", async () => {
    const { db, calls } = createDb({
      beginError: new Error(
        "D1_EXEC_ERROR: BEGIN IMMEDIATE TRANSACTION: To execute a transaction, please use the state.storage.transaction() APIs instead of the SQL BEGIN TRANSACTION or SAVEPOINT statements"
      )
    });

    const result = await runInTransaction(db, async () => {
      calls.push("work");
      return 16;
    });

    expect(result).toBe(16);
    expect(calls).toEqual(["BEGIN IMMEDIATE TRANSACTION", "work"]);
  });

  it("rethrows unsupported SQL transaction error when fallback is explicitly disabled", async () => {
    const unsupportedError = new Error(
      "D1_EXEC_ERROR: BEGIN IMMEDIATE TRANSACTION: To execute a transaction, please use the state.storage.transaction() APIs instead of the SQL BEGIN TRANSACTION or SAVEPOINT statements"
    );
    const { db, calls } = createDb({ beginError: unsupportedError });

    await expect(
      runInTransaction(
        db,
        async () => {
          calls.push("work");
          return 16;
        },
        { allowUnsupportedFallback: false }
      )
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

describe("runAtomicBatch", () => {
  const fakeStatement = (label: string): D1PreparedStatement =>
    ({ __label: label }) as unknown as D1PreparedStatement;

  it("passes statements as-is to db.batch and returns the results in order", async () => {
    const statements = [fakeStatement("first"), fakeStatement("second")];
    const batchResults = [
      { success: true, meta: { changes: 1 } },
      { success: true, meta: { changes: 2 } }
    ] as unknown as D1Result[];

    const batch = vi.fn().mockResolvedValue(batchResults);
    const db = { batch } as unknown as D1Database;

    const result = await runAtomicBatch(db, statements);

    expect(batch).toHaveBeenCalledTimes(1);
    expect(batch).toHaveBeenCalledWith(statements);
    expect(result).toBe(batchResults);
  });

  it("rethrows when db.batch fails, without swallowing the error", async () => {
    const statements = [fakeStatement("only")];
    const batchError = new Error("D1_ERROR: UNIQUE constraint failed");
    const batch = vi.fn().mockRejectedValue(batchError);
    const db = { batch } as unknown as D1Database;

    await expect(runAtomicBatch(db, statements)).rejects.toThrow(
      "D1_ERROR: UNIQUE constraint failed"
    );
    expect(batch).toHaveBeenCalledTimes(1);
  });

  it("returns an empty array and does not call db.batch for an empty statement list", async () => {
    const batch = vi.fn();
    const db = { batch } as unknown as D1Database;

    const result = await runAtomicBatch(db, []);

    expect(result).toEqual([]);
    expect(batch).not.toHaveBeenCalled();
  });
});
