import { Hono } from "hono";

import { requireRoles } from "../middleware/rbac";
import { ALL_ROLES, requireHuman, requireKeeper } from "../services/warehouse/access";
import { WarehouseError } from "../services/warehouse/errors";
import {
  createKitTemplate,
  getKitTemplate,
  listKitTemplates,
  updateKitTemplate
} from "../services/warehouse/kit-template";
import { guarded, pathId, readJsonBody, type WhEnv } from "./wh-http";

/** 配套清单模板：所有人能看，只有库管能建和改。 */
export const whKitTemplateRoutes = new Hono<WhEnv>();

whKitTemplateRoutes.get(
  "/kit-template",
  requireRoles(ALL_ROLES),
  guarded(async (c) => {
    const data = await listKitTemplates(c.env, { status: c.req.query("status") });
    return c.json({ success: true, data });
  })
);

whKitTemplateRoutes.get(
  "/kit-template/:id",
  requireRoles(ALL_ROLES),
  guarded(async (c) => {
    const template = await getKitTemplate(c.env, pathId(c, "id", "模板"));
    if (!template) throw new WarehouseError(404, "模板不存在");
    return c.json({ success: true, data: template });
  })
);

whKitTemplateRoutes.post(
  "/kit-template",
  requireHuman,
  requireKeeper,
  guarded(async (c) => {
    const data = await createKitTemplate(c.env, await readJsonBody(c), c.get("auth").sub);
    return c.json({ success: true, data }, 201);
  })
);

whKitTemplateRoutes.put(
  "/kit-template/:id",
  requireHuman,
  requireKeeper,
  guarded(async (c) => {
    await updateKitTemplate(c.env, pathId(c, "id", "模板"), await readJsonBody(c));
    return c.json({ success: true });
  })
);
