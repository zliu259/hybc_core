# MCP 智能体接入 — P2：高危写操作延迟执行 + 微信确认（人在环）设计

> 状态：设计已评审通过（brainstorming 三节逐节获批 + feature flag 采纳）。下一步 writing-plans。
> 上游设计：`docs/superpowers/specs/2026-07-16-mcp-agent-access-design.md` §8（本文件细化并对齐 P1c 落地后的新事实）。

## 1. 目标与范围

**目标**：让员工的 AI 智能体能"发起"高危写操作，但真正落库前必须经员工**本人微信确认**；agent 发起的写与人工操作在效果上**逐字节一致**（同一代码路径）。

**首批范围（极窄验证闭环，owner 定 A）**：仅开**审批批准/拒绝**两个写端点：
- `POST /api/v1/approval/:id/approve`（body `{ comment? }`）
- `POST /api/v1/approval/:id/reject`（body `{ comment? }`）

付款提交、报销打款、合同金额变更等留 **P3** 扩表。选审批的理由：语义天然是"人在环"、单号/标题易在卡片展示、不新建资金单据、可回滚性好，最适合把闭环打扎实。

**不在本期**：付款/报销/合同写工具、admin 管理 UI 完善（P3）；解除令牌发放冻结与取消 `/agent` 菜单 `showLink:false`（留 P2 冒烟通过后单独一步，不在本 spec 翻）。

## 2. 关键决策（brainstorming 已定）

| # | 决策 | 选择 |
|---|---|---|
| Q1 | 首批写面 | **仅审批 approve/reject**（窄验证，P3 再扩） |
| Q2 | 确认后如何执行 | **服务端全栈重放**：`app.fetch()` 重建原请求走完整中间件栈+handler+审批引擎，附服务端 HMAC 重放标记放行高危闸门 → 单一代码路径、零分叉 |
| Q3 | 谁能确认 | **confirm_token 定"哪一笔" + WeCom 身份定"谁"**：确认页要求登录且 `当前 wecom_userid == pending.wecom_userid`；卡片按钮指向确认页（展示全貌）再显式确认，非卡片内一键 |
| 附 | 上线安全垫 | **KV feature flag `agent:highrisk:enabled`**（默认关，冒烟通过后翻开）gate 整个高危写路径 |

## 3. 端到端流程（以 agent 请求批准审批单为例）

```
1. MCP 写工具 hybc_approve_task(id, comment) → POST /api/v1/approval/:id/approve （带 agent 令牌）
2. authMiddleware 解析出 mcp_agent 身份 → 进入 agent 请求裁决（唯一收敛点）
3. 裁决：只读白名单未命中(是写) → 命中高危写表 → 无重放标记 → 【park】
   · feature flag `agent:highrisk:enabled` 关 → 直接 403「高危写未开放」（安全垫）
   · flag 开 → 落 agent_pending_action(存整段请求快照) + 生成 summary（审批单号/标题/发起人）
     + 一次性 confirm_token(存 hash) → 推微信 template_card 给授权人本人
   → 返回 MCP 202 { pending_action_id, status:"awaiting_confirmation", poll_after:3 }
4. MCP 工具收到 202 → 不自作主张 → 提示用户"已发确认到你微信，请查看" → 有界轮询 pending
5. 员工微信收到卡片（标题/单号/发起人/agent 请求批准还是拒绝）→ 点「查看并确认」
   → web.hybcdg.com/#/agent/confirm?token=XXX （未登录先 OAuth，P1c redirect 贯通无缝回来）
   → 确认页展示全貌 + 校验[当前登录者 == 授权人] → 点「确认」/「拒绝」
6. POST /agent/pending/:id/confirm → pending→confirmed → 【服务端全栈重放】：
   用 request_snapshot 重建 Request + 附 HMAC 重放标记 → executing → app.fetch()
   → 高危闸门认标记放行 → approveOp(...) 正常执行 → 存 result_snapshot → done
7. MCP 轮询 GET /agent/pending/:id → done → 拿回与网页一致的响应 → 告诉用户"已批准"
8. 拒绝 → rejected；10 分钟未确认 → expired；两种 MCP 都如实透传
```

**关键不变量**：
- agent 永远只能"发起"；落库那一下永远是人在微信点的。
- 重放走完整中间件栈 + `approveOp`，RBAC/审批引擎/事件/审计与人工审批**同一条代码路径**。
- 重放仍过 authMiddleware：令牌若在 park 与 confirm 之间被吊销 → 重放 401 不执行（fail-safe）。

