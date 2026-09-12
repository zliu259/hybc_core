# 报销成批按发票抬头筛选与软约束 — 设计规格

- 日期：2026-09-12
- 状态：设计已确认（owner 2026-09-12），待拆实施计划
- 范围：packages/api、packages/web；小程序 v1 不改

## 1. 背景与问题

报销款必须由发票抬头（购买方）对应的我方主体支付。当前信封没有「发票抬头」字段，
成批页只能按项目 + 被报销人筛选候选，办公室无法看出抬头，结果出现混抬头批次
（2026-09-11 案例 RM-20260911-0001：信封 237 抬头北京鑫丰畅，241 抬头廊坊丰畅，
被合成一批送审，最终只能直连生产库退回并解散）。

事实基础：
- 任务节点 `ocr_extract` 的提示词已要求输出 `buyer_name`/`seller_name`/`tax_no`，
  完整结果存于 `reimbursement_invoice_review.extraction_json`（迁移 0037 建表）；
  API 折叠到信封 `ocr_result_json` 时丢弃了 `buyer_name`。
- 生产 317 条完成识别中 143 条带 `buyer_name`；主要值为
  「北京鑫丰畅建设有限公司」「廊坊市丰畅市政工程有限公司」
  「恒越百川（北京）建设科技有限公司」（含半角括号、英文变体），均对应 `entity` 表主体。
- 少量抬头为个人名或第三方公司；约一半信封识别不出抬头，纯 OCR 不够，需人工兜底。

## 2. 目标与非目标

目标：
1. 每个信封有可信的「发票抬头主体」：OCR 自动预填，办公室可修正，存量回填。
2. 成批页能按抬头筛选、看到抬头列；混抬头成批需填写理由（软约束），批次记录抬头主体。
3. 付款实体按抬头预填；审批选款与打款登记时付款实体 ≠ 抬头主体给出标红提示并二次确认，不硬拦。
4. 电子发票与实物信封统一适用。

非目标（本期不做）：
- 小程序任何改动（审批页选款提示留待下次提审）。
- AI 关卡提示词改动（仅补上下文字段，不改评分规则）。
- 抬头模糊匹配 / 英文名映射 / 主体别名表。
- 复核通过（precheck）强制要求抬头。

## 3. 需求决策记录

| 问题 | 决定 |
| --- | --- |
| 抬头以什么为准 | OCR 识别 + 办公室确认/修正；申请人端不增加操作 |
| 适用范围 | 电子发票与实物信封都按抬头分批 |
| 成批约束强度 | 软约束：筛选 + 列展示 + 混抬头弹确认填理由，允许强制混批（记审计） |
| 付款实体联动 | 成批时预填；审批选款和打款登记不一致时标红并二次确认，不硬拦 |
| 实现路径 | 方案 A：信封级抬头字段 + OCR 预填 + 办公室修正 + 存量回填 |

## 4. 数据模型（迁移 `0087_reimbursement_invoice_title.sql`）

```sql
ALTER TABLE reimbursement_envelope ADD COLUMN invoice_title_entity_id INTEGER;  -- 匹配到的我方主体 entity.id，NULL=未识别
ALTER TABLE reimbursement_envelope ADD COLUMN invoice_title_name TEXT;          -- 抬头原文快照（OCR buyer_name 或手工选择的主体名）
ALTER TABLE reimbursement_envelope ADD COLUMN invoice_title_source TEXT;        -- 'ocr' | 'manual' | NULL
CREATE INDEX idx_reimbursement_envelope_invoice_title_entity_id
  ON reimbursement_envelope(invoice_title_entity_id);

ALTER TABLE reimbursement_batch ADD COLUMN invoice_title_entity_id INTEGER;     -- 所选信封抬头一致时写入；混合/全部未识别为 NULL
ALTER TABLE reimbursement_batch ADD COLUMN mixed_title_reason TEXT;             -- 混抬头强制成批理由
```

