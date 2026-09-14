# AI 关卡拦截转人工兜底 — 设计文档

日期：2026-09-13
状态：已批准（owner 2026-09-13 逐节拍板）
背景：SP-20260913-0007 被 AI 关卡退回后，超管在「AI关卡任务」页放行无效（实例已 returned，引擎静默返回），
随后作废付款、留下 returned 僵尸实例，小程序重提报「只有草稿可提交」。当日已修：作废连带收口
returned/withdrawn 实例、手动放行限审批中实例、小程序收起已作废单据的重提入口（提交 f727be7）。
本设计解决根问题：AI 拦截后没有人工兜底的正规出口。

## 问题

08-14 分级拦截把 AI 自主拦截的后果定为「退回发起人改单重提」。它假设拦截总是数据错误，但实际存在
AI 误判或业务上本就允许的情况（如附件对象与收款方名义不一致但经核实无误）。此时：

1. 发起人改不动数据，只能反复重提，AI 反复拦截。
2. 超管的 manual_override 只在实例仍 in_progress 时有意义；AI 拦截即刻 returned，覆写窗口为零。
3. 没有任何人被通知「AI 处理不了，需要人工裁决」，超管只能靠翻列表发现。

## 决策（owner 拍板）

- AI 判定拦截时**不再自动退回**，流程停在关卡节点，转给**系统级配置的一位兜底审核人**。
- 审核人以**普通审批任务**处理：放行 / 退回发起人 / 驳回，与人工节点动作集一致。
- 只在 AI 判定「拦截」时转人工；「放行但需人工关注」（warn）维持现状，由后续审批人看。
- 适用所有带 AI 关卡的业务线（白名单裁决规则不变）。
- 未配置兜底审核人时退化为现状（自动退回）并告警。

## 状态流转

AI 关卡任务完成 → parser 裁决（不变）→ `outcome=reject && !manualOverride`：

1. 关卡节点保持 `in_progress`，实例保持 `in_progress`，业务单保持 `pending_approval`（不再 returned / 不回草稿）。
2. 写 AI_GATE 决策任务 `action=reject`，comment 保留「AI审查不通过：…」原文（审计 + 前端拦截理由）。
3. 读系统配置 `approval.ai_gate.fallback_reviewer_userid`，在同一关卡节点给审核人建一条 `status=pending` 的 approval_task。
4. 发事件 `APPROVAL_AI_ESCALATED`：审核人收企微待办卡（复用节点进入推卡），发起人收结果卡
   「AI 审查未通过，等待 {审核人姓名} 人工复核」。

审核人动作全部复用现有操作：

| 动作 | 路径 | 结果 |
|---|---|---|
| 放行 | operations.approve → AiGateExecutor.processAction → advanceWorkflow → isNodeComplete 判 approved | 进入下一节点，与 AI 直接通过一致 |
| 退回发起人 | operations.returnToInitiator（通用） | 实例 returned、业务单回草稿；重提进新一轮，关卡重跑，再拦截再转人工 |
| 驳回 | operations.reject（通用） | 实例终态 rejected |

待办列表、审批详情按钮（`determineAvailableActions` 按「本人有 pending 任务」给出）、催办、转交、超管强制转交
（forceTransfer 只拒绝 AI_GATE 任务）均自然可用。

未配置审核人：`applyAiGateDecision` 走旧路径（节点 returned → advanceWorkflow → applyAiGateReturn），
并写 event_log `ai_gate_fallback_reviewer_missing`。

## 组件

### 1. 迁移 0088 `system_config`

```sql
CREATE TABLE IF NOT EXISTS system_config (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  config_key TEXT NOT NULL UNIQUE,
  config_value TEXT NOT NULL,
  updated_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_system_config_key ON system_config(config_key);
```

本期唯一键：`approval.ai_gate.fallback_reviewer_userid`，值为企微 userid，空串表示清除。

### 2. `services/system-config.ts`

- `getSystemConfig(env, key): Promise<string | null>`（trim 后空串视为 null）
- `getSystemConfigEntry` 行存在即返回（value 可为空串，保留 updated_by/updated_at 供设置页显示谁清空的）
- `setSystemConfig(env, key, value, updatedBy): Promise<void>`（INSERT … ON CONFLICT(config_key) DO UPDATE）
- 直连 D1，不做 KV 缓存（每次 AI 拦截读一次，频率极低）。

### 3. `services/approval/ai-gate-fallback.ts`（新）

- `resolveAiGateFallbackReviewer(env): Promise<string | null>` — 读配置并规范化。
- `hasPendingHumanTaskOnNode(env, nodeInstanceId): Promise<boolean>` — `assignee_userid <> 'AI_GATE' AND status = 'pending'`。

### 4. `services/approval/ai-gate-apply.ts` — 拦截落地收口

`applyAiGateDecision` 的 `aiBlocks` 分支改为调用新函数 `settleAiGateBlock(env, node, instanceId, parsed)`，
函数内部按 id 自查实例行（id, instance_no, biz_type, biz_id），两个调用点的调用方式不变：

