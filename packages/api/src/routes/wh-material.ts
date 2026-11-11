import { Hono } from "hono";

import { requireRoles } from "../middleware/rbac";
import { ALL_ROLES, requireHuman, requireKeeper } from "../services/warehouse/access";
import { getMaterialLedger } from "../services/warehouse/doc-query";
import { WarehouseError } from "../services/warehouse/errors";
import {
  createMaterial,
  getMaterial,
  listInventory,
  listMaterials,
  updateMaterial
} from "../services/warehouse/material";
import { guarded, pathId, readJsonBody, type WhEnv } from "./wh-http";

export const whMaterialRoutes = new Hono<WhEnv>();

whMaterialRoutes.get(
  "/material",
  requireRoles(ALL_ROLES),
  guarded(async (c) => {
    const result = await listMaterials(c.env, c.req.query());
    return c.json({
      success: true,
      data: result.items,
      pagination: { page: result.page, pageSize: result.pageSize, total: result.total }
    });
  })
);

whMaterialRoutes.get(
  "/material/:id",
  requireRoles(ALL_ROLES),
  guarded(async (c) => {
    const material = await getMaterial(c.env, pathId(c, "id", "物资"));
    if (!material) throw new WarehouseError(404, "物资不存在");
    return c.json({ success: true, data: material });
  })
);

whMaterialRoutes.post(
  "/material",
  requireHuman,
  requireKeeper,
  guarded(async (c) =>
    c.json({ success: true, data: await createMaterial(c.env, await readJsonBody(c)) }, 201)
  )
);

whMaterialRoutes.put(
  "/material/:id",
  requireHuman,
  requireKeeper,
  guarded(async (c) => {
    await updateMaterial(c.env, pathId(c, "id", "物资"), await readJsonBody(c));
    return c.json({ success: true });
  })
);

whMaterialRoutes.get(
  "/inventory",
  requireRoles(ALL_ROLES),
  guarded(async (c) => c.json({ success: true, data: await listInventory(c.env, false) }))
);

whMaterialRoutes.get(
  "/inventory/alert",
  requireRoles(ALL_ROLES),
  guarded(async (c) => c.json({ success: true, data: await listInventory(c.env, true) }))
);

whMaterialRoutes.get(
  "/material/:id/ledger",
  requireRoles(ALL_ROLES),
  guarded(async (c) => {
    const result = await getMaterialLedger(c.env, pathId(c, "id", "物资"), c.req.query());
    return c.json({
      success: true,
      data: result.items,
      pagination: { page: result.page, pageSize: result.pageSize, total: result.total }
    });
  })
);
