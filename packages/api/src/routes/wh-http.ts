/** 库房路由共用：错误转响应、读请求体。 */
import type { Context, Handler } from "hono";

import type { AuthVariables } from "../middleware/auth";
import { WarehouseError } from "../services/warehouse/errors";
import { isCheckFailure, isGuardFailure } from "../services/warehouse/guard";
import type { Env } from "../types/env";

export type WhEnv = { Bindings: Env; Variables: AuthVariables };
export type WhContext = Context<WhEnv>;

const fail = (c: WhContext, status: 400 | 403 | 404 | 409 | 500, message: string): Response =>
  c.json({ success: false, error: { message } }, status);

/**
 * WarehouseError 用它自己的状态码；批内断言失败是并发冲突，409；库存约束失败 400。
 * 其他错误记日志后返回 500：authMiddleware 会把漏出去的异常变成 401，不能让它漏出去。
 */
export const handleWarehouseError = (c: WhContext, error: unknown): Response => {
  if (error instanceof WarehouseError) return fail(c, error.status, error.message);
  if (isGuardFailure(error)) return fail(c, 409, "数据已变化，请刷新后重试");
  if (isCheckFailure(error, "material_quantity_non_negative")) return fail(c, 400, "库存不足");
  console.error("[warehouse] unexpected error", error);
  return fail(c, 500, "服务器出错，请稍后重试");
};

/** 包一层 try/catch，handler 里直接 throw WarehouseError 即可。 */
export const guarded =
  (handler: (c: WhContext) => Promise<Response>): Handler<WhEnv> =>
  async (c) => {
    try {
      return await handler(c);
    } catch (error) {
      return handleWarehouseError(c, error);
    }
  };

export const readJsonBody = async (c: WhContext): Promise<Record<string, unknown>> => {
  const body: unknown = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new WarehouseError(400, "请求内容格式不对");
  }
  return body as Record<string, unknown>;
};

export const pathId = (c: WhContext, name: string, label: string): number => {
  const value = Number(c.req.param(name));
  if (!Number.isInteger(value) || value <= 0) throw new WarehouseError(404, `${label}不存在`);
  return value;
};
