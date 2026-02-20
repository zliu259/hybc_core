import { Hono } from "hono";

import { authMiddleware } from "../middleware/auth";
import { verifyToken } from "../services/auth";
import type { Env } from "../types/env";

const baseRoutesByRole = {
  super_admin: [
    {
      path: "/entity",
      meta: { title: "实体管理", icon: "ep:office-building", rank: 11 },
      children: [
        {
          path: "/entity/index",
          name: "EntityManagement",
          component: "entity/index",
          meta: { title: "实体管理", roles: ["super_admin", "manager"] }
        }
      ]
    },
    {
      path: "/dict",
      meta: { title: "数据字典", icon: "ep:collection-tag", rank: 12 },
      children: [
        {
          path: "/dict/index",
          name: "DictManagement",
          component: "dict/index",
          meta: { title: "数据字典", roles: ["super_admin", "manager"] }
        }
      ]
    },
    {
      path: "/project",
      meta: { title: "项目管理", icon: "ep:briefcase", rank: 13 },
      children: [
        {
          path: "/project/list",
          name: "ProjectList",
          component: "project/list",
          meta: {
            title: "项目列表",
            roles: ["super_admin", "manager", "site_manager", "operator"]
          }
        },
        {
          path: "/project/create",
          name: "ProjectCreate",
          component: "project/create",
          meta: { title: "项目立项", roles: ["super_admin", "manager", "site_manager"] }
        },
        {
          path: "/project/detail/:id",
          name: "ProjectDetail",
          component: "project/detail",
          meta: {
            title: "项目详情",
            roles: ["super_admin", "manager", "site_manager", "operator"],
            showLink: false
          }
        },
        {
          path: "/project/workspace",
          name: "ProjectWorkspaceEntry",
          component: "project/workspace-entry",
          meta: {
            title: "项目化视图",
            roles: ["super_admin", "manager", "site_manager", "operator"]
          }
        },
        {
          path: "/project/workspace/:id",
          name: "ProjectWorkspace",
          component: "project/workspace/index",
          meta: {
            title: "项目工作区",
            roles: ["super_admin", "manager", "site_manager", "operator"],
            showLink: false
          }
        }
      ]
    },
    {
      path: "/account",
      meta: { title: "账号安全", icon: "ep:lock", rank: 18 },
      children: [
        {
          path: "/account/passkey",
          name: "AccountPasskey",
          component: "account/passkey",
          meta: {
            title: "Passkey 管理",
            roles: ["super_admin", "manager", "site_manager", "operator"]
          }
        }
      ]
    }
  ]
} as const;

const getRoutesByRoles = (roles: string[]) => {
  if (roles.includes("super_admin")) {
    return baseRoutesByRole.super_admin;
  }

  return baseRoutesByRole.super_admin.map((item) => {
    if (item.path === "/dict") {
      return {
        ...item,
        children: item.children.filter(
          (child) => !child.meta.roles || child.meta.roles.some((role) => roles.includes(role))
        )
      };
    }

    return {
      ...item,
      children: item.children.filter(
        (child) => !child.meta.roles || child.meta.roles.some((role) => roles.includes(role))
      )
    };
  });
};

export const userRoutes = new Hono<{ Bindings: Env }>();

const getAuthPayload = async (c: {
  req: { header: (key: string) => string | undefined };
  env: Env;
}) => {
  const authorization = c.req.header("authorization") ?? "";
  const token = authorization.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    throw new Error("Unauthorized");
  }
  return verifyToken(c.env, token);
};

userRoutes.use("*", authMiddleware);

userRoutes.get("/me", (c) => {
  return getAuthPayload(c)
    .then((auth) => {
      return c.json({
        success: true,
        data: {
          avatar: auth.avatar,
          username: auth.username,
          nickname: auth.nickname,
          roles: auth.roles,
          permissions: auth.permissions,
          auth_method: auth.auth_method,
          wecom_verified_at: auth.wecom_verified_at
        }
      });
    })
    .catch(() => {
      return c.json(
        {
          success: false,
          error: {
            message: "Unauthorized"
          }
        },
        401
      );
    });
});

userRoutes.get("/routes", (c) => {
  return getAuthPayload(c)
    .then((auth) => {
      const routeData = getRoutesByRoles(auth.roles);
      return c.json({
        success: true,
        data: routeData
      });
    })
    .catch(() => {
      return c.json(
        {
          success: false,
          error: {
            message: "Unauthorized"
          }
        },
        401
      );
    });
  });
