import { Hono } from "hono";

import { requireRoles } from "../middleware/rbac";
import {
  ALL_ROLES,
  getWarehouseCapabilities,
  requireHuman,
  requireKeeper
} from "../services/warehouse/access";
import { WarehouseError } from "../services/warehouse/errors";
import { publishWarehouseNotice } from "../services/warehouse/notice";
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
import { guarded, pathId, readJsonBody, type WhContext, type WhEnv } from "./wh-http";

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
    const userid = c.get("auth").sub;
    const data = await createTask(c.env, await readJsonBody(c), userid);
    // 没有执行人的任务，投递时会跳过
    await publishWarehouseNotice(c.env, { kind: "tasks_assigned", task_ids: [data.id] }, userid);
    return c.json({ success: true, data }, 201);
  })
);

const keeperAction = (
  path: string,
  action: (c: WhContext, id: number, body: Record<string, unknown>) => Promise<unknown>
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

/** 检查不合格时任务完成会带出一个维修任务，告诉库管。 */
const noticeRepair = async (c: WhContext, followupTaskId: number | null): Promise<void> => {
  if (followupTaskId === null) return;
  await publishWarehouseNotice(
    c.env,
    { kind: "repair_created", task_id: followupTaskId },
    c.get("auth").sub
  );
};

keeperAction("/task/:id/assign", async (c, id, body) => {
  const userid = c.get("auth").sub;
  await assignTask(c.env, id, body, userid);
  await publishWarehouseNotice(c.env, { kind: "tasks_assigned", task_ids: [id] }, userid);
});
keeperAction("/task/:id/confirm", async (c, id, body) => {
  const data = await confirmTask(c.env, id, body, c.get("auth").sub);
  await noticeRepair(c, data.followup_task_id);
  return data;
});
keeperAction("/task/:id/send-back", async (c, id, body) => {
  const userid = c.get("auth").sub;
  await sendBackTask(c.env, id, body, userid);
  await publishWarehouseNotice(c.env, { kind: "task_sent_back", task_id: id }, userid);
});
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
    const id = pathId(c, "id", "任务");
    const data = await submitTask(c.env, id, await readJsonBody(c), auth, caps);
    // 库管自己做的任务提交即完成，没有人要等着确认
    if (data.status === "submitted") {
      await publishWarehouseNotice(c.env, { kind: "task_submitted", task_id: id }, auth.sub);
    }
    await noticeRepair(c, data.followup_task_id);
    return c.json({ success: true, data });
  })
);
