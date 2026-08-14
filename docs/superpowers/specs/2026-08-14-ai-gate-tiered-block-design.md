# AI 关卡分级拦截 + 拦截改退回 — 设计文档

日期：2026-08-14
状态：已批准（owner 2026-08-14 拍板）
背景调查：SP-20260811-0002/0003/0004 连拒三单、SP-20260813-0005 误驳（付款节点越权检查）

## 问题

AI 关卡（approval_ai_gate）历史 8 次 reject 中 6 次站不住脚，失效模式：

1. **编造维度**：`contract_identity_consistency`（提示词中不存在）即可硬拒（SP-20260811-0002）
2. **串域维度**：合同域用 `data_consistency`/`material_consistency`（SP-20260811-0004、SP-20260805-0002）
3. **合法维度名 + 越权检查**：付款域 `material_consistency` 名下做"付款节点核对"（SP-20260813-0005）——维度名白名单挡不住，必须裁决"fail 是否有拦截资格"
4. **结构性误比**：系统流水号（CT-YYYYMMDD-NNNN）与附件印刷编号永不相等，重试序号+1 差距更大
5. **服务端守卫死代码**：ai-gate-result.ts 的 fail 证据守卫只在路径2，现行 runner 走路径1（metadata.outcome）直接 return
6. **reject 终态**：单据只能重建 → 孤儿草稿 + 烧流水号 + rejected 重试计入 recent_payments 反向污染下次判定

## 决策（owner 拍板）

- AI 保留拦截权，但按维度白名单收窄（代码硬裁决，不信任模型自律）
- 拦截后果：实例退回（returned）可改重提，不再终态 rejected
- 超管 manual_override 完全绕过白名单，其 reject 仍走终态
- 合同域白名单含 amount_terms，但必须保护不定额/临时合同不因无金额被误杀（落提示词 v4）
- recent_payments 一并排除 rejected

## 拦截白名单

| biz_type | 有拦截权的维度 | 依据（历史战绩） |
|---|---|---|
| outbound_contract / inbound_contract | subject_match, amount_terms | subject_match 1真0假；amount_terms 0真2假但 owner 要求保留，靠提示词保护 |
| payment_request | duplicate_payment, overpayment, counterparty_consistency | 柴油串合同真拦截靠 counterparty_consistency |
| 其他（reimbursement_batch, invoice_request, …） | 空（纯建议） | 历史零拦截需求 |

裁决规则：`decision=reject` 仅当存在 ≥1 条 fail 且其 dimension ∈ 白名单[bizType]；否则降级
warn 放行，理由保留（前缀「AI审查放行（需人工重点关注）」+ 降级附注），needs_human_review=true。
维度精确字符串匹配——编造/串域维度天然落空。

## 组件

### 1. parser（packages/api/src/services/approval/ai-gate-result.ts）— 唯一裁决点

- `parseAiGateTaskResult(resultJson, bizType?, fallbackComment?)`；bizType 缺失 → 空白名单（fail-open 偏置）
- **路径1（metadata 直读）同样过白名单**：从 envelope.output 解析 findings 验证。顺带修复路径1守卫死代码
- 旧契约 `{outcome:"reject"}` 无 findings → 无白名单内 fail → 降级（行为收紧：无证据即无拦截权）
- `metadata.manual_override === true` 绕过白名单；结果暴露 `manualOverride`/`downgraded` 标记
- approve 结论不做白名单检查，原样通过

### 2. 落地 helper（executors.ts）— 收敛两个写入点

`applyAiGateDecision(env, nodeInstance, instanceId, parsed)`：
- approve → 节点 completed + AI_GATE task action=approve（现状）
- reject + manualOverride → 节点 completed + task action=reject → isNodeComplete → "rejected" → 引擎终态（现状保留，超管刹车）
- reject（AI 自主）→ 节点 status='returned' + task action=reject（comment 原文「AI审查不通过：…」留审计）

executors.ts 重入路径与 queue-handler.ts 实时路径共用此 helper（教训：重构前 4 份解析副本发散）。

### 3. 引擎（engine.ts + types/approval.ts）

- `NodeCompletionResult.outcome` 增加 `"returned"`；AiGateExecutor.isNodeComplete：reject 决策 + 节点 status='returned' → outcome "returned"；节点 completed + reject → "rejected"（override）
- advanceWorkflow 增加 returned 分支：实例 status='returned'、current_node_key=NULL、发退回事件（镜像 operations.ts 人工退回 194-215），走既有通知链
- 重提复用既有 returned/resubmit 机制：round+1 → AiGateExecutor rerun 重新审。contract-returned-edit / payment-returned-edit 已有测试覆盖编辑重提链路

### 4. recent_payments（ai-slot.ts）

两条查询（按合同、按收款方）：`status != 'cancelled'` → `status NOT IN ('cancelled','rejected')`。
否则白名单内的 duplicate_payment 会被上次被驳的幽灵记录喂出假拦截（SP-20260813-0006 已现信号）。

### 5. 提示词 v4（三处同步契约）

- 迁移 0081 升 DB 模板（ai_prompt_template id=5, version 4）+ admin.ts defaultAiPromptTemplates + task-runner/runner/prompts.py
- amount_terms 保护句扩为：单价/按实结算/**不定额合同/临时合同**（正文含台班、单价、按实结算、暂估等字样或未约定固定总额）附件未载明总价属正常不得判 fail，仅当附件金额与录入金额明确矛盾时 fail
- 「reject会直接终止审批流程」→「reject会将单据退回发起人修改后重新提交，必须慎用」
- **不公布白名单维度**——模型会把越权检查挂到合法维度名下（SP-20260813-0005 实证），公布等于教它换标签

### 6. runner 侧（postprocess.py）

同样的 biz_type 白名单降级逻辑（payload 有 biz_type）。随仓库提交、下次容器重建生效；
生效前服务端裁决独立兜底，不依赖 runner 版本。

## 回溯验证（8 例历史驳回在新规则下）

| 单号 | fail 维度 | 新规则 | 评价 |
|---|---|---|---|
| SP-20260811-0003 | subject_match | 拦（退回） | ✓ 真拦截保留 |
| SP-20260812-0001 | counterparty_consistency | 拦（退回） | ✓ 真拦截保留 |
| SP-20260811-0002 | contract_identity_consistency | 降级 warn | ✓ 误杀消除 |
| SP-20260811-0004 | data_consistency | 降级 warn | ✓ 误杀消除 |
| SP-20260813-0005 | material_consistency(payment) | 降级 warn | ✓ 误杀消除 |
| SP-20260708-0003 | 无 findings | 降级 warn | ✓ |
| SP-20260805-0001/0002 | amount_terms | 仍会拦（退回） | ✗ owner 权衡后接受，靠 v4 提示词保护 + 退回降代价 |

## 测试

- parser：白名单命中/未命中/无 findings/旧契约/manual_override/bizType 缺失，全部含路径1用例；8 例历史 result_json 参数化回溯 fixture
- helper：三种落地分支 × 两个调用点
- engine：returned 分支状态迁移 + 事件
- ai-slot：recent_payments 过滤
- 现有断言 reject 终态行为的测试逐条改为新契约，不删用例

## 明确不做

- 不动存量三单（302/303/304 留作故障证据；657 已 override 通过）
- 不把系统流水号从 payload 摘除（后续优化项）
- 不给报销域拦截权（将来一行常量可加）
