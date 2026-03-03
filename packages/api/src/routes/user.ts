import { Hono } from "hono";

import { authMiddleware, type AuthVariables } from "../middleware/auth";
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
  const normalizedRoles = roles.includes("finance")
    ? [...roles, "manager"]
    : roles;

  if (normalizedRoles.includes("super_admin")) {
    return baseRoutesByRole.super_admin;
  }

  return baseRoutesByRole.super_admin.map((item) => {
    if (item.path === "/dict") {
      return {
        ...item,
        children: item.children.filter(
          (child) => !child.meta.roles || child.meta.roles.some((role) => normalizedRoles.includes(role))
        )
      };
    }

    return {
      ...item,
      children: item.children.filter(
        (child) => !child.meta.roles || child.meta.roles.some((role) => normalizedRoles.includes(role))
      )
    };
  });
};

export const userRoutes = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

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

userRoutes.get("/me/bank-accounts", async (c) => {
  const auth = c.get("auth");
  const rows = await c.env.DB.prepare(
    `SELECT id,
            bank_name,
            name AS account_name,
            bank_account AS account_no,
            status
     FROM payee
     WHERE created_by_userid = ?
       AND status = 'active'
     ORDER BY id DESC
     LIMIT 20`
  )
    .bind(auth.sub)
    .all<{
      id: number;
      bank_name: string;
      account_name: string;
      account_no: string;
      status: string;
    }>();

  return c.json({
    success: true,
    data: (rows.results ?? []).map((item) => ({
      id: item.id,
      bank_name: item.bank_name,
      account_name: item.account_name,
      account_no: item.account_no,
      status: item.status
    }))
  });
});

userRoutes.post("/me/bank-accounts", async (c) => {
  const auth = c.get("auth");
  const body = (await c.req.json().catch(() => ({}))) as {
    bank_name?: string;
    account_name?: string;
    account_no?: string;
  };

  const bankName = (body.bank_name ?? "").trim();
  const accountName = (body.account_name ?? "").trim();
  const accountNo = (body.account_no ?? "").trim();
  if (!bankName || !accountName || !accountNo) {
    return c.json(
      { success: false, error: { message: "bank_name/account_name/account_no are required" } },
      400
    );
  }

  const now = new Date().toISOString();
  const result = await c.env.DB.prepare(
    `INSERT INTO payee (
      name, bank_name, bank_account, phone, type, status, created_by_userid, created_at, updated_at
    ) VALUES (?, ?, ?, '', 'other', 'active', ?, ?, ?)`
  )
    .bind(accountName, bankName, accountNo, auth.sub, now, now)
    .run();

  const row = await c.env.DB.prepare(
    `SELECT id, bank_name, name AS account_name, bank_account AS account_no, status
     FROM payee WHERE id = ?`
  )
    .bind(result.meta.last_row_id)
    .first<{
      id: number;
      bank_name: string;
      account_name: string;
      account_no: string;
      status: string;
    }>();

  return c.json({ success: true, data: row }, 201);
});

userRoutes.put("/me/bank-accounts/:id", async (c) => {
  const auth = c.get("auth");
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id) || id <= 0) {
    return c.json({ success: false, error: { message: "invalid id" } }, 400);
  }

  const body = (await c.req.json().catch(() => ({}))) as {
    bank_name?: string;
    account_name?: string;
    account_no?: string;
  };

  const bankName = body.bank_name?.trim();
  const accountName = body.account_name?.trim();
  const accountNo = body.account_no?.trim();
  if (!bankName && !accountName && !accountNo) {
    return c.json({ success: false, error: { message: "no updates provided" } }, 400);
  }

  const now = new Date().toISOString();
  const result = await c.env.DB.prepare(
    `UPDATE payee
     SET bank_name = COALESCE(?, bank_name),
         name = COALESCE(?, name),
         bank_account = COALESCE(?, bank_account),
         updated_at = ?
     WHERE id = ? AND created_by_userid = ? AND status = 'active'`
  )
    .bind(bankName ?? null, accountName ?? null, accountNo ?? null, now, id, auth.sub)
    .run();

  if ((result.meta.changes ?? 0) === 0) {
    return c.json({ success: false, error: { message: "bank account not found" } }, 404);
  }

  const row = await c.env.DB.prepare(
    `SELECT id, bank_name, name AS account_name, bank_account AS account_no, status
     FROM payee WHERE id = ?`
  )
    .bind(id)
    .first<{
      id: number;
      bank_name: string;
      account_name: string;
      account_no: string;
      status: string;
    }>();

  return c.json({ success: true, data: row });
});
