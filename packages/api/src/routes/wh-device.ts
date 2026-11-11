import { Hono } from "hono";

import { requireRoles } from "../middleware/rbac";
import {
  ALL_ROLES,
  requireHuman,
  requireKeeper,
  requireScrap,
  requireUnscrap
} from "../services/warehouse/access";
import {
  addDeviceNote,
  createDevice,
  getDevice,
  getDeviceByCode,
  listDevices,
  updateDevice
} from "../services/warehouse/device";
import { scrapDevice, unscrapDevice } from "../services/warehouse/doc-scrap";
import { WarehouseError } from "../services/warehouse/errors";
import { importDevices } from "../services/warehouse/import";
import { guarded, pathId, readJsonBody, type WhEnv } from "./wh-http";

export const whDeviceRoutes = new Hono<WhEnv>();

whDeviceRoutes.get(
  "/device",
  requireRoles(ALL_ROLES),
  guarded(async (c) => {
    const result = await listDevices(c.env, c.req.query());
    return c.json({
      success: true,
      data: result.items,
      pagination: { page: result.page, pageSize: result.pageSize, total: result.total }
    });
  })
);

whDeviceRoutes.get(
  "/device/by-code/:code",
  requireRoles(ALL_ROLES),
  guarded(async (c) => {
    const device = await getDeviceByCode(c.env, c.req.param("code"));
    if (!device) throw new WarehouseError(404, "找不到这个编号的设备");
    return c.json({ success: true, data: device });
  })
);

whDeviceRoutes.get(
  "/device/:id",
  requireRoles(ALL_ROLES),
  guarded(async (c) => {
    const device = await getDevice(c.env, pathId(c, "id", "设备"));
    if (!device) throw new WarehouseError(404, "设备不存在");
    return c.json({ success: true, data: device });
  })
);

whDeviceRoutes.post(
  "/device",
  requireHuman,
  requireKeeper,
  guarded(async (c) => {
    const data = await createDevice(c.env, await readJsonBody(c), c.get("auth").sub);
    return c.json({ success: true, data }, 201);
  })
);

whDeviceRoutes.put(
  "/device/:id",
  requireHuman,
  requireKeeper,
  guarded(async (c) => {
    await updateDevice(c.env, pathId(c, "id", "设备"), await readJsonBody(c), c.get("auth").sub);
    return c.json({ success: true });
  })
);

whDeviceRoutes.post(
  "/device/:id/note",
  requireHuman,
  requireKeeper,
  guarded(async (c) => {
    await addDeviceNote(c.env, pathId(c, "id", "设备"), await readJsonBody(c), c.get("auth").sub);
    return c.json({ success: true }, 201);
  })
);

whDeviceRoutes.post(
  "/device/:id/scrap",
  requireHuman,
  requireScrap,
  guarded(async (c) => {
    const data = await scrapDevice(
      c.env,
      pathId(c, "id", "设备"),
      await readJsonBody(c),
      c.get("auth").sub
    );
    return c.json({ success: true, data }, data.replayed ? 200 : 201);
  })
);

whDeviceRoutes.post(
  "/device/:id/unscrap",
  requireHuman,
  requireUnscrap,
  guarded(async (c) => {
    const data = await unscrapDevice(
      c.env,
      pathId(c, "id", "设备"),
      await readJsonBody(c),
      c.get("auth").sub
    );
    return c.json({ success: true, data }, data.replayed ? 200 : 201);
  })
);

whDeviceRoutes.post(
  "/device/import",
  requireHuman,
  requireKeeper,
  guarded(async (c) =>
    c.json({
      success: true,
      data: await importDevices(c.env, await readJsonBody(c), c.get("auth").sub)
    })
  )
);
