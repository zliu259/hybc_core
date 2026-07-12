import { Hono } from "hono";

import { authMiddleware, type AuthVariables } from "../middleware/auth";
import { requireRoles } from "../middleware/rbac";
import {
  buildVertexLaunchUrl,
  issueVertexHandoff,
  issueVertexHandoffCode,
  verifyVertexHandoff,
  VERTEX_HANDOFF_CODE_TTL_SECONDS,
  type VertexHandoffPayload
} from "../services/vertex-handoff";
import type { Env } from "../types/env";

type HandoffRequestBody = {
  vertexBaseUrl?: string;
  hybcApiBaseUrl?: string;
  entryPath?: string;
};

type ProjectSummaryRow = {
  id: number;
  project_code: string;
  project_name: string;
  manager_userid: string | null;
  status: string;
  location_text: string | null;
  project_kind: string | null;
  project_start_at: string | null;
  start_date: string | null;
  end_date: string | null;
  updated_at: string;
};

export const vertexRoutes = new Hono<{
  Bindings: Env;
  Variables: AuthVariables;
}>();

const DEFAULT_VERTEX_BASE_URL = "https://vertex.hybcdg.com";
const DEFAULT_VERTEX_ENTRY_PATH = "/";
// v2 云端门户：换码在 vertex 侧经 Service Binding 完成，浏览器只带不透明 code 跳转。
const DEFAULT_VERTEX_PORTAL_BASE_URL = "https://vertex-beta.hybcdg.com";
const VERTEX_PORTAL_HANDOFF_PATH = "/portal/handoff";

const parseJsonBody = async <T>(c: { req: { json: () => Promise<unknown> } }): Promise<T> => {
  try {
    return (await c.req.json()) as T;
  } catch {
    return {} as T;
  }
};

const normalizeBaseUrl = (value: string | undefined, fallback: string): string => {
  const candidate = value?.trim() || fallback;
  if (candidate.length > 300) {
    throw new Error("URL is too long");
  }

  const url = new URL(candidate);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Only HTTP(S) URL is allowed");
  }
  url.hash = "";
  url.search = "";
  return url.toString().replace(/\/$/, "");
};

const normalizeEntryPath = (value: string | undefined): string => {
  const candidate = value?.trim() || DEFAULT_VERTEX_ENTRY_PATH;
  if (candidate.length > 160) {
    throw new Error("Entry path is too long");
  }
  if (!candidate.startsWith("/")) {
    return `/${candidate}`;
  }
  return candidate;
};

const getBearerToken = (authorization: string | undefined): string => {
  const token = (authorization ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    throw new Error("Missing bearer token");
  }
  return token;
};

const publicProfile = (payload: VertexHandoffPayload) => ({
  sub: payload.sub,
  username: payload.username,
  nickname: payload.nickname,
  avatar: payload.avatar,
  roles: payload.roles,
  permissions: payload.permissions,
  scopes: payload.scopes,
  hybc_api_base_url: payload.hybc_api_base_url,
  vertex_base_url: payload.vertex_base_url,
  entry_path: payload.entry_path,
  expires_at: new Date(payload.exp * 1000).toISOString()
});

const verifyHandoffFromRequest = async (c: {
  env: Env;
  req: { header: (key: string) => string | undefined };
}): Promise<VertexHandoffPayload> => {
  const token = getBearerToken(c.req.header("authorization"));
  return verifyVertexHandoff(c.env, token);
};

vertexRoutes.post(
  "/handoff",
  authMiddleware,
  requireRoles(["super_admin", "manager", "site_manager"]),
  async (c) => {
    const body = await parseJsonBody<HandoffRequestBody>(c);
    const requestOrigin = new URL(c.req.url).origin;

    try {
      const vertexBaseUrl = normalizeBaseUrl(body.vertexBaseUrl, DEFAULT_VERTEX_BASE_URL);
      const hybcApiBaseUrl = normalizeBaseUrl(body.hybcApiBaseUrl, requestOrigin);
      const entryPath = normalizeEntryPath(body.entryPath);
      const auth = c.get("auth");
      const handoff = await issueVertexHandoff(c.env, {
        auth,
        hybcApiBaseUrl,
        vertexBaseUrl,
        entryPath
      });
      const launchUrl = buildVertexLaunchUrl({
        vertexBaseUrl,
        entryPath,
        token: handoff.token,
        hybcApiBaseUrl,
        expiresAt: handoff.expiresAt
      });

      return c.json({
        success: true,
        data: {
          launch_url: launchUrl,
          launch_token: handoff.token,
          token_type: "Bearer",
          expires_at: handoff.expiresAt,
          expires_in_seconds: Math.max(handoff.payload.exp - Math.floor(Date.now() / 1000), 0),
          hybc_api_base_url: hybcApiBaseUrl,
          vertex_base_url: vertexBaseUrl,
          entry_path: entryPath,
          user: publicProfile(handoff.payload),
          scopes: handoff.payload.scopes
        }
      });
    } catch (error) {
      return c.json(
        {
          success: false,
          error: {
            message: error instanceof Error ? error.message : "Invalid vertex handoff request"
          }
        },
        400
      );
    }
  }
);