## 4. 数据模型

### 迁移 `0059_agent_pending_action.sql`

`agent_pending_action`（对齐上游 §4）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | TEXT PK | uuid |
| `grant_id` | TEXT NOT NULL | FK → agent_grant |
| `wecom_userid` | TEXT NOT NULL | 冗余，便于查询/推送/身份校验 |
| `action_kind` | TEXT NOT NULL | `approval.approve` / `approval.reject` |
| `request_snapshot` | TEXT(JSON) NOT NULL | `{ method, path, headers:{authorization,content-type}, body }`（body 原文字符串） |
| `risk_reason` | TEXT | 命中的高危规则文案 |
| `summary` | TEXT NOT NULL | 人读摘要（审批单号/标题/发起人/批准或拒绝） |
| `status` | TEXT NOT NULL | `pending`/`confirmed`/`executing`/`done`/`failed`/`rejected`/`expired` |
| `result_snapshot` | TEXT(JSON) | 执行后回传给 MCP 的 `{ status, body }` |
| `confirm_token_hash` | TEXT NOT NULL | 卡片链接内一次性令牌的 SHA-256 |
| `created_at` | TEXT NOT NULL | ISO |
| `expires_at` | TEXT NOT NULL | ≈ 创建 + 10 分钟 |
| `confirmed_at` / `executed_at` | TEXT | |

索引：`idx_agent_pending_wecom_userid_status`、`idx_agent_pending_grant`、`idx_agent_pending_confirm_token_hash`。

软删除不涉及（短生命周期记录；过期由 `expires_at` + 状态判定，不物理清理，交由后续归档）。

### KV
- feature flag：`agent:highrisk:enabled` → `"1"`/`"0"`（缺省视为关）。
- confirm_token 反查用 `confirm_token_hash` 走 D1 索引，不另存 KV（保证吊销/状态一致）。

### env（`types/env.ts` + wrangler）
- `AGENT_REPLAY_SECRET: string` — **专用**重放签名密钥，不复用 JWT_SECRET（缩小泄露爆炸半径）。配置对齐 [[wrangler-prod-env-app-env]]：wrangler.toml **顶层 [vars] + production section 两处一致** + 本地 `.dev.vars` 覆盖。

## 5. 后端架构

### 5.1 两道闸门共处（authMiddleware 的 mcp_agent 收敛点）

演进为"agent 请求裁决"，deny-by-default 不变，四类出口：

```
mcp_agent 请求 →
  命中【只读白名单】(13 个 GET + 新增 GET /agent/pending/:id) → 放行
  否则命中【高危写表】(approve/reject):
      带有效重放标记                     → 放行（确认后的重放）
      无标记 且 flag 开                   → 【park】落 pending + 推微信 → 202
      无标记 且 flag 关                   → 403「高危写未开放」
  否则                                   → 403（写、未列读、mutating-GET 一律挡）
```

- `GET /agent/pending/:id` 加进只读白名单，但**归属校验**：mcp_agent 仅能读 `grant_id == 本 grant` 的 pending（供工具轮询）。
- 高危写表 `services/agent-high-risk.ts`：声明式 `{ method, pattern:RegExp, actionKind, riskReason }`，首批仅 `POST /approval/\d+/approve`、`/reject`；集中维护 + 单测覆盖；与只读白名单同一收敛点，不可绕过。

### 5.2 重放引擎与不可伪造标记（`services/agent-replay.ts`）

- park 时存 `request_snapshot`（method / path / 必要 headers 含原 Authorization / body 原文）。
- confirm 后 executor：状态抢占 `executing` → 用快照重建 `Request` → 附头
  `x-hybc-agent-replay: base64(HMAC-SHA256(AGENT_REPLAY_SECRET, ${pending_id}:${sha256(body)}))`
  → `app.fetch(req, env, ctx)`。
- 高危闸门验标记：用 `AGENT_REPLAY_SECRET` 重算 HMAC 比对（常数时间比较）+ 该 pending 必须处于 `executing` 态。**标记只来自服务端派生，绝不取自客户端可控输入**；外部客户端无密钥无法伪造；标记绑定 `pending_id + sha256(body)`，换一笔/改内容即失效。
- 实现注意（body 消费陷阱）：闸门要对 body 算 sha256 验签，但读 body 不能把它从下游 handler 手里"吃掉"。Hono 里对 `c.req.raw.clone()` 读取字节做验签，原始 `c.req` 仍完整交给 `approveOp`；plan 须以测试锁定"重放后 handler 收到的 body 与快照一致"。
- 重放请求仍过 authMiddleware（吊销即 401 fail-safe），只是高危闸门因标记而放行、不再 park。

