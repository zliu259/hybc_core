# 报销模块增强设计（拆单 / AI 一键成批 / 草稿异常管理 / 详情页优化）

- 日期：2026-07-10
- 状态：已与业主确认关键决策，待实施
- 范围：`packages/api`（reimbursement 路由 + 迁移）、`packages/web`（finance/reimbursement 视图）

## 背景

办公室（财务）在报销签收与复核环节遇到四类问题：

1. 员工把不同项目的票据混在同一个报销提交里，办公室无法拆分纠正。
2. 成批送审需要逐人逐项目手动选择候选、填付款信息，重复劳动多。
3. 草稿/未登记/被退回后遗弃/已废止的"垃圾单"没有管理入口，无法批量清理（员工被退回后倾向另开新单）。
4. 信封详情页操作按钮平铺难懂、无加载反馈、底部状态表夹杂英文原值；智能核查结果折叠在页面底部不显眼；附件图片预览不能缩放。

另发现员工把电子发票（数电票）上传进实物信封通道的提交，需要制度性拦截。

## 已确认的关键决策（业主拍板）

| 决策点 | 结论 |
|---|---|
| 拆单新单 UUID | 系统自动生成新信封 UUID，办公室一键打印新信封（无需预先持有空白信封） |
| 拆单操作角色 | **仅 finance 与 super_admin**（不含 manager/site_manager） |
| AI 成批中 AI 的角色 | 规则分组（同人同项目）+ AI 审批摘要（复用批次 AI 审计，异步不阻塞） |
| 草稿/异常 tab 范围 | 草稿+未登记、已废止、被退回后滞留（rejected/supplement）三类全含 |
| 删除语义 | 软删除（status→deleted），数据与审计日志保留 |
| 电子发票混入实物信封 | 需要防住（检测 + 复核通过硬门槛，见功能一附加防护） |

## 功能一：报销拆单

### 后端

新端点 `POST /api/v1/reimbursement/:id/split`，`requireRoles(["super_admin", "finance"])`。

前置条件（不满足返回 400 结构化错误）：

- 原单 `status ∈ {submitted, received}`；
- `batch_id IS NULL` 且 `approval_instance_id IS NULL`；
- 实物信封与电子发票通道均可拆。

请求体：

```jsonc
{
  "new_envelope": {
    "project_id": 123,          // 必填：纠正后的正确项目
    "amount": 100.5,            // 必填 > 0
    "category": "…",            // 可选
    "description": "…",         // 可选
    "expense_date": "2026-07-01" // 可选
  },
  "attachment_ids": [1, 2],      // 转移到新单的附件，必须属于原单且 active
  "original_amount": 200.0,      // 必填 > 0：原单调整后金额
  "reason": "员工混报两个项目"     // 可选，写入审计
}
```

事务内行为：

1. 创建新信封：`crypto.randomUUID()` 同时作为 `envelope_uuid` 与 `envelope_no`（与 batch-generate 一致）；继承原单 `applicant_userid`、`channel`、`status`、`verification_status`、`received_at`、`submitted_at`；`precheck_status='none'`；`split_from_envelope_id=原单id`。
2. 转移附件：`UPDATE envelope_attachment SET envelope_id=新id WHERE id IN (…) AND envelope_id=原id AND status='active'`，行数不符即回滚。
3. 更新原单：`amount=original_amount`，`precheck_status='none'`（两边都需重新复核），`updated_at`。
4. 事务外：对两个信封分别 `enqueueEnvelopeAiAudit`（自动核查，异步）；`publishEvent("REIMBURSEMENT_ENVELOPE_SPLIT")`；两条审计日志（原单、新单各一）。

金额规则：仅校验双方 > 0，不强制"新+原=旧"（原申报额本可能有误）；响应中返回 `amount_delta` 供前端提示。

