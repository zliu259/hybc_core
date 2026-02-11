import type { MiddlewareHandler } from "hono";

export const requestLoggerMiddleware: MiddlewareHandler = async (c, next) => {
  const start = Date.now();
  await next();
  const duration = Date.now() - start;
  const method = c.req.method;
  const path = c.req.path;
  const status = c.res.status;

  console.log(JSON.stringify({ method, path, status, duration }));
};
