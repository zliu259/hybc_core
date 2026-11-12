import { Hono } from "hono";

import { requireRoles } from "../middleware/rbac";
import { ALL_ROLES, requireHuman, requireKeeper } from "../services/warehouse/access";
import { WarehouseError } from "../services/warehouse/errors";
import { cancelStocktake, startStocktake } from "../services/warehouse/stocktake";
import { completeStocktake } from "../services/warehouse/stocktake-complete";
import { markStocktakeDevice, saveMaterialCount } from "../services/warehouse/stocktake-count";
import { getStocktake, listStocktakes } from "../services/warehouse/stocktake-query";
import { guarded, pathId, readJsonBody, type WhContext, type WhEnv } from "./wh-http";

/** 盘点：谁都能看，只有库管能发起、录数、标记设备、完成、取消。 */
export const whStocktakeRoutes = new Hono<WhEnv>();

const stocktakeId = (c: WhContext): number => pathId(c, "id", "盘点");

whStocktakeRoutes.get(
  "/stocktake",
  requireRoles(ALL_ROLES),
  guarded(async (c) => {
    const result = await listStocktakes(c.env, c.req.query());
    return c.json({
      success: true,
      data: result.items,
      pagination: { page: result.page, pageSize: result.pageSize, total: result.total }
    });
  })
);

whStocktakeRoutes.get(
  "/stocktake/:id",
  requireRoles(ALL_ROLES),
  guarded(async (c) => {
    const detail = await getStocktake(c.env, stocktakeId(c));
    if (!detail) throw new WarehouseError(404, "盘点不存在");
    return c.json({ success: true, data: detail });
  })
);

whStocktakeRoutes.post(
  "/stocktake",
  requireRoles(ALL_ROLES),
  requireHuman,
  requireKeeper,
  guarded(async (c) => {
    const data = await startStocktake(c.env, await readJsonBody(c), c.get("auth").sub);
    return c.json({ success: true, data }, 201);
  })
);

whStocktakeRoutes.put(
  "/stocktake/:id/material-line/:lineId",
  requireRoles(ALL_ROLES),
  requireHuman,
  requireKeeper,
  guarded(async (c) => {
    const data = await saveMaterialCount(
      c.env,
      stocktakeId(c),
      pathId(c, "lineId", "盘点行"),
      await readJsonBody(c),
      c.get("auth").sub
    );
    return c.json({ success: true, data });
  })
);

whStocktakeRoutes.post(
  "/stocktake/:id/device-scan",
  requireRoles(ALL_ROLES),
  requireHuman,
  requireKeeper,
  guarded(async (c) => {
    const data = await markStocktakeDevice(
      c.env,
      stocktakeId(c),
      await readJsonBody(c),
      c.get("auth").sub
    );
    return c.json({ success: true, data });
  })
);

whStocktakeRoutes.post(
  "/stocktake/:id/complete",
  requireRoles(ALL_ROLES),
  requireHuman,
  requireKeeper,
  guarded(async (c) => {
    const data = await completeStocktake(
      c.env,
      stocktakeId(c),
      await readJsonBody(c),
      c.get("auth").sub
    );
    return c.json({ success: true, data });
  })
);

whStocktakeRoutes.post(
  "/stocktake/:id/cancel",
  requireRoles(ALL_ROLES),
  requireHuman,
  requireKeeper,
  guarded(async (c) => {
    const data = await cancelStocktake(
      c.env,
      stocktakeId(c),
      await readJsonBody(c),
      c.get("auth").sub
    );
    return c.json({ success: true, data });
  })
);