// v2 门户发码：不签 JWT、不出示任何 HYBC 密钥，只发一次性不透明 code（KV、≤5 分钟）。
// 旧的 POST /handoff（JWT）为 v0.1 门户遗留路径，保留并存，待确认无消费方后再移除。
vertexRoutes.post(
  "/handoff/code",
  authMiddleware,
  requireRoles(["super_admin", "manager", "site_manager"]),
  async (c) => {
    const body = await parseJsonBody<{ vertexBaseUrl?: string }>(c);

    try {
      const vertexBaseUrl = normalizeBaseUrl(body.vertexBaseUrl, DEFAULT_VERTEX_PORTAL_BASE_URL);
      const auth = c.get("auth");
      const issued = await issueVertexHandoffCode(c.env, auth);
      const redirectUrl = new URL(`${vertexBaseUrl}${VERTEX_PORTAL_HANDOFF_PATH}`);
      redirectUrl.searchParams.set("code", issued.code);

      return c.json({
        success: true,
        data: {
          code: issued.code,
          redirect_url: redirectUrl.toString(),
          expires_at: issued.expiresAt,
          expires_in_seconds: VERTEX_HANDOFF_CODE_TTL_SECONDS,
          vertex_base_url: vertexBaseUrl,
          scopes: issued.identity.scopes
        }
      });
    } catch (error) {
      return c.json(
        {
          success: false,
          error: {
            message: error instanceof Error ? error.message : "Invalid vertex handoff request"
          }
        },
        400
      );
    }
  }
);

vertexRoutes.post("/handoff/verify", async (c) => {
  const body = await parseJsonBody<{ token?: string }>(c);

  try {
    const token = body.token?.trim() || getBearerToken(c.req.header("authorization"));
    const payload = await verifyVertexHandoff(c.env, token);
    return c.json({
      success: true,
      data: publicProfile(payload)
    });
  } catch {
    return c.json({ success: false, error: { message: "Unauthorized" } }, 401);
  }
});

vertexRoutes.get("/me", async (c) => {
  try {
    const payload = await verifyHandoffFromRequest(c);
    return c.json({
      success: true,
      data: publicProfile(payload)
    });
  } catch {
    return c.json({ success: false, error: { message: "Unauthorized" } }, 401);
  }
});

vertexRoutes.get("/projects", async (c) => {
  let payload: VertexHandoffPayload;
  try {
    payload = await verifyHandoffFromRequest(c);
  } catch {
    return c.json({ success: false, error: { message: "Unauthorized" } }, 401);
  }

  if (!payload.scopes.includes("project:read")) {
    return c.json({ success: false, error: { message: "Forbidden" } }, 403);
  }

  const keyword = c.req.query("keyword")?.trim();
  const status = c.req.query("status")?.trim();
  const page = Math.max(Number(c.req.query("page") ?? "1"), 1);
  const pageSize = Math.min(Math.max(Number(c.req.query("pageSize") ?? "20"), 1), 100);
  const offset = (page - 1) * pageSize;
  const params: Array<string | number> = [];
  let whereSql = " WHERE 1=1";

  if (!payload.roles.includes("super_admin")) {
    whereSql += " AND manager_userid = ?";
    params.push(payload.sub);
  }
  if (keyword) {
    whereSql +=
      " AND (project_name LIKE ? OR project_code LIKE ? OR IFNULL(location_text, '') LIKE ?)";
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }
  if (status) {
    whereSql += " AND status = ?";
    params.push(status);
  }

  const listSql = `SELECT id, project_code, project_name, manager_userid, status,
                          location_text, project_kind, project_start_at,
                          start_date, end_date, updated_at
                     FROM project
                    ${whereSql}
                    ORDER BY CASE status
                               WHEN 'active' THEN 1
                               WHEN 'preparing' THEN 2
                               WHEN 'planning' THEN 3
                               WHEN 'completing' THEN 4
                               WHEN 'archived' THEN 5
                               ELSE 9
                             END,
                             COALESCE(project_start_at, start_date, updated_at) DESC,
                             id DESC
                    LIMIT ? OFFSET ?`;
  const countSql = `SELECT COUNT(*) AS total FROM project ${whereSql}`;

  const [rows, count] = await Promise.all([
    c.env.DB.prepare(listSql)
      .bind(...params, pageSize, offset)
      .all<ProjectSummaryRow>(),
    c.env.DB.prepare(countSql)
      .bind(...params)
      .first<{ total: number }>()
  ]);

  return c.json({
    success: true,
    data: rows.results ?? [],
    pagination: {
      page,
      pageSize,
      total: count?.total ?? 0
    }
  });
});
