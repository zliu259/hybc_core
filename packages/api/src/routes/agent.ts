import { Hono } from "hono";

import { authMiddleware, type AuthVariables } from "../middleware/auth";
import { createRateLimitMiddleware } from "../middleware/rate-limit";
import {
  approveDeviceByUserCode,
  pollDeviceToken,
  provisionBootstrapGrant,
  redeemBootstrap,
  startDeviceAuthorization
} from "../services/agent-device";
import { getGrantById, listGrantsForUser, revokeGrant } from "../services/agent-grant";
import type { UserRole } from "../types/auth";
import type { Env } from "../types/env";

const ok = <T>(data: T) => ({ success: true as const, data });
const fail = (message: string) => ({ success: false as const, error: { message } });

export const agentRoutes = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

const deviceRateLimit = createRateLimitMiddleware({
  scope: "agent-device",
  maxRequests: 30,
  windowSeconds: 60
});

// --- 设备流（免鉴权，CLI 发起）---
agentRoutes.post("/device/code", deviceRateLimit, async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    device_name?: string;
    agent_type?: string;
    client_info?: string;
  };
  const webBaseUrl = c.env.AGENT_WEB_BASE_URL;
  if (!webBaseUrl) return c.json(fail("AGENT_WEB_BASE_URL not configured"), 500);
  const result = await startDeviceAuthorization(c.env.KV, {
    webBaseUrl,
    deviceName: body.device_name,
    agentType: body.agent_type,
    clientInfo: body.client_info
  });
  return c.json(ok(result));
});

agentRoutes.post("/device/token", deviceRateLimit, async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { device_code?: string };
  if (!body.device_code) return c.json(fail("device_code required"), 400);
  const result = await pollDeviceToken(c.env.KV, c.env.DB, body.device_code);
  return c.json(ok(result));
});

agentRoutes.post("/setup/redeem", deviceRateLimit, async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { boot_code?: string };
  if (!body.boot_code) return c.json(fail("boot_code required"), 400);
  const redeemed = await redeemBootstrap(c.env.KV, body.boot_code);
  if (!redeemed) return c.json(fail("boot_code invalid or already used"), 410);
  return c.json(ok(redeemed));
});

// --- install.sh（免鉴权，数据类）---
agentRoutes.get("/install.sh", (c) => {
  const apiBase = (c.env.AGENT_API_BASE_URL ?? "https://api.hybcdg.com").replace(/\/$/, "");
  const boot = c.req.query("boot") ?? "";
  const script = [
    "#!/bin/sh",
    "set -e",
    `HYBC_API="${apiBase}"`,
    `HYBC_BOOT="${boot}"`,
    'echo "恒越百川 MCP 安装器占位（P1b 完善）：将在此拉取 bundle、写配置、兑换令牌。"',
    'echo "API=$HYBC_API BOOT=$HYBC_BOOT"'
  ].join("\n");
  return c.text(`${script}\n`, 200, { "content-type": "text/x-shellscript; charset=utf-8" });
});

// --- 以下需 JWT（登录员工本人）---
agentRoutes.use("/setup/provision", authMiddleware);
agentRoutes.use("/device/approve", authMiddleware);
agentRoutes.use("/grants", authMiddleware);
agentRoutes.use("/grants/*", authMiddleware);

const primaryRole = (c: { get: (k: "auth") => AuthVariables["auth"] }): UserRole =>
  (c.get("auth").roles[0] ?? "operator") as UserRole;

agentRoutes.post("/setup/provision", async (c) => {
  const auth = c.get("auth");
  const body = (await c.req.json().catch(() => ({}))) as {
    device_name?: string;
    agent_type?: string;
    client_info?: string;
  };
  const prov = await provisionBootstrapGrant(c.env.KV, c.env.DB, {
    wecomUserid: auth.sub,
    role: primaryRole(c),
    deviceName: body.device_name,
    agentType: body.agent_type,
    clientInfo: body.client_info
  });
  const apiBase = (c.env.AGENT_API_BASE_URL ?? "https://api.hybcdg.com").replace(/\/$/, "");
  return c.json(
    ok({
      ...prov,
      install_sh: `curl -fsSL "${apiBase}/api/v1/agent/install.sh?boot=${prov.boot_code}" | sh`,
      install_ps1: `irm "${apiBase}/api/v1/agent/install.ps1?boot=${prov.boot_code}" | iex`
    })
  );
});

agentRoutes.post("/device/approve", deviceRateLimit, async (c) => {
  const auth = c.get("auth");
  const body = (await c.req.json().catch(() => ({}))) as { user_code?: string };
  if (!body.user_code) return c.json(fail("user_code required"), 400);
  try {
    await approveDeviceByUserCode(c.env.KV, c.env.DB, body.user_code, {
      wecomUserid: auth.sub,
      role: primaryRole(c)
    });
  } catch (error) {
    return c.json(fail(error instanceof Error ? error.message : "approve failed"), 400);
  }
  return c.json(ok({ approved: true }));
});

agentRoutes.get("/grants", async (c) => {
  const auth = c.get("auth");
  const grants = await listGrantsForUser(c.env.DB, auth.sub);
  return c.json(ok(grants));
});

agentRoutes.post("/grants/:id/revoke", async (c) => {
  const auth = c.get("auth");
  const id = c.req.param("id");
  const grant = await getGrantById(c.env.DB, id);
  if (!grant || grant.wecom_userid !== auth.sub) {
    return c.json(fail("Grant not found"), 404);
  }
  await revokeGrant(c.env.DB, id, auth.sub);
  return c.json(ok({ revoked: true }));
});