1. 若节点已有 pending 人工任务 → 整段跳过（队列重试幂等）。
2. 读审核人；为空 → 旧行为：节点 `returned` + AI_GATE reject 任务，并直接 INSERT event_log
   `ai_gate_fallback_reviewer_missing`（普通日志行，不是领域事件，不进队列），返回。
3. 有审核人 → 写 AI_GATE reject 任务 → 插入人工任务
   `(node_instance_id, instance_id, assignee_userid=reviewer, action NULL, comment NULL, round, status 'pending')`
   → `publishEvent("APPROVAL_AI_ESCALATED", "approval-engine", { instance_id, instance_no, node_instance_id, reviewer_userid, reason: parsed.comment })`。
4. 写入顺序固定：AI 记录 → 人工任务 → 事件；人工任务写失败即抛错，交队列重试。

queue-handler 实时路径与 executors 重入路径都不改调用方式，仍只调 `applyAiGateDecision`（延续「唯一落地点」）。

### 5. `services/approval/executors.ts` — AiGateExecutor

- `processAction(env, task, action, comment)`：与 SequentialExecutor 相同写法，把人工任务置 completed 并记 action/comment。
- `isNodeComplete`：先查本节点人工任务（`assignee_userid <> 'AI_GATE'`，经 `getActiveTasks` 过滤 cancelled/transferred）：
  - 存在 pending → `{ complete: false }`
  - 存在 completed 且 action=approve → `{ complete: true, outcome: "approved" }`
  - 否则回落到现有 AI_GATE 决策逻辑（approve/reject/returned 三态不变）。
- 驳回与退回发起人由通用操作直接落状态，不经 isNodeComplete。

### 6. `services/approval/engine.ts`

不改 `advanceWorkflow`（未完成即返回）。`determineAvailableActions` 已覆盖人工任务的动作。

### 7. `queue-handler.ts`

新增 `case "APPROVAL_AI_ESCALATED"`：
- `handleApprovalSubmitted(env, instanceId)` → 给所有 pending 任务受理人（即审核人）推待办卡，节点名取模板关卡节点名。
- `pushApprovalResultToInitiator(env, instanceId, "escalated", "AI 审查未通过，等待 {审核人姓名} 人工复核")`，
  姓名用 `resolveApplicantDisplayName(env, reviewer_userid)`。
- 两路各自 try/catch 写 isolation_guard 事件，与既有 case 一致。

`ApprovalResultType` 目前在 `queue-handler.ts` 与 `services/wecom-approval-push.ts` 各有一份同名定义：改为由
wecom-approval-push.ts 导出、queue-handler.ts 引用，并增加 `"escalated"`；结果卡标签「已转人工复核」（与其余五个 已+动词 标签一致；卡片句式为「…已更新为「已转人工复核」。说明：…」，标题与颜色沿用现有模板）。

### 8. `routes/admin.ts`

- `GET /admin/approval-ai-gate/settings` → `{ fallback_reviewer_userid, fallback_reviewer_name, fallback_reviewer_role, updated_by, updated_at }`。
- `PUT /admin/approval-ai-gate/settings`，body `{ fallback_reviewer_userid: string }`：
  - 空串 → 清除配置（写审计）。
  - 非空 → 必须存在于企微通讯录缓存，且按标签解析的角色为 `super_admin`；否则 400，消息说明原因。
  - 成功 → upsert + `writeAuditLog(action: "admin.ai_gate_fallback_reviewer.update", detail: { previous, next })`。
- 角色解析从 `routes/auth.ts` 抽到 `services/wecom-role.ts`：把现有 `resolveRoleByWeComTags`（含标签映射解析与 access token 获取）
  搬入并导出 `resolveSystemRoleForUser(env, userid): Promise<UserRole | null>`，auth.ts 改为调用它，登录与通讯录行为不变。
- 现有 `POST /approval-ai-gate/tasks/:taskId/handle` 在 approve/reject 写入前：
  `UPDATE approval_task SET status='cancelled' WHERE node_instance_id=? AND status='pending' AND assignee_userid <> 'AI_GATE'`，避免悬空人工任务。

### 9. Web

- `api/admin.ts`：`getApprovalAiGateSettings` / `updateApprovalAiGateSettings`。
- `views/admin/ai-gate-tasks.vue` 顶部「兜底审核人」设置卡：下拉人选取 `GET /api/v1/auth/wecom/contacts` 并过滤 `system_role === "super_admin"`；
  显示当前人选与角色；未配置时常驻黄色提示「未配置兜底审核人，AI 拦截将退回发起人」；角色不符时黄色提示。
- `views/approval/detail.vue` 时间线：关卡节点上 `assignee_userid !== "AI_GATE"` 的任务加「人工复核」标签，
  pending 时状态文案「AI 拦截，等待人工复核」。

### 10. 小程序

审批详情时间线同样的标签与文案；按钮逻辑不改。随下次提审生效。

### 11. 类型