存量回填（同一迁移内，幂等）：
1. 对 `status != 'deleted'` 且 `invoice_title_source IS NULL` 的信封，取
   `reimbursement_invoice_review` 中该信封 `task_status='completed'`、
   `json_extract(extraction_json,'$.buyer_name')` 非空的最新一行（`review_round DESC, id DESC`），
   写入 `invoice_title_name`，`invoice_title_source='ocr'`。
2. 对 `invoice_title_source='ocr'` 且 `invoice_title_entity_id IS NULL` 的信封，
   用 SQL 归一化（去空格、`(`→`（`、`)`→`）`）与 `entity.entity_name`（`status='active'`）
   精确比对；**恰好一个**主体命中才写入 `invoice_title_entity_id`。
3. 不回填批次表；历史批次抬头保持 NULL。

本地 mock 库无识别数据时两条 UPDATE 自然空跑。

## 5. 抬头匹配策略（`packages/api/src/routes/reimbursement-invoice-title-policy.ts`）

纯函数模块，带 vitest：
- `normalizeInvoiceTitle(raw: unknown): string | null` — 去首尾及内部空白（含全角空格），
  半角括号转全角；空串返回 null。
- `matchInvoiceTitleEntity(raw, entities)` — `entities: {id, entity_name, status}[]`；
  只在 `status='active'` 中按归一化名精确比对；唯一命中返回 `{ entityId, name: raw }`，
  否则 `{ entityId: null, name: raw }`。个人名、第三方公司、英文名自然落入未识别。
- `pickBuyerNameFromReviews(rows)` — 输入本轮识别行；优先取与发票号提示同源的 bestRow
  的 `buyer_name`，否则取第一条非空；无则 null。
- `resolveOcrTitleUpdate(envelope, ocrOutcome)` — `source='manual'` 返回 null（不写）；
  本轮识别全部完成且无 buyer_name → 返回清空（三列 NULL）；有 buyer_name → 返回
  `{ entityId, name, source: 'ocr' }`；仍有识别任务进行中 → 返回 null。

批次级策略（`reimbursement-batch-title-policy.ts`，纯函数带 vitest）：
- `summarizeBatchTitles(envelopes)` → `{ kind: 'uniform'|'mixed'|'unknown'|'empty',
  entityId: number|null, counts: {entity_id: number|null, name: string|null, count}[] }`
  - `uniform`：全部同一非空主体；`unknown`：全部未识别；`mixed`：其余情况
    （含「已识别 + 未识别」混合）；`empty`：无信封。
- `validateMixedTitleReason(reason)` — 去空白后长度 2–200 为有效。

## 6. OCR 同步与手工修正

### 6.1 `syncEnvelopeAuditState`（routes/reimbursement.ts）
- 在现有折叠逻辑后，用 `pickBuyerNameFromReviews(completedRows)` 取抬头原文，
  加载 active 主体列表一次，`matchInvoiceTitleEntity` 匹配，
  `resolveOcrTitleUpdate` 决定是否写入；写入并入现有 `UPDATE reimbursement_envelope` 语句。
- `ocr_result_json.extracted_invoices[*]` 增加 `buyer_name`、`seller_name` 字段（只增不删）。

### 6.2 `PUT /reimbursement/:id`
- 请求体新增 `invoice_title_entity_id?: number | null`（三态：缺省不改；数字设置；null 清除）。
- 仅 `super_admin/manager/site_manager/finance` 可传该字段，其他角色传了返回 403。
- 数字必须是 `status='active'` 的主体，否则 400。
- 状态限制沿用现有规则（`batched/pending_approval/approved/paid` 不可改）。
- 设置：三列写 `entity.id / entity.entity_name / 'manual'`；清除：三列 NULL（回到自动识别，
  下次 OCR 同步可重填）。
- 值有变化时写审计 `reimbursement.envelope.set_invoice_title`（before/after）。

### 6.3 拆单
`POST /:id/split` 新建信封时复制父信封三列（同一张发票）。

## 7. 候选 / 建议 / 成批 API

