import { Hono } from "hono";

import { exchangeVertexHandoffCode } from "../services/vertex-handoff";
import type { Env } from "../types/env";

export const internalVertexHandoffRoutes = new Hono<{ Bindings: Env }>();

// 该端点仅供 vertex Worker 经 Cloudflare Service Binding 调用（账户内直连，不走公网）。
// Service Binding 子请求不经公网边缘，header 完全由调用方构造，不带 cf-connecting-ip；
// 经 api.hybcdg.com 公网路由进来的请求则必带该 header，且客户端无法移除或伪造
//（cf-* header 由 Cloudflare 边缘控制，仅 zone 所有者可经 Transform Rule 移除）。
// 据此拒绝一切带公网边缘特征的请求，对公网表现为 404。
// 纵深防御：即使端点被公网命中，code 也是高熵、≤5 分钟、一次性（读即删）的凭证。
internalVertexHandoffRoutes.post("/exchange", async (c) => {
  if (c.req.header("cf-connecting-ip")) {
    return c.json({ success: false, error: { message: "Not found" } }, 404);
  }

  let code = "";
  try {
    const body = (await c.req.json()) as { code?: unknown };
    if (typeof body.code === "string") {
      code = body.code;
    }
  } catch {
    // body 非 JSON：按无效 code 处理，统一走 401
  }

  const identity = code ? await exchangeVertexHandoffCode(c.env, code) : null;
  if (!identity) {
    return c.json({ success: false, error: { message: "Unauthorized" } }, 401);
  }

  // vertex 契约：成功必须 HTTP 200 + 顶层 { sub, username, roles, scopes }，失败一律非 200。
  return c.json({
    sub: identity.sub,
    username: identity.username,
    roles: identity.roles,
    scopes: identity.scopes
  });
});
