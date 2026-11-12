import { Hono } from "hono";

import { requireRoles } from "../middleware/rbac";
import { ALL_ROLES, requireHuman, requireKeeper } from "../services/warehouse/access";
import { createWhDoc } from "../services/warehouse/doc";
import { getWhDoc, listWhDocs } from "../services/warehouse/doc-query";
import { reverseWhDoc } from "../services/warehouse/doc-reverse";
import { WarehouseError } from "../services/warehouse/errors";
import { getProjectHoldings } from "../services/warehouse/holdings";
import { publishWarehouseNotice } from "../services/warehouse/notice";
import { getProjectLedger } from "../services/warehouse/project-ledger";
import { guarded, pathId, readJsonBody, type WhEnv } from "./wh-http";

export const whDocRoutes = new Hono<WhEnv>();

whDocRoutes.post(
  "/doc",
  requireHuman,
  requireKeeper,
  guarded(async (c) => {
    const userid = c.get("auth").sub;
    const data = await createWhDoc(c.env, await readJsonBody(c), userid);
    // 重放的请求第一次已经通知过了
    if (!data.replayed) {
      await publishWarehouseNotice(c.env, { kind: "doc_posted", doc_id: data.id }, userid);
      if (data.created_task_ids.length > 0) {
        await publishWarehouseNotice(
          c.env,
          { kind: "tasks_assigned", task_ids: data.created_task_ids },
          userid
        );
      }
    }
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

whDocRoutes.get(
  "/project/:projectId/holdings",
  requireRoles(ALL_ROLES),
  guarded(async (c) => {
    const data = await getProjectHoldings(c.env, pathId(c, "projectId", "项目"));
    return c.json({ success: true, data });
  })
);

whDocRoutes.post(
  "/doc/:id/reverse",
  requireHuman,
  requireKeeper,
  guarded(async (c) => {
    const userid = c.get("auth").sub;
    const data = await reverseWhDoc(c.env, pathId(c, "id", "单据"), await readJsonBody(c), userid);
    if (!data.replayed) {
      await publishWarehouseNotice(c.env, { kind: "doc_posted", doc_id: data.id }, userid);
    }
    return c.json({ success: true, data }, data.replayed ? 200 : 201);
  })
);

whDocRoutes.get(
  "/project/:projectId/ledger",
  requireRoles(ALL_ROLES),
  guarded(async (c) => {
    const data = await getProjectLedger(c.env, pathId(c, "projectId", "项目"));
    return c.json({ success: true, data });
  })
);