### 7.1 `GET /reimbursement/batch/candidates`
新增可选参数 `invoice_title_entity_id`：正整数 → `= ?`；`none` → `IS NULL`；缺省不过滤；
其他值 400。返回行自带三列（现有 `SELECT *`）。

### 7.2 `GET /reimbursement/batch/proposals`
- `groupBatchProposals` 输入增加 `invoice_title_entity_id: number | null`，分组键为
  `applicant_userid + project_id + (invoice_title_entity_id ?? 'none')`；排序：被报销人、项目、
  主体 id（未识别排最后）。
- 组返回 `invoice_title_entity_id`、`invoice_title_name`（取组内第一条）；信封返回同两字段。

### 7.3 `POST /reimbursement/batch`
- 请求体新增 `mixed_title_reason?: string`。
- 选中信封确定后调用 `summarizeBatchTitles`：
  - `mixed` 且理由无效 → 400
    `{ success:false, error:{ code:'MIXED_INVOICE_TITLE', message:'所选报销条目发票抬头不一致，需填写混批理由', title_counts:[...] } }`。
  - `mixed` 且理由有效 → 放行，批次 `invoice_title_entity_id=NULL`、`mixed_title_reason=理由`。
  - `uniform` → 批次 `invoice_title_entity_id=entityId`，`mixed_title_reason=NULL`。
  - `unknown` → 两列 NULL，不要求理由。
- 现有审计 `reimbursement.batch.create` 的 detail 增加
  `invoice_title: { kind, entity_id, counts, mixed_title_reason }`。
- 不在服务端自动设置 `payment_entity_id`（预填由前端完成，保持「付款实体可在审批时补充」语义）。

### 7.4 `POST /batch/:id/submit-approval` 冻结的 `route_context`
`batch` 增加 `invoice_title_entity_id`、`mixed_title_reason`；`items[*]` 增加
`invoice_title_entity_id`、`invoice_title_name`。

### 7.5 `GET /reimbursement/batch/:id`
返回 `invoice_title_entity: { id, entity_code, entity_name } | null`（与 `payment_entity` 同形）、
`mixed_title_reason`；条目携带三列。`PUT /batch/:id/payout-plan`、`POST /batch/:id/mark-paid`
不新增校验。

## 8. AI 关卡上下文（services/ai-slot.ts）
`reimbursement_batch` 的 `items` 查询增加 `invoice_title_entity_id`、`invoice_title_name`，
冻结的 `route_context.batch` 已带 `invoice_title_entity_id`/`mixed_title_reason`；ai-slot 另以独立键 `reimbursement_batch_title`（含 `invoice_title_entity_name`）实时读取，避免浅合并覆盖 `batch` 键。不改提示词，
不改评分白名单。

## 9. Web 页面

`src/api/reimbursement.ts`：`ReimbursementEnvelope`/`ReimbursementBatch`/建议/详情类型加字段；
`listReimbursementBatchCandidates` 参数加 `invoice_title_entity_id?: number | "none"`；
`createReimbursementBatch` 加 `mixed_title_reason?`。`reimbursement-labels.ts` 加
`invoiceTitleSourceLabel`（ocr→OCR识别、manual→手工指定、空→未识别）。

页面：
- `finance/reimbursement/batch.vue`
  - 表单区新增「发票抬头」下拉：各 active 主体 + 「未识别」；变化时自动重查候选。
  - 候选表新增「发票抬头」列：有主体显示主体名；仅有原文显示原文 + 灰色「未匹配」标签；
    两者皆无显示「未识别」。
  - 勾选变化时计算 `summarizeBatchTitles`（前端复刻同一规则，抽成 `reimbursement-title.ts`
    纯函数并带 vitest）。
  - 创建前：`uniform` 且付款实体为空 → 自动设置付款实体为该主体并触发账户加载，
    提示「已按发票抬头预填付款实体」；`mixed` → `ElMessageBox.prompt` 要求填写理由
    （2–200 字），取消则中止；服务端返回 `MIXED_INVOICE_TITLE`（并发导致）→ 再弹一次并重试一次。
  - 「自动勾选可送审」：设了抬头筛选时只勾该抬头；未设时维持现状，若结果为 `mixed` 给出提示。
