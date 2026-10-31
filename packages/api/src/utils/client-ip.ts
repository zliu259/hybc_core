import type { Env } from "../types/env";
import { timingSafeEqual } from "./timing-safe-equal";

/**
 * 可信中转（东京 bridge 的 Caddy / uvicorn relay）在转发请求时带上的头。
 * 值必须等于 Worker secret `RELAY_TRUST_TOKEN`；不带或不匹配的请求一律按直连处理。
 */
export const RELAY_AUTH_HEADER = "x-relay-auth";

/** 短于此长度的令牌视为未配置，防止占位值（如 replace-me）意外生效。 */
const MIN_TOKEN_LENGTH = 16;

type RelayTrustEnv = Pick<Env, "RELAY_TRUST_TOKEN">;

const firstHop = (value: string | null): string | undefined => {
  if (!value) return undefined;
  const hop = value.split(",")[0]?.trim();
  return hop ? hop : undefined;
};

const nonEmpty = (value: string | null): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

/**
 * 请求是否来自可信中转：env 配置了足够长的令牌，且请求头值与之常量时间相等。
 */
export const isTrustedRelay = (headers: Headers, env: RelayTrustEnv): boolean => {
  const token = env.RELAY_TRUST_TOKEN ?? "";
  if (token.length < MIN_TOKEN_LENGTH) return false;
  const presented = headers.get(RELAY_AUTH_HEADER) ?? "";
  if (!presented) return false;
  return timingSafeEqual(presented, token);
};

/**
 * 解析真实客户端 IP。
 *
 * - 可信中转：取 `X-Forwarded-For` 首跳（Cloudflare 边缘会把中转机 IP 追加在后面）；
 *   首跳缺失或为空时退回下面的直连逻辑。
 * - 直连：`cf-connecting-ip` → `x-forwarded-for` 首跳 → `x-real-ip`。
 * - 不带有效令牌的 `X-Forwarded-For` 不会被优先采信（可由客户端伪造）。
 *
 * 全部无值时返回 undefined，由调用方决定兜底（如限流用 "anonymous"）。
 */
export const resolveClientIp = (headers: Headers, env: RelayTrustEnv): string | undefined => {
  if (isTrustedRelay(headers, env)) {
    const forwarded = firstHop(headers.get("x-forwarded-for"));
    if (forwarded) return forwarded;
  }
  return (
    nonEmpty(headers.get("cf-connecting-ip")) ??
    firstHop(headers.get("x-forwarded-for")) ??
    nonEmpty(headers.get("x-real-ip"))
  );
};
