import { Hono } from "hono";

import { putDocUploadPart } from "../services/doc-library/upload";
import { guarded, type WhEnv } from "./wh-http";

/**
 * 设备资料库里不带登录态的请求。在 index.ts 里挂在 /api/v1/doc-library 上、排在要登录的那组之前；
 * 这里只注册明确的路径，其余的落到后面那组去。
 *
 * - 传分片：靠初始化时签发的上传令牌鉴权（令牌里有上传人、文件键、大小，改不了）。
 */
export const docLibraryOpenRoutes = new Hono<WhEnv>();

docLibraryOpenRoutes.put(
  "/upload/part",
  guarded(async (c) => {
    const data = await putDocUploadPart(
      c.env,
      c.req.query("token"),
      c.req.query("part"),
      await c.req.arrayBuffer()
    );
    return c.json({ success: true, data });
  })
);
