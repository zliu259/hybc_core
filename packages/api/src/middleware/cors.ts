import { cors } from "hono/cors";

export const corsMiddleware = cors({
  origin: "*",
  allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowHeaders: [
    "Content-Type",
    "Authorization",
    "X-Requested-With",
    "X-API-Key",
    "Idempotency-Key",
    // Web relay pool 回退重试附带的标记头（utils/http/index.ts）；不在列表里预检会被浏览器拒绝，回退永远失败
    "X-Relay-Fallback",
    "X-Relay-Id",
    // 分段取文件（Web 上预览大 PDF）；老一点的浏览器带 Range 的跨域请求要先预检
    "Range"
  ],
  // 页面脚本要读到这几个头才知道文件能分段取、总共多大；不暴露的话 PDF 预览会把整个文件拉下来
  exposeHeaders: ["Accept-Ranges", "Content-Range", "Content-Length", "Content-Disposition"]
});