迁移 `0057_reimbursement_split_lineage.sql`：`reimbursement_envelope` 加列 `split_from_envelope_id INTEGER`、`split_reason TEXT`，索引 `idx_reimbursement_split_from ON reimbursement_envelope(split_from_envelope_id)`。

策略抽离：`reimbursement-split-policy.ts`（可拆状态判断、附件归属校验、金额校验）+ 同名 `.test.ts`。

### 前端（detail.vue + 新组件）

- 操作区（办公室分组内）新增"拆单"按钮：`finance/super_admin` 且 `status ∈ {submitted, received}` 且未入批可见。
- 拆单弹窗（新组件 `components/SplitEnvelopeDialog.vue`）：附件多选表（勾选=转移到新单）→ 新单表单（项目必选、金额必填、类别/说明/费用日期）→ 原单调整金额（预填 原额−新额）→ 合计对照提示（不阻断）。
- 成功后结果框：新信封二维码 + **"打印新信封"**（从 envelope-generator.vue 抽出单信封 QRCode→PDF→print 逻辑为共享工具 `utils/envelope-print.ts`）+ "打开新单详情"。
- 提交按钮 loading，成功后刷新原单详情并 emit changed。

### 附加防护：电子发票混入实物信封

- **检测**（纯函数 `detectEInvoiceInPhysical`，放入 split-policy 同级的 `reimbursement-einvoice-guard.ts` + 测试）：信封 `channel='physical'` 且静默审查提取结果（`ocr_result_json.extracted_invoices[]`）中任一发票具有 20 位数电票号码（`invoice_unique_no` 全数字且长度 20）→ 判定"电子发票混入实物信封"。
- **拦截点**：`POST /:id/precheck action=approved` 时执行检测，命中则拒绝（400，结构化 `data.einvoice_in_physical=true`），除非请求体带 `override_einvoice_reason`（仅 finance/super_admin，写审计日志）。办公室的常规处置是"复核驳回"，让员工走电子发票通道重新提交。
- **展示**：`rowAnomalyTags` 增加"电子发票混入"（danger）标签，条件为检测函数命中（列表接口透出布尔字段 `einvoice_in_physical`，由列表 SQL 或行后处理计算）；详情页智能核查卡片中高亮同样提示，员工视角显示引导文案"检测到电子发票，请改用电子发票通道提交"。

## 功能二：AI 一键创建终审批次

### 后端

`GET /api/v1/reimbursement/batch/proposals`（office 四角色可读）：

- 查询全部可入批信封：`status='received' AND precheck_status='approved' AND batch_id IS NULL AND approval_instance_id IS NULL`；
- 按 `(project_id, applicant_userid)` 分组返回：信封摘要列表（id/编号/金额/风险标签）、`item_count`、`total_amount`、自动匹配收款人（该 userid 恰有 1 个 active internal payee 时返回其 id/name/账号，否则 null + `payee_required` 标记（读 `REIMBURSEMENT_REQUIRE_PAYEE`））、建议付款方式 `personal_transfer`。

`POST /api/v1/reimbursement/batch/proposals/confirm`（`requireRoles(["super_admin", "finance"])`，带 Idempotency-Key）：

```jsonc
{ "proposals": [ { "project_id": 1, "applicant_userid": "zhang", "envelope_ids": [1,2], "payment_method": "personal_transfer", "payee_id": 5 } ] }
```

- 逐组执行：复用现有批次创建逻辑（同一事务内建 batch + items + 更新信封）→ `submit-approval` 逻辑 → 触发现有批次 AI 审计（异步 task_queue，即"AI 摘要"，审批人在批次详情/审批页查看报告）；
- **每组独立成败**：单组失败记录错误继续下一组；响应返回逐组结果 `{ project_id, applicant_userid, ok, batch_no?, error? }`。
- 实现上将现有 `POST /batch` 与 `submit-approval` 的核心逻辑抽成内部函数复用，避免复制粘贴。
- 分组/资格判断抽 `reimbursement-batch-proposal-policy.ts` + 测试。

