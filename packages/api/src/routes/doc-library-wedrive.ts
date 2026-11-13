import { Hono } from "hono";

import { authMiddleware } from "../middleware/auth";
import {
  requireDocAdmin,
  requireHuman,
  requireMirrorViewer,
  requireSettingsManager
} from "../services/warehouse/access";
import {
  getWedriveStatus,
  openWedriveSpace,
  remirrorDoc,
  retryFailedMirrors,
  setupWedrive,
  updateWedriveSettings
} from "../services/wedrive/admin";
import { WedriveError } from "../services/wedrive/client";
import { handleWarehouseError, pathId, readJsonBody, type WhContext, type WhEnv } from "./wh-http";

/**
 * 设备资料库的微盘镜像：状态、初始化、开关、恢复、对全公司开放、重试。挂在 /api/v1/doc-library，排在 doc-library.ts 前面。
 * 初始化、开关、恢复、开放、全部重试只给经理和超管；单份「重新同步」给库管和资料管理员。智能体令牌一个都进不来。
 * 登录校验只挂在自己的路径上：挂成 "*" 的话，后面 doc-library.ts 的每个请求都会多验一次。
 */
export const docLibraryWedriveRoutes = new Hono<WhEnv>();

docLibraryWedriveRoutes.use("/wedrive/*", authMiddleware);
docLibraryWedriveRoutes.use("/file/:id/remirror", authMiddleware);

/** 微盘那一头报的错（没权限、超限、参数不对）带着错误码原样告诉管理员，状态码 502；别的照库房的规矩。 */
const mirrorGuarded = (handler: (c: WhContext) => Promise<Response>) => async (c: WhContext) => {
  try {
    return await handler(c);
  } catch (error) {
    if (error instanceof WedriveError) {
      console.error("[wedrive] request failed", error);
      return c.json({ success: false, error: { message: error.message } }, 502);
    }
    return handleWarehouseError(c, error);
  }
};

docLibraryWedriveRoutes.get(
  "/wedrive/status",
  requireMirrorViewer,
  mirrorGuarded(async (c) => c.json({ success: true, data: await getWedriveStatus(c.env) }))
);

docLibraryWedriveRoutes.post(
  "/wedrive/setup",
  requireHuman,
  requireSettingsManager,
  mirrorGuarded(async (c) =>
    c.json({ success: true, data: await setupWedrive(c.env, c.get("auth").sub) })
  )
);

docLibraryWedriveRoutes.put(
  "/wedrive/settings",
  requireHuman,
  requireSettingsManager,
  mirrorGuarded(async (c) => {
    const data = await updateWedriveSettings(c.env, await readJsonBody(c), c.get("auth").sub);
    return c.json({ success: true, data });
  })
);

docLibraryWedriveRoutes.post(
  "/wedrive/open",
  requireHuman,
  requireSettingsManager,
  mirrorGuarded(async (c) =>
    c.json({ success: true, data: await openWedriveSpace(c.env, c.get("auth").sub) })
  )
);

docLibraryWedriveRoutes.post(
  "/wedrive/retry-failed",
  requireHuman,
  requireSettingsManager,
  mirrorGuarded(async (c) => c.json({ success: true, data: await retryFailedMirrors(c.env) }))
);

docLibraryWedriveRoutes.post(
  "/file/:id/remirror",
  requireHuman,
  requireDocAdmin,
  mirrorGuarded(async (c) => {
    await remirrorDoc(c.env, pathId(c, "id", "资料"));
    return c.json({ success: true });
  })
);
