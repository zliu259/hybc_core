/**
 * mcp_agent 请求的【四路裁决】—— agent 令牌能做什么，全部由本函数一处说了算。
 *
 * P1c 之前只有两种结局：命中只读白名单则放行，否则 403。P2a 引入第三种可能：
 * 少数高危写（审批 approve/reject）既不直接执行、也不直接拒绝，而是 park 成待确认动作，
 * 推企业微信卡片给授权人本人；本人确认后由服务端带 HMAC 重放标记把原请求重放一遍，
 * 那次重放走的是第四条路。于是有四个结局：
 *
 *   allow   —— 命中只读白名单（含 P2a 的 pending 状态轮询端点），照常执行。
 *   replay  —— 高危写 + 【密码学上有效】的重放标记：这是本人确认后服务端自己发起的重放，放行执行。
 *   park    —— 高危写且开关打开：不执行，落库为 pending_agent_action，等本人在微信里确认。
 *   forbid  —— 其余一切。
 *
 * 【裁决顺序】只读白名单 → 高危表未命中即 forbid → 有效标记 → 开关关闭则 forbid → park。
 *
 * 四条不可动摇的安全性质（改动本文件前请逐条对照）：
 *
 * 1.【deny-by-default】未被明确放行或 park 的一律 forbid。注意 matchHighRisk 返回 null
 *    本身【不是】一个安全判断——它只说明「这不是我们准备走人在环的那类写」；真正兜底的是最后
 *    落到 forbid 的那条 fallthrough。两层只有【合在一起】才安全：若哪天有人把「未命中高危表」
 *    改成放行（想当然地认为「不高危 = 安全」），整个只读承诺立刻崩塌——POST /payment 会被直接执行。
 *
 * 2.【绝不因请求头存在而分支】REPLAY_HEADER 出现与否没有任何含义，客户端想加就能加。
 *    本函数只接收已解析出的 { pendingId, marker }，且唯一的判据是 verifyReplayMarker 返回 true。
 *    任何形如「带了头就当作重放」「body 里 is_replay=true」的写法都是把钥匙交给攻击者。
 *
 * 3.【校验失败降级为 park，绝不降级为 allow】伪造标记、篡改 body、张冠李戴的 pendingId、
 *    空标记——全都走到 park：攻击者能做到的最好结果，是让一张卡片弹到员工微信上等他本人拒绝，
 *    而不是让一次审批被悄悄执行。这也是为什么标记校验不能写成「校验通过则 park，否则 allow」
 *    这种反向分支，以及为什么 verifyReplayMarker 承诺永不抛异常（异常一律 false）——
 *    若它会抛，本函数在异常路径上的结局就变成未定义，fail-open 只需一个没接住的 throw。
 *
 * 4.【开关只管 park，不管 replay】故先验标记、后查开关。开关是「要不要开始放量高危写」的闸门，
 *    而重放对应的是【员工已经本人确认过】的动作。若把开关放在标记之前，运维在动作在途时
 *    关掉开关，这次已确认的写就被静默丢弃：员工点了「同意」，系统却什么都没发生，
 *    且没有任何地方会报错。已确认的动作必须能落地。
 *
 * 本函数是纯决策：不读库、不写库、不发请求、不产生任何副作用，只依赖 KV 上的开关。
 * park 的落库、审计、卡片推送以及 403 响应的构造，都由调用它的中间件负责（见 middleware/auth.ts）。
 */

import { isAllowedAgentRead } from "./agent-readonly";
import { matchHighRisk, isHighRiskEnabled, type HighRiskRule } from "../services/agent-high-risk";
import { sha256Hex, verifyReplayMarker } from "../services/agent-replay";
import type { Env } from "../types/env";

/**
 * 承载重放标记所属 pending 动作 id 的请求头名。
 * 与 REPLAY_HEADER（承载标记本身）配对使用；两者都只是【传输载体】，
 * 其存在与取值不构成任何信任——信任只来自 HMAC 校验通过。
 */
export const REPLAY_PENDING_HEADER = "x-hybc-agent-pending";

/** 四路裁决结果。判别式联合：调用方必须显式处理每一种结局，不能漏。 */
export type AgentDecision =
  | { readonly kind: "allow" }
  | { readonly kind: "replay"; readonly pendingId: string }
  | { readonly kind: "park"; readonly rule: HighRiskRule }
  | { readonly kind: "forbid" };

/**
 * 裁决一个 mcp_agent 令牌发起的请求。
 *
 * @param env     Cloudflare 绑定（KV 读开关、AGENT_REPLAY_SECRET 验标记）。
 * @param method  HTTP 方法（大小写不敏感）。
 * @param path    请求路径（完整 /api/v1/... 或相对形态、带不带 query 均可）。
 * @param body    原始请求体文本。参与标记校验，必须与签名时的字节完全一致。
 * @param replay  从请求头解析出的重放信息；没带头时传 null。
 *                传了也【不代表】任何权限——见性质 2、3。
 */
export const decideAgentRequest = async (
  env: Env,
  method: string,
  path: string,
  body: string,
  replay: { pendingId: string; marker: string } | null
): Promise<AgentDecision> => {
  // 1. 只读白名单：agent 令牌的常规通道。
  if (isAllowedAgentRead(method, path)) {
    return { kind: "allow" };
  }

  // 2. 不在高危表里的写（POST /payment、approval/:id/transfer 等）：直接拒。
  //    绝不因为「带了重放标记」就对未登记的路径网开一面——标记只是重放【已 park 动作】的凭据，
  //    不是通用的写权限令牌；否则一次泄漏的标记就成了万能钥匙。
  const rule = matchHighRisk(method, path);
  if (!rule) {
    return { kind: "forbid" };
  }

  // 3. 先验标记（性质 4：早于开关）。校验失败不中断，继续往下走到 park（性质 3）。
  if (replay && replay.marker) {
    const bodyHash = await sha256Hex(body);
    // 标记绑定「方法 + 路径 + 动作 id + body 哈希」四要素：此处传入的 path 必须与签名方所用的
    // 完全同形。签名方取自 request_snapshot.path，而那正是 park 时存下的 c.req.path；
    // 本函数的 path 也来自 c.req.path（见 middleware/auth.ts）。两侧同源，故必然一致。
    const valid = await verifyReplayMarker(
      env,
      { method, path, pendingId: replay.pendingId, bodyHash },
      replay.marker
    );
    if (valid) {
      return { kind: "replay", pendingId: replay.pendingId };
    }
  }

  // 4. 开关关闭时高危写连 park 都不做，直接拒（部署了也能先不放量）。
  if (!(await isHighRiskEnabled(env))) {
    return { kind: "forbid" };
  }

  // 5. 高危写 + 开关打开 + 无有效标记 → 落为待本人确认。
  return { kind: "park", rule };
};