### 5.3 状态机与幂等（`services/agent-pending.ts`，对齐 [[d1-runintransaction-no-rollback]]）

生产 D1 无事务回滚 → **闸门前置 + 乐观锁 + 条件 UPDATE 单赢家**：

- **park**：`INSERT`（新 uuid，天然唯一）。
- **confirm**：`UPDATE ... SET status='confirmed',confirmed_at=? WHERE id=? AND status='pending' AND expires_at>?` → rows-affected=0 即已确认/过期/拒绝，幂等返回当前态，**绝不二次执行**。
- **execute（重放前抢占）**：`UPDATE ... SET status='executing' WHERE id=? AND status='confirmed'` → 抢到(=1)的才 `app.fetch`；成功 `SET status='done',result_snapshot=?,executed_at=?`，抛错 `SET status='failed',result_snapshot=?`。并发确认/重试下**至多执行一次**。
- **reject**：`UPDATE ... SET status='rejected' WHERE id=? AND status='pending'`。
- **expire**：读时判 `expires_at<=now && status IN('pending','confirmed')` → 视为 `expired`（惰性，不强制回写；MCP/页面据此展示）。

### 5.4 确认端点（`routes/agent.ts`）

| 方法 路径 | 鉴权 | 用途 |
|---|---|---|
| `POST /agent/pending/:id/confirm` | JWT+human，且 `auth.sub == pending.wecom_userid` | 确认→触发重放 |
| `POST /agent/pending/:id/reject` | 同上 | 拒绝 |
| `GET /agent/pending/:id` | agent 令牌（归属校验）**或** JWT+human（本人） | 状态/结果；MCP 轮询 + 确认页加载详情 |

- confirm/reject 用 `requireHumanSession` + 身份匹配；非本人 → 403。
- confirm_token（来自卡片链接 query）用于确认页首次拉取该 pending（按 `confirm_token_hash` 查），但**执行授权以 WeCom 身份匹配为准**，token 仅定位"哪一笔"。

### 5.5 微信卡片（`services/agent-confirm-push.ts`）

复用 `wecom-message-push` / `wecom-approval-push` 的 `template_card` 构造：标题「智能体操作确认」+ 摘要（审批单号/标题/发起人/agent 请求批准还是拒绝）+ 按钮「查看并确认」→ `https://web.hybcdg.com/#/agent/confirm?token=XXX`，发给授权人本人 `wecom_userid`。推送走 `ctx.waitUntil`，不阻塞 202 返回。

## 6. 前端（packages/web）

- `views/agent/confirm.vue`（`/agent/confirm?token=`，路由 `showLink:false`）：卡片跳入 → 未登录先 OAuth（P1c redirect 贯通）→ 用 token 拉 pending 详情 → 展示全貌 → 校验身份匹配 → 「确认」/「拒绝」；非本人明确提示无权。
- `router/modules/agent.ts`：加 `/agent/confirm` 子路由（隐藏菜单）。
- `api/agent.ts`：加 `getPendingAction(id)`、`confirmPending(id)`、`rejectPending(id)` 三个包装。

## 7. MCP 客户端（packages/mcp）

- 写工具 `hybc_approve_task(id, comment?)`、`hybc_reject_task(id, comment?)` → POST approve/reject。
- 收到 `202 awaiting_confirmation`：**提示用户去微信确认，绝不替用户确认**，随后**有界轮询**（约 90s，间隔 `poll_after`）`GET /agent/pending/:id`；未达终态则返回"仍待确认，可用 `hybc_check_pending(id)` 稍后再查"。
- 新增只读工具 `hybc_check_pending(id)` → GET pending（已在只读白名单）。
- 更新 `instructions` / `SKILL.md`：遇 `awaiting_confirmation` 必须提示用户去微信确认；亮出单号；不得替用户自动确认。

## 8. 文件结构

**迁移**：`packages/api/migrations/0059_agent_pending_action.sql`

