/**
 * 统一从后端错误响应中提取可展示的错误信息。
 *
 * 兼容后端两种返回结构：
 * - `{ success: false, error: { message } }`（多数路由，如 receipt）
 * - `{ success: false, error: "..." }` / `{ message: "..." }`（部分路由）
 *
 * 仅当请求未拿到响应（网络/超时错误）时，才回退到 axios 自身的 `message`，
 * 以避免把无意义的 "Request failed with status code 400" 展示给用户。
 */
export interface ApiErrorLike {
  message?: unknown;
  response?: {
    data?: {
      message?: unknown;
      error?: unknown;
    };
  };
}

const firstNonEmptyString = (candidates: readonly unknown[]): string | null => {
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return null;
};

export function resolveApiErrorMessage(
  error: unknown,
  fallback: string
): string {
  const err = (error ?? {}) as ApiErrorLike;
  const data = err.response?.data;
  const nestedError = data?.error as { message?: unknown } | undefined;

  const candidates: unknown[] = [
    nestedError && typeof nestedError === "object"
      ? nestedError.message
      : undefined,
    data?.message,
    typeof data?.error === "string" ? data.error : undefined
  ];

  // 没有响应（网络中断/超时）时，axios 的 message 才有意义
  if (!err.response) {
    candidates.push(err.message);
  }

  return firstNonEmptyString(candidates) ?? fallback;
}
