import { Hono } from "hono";

import { authMiddleware, type AuthVariables } from "../middleware/auth";
import { runWedriveProbe } from "../services/wedrive-probe";
import type { Env } from "../types/env";

/**
 * 微盘接口探测，只给超级管理员本人在网页上调。会真实调用企微微盘接口，
 * 建一个临时空间并在结束时解散，见 services/wedrive-probe.ts。
 */
export const adminWedriveProbeRoutes = new Hono<{
  Bindings: Env;
  Variables: AuthVariables;
}>();

adminWedriveProbeRoutes.use("*", authMiddleware);

const MAX_SPACE_ID_LENGTH = 200;

adminWedriveProbeRoutes.post("/probe", async (c) => {
  const auth = c.get("auth");
  if (!auth.roles.includes("super_admin") || auth.auth_method === "mcp_agent") {
    return c.json({ success: false, error: { message: "只有超级管理员可以执行" } }, 403);
  }

  const body = (await c.req.json().catch(() => ({}))) as { foreign_spaceid?: unknown };
  const foreign = typeof body.foreign_spaceid === "string" ? body.foreign_spaceid.trim() : "";
  if (foreign.length > MAX_SPACE_ID_LENGTH) {
    return c.json({ success: false, error: { message: "空间 ID 太长" } }, 400);
  }

  const report = await runWedriveProbe(c.env, foreign ? { foreign_spaceid: foreign } : {});
  return c.json({ success: true, data: report });
});
