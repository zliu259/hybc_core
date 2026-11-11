import { Hono } from "hono";

import { requireRoles } from "../middleware/rbac";
import { ALL_ROLES, requireHuman, requireKeeper } from "../services/warehouse/access";
import { createWhDoc } from "../services/warehouse/doc";
import { getWhDoc, listWhDocs } from "../services/warehouse/doc-query";
import { WarehouseError } from "../services/warehouse/errors";
import { guarded, pathId, readJsonBody, type WhEnv } from "./wh-http";

export const whDocRoutes = new Hono<WhEnv>();

whDocRoutes.post(
  "/doc",
  requireHuman,
  requireKeeper,
  guarded(async (c) => {
    const data = await createWhDoc(c.env, await readJsonBody(c), c.get("auth").sub);
    return c.json({ success: true, data }, data.replayed ? 200 : 201);
  })
);

whDocRoutes.get(
  "/doc",
  requireRoles(ALL_ROLES),
  guarded(async (c) => {
    const result = await listWhDocs(c.env, c.req.query());
    return c.json({
      success: true,
      data: result.items,
      pagination: { page: result.page, pageSize: result.pageSize, total: result.total }
    });
  })
);

whDocRoutes.get(
  "/doc/:id",
  requireRoles(ALL_ROLES),
  guarded(async (c) => {
    const doc = await getWhDoc(c.env, pathId(c, "id", "单据"));
    if (!doc) throw new WarehouseError(404, "单据不存在");
    return c.json({ success: true, data: doc });
  })
);
