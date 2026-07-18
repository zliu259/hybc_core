/**
 * 高危写「重放标记」（replay marker）签发与校验 —— P2 延迟执行 + 企业微信本人确认链路的信任凭据。
 *
 * 背景：mcp_agent 令牌的高危写（审批 approve/reject）不会当场执行，而是被闸门拦下、落库为
 * pending_agent_action；员工在企业微信里本人确认后，服务端把【当初那个请求】原样重放一遍，
 * 让它走完整的中间件栈与业务 handler —— 与人类点「同意」时执行的是同一条代码路径，
 * 不另写一份「确认后直接改库」的旁路逻辑（旁路 = 权限校验/审批引擎状态机的第二实现，必然走样）。
 *
 * 于是产生一个问题：重放出来的请求带的仍是 mcp_agent 令牌，会被同一个闸门再次拦下（死循环）。
 * 本模块就是解法：服务端在重放时附一个 HMAC 标记，闸门见到【有效】标记才放行。
 *
 * 三条不可动摇的安全性质：
 * 1. 【仅服务端可派生】标记 = HMAC-SHA256(AGENT_REPLAY_SECRET, `${pendingId}:${bodyHash}`)。
 *    密钥只在 Worker 环境变量里，客户端（含被入侵的 MCP 客户端）无法伪造。
 * 2. 【双向绑定】标记同时绑定 pending 动作 id 与请求体哈希：既不能拿 A 动作的标记去放行 B 动作，
 *    也不能在确认后把 body 改成别的内容（例如把 comment 换成 reject 理由、或改动金额字段）再重放。
 * 3. 【绝不信任客户端自称】闸门只认「HMAC 校验通过」这一件事。任何形如
 *    `x-hybc-agent-replay: true` / `?replay=1` / body 里的 is_replay 字段都必须视为普通攻击载荷，
 *    不得因其存在就跳过闸门。校验失败 = 当作没有标记处理（照常拦截/落库），不得 fail-open。
 *
 * 另：AGENT_REPLAY_SECRET 在 wrangler.toml 里目前是占位串 "REPLACE_WITH_PROD_SECRET"。
 * 若上线前无人替换，生产将用一个公开可知的字符串签名标记 —— 等同于人人可伪造重放放行。
 * 故 isUsableReplaySecret / assertUsableReplaySecret 做 fail-closed 兜底：密钥不可用时
 * 宁可整条高危重放链路不可用（报错），也绝不降级为「用弱密钥照常签」。
 *
 * 运行时为 Cloudflare Workers：一律使用 Web Crypto（crypto.subtle），不引入 Node 的 crypto。
 */

import type { Env } from "../types/env";

/** 承载重放标记的请求头名。闸门与确认端点必须用同一个常量，避免大小写/拼写漂移。 */
export const REPLAY_HEADER = "x-hybc-agent-replay";

/** wrangler.toml 里随仓库分发的占位密钥字面量 —— 一旦等于它即视为「未配置」。 */
const PLACEHOLDER_SECRET = "REPLACE_WITH_PROD_SECRET";

/** 非 local 环境下密钥的最小长度。低于此长度视为人为敷衍的弱密钥，直接判不可用。 */
const MIN_SECRET_LENGTH = 16;

export const REPLAY_SECRET_MISCONFIGURED_MESSAGE =
  "AGENT_REPLAY_SECRET is not configured (or still the placeholder) — 高危重放已禁用";

const encoder = new TextEncoder();

const toHex = (buffer: ArrayBuffer): string =>
  Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

const toBase64 = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
};

/** 请求体的 SHA-256 十六进制摘要。空体也有确定摘要（64 字符），无需调用方特判。 */
export const sha256Hex = async (text: string): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(text));
  return toHex(digest);
};

/**
 * 签名载荷。用 ":" 连接；pendingId 由服务端生成（不含 ":"），bodyHash 为定长 hex，
 * 故不存在「(a, b) 与 (a:b, "") 撞同一载荷」的分隔符歧义。
 */
const replayPayload = (pendingId: string, bodyHash: string): string => `${pendingId}:${bodyHash}`;

const importHmacKey = async (secret: string): Promise<CryptoKey> =>
  crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

/** 派生重放标记（base64 的 HMAC-SHA256）。仅服务端在确认通过后调用。 */
export const signReplayMarker = async (
  secret: string,
  pendingId: string,
  bodyHash: string
): Promise<string> => {
  const key = await importHmacKey(secret);
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(replayPayload(pendingId, bodyHash))
  );
  return toBase64(signature);
};

/**
 * 常数时间字符串比较：不因首个不同字符提前返回，避免按字节爆破标记的计时侧信道。
 * 长度差异先并入累加器，再对两串按 max 长度逐位异或（越界位取哨兵值），
 * 使耗时只与较长串长度相关，而与「前多少位相同」无关。
 */
const timingSafeEqual = (a: string, b: string): boolean => {
  const length = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < length; i += 1) {
    // 越界位用 -1，保证与任何合法 charCode 都不相等，且不提前退出循环。
    const left = i < a.length ? a.charCodeAt(i) : -1;
    const right = i < b.length ? b.charCodeAt(i) : -1;
    diff |= left ^ right;
  }
  return diff === 0;
};

/**
 * 校验重放标记。
 * 任何异常（空密钥导致 importKey 失败等）与任何格式非法的 marker 一律返回 false，绝不抛出、绝不 fail-open：
 * 闸门只需要一个「放行 / 不放行」的布尔，异常必须落在「不放行」一侧。
 */
export const verifyReplayMarker = async (
  secret: string,
  pendingId: string,
  bodyHash: string,
  marker: string
): Promise<boolean> => {
  if (!secret || !marker) {
    return false;
  }
  try {
    const expected = await signReplayMarker(secret, pendingId, bodyHash);
    return timingSafeEqual(expected, marker);
  } catch {
    return false;
  }
};

/**
 * 密钥是否可用于签名（fail-closed 判据）：
 * - 空 / undefined：无从签名，任何环境都不可用；
 * - 等于仓库里分发的占位串：任何环境都不可用（公开可知 = 可伪造）；
 * - 非 local 环境且短于 16 字符：视为弱密钥，不可用。
 * local 环境允许短的开发密钥，方便本地联调，但仍不允许空串与占位串。
 */
export const isUsableReplaySecret = (
  secret: string | undefined,
  appEnv: string | undefined
): boolean => {
  if (!secret) {
    return false;
  }
  if (secret === PLACEHOLDER_SECRET) {
    return false;
  }
  if (appEnv !== "local" && secret.length < MIN_SECRET_LENGTH) {
    return false;
  }
  return true;
};

/**
 * 取出可用的重放密钥，否则抛错 —— 调用方（确认端点、闸门）不应继续走高危重放流程。
 * 抛错而非返回空串，是为了让「密钥没配」在部署后第一次高危写时就明确炸出来，而不是静默放行或静默失败。
 */
export const assertUsableReplaySecret = (env: Env): string => {
  if (!isUsableReplaySecret(env.AGENT_REPLAY_SECRET, env.APP_ENV)) {
    throw new Error(REPLAY_SECRET_MISCONFIGURED_MESSAGE);
  }
  return env.AGENT_REPLAY_SECRET;
};
