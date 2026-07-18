/**
 * 智能体令牌只读闸门（auth_method === "mcp_agent"）—— deny-by-default 读端点白名单。
 *
 * 背景：P1c 同意承诺员工授权设备获得「只读」访问（authorize.vue / setup 页）。但在凭证层，
 * agent 令牌经 resolveAgentByToken 解析后仍带有授权人角色的完整权限（含写权限）。
 *
 * 为什么不能只按 HTTP 方法拦截：本仓库存在「以 GET 触发写」的端点（poll-and-sync 模式），例如
 * GET /reimbursement/:id/ocr-status 会 UPDATE 行并可能把状态推进为 submitted；bidding-dedup、
 * receipt、warehouse、warehouse-work-order、system/ops-status-center 也有此类 GET handler。
 * 单纯放行 GET 会让授权人有对应角色的 agent 令牌通过 GET 触发真实写入，「只读」承诺形同虚设。
 *
 * 因此改为 deny-by-default 白名单：mcp_agent 请求必须精确命中下方 {GET, 路径} 白名单之一，
 * 其余一律 403 —— 同时拦下写方法、未列出的读、以及 mutating-GET。
 *
 * 白名单 = @hybc/mcp 客户端「只读工具」实际调用的全部端点，别无其它（P1c 核验：
 * packages/mcp/src/tools/{projects,payments,contracts,approvals,warehouse}.ts 均 client.get(...)；
 * cli.ts `serve` 仅注册这 13 个工具；`login` 走免鉴权设备流；`whoami`/`logout` 为本地操作。
 * 客户端启动/连接时不会用令牌发任何额外 GET，例如没有 /user/me、/user/routes、/agent/grants）。
 * 数字 id 由各工具 inputSchema 的 z.number().int() 保证，故 :id 用 \d+ 收紧，并避免
 * /approval/:id 误伤 /approval/pending。
 *
 * P2 的写工具（付款、审批推进等）将走独立的【高危闸门】：延迟执行 + 企业微信本人确认，
 * 绝不通过扩充此读白名单来放行。新增只读工具时，必须同步在此登记对应端点。
 *
 * 使用位置：authMiddleware 解析出 mcp_agent 身份后立即调用（见 middleware/auth.ts），
 * 是所有 agent 令牌请求的唯一收敛点，全局不可绕过。人类 JWT 会话（wecom_oauth / passkey）不经此闸门。
 */

export const AGENT_READONLY_MESSAGE = "智能体令牌为只读，禁止写操作";

export interface AgentReadRule {
  /** 仅允许 GET —— 白名单里没有任何写方法条目。 */
  readonly method: "GET";
  /** 归一化后（剥离 /api/v1 前缀）的路径正则，必须锚定首尾。 */
  readonly pattern: RegExp;
  /** 对应的 @hybc/mcp 工具名，便于审计与追溯。 */
  readonly tool: string;
}

const ALLOWED_AGENT_READS: readonly AgentReadRule[] = [
  { method: "GET", pattern: /^\/project$/, tool: "search_projects" },
  { method: "GET", pattern: /^\/project\/\d+$/, tool: "get_project" },
  {
    method: "GET",
    pattern: /^\/project\/\d+\/financial-summary$/,
    tool: "get_project_financial_summary"
  },
  { method: "GET", pattern: /^\/payment$/, tool: "list_payments" },
  { method: "GET", pattern: /^\/payment\/\d+$/, tool: "get_payment" },
  { method: "GET", pattern: /^\/contract$/, tool: "list_contracts" },
  { method: "GET", pattern: /^\/contract\/\d+$/, tool: "get_contract" },
  { method: "GET", pattern: /^\/approval$/, tool: "list_my_approvals" },
  { method: "GET", pattern: /^\/approval\/pending$/, tool: "list_pending_approvals" },
  { method: "GET", pattern: /^\/approval\/\d+$/, tool: "get_approval" },
  { method: "GET", pattern: /^\/warehouse\/inventory$/, tool: "warehouse_inventory" },
  { method: "GET", pattern: /^\/warehouse\/inventory\/alert$/, tool: "warehouse_low_stock" },
  { method: "GET", pattern: /^\/warehouse\/stock-order$/, tool: "list_stock_orders" },
  // P2a：MCP 客户端轮询「待本人确认动作」的状态（pending / confirmed / rejected / expired）。
  // 这里只管形状：必须是真正的 UUID 分段结构（8-4-4-4-12），不是「36 个十六进制或连字符」——
  // 后者会放过 36 个连字符、36 个 a 之类明显非 id 的串。收紧到分段形态是免费的纵深防御，
  // 同时挡掉 /agent/pending/../../secret 之类的越权取数尝试。
  // 归属校验（该 pending 动作确属本次授权 grant）始终在路由 handler 内做，白名单不负责、
  // 也无从判断身份——收紧形状不减轻 handler 的责任。
  {
    method: "GET",
    pattern: /^\/agent\/pending\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    tool: "check_pending"
  }
];

/**
 * 归一化请求路径：剥离可选的 /api/v1 前缀。
 * 生产环境经 index.ts app.route("/api/v1/xxx", ...) 挂载后，authMiddleware 处看到完整路径
 * （如 /api/v1/project/123，已由 vitest 实测确认）；单元测试直接调用子路由时看到相对路径
 * （如 /project/123）。剥前缀后两种形态都能对同一组 prefix-free 正则匹配。
 * 只在字符串首部、且其后为 "/" 或结尾时剥离，避免误伤 /api/v10 之类。
 * 注：c.req.path / URL pathname 已由 URL 解析消解 "../"，此处无需再防路径穿越。
 */
const stripApiPrefix = (path: string): string => path.replace(/^\/api\/v1(?=\/|$)/, "");

/**
 * 去掉查询串与 fragment，只保留 pathname。
 * 生产环境 c.req.path 本就不含 query（已实测），但此函数不应依赖调用方恰好传入去 query 的路径：
 * 显式剥离，锚定正则才不会因 "?pageSize=20" 之类把合法 list 工具调用误判为不匹配（→ 误 403）。
 * 安全性不受影响——含 query 的非白名单路径去 query 后仍不在白名单，照样 deny。
 */
const pathnameOnly = (path: string): string => path.replace(/[?#].*$/, "");

/**
 * mcp_agent 请求是否命中只读白名单。deny-by-default：未命中即视为禁止。
 * @param method HTTP 方法（大小写不敏感）
 * @param path   请求路径（完整 /api/v1/...、相对形态、带/不带 query 均可）
 */
export const isAllowedAgentRead = (method: string, path: string): boolean => {
  const upper = method.toUpperCase();
  const normalized = stripApiPrefix(pathnameOnly(path));
  return ALLOWED_AGENT_READS.some(
    (rule) => rule.method === upper && rule.pattern.test(normalized)
  );
};

/** mcp_agent 令牌命中白名单之外（写方法 / 未列出的读 / mutating-GET）时的 403 响应。 */
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
