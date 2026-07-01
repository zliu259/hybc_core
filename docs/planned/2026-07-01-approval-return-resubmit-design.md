# 设计：退回发起人 → 编辑业务单 → 重新提交（彻底方案）

- 状态：**未实现（计划）**
- 日期：2026-07-01
- 触发：`SP-20260629-0002`（付款申请被总经理退回后，小程序端无法重新发起——流程单里改不了业务单内容）
- 关联代码：`packages/api/src/services/approval/*`、`packages/api/src/routes/{payment,contract,reimbursement,approval}.ts`、`packages/miniapp/pages/{approval-detail,payment-apply,...}`
- 关联记忆/日志：`doc/开发记录.md` 2026-07-01 两条（退回状态 `returned` 修复、清空 `current_node_key`）

---

## 1. 背景

审批"退回发起人"后，业务记录被置为 `draft`，审批实例被置为 `returned`（本次 2026-07-01 修复前误置为 `pending`）。发起人应当：**编辑被退回的业务单 → 重新提交**，让审批从头再走一轮。

Web 端可用：业务详情页在 `draft` 状态解锁编辑（如 `payment/detail.vue` `unlockedStatuses:["draft"]`），改完经 `POST /:biz/:id/submit-approval` 重新提交；该接口会识别已存在的退回实例并调用 `resubmitOp` 走"同实例新一轮"，而非新建。

小程序端不可用，且后端在把 `pending` 统一为 `returned` 后出现了新的不一致。本设计给出**彻底方案**：先把后端"退回态"口径统一，再补齐小程序编辑+重提闭环。

## 2. 问题分解（两层）

### 层一：后端"退回态"口径不一致（含本次引入的回归）

`returnToInitiator` 现写入 `approval_instance.status = 'returned'`（并已回填历史 `pending`）。但多处调用点仍按旧口径硬编码 `'pending'`，需要逐一审计：

| 文件:行 | 语义 | 现状 | 影响 | 处置 |
|---|---|---|---|---|
| `routes/payment.ts:1125` | 重提"使能"：`status==='pending'\|\|'withdrawn'` 时走 `resubmitOp` | 不含 `'returned'` | **回归**：退回付款改后重提不再走 resubmit，落到重新占用 draft 分支 | 加入 `'returned'` |
| `routes/contract.ts:720` | 重提"使能"（合同 submit-approval） | 不含 `'returned'` | **回归**：退回合同重提异常 | 加入 `'returned'` |
| `routes/reimbursement.ts:2308` | 重提"拦截"：`pending\|\|in_progress` 时报"已在审批中" | 不含 `'returned'` | 需确认退回批次重提是否走对分支（此前 `pending` 会被误拦） | 审计并明确：`returned` 视为可重提 |
| `routes/contract.ts:1045` | 变更单重提"拦截"：`pending\|\|in_progress` | 同上 | 同上 | 审计 |
| `routes/payment.ts:826` | 编辑/占用锁：`approvalInProgress = pending\|\|in_progress` | `returned` 不再算"进行中" | 大概率**正确**（退回后应可编辑），但需确认无副作用 | 审计确认 |
| `routes/payment.ts:1046` | 对账相关 `pending\|\|in_progress` | 同上 | 审计 |
| `routes/contract.ts:474` | 同 826 模式 | 同上 | 审计 |
| `services/approval/engine.ts:858` | `determineAvailableActions` 重提动作 | 已含 `'returned'`（本次已修） | 正确 | — |
| `services/approval/operations.ts:600` | `resubmit` 守卫 | 已含 `'returned'`（本次已修） | 正确 | — |
| `routes/approval.ts`（三分桶） | `returned_needs_action` | 已含 `'returned'`（本次已修） | 正确 | — |

**根因模式**：退回态原本用 `pending` 表达，散落在多个业务路由里各写一份判断；本次统一为 `returned` 时只改了审批引擎内部，未回溯业务路由。这是"同一语义多处硬编码"的典型问题。

**收敛做法**：抽一个共享判定，消除散落硬编码。建议在 `services/approval/status.ts` 暴露：

```ts
// 退回发起人、待重新提交的实例状态（returned 为正式态，pending 为历史兼容态）
export const RESUBMITTABLE_STATUSES = ["returned", "pending", "withdrawn"] as const;
export const isResubmittable = (s: string) => (RESUBMITTABLE_STATUSES as readonly string[]).includes(s);
// "审批进行中/占用中"（用于编辑锁、重复提交拦截）
export const isApprovalActive = (s: string) => s === "in_progress";
```

