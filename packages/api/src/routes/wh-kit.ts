import { Hono } from "hono";

import { requireRoles } from "../middleware/rbac";
import {
  ALL_ROLES,
  getWarehouseCapabilities,
  requireHuman,
  requireKeeper,
  requireKitCreator
} from "../services/warehouse/access";
import { WarehouseError } from "../services/warehouse/errors";
import {
  assertCanEditKitFor,
  closeProjectKit,
  confirmProjectKit,
  createProjectKit,
  discardProjectKit,
  submitProjectKit,
  updateProjectKit
} from "../services/warehouse/kit";
import { buildPlan } from "../services/warehouse/kit-plan-build";
import { parsePlanParams } from "../services/warehouse/kit-plan-calc";
import { loadPlanSource } from "../services/warehouse/kit-plan-source";
import { getProjectKit, listProjectKits } from "../services/warehouse/kit-query";
import { publishWarehouseNotice } from "../services/warehouse/notice";
import { getKitFulfilment } from "../services/warehouse/project-ledger";
import { requireId } from "../services/warehouse/validation";
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

/** 按项目参数生成：从工作段和项目档案取到的参数。只给能为这个项目建清单的人看。 */
whKitRoutes.get(
  "/kit/plan/source",
  requireKitCreator,
  guarded(async (c) => {
    const projectId = requireId(c.req.query("project_id"), "项目");
    const auth = c.get("auth");
    const caps = await getWarehouseCapabilities(c.env, auth);
    await assertCanEditKitFor(c.env, auth, caps, projectId);
    return c.json({ success: true, data: await loadPlanSource(c.env, projectId) });
  })
);

/** 按项目参数生成的预览：算好的行、主要设备的候选、提醒。不写库。 */
whKitRoutes.post(
  "/kit/plan/preview",
  requireKitCreator,
  guarded(async (c) => {
    const body = await readJsonBody(c);
    const projectId = requireId(body.project_id, "项目");
    const templateId = requireId(body.template_id, "模板");
    const auth = c.get("auth");
    const caps = await getWarehouseCapabilities(c.env, auth);
    await assertCanEditKitFor(c.env, auth, caps, projectId);
    const plan = await buildPlan(c.env, templateId, parsePlanParams(body.params));
    return c.json({ success: true, data: plan });
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
  requireKitCreator,
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
  requireKitCreator,
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
  requireKitCreator,
  guarded(async (c) => {
    const auth = c.get("auth");
    const caps = await getWarehouseCapabilities(c.env, auth);
    const id = pathId(c, "id", "清单");
    const data = await submitProjectKit(c.env, id, await readJsonBody(c), auth, caps);
    // 库管提交是直接确认，没有人要等着确认
    if (data.status === "submitted") {
      await publishWarehouseNotice(c.env, { kind: "kit_submitted", kit_id: id }, auth.sub);
    }
    return c.json({ success: true, data });
  })
);

whKitRoutes.post(
  "/kit/:id/confirm",
  requireHuman,
  requireKeeper,
  guarded(async (c) => {
    const id = pathId(c, "id", "清单");
    const userid = c.get("auth").sub;
    await confirmProjectKit(c.env, id, await readJsonBody(c), userid);
    await publishWarehouseNotice(c.env, { kind: "kit_confirmed", kit_id: id }, userid);
    return c.json({ success: true });
  })
);

whKitRoutes.post(
  "/kit/:id/discard",
  requireHuman,
  requireKitCreator,
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