### 前端（batch.vue）

- 页头新增主按钮 **"AI 一键成批"** → 抽屉展示建议批次卡片：人员、项目、N 条、合计、风险标签汇总、收款人下拉（预选自动匹配值，可改/可新建）、付款方式下拉（默认转账）；默认全选，可逐卡取消。
- "确认创建并送审"（二次确认框显示批次数与总金额）→ 逐组进度与结果展示（成功批次号可点开详情，失败显示原因），完成后刷新批次列表与候选。

## 功能三：签收与复核"草稿与异常"管理 tab

- **可见性**：仅 `super_admin`（workbench 第①步新增第 4 个 tab）。
- 三个子筛选（复用现有列表接口的多值过滤参数）：
  - 草稿/未登记：`status IN (draft, unregistered)`；
  - 退回滞留：`status='submitted' AND precheck_status IN (rejected, supplement)`；
  - 已废止：`status='cancelled'`。
- 表格增加"滞留天数"列（`updated_at` 距今）；`workbench-summary` 增加 `stale_admin` 计数（三类合计）用于 tab 角标（仅超管请求时计算）。
- 新端点（均 `requireRoles(["super_admin"])`、显式 id 列表 ≤500、逐条校验、逐条审计日志、返回逐条结果）：
  - `POST /api/v1/reimbursement/void-batch`：`{ envelope_ids, reason? }`，允许 `draft/unregistered/submitted/received` → `cancelled`；
  - `POST /api/v1/reimbursement/delete-batch`：`{ envelope_ids, reason? }`，仅允许 `draft/unregistered/cancelled` → `deleted`（防止误删在途单）。
- 前端：多选 + 全选当页 + "全选全部 N 条"（分页拉取全部 id，上限 500，显式 id 提交，保证审计可溯）；"一键废止所选" / "一键删除所选"均二次确认（显示条数与金额合计）；操作后刷新列表与角标。
- 状态流转策略抽 `reimbursement-bulk-lifecycle-policy.ts` + 测试。

## 功能四：报销信封详情页优化

1. **操作区重组**（detail.vue）：
   - 顶部"当前环节"提示条：如"当前：待签收 → 下一步：核查签收或标记核查异常"。
   - 三个分组：员工操作（保存/扫码登记/提交）、办公室签收与复核（核查签收/核查异常/复核三键/拆单/二次静默审查 + 备注输入框）、管理操作（废止，危险区样式）。每组一行说明文字；当前阶段不可用的组收起/置灰。
2. **加载态**：
   - 修复 bug：`el-card :loading` 非法 prop（detail.vue:1029 实际无效）→ 改 `v-loading` 全卡遮罩；
   - 所有动作按钮统一 per-action loading（核查签收/核查异常/复核三键等目前缺失），请求期间禁用同组按钮防重复点击。
3. **智能核查结果显眼化**：
   - 将"后台静默审查与重复风险"从底部 `el-collapse` 移出，改为 summary tiles 正下方的全宽卡片"智能核查与风险提示"，**始终展开、不可折叠**（office 视角）；按最高风险等级着色左边框/标题；重复风险表并入该卡片；员工视角维持现状（不展示 office 审查内容，但展示电子发票混入引导，见功能一）。
4. **状态全面汉化**：
   - 底部 descriptions 表"发票识别状态/智能核查状态"改走 `toTaskStatusLabel`；补全任务状态映射：`assigned=已分派`、`running=处理中`、`queued=排队中`；
   - **复核状态全面汉化**：`enum-labels.precheckStatusLabel` 补 `none=未复核`，统一措辞为"待复核/复核通过/复核驳回/待补充"；detail.vue 本地重复映射删除、改用共享映射；修复三处 toast 输出英文原值（office-workbench.vue:294、detail.vue:968、precheck.vue:72 的 `${action}`）；扫尾 batch.vue / batch-detail.vue / list.vue / precheck.vue 所有报销相关状态展示。