各路由改用 `isResubmittable` / `isApprovalActive`，不再逐处硬编码字符串。

### 层二：小程序端缺"编辑被退回业务单 + 重新提交"闭环

- **不显示任何可操作项**：`pages/approval-detail/index.js:415` `inferAvailableActions` 对非 `pending/in_progress` 状态直接返回 `[]`，`returned` 实例连"重新提交/编辑"入口都没有；`actionFlags` 无 `resubmit` 概念。
- **业务申请页是"只创建"**：`payment-apply` 等仅构造新记录并 submit-approval，没有"按 id 载入被退回 draft → 编辑 → 重提"模式。
- **无从流程单跳到业务表单的路径**：审批详情不知道每种 `biz_type` 对应哪个小程序申请页。

## 3. 设计原则

1. **单一退回态**：`returned` 为唯一正式态，`pending` 仅作历史兼容读取，不再新写。
2. **单一重提路径**：业务侧 `submit-approval` 统一负责"识别退回实例 → resubmit 同实例新一轮"；审批详情"重新提交"按钮仅用于无需改业务内容的场景。
3. **小程序与 Web 口径一致**：`available_actions` 尽量由后端下发，前端不再自行按状态推断（消除 `inferAvailableActions` 的状态白名单）。
4. **可扩展的业务类型映射**：`biz_type → 小程序申请页 route` 用一处注册表维护。

## 4. 方案与备选

### 推荐：原生编辑（分阶段），后端口径先收敛

- **后端**：先做层一收敛（含回归修复），使任意 `biz_type` 的退回实例重提都走对路径。
- **小程序**：
  1. 审批详情对 `returned` + 发起人 显示"编辑并重新提交"入口；
  2. 各申请页新增 `mode=edit&bizId=..` 模式：`GET` 业务详情预填 → 编辑 → `PUT` 业务 → `POST /:biz/:id/submit-approval`（后端识别退回实例自动 resubmit）；
  3. 新增 `biz_type → route` 注册表，供审批详情跳转。
- **落地顺序**：Phase 0 后端回归/审计修复；Phase 1 付款（payment）打通闭环并作模板；Phase 2 复制到报销/库房出入库/工单等有小程序申请页的类型；Phase 3 合同/发票等无小程序申请页的类型走"引导回 Web"兜底。

### 备选 A：仅打通付款
范围最小、交付最快，但"这类问题"只解决一个类型；作为 Phase 1 的子集。

### 备选 B：小程序只引导回 Web
小程序仅补"重新提交"与退回原因展示，复杂业务编辑引导用户回 Web。工作量最小，但移动端不能彻底闭环——不满足"彻底解决"。

> 推荐"推荐方案"：后端收敛是必须项（否则各端重提都不稳），小程序按 Phase 1→2→3 渐进，Phase 3 用备选 B 兜底 Web-only 类型。

## 5. 受影响业务类型与小程序申请页

| biz_type | 退回置 draft | 小程序申请页 | Phase |
|---|---|---|---|
| payment_request | ✓ | `payment-apply` | 1 |
| reimbursement_batch | ✓ | `reimbursement` | 2 |
| stock_order | ✓ | `warehouse-stock-order` | 2 |
| warehouse_asset_work_order | ✓ | `warehouse-task`/`dispatch` | 2 |
| outbound/inbound_contract | ✓ | 无（Web 创建） | 3（引导回 Web） |
| invoice_request | ✓ | 无 | 3（引导回 Web） |

## 6. 测试

- 单测：`isResubmittable`/`isApprovalActive`；各 `submit-approval` 在 `returned` 下走 resubmit（新增用例，复刻 payment/contract 回归）。
- 集成：退回 → 编辑 draft → 重提 → 新一轮 round，`approval_instance` 仍单条、round+1。
- 小程序：付款退回→编辑→重提端到端（`MOCK_AI_ONLY` 本地）。

## 7. 风险与回滚

- 层一改动触及多财务路由，需覆盖测试并回归 Web 端提交/重提。
- 小程序编辑模式须复用既有 `PUT` 校验，避免绕过金额/附件校验。
- 每阶段独立可回滚；后端收敛用共享 helper，减少再次遗漏。

## 8. 待确认（Open Questions）

1. Phase 0 回归（`payment.ts:1125`、`contract.ts:720`）是否**立即热修**（当前生产已受影响），还是并入本计划一起做？
2. Phase 2/3 的优先级与是否需要合同/发票的移动端编辑。
3. `available_actions` 全量后端下发（移除小程序 `inferAvailableActions` 状态白名单）是否本轮一并做。
