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
    "X-Relay-Id"
  ]
});
