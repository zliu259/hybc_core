import type { MiddlewareHandler } from "hono";
import type { Env } from "../types/env";

/**
 * Middleware for compute node authentication via API key.
 * Used on task/node endpoints only — does NOT interfere with JWT auth on other routes.
 */
export const apiKeyMiddleware: MiddlewareHandler<{
  Bindings: Env;
}> = async (c, next) => {
  const apiKey = c.req.header("x-api-key");
  if (!apiKey || apiKey !== c.env.TASK_API_KEY) {
    return c.json(
      { success: false, error: { message: "Invalid API key" } },
      401
    );
  }
  await next();
};
