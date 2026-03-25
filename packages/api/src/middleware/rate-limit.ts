import type { MiddlewareHandler } from "hono";

import type { Env } from "../types/env";

const nowIso = () => new Date().toISOString();

const resolveActorKey = (headers: Headers): string => {
  const forwarded = headers.get("cf-connecting-ip") || headers.get("x-forwarded-for");
  if (forwarded?.trim()) {
    return forwarded.split(",")[0]?.trim() || "anonymous";
  }
  return headers.get("x-real-ip")?.trim() || "anonymous";
};

export const createRateLimitMiddleware = (options: {
  scope: string;
  maxRequests: number;
  windowSeconds: number;
}): MiddlewareHandler<{ Bindings: Env }> => {
  return async (c, next) => {
    const actorKey = resolveActorKey(c.req.raw.headers);
    const windowKey = String(Math.floor(Date.now() / 1000 / options.windowSeconds));
    const now = nowIso();

    await c.env.DB.prepare(
      `INSERT INTO api_rate_limit_bucket
        (scope, actor_key, window_key, hit_count, created_at, updated_at)
       VALUES (?, ?, ?, 1, ?, ?)
       ON CONFLICT(scope, actor_key, window_key)
       DO UPDATE SET hit_count = hit_count + 1, updated_at = excluded.updated_at`
    )
      .bind(options.scope, actorKey, windowKey, now, now)
      .run();

    const row = await c.env.DB.prepare(
      `SELECT hit_count FROM api_rate_limit_bucket
        WHERE scope = ? AND actor_key = ? AND window_key = ?`
    )
      .bind(options.scope, actorKey, windowKey)
      .first<{ hit_count: number }>();

    if ((row?.hit_count ?? 0) > options.maxRequests) {
      return c.json(
        {
          success: false,
          error: {
            message: "Too many requests, please retry later"
          }
        },
        429
      );
    }

    await next();
  };
};
