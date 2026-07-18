/**
 * 整包 Hono app 的 fetch 引用注册表——为高危动作确认后的「服务端重放」打破循环依赖。
 *
 * 背景（P2a）：智能体的高危写（审批 approve/reject）先 park 到 D1，员工在企微确认后由服务端重放
 * 原请求。重放必须走【整包中间件栈】（cors → logger → auth → rbac → 业务 handler），
 * 这样写入才与人类同一条代码路径，不会绕过任何鉴权、校验或审计。
 *
 * 为什么需要这层间接：index.ts 静态 import routes/agent.ts 来挂载路由，因此 routes/agent.ts
 * 不能反过来 import index.ts（循环依赖）；index.ts 也只有 `export default { fetch: app.fetch, ... }`，
 * 没有具名导出的 app 可供引用。于是由 index.ts 在模块求值时把 app.fetch 注册进来，
 * routes/agent.ts 在【请求时】才读取——注册早于任何请求，取值时必定已就绪。
 *
 * 测试可用 setAppFetcher 注入假 fetcher（并在 beforeEach 里 resetAppFetcher 复位），
 * 无需拉起整个 app。
 */

import type { Env } from "../types/env";

export type AppFetcher = (request: Request, env: Env, ctx?: ExecutionContext) => Promise<Response>;

let appFetcher: AppFetcher | null = null;

/** 注册整包 fetch；后注册的覆盖先注册的（模块热重载/测试注入时即为此语义）。 */
export const setAppFetcher = (fetcher: AppFetcher): void => {
  appFetcher = fetcher;
};

/** 清空注册（仅测试使用，保证用例之间互不串扰）。 */
export const resetAppFetcher = (): void => {
  appFetcher = null;
};

/**
 * 取整包 fetch。未注册即抛错而不是静默降级——重放若绕开中间件栈会变成无鉴权写入，
 * 宁可让确认端点显式失败。
 */
export const getAppFetcher = (): AppFetcher => {
  if (!appFetcher) {
    throw new Error("app fetcher not registered");
  }
  return appFetcher;
};
