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
 * 【密钥守卫是强制的，不是建议】签名/校验一律只接收 Env，内部强制 assertUsableReplaySecret，
 * 模块不导出任何「传裸密钥」的入口 —— 因为守卫若只是旁边摆着的一个可选函数，
 * 闸门最自然的写法 verifyReplayMarker(c.env.AGENT_REPLAY_SECRET, ...) 就会绕过它，
 * 于是 wrangler.toml 里公开的占位密钥变成一把人人可配的钥匙：读过本仓库的人即可伪造标记，
 * 让 agent 令牌自审自批、彻底跳过人在环。守卫必须无法被跳过，而不是提醒你别跳过。
 * 密钥不可用时：signReplayMarker 抛错（签不出就要大声失败），
 * verifyReplayMarker 返回 false（放行判据一律 fail closed）。
 *
 * 运行时为 Cloudflare Workers：一律使用 Web Crypto（crypto.subtle），不引入 Node 的 crypto。
 */

import type { Env } from "../types/env";

/** 承载重放标记的请求头名。闸门与确认端点必须用同一个常量，避免大小写/拼写漂移。 */
export const REPLAY_HEADER = "x-hybc-agent-replay";

/**
 * 占位密钥特征词（大小写不敏感、子串匹配）。
 * 不用精确等值：`wrangler secret put` 复制粘贴极易带上尾部换行或前导空格，
 * 大小写变体与随手加的后缀同理 —— 精确匹配会被这些微小漂移绕过，等于没设防。
 */
const PLACEHOLDER_MARKERS = ["REPLACE_WITH", "PLACEHOLDER", "CHANGEME"] as const;

/** 非 local 环境下密钥的最小长度。这是审批动作的唯一闸门，门槛按密钥而非口令来定。 */
const MIN_SECRET_LENGTH = 32;

/** 非 local 环境下密钥要求的最少不同字符数，挡掉 "aaaa..." 之类凑长度的弱密钥。 */
const MIN_DISTINCT_CHARS = 8;

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

/** sha256Hex 的输出形态：64 位小写十六进制。载荷不变量据此断言。 */
const BODY_HASH_PATTERN = /^[0-9a-f]{64}$/;

/**
 * 构造签名载荷并断言其不变量。
 *
 * `${pendingId}:${bodyHash}` 只有在 bodyHash 定长（64 hex）时才无歧义 —— 否则
 * sign("x", "y:z") 与 sign("x:y", "z") 会撞上同一条载荷，攻击者可借此把一个动作的标记
 * 挪用到另一个动作上。这里把「定长」从口头约定变成运行时断言。
 * 同时挡掉调用方误传 undefined 造成的 "undefined:undefined" 全局碰撞。
 */
const replayPayload = (pendingId: string, bodyHash: string): string => {
  if (typeof pendingId !== "string" || pendingId.length === 0 || pendingId.includes(":")) {
    throw new Error("replay marker pendingId must be a non-empty string without ':'");
  }
  if (typeof bodyHash !== "string" || !BODY_HASH_PATTERN.test(bodyHash)) {
    throw new Error("replay marker bodyHash must be 64 lowercase hex chars (sha256Hex output)");
  }
  return `${pendingId}:${bodyHash}`;
};

const importHmacKey = async (secret: string): Promise<CryptoKey> =>
  crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

const computeMarker = async (
  secret: string,
  pendingId: string,
  bodyHash: string
): Promise<string> => {
  const payload = replayPayload(pendingId, bodyHash);
  const key = await importHmacKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return toBase64(signature);
};

/**
 * 密钥是否可用于签名（fail-closed 判据）。先 trim 归一化，再逐条判：
 * - 空 / 仅空白 / undefined：无从签名，任何环境都不可用；
 * - 含 REPLACE_WITH / PLACEHOLDER / CHANGEME（大小写不敏感）：占位串，任何环境都不可用；
 * - 非 local 环境：还需 ≥32 字符且 ≥8 种不同字符，挡掉弱密钥与凑长度的重复串。
 * local 环境放宽长度与熵要求（方便本地联调），但空串与占位串照样拒绝。
 * APP_ENV 缺失时按非 local（严格）处理 —— 未知环境不得享受本地宽松档。
 */
export const isUsableReplaySecret = (
  secret: string | undefined,
  appEnv: string | undefined
): boolean => {
  if (typeof secret !== "string") {
    return false;
  }
  const normalized = secret.trim();
  if (normalized.length === 0) {
    return false;
  }
  const upper = normalized.toUpperCase();
  if (PLACEHOLDER_MARKERS.some((marker) => upper.includes(marker))) {
    return false;
  }
  if (appEnv === "local") {
    return true;
  }
  if (normalized.length < MIN_SECRET_LENGTH) {
    return false;
  }
  return new Set(normalized).size >= MIN_DISTINCT_CHARS;
};

/**
 * 取出可用的重放密钥，否则抛错 —— 调用方不应继续走高危重放流程。
 * 抛错而非返回空串，是为了让「密钥没配」在部署后第一次高危写时就明确炸出来，而不是静默放行或静默失败。
 * 注意：返回原始值（未 trim），保证签名字节与配置完全一致；trim 只用于可用性判定。
 */
export const assertUsableReplaySecret = (env: Env): string => {
  if (!isUsableReplaySecret(env.AGENT_REPLAY_SECRET, env.APP_ENV)) {
    throw new Error(REPLAY_SECRET_MISCONFIGURED_MESSAGE);
  }
  return env.AGENT_REPLAY_SECRET;
};

/**
 * 派生重放标记（base64 的 HMAC-SHA256）。仅服务端在本人确认通过后调用。
 * 只接收 Env：密钥守卫在内部强制执行，模块不提供传裸密钥的旁路。
 * 密钥不可用或载荷不合法时抛错 —— 签不出标记属于配置/调用错误，必须显式炸出来，
 * 不能返回空串之类被下游误当成「一个标记」继续用。
 */
export const signReplayMarker = async (
  env: Env,
  pendingId: string,
  bodyHash: string
): Promise<string> => {
  const secret = assertUsableReplaySecret(env);
  return computeMarker(secret, pendingId, bodyHash);
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
 * 校验重放标记。只接收 Env，密钥守卫同样在内部强制执行。
 * 任何异常（密钥不可用/占位、载荷不合法、marker 格式非法等）一律返回 false，绝不抛出、绝不 fail-open：
 * 闸门只需要一个「放行 / 不放行」的布尔，异常必须落在「不放行」一侧。
 */
export const verifyReplayMarker = async (
  env: Env,
  pendingId: string,
  bodyHash: string,
  marker: string
): Promise<boolean> => {
  if (!marker) {
    return false;
  }
  try {
    const secret = assertUsableReplaySecret(env);
    const expected = await computeMarker(secret, pendingId, bodyHash);
    return timingSafeEqual(expected, marker);
  } catch {
    return false;
  }
};
