import { Hono } from "hono";

import { createRateLimitMiddleware } from "../middleware/rate-limit";
import { openDocShare } from "../services/doc-library/share";
import { putDocUploadPart } from "../services/doc-library/upload";
import { serveObject } from "../services/object-serve";
import { guarded, type WhContext, type WhEnv } from "./wh-http";

/**
 * 设备资料库里不带登录态的请求。在 index.ts 里挂在 /api/v1/doc-library 上、排在要登录的那组之前；
 * 这里只注册明确的路径，其余的落到后面那组去。
 *
 * - 传分片：靠初始化时签发的上传令牌鉴权（令牌里有上传人、文件键、大小，改不了）。
 * - 对外链接下载：靠链接里的随机令牌，按来源限流。
 */
export const docLibraryOpenRoutes = new Hono<WhEnv>();

docLibraryOpenRoutes.put(
  "/upload/part",
  guarded(async (c) => {
    const declared = c.req.header("content-length");
    const data = await putDocUploadPart(
      c.env,
      c.req.query("token"),
      c.req.query("part"),
      declared === undefined ? null : Number(declared),
      () => c.req.arrayBuffer()
    );
    return c.json({ success: true, data });
  })
);

// ─── 对外链接下载 ────────────────────────────────────────────

const shareRateLimit = createRateLimitMiddleware({
  scope: "doc-share",
  maxRequests: 30,
  windowSeconds: 60
});

/** 令牌不对、作废、过期、文件没了，都是这一句：不让人从回包里探出哪个令牌存在过。 */
const shareGone = (c: WhContext): Response =>
  c.json({ success: false, error: { message: "链接已失效" } }, 404);

/**
 * 整段 /shared/ 之后的路径当令牌（不解码）：多一截、少一截、带斜杠的都认不出来，落到「链接已失效」。
 * 文件只由令牌决定，查询参数一概不看。
 */
const serveShared = guarded(async (c) => {
  const token = c.req.path.split("/shared/")[1] ?? "";
  const file = await openDocShare(c.env, token);
  if (!file) return shareGone(c);
  const response = await serveObject(c.env, file.file_key, c.req.raw, {
    fileName: file.file_name,
    forceAttachment: true
  });
  return response.status === 404 ? shareGone(c) : response;
});

docLibraryOpenRoutes.get("/shared", shareRateLimit, serveShared);
docLibraryOpenRoutes.get("/shared/*", shareRateLimit, serveShared);
