/**
 * 主入口请求失败后是否该尝试 relay pool 里的候选入口。
 *
 * 触发条件（二选一）：
 * - 没有响应的网络类错误（连不上、超时、连接中断）；
 * - 主入口返回 502/503/504 —— 这是中转层（api-relay 的 Caddy）转发失败的信号，
 *   响应体尚未被业务消费，读请求重放是安全的。
 *
 * 业务 4xx/500 不触发：那是 Worker 已经处理过的结果，换入口重发只会重复。
 * 写请求是否允许重放由 relay-pool 的 Idempotency-Key / supportsWriteFallback 判定，不在这里。
 */
const NETWORK_ERROR_CODES: ReadonlySet<string> = new Set([
  "ECONNABORTED",
  "ERR_NETWORK",
  "ETIMEDOUT",
  "ERR_CONNECTION_ABORTED"
]);

const GATEWAY_FAILURE_STATUSES: ReadonlySet<number> = new Set([502, 503, 504]);

export interface FallbackErrorLike {
  response?: { status?: number } | null;
  code?: string | null;
}

export const shouldFallbackToRelay = (error: FallbackErrorLike): boolean => {
  if (error.response) {
    return GATEWAY_FAILURE_STATUSES.has(Number(error.response.status));
  }
  return NETWORK_ERROR_CODES.has(String(error.code ?? ""));
};
