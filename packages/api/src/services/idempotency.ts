const nowIso = () => new Date().toISOString();

type IdempotencyRow = {
  status: string;
  response_json: string | null;
  status_code: number | null;
};

export type IdempotencyStartResult<T> =
  | { kind: "new" }
  | { kind: "pending" }
  | { kind: "replay"; statusCode: number; payload: T };

const isUniqueConflict = (error: unknown) => {
  return error instanceof Error && error.message.includes("UNIQUE constraint failed");
};

export const beginIdempotentRequest = async <T>(
  db: D1Database,
  scope: string,
  actorKey: string,
  idempotencyKey: string | null | undefined
): Promise<IdempotencyStartResult<T>> => {
  const normalizedKey = String(idempotencyKey || "").trim();
  if (!normalizedKey) {
    return { kind: "new" };
  }

  const now = nowIso();
  try {
    await db.prepare(
      `INSERT INTO api_idempotency_request
        (scope, actor_key, idempotency_key, status, created_at, updated_at)
       VALUES (?, ?, ?, 'pending', ?, ?)`
    )
      .bind(scope, actorKey, normalizedKey, now, now)
      .run();
    return { kind: "new" };
  } catch (error) {
    if (!isUniqueConflict(error)) throw error;
  }

  const row = await db.prepare(
    `SELECT status, response_json, status_code
       FROM api_idempotency_request
      WHERE scope = ? AND actor_key = ? AND idempotency_key = ?`
  )
    .bind(scope, actorKey, normalizedKey)
    .first<IdempotencyRow>();

  if (
    row?.status === "completed" &&
    row.response_json &&
    typeof row.status_code === "number"
  ) {
    return {
      kind: "replay",
      statusCode: row.status_code,
      payload: JSON.parse(row.response_json) as T
    };
  }

  return { kind: "pending" };
};

export const completeIdempotentRequest = async (
  db: D1Database,
  scope: string,
  actorKey: string,
  idempotencyKey: string | null | undefined,
  statusCode: number,
  payload: unknown
) => {
  const normalizedKey = String(idempotencyKey || "").trim();
  if (!normalizedKey) return;

  await db.prepare(
    `UPDATE api_idempotency_request
        SET status = 'completed', response_json = ?, status_code = ?, updated_at = ?
      WHERE scope = ? AND actor_key = ? AND idempotency_key = ?`
  )
    .bind(JSON.stringify(payload), statusCode, nowIso(), scope, actorKey, normalizedKey)
    .run();
};

export const abandonIdempotentRequest = async (
  db: D1Database,
  scope: string,
  actorKey: string,
  idempotencyKey: string | null | undefined
) => {
  const normalizedKey = String(idempotencyKey || "").trim();
  if (!normalizedKey) return;

  await db.prepare(
    `DELETE FROM api_idempotency_request
      WHERE scope = ? AND actor_key = ? AND idempotency_key = ? AND status = 'pending'`
  )
    .bind(scope, actorKey, normalizedKey)
    .run();
};

/** Collapse whitespace so equivalent text yields the same content fingerprint. */
export const normalizeIdempotencyText = (value: string | null | undefined): string => {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");
};

/**
 * Coarse time bucket that scopes auto-generated content-fingerprint keys: an
 * identical payload re-sent within the window replays the first result instead
 * of creating a second record, while a genuine repeat later on is still allowed.
 */
export const idempotencyTimeBucket = (windowMs = 5 * 60 * 1000): string => {
  return String(Math.floor(Date.now() / windowMs));
};
