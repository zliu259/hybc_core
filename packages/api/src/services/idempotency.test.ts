import { describe, expect, it } from "vitest";

import {
  abandonIdempotentRequest,
  beginIdempotentRequest,
  completeIdempotentRequest
} from "./idempotency";

type StoredRow = {
  scope: string;
  actor_key: string;
  idempotency_key: string;
  status: string;
  response_json: string | null;
  status_code: number | null;
  created_at: string;
  updated_at: string;
};

/**
 * Minimal in-memory D1 fake that mirrors api_idempotency_request semantics:
 * PRIMARY KEY (scope, actor_key, idempotency_key) -> duplicate INSERT throws
 * a UNIQUE constraint error, matching D1/SQLite behavior.
 */
const createFakeDb = (): { db: D1Database; store: Map<string, StoredRow> } => {
  const store = new Map<string, StoredRow>();
  const keyOf = (scope: string, actor: string, key: string) =>
    `${scope}|${actor}|${key}`;

  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async run() {
              if (sql.includes("INSERT INTO api_idempotency_request")) {
                const [scope, actor, key, createdAt, updatedAt] = args as string[];
                const id = keyOf(scope, actor, key);
                if (store.has(id)) {
                  throw new Error(
                    "D1_ERROR: UNIQUE constraint failed: api_idempotency_request.scope"
                  );
                }
                store.set(id, {
                  scope,
                  actor_key: actor,
                  idempotency_key: key,
                  status: "pending",
                  response_json: null,
                  status_code: null,
                  created_at: createdAt,
                  updated_at: updatedAt
                });
                return { success: true };
              }
              if (sql.includes("UPDATE api_idempotency_request")) {
                const [responseJson, statusCode, updatedAt, scope, actor, key] =
                  args as [string, number, string, string, string, string];
                const id = keyOf(scope, actor, key);
                const row = store.get(id);
                if (row) {
                  store.set(id, {
                    ...row,
                    status: "completed",
                    response_json: responseJson,
                    status_code: statusCode,
                    updated_at: updatedAt
                  });
                }
                return { success: true };
              }
              if (sql.includes("DELETE FROM api_idempotency_request")) {
                const [scope, actor, key] = args as string[];
                const id = keyOf(scope, actor, key);
                const row = store.get(id);
                if (row && row.status === "pending") store.delete(id);
                return { success: true };
              }
              return { success: true };
            },
            async first() {
              const [scope, actor, key] = args as string[];
              const row = store.get(keyOf(scope, actor, key));
              if (!row) return null;
              return {
                status: row.status,
                response_json: row.response_json,
                status_code: row.status_code
              };
            }
          };
        }
      };
    }
  } as unknown as D1Database;

  return { db, store };
};

const SCOPE = "reimbursement:create:user-1";
const ACTOR = "user-1";

describe("idempotency contract used by reimbursement create", () => {
  it("treats the first request for a key as new", async () => {
    const { db } = createFakeDb();
    const result = await beginIdempotentRequest(db, SCOPE, ACTOR, "key-a");
    expect(result.kind).toBe("new");
  });

  it("reports a duplicate of an in-flight key as pending (blocks double-insert)", async () => {
    const { db } = createFakeDb();
    const first = await beginIdempotentRequest(db, SCOPE, ACTOR, "key-a");
    const second = await beginIdempotentRequest(db, SCOPE, ACTOR, "key-a");
    expect(first.kind).toBe("new");
    expect(second.kind).toBe("pending");
  });

  it("replays the stored payload once the original request completed", async () => {
    const { db } = createFakeDb();
    await beginIdempotentRequest(db, SCOPE, ACTOR, "key-a");
    const payload = { success: true, data: { id: 42, envelope_no: "x", envelope_uuid: "u" } };
    await completeIdempotentRequest(db, SCOPE, ACTOR, "key-a", 201, payload);

    const replay = await beginIdempotentRequest<typeof payload>(db, SCOPE, ACTOR, "key-a");
    expect(replay.kind).toBe("replay");
    if (replay.kind === "replay") {
      expect(replay.statusCode).toBe(201);
      expect(replay.payload).toEqual(payload);
    }
  });

  it("does not engage when no idempotency key is supplied", async () => {
    const { db, store } = createFakeDb();
    const a = await beginIdempotentRequest(db, SCOPE, ACTOR, undefined);
    const b = await beginIdempotentRequest(db, SCOPE, ACTOR, "");
    expect(a.kind).toBe("new");
    expect(b.kind).toBe("new");
    expect(store.size).toBe(0);
  });

  it("frees a pending key after abandon so a retry can proceed", async () => {
    const { db } = createFakeDb();
    await beginIdempotentRequest(db, SCOPE, ACTOR, "key-a");
    await abandonIdempotentRequest(db, SCOPE, ACTOR, "key-a");
    const retry = await beginIdempotentRequest(db, SCOPE, ACTOR, "key-a");
    expect(retry.kind).toBe("new");
  });

  it("scopes keys per actor so different users do not collide", async () => {
    const { db } = createFakeDb();
    const u1 = await beginIdempotentRequest(db, SCOPE, ACTOR, "shared-key");
    const u2 = await beginIdempotentRequest(
      db,
      "reimbursement:create:user-2",
      "user-2",
      "shared-key"
    );
    expect(u1.kind).toBe("new");
    expect(u2.kind).toBe("new");
  });
});
