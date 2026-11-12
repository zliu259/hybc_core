import { Hono } from "hono";

import { authMiddleware } from "../middleware/auth";
import { requireRoles } from "../middleware/rbac";
import { getDocLibraryConfig } from "../services/doc-library/config";
import {
  getDocFile,
  getDocTree,
  listDocFiles,
  listDocsForDevice
} from "../services/doc-library/query";
import { deleteDocFile, getDocFileUrl, updateDocFile } from "../services/doc-library/file";
import { createDocShare, listDocShares, revokeDocShare } from "../services/doc-library/share";
import { abortDocUpload, completeDocUpload, initDocUpload } from "../services/doc-library/upload";
import { ALL_ROLES, requireDocAdmin, requireHuman } from "../services/warehouse/access";
import { WarehouseError } from "../services/warehouse/errors";
import { guarded, pathId, readJsonBody, type WhEnv } from "./wh-http";

/**
 * 设备资料库（要登录的接口）。挂在 /api/v1/doc-library。
 * 不带登录态的两类请求（传分片、对外链接下载）在 doc-library-open.ts，在 index.ts 里挂在它前面。
 * 看资料是全部五个角色；智能体令牌不在只读白名单里，进不来。
 */
export const docLibraryRoutes = new Hono<WhEnv>();

docLibraryRoutes.use("*", authMiddleware);

docLibraryRoutes.get(
  "/config",
  requireRoles(ALL_ROLES),
  guarded(async (c) => c.json({ success: true, data: await getDocLibraryConfig(c.env) }))
);

docLibraryRoutes.get(
  "/file",
  requireRoles(ALL_ROLES),
  guarded(async (c) => {
    const result = await listDocFiles(c.env, c.req.query());
    return c.json({
      success: true,
      data: result.items,
      pagination: { page: result.page, pageSize: result.pageSize, total: result.total }
    });
  })
);

docLibraryRoutes.get(
  "/file/:id",
  requireRoles(ALL_ROLES),
  guarded(async (c) => {
    const doc = await getDocFile(c.env, pathId(c, "id", "资料"));
    if (!doc) throw new WarehouseError(404, "资料不存在");
    return c.json({ success: true, data: doc });
  })
);

docLibraryRoutes.get(
  "/tree",
  requireRoles(ALL_ROLES),
  guarded(async (c) => c.json({ success: true, data: await getDocTree(c.env) }))
);

docLibraryRoutes.get(
  "/for-device/:deviceId",
  requireRoles(ALL_ROLES),
  guarded(async (c) => {
    const data = await listDocsForDevice(
      c.env,
      pathId(c, "deviceId", "设备"),
      c.req.query("task_kind")
    );
    return c.json({ success: true, data });
  })
);

docLibraryRoutes.get(
  "/file/:id/url",
  requireRoles(ALL_ROLES),
  guarded(async (c) => {
    const data = await getDocFileUrl(c.env, pathId(c, "id", "资料"), c.req.url);
    return c.json({ success: true, data });
  })
);

docLibraryRoutes.put(
  "/file/:id",
  requireHuman,
  requireDocAdmin,
  guarded(async (c) => {
    await updateDocFile(c.env, pathId(c, "id", "资料"), await readJsonBody(c));
    return c.json({ success: true });
  })
);

docLibraryRoutes.delete(
  "/file/:id",
  requireHuman,
  requireDocAdmin,
  guarded(async (c) => {
    await deleteDocFile(c.env, pathId(c, "id", "资料"), await readJsonBody(c), c.get("auth").sub);
    return c.json({ success: true });
  })
);

// ─── 对外链接（公开下载在 doc-library-open.ts，不带登录态） ────
// 列出也只给资料管理员：令牌就是下载凭据，不该让所有人看到。

docLibraryRoutes.post(
  "/file/:id/share",
  requireHuman,
  requireDocAdmin,
  guarded(async (c) => {
    const data = await createDocShare(
      c.env,
      pathId(c, "id", "资料"),
      await readJsonBody(c),
      c.get("auth").sub,
      c.req.url
    );
    return c.json({ success: true, data }, 201);
  })
);

docLibraryRoutes.get(
  "/file/:id/share",
  requireHuman,
  requireDocAdmin,
  guarded(async (c) => {
    const data = await listDocShares(c.env, pathId(c, "id", "资料"), c.req.url);
    return c.json({ success: true, data });
  })
);

docLibraryRoutes.delete(
  "/share/:token",
  requireHuman,
  requireDocAdmin,
  guarded(async (c) => {
    await revokeDocShare(c.env, c.req.param("token"));
    return c.json({ success: true });
  })
);

// ─── 上传（传分片在 doc-library-open.ts，不带登录态） ──────────

docLibraryRoutes.post(
  "/upload/init",
  requireHuman,
  requireDocAdmin,
  guarded(async (c) => {
    const data = await initDocUpload(c.env, await readJsonBody(c), c.get("auth"));
    return c.json({ success: true, data });
  })
);

docLibraryRoutes.post(
  "/upload/complete",
  requireHuman,
  requireDocAdmin,
  guarded(async (c) => {
    const data = await completeDocUpload(c.env, await readJsonBody(c), c.get("auth"));
    return c.json({ success: true, data }, data.replayed ? 200 : 201);
  })
);

docLibraryRoutes.post(
  "/upload/abort",
  requireHuman,
  requireDocAdmin,
  guarded(async (c) => {
    await abortDocUpload(c.env, await readJsonBody(c), c.get("auth"));
    return c.json({ success: true });
  })
);
