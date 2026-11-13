/**
 * 库房的权限：谁是库管、谁能报废、谁能改设置。后端每个写接口单独校验，前端只负责隐藏按钮。
 * 库管和资料管理员名单在 warehouse_member 表；智能体令牌没有任何库房写能力。
 */
import type { MiddlewareHandler } from "hono";

import type { AuthVariables } from "../../middleware/auth";
import type { AuthTokenPayload, UserRole } from "../../types/auth";
import type { Env } from "../../types/env";
import type { WarehouseMemberRole } from "../../types/wh";

export const ALL_ROLES: UserRole[] = [
  "super_admin",
  "finance",
  "manager",
  "site_manager",
  "operator"
];

export interface WarehouseCapabilities {
  is_keeper: boolean;
  is_doc_admin: boolean;
  can_scrap: boolean;
  can_unscrap: boolean;
  can_manage_settings: boolean;
  can_create_kit: boolean;
}

const NO_CAPABILITIES: WarehouseCapabilities = {
  is_keeper: false,
  is_doc_admin: false,
  can_scrap: false,
  can_unscrap: false,
  can_manage_settings: false,
  can_create_kit: false
};

export const getWarehouseCapabilities = async (
  env: Env,
  auth: AuthTokenPayload
): Promise<WarehouseCapabilities> => {
  if (auth.auth_method === "mcp_agent") return NO_CAPABILITIES;
  const rows = await env.DB.prepare("SELECT role FROM warehouse_member WHERE userid = ?")
    .bind(auth.sub)
    .all<{ role: WarehouseMemberRole }>();
  const memberships = new Set((rows.results ?? []).map((row) => row.role));
  const isSuperAdmin = auth.roles.includes("super_admin");
  const isManager = auth.roles.includes("manager");
  const isKeeper = isSuperAdmin || memberships.has("keeper");
  return {
    is_keeper: isKeeper,
    is_doc_admin: isKeeper || memberships.has("doc_admin"),
    can_scrap: isSuperAdmin || isManager,
    can_unscrap: isSuperAdmin,
    can_manage_settings: isSuperAdmin || isManager,
    can_create_kit: isKeeper || isManager || auth.roles.includes("site_manager")
  };
};

/** 库管名单里的人（超管不在名单里就不算），按 userid 排。通知的「全体库管」指他们。 */
export const listKeeperUserids = async (env: Env): Promise<string[]> => {
  const rows = await env.DB.prepare(
    "SELECT userid FROM warehouse_member WHERE role = 'keeper' ORDER BY userid ASC"
  ).all<{ userid: string }>();
  return (rows.results ?? []).map((row) => row.userid);
};

type WhMiddleware = MiddlewareHandler<{ Bindings: Env; Variables: AuthVariables }>;

const forbidden = (message: string) => ({ success: false, error: { message } });

const requireCapability =
  (pick: (caps: WarehouseCapabilities) => boolean, message: string): WhMiddleware =>
  async (c, next) => {
    const caps = await getWarehouseCapabilities(c.env, c.get("auth"));
    if (!pick(caps)) return c.json(forbidden(message), 403);
    await next();
  };

export const requireHuman: WhMiddleware = async (c, next) => {
  if (c.get("auth").auth_method === "mcp_agent") {
    return c.json(forbidden("智能体不能执行库房写操作"), 403);
  }
  await next();
};

export const requireKeeper = requireCapability((caps) => caps.is_keeper, "只有库管可以操作");
/** 建、改、提交、作废配套清单。现场负责人限自己的项目，在 service 里再判断。 */
export const requireKitCreator = requireCapability(
  (caps) => caps.can_create_kit,
  "没有建配套清单的权限"
);
/** 上传、替换、改、删资料，生成和作废对外链接。 */
export const requireDocAdmin = requireCapability(
  (caps) => caps.is_doc_admin,
  "只有库管或资料管理员可以操作"
);
/** 看微盘镜像的状态：管资料的人和能改设置的人。 */
export const requireMirrorViewer = requireCapability(
  (caps) => caps.is_doc_admin || caps.can_manage_settings,
  "只有库管、资料管理员、经理或超级管理员可以查看"
);
export const requireSettingsManager = requireCapability(
  (caps) => caps.can_manage_settings,
  "只有经理或超级管理员可以操作"
);
export const requireScrap = requireCapability(
  (caps) => caps.can_scrap,
  "只有经理或超级管理员可以报废设备"
);
export const requireUnscrap = requireCapability(
  (caps) => caps.can_unscrap,
  "只有超级管理员可以撤销报废"
);