`services/event-bus.ts` 的 `domainEventTypes` 数组增加 `APPROVAL_AI_ESCALATED`（`DomainEventType` 由该数组推导）；
结果卡类型 `escalated` 见组件 7。

## 边界处理

- 未配置审核人：退化自动退回 + 告警事件 + 管理页提示。
- 审核人失去超管标签：已建任务不受影响；下次拦截仍派给他；管理页展示当前解析角色并提示不符，由超管改配置。
- 审核人是发起人：允许，等同自审。
- 转交/催办：复用现有逻辑。
- 超时：checkApprovalTimeouts 对 timeout_hours 为空的节点按 24 小时计，超时后每小时发 APPROVAL_TIMEOUT 事件（队列无对应处理，仅日志噪音）；人工任务不会被自动关闭。
- 撤回/取消实例：现有逻辑把 pending 任务置 cancelled，人工任务随之关闭。
- D1 无事务：写入顺序固定、失败重试、按「已有 pending 人工任务」幂等跳过。
- 重提新一轮：关卡重跑；再拦截再转人工；人工放行过的轮次不重跑。
- 存量 returned 实例不受影响，仍走编辑重提。
- 已知限制：审批详情对 pending 任务统一给出「退回上一节点」，关卡是首节点时该动作会报错「无上一节点」，本期不改。
- 人工任务只认最近一次 AI 决策之后的记录：退回到关卡重跑时同一 node_instance 会保留旧的人工放行记录，不能让它绕过新的拦截；写 AI 决策记录前必须先收掉节点上 pending 的人工任务（控制台、settleAiGateBlock 跳过、handleRoundReset 均遵守）。
- 节点 in_progress 且仅有 AI 驳回记录 = 转人工写到一半，非终态，等队列重试（仅关卡经 TASK_COMPLETED 队列路径进入时；经上一节点审批请求进入时无自动重试，由超管在 AI关卡任务页处理，后续加巡检）；节点 completed + AI 驳回 = 超管覆写终态。
- 两条落地路径都先写 AI 记录再改节点状态；未配置路径若先置 returned 再写记录，部分写入会让队列重入查不到节点而卡死。
- 事件重投时若节点已无 pending 人工任务则不再推卡，记 ai_gate_escalation_push_skipped。
- 配置读取异常（如迁移未应用）退化为旧退回，告警日志行带 error 并 console.error。
- 设置接口：PUT 必须带字符串字段、长度 ≤ 64，空串清除；上游错误脱敏后返回；通讯录不可用时 GET 返 contact_check_error、PUT 返 400。
- 已作废（含撤回/取消实例）的人工复核任务两端统一显示「人工复核任务已作废」，转签显示「人工复核 · 已转签」。
- 重提新一轮：AI 关卡按轮次查 task_queue（payload.round，缺省视为 1），新一轮必重新创建 AI 任务重新审查；此前查询不分轮次会复用上一轮结果，导致 AI 退回后无法通过重提脱困。
- 关卡经上一节点审批请求进入时，APPROVAL_AI_ESCALATED 与随后的 APPROVAL_NODE_ENTERED 都会给审核人推待办卡，靠企微 600 秒重复消息抑制去重，event_log 会记两次 wecom_template_card_sent。
- 审核人待办卡的节点名取模板里的关卡节点名（如「AI风险关卡」），不一定是「AI关卡」。
- 转交人工复核任务沿用现有 transfer，无角色限制，审核人可把决策转给任何人（owner 接受）。

## 测试

- `ai-gate-apply.test.ts`：转人工写入顺序与事件、无审核人退化 + 告警、重试幂等。
- `executors`（新增 ai-gate-executor 测试）：isNodeComplete 四态（无人工任务维持旧逻辑 / 人工 pending 未完成 / 人工 approve 通过 / AI reject + 人工 pending 不得判 returned）；processAction 写入。
- `queue-handler`：`APPROVAL_AI_ESCALATED` 两路推卡与 isolation guard。
- `admin`：settings 四种情况（空值清除、非通讯录、非超管、成功 + 审计）；handle 路由取消悬空人工任务。
- `system-config`：读写与空串规范化。
- `wecom-role`：抽出后 auth.ts 行为不变（auth.ts 无路由测试；靠搬迁块逐字比对 + tsc 保证，上线前人工冒烟企微登录与通讯录）。
- web vitest：设置卡过滤 super_admin、未配置提示；时间线标签。
- 现有断言「AI 拦截 → returned」的用例改为「未配置审核人」前提，不删用例。

## 明确不做

- 动态插入人工节点、模板级审核人、多人或轮值。
- 改白名单或 warn 语义。
- 给存量 returned 实例提供强制放行（SP-20260913-0007 已用直连 D1 处理）。
- 首节点「退回上一节点」按钮的隐藏。

## 上线顺序

1. 远程应用迁移 0088（`npx wrangler d1 migrations apply hybcdg-prod-db --remote`）。
2. push main 自动部署 API 与 Web。
3. 部署后立刻在「AI关卡任务」页配置兜底审核人；未配置前行为与现状相同。
4. 小程序改动随下次提审。