- `finance/reimbursement/detail.vue`：基础信息展示抬头（主体名或原文）+ 来源标签；
  编辑表单加「发票抬头」主体下拉（仅办公室角色可见可改，含「清除」）。
- `finance/reimbursement/batch-detail.vue`：描述项「发票抬头主体」与「混批理由」；
  付款实体 ≠ 抬头主体时红色标签；二次编辑保存前 `ElMessageBox.confirm`。
- `approval/detail.vue`（报销批次支付方案）：显示抬头主体，付款实体不一致标红，
  保存支付方案前二次确认。
- `finance/reimbursement/payout.vue`（集中打款台）：登记表单显示批次抬头主体，
  不一致标红并在 `markBatchPaid` 前二次确认。
- `finance/reimbursement/office-workbench.vue`「待成批」tab 加抬头列。
- `components/AiBatchProposalsDrawer.vue`：每组显示抬头主体/未识别。

## 10. 小程序
v1 不改。审批页支付方案选择（`pages/approval-detail`）的不一致提示与下次提审合并。

## 11. 错误处理与校验
- 所有新参数在路由入口校验：`invoice_title_entity_id` 必须为正整数或 `none`；
  `mixed_title_reason` 长度 2–200；无效返回 400 带中文 message。
- OCR 抬头写入失败不影响主流程（与现有折叠逻辑同一事务语句内，随其成功/失败）。
- 前端对 `MIXED_INVOICE_TITLE` 单独处理；其余错误沿用现有 message 展示。

## 12. 测试
- API（vitest）：
  - `reimbursement-invoice-title-policy.test.ts`：归一化（空白/括号）、唯一命中、多命中不写、
    非 active 不命中、manual 保护、全完成无抬头清空、进行中不动。
  - `reimbursement-batch-title-policy.test.ts`：uniform/unknown/mixed/empty 判定、
    已识别+未识别算 mixed、理由长度校验。
  - `reimbursement-batch-proposal-policy.test.ts`：分组键含抬头、排序。
  - 候选路由过滤 SQL 形状测试（沿用 workbench-summary 的 fake D1 写法）。
  - `POST /batch` mixed 无理由 → 400 `MIXED_INVOICE_TITLE`（沿用 tx-hardening 的 fake D1 写法）。
- Web（vitest）：`reimbursement-title.ts` 汇总与标签纯函数。
- 手工冒烟：本地起 api+web，按项目 144 / 鹿树明 查候选，验证筛选、列、预填与混批弹窗。

## 13. 上线顺序与回滚
1. `cd packages/api && npx wrangler d1 migrations apply hybcdg-prod-db --remote`（含回填），
   用 SQL 核对：带原文信封数、匹配主体数（2026-09-12 生产只读预览：约 88 个信封带原文、约 63 个唯一匹配；按最新识别轮口径）。
2. push main 自动部署 api/web；验证 `/api/v1/system/health`。
3. 回滚：代码 revert 即可；新增列为附加列，保留无害。

## 14. 验收标准
- 信封 237 抬头=北京鑫丰畅建设有限公司（entity 11，来源 OCR），241=廊坊市丰畅市政工程有限公司（entity 6）。
- 成批页筛选「北京鑫丰畅」后候选只剩抬头为 11 的信封；勾选 237+241 创建时弹出理由输入框，
  不填无法创建；填了理由创建成功，批次抬头为空、理由入库并可在批次详情看到。
- 只勾 237 创建时付款实体自动预填为北京鑫丰畅；审批页把付款实体改为其他主体时标红并二次确认。
- 办公室在信封详情把某未识别信封抬头手工指定后，候选筛选立刻按新值生效，且后续 OCR 同步不覆盖。
