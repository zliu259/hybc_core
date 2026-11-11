import { Hono } from "hono";

import { authMiddleware } from "../middleware/auth";
import type { Env } from "../types/env";
import { whDeviceRoutes } from "./wh-device";
import { whDocRoutes } from "./wh-doc";
import type { WhEnv } from "./wh-http";
import { whKitRoutes } from "./wh-kit";
import { whKitTemplateRoutes } from "./wh-kit-template";
import { whMaterialRoutes } from "./wh-material";
import { whSettingsRoutes } from "./wh-settings";
import { whTaskRoutes } from "./wh-task";

/**
 * 把新库房的路由挂到 /api/v1/warehouse。只在这里过一次 authMiddleware，各 wh-*.ts 路由自己不再挂。
 * 必须在 index.ts 里旧接口占位（warehouse-legacy-stub）之前调用。
 */
export const mountWarehouseRoutes = (app: Hono<{ Bindings: Env }>): void => {
  const warehouse = new Hono<WhEnv>();
  warehouse.use("*", authMiddleware);
  warehouse.route("/", whSettingsRoutes);
  warehouse.route("/", whDeviceRoutes);
  warehouse.route("/", whMaterialRoutes);
  warehouse.route("/", whTaskRoutes);
  warehouse.route("/", whDocRoutes);
  warehouse.route("/", whKitTemplateRoutes);
  warehouse.route("/", whKitRoutes);
  app.route("/api/v1/warehouse", warehouse);
};
