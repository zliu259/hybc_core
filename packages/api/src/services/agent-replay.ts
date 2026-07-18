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
 * 1. 【仅服务端可派生】标记 = HMAC-SHA256(AGENT_REPLAY_SECRET, `${METHOD}:${path}:${pendingId}:${bodyHash}`)。
 *    密钥只在 Worker 环境变量里，客户端（含被入侵的 MCP 客户端）无法伪造。
 * 2. 【四向绑定】标记绑定方法、路径、pending 动作 id 与请求体哈希：既不能拿 A 动作的标记去放行
 *    B 动作，不能把「拒绝 #7」的标记挪去放行「批准 #7」（换路径）或换个动词，
 *    也不能在确认后把 body 改成别的内容（例如把 comment 换成 reject 理由、或改动金额字段）再重放。
 *    绑方法与路径是【纵深防御】：闸门是纯函数、不读库，它无从知道某个 pendingId 是否真有对应行，
 *    故「恰好是这一个动作」不能只靠调用点的正确性，必须写死在载荷里。
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

/** HTTP 方法：纯字母，故必然无冒号——载荷「首段」的唯一性靠它。 */
const METHOD_PATTERN = /^[A-Z]+$/;

/** 标记所绑定的动作。四要素齐全才谈得上「就是这一个动作」。 */
export interface ReplayMarkerParams {
  /** HTTP 方法，大小写不敏感（内部统一大写）。 */
  readonly method: string;
  /** 请求路径，须以 "/" 开头。query 会被剥离（见 normalizePath）。 */
  readonly path: string;
  readonly pendingId: string;
  /** sha256Hex(原始请求体) 的输出。 */
  readonly bodyHash: string;
}

/**
 * 路径归一化：剥掉 query 与 fragment。
 *
 * 这是【签名方与验签方必然一致】的关键。两侧的路径来源不同：
 *   签名方 = routes/agent.ts 从 request_snapshot.path 取（park 时存的 c.req.path）
 *   验签方 = middleware/auth.ts 传入的 c.req.path
 * c.req.path 永远不含 query，而快照理论上可能被写进带 query 的值（旧行、或将来的改动）。
 * 在载荷构造器里统一剥离，就把「两侧碰巧都不带 query」这个偶然，变成由构造器保证的必然。
 *
 * 注意百分号转义【不在此处】处理：Hono 的 c.req.path 已完成解码，且该解码是幂等的
 * （已实测：把 c.req.path 当作 URL 路径重新发起请求，得到的 c.req.path 与原值逐字相同）。
 * park 存的与闸门验的都是这个解码后的值，故两侧同形。反之若快照存 new URL(url).pathname
 * （不解码），两侧就会对 /appro%76al/... 分叉——见 types/agent.ts 中 RequestSnapshot.path 的说明。
 */
const normalizePath = (path: string): string => path.replace(/[?#].*$/, "");

/**
 * 构造签名载荷并断言其不变量。
 *
 * 载荷 = `${METHOD}:${path}:${pendingId}:${bodyHash}`。
 *
 * 【为什么要绑方法与路径】只绑 (pendingId, bodyHash) 时，同一枚标记在另一张审批单、
 * 另一个动词上都验得过——decideAgentRequest 是纯函数、不读库，连「这个 pendingId 有没有对应行」
 * 都不知道。于是「恰好这一个动作、至多一次」全靠确认路由那一处调用点的正确性兜着，
 * 没有任何纵深。把动作身份写进载荷，则是【构造上】的保证，不依赖调用图。
 *
 * 【无歧义性】path 允许含冒号，其余三段不含，且 bodyHash 定长：
 * 首个冒号之前唯一确定 method；末 64 字符唯一确定 bodyHash；其前一段（无冒号）唯一确定 pendingId；
 * 中间剩余部分即 path。解析确定且可逆 ⇒ 不存在两组不同入参映射到同一条载荷。
 * 若哪天放松任一段的约束（例如允许 pendingId 带冒号），这个性质立刻失效，
 * 攻击者便可把一个动作的标记挪用到另一个动作上——故下面每条断言都是安全断言，不是参数校验礼仪。
 * 同时挡掉调用方误传 undefined 造成的 "undefined:undefined" 全局碰撞。
 */
const replayPayload = ({ method, path, pendingId, bodyHash }: ReplayMarkerParams): string => {
  const upperMethod = typeof method === "string" ? method.toUpperCase() : "";
  if (!METHOD_PATTERN.test(upperMethod)) {
    throw new Error("replay marker method must be a non-empty alphabetic HTTP method");
  }
  if (typeof path !== "string" || !path.startsWith("/")) {
    throw new Error("replay marker path must be an absolute path starting with '/'");
  }
  if (typeof pendingId !== "string" || pendingId.length === 0 || pendingId.includes(":")) {
    throw new Error("replay marker pendingId must be a non-empty string without ':'");
  }
  if (typeof bodyHash !== "string" || !BODY_HASH_PATTERN.test(bodyHash)) {
    throw new Error("replay marker bodyHash must be 64 lowercase hex chars (sha256Hex output)");
  }
  return `${upperMethod}:${normalizePath(path)}:${pendingId}:${bodyHash}`;
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
  params: ReplayMarkerParams
): Promise<string> => {
  const payload = replayPayload(params);
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
  params: ReplayMarkerParams
): Promise<string> => {
  const secret = assertUsableReplaySecret(env);
  return computeMarker(secret, params);
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
  params: ReplayMarkerParams,
  marker: string
): Promise<boolean> => {
  if (!marker) {
    return false;
  }
  try {
    const secret = assertUsableReplaySecret(env);
    const expected = await computeMarker(secret, params);
    return timingSafeEqual(expected, marker);
  } catch {
    return false;
  }
};