5. **附件图片预览缩放**：预览抽屉中图片类文件改用 `el-image`（内置 viewer：滚轮缩放/旋转/拖拽/全屏），PDF 保持 iframe；其他类型维持下载提示。

## 横切事项

- **测试**：vitest，按仓库模式抽纯策略函数 + 同目录 `.test.ts`：`reimbursement-split-policy`、`reimbursement-einvoice-guard`、`reimbursement-batch-proposal-policy`、`reimbursement-bulk-lifecycle-policy`。
- **迁移**：`0057_reimbursement_split_lineage.sql`；上线顺序：先 `wrangler d1 migrations apply hybcdg-prod-db --remote`，再推 main（推 main 即部署）。
- **权限对照**：拆单/一键成批确认/电子发票强制通过 = finance+super_admin；批量废止/删除 = super_admin；建议批次查看 = office 四角色。
- **顺手清理**：删除无引用的 `views/finance/reimbursement/envelope-generator 2.vue`。
- **文档**：追加 `doc/开发记录.md`；更新 `doc/UI设计文档.md`（工作台新 tab、详情页布局、批次建议抽屉）。

## 明确不做（YAGNI）

- 不做"按条件批量删除"（只接受显式 id 列表）；
- 不做拆单多于一次的一拆多（一次拆一单，可重复操作达到一拆多）；
- 不做 AI 决定分组；
- 不做物理删除与附件文件清理；
- 不改动审批引擎与批次审批流本身。

## 实施修订（2026-07-10 计划与实施阶段确认）

1. **批次确认改前端编排**：`POST /batch/proposals/confirm` 未实现；前端逐组调用既有
   `POST /batch` → `POST /batch/:id/submit-approval` → `POST /batch/:id/trigger-audit`。
   理由：避免重构 4900 行路由文件中的付款关键路径；逐组独立成败语义天然保留。
2. **标签统一位置**：报销域规范汉化标签集中在模块内 `reimbursement-labels.ts` 而非全局
   `utils/enum-labels.ts`（后者被其他业务域共用，措辞不同，避免跨域影响）。
3. **新增 `exclude_unassigned` 列表参数**：信封生成器预生成的空白信封
   （`unregistered` + `__UNASSIGNED__`）属于库存，「草稿/未登记」管理页必须排除，否则会被误删。
4. **拆单端点并发加固**：`runInTransaction`（`services/db-transaction.ts`）在 D1 生产环境
   降级为非事务执行——D1 不支持 SQL `BEGIN TRANSACTION`，`throw` 不会回滚。原语句顺序
   （先建新信封+转移附件，最后校验原单）在「A 拆单 / B 同时成批」并发下会导致附件已转走、
   新信封已建，而原单带着缺失的附件进入审批付款流。修复：带守卫的原单 UPDATE 前置为并发闸门
   （并补 `approval_instance_id IS NULL` 守卫防 TOCTOU）；INSERT 与附件转移包入内层
   try/catch，失败时显式补偿（附件移回 → 硬删新信封 → 还原原单金额与复核状态）后重抛。
5. **附件类型汉化**：设计稿只提到状态表汉化，实施时补齐附件表「类型」列
   （`invoice/receipt/contract/other` → 发票/凭证/合同/其他）。
6. **事件类型注册**：`publishEvent` 的 `type` 是字面量联合，新增的
   `REIMBURSEMENT_ENVELOPE_SPLIT` / `_BULK_VOIDED` / `_BULK_DELETED` 需在
   `services/event-bus.ts` 注册后方可通过 `tsc`。

### 遗留风险（记录，不在本次范围）
- 本仓库其他端点（如批次创建）同样依赖 `runInTransaction`，在 D1 生产降级模式下存在同类
  「部分写入不回滚」风险，属既有系统性问题。若后续要根治，方向是改用 D1 原生的
  `db.batch([...])`（原生原子）或为关键写路径逐一补偿。
