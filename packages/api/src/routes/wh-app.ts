import { Hono } from "hono";

import { authMiddleware } from "../middleware/auth";
import type { Env } from "../types/env";
import type { WhEnv } from "./wh-http";
import { whSettingsRoutes } from "./wh-settings";

/**
 * 把新库房的路由挂到 /api/v1/warehouse。只在这里过一次 authMiddleware，各 wh-*.ts 路由自己不再挂。
 * 必须在 index.ts 里旧接口占位（warehouse-legacy-stub）之前调用。
 */
export const mountWarehouseRoutes = (app: Hono<{ Bindings: Env }>): void => {
  const warehouse = new Hono<WhEnv>();
  warehouse.use("*", authMiddleware);
  warehouse.route("/", whSettingsRoutes);
  app.route("/api/v1/warehouse", warehouse);
};
