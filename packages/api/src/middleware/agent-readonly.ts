/**
 * 智能体令牌只读闸门（auth_method === "mcp_agent"）。
 *
 * P1c 同意承诺：员工授权设备获得「只读」访问（见 authorize.vue / setup 页）。但在凭证层，
 * agent 令牌经 resolveAgentByToken 解析后仍带有「授权人角色的完整权限」（含写权限，
 * 见 services/agent-grant.ts 与 defaultPermissionsByRole）。若不在 API 层拦截，
 * mcp_agent 令牌即可调用写端点（创建付款、推进审批、自助撤销授权等），使「只读」承诺失真。
 *
 * 本模块把「只读」承诺在 API 层落地：按 HTTP 方法拦截。@hybc/mcp 随包发布的 13 个只读工具
 * 全部只发 GET（P1c 核验：packages/mcp/src/tools/{projects,payments,contracts,approvals,warehouse}.ts
 * 均调用 client.get(...)，api-client 虽有 post() 但无工具使用），因此按方法拦截即覆盖全部合法读取，
 * 无需端点白名单：放行 GET/HEAD/OPTIONS（安全/幂等方法），其余（POST/PUT/PATCH/DELETE 等）一律 403。
 *
 * 使用位置：authMiddleware 解析出 mcp_agent 身份后立即调用（见 middleware/auth.ts），
 * 是所有 agent 令牌的唯一收敛点，无法绕过。人类 JWT 会话（wecom_oauth / passkey）不经此闸门。
 */

export const AGENT_READONLY_MESSAGE = "智能体令牌为只读，禁止写操作";

const READ_ONLY_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** 是否为只读（安全/幂等）HTTP 方法。大小写不敏感。 */
export const isReadOnlyMethod = (method: string): boolean =>
  READ_ONLY_METHODS.has(method.toUpperCase());

/** mcp_agent 令牌发起写操作时的 403 响应（与 authMiddleware 的 401 信封同构）。 */
export const agentReadonlyForbidden = (): Response =>
  new Response(
    JSON.stringify({
      success: false,
      error: {
        message: AGENT_READONLY_MESSAGE
      }
    }),
    {
      status: 403,
      headers: {
        "content-type": "application/json"
      }
    }
  );
