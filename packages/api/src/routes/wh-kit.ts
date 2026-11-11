import { Hono } from "hono";

import { requireRoles } from "../middleware/rbac";
import {
  ALL_ROLES,
  getWarehouseCapabilities,
  requireHuman,
  requireKeeper
} from "../services/warehouse/access";
import { WarehouseError } from "../services/warehouse/errors";
import {
  closeProjectKit,
  confirmProjectKit,
  createProjectKit,
  discardProjectKit,
  submitProjectKit,
  updateProjectKit
} from "../services/warehouse/kit";
import { getProjectKit, listProjectKits } from "../services/warehouse/kit-query";
import { getKitFulfilment } from "../services/warehouse/project-ledger";
import { guarded, pathId, readJsonBody, type WhEnv } from "./wh-http";

/** 项目配套清单。谁能建和改在 service 里按项目判断（现场负责人只限自己的项目）。 */
export const whKitRoutes = new Hono<WhEnv>();

whKitRoutes.get(
  "/kit",
  requireRoles(ALL_ROLES),
  guarded(async (c) => {
    const result = await listProjectKits(c.env, c.req.query());
    return c.json({
      success: true,
      data: result.items,
      pagination: { page: result.page, pageSize: result.pageSize, total: result.total }
    });
  })
);

whKitRoutes.get(
  "/kit/:id",
  requireRoles(ALL_ROLES),
  guarded(async (c) => {
    const kit = await getProjectKit(c.env, pathId(c, "id", "清单"));
    if (!kit) throw new WarehouseError(404, "清单不存在");
    return c.json({ success: true, data: kit });
  })
);

whKitRoutes.post(
  "/kit",
  requireHuman,
  guarded(async (c) => {
    const auth = c.get("auth");
    const caps = await getWarehouseCapabilities(c.env, auth);
    const data = await createProjectKit(c.env, await readJsonBody(c), auth, caps);
    return c.json({ success: true, data }, 201);
  })
);

whKitRoutes.put(
  "/kit/:id",
  requireHuman,
  guarded(async (c) => {
    const auth = c.get("auth");
    const caps = await getWarehouseCapabilities(c.env, auth);
    await updateProjectKit(c.env, pathId(c, "id", "清单"), await readJsonBody(c), auth, caps);
    return c.json({ success: true });
  })
);

whKitRoutes.post(
  "/kit/:id/submit",
  requireHuman,
  guarded(async (c) => {
    const auth = c.get("auth");
    const caps = await getWarehouseCapabilities(c.env, auth);
    const data = await submitProjectKit(
      c.env,
      pathId(c, "id", "清单"),
      await readJsonBody(c),
      auth,
      caps
    );
    return c.json({ success: true, data });
  })
);

whKitRoutes.post(
  "/kit/:id/confirm",
  requireHuman,
  requireKeeper,
  guarded(async (c) => {
    await confirmProjectKit(
      c.env,
      pathId(c, "id", "清单"),
      await readJsonBody(c),
      c.get("auth").sub
    );
    return c.json({ success: true });
  })
);

whKitRoutes.post(
  "/kit/:id/discard",
  requireHuman,
  guarded(async (c) => {
    const auth = c.get("auth");
    const caps = await getWarehouseCapabilities(c.env, auth);
    await discardProjectKit(c.env, pathId(c, "id", "清单"), await readJsonBody(c), auth, caps);
    return c.json({ success: true });
  })
);

whKitRoutes.get(
  "/kit/:id/fulfilment",
  requireRoles(ALL_ROLES),
  guarded(async (c) => {
    const data = await getKitFulfilment(c.env, pathId(c, "id", "清单"));
    return c.json({ success: true, data });
  })
);

whKitRoutes.post(
  "/kit/:id/close",
  requireHuman,
  requireKeeper,
  guarded(async (c) => {
    await closeProjectKit(c.env, pathId(c, "id", "清单"), await readJsonBody(c), c.get("auth").sub);
    return c.json({ success: true });
  })
);
