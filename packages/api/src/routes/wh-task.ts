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
  addTaskPhoto,
  assignTask,
  cancelTask,
  confirmTask,
  createTask,
  getTask,
  listTasks,
  removeTaskPhoto,
  sendBackTask,
  submitTask
} from "../services/warehouse/task";
import { guarded, pathId, readJsonBody, type WhEnv } from "./wh-http";

export const whTaskRoutes = new Hono<WhEnv>();

whTaskRoutes.get(
  "/task",
  requireRoles(ALL_ROLES),
  guarded(async (c) => {
    const result = await listTasks(c.env, c.req.query(), c.get("auth").sub);
    return c.json({
      success: true,
      data: result.items,
      pagination: { page: result.page, pageSize: result.pageSize, total: result.total }
    });
  })
);

whTaskRoutes.get(
  "/task/:id",
  requireRoles(ALL_ROLES),
  guarded(async (c) => {
    const task = await getTask(c.env, pathId(c, "id", "任务"));
    if (!task) throw new WarehouseError(404, "任务不存在");
    return c.json({ success: true, data: task });
  })
);

whTaskRoutes.post(
  "/task",
  requireHuman,
  requireKeeper,
  guarded(async (c) => {
    const data = await createTask(c.env, await readJsonBody(c), c.get("auth").sub);
    return c.json({ success: true, data }, 201);
  })
);

const keeperAction = (
  path: string,
  action: (
    c: Parameters<Parameters<typeof guarded>[0]>[0],
    id: number,
    body: Record<string, unknown>
  ) => Promise<unknown>
) =>
  whTaskRoutes.post(
    path,
    requireHuman,
    requireKeeper,
    guarded(async (c) => {
      const data = await action(c, pathId(c, "id", "任务"), await readJsonBody(c));
      return c.json({ success: true, ...(data === undefined ? {} : { data }) });
    })
  );

keeperAction("/task/:id/assign", (c, id, body) => assignTask(c.env, id, body, c.get("auth").sub));
keeperAction("/task/:id/confirm", (c, id, body) => confirmTask(c.env, id, body, c.get("auth").sub));
keeperAction("/task/:id/send-back", (c, id, body) =>
  sendBackTask(c.env, id, body, c.get("auth").sub)
);
keeperAction("/task/:id/cancel", (c, id, body) => cancelTask(c.env, id, body, c.get("auth").sub));

whTaskRoutes.post(
  "/task/:id/photo",
  requireHuman,
  guarded(async (c) => {
    const auth = c.get("auth");
    const caps = await getWarehouseCapabilities(c.env, auth);
    const data = await addTaskPhoto(
      c.env,
      pathId(c, "id", "任务"),
      await readJsonBody(c),
      auth,
      caps
    );
    return c.json({ success: true, data }, 201);
  })
);

whTaskRoutes.delete(
  "/task/:id/photo/:photoId",
  requireHuman,
  guarded(async (c) => {
    await removeTaskPhoto(
      c.env,
      pathId(c, "id", "任务"),
      pathId(c, "photoId", "照片"),
      c.get("auth")
    );
    return c.json({ success: true });
  })
);

whTaskRoutes.post(
  "/task/:id/submit",
  requireHuman,
  guarded(async (c) => {
    const auth = c.get("auth");
    const caps = await getWarehouseCapabilities(c.env, auth);
    const data = await submitTask(
      c.env,
      pathId(c, "id", "任务"),
      await readJsonBody(c),
      auth,
      caps
    );
    return c.json({ success: true, data });
  })
);
