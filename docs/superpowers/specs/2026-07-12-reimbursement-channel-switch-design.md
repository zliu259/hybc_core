# 报销信封通道切换（办公室）设计

日期：2026-07-12
状态：已确认

## 背景与目标

办公室人员处理个人报销时，经常遇到员工把电子发票投进实体信封通道（或反之）。现状下通道在创建后不可更改（`PUT /:id` 显式拒绝 "Envelope channel cannot be changed after creation"），电子发票混入实体信封会在复核环节被拦截，只能驳回让员工重新走电子通道提交，流程冗长。

目标：允许办公室人员在单据处于**草稿（draft/unregistered）/ 待签收（submitted）**状态时自由切换电子通道与实体通道；切换后自动重跑 AI 核验，使复核轮的通道策略始终与当前通道一致。

## 已确认的决策

| 决策点 | 结论 |
|---|---|
| 实现方式 | 专用切换接口 `POST /:id/switch-channel`，通用编辑接口 `PUT /:id` 的「通道不可改」不变式保持不动 |
| 权限角色 | 仅 `super_admin` + `finance` |
| 切换后状态 | 保持原状态（草稿仍草稿、待签收仍待签收），流转不打断 |
| AI 核验触发 | **双向**切换都自动触发（有活跃附件时） |

## 一、后端

### 端点

`POST /api/v1/reimbursement/:id/switch-channel`

- 权限：`requireRoles(["super_admin", "finance"])`
- 请求体：`{ channel: "electronic" | "physical", reason?: string }`

### 准入规则（纯函数 `decideChannelSwitch`）

新文件 `packages/api/src/routes/reimbursement-channel-switch-policy.ts`，仿照 `reimbursement-create-policy.ts` 的纯函数决策模式：

1. 信封存在且状态非 `deleted` / `cancelled`（不存在→404，其余→400）
2. 状态 ∈ `draft` / `unregistered` / `submitted`；其余状态一律 400
3. 填报人不是 `__UNASSIGNED__`（信封生成器的库存空白信封不允许切通道）
4. 目标通道非法（不在 electronic/physical 内）→ 400
5. 目标通道与当前相同 → 200 `{ changed: false }` 幂等空操作，不触发 AI（天然防双击/重放）。noop 分支带自愈：若最近一轮发票复核的通道与当前通道不一致且有活跃附件，补触发 AI 核验整轮重跑（覆盖切换 UPDATE 后中断的补偿缺口）

### 写入（D1 无事务约束下的原子性）

单条 UPDATE 自带原子性 + 乐观锁（WHERE 携带旧通道与合法状态集）：

```sql
UPDATE reimbursement_envelope SET channel = ?, updated_at = ?
 WHERE id = ? AND channel = ?/*旧通道*/ AND status IN ('draft','unregistered','submitted')
```

变更行数为 0 → 直接按并发冲突返回 409（不重查）。

**UUID 不变式**：`envelope_uuid` / `envelope_no` 保持不变（不触碰 uuid 不变式巡检，见提交 295ca72）。电子→实体后系统生成的 UUID 依旧是合法 UUID、可提交；如需绑定真实实体信封，走已有「换绑UUID」（`POST /:id/rebind-uuid`）功能。

### 切换成功后的动作（双向一致）

1. **有活跃附件** → `enqueueEnvelopeAiAudit(env, id, { forceRerun: true, triggeredBy: auth.sub, reason: "channel_switch_to_electronic" | "channel_switch_to_physical" })`
   - `forceRerun: true` 开新一轮发票复核：旧轮记录的是旧通道的审查策略（电子=QR优先查重 / 实体=多模态冗余识别），必须整轮重跑
   - 副作用：`precheck_status` 重置为 `pending` —— 处于「退回滞留」（submitted + rejected/supplement）的单会自动离开该名单进入重新核验，符合预期
2. **无附件** → 只切通道，不触发 AI（空跑无意义；后续上传附件 / 提交时照常触发）
3. `publishEvent("REIMBURSEMENT_ENVELOPE_CHANNEL_SWITCHED", "reimbursement_envelope", { envelope_id, from_channel, to_channel, reason, switched_by })`
4. `writeAuditLog(action: "reimbursement.envelope.switch_channel", detail: { from_channel, to_channel, reason })`

（3、4 与换绑 UUID 端点的审计模式完全一致。）

### 响应

```json
{ "success": true, "data": { "id": 123, "channel": "electronic", "changed": true, "ai_audit_triggered": true } }
```

## 二、前端（仅 `packages/web/src/views/finance/reimbursement/detail.vue`）

工作台「草稿与异常」「待签收」两个入口都通过详情抽屉复用 detail.vue，一处改动覆盖全部入口。

1. 「报销通道」卡片区加**「切换通道」按钮**：
   - 显示条件：当前用户角色 ∈ super_admin/finance 且 `detail.status` ∈ draft/unregistered/submitted
   - 点击弹 `ElMessageBox.confirm` 确认框：说明切换后会自动重跑 AI 核验、可填切换原因
   - 成功后 `loadDetail()` + `notifyChanged()`（父工作台刷新徽标与列表）
2. **顺手修正现有陷阱**：编辑已有单据时通道下拉框看似可改、保存必被后端 400 —— 非创建模式下禁用该下拉框，提示「已创建单据请用切换通道功能」
3. `packages/web/src/api/reimbursement.ts` 增加 `switchReimbursementChannel(id, { channel, reason })` 封装

## 三、测试（TDD，先写测试）

1. `reimbursement-channel-switch-policy.test.ts`：纯函数全分支
   - 状态门（draft/unregistered/submitted 放行；received/batched/pending_approval/approved/paid/cancelled/deleted 拒绝）
   - 库存空白信封（`__UNASSIGNED__`）拒绝
   - 同通道 no-op
   - 非法通道值拒绝
   - 双向（electronic↔physical）放行
2. 路由级测试（仿照 `reimbursement-detail-status-guard.test.ts` 模式）：
   - 角色拒绝（manager/site_manager/operator 403）
   - 乐观锁冲突（UPDATE 0 行 → 409）
   - AI 触发：有附件→enqueue 调用且 forceRerun=true；无附件→不调用
   - 审计日志与事件发布

## 四、边界情况说明

- **待签收状态下实体→电子切换**：单据仍留在「待签收」tab，办公室照常签收；AI 核验后台以电子策略重跑，签收后复核时结果已就绪。原「电子发票混入实体信封」的复核拦截因通道已是电子而自然消失。
- **电子→实体后提交**：系统生成的 UUID 通过 `isValidUuid` 校验，可直接提交；绑定真实信封用换绑功能，属办公室自主操作。

## 五、不做的事（YAGNI）

- 不加数据库迁移（`channel` 列已存在）
- 不在工作台列表行内加切换按钮（详情抽屉已覆盖）
- 不动员工端流程 —— 员工电子发票误投实体信封时，办公室直接切通道，不再需要驳回重报
- 不做批量切换
