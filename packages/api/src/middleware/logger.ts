import type { MiddlewareHandler } from "hono";

/** 路径里带下载凭据的接口（资料对外链接的下载和作废）：令牌换成 ***，不进日志。 */
const SECRET_PATH = /^(.*\/doc-library\/shared?\/).+$/;

export const loggablePath = (path: string): string => path.replace(SECRET_PATH, "$1***");

export const requestLoggerMiddleware: MiddlewareHandler = async (c, next) => {
  const start = Date.now();
  await next();
  const duration = Date.now() - start;
  const method = c.req.method;
  const path = loggablePath(c.req.path);
  const status = c.res.status;

  console.log(JSON.stringify({ method, path, status, duration }));
};
