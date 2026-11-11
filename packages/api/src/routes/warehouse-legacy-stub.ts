import { Hono } from "hono";

import { authMiddleware, type AuthVariables } from "../middleware/auth";
import type { Env } from "../types/env";

/**
 * 旧库房和资产接口的占位，在 index.ts 里挂在 /api/v1/asset 和 /api/v1/warehouse 两处，
 * 必须挂在新库房路由之后。
 *
 * 已发布的小程序库房页和已安装的 MCP 还在调旧路径：列表类 GET 返回空数组，页面能打开；
 * 其余一律 410。阶段 3 换掉小程序页面后删除这个文件。
 */
export const warehouseLegacyStubRoutes = new Hono<{
  Bindings: Env;
  Variables: AuthVariables;
}>();

warehouseLegacyStubRoutes.use("*", authMiddleware);

const EMPTY_LIST_PATHS = new Set([
  "/api/v1/warehouse",
  "/api/v1/warehouse/stock-order",
  "/api/v1/warehouse/stocktake",
  "/api/v1/warehouse/work-order/mobile/my-tasks",
  "/api/v1/asset",
  "/api/v1/asset/type"
]);

warehouseLegacyStubRoutes.all("*", (c) => {
  const path = c.req.path.replace(/\/+$/, "");
  if (c.req.method === "GET" && EMPTY_LIST_PATHS.has(path)) {
    return c.json({ success: true, data: [] });
  }
  return c.json({ success: false, error: { message: "库房功能已升级，请使用新版页面" } }, 410);
});