**api 新增**：
- `src/services/agent-pending.ts`（状态机+乐观锁+park/confirm/reject/execute）
- `src/services/agent-high-risk.ts`（高危匹配表+matcher）
- `src/services/agent-replay.ts`（HMAC 签/验+请求重建+app.fetch 重放）
- `src/services/agent-confirm-push.ts`（微信卡片）
- 各配套 `*.test.ts`

**api 改**：
- `src/middleware/agent-readonly.ts` → 三/四路裁决（或抽出 `agent-write-gate.ts` 与只读表并列，收敛点统一调用）；只读白名单加 `GET /agent/pending/:id`（归属校验）
- `src/routes/agent.ts`（pending 三端点 + park 接线 + feature flag gate）
- `src/types/env.ts`（`AGENT_REPLAY_SECRET`）+ `wrangler.toml`（顶层+prod 两 section）+ `.dev.vars`

**web**：`views/agent/confirm.vue` + `router/modules/agent.ts`（加路由）+ `api/agent.ts`（三包装）

**mcp**：审批写工具 + `hybc_check_pending` + server 注册 + `instructions`/`SKILL.md`

**文档**：`doc/UI设计文档.md` §10（确认页/卡片/高危流）、`doc/开发记录.md`

## 9. 测试策略（≥80%，复用现有 `*.test.ts` 模式）

**单元**：高危匹配表命中/不命中；HMAC 签名不可伪造（错密钥/改 body/换 pending_id 均验不过）；状态机乐观锁单赢家（并发 confirm/execute 至多一次）；过期判定；confirm 身份匹配；feature flag 开关。

**集成**（路由级，走真实中间件栈）：
- flag 关：agent 令牌 approve → 403「未开放」。
- flag 开：agent approve → 202 + 落 pending + confirm_token 有值。
- 非本人 confirm → 403；本人 confirm → 重放 → **效果 == 人工 approveOp**（断言审批状态推进与直接调 approve 一致）。
- reject → rejected；过期 → expired；重放时令牌已吊销 → 401 不执行。
- 重复 confirm 幂等（第二次不二次执行）。
- 重放标记不可伪造：外部带自造 `x-hybc-agent-replay` 头直接打 approve → 仍 park/403，不放行。
- GET pending 归属校验：他人 grant 的 agent 令牌读不到。

**MCP 工具**：202 → 轮询 → done 透传；`hybc_check_pending` 读状态。

## 10. 安全考量（延续上游 §11）

- `confirm_token`：≥32 字节随机、仅存 SHA-256、一次性、10 分钟 TTL；卡片链接外泄也无法被他人确认（身份匹配兜底）。
- 重放标记：服务端 `AGENT_REPLAY_SECRET` 派生，绑定 pending_id+body，常数时间比较；绝不取自客户端。
- 高危路径受 feature flag gate，默认关；冒烟通过前生产不放量。
- 三段全审计：发起(park)、确认(谁/何时)、执行(结果/失败)——`writeAuditLog`，`detail={ via:"mcp_agent", grant_id, pending_id, action_kind }`。
- 确认卡片与确认页必须清晰展示：发起设备/身份、审批单号/标题/发起人、agent 请求的动作、有效期。

## 11. 上线与回滚

- 迁移 `0059` 先于依赖代码 apply 到远程 D1。
- 部署后 flag 保持关；真机冒烟（owner，需 WeCom + 有效 agent 令牌）：agent 发起 approve → 收到微信卡片 → 确认页本人确认 → 审批真的推进、MCP 拿回 done。
- 冒烟通过 → 翻开 `agent:highrisk:enabled` → 观察。
- 回滚：翻关 flag 即停写路径（读工具与人工操作不受影响）；无需回滚代码。
- **解冻令牌发放 + 取消 `/agent` 菜单 `showLink:false`** 作为 P2 之后的独立运营决策，不在本期自动执行。

## 12. 开放问题 / 待评审确认

1. 有界轮询窗口（90s）与 `poll_after`（3s）是否合适？（可实现时微调）
2. `GET /agent/pending/:id` 对 agent 令牌返回的字段粒度：是否需要脱敏 request_snapshot（含原 Authorization）——**必须**：该端点返回给 agent/页面时绝不回显 `headers.authorization` 与 confirm_token（仅回 status/summary/result_snapshot 等）。已在设计内约束，实现须落测试。
3. 首批只审批：approve/reject 的 `comment` 是否要在卡片/确认页展示给确认人？建议展示（透明）。
