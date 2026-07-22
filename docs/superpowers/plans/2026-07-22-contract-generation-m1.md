# AI 合同起草 M1 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 AI 合同起草 M1：草稿数据模型 + 双立场条款库 + cf_ai（`env.AI` 直调）执行器 + contract-draft API + web 端逐节生成流水线页（生成/编辑/双色高亮/遗漏提示），本地 mock 全流程可跑通。

**Architecture:** 复用 AI Slot（createTask→task_queue）异步抽象，新 provider `cf_ai` 的任务由 Worker 自身执行（路由 waitUntil 即时触发 + Queue TASK_CREATED 事件 + cron 兜底扫描，三路都经原子抢占保证幂等）；结果经 completeTask 业务分支回写草稿节。前端照 bidding/dedup 范式：api wrapper + 纯函数 lib + Deps 注入 composable + 组件分层。

**Tech Stack:** Hono + D1 + Cloudflare AI binding（Unified Billing 第三方模型）+ Vue3/PureAdmin/Element Plus + vitest。

**依赖的既定决策（不再讨论，见 docs/superpowers/specs/2026-07-22-contract-generation-design.md）：** 模型 `openai/gpt-5.6-terra` 与 `anthropic/claude-sonnet-5` 均衡交替、critic 异厂商、sol 注册停用；section 全可选装、AI 只提示不阻塞；条款库脱敏。

---

## 前置须知（执行者必读）

- 包管理器是 **pnpm**（`npx only-allow pnpm`）。改依赖必须提交 `pnpm-lock.yaml`。本计划**不新增任何依赖**。
- 如在 `.claude/worktrees/` 下执行：worktree 没有 node_modules，先做符号链接：
  ```bash
  ln -s "$(git rev-parse --path-format=absolute --git-common-dir)/../packages/web/node_modules" packages/web/node_modules 2>/dev/null || true
  ln -s "$(git rev-parse --path-format=absolute --git-common-dir)/../packages/api/node_modules" packages/api/node_modules 2>/dev/null || true
  ```
- 禁 `as any` / `@ts-ignore`；时间一律 ISO 8601 TEXT；软删除；金额大写后端生成。
- 生产 D1 **无事务回滚**：多步写全部按"闸门前置 + 条件 UPDATE 抢占 + 显式补偿"写，本计划代码已按此设计，不要"优化"成事务。
- push main 即自动部署。**本计划所有 commit 均为本地提交，不 push**；生产 D1 迁移（`npx wrangler d1 migrations apply hybcdg-prod-db --remote`）属发布动作，不在 M1 执行范围。
- commit 信息格式 `<type>: <描述>`，**不加任何 AI 署名 trailer**。

## 文件结构（本计划新建/修改的全部文件）

```
packages/api/
  migrations/0062_contract_draft.sql                  # 新建：4 张草稿域表
  migrations/0063_contract_clause_seed.sql            # 新建：双立场条款库 seed（脱敏）
  migrations/0064_contract_draft_ai_seed.sql          # 新建：cf_ai provider + 3 提示词 + 3 路由规则
  wrangler.toml                                       # 修改：[ai] binding（顶层 + env.prod 双段）
  src/types/env.ts                                    # 修改：Env.AI
  src/types/ai.ts                                     # 修改：3 个 task_type + cf_ai provider key
  src/types/contract-draft.ts                         # 新建：草稿域类型
  src/services/contract-draft-rules.ts                # 新建：合规规则校验纯函数 + 输出解析
  src/services/cf-ai.ts                               # 新建：cf_ai 执行器（env.AI 调用/模型交替/mock）
  src/services/ai-slot.ts                             # 修改：completeTask/failTask 回写分支
  src/queue-handler.ts                                # 修改：TASK_CREATED case
  src/scheduled.ts                                    # 修改：cron 兜底扫描
  src/routes/contract-draft.ts                        # 新建：草稿 API
  src/index.ts                                        # 修改：注册路由
  test/contract-draft-rules.test.ts                   # 新建
  test/cf-ai-models.test.ts                           # 新建
packages/web/src/
  api/contract-draft.ts                               # 新建：API wrapper
  views/finance/contract/draft/
    draft-labels.ts                                   # 新建：状态标签映射
    lib/segments.ts                                   # 新建：占位符/风险双色分段纯函数
    lib/__tests__/segments.test.ts                    # 新建
    composables/useContractDraftAI.ts                 # 新建：逐节生成轮询
    composables/__tests__/useContractDraftAI.test.ts  # 新建
    components/DraftInitCard.vue                      # 新建：创建草稿表单
    components/SectionListPanel.vue                   # 新建：左侧节列表
    components/SectionCard.vue                        # 新建：单节卡片（生成/编辑/高亮）
    components/CompletenessDialog.vue                 # 新建：遗漏提示
    index.vue                                         # 新建：流水线页
  views/finance/contract/index.vue                    # 修改：入口按钮
  router/modules/finance.ts                           # 修改：路由
doc/开发计划.md、doc/UI设计文档.md、doc/开发记录.md      # 修改：文档同步（Task 16）
```

---

### Task 1: 迁移 0062 — 草稿域四张表

**Files:**
- Create: `packages/api/migrations/0062_contract_draft.sql`

- [ ] **Step 1: 确认迁移编号未被占用**

```bash
ls packages/api/migrations/ | sort | tail -3
```
Expected: 最大编号为 `0061_agent_pending_target_task.sql`。若已出现 0062+，本计划三个迁移编号整体顺延并同步改后文所有引用。

- [ ] **Step 2: 写迁移文件**

```sql
-- 0062_contract_draft.sql
-- AI 合同起草：草稿主表 / 节表 / 条款库 / 版本快照。
-- direction: inbound=我方为乙方(对甲方收款合同), outbound=我方为甲方(对分包商付款合同)。

CREATE TABLE IF NOT EXISTS contract_draft (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  direction TEXT NOT NULL,                -- inbound | outbound
  project_id INTEGER,
  entity_id INTEGER,                      -- 我方签约主体 entity.id
  counterparty_name TEXT NOT NULL DEFAULT '',
  counterparty_credit_code TEXT,
  counterparty_legal_person TEXT,
  counterparty_address TEXT,
  counterparty_contact TEXT,
  counterparty_phone TEXT,
  counterparty_bank_name TEXT,
  counterparty_bank_account TEXT,
  keywords_json TEXT NOT NULL DEFAULT '{}',   -- 占位符键值 {project_name, amount, sign_date, ...}
  status TEXT NOT NULL DEFAULT 'drafting',    -- drafting | finalized(M2) | converted(M2) | deleted
  completeness_status TEXT,                    -- NULL | generating | done | error
  completeness_task_id INTEGER,
  completeness_result_json TEXT,
  ignored_hints_json TEXT NOT NULL DEFAULT '[]', -- 用户忽略的遗漏提示 section_key 数组（留痕）
  converted_contract_id INTEGER,
  created_by_userid TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_contract_draft_created_by ON contract_draft(created_by_userid);
CREATE INDEX IF NOT EXISTS idx_contract_draft_status ON contract_draft(status);

CREATE TABLE IF NOT EXISTS contract_draft_section (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  draft_id INTEGER NOT NULL,
  section_key TEXT NOT NULL,
  title TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'default_template', -- default_template | ai_generated | manual
  instruction TEXT,                                -- 个性化指令（≤500 字，API 层校验）
  content TEXT NOT NULL DEFAULT '',
  risk_annotations_json TEXT,                      -- [{text,level,reason,legal_basis,source}]
  ai_task_id INTEGER,
  ai_status TEXT,                                  -- NULL | generating | done | error
  review_task_id INTEGER,
  review_status TEXT,                              -- NULL | generating | done | error
  review_result_json TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',           -- active | deleted
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (draft_id) REFERENCES contract_draft(id)
);
CREATE INDEX IF NOT EXISTS idx_contract_draft_section_draft ON contract_draft_section(draft_id);
CREATE INDEX IF NOT EXISTS idx_contract_draft_section_ai_task ON contract_draft_section(ai_task_id);
CREATE INDEX IF NOT EXISTS idx_contract_draft_section_review_task ON contract_draft_section(review_task_id);

CREATE TABLE IF NOT EXISTS contract_clause_template (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  section_key TEXT NOT NULL,
  direction TEXT NOT NULL,                 -- inbound | outbound | both
  required_level TEXT NOT NULL,            -- core | recommended | optional
  title TEXT NOT NULL,
  body_template TEXT NOT NULL,             -- 含 {{占位符}} 的骨架文案（已脱敏）
  style_ref TEXT,                          -- 范本风格参考段（已脱敏），可空
  risk_notes TEXT,                         -- 给使用者/AI 的立场与风险注记
  sort_order INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(section_key, direction)
);
CREATE INDEX IF NOT EXISTS idx_contract_clause_template_direction ON contract_clause_template(direction);

CREATE TABLE IF NOT EXISTS contract_draft_revision (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  draft_id INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,             -- {draft, sections} 全量快照
  trigger_action TEXT NOT NULL,            -- regenerate | manual_edit | finalize
  created_by_userid TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (draft_id) REFERENCES contract_draft(id)
);
CREATE INDEX IF NOT EXISTS idx_contract_draft_revision_draft ON contract_draft_revision(draft_id);
```

- [ ] **Step 3: 本地应用并验证**

```bash
cd packages/api && pnpm db:migrate:local
npx wrangler d1 execute hybcdg-prod-db --local --command "SELECT name FROM sqlite_master WHERE name LIKE 'contract_draft%' OR name='contract_clause_template'"
```
Expected: 迁移应用成功；返回 4 个表名。

- [ ] **Step 4: 编号守卫测试**

```bash
cd packages/api && pnpm test -- test/migrations-unique.test.ts
```
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/api/migrations/0062_contract_draft.sql
git commit -m "feat(api): 合同起草草稿域四张表迁移"
```

---

### Task 2: 迁移 0063 — 双立场条款库 seed（脱敏）

**Files:**
- Create: `packages/api/migrations/0063_contract_clause_seed.sql`

说明：`direction='both'` 为立场中性节；stance 敏感节各写 inbound/outbound 两行。文本源自两份范本骨架 + 设计文档补充节，已脱敏（无真实单位/账号/证件号）。`INSERT OR IGNORE` + `UNIQUE(section_key, direction)` 保证幂等。

- [ ] **Step 1: 写迁移文件（全量 seed）**

```sql
-- 0063_contract_clause_seed.sql — 顶管施工协议条款库（inbound=我方乙方 / outbound=我方甲方）
INSERT OR IGNORE INTO contract_clause_template
  (section_key, direction, required_level, title, body_template, style_ref, risk_notes, sort_order, version, status, created_at, updated_at)
VALUES
-- ─── 立场中性（both） ───
('parties_basis','both','core','首部与签约依据',
 '甲方（发包方）：{{party_a}}，统一社会信用代码：{{party_a_credit_code}}。
乙方（承包方）：{{party_b}}，统一社会信用代码：{{party_b_credit_code}}。
根据《中华人民共和国民法典》及相关法律法规，甲乙双方在平等自愿、协商一致的基础上，就{{project_name}}顶管施工事宜订立本协议，共同遵守。涉及营业线铁路施工的，同时遵守《中华人民共和国铁路法》《铁路运输安全保护条例》及铁路管理单位的施工安全管理规定。',
 '根据《中华人民共和国民法典》和相关法律法规等规定，为明确双方在工程承包中的权利、义务和责任，确保工程任务的全面完成，在自愿、平等、互利的原则下，经甲乙双方协商同意签订本协议。',
 '法律引用只允许现行有效法律；范本一曾引用已废止的《合同法》，属校验规则拦截项。',10,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('project_overview','both','core','工程概况',
 '（一）工程名称：{{project_name}}。（二）工程地点：{{location}}。（三）施工内容：{{pipe_spec}}管道土压平衡顶进施工，顶进长度约{{length}}米，完工后按实际贯通长度据实结算。（四）施工工艺与技术要求：按施工图纸、地勘报告及经批准的施工方案执行。',
 '施工内容: D1800*2000*180 钢承口混凝土管道土压平衡顶进施工、长度 88 米',
 '顶管专业参数（管径×节长×壁厚、顶进长度、工艺）必须明确，避免"按实际情况"类含糊表述。',20,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('quantity_pricing','both','core','工程量与计价',
 '本工程综合单价为人民币{{unit_price}}元/米（含{{tax_rate}}%税金），顶进长度{{length}}米，暂定总价人民币{{amount}}元（大写：{{amount_cn}}）。最终结算价 = 双方现场签认的实际贯通长度 × 综合单价。除双方书面签认的变更外，综合单价包干使用。',
 '顶管施工综合单价：按约定单价（含9%税金），总金额 = 长度 × 单价，总价另附人民币大写。',
 '大写金额由系统后端生成填入 {{amount_cn}}，AI 不得自行推算大写。',40,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('duration','both','core','工程期限',
 '开工日期：{{start_date}}；竣工日期：{{end_date}}。因非责任方原因（发包方未按约提供施工条件、设计变更、不可抗力等）停工的，工期相应顺延，顺延天数以双方签认的工程联系单为准。',
 NULL,
 '校验规则：竣工日期不得早于开工日期（范本一曾出现工期倒挂笔误）。',50,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('invoice_tax','both','recommended','发票与税务',
 '乙方向甲方提供税率为{{tax_rate}}%的增值税{{invoice_type}}发票，发票品目与本协议施工内容（建筑服务）一致，备注栏注明工程名称、建筑服务发生地及本协议编号。发票仅向本协议甲方开具；甲方付款仅支付至乙方本协议载明的对公账户。',
 NULL,
 '三流一致硬约束：范本一约定向第三方直接开票（虚开风险）、范本二以1%机械租赁发票开建筑服务（品目错配），均属校验规则拦截项。',80,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('civilized_construction','both','optional','文明施工',
 '乙方按甲方现场整体规划组织文明施工，作业垃圾运至指定地点，做到工完场清；加强现场与住宿区域管理，不得违章作业、野蛮施工。甲方为文明施工提供必要的场地与设施条件。',
 NULL,NULL,100,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('force_majeure','both','recommended','不可抗力与工期顺延',
 '因不可抗力不能履行本协议的，根据影响程度部分或全部免除责任。遭遇不可抗力的一方应及时通知对方，并在合理期限内提供证明。不可抗力造成的损失由双方各自承担，工期相应顺延；停工期间必要的现场看护费用由{{fm_guard_cost_bearer}}承担。',
 NULL,'两份范本均缺失本节，属遗漏提示重点。',160,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('handover_protection','both','optional','成品保护与移交',
 '管道贯通并经检验后，乙方向甲方办理书面移交，移交后成品保护责任由甲方承担；移交前因乙方原因造成的损坏由乙方负责修复并承担费用。',
 NULL,NULL,180,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('insurance','both','optional','保险',
 '乙方为其进场施工人员投保工伤保险或建筑施工人员团体意外伤害保险并承担保费。工程一切险的投保安排：{{insurance_arrangement}}。',
 NULL,NULL,190,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('dispute','both','core','争议解决',
 '因本协议发生的争议，双方应友好协商解决；协商不成的，任何一方均有权向{{dispute_venue}}人民法院提起诉讼。',
 '因履行本合同发生的一切争议，由当事人双方协商或调解解决，协商或调解不成，依法向人民法院提起诉讼。',
 'inbound 立场建议 {{dispute_venue}} 填我方所在地（避免范本一"工程所在地"的客场条款）；outbound 立场同理填我方所在地。',200,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('misc_effective','both','core','其他与生效',
 '本协议自双方盖章并经法定代表人或授权代理人签字之日起生效。未尽事宜双方另行签订补充协议，补充协议与本协议具有同等效力。本协议一式{{copies}}份，甲方执{{party_a_copies}}份，乙方执{{party_b_copies}}份，扫描件、传真件与原件具有同等效力。',
 '本合同一式四份，甲方执二份，乙方执二份，扫描传真文件也同样有效。',NULL,210,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('signature_block','both','core','落款',
 '甲方（盖章）：{{party_a}}
法定代表人/委托代理人：{{party_a_legal_person}}
地址：{{party_a_address}}
统一社会信用代码：{{party_a_credit_code}}
开户银行：{{party_a_bank_name}}
账号：{{party_a_bank_account}}
联系电话：{{party_a_phone}}
签约日期：{{sign_date}}

乙方（盖章）：{{party_b}}
法定代表人/委托代理人：{{party_b_legal_person}}
地址：{{party_b_address}}
统一社会信用代码：{{party_b_credit_code}}
开户银行：{{party_b_bank_name}}
账号：{{party_b_bank_account}}
联系电话：{{party_b_phone}}
签约日期：{{sign_date}}',
 NULL,'个人证件号码一律不进正文（范本一曾固化收款代理人身份证号，属拦截项）。',220,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

-- ─── inbound（我方=乙方/承包人） ───
('scope_interface','inbound','core','承包方式与工作界面',
 '甲方提供：施工手续、施工图纸、地勘报告、地下物探资料、安全及技术交底、顶进工作坑与接收坑（含后背墙、安全爬梯、防护及防水防洪措施）、合格管材及接口配件并卸管至工作坑施工范围、施工用水用电、土方外弃、进出场道路畅通。乙方提供：顶管设备及辅助设备、起重设备、施工人员、减阻材料、管道内土方运输至地面。双方工作界面交接以书面签认为准。',
 '甲方提供施工图纸、地勘报告、顶进工作坑、接收坑、满足施工要求合格的管材、施工用水用电、土方外弃；乙方提供顶管设备、起重设备、施工人员、减阻材料。',
 'inbound 立场：甲供清单越明确越好，甲供不到位即触发停窝工与顺延条款。',30,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('quality_acceptance','inbound','core','工程质量与验收',
 '工程质量标准：合格，按国家现行施工及验收规范执行。管道贯通后，乙方书面提请验收，甲方应在{{acceptance_days}}日内组织竣工验收并出具验收单；甲方逾期不组织验收的，视为本工程质量合格，自乙方提请验收之日起满{{acceptance_days}}日即为验收合格之日。',
 '验收时间：管道贯通后2日内组织竣工验收，逾期不组织竣工验收，则视为本工程质量全部合格。',
 '"逾期视为合格"是范本中对乙方有利的成熟条款，inbound 保留。',60,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('payment','inbound','core','价款结算与支付',
 '（一）设备安装完毕具备顶进条件后{{advance_days}}日内，甲方支付乙方启动款人民币{{advance_amount}}元；（二）施工期间每月{{measure_day}}日双方计量，甲方于次月{{monthly_pay_day}}日前支付当月已完工程量的{{progress_ratio}}%；（三）竣工验收合格后{{settle_days}}日内双方完成结算，甲方付至结算总价的{{settle_ratio}}%；（四）剩余尾款甲方于{{final_pay_date}}前一次性付清。甲方逾期付款的，每逾期一日按未付金额的{{late_fee_rate}}向乙方支付违约金，并不影响乙方主张停止施工及实际损失。',
 '本工程无预付款，设备安装完毕具备顶进条件支付10万元，计量款每月22号计量，次月15日前支付完成量的60%工程款，尾款分节点付清。',
 'inbound 立场核心条款：付款节点必须为确定日期/期限，逾期违约金费率建议不超过日万分之五（范本"日千分之三"有被调减风险，规则层黄标）。',70,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('safety','inbound','core','安全施工',
 '（一）甲方不得要求乙方违反安全管理规定施工；因甲方提供的资料、场地、设施缺陷或甲方指令原因导致的安全事故，由甲方承担相应责任及费用。（二）乙方遵守工程建设安全生产管理规定，按安全标准组织施工，落实安全教育、分项交底与防护措施，随时接受依法实施的监督检查；因乙方安全措施不力造成事故的责任和费用由乙方承担。（三）双方现场人员执行"自控、互控、他控"保安措施，保障施工人身与设备安全。',
 '甲方不得要求乙方违反安全管理的规定进行施工。因甲方原因导致的安全事故，由甲方承担相应责任及发生的费用。',
 NULL,90,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('party_a_duties','inbound','core','甲方责任与义务',
 '甲方应：（一）按约提供工作界面条款所列全部施工条件，并保证资料真实、完整、及时；（二）对顶管轴线和高程进行复测确认；（三）根据工程进度保证管材等甲供材料供应；因甲方管材供应不足、场地或手续原因造成乙方停窝工的，人员窝工与机械停滞费用由甲方承担；（四）按本协议约定及时足额支付工程款。',
 '根据工程进度确保所需材料，由于管材供应不足原因造成乙方的人员费用、机械租赁费用由甲方承担。',
 NULL,110,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('party_b_duties','inbound','core','乙方责任与义务',
 '乙方应：（一）按甲方通知及时组织人员设备进场，进场前派技术人员完成开工准备；（二）严格按施工图纸、操作规程、施工规范与验收标准施工并做好记录；（三）主动配合甲方阶段性质量安全检查与验收；（四）对施工人员进行安全生产、消防、社会治安教育；（五）妥善保护成品半成品，爱护使用甲方设施。',
 '在本合同生效后，乙方应派技术人员到现场做好开工前的准备工作；严格按照施工图纸操作规程、施工规范、验收标准等施工。',
 NULL,120,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('breach','inbound','core','违约责任',
 '任何一方违约给对方造成损失的，应承担赔偿责任。甲方逾期付款按价款结算条款承担违约金；甲方逾期提供施工条件致乙方无法施工累计超过{{max_idle_days}}日的，乙方有权书面解除本协议，甲方应结算已完工程量并承担乙方进出场费用。约定违约金不足以弥补守约方实际损失的，守约方有权就不足部分继续主张。',
 NULL,
 '违约金畸高（明显超过损失30%）有被民法典第585条调减的风险，生成时黄标提示。',130,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('geology_risk','inbound','recommended','地质条件与地下障碍物风险',
 '甲方提供的地勘、物探资料是乙方施工的依据。施工中遇地下障碍物、土质与地勘资料严重不符、地下水异常等非乙方原因的地质风险，乙方应及时通知甲方并采取合理措施防止损失扩大；由此增加的费用（含障碍物处理、工艺调整、停窝工损失）由甲方承担，工期相应顺延，双方以工程联系单据实签认。',
 NULL,
 '顶管行业最大风险点，两份范本均未约定，inbound 必须争取归甲方。',140,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('claim_visa','inbound','recommended','签证与索赔',
 '发生设计变更、施工条件变化或甲方指令增加工作内容的，乙方应于事件发生后{{visa_days}}日内向甲方提交签证或索赔资料，甲方应在收到后{{visa_reply_days}}日内书面答复；逾期不答复的，视为认可乙方提交的签证内容。经签认的签证费用随最近一期进度款一并支付。',
 NULL,
 '"逾期视为认可"对乙方关键；时限自身也要可完成（建议 7/14 日）。',150,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('idle_compensation','inbound','optional','停窝工补偿',
 '因甲方原因（含管材供应不足、工作坑不具备条件、手续未办妥、场地道路不通）造成乙方停窝工的，人员窝工费按{{idle_labor_fee}}元/人·日、设备停滞费按{{idle_machine_fee}}元/台班计，经双方现场签认后随进度款支付。',
 NULL,NULL,170,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

-- ─── outbound（我方=甲方/发包人，对分包商） ───
('scope_interface','outbound','core','承包方式与工作界面',
 '甲方提供：施工图纸及技术交底、{{party_a_supplies}}。乙方（分包商）提供：{{party_b_supplies}}，并对其提供的人员、设备、材料的合规性与适用性负责。乙方进场前应对甲方提供的施工条件进行核对并书面确认；双方工作界面交接以书面签认为准。',
 NULL,
 'outbound 立场：乙供清单及其合规责任要写实，甲供最小化并以书面签认为界。',30,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('quality_acceptance','outbound','core','工程质量与验收',
 '工程质量标准：合格，按国家现行施工及验收规范执行。乙方完工后书面提请验收，甲方在{{acceptance_days}}日内组织验收；验收不合格的，乙方应按甲方要求限期返工整改，费用由乙方承担，工期不予顺延；返工后仍不合格的，甲方有权另行委托第三方处理，费用自应付乙方款项中扣除。',
 NULL,
 'outbound 不写"逾期视为合格"（该条款只对承包方有利）。',60,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('payment','outbound','core','价款结算与支付',
 '（一）施工期间每月{{measure_day}}日双方计量，甲方于次月{{monthly_pay_day}}日前支付当月已完合格工程量的{{progress_ratio}}%；（二）竣工验收合格且乙方提交完整结算资料、合规发票及农民工工资支付凭证后{{settle_days}}日内，甲方付至结算总价的{{settle_ratio}}%；（三）预留质量保证金为结算总价的{{warranty_ratio}}%（不超过3%），缺陷责任期{{warranty_months}}个月届满且无质量问题后{{warranty_refund_days}}日内无息退还。',
 NULL,
 '合规红线：不得以"业主/上游付款"作为向分包商付款的前提（背靠背条款，最高法2024批复对中小企业无效）；付款期限必须独立确定。质保金不超过结算总额3%。',70,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('safety','outbound','core','安全施工',
 '（一）乙方在其分包范围内对施工安全负直接管理责任，遵守安全生产法律法规及标准规范，落实安全教育、分项交底、劳保穿戴与防护措施，并如实做好记录。（二）甲方依法对施工现场实施统一协调与监督检查，乙方应接受检查并按期完成整改；危及安全时甲方有权责令停工，乙方不得拒绝。（三）双方现场人员执行"自控、互控、他控"保安措施。',
 '乙方施工前应按甲方书面施工组织、安全措施、技术交底进行安装，并经甲方核准后方可顶进施工；顶管作业人员严格劳保穿戴。',
 NULL,90,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('safety_transfer','outbound','core','安全责任承担与追偿',
 '因乙方违章作业、防护缺失或管理不善造成的安全事故，其损失及对第三方的赔偿责任由乙方最终承担；甲方依法先行承担或垫付的，有权向乙方全额追偿，并有权自应付乙方款项中等额扣除。本条不免除甲方依法应承担的统一协调管理义务。',
 NULL,
 '合法传导写法：不写"安全责任全部由乙方承担、与甲方无关"（法定责任不可约定转移，属拦截项），写"先行承担+内部追偿"。',92,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('farmer_wage','outbound','core','农民工工资支付',
 '乙方应依法落实农民工实名制管理与工资专用账户制度，按月足额支付农民工工资并留存支付凭证备查，按甲方要求定期报送。因乙方拖欠农民工工资导致甲方被责令代付或先行垫付的，甲方有权自应付乙方款项中等额扣除并向乙方追偿；由此产生的行政处罚及其他损失由乙方承担。',
 NULL,
 '《保障农民工工资支付条例》要求，outbound 必备节。',95,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('party_a_duties','outbound','core','甲方责任与义务',
 '甲方应：（一）提供施工图纸、技术资料并组织交底；（二）按约提供其承诺的施工条件；（三）对工程质量、进度、安全实施检查与监督；（四）按本协议约定支付经计量签认的工程款。',
 NULL,NULL,110,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('party_b_duties','outbound','core','乙方责任与义务',
 '乙方应：（一）按甲方通知及时组织具备相应资格的人员与合规设备进场；（二）严格按施工图纸、经甲方核准的施工组织方案、操作规程与验收标准施工，服从甲方现场统一管理；（三）不得将本协议工程转包或再分包；（四）对其施工人员进行安全生产教育并依法为其缴纳工伤保险或投保意外伤害保险；（五）妥善保护现场成品半成品及甲方设施，造成损坏的照价赔偿。',
 NULL,
 '禁止转包/再分包必须显性写入（建筑法第28-29条）。',120,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('breach','outbound','core','违约责任',
 '乙方逾期完工的，每逾期一日按协议总价的{{delay_penalty_rate}}向甲方支付违约金；乙方施工质量不合格拒不整改、擅自停工撤场累计超过{{abandon_days}}日的，甲方有权解除协议并要求乙方赔偿由此造成的损失（含甲方对上游承担的违约责任）。甲方无正当理由逾期支付经签认工程款的，每逾期一日按未付金额的{{late_fee_rate}}向乙方支付违约金。因乙方原因造成的一切损失，甲方有权自应付款项中抵扣，不足部分另行追偿。',
 NULL,
 '双向违约金要平衡设置，畸高会被调减；抵扣权是 outbound 立场关键。',130,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('geology_risk','outbound','recommended','地质条件核实义务',
 '乙方进场前应对甲方提供的地勘、物探资料及现场施工条件进行核对，并书面确认具备施工条件；乙方未尽核对义务即施工的，因可合理预见的地质情况增加的费用与工期由乙方承担。确因地勘资料无法预见的地下障碍物等重大异常，双方另行签认处理方案与费用分担。',
 NULL,
 'outbound 镜像：把核实义务放到分包商侧，但重大不可预见异常仍需双方签认（完全转嫁有失公平被判无效风险）。',140,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('claim_visa','outbound','recommended','签证与变更管理',
 '未经甲方书面签认的任何额外工作量、赶工或措施费用，甲方不予认可。乙方主张签证或索赔的，应于事件发生后{{visa_days}}日内提交完整资料，逾期视为放弃该项权利。甲方应在收到后{{visa_reply_days}}日内书面答复。',
 NULL,
 'outbound 镜像："逾期视为放弃"约束分包商；甲方答复期限仍需明确（完全不答复条款有格式条款风险）。',150,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('performance_bond','outbound','recommended','履约保证金',
 '乙方于进场前向甲方缴纳履约保证金人民币{{bond_amount}}元。乙方全面履行本协议且无违约情形的，甲方于竣工验收合格并结清后{{bond_refund_days}}日内无息退还；乙方违约的，甲方有权自保证金中扣除违约金及损失赔偿，不足部分另行追偿。',
 NULL,NULL,125,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('unilateral_termination','outbound','recommended','甲方单方解除权',
 '乙方有下列情形之一的，甲方有权书面通知解除本协议并要求乙方赔偿损失：（一）转包或违法再分包的；（二）施工质量不合格且拒不整改的；（三）擅自停工、撤场累计超过{{abandon_days}}日的；（四）发生较大及以上安全事故，或存在重大安全隐患拒不整改的；（五）拖欠农民工工资引发群体性事件的。协议解除后，已完合格工程量据实结算，乙方应在{{exit_days}}日内退场并移交现场。',
 NULL,NULL,137,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('counter_claim','outbound','optional','反索赔与损失抵扣',
 '因乙方原因造成工期延误、质量缺陷、安全事故或导致甲方对上游发包方承担违约责任的，甲方有权就实际损失向乙方主张赔偿，并有权自应付乙方的任何款项中予以抵扣；抵扣不足部分，甲方保留继续追偿的权利。',
 NULL,NULL,135,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'));
```

- [ ] **Step 2: 本地应用并验证行数与方向分布**

```bash
cd packages/api && pnpm db:migrate:local
npx wrangler d1 execute hybcdg-prod-db --local --command "SELECT direction, COUNT(*) AS n FROM contract_clause_template GROUP BY direction"
```
Expected: `both=12, inbound=10, outbound=14`（共 36 行）。

- [ ] **Step 3: Commit**

```bash
git add packages/api/migrations/0063_contract_clause_seed.sql
git commit -m "feat(api): 双立场顶管合同条款库seed（脱敏）"
```

---

### Task 3: 注册任务类型与 provider key

**Files:**
- Modify: `packages/api/src/types/ai.ts:3-27`（taskTypes 数组）、`:42-43`（providerKeys）
- Create: `packages/api/src/types/contract-draft.ts`

- [ ] **Step 1: taskTypes 数组末尾追加三个字面量**

在 `"bidding_dedup_rewrite"` 之后追加（保持 `] as const;` 不动）：

```ts
  "bidding_dedup_rewrite",
  "contract_draft_section",
  "contract_compliance_review",
  "contract_completeness_check"
] as const;
```

- [ ] **Step 2: providerKeys 追加 cf_ai**

```ts
export const providerKeys = ["claude", "openai", "local", "cf_ai"] as const;
```

- [ ] **Step 3: 新建草稿域类型文件 `src/types/contract-draft.ts`**

```ts
export const contractDraftStatuses = ["drafting", "finalized", "converted", "deleted"] as const;
export type ContractDraftStatus = (typeof contractDraftStatuses)[number];

export const draftDirections = ["inbound", "outbound"] as const;
export type DraftDirection = (typeof draftDirections)[number];

export const sectionAiStatuses = ["generating", "done", "error"] as const;
export type SectionAiStatus = (typeof sectionAiStatuses)[number];

export interface RiskAnnotation {
  text: string;
  level: "red" | "yellow";
  reason: string;
  legal_basis?: string;
  source: "ai" | "rule";
}

export interface ContractDraft {
  id: number;
  title: string;
  direction: DraftDirection;
  project_id: number | null;
  entity_id: number | null;
  counterparty_name: string;
  counterparty_credit_code: string | null;
  counterparty_legal_person: string | null;
  counterparty_address: string | null;
  counterparty_contact: string | null;
  counterparty_phone: string | null;
  counterparty_bank_name: string | null;
  counterparty_bank_account: string | null;
  keywords_json: string;
  status: ContractDraftStatus;
  completeness_status: string | null;
  completeness_task_id: number | null;
  completeness_result_json: string | null;
  ignored_hints_json: string;
  converted_contract_id: number | null;
  created_by_userid: string;
  created_at: string;
  updated_at: string;
}

export interface ContractDraftSection {
  id: number;
  draft_id: number;
  section_key: string;
  title: string;
  source: "default_template" | "ai_generated" | "manual";
  instruction: string | null;
  content: string;
  risk_annotations_json: string | null;
  ai_task_id: number | null;
  ai_status: SectionAiStatus | null;
  review_task_id: number | null;
  review_status: SectionAiStatus | null;
  review_result_json: string | null;
  sort_order: number;
  status: "active" | "deleted";
  created_at: string;
  updated_at: string;
}

export interface ContractClauseTemplate {
  id: number;
  section_key: string;
  direction: DraftDirection | "both";
  required_level: "core" | "recommended" | "optional";
  title: string;
  body_template: string;
  style_ref: string | null;
  risk_notes: string | null;
  sort_order: number;
  version: number;
  status: string;
  created_at: string;
  updated_at: string;
}
```

- [ ] **Step 4: typecheck**

```bash
cd packages/api && pnpm typecheck
```
Expected: PASS（此时尚无引用方，仅验证类型文件自身合法）。

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/types/ai.ts packages/api/src/types/contract-draft.ts
git commit -m "feat(api): 注册合同起草任务类型与cf_ai provider及草稿域类型"
```

---

### Task 4: 迁移 0064 — cf_ai provider + 提示词 + 路由规则 seed

**Files:**
- Create: `packages/api/migrations/0064_contract_draft_ai_seed.sql`

要点：`ai_provider_config` 回落解析是 `priority ASC`（数值小者优先）——cf_ai 必须给**大数值**（90），避免成为其他未配路由任务的全局回落 provider。三条路由规则显式绑定 biz_type='contract_draft'。sol 模型写入 config_json 的 disabled_models，代码不读取即为停用。

- [ ] **Step 1: 写迁移文件**

```sql
-- 0064_contract_draft_ai_seed.sql — cf_ai provider（Worker 内 env.AI 直调）+ 合同起草三件套提示词与路由
INSERT INTO ai_provider_config
  (provider_key, provider_name, api_endpoint, model_id, config_json, priority, max_concurrent, status, created_at, updated_at)
SELECT
  'cf_ai', 'Cloudflare AI (Unified Billing)', NULL, 'openai/gpt-5.6-terra',
  '{"models":["openai/gpt-5.6-terra","anthropic/claude-sonnet-5"],"disabled_models":["openai/gpt-5.6-sol"],"critic_cross":true}',
  90, 5, 'active',
  strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE NOT EXISTS (SELECT 1 FROM ai_provider_config WHERE provider_key = 'cf_ai');

INSERT INTO ai_prompt_template
  (template_key, template_name, system_prompt, user_prompt_template, variables_schema, version, status, created_at, updated_at)
VALUES (
  'prompt-contract-draft-section-v1',
  '合同起草-单节生成',
  '你是恒越百川建设集团的建设工程合同起草助手，专注顶管施工领域。你起草的是合同草稿中的单个条款节，必须以我方立场行文：direction=inbound 时我方是乙方（承包人），条款须明确、可执行、避免含糊表述，充分保护承包人的计价、付款、签证索赔与工期顺延权利；direction=outbound 时我方是甲方（发包人），在合法边界内合理传导责任、明确分包商义务。硬性合规红线：只允许引用现行有效的法律法规（严禁引用已废止的《中华人民共和国合同法》）；不得生成以下无效或违法条款：免除人身损害责任或免除故意及重大过失责任的免责条款（民法典第506条）、以第三方付款为付款前提的背靠背条款、转包或违法再分包安排、超过结算总额3%的质量保证金、将安全生产法定责任约定转移给他方的条款；不得编造身份证号、银行账号等具体个人敏感信息，一律使用{{xxx}}占位符；正文中已有的{{xxx}}占位符必须原样保留。你必须只输出一个JSON对象（禁止markdown代码块），字段：content（该节完整正文，string）、risk_spans（数组，每项{"text":"必须是content中逐字出现的片段","level":"red或yellow","reason":"风险说明","legal_basis":"法条依据，可空字符串"}）。对我方存在风险、让步或可能被认定无效的表述，逐条列入risk_spans。',
  '合同方向={{direction}}。节标识={{section_key}}，节标题={{section_title}}。默认条款骨架：{{body_template}}。范本风格参考（仅借鉴语言风格，不得照抄其中不合规内容；可能为空）：{{style_ref}}。工程关键信息JSON：{{keywords_json}}。使用者补充指令（可能为空）：{{instruction}}。请基于骨架起草该节完整正文：补充指令与骨架冲突时以补充指令为准，但不得突破系统合规红线。',
  '{"direction":"string","section_key":"string","section_title":"string","body_template":"string","style_ref":"string","keywords_json":"string","instruction":"string"}',
  1, 'active', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
)
ON CONFLICT(template_key) DO UPDATE SET
  template_name = excluded.template_name,
  system_prompt = excluded.system_prompt,
  user_prompt_template = excluded.user_prompt_template,
  variables_schema = excluded.variables_schema,
  version = excluded.version,
  status = 'active',
  updated_at = excluded.updated_at;

INSERT INTO ai_prompt_template
  (template_key, template_name, system_prompt, user_prompt_template, variables_schema, version, status, created_at, updated_at)
VALUES (
  'prompt-contract-compliance-review-v1',
  '合同起草-合规交叉审查',
  '你是建设工程合同合规审查助手，以《中华人民共和国民法典》为基准。你收到一节由另一个模型起草的合同条款，请以挑错立场独立审查：（1）无效条款：民法典第506条免责条款、第496-497条格式条款问题、以第三方付款为前提的背靠背条款、转包或违法分包、质保金超过结算总额3%、安全生产法定责任转移；（2）对我方立场不利的让步或陷阱；（3）表述含糊可能引发争议之处；（4）法律引用是否现行有效。你必须只输出一个JSON对象（禁止markdown代码块）：{"overall":"pass|warn|fail","issues":[{"text":"条款中逐字出现的片段","severity":"red|yellow","reason":"问题说明","legal_basis":"法条依据，可空","suggestion":"修改建议"}]}。没有问题时issues为空数组、overall为pass。',
  '合同方向={{direction}}（inbound=我方为乙方承包人，outbound=我方为甲方发包人）。节标题={{section_title}}。待审条款正文：{{content}}',
  '{"direction":"string","section_title":"string","content":"string"}',
  1, 'active', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
)
ON CONFLICT(template_key) DO UPDATE SET
  template_name = excluded.template_name,
  system_prompt = excluded.system_prompt,
  user_prompt_template = excluded.user_prompt_template,
  variables_schema = excluded.variables_schema,
  version = excluded.version,
  status = 'active',
  updated_at = excluded.updated_at;

INSERT INTO ai_prompt_template
  (template_key, template_name, system_prompt, user_prompt_template, variables_schema, version, status, created_at, updated_at)
VALUES (
  'prompt-contract-completeness-check-v1',
  '合同起草-完整性遗漏提示',
  '你是建设工程合同完整性检查助手。给你一份顶管施工合同草稿当前包含的节列表、合同方向与工程参数，请对照候选节全集与民法典第470条建议条款，指出缺失且建议补充的节。只做提示，不强制。你必须只输出一个JSON对象（禁止markdown代码块）：{"missing":[{"section_key":"候选全集中的key","title":"节标题","level":"core|recommended","reason":"为什么该合同需要这一节"}]}。已存在的节、候选全集之外的节、与该合同方向无关的节都不要列出；没有缺失时missing为空数组。',
  '合同方向={{direction}}。候选节全集JSON：{{catalog_json}}。当前已有节JSON数组：{{present_sections_json}}。工程关键信息JSON：{{keywords_json}}。请列出缺失且建议补充的节及理由。',
  '{"direction":"string","catalog_json":"string","present_sections_json":"string","keywords_json":"string"}',
  1, 'active', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
)
ON CONFLICT(template_key) DO UPDATE SET
  template_name = excluded.template_name,
  system_prompt = excluded.system_prompt,
  user_prompt_template = excluded.user_prompt_template,
  variables_schema = excluded.variables_schema,
  version = excluded.version,
  status = 'active',
  updated_at = excluded.updated_at;

-- 路由规则：三个 task_type → cf_ai + 对应模板（幂等：先 UPDATE 再 NOT EXISTS INSERT，照 0050 模式）
UPDATE ai_routing_rule
   SET provider_id = (SELECT id FROM ai_provider_config WHERE provider_key='cf_ai' LIMIT 1),
       prompt_template_id = (SELECT id FROM ai_prompt_template WHERE template_key='prompt-contract-draft-section-v1' LIMIT 1),
       priority = 1, status = 'active', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE rule_name = 'CFAI_CONTRACT_DRAFT_SECTION_DEFAULT';
INSERT INTO ai_routing_rule
  (rule_name, biz_type, task_type, condition_json, provider_id, prompt_template_id, priority, status, created_at, updated_at)
SELECT 'CFAI_CONTRACT_DRAFT_SECTION_DEFAULT', 'contract_draft', 'contract_draft_section', NULL, p.id, t.id, 1, 'active',
       strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM ai_provider_config p JOIN ai_prompt_template t ON t.template_key='prompt-contract-draft-section-v1'
WHERE p.provider_key='cf_ai'
  AND NOT EXISTS (SELECT 1 FROM ai_routing_rule WHERE rule_name='CFAI_CONTRACT_DRAFT_SECTION_DEFAULT');

UPDATE ai_routing_rule
   SET provider_id = (SELECT id FROM ai_provider_config WHERE provider_key='cf_ai' LIMIT 1),
       prompt_template_id = (SELECT id FROM ai_prompt_template WHERE template_key='prompt-contract-compliance-review-v1' LIMIT 1),
       priority = 1, status = 'active', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE rule_name = 'CFAI_CONTRACT_COMPLIANCE_REVIEW_DEFAULT';
INSERT INTO ai_routing_rule
  (rule_name, biz_type, task_type, condition_json, provider_id, prompt_template_id, priority, status, created_at, updated_at)
SELECT 'CFAI_CONTRACT_COMPLIANCE_REVIEW_DEFAULT', 'contract_draft', 'contract_compliance_review', NULL, p.id, t.id, 1, 'active',
       strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM ai_provider_config p JOIN ai_prompt_template t ON t.template_key='prompt-contract-compliance-review-v1'
WHERE p.provider_key='cf_ai'
  AND NOT EXISTS (SELECT 1 FROM ai_routing_rule WHERE rule_name='CFAI_CONTRACT_COMPLIANCE_REVIEW_DEFAULT');

UPDATE ai_routing_rule
   SET provider_id = (SELECT id FROM ai_provider_config WHERE provider_key='cf_ai' LIMIT 1),
       prompt_template_id = (SELECT id FROM ai_prompt_template WHERE template_key='prompt-contract-completeness-check-v1' LIMIT 1),
       priority = 1, status = 'active', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE rule_name = 'CFAI_CONTRACT_COMPLETENESS_CHECK_DEFAULT';
INSERT INTO ai_routing_rule
  (rule_name, biz_type, task_type, condition_json, provider_id, prompt_template_id, priority, status, created_at, updated_at)
SELECT 'CFAI_CONTRACT_COMPLETENESS_CHECK_DEFAULT', 'contract_draft', 'contract_completeness_check', NULL, p.id, t.id, 1, 'active',
       strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM ai_provider_config p JOIN ai_prompt_template t ON t.template_key='prompt-contract-completeness-check-v1'
WHERE p.provider_key='cf_ai'
  AND NOT EXISTS (SELECT 1 FROM ai_routing_rule WHERE rule_name='CFAI_CONTRACT_COMPLETENESS_CHECK_DEFAULT');
```

- [ ] **Step 2: 本地应用并验证**

```bash
cd packages/api && pnpm db:migrate:local
npx wrangler d1 execute hybcdg-prod-db --local --command "SELECT r.rule_name, p.provider_key, t.template_key FROM ai_routing_rule r JOIN ai_provider_config p ON p.id=r.provider_id JOIN ai_prompt_template t ON t.id=r.prompt_template_id WHERE r.biz_type='contract_draft'"
```
Expected: 3 行，provider_key 均为 `cf_ai`。

- [ ] **Step 3: Commit**

```bash
git add packages/api/migrations/0064_contract_draft_ai_seed.sql
git commit -m "feat(api): cf_ai provider与合同起草提示词路由seed"
```

---

### Task 5: `[ai]` binding（双段）与 Env 类型

**Files:**
- Modify: `packages/api/wrangler.toml`（顶层 `[triggers]` 之前 + `[env.prod.triggers]` 之前各加一段）
- Modify: `packages/api/src/types/env.ts`

- [ ] **Step 1: wrangler.toml 顶层加 binding**

在顶层 `[triggers]` 段之前插入：

```toml
# Workers AI / AI Gateway 统一模型入口（第三方模型经 Unified Billing 计费，
# 需 owner 在 CF dashboard 预充 credits）。顶层与 env.prod 两段必须同步。
[ai]
binding = "AI"
```

- [ ] **Step 2: wrangler.toml env.prod 段同步**

在 `[env.prod.triggers]` 段之前插入：

```toml
[env.prod.ai]
binding = "AI"
```

- [ ] **Step 3: Env 接口加 AI binding（自定义最小接口，不依赖 workers-types 版本）**

在 `packages/api/src/types/env.ts` 的 `EVENT_QUEUE: Queue;` 一行之后插入：

```ts
  /** Cloudflare AI binding（Unified Billing 第三方模型 + Workers AI）。 */
  AI: {
    run(
      model: string,
      inputs: Record<string, unknown>,
      options?: Record<string, unknown>
    ): Promise<unknown>;
  };
```

- [ ] **Step 4: 验证守卫测试与 typecheck**

```bash
cd packages/api && pnpm test -- test/wrangler-prod-env.test.ts && pnpm typecheck
```
Expected: 均 PASS。若 wrangler-prod-env.test.ts 因新增段落断言失败，按其断言口径把 `[ai]`/`[env.prod.ai]` 补进它维护的双段一致性清单（修实现所在的守卫清单，不是删断言）。

- [ ] **Step 5: 本地 dev 冒烟**

```bash
cd packages/api && timeout 20 pnpm dev 2>&1 | head -30
```
Expected: wrangler 启动无 binding 报错（本地 `env.AI` 可能是 remote 代理或占位，M1 本地全走 mock，不实际调用）。

- [ ] **Step 6: Commit**

```bash
git add packages/api/wrangler.toml packages/api/src/types/env.ts
git commit -m "feat(api): 新增Cloudflare AI binding（顶层与env.prod双段）"
```

---

### Task 6: 合规规则校验纯函数 + AI 输出解析

**Files:**
- Create: `packages/api/src/services/contract-draft-rules.ts`
- Test: `packages/api/test/contract-draft-rules.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// packages/api/test/contract-draft-rules.test.ts
import { describe, it, expect } from "vitest";
import {
  checkClauseText,
  checkDraftDates,
  parseContractSectionOutput
} from "../src/services/contract-draft-rules";

describe("checkClauseText", () => {
  it("拦截已废止法律引用", () => {
    const findings = checkClauseText("根据《中华人民共和国合同法》签订本协议。");
    expect(findings.some(f => f.level === "red" && f.reason.includes("废止"))).toBe(true);
  });

  it("拦截背靠背付款条款", () => {
    const findings = checkClauseText("甲方在收到业主付款后向乙方支付工程款。");
    expect(findings.some(f => f.level === "red" && f.legal_basis?.includes("2024"))).toBe(true);
  });

  it("拦截身份证号明文", () => {
    const findings = checkClauseText("收款代理人身份证号：131002198808111213。");
    expect(findings.some(f => f.level === "red" && f.reason.includes("个人信息"))).toBe(true);
  });

  it("质保金超过3%红标", () => {
    const findings = checkClauseText("质量保证金为结算总额的5%。");
    expect(findings.some(f => f.level === "red" && f.reason.includes("3%"))).toBe(true);
  });

  it("质保金3%以内不报", () => {
    expect(checkClauseText("质量保证金为结算总额的3%。")).toEqual([]);
  });

  it("日千分之三违约金黄标", () => {
    const findings = checkClauseText("每逾期一日按每日千分之三收取违约金。");
    expect(findings.some(f => f.level === "yellow")).toBe(true);
  });

  it("免除人身损害责任红标", () => {
    const findings = checkClauseText("乙方免除甲方造成的人身损害赔偿责任。");
    expect(findings.some(f => f.level === "red" && f.legal_basis?.includes("506"))).toBe(true);
  });

  it("正常条款零命中", () => {
    expect(checkClauseText("甲方应于验收合格后30日内支付工程款。")).toEqual([]);
  });
});

describe("checkDraftDates", () => {
  it("竣工早于开工红标", () => {
    const findings = checkDraftDates("2023-10-20", "2022-12-19");
    expect(findings).toHaveLength(1);
    expect(findings[0].level).toBe("red");
  });
  it("正常或缺省不报", () => {
    expect(checkDraftDates("2026-01-01", "2026-06-01")).toEqual([]);
    expect(checkDraftDates(undefined, "2026-06-01")).toEqual([]);
  });
});

describe("parseContractSectionOutput", () => {
  it("解析规范JSON", () => {
    const out = parseContractSectionOutput(
      JSON.stringify({ content: "正文A", risk_spans: [{ text: "正文A", level: "red", reason: "r" }] })
    );
    expect(out.content).toBe("正文A");
    expect(out.risk_spans).toHaveLength(1);
    expect(out.risk_spans[0].source).toBe("ai");
  });
  it("剥离markdown代码块围栏", () => {
    const out = parseContractSectionOutput('```json\n{"content":"B","risk_spans":[]}\n```');
    expect(out.content).toBe("B");
  });
  it("非JSON输出降级为纯文本content", () => {
    const out = parseContractSectionOutput("这不是JSON");
    expect(out.content).toBe("这不是JSON");
    expect(out.risk_spans).toEqual([]);
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
cd packages/api && pnpm test -- test/contract-draft-rules.test.ts
```
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 写实现**

```ts
// packages/api/src/services/contract-draft-rules.ts
// 合同草稿合规规则层：确定性校验（黑名单/日期/输出解析），与 LLM 合规审查互补。
import type { RiskAnnotation } from "../types/contract-draft";

interface RulePattern {
  re: RegExp;
  level: "red" | "yellow";
  reason: string;
  legal_basis: string;
}

const RULE_PATTERNS: RulePattern[] = [
  {
    re: /《中华人民共和国合同法》|《合同法》|《中华人民共和国经济合同法》/,
    level: "red",
    reason: "引用了已废止的法律，应改为《中华人民共和国民法典》",
    legal_basis: "《民法典》2021年1月1日施行，合同法同日废止"
  },
  {
    re: /(收到|待)(业主|建设单位|上游|第三方|总包)[^。；]{0,12}(付款|款项|工程款)[^。；]{0,8}(后|再|方)[^。；]{0,12}(支付|付款|拨付)/,
    level: "red",
    reason: "背靠背付款条款：以第三方付款作为付款前提，对中小企业无效",
    legal_basis: "最高人民法院2024年批复（法释〔2024〕11号）"
  },
  { re: /\d{17}[0-9Xx]/, level: "red", reason: "正文含身份证号明文，个人信息不得写入合同模板正文", legal_basis: "《个人信息保护法》" },
  {
    re: /免除[^。；]{0,16}人身(损害|伤害)[^。；]{0,8}责任|不承担[^。；]{0,12}人身(损害|伤害)/,
    level: "red",
    reason: "免除人身损害责任的免责条款无效",
    legal_basis: "《民法典》第506条"
  },
  {
    re: /(故意|重大过失)[^。；]{0,16}(免责|不承担责任|免除责任)/,
    level: "red",
    reason: "免除故意或重大过失责任的免责条款无效",
    legal_basis: "《民法典》第506条"
  },
  {
    re: /(允许|可以|有权)[^。；]{0,8}(转包|再分包)/,
    level: "red",
    reason: "转包/违法再分包安排违法且合同存在无效风险",
    legal_basis: "《建筑法》第28-29条"
  },
  {
    re: /每日[按]?千分之[一二三四五六七八九十\d]/,
    level: "yellow",
    reason: "逾期违约金费率畸高（年化超36%），存在被法院调减风险",
    legal_basis: "《民法典》第585条"
  }
];

const WARRANTY_RE = /(质量保证金|质保金)[^。；]{0,20}?([0-9]+(?:\.[0-9]+)?)\s*%/g;

const firstMatchText = (text: string, re: RegExp): string => {
  const m = text.match(re);
  return m ? m[0] : "";
};

/** 对单节正文跑全部确定性规则，返回风险标注（source='rule'）。 */
export const checkClauseText = (text: string): RiskAnnotation[] => {
  const findings: RiskAnnotation[] = [];
  for (const p of RULE_PATTERNS) {
    if (p.re.test(text)) {
      findings.push({
        text: firstMatchText(text, p.re),
        level: p.level,
        reason: p.reason,
        legal_basis: p.legal_basis,
        source: "rule"
      });
    }
  }
  for (const m of text.matchAll(WARRANTY_RE)) {
    const ratio = Number(m[2]);
    if (Number.isFinite(ratio) && ratio > 3) {
      findings.push({
        text: m[0],
        level: "red",
        reason: "质量保证金超过结算总额3%上限，超出部分不受支持",
        legal_basis: "《建设工程质量保证金管理办法》",
        source: "rule"
      });
    }
  }
  return findings;
};

/** 工期逻辑：竣工不得早于开工。 */
export const checkDraftDates = (
  startDate: string | undefined,
  endDate: string | undefined
): RiskAnnotation[] => {
  if (!startDate || !endDate) return [];
  const start = Date.parse(startDate);
  const end = Date.parse(endDate);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end >= start) return [];
  return [
    {
      text: `${startDate} → ${endDate}`,
      level: "red",
      reason: "竣工日期早于开工日期，工期倒挂",
      legal_basis: "",
      source: "rule"
    }
  ];
};

export interface ContractSectionOutput {
  content: string;
  risk_spans: RiskAnnotation[];
}

const stripCodeFence = (raw: string): string => {
  const trimmed = raw.trim();
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fence ? fence[1] : trimmed;
};

/** 容错解析单节生成输出：JSON 优先，失败降级为纯文本正文。 */
export const parseContractSectionOutput = (rawOutput: string): ContractSectionOutput => {
  const raw = stripCodeFence(rawOutput);
  try {
    const parsed = JSON.parse(raw) as { content?: unknown; risk_spans?: unknown };
    const content = typeof parsed.content === "string" ? parsed.content : raw;
    const spansRaw = Array.isArray(parsed.risk_spans) ? parsed.risk_spans : [];
    const risk_spans: RiskAnnotation[] = spansRaw
      .filter(
        (s): s is { text: string; level: string; reason: string; legal_basis?: string } =>
          !!s &&
          typeof s === "object" &&
          typeof (s as { text?: unknown }).text === "string" &&
          typeof (s as { reason?: unknown }).reason === "string"
      )
      .map(s => ({
        text: s.text,
        level: s.level === "red" ? "red" : "yellow",
        reason: s.reason,
        legal_basis: typeof s.legal_basis === "string" ? s.legal_basis : "",
        source: "ai" as const
      }));
    return { content, risk_spans };
  } catch {
    return { content: rawOutput, risk_spans: [] };
  }
};
```

- [ ] **Step 4: 运行测试通过**

```bash
cd packages/api && pnpm test -- test/contract-draft-rules.test.ts && pnpm typecheck && pnpm lint
```
Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/services/contract-draft-rules.ts packages/api/test/contract-draft-rules.test.ts
git commit -m "feat(api): 合同草稿合规规则校验与AI输出解析"
```

---

### Task 7: cf_ai 执行器

**Files:**
- Create: `packages/api/src/services/cf-ai.ts`
- Test: `packages/api/test/cf-ai-models.test.ts`

- [ ] **Step 1: 写失败测试（模型选择纯函数）**

```ts
// packages/api/test/cf-ai-models.test.ts
import { describe, it, expect } from "vitest";
import { CF_AI_MODELS, pickDraftModel, pickCriticModel, isCfAiTaskType } from "../src/services/cf-ai";

describe("cf_ai 模型选择", () => {
  it("起草模型按节序交替均衡", () => {
    expect(pickDraftModel(0)).toBe(CF_AI_MODELS[0]);
    expect(pickDraftModel(1)).toBe(CF_AI_MODELS[1]);
    expect(pickDraftModel(2)).toBe(CF_AI_MODELS[0]);
  });
  it("审查模型与起草模型异厂商", () => {
    expect(pickCriticModel(CF_AI_MODELS[0])).toBe(CF_AI_MODELS[1]);
    expect(pickCriticModel(CF_AI_MODELS[1])).toBe(CF_AI_MODELS[0]);
  });
  it("任务类型判别", () => {
    expect(isCfAiTaskType("contract_draft_section")).toBe(true);
    expect(isCfAiTaskType("contract_review")).toBe(false);
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
cd packages/api && pnpm test -- test/cf-ai-models.test.ts
```
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 写实现**

```ts
// packages/api/src/services/cf-ai.ts
// cf_ai provider：Worker 内直调 env.AI（Unified Billing 第三方模型）。
// 触发三路（路由 waitUntil / Queue TASK_CREATED / cron 兜底），全部经原子抢占幂等。
import type { Env } from "../types/env";
import type { TaskQueueItem } from "../types/ai";
import { completeTask, failTask, resolvePrompt } from "./ai-slot";

export const CF_AI_NODE_ID = "cf-ai-worker";

export const CF_AI_TASK_TYPES = [
  "contract_draft_section",
  "contract_compliance_review",
  "contract_completeness_check"
] as const;
export type CfAiTaskType = (typeof CF_AI_TASK_TYPES)[number];

/** 决策：sol 暂缓启用；terra 与 sonnet-5 均衡交替，critic 异厂商。 */
export const CF_AI_MODELS = ["openai/gpt-5.6-terra", "anthropic/claude-sonnet-5"] as const;

const MAX_OUTPUT_TOKENS = 8192;

const nowIso = () => new Date().toISOString();

export const isCfAiTaskType = (taskType: string): taskType is CfAiTaskType =>
  (CF_AI_TASK_TYPES as readonly string[]).includes(taskType);

export const pickDraftModel = (sectionSort: number): string =>
  CF_AI_MODELS[Math.abs(Math.trunc(sectionSort)) % CF_AI_MODELS.length];

export const pickCriticModel = (draftModel: string): string =>
  CF_AI_MODELS.find(m => m !== draftModel) ?? CF_AI_MODELS[0];

interface CfAiPrompt {
  system: string;
  user: string;
}

interface CfAiCallResult {
  output: string;
  latency_ms: number;
}

const mockOutput = (taskType: CfAiTaskType): string => {
  if (taskType === "contract_draft_section") {
    return JSON.stringify({
      content:
        "【本地MOCK生成】本节条款正文示例：甲方{{party_a}}应于验收合格后30日内向乙方{{party_b}}支付工程款。逾期付款的，每逾期一日按每日千分之三支付违约金。",
      risk_spans: [
        {
          text: "每逾期一日按每日千分之三支付违约金",
          level: "yellow",
          reason: "违约金费率畸高，存在被调减风险（mock标注）",
          legal_basis: "《民法典》第585条"
        }
      ]
    });
  }
  if (taskType === "contract_compliance_review") {
    return JSON.stringify({
      overall: "warn",
      issues: [
        {
          text: "每逾期一日按每日千分之三支付违约金",
          severity: "yellow",
          reason: "违约金费率畸高（mock审查）",
          legal_basis: "《民法典》第585条",
          suggestion: "建议调整为每日万分之五以内"
        }
      ]
    });
  }
  return JSON.stringify({
    missing: [
      {
        section_key: "geology_risk",
        title: "地质条件与地下障碍物风险",
        level: "recommended",
        reason: "顶管施工核心风险，建议补充（mock提示）"
      }
    ]
  });
};

/** 调用 env.AI；GPT-5.6 系走 Responses 格式，Claude 走 Messages 格式。本地环境返回确定性 mock。 */
export const callCfAi = async (
  env: Env,
  model: string,
  taskType: CfAiTaskType,
  prompt: CfAiPrompt
): Promise<CfAiCallResult> => {
  const startedAt = Date.now();
  if (env.APP_ENV === "local") {
    return { output: mockOutput(taskType), latency_ms: 0 };
  }
  if (model.startsWith("anthropic/")) {
    const resp = (await env.AI.run(model, {
      system: prompt.system,
      messages: [{ role: "user", content: prompt.user }],
      max_tokens: MAX_OUTPUT_TOKENS
    })) as { content?: Array<{ text?: string }> };
    const output = (resp.content ?? []).map(block => block.text ?? "").join("");
    return { output, latency_ms: Date.now() - startedAt };
  }
  const resp = (await env.AI.run(model, {
    input: prompt.user,
    instructions: prompt.system,
    max_output_tokens: MAX_OUTPUT_TOKENS
  })) as {
    output_text?: string;
    output?: Array<{ content?: Array<{ text?: string }> }>;
  };
  const output =
    resp.output_text ??
    (resp.output ?? [])
      .flatMap(item => item.content ?? [])
      .map(block => block.text ?? "")
      .join("");
  return { output, latency_ms: Date.now() - startedAt };
};

/**
 * 执行一个 cf_ai 任务。原子抢占（pending→running）保证多触发路径幂等；
 * 成功走 completeTask（审计+回写分支），失败走 failTask（自动重试）。
 */
export const executeCfAiTask = async (env: Env, taskId: number): Promise<void> => {
  const now = nowIso();
  const claim = await env.DB.prepare(
    `UPDATE task_queue SET status = 'running', assigned_node_id = ?, started_at = ?, updated_at = ?
      WHERE id = ? AND status = 'pending'`
  )
    .bind(CF_AI_NODE_ID, now, now, taskId)
    .run();
  if (!claim.meta.changes) return;

  const task = await env.DB.prepare("SELECT * FROM task_queue WHERE id = ?")
    .bind(taskId)
    .first<TaskQueueItem>();
  if (!task) return;
  if (!isCfAiTaskType(task.task_type)) {
    await failTask(env, taskId, CF_AI_NODE_ID, `cf_ai 不支持任务类型 ${task.task_type}`);
    return;
  }

  try {
    const rule = await env.DB.prepare(
      `SELECT prompt_template_id FROM ai_routing_rule
        WHERE biz_type = ? AND task_type = ? AND status = 'active'
        ORDER BY priority ASC, id ASC LIMIT 1`
    )
      .bind(task.biz_type, task.task_type)
      .first<{ prompt_template_id: number | null }>();
    if (!rule?.prompt_template_id) {
      throw new Error(`缺少 ${task.biz_type}/${task.task_type} 的路由规则或提示词模板`);
    }

    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(task.payload_json) as Record<string, unknown>;
    } catch {
      payload = {};
    }

    const prompt = await resolvePrompt(env, rule.prompt_template_id, payload);
    if (!prompt) throw new Error(`提示词模板 ${rule.prompt_template_id} 不存在或未启用`);

    const model =
      typeof payload.model === "string" && payload.model.length > 0
        ? payload.model
        : pickDraftModel(Number(payload.section_sort ?? 0));

    const { output, latency_ms } = await callCfAi(env, model, task.task_type, prompt);
    if (!output.trim()) throw new Error(`模型 ${model} 返回空输出`);
    await completeTask(env, taskId, CF_AI_NODE_ID, {
      output,
      latency_ms,
      metadata: { model }
    });
  } catch (err) {
    await failTask(env, taskId, CF_AI_NODE_ID, err instanceof Error ? err.message : String(err));
  }
};

/** cron 兜底：重试/超时后回到 pending 的 cf_ai 任务没有新事件，靠扫描补执行。 */
export const sweepPendingCfAiTasks = async (env: Env, limit = 5): Promise<void> => {
  const placeholders = CF_AI_TASK_TYPES.map(() => "?").join(", ");
  const rows = await env.DB.prepare(
    `SELECT id FROM task_queue WHERE status = 'pending' AND task_type IN (${placeholders})
      ORDER BY id ASC LIMIT ?`
  )
    .bind(...CF_AI_TASK_TYPES, limit)
    .all<{ id: number }>();
  for (const row of rows.results ?? []) {
    await executeCfAiTask(env, row.id);
  }
};
```

- [ ] **Step 4: 运行测试通过**

```bash
cd packages/api && pnpm test -- test/cf-ai-models.test.ts && pnpm typecheck && pnpm lint
```
Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/services/cf-ai.ts packages/api/test/cf-ai-models.test.ts
git commit -m "feat(api): cf_ai执行器（env.AI直调+模型均衡交替+本地mock）"
```

---

### Task 8: completeTask / failTask 草稿回写分支

**Files:**
- Modify: `packages/api/src/services/ai-slot.ts`（completeTask 约 L489-585、failTask 约 L585+）

- [ ] **Step 1: completeTask 加三个回写分支**

在 `external_log_audit` 分支（`if (task.task_type === "external_log_audit" ...)`) 之后、"// Write audit log" 注释之前插入：

```ts
  if (task.task_type === "contract_draft_section" && task.biz_type === "contract_draft") {
    const parsed = parseContractSectionOutput(result.output);
    const merged = [...parsed.risk_spans, ...checkClauseText(parsed.content)];
    await env.DB.prepare(
      `UPDATE contract_draft_section SET
         content = ?, risk_annotations_json = ?, ai_status = 'done',
         source = 'ai_generated', updated_at = ?
       WHERE ai_task_id = ? AND status != 'deleted'`
    )
      .bind(parsed.content, JSON.stringify(merged), now, taskId)
      .run();
  }

  if (task.task_type === "contract_compliance_review" && task.biz_type === "contract_draft") {
    await env.DB.prepare(
      `UPDATE contract_draft_section SET
         review_result_json = ?, review_status = 'done', updated_at = ?
       WHERE review_task_id = ? AND status != 'deleted'`
    )
      .bind(result.output, now, taskId)
      .run();
  }

  if (task.task_type === "contract_completeness_check" && task.biz_type === "contract_draft") {
    await env.DB.prepare(
      `UPDATE contract_draft SET
         completeness_result_json = ?, completeness_status = 'done', updated_at = ?
       WHERE completeness_task_id = ?`
    )
      .bind(result.output, now, taskId)
      .run();
  }
```

文件顶部补 import：

```ts
import { checkClauseText, parseContractSectionOutput } from "./contract-draft-rules";
```

- [ ] **Step 2: completeTask 末尾加隐私清洗**

在 `publishEvent(env, "TASK_COMPLETED", ...)` 调用**之前**插入（合同正文不留在任务队列，审计摘要 500 字符已由上方 ai_audit_log 落库）：

```ts
  if (task.biz_type === "contract_draft") {
    await env.DB.prepare(
      "UPDATE task_queue SET payload_json = '{}', result_json = '{}' WHERE id = ?"
    )
      .bind(taskId)
      .run();
  }
```

- [ ] **Step 3: failTask 终态分支加状态回写**

阅读 failTask 函数体，找到"重试次数已达上限、任务置为 `status='failed'`"的分支（`retry_count + 1 >= max_retries` 一侧），在该分支置 failed 的 UPDATE 之后插入：

```ts
    if (task.biz_type === "contract_draft") {
      if (task.task_type === "contract_draft_section") {
        await env.DB.prepare(
          "UPDATE contract_draft_section SET ai_status = 'error', updated_at = ? WHERE ai_task_id = ?"
        )
          .bind(now, taskId)
          .run();
      }
      if (task.task_type === "contract_compliance_review") {
        await env.DB.prepare(
          "UPDATE contract_draft_section SET review_status = 'error', updated_at = ? WHERE review_task_id = ?"
        )
          .bind(now, taskId)
          .run();
      }
      if (task.task_type === "contract_completeness_check") {
        await env.DB.prepare(
          "UPDATE contract_draft SET completeness_status = 'error', updated_at = ? WHERE completeness_task_id = ?"
        )
          .bind(now, taskId)
          .run();
      }
    }
```

（failTask 内变量名以实际函数体为准：task 行与 now 均已在该函数内加载/定义，沿用即可；若该分支未加载 task 行，按 completeTask 同款 `SELECT * FROM task_queue WHERE id = ?` 先取。）

- [ ] **Step 4: 验证**

```bash
cd packages/api && pnpm typecheck && pnpm lint && pnpm test
```
Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/services/ai-slot.ts
git commit -m "feat(api): completeTask/failTask合同草稿回写分支与任务隐私清洗"
```

---

### Task 9: 触发链路 — queue-handler TASK_CREATED case + cron 兜底

**Files:**
- Modify: `packages/api/src/queue-handler.ts`（switch 内、`case "TASK_COMPLETED"` 之前）
- Modify: `packages/api/src/scheduled.ts`（*/2 分钟 cron 分支）

- [ ] **Step 1: queue-handler 顶部加 import**

```ts
import { executeCfAiTask, isCfAiTaskType } from "./services/cf-ai";
```

- [ ] **Step 2: switch 中新增 case（放在 `case "TASK_COMPLETED": {` 之前）**

```ts
        case "TASK_CREATED": {
          const createdTaskId = Number(event.payload?.task_id ?? 0);
          const createdTaskType = String(event.payload?.task_type ?? "");
          if (createdTaskId > 0 && isCfAiTaskType(createdTaskType)) {
            await executeCfAiTask(env, createdTaskId);
          }
          break;
        }
```

- [ ] **Step 3: scheduled.ts 的 */2 分钟分支加兜底扫描**

在 `scheduled.ts` 中找到 `*/2 * * * *` cron 分支（现有 checkTimeouts / requeueTimedOutTasks 调用处），在其后追加：

```ts
    // cf_ai 任务重试/超时后回 pending 无新事件，cron 兜底补执行。
    await sweepPendingCfAiTasks(env, 5);
```

并在文件顶部补 import：

```ts
import { sweepPendingCfAiTasks } from "./services/cf-ai";
```

- [ ] **Step 4: 验证**

```bash
cd packages/api && pnpm typecheck && pnpm lint
```
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/queue-handler.ts packages/api/src/scheduled.ts
git commit -m "feat(api): cf_ai任务三路触发（事件+cron兜底）"
```

---

### Task 10: contract-draft API 路由

**Files:**
- Create: `packages/api/src/routes/contract-draft.ts`
- Modify: `packages/api/src/index.ts`（import + 在 `app.route("/api/v1/contract", contractRoutes);` 之前注册）

- [ ] **Step 1: 写路由文件**

```ts
// packages/api/src/routes/contract-draft.ts
// AI 合同起草草稿域：草稿 CRUD / 节管理 / 逐节生成 / 合规审查 / 完整性提示。
// 人在环：AI 只写草稿节，正式合同转化在 M2；mutation 一律拒绝 mcp_agent 令牌。
import { Hono } from "hono";
import { authMiddleware, type AuthVariables } from "../middleware/auth";
import { requireRoles } from "../middleware/rbac";
import type { Env } from "../types/env";
import { createTask } from "../services/ai-slot";
import { executeCfAiTask, pickCriticModel, pickDraftModel } from "../services/cf-ai";
import { checkClauseText, checkDraftDates } from "../services/contract-draft-rules";
import type {
  ContractClauseTemplate,
  ContractDraft,
  ContractDraftSection,
  DraftDirection
} from "../types/contract-draft";
import { draftDirections } from "../types/contract-draft";

const ROLES = ["super_admin", "manager", "finance"] as const;
const MAX_INSTRUCTION = 500;
const MAX_TITLE = 120;

const nowIso = () => new Date().toISOString();

export const contractDraftRoutes = new Hono<{
  Bindings: Env;
  Variables: AuthVariables;
}>();

contractDraftRoutes.use("*", authMiddleware);
contractDraftRoutes.use("*", requireRoles([...ROLES]));

// 起草是人本人业务：泄漏的 agent 令牌不得代为起草/生成（人在环约束）。
contractDraftRoutes.use("*", async (c, next) => {
  const auth = c.get("auth");
  if (c.req.method !== "GET" && auth.auth_method === "mcp_agent") {
    return c.json({ success: false, error: { message: "该操作不对 agent 令牌开放" } }, 403);
  }
  await next();
});

const isDirection = (value: unknown): value is DraftDirection =>
  typeof value === "string" && (draftDirections as readonly string[]).includes(value);

const canAccess = (draft: ContractDraft, auth: { sub: string; roles: string[] }): boolean =>
  draft.created_by_userid === auth.sub || auth.roles.includes("super_admin");

const loadDraft = async (env: Env, id: number): Promise<ContractDraft | null> => {
  if (!Number.isInteger(id) || id <= 0) return null;
  return env.DB.prepare("SELECT * FROM contract_draft WHERE id = ? AND status != 'deleted'")
    .bind(id)
    .first<ContractDraft>();
};

const loadSection = async (
  env: Env,
  draftId: number,
  sectionId: number
): Promise<ContractDraftSection | null> => {
  if (!Number.isInteger(sectionId) || sectionId <= 0) return null;
  return env.DB.prepare(
    "SELECT * FROM contract_draft_section WHERE id = ? AND draft_id = ? AND status != 'deleted'"
  )
    .bind(sectionId, draftId)
    .first<ContractDraftSection>();
};

const listSections = async (env: Env, draftId: number): Promise<ContractDraftSection[]> => {
  const rows = await env.DB.prepare(
    "SELECT * FROM contract_draft_section WHERE draft_id = ? AND status != 'deleted' ORDER BY sort_order ASC, id ASC"
  )
    .bind(draftId)
    .all<ContractDraftSection>();
  return rows.results ?? [];
};

const parseKeywords = (draft: ContractDraft): Record<string, unknown> => {
  try {
    return JSON.parse(draft.keywords_json) as Record<string, unknown>;
  } catch {
    return {};
  }
};

// ── 条款库目录（供"添加节"选择器与完整性检查候选集） ──
contractDraftRoutes.get("/templates", async (c) => {
  const direction = c.req.query("direction");
  if (!isDirection(direction)) {
    return c.json({ success: false, error: { message: "direction 必须为 inbound 或 outbound" } }, 400);
  }
  const rows = await c.env.DB.prepare(
    `SELECT * FROM contract_clause_template
      WHERE (direction = ? OR direction = 'both') AND status = 'active'
      ORDER BY sort_order ASC, id ASC`
  )
    .bind(direction)
    .all<ContractClauseTemplate>();
  return c.json({ success: true, data: rows.results ?? [] });
});

// ── 草稿 CRUD ──
contractDraftRoutes.post("/", async (c) => {
  const auth = c.get("auth");
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return c.json({ success: false, error: { message: "请求体不是合法 JSON" } }, 400);
  if (!isDirection(body.direction)) {
    return c.json({ success: false, error: { message: "direction 必须为 inbound 或 outbound" } }, 400);
  }
  const title =
    typeof body.title === "string" && body.title.trim().length > 0
      ? body.title.trim().slice(0, MAX_TITLE)
      : body.direction === "inbound"
        ? "顶管施工协议（对甲方）"
        : "顶管施工协议（对分包商）";
  const now = nowIso();
  const insert = await c.env.DB.prepare(
    `INSERT INTO contract_draft
       (title, direction, project_id, entity_id, counterparty_name, keywords_json,
        status, created_by_userid, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, '{}', 'drafting', ?, ?, ?)`
  )
    .bind(
      title,
      body.direction,
      typeof body.project_id === "number" ? body.project_id : null,
      typeof body.entity_id === "number" ? body.entity_id : null,
      typeof body.counterparty_name === "string" ? body.counterparty_name.trim() : "",
      auth.sub,
      now,
      now
    )
    .run();
  const draftId = insert.meta.last_row_id;

  // 预载默认节集合（core + recommended；optional 由用户从目录追加）
  const templates = await c.env.DB.prepare(
    `SELECT * FROM contract_clause_template
      WHERE (direction = ? OR direction = 'both') AND status = 'active'
        AND required_level IN ('core', 'recommended')
      ORDER BY sort_order ASC, id ASC`
  )
    .bind(body.direction)
    .all<ContractClauseTemplate>();
  const stmts = (templates.results ?? []).map(t =>
    c.env.DB.prepare(
      `INSERT INTO contract_draft_section
         (draft_id, section_key, title, source, content, sort_order, status, created_at, updated_at)
       VALUES (?, ?, ?, 'default_template', ?, ?, 'active', ?, ?)`
    ).bind(draftId, t.section_key, t.title, t.body_template, t.sort_order, now, now)
  );
  if (stmts.length) await c.env.DB.batch(stmts);

  const draft = await loadDraft(c.env, draftId);
  return c.json({ success: true, data: { draft, sections: await listSections(c.env, draftId) } });
});

contractDraftRoutes.get("/", async (c) => {
  const auth = c.get("auth");
  const rows = auth.roles.includes("super_admin")
    ? await c.env.DB.prepare(
        "SELECT * FROM contract_draft WHERE status != 'deleted' ORDER BY updated_at DESC LIMIT 100"
      ).all<ContractDraft>()
    : await c.env.DB.prepare(
        "SELECT * FROM contract_draft WHERE status != 'deleted' AND created_by_userid = ? ORDER BY updated_at DESC LIMIT 100"
      )
        .bind(auth.sub)
        .all<ContractDraft>();
  return c.json({ success: true, data: rows.results ?? [] });
});

contractDraftRoutes.get("/:id", async (c) => {
  const auth = c.get("auth");
  const draft = await loadDraft(c.env, Number(c.req.param("id")));
  if (!draft || !canAccess(draft, auth)) {
    return c.json({ success: false, error: { message: "草稿不存在" } }, 404);
  }
  return c.json({ success: true, data: { draft, sections: await listSections(c.env, draft.id) } });
});

contractDraftRoutes.put("/:id", async (c) => {
  const auth = c.get("auth");
  const draft = await loadDraft(c.env, Number(c.req.param("id")));
  if (!draft || !canAccess(draft, auth)) {
    return c.json({ success: false, error: { message: "草稿不存在" } }, 404);
  }
  if (draft.status !== "drafting") {
    return c.json({ success: false, error: { message: "当前状态不可编辑" } }, 400);
  }
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return c.json({ success: false, error: { message: "请求体不是合法 JSON" } }, 400);

  const str = (v: unknown): string | null =>
    typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
  const keywords =
    body.keywords && typeof body.keywords === "object" && !Array.isArray(body.keywords)
      ? (body.keywords as Record<string, unknown>)
      : parseKeywords(draft);

  // 工期倒挂等关键字级校验只提示不拦截（结果随响应返回，前端标红）
  const keywordFindings = checkDraftDates(
    typeof keywords.start_date === "string" ? keywords.start_date : undefined,
    typeof keywords.end_date === "string" ? keywords.end_date : undefined
  );

  await c.env.DB.prepare(
    `UPDATE contract_draft SET
       title = ?, project_id = ?, entity_id = ?, counterparty_name = ?,
       counterparty_credit_code = ?, counterparty_legal_person = ?, counterparty_address = ?,
       counterparty_contact = ?, counterparty_phone = ?, counterparty_bank_name = ?,
       counterparty_bank_account = ?, keywords_json = ?, updated_at = ?
     WHERE id = ? AND status = 'drafting'`
  )
    .bind(
      str(body.title)?.slice(0, MAX_TITLE) ?? draft.title,
      typeof body.project_id === "number" ? body.project_id : draft.project_id,
      typeof body.entity_id === "number" ? body.entity_id : draft.entity_id,
      str(body.counterparty_name) ?? draft.counterparty_name,
      str(body.counterparty_credit_code),
      str(body.counterparty_legal_person),
      str(body.counterparty_address),
      str(body.counterparty_contact),
      str(body.counterparty_phone),
      str(body.counterparty_bank_name),
      str(body.counterparty_bank_account),
      JSON.stringify(keywords),
      nowIso(),
      draft.id
    )
    .run();
  const updated = await loadDraft(c.env, draft.id);
  return c.json({ success: true, data: { draft: updated, keyword_findings: keywordFindings } });
});

contractDraftRoutes.delete("/:id", async (c) => {
  const auth = c.get("auth");
  const draft = await loadDraft(c.env, Number(c.req.param("id")));
  if (!draft || !canAccess(draft, auth)) {
    return c.json({ success: false, error: { message: "草稿不存在" } }, 404);
  }
  await c.env.DB.prepare("UPDATE contract_draft SET status = 'deleted', updated_at = ? WHERE id = ?")
    .bind(nowIso(), draft.id)
    .run();
  return c.json({ success: true, data: { id: draft.id } });
});

// ── 节管理 ──
contractDraftRoutes.post("/:id/sections", async (c) => {
  const auth = c.get("auth");
  const draft = await loadDraft(c.env, Number(c.req.param("id")));
  if (!draft || !canAccess(draft, auth)) {
    return c.json({ success: false, error: { message: "草稿不存在" } }, 404);
  }
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return c.json({ success: false, error: { message: "请求体不是合法 JSON" } }, 400);
  const now = nowIso();
  const maxSort = await c.env.DB.prepare(
    "SELECT COALESCE(MAX(sort_order), 0) AS max_sort FROM contract_draft_section WHERE draft_id = ? AND status != 'deleted'"
  )
    .bind(draft.id)
    .first<{ max_sort: number }>();
  const nextSort = (maxSort?.max_sort ?? 0) + 10;

  if (typeof body.section_key === "string" && body.section_key.length > 0) {
    const tpl = await c.env.DB.prepare(
      `SELECT * FROM contract_clause_template
        WHERE section_key = ? AND (direction = ? OR direction = 'both') AND status = 'active'
        ORDER BY CASE direction WHEN 'both' THEN 1 ELSE 0 END ASC LIMIT 1`
    )
      .bind(body.section_key, draft.direction)
      .first<ContractClauseTemplate>();
    if (!tpl) return c.json({ success: false, error: { message: "条款库中无该节" } }, 404);
    const dup = await c.env.DB.prepare(
      "SELECT id FROM contract_draft_section WHERE draft_id = ? AND section_key = ? AND status != 'deleted'"
    )
      .bind(draft.id, tpl.section_key)
      .first<{ id: number }>();
    if (dup) return c.json({ success: false, error: { message: "该节已存在" } }, 400);
    const ins = await c.env.DB.prepare(
      `INSERT INTO contract_draft_section
         (draft_id, section_key, title, source, content, sort_order, status, created_at, updated_at)
       VALUES (?, ?, ?, 'default_template', ?, ?, 'active', ?, ?)`
    )
      .bind(draft.id, tpl.section_key, tpl.title, tpl.body_template, nextSort, now, now)
      .run();
    const section = await loadSection(c.env, draft.id, ins.meta.last_row_id);
    return c.json({ success: true, data: section });
  }

  const customTitle = typeof body.title === "string" ? body.title.trim().slice(0, MAX_TITLE) : "";
  if (!customTitle) {
    return c.json({ success: false, error: { message: "需提供 section_key 或自定义节标题" } }, 400);
  }
  const ins = await c.env.DB.prepare(
    `INSERT INTO contract_draft_section
       (draft_id, section_key, title, source, content, sort_order, status, created_at, updated_at)
     VALUES (?, ?, ?, 'manual', '', ?, 'active', ?, ?)`
  )
    .bind(draft.id, `custom_${Date.now()}`, customTitle, nextSort, now, now)
    .run();
  const section = await loadSection(c.env, draft.id, ins.meta.last_row_id);
  return c.json({ success: true, data: section });
});

contractDraftRoutes.get("/:id/sections/:sectionId", async (c) => {
  const auth = c.get("auth");
  const draft = await loadDraft(c.env, Number(c.req.param("id")));
  if (!draft || !canAccess(draft, auth)) {
    return c.json({ success: false, error: { message: "草稿不存在" } }, 404);
  }
  const section = await loadSection(c.env, draft.id, Number(c.req.param("sectionId")));
  if (!section) return c.json({ success: false, error: { message: "节不存在" } }, 404);
  return c.json({ success: true, data: section });
});

contractDraftRoutes.put("/:id/sections/:sectionId", async (c) => {
  const auth = c.get("auth");
  const draft = await loadDraft(c.env, Number(c.req.param("id")));
  if (!draft || !canAccess(draft, auth)) {
    return c.json({ success: false, error: { message: "草稿不存在" } }, 404);
  }
  const section = await loadSection(c.env, draft.id, Number(c.req.param("sectionId")));
  if (!section) return c.json({ success: false, error: { message: "节不存在" } }, 404);
  if (section.ai_status === "generating") {
    return c.json({ success: false, error: { message: "该节正在生成中，稍后再编辑" } }, 400);
  }
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return c.json({ success: false, error: { message: "请求体不是合法 JSON" } }, 400);

  const nextContent = typeof body.content === "string" ? body.content : section.content;
  const contentChanged = nextContent !== section.content;
  // 人工改稿即重跑规则层（AI 标注保留需重新生成才更新）
  const annotations = contentChanged ? checkClauseText(nextContent) : null;

  await c.env.DB.prepare(
    `UPDATE contract_draft_section SET
       title = ?, content = ?, instruction = ?, sort_order = ?,
       source = ?, risk_annotations_json = COALESCE(?, risk_annotations_json), updated_at = ?
     WHERE id = ?`
  )
    .bind(
      typeof body.title === "string" && body.title.trim() ? body.title.trim().slice(0, MAX_TITLE) : section.title,
      nextContent,
      typeof body.instruction === "string" ? body.instruction.slice(0, MAX_INSTRUCTION) : section.instruction,
      typeof body.sort_order === "number" ? body.sort_order : section.sort_order,
      contentChanged ? "manual" : section.source,
      annotations ? JSON.stringify(annotations) : null,
      nowIso(),
      section.id
    )
    .run();
  return c.json({ success: true, data: await loadSection(c.env, draft.id, section.id) });
});

contractDraftRoutes.delete("/:id/sections/:sectionId", async (c) => {
  const auth = c.get("auth");
  const draft = await loadDraft(c.env, Number(c.req.param("id")));
  if (!draft || !canAccess(draft, auth)) {
    return c.json({ success: false, error: { message: "草稿不存在" } }, 404);
  }
  const section = await loadSection(c.env, draft.id, Number(c.req.param("sectionId")));
  if (!section) return c.json({ success: false, error: { message: "节不存在" } }, 404);
  await c.env.DB.prepare(
    "UPDATE contract_draft_section SET status = 'deleted', updated_at = ? WHERE id = ?"
  )
    .bind(nowIso(), section.id)
    .run();
  return c.json({ success: true, data: { id: section.id } });
});

// ── AI 生成 ──
contractDraftRoutes.post("/:id/sections/:sectionId/generate", async (c) => {
  const auth = c.get("auth");
  const draft = await loadDraft(c.env, Number(c.req.param("id")));
  if (!draft || !canAccess(draft, auth)) {
    return c.json({ success: false, error: { message: "草稿不存在" } }, 404);
  }
  const section = await loadSection(c.env, draft.id, Number(c.req.param("sectionId")));
  if (!section) return c.json({ success: false, error: { message: "节不存在" } }, 404);

  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const instruction = typeof body.instruction === "string" ? body.instruction.trim() : "";
  if (instruction.length > MAX_INSTRUCTION) {
    return c.json({ success: false, error: { message: `个性化指令不得超过 ${MAX_INSTRUCTION} 字` } }, 400);
  }

  // 闸门前置：抢占节状态，防重复生成（D1 无事务）
  const claim = await c.env.DB.prepare(
    `UPDATE contract_draft_section SET ai_status = 'generating', instruction = ?, updated_at = ?
      WHERE id = ? AND (ai_status IS NULL OR ai_status != 'generating')`
  )
    .bind(instruction || null, nowIso(), section.id)
    .run();
  if (!claim.meta.changes) {
    return c.json({ success: false, error: { message: "该节已在生成中" } }, 409);
  }

  const tpl = await c.env.DB.prepare(
    `SELECT * FROM contract_clause_template
      WHERE section_key = ? AND (direction = ? OR direction = 'both') AND status = 'active'
      ORDER BY CASE direction WHEN 'both' THEN 1 ELSE 0 END ASC LIMIT 1`
  )
    .bind(section.section_key, draft.direction)
    .first<ContractClauseTemplate>();

  const sectionIndex = Math.trunc(section.sort_order / 10);
  const task = await createTask(c.env, {
    task_type: "contract_draft_section",
    biz_type: "contract_draft",
    biz_id: draft.id,
    payload: {
      draft_id: draft.id,
      section_id: section.id,
      direction: draft.direction,
      section_key: section.section_key,
      section_title: section.title,
      body_template: tpl?.body_template ?? section.content,
      style_ref: tpl?.style_ref ?? "",
      keywords_json: draft.keywords_json,
      instruction,
      section_sort: sectionIndex,
      model: pickDraftModel(sectionIndex)
    },
    priority: 6,
    timeout_seconds: 300
  });
  await c.env.DB.prepare("UPDATE contract_draft_section SET ai_task_id = ? WHERE id = ?")
    .bind(task.id, section.id)
    .run();
  // 即时执行（本地无 Queue 也能跑通）；Queue 事件与 cron 为后备，原子抢占保证幂等。
  c.executionCtx.waitUntil(
    executeCfAiTask(c.env, task.id).catch(err => console.error("cf_ai execute failed", task.id, err))
  );
  return c.json({ success: true, data: { task_id: task.id, section_id: section.id } });
});

contractDraftRoutes.post("/:id/sections/:sectionId/review", async (c) => {
  const auth = c.get("auth");
  const draft = await loadDraft(c.env, Number(c.req.param("id")));
  if (!draft || !canAccess(draft, auth)) {
    return c.json({ success: false, error: { message: "草稿不存在" } }, 404);
  }
  const section = await loadSection(c.env, draft.id, Number(c.req.param("sectionId")));
  if (!section) return c.json({ success: false, error: { message: "节不存在" } }, 404);
  if (!section.content.trim()) {
    return c.json({ success: false, error: { message: "该节尚无正文可审查" } }, 400);
  }
  const claim = await c.env.DB.prepare(
    `UPDATE contract_draft_section SET review_status = 'generating', updated_at = ?
      WHERE id = ? AND (review_status IS NULL OR review_status != 'generating')`
  )
    .bind(nowIso(), section.id)
    .run();
  if (!claim.meta.changes) {
    return c.json({ success: false, error: { message: "该节已在审查中" } }, 409);
  }
  // critic 与起草异厂商：起草模型由节序决定，审查取另一个
  const draftModel = pickDraftModel(Math.trunc(section.sort_order / 10));
  const task = await createTask(c.env, {
    task_type: "contract_compliance_review",
    biz_type: "contract_draft",
    biz_id: draft.id,
    payload: {
      draft_id: draft.id,
      section_id: section.id,
      direction: draft.direction,
      section_title: section.title,
      content: section.content,
      model: pickCriticModel(draftModel)
    },
    priority: 6,
    timeout_seconds: 300
  });
  await c.env.DB.prepare("UPDATE contract_draft_section SET review_task_id = ? WHERE id = ?")
    .bind(task.id, section.id)
    .run();
  c.executionCtx.waitUntil(
    executeCfAiTask(c.env, task.id).catch(err => console.error("cf_ai review failed", task.id, err))
  );
  return c.json({ success: true, data: { task_id: task.id, section_id: section.id } });
});

// ── 完整性遗漏提示 ──
contractDraftRoutes.post("/:id/completeness-check", async (c) => {
  const auth = c.get("auth");
  const draft = await loadDraft(c.env, Number(c.req.param("id")));
  if (!draft || !canAccess(draft, auth)) {
    return c.json({ success: false, error: { message: "草稿不存在" } }, 404);
  }
  const claim = await c.env.DB.prepare(
    `UPDATE contract_draft SET completeness_status = 'generating', updated_at = ?
      WHERE id = ? AND (completeness_status IS NULL OR completeness_status != 'generating')`
  )
    .bind(nowIso(), draft.id)
    .run();
  if (!claim.meta.changes) {
    return c.json({ success: false, error: { message: "完整性检查进行中" } }, 409);
  }
  const sections = await listSections(c.env, draft.id);
  const catalog = await c.env.DB.prepare(
    `SELECT section_key, title, required_level FROM contract_clause_template
      WHERE (direction = ? OR direction = 'both') AND status = 'active' ORDER BY sort_order ASC`
  )
    .bind(draft.direction)
    .all<{ section_key: string; title: string; required_level: string }>();
  const task = await createTask(c.env, {
    task_type: "contract_completeness_check",
    biz_type: "contract_draft",
    biz_id: draft.id,
    payload: {
      draft_id: draft.id,
      direction: draft.direction,
      catalog_json: JSON.stringify(catalog.results ?? []),
      present_sections_json: JSON.stringify(sections.map(s => ({ section_key: s.section_key, title: s.title }))),
      keywords_json: draft.keywords_json
    },
    priority: 6,
    timeout_seconds: 180
  });
  await c.env.DB.prepare("UPDATE contract_draft SET completeness_task_id = ? WHERE id = ?")
    .bind(task.id, draft.id)
    .run();
  c.executionCtx.waitUntil(
    executeCfAiTask(c.env, task.id).catch(err => console.error("cf_ai completeness failed", task.id, err))
  );
  return c.json({ success: true, data: { task_id: task.id } });
});

contractDraftRoutes.post("/:id/completeness-ignore", async (c) => {
  const auth = c.get("auth");
  const draft = await loadDraft(c.env, Number(c.req.param("id")));
  if (!draft || !canAccess(draft, auth)) {
    return c.json({ success: false, error: { message: "草稿不存在" } }, 404);
  }
  const body = (await c.req.json().catch(() => null)) as { section_key?: unknown } | null;
  const key = typeof body?.section_key === "string" ? body.section_key : "";
  if (!key) return c.json({ success: false, error: { message: "缺少 section_key" } }, 400);
  let ignored: string[] = [];
  try {
    const parsed = JSON.parse(draft.ignored_hints_json) as unknown;
    ignored = Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    ignored = [];
  }
  if (!ignored.includes(key)) ignored.push(key);
  await c.env.DB.prepare(
    "UPDATE contract_draft SET ignored_hints_json = ?, updated_at = ? WHERE id = ?"
  )
    .bind(JSON.stringify(ignored), nowIso(), draft.id)
    .run();
  return c.json({ success: true, data: { ignored } });
});
```

- [ ] **Step 2: index.ts 注册**

import 段（与其他路由 import 并列）加：

```ts
import { contractDraftRoutes } from "./routes/contract-draft";
```

在 `app.route("/api/v1/contract", contractRoutes);` **之前**加：

```ts
app.route("/api/v1/contract-draft", contractDraftRoutes);
```

- [ ] **Step 3: 验证**

```bash
cd packages/api && pnpm typecheck && pnpm lint && pnpm test
```
Expected: 全部 PASS。

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/routes/contract-draft.ts packages/api/src/index.ts
git commit -m "feat(api): 合同起草草稿API（CRUD/逐节生成/交叉审查/完整性提示）"
```

---

### Task 11: web API wrapper

**Files:**
- Create: `packages/web/src/api/contract-draft.ts`

- [ ] **Step 1: 写 wrapper（沿用 http.request 泛型=完整响应体、返回解包 data 的仓库范式）**

```ts
import { http } from "@/utils/http";

export type DraftDirection = "inbound" | "outbound";
export type SectionAiStatus = "generating" | "done" | "error" | null;

export type RiskAnnotation = {
  text: string;
  level: "red" | "yellow";
  reason: string;
  legal_basis?: string;
  source: "ai" | "rule";
};

export type ContractDraft = {
  id: number;
  title: string;
  direction: DraftDirection;
  project_id: number | null;
  entity_id: number | null;
  counterparty_name: string;
  counterparty_credit_code: string | null;
  counterparty_legal_person: string | null;
  counterparty_address: string | null;
  counterparty_contact: string | null;
  counterparty_phone: string | null;
  counterparty_bank_name: string | null;
  counterparty_bank_account: string | null;
  keywords_json: string;
  status: string;
  completeness_status: string | null;
  completeness_result_json: string | null;
  ignored_hints_json: string;
  created_by_userid: string;
  created_at: string;
  updated_at: string;
};

export type ContractDraftSection = {
  id: number;
  draft_id: number;
  section_key: string;
  title: string;
  source: "default_template" | "ai_generated" | "manual";
  instruction: string | null;
  content: string;
  risk_annotations_json: string | null;
  ai_task_id: number | null;
  ai_status: SectionAiStatus;
  review_task_id: number | null;
  review_status: SectionAiStatus;
  review_result_json: string | null;
  sort_order: number;
  status: string;
  created_at: string;
  updated_at: string;
};

export type ClauseTemplate = {
  id: number;
  section_key: string;
  direction: DraftDirection | "both";
  required_level: "core" | "recommended" | "optional";
  title: string;
  body_template: string;
  risk_notes: string | null;
  sort_order: number;
};

export type DraftDetail = { draft: ContractDraft; sections: ContractDraftSection[] };

export async function listClauseTemplates(direction: DraftDirection): Promise<ClauseTemplate[]> {
  const res = await http.request<{ success: boolean; data: ClauseTemplate[] }>(
    "get",
    "/api/v1/contract-draft/templates",
    { params: { direction } }
  );
  return res.data;
}

export async function createDraft(data: {
  direction: DraftDirection;
  title?: string;
  counterparty_name?: string;
  project_id?: number;
  entity_id?: number;
}): Promise<DraftDetail> {
  const res = await http.request<{ success: boolean; data: DraftDetail }>(
    "post",
    "/api/v1/contract-draft",
    { data }
  );
  return res.data;
}

export async function listDrafts(): Promise<ContractDraft[]> {
  const res = await http.request<{ success: boolean; data: ContractDraft[] }>(
    "get",
    "/api/v1/contract-draft"
  );
  return res.data;
}

export async function getDraft(id: number): Promise<DraftDetail> {
  const res = await http.request<{ success: boolean; data: DraftDetail }>(
    "get",
    `/api/v1/contract-draft/${id}`
  );
  return res.data;
}

export async function updateDraft(
  id: number,
  data: Record<string, unknown>
): Promise<{ draft: ContractDraft; keyword_findings: RiskAnnotation[] }> {
  const res = await http.request<{
    success: boolean;
    data: { draft: ContractDraft; keyword_findings: RiskAnnotation[] };
  }>("put", `/api/v1/contract-draft/${id}`, { data });
  return res.data;
}

export async function deleteDraft(id: number): Promise<void> {
  await http.request<{ success: boolean }>("delete", `/api/v1/contract-draft/${id}`);
}

export async function addSection(
  draftId: number,
  payload: { section_key?: string; title?: string }
): Promise<ContractDraftSection> {
  const res = await http.request<{ success: boolean; data: ContractDraftSection }>(
    "post",
    `/api/v1/contract-draft/${draftId}/sections`,
    { data: payload }
  );
  return res.data;
}

export async function getSection(
  draftId: number,
  sectionId: number
): Promise<ContractDraftSection> {
  const res = await http.request<{ success: boolean; data: ContractDraftSection }>(
    "get",
    `/api/v1/contract-draft/${draftId}/sections/${sectionId}`
  );
  return res.data;
}

export async function updateSection(
  draftId: number,
  sectionId: number,
  data: Record<string, unknown>
): Promise<ContractDraftSection> {
  const res = await http.request<{ success: boolean; data: ContractDraftSection }>(
    "put",
    `/api/v1/contract-draft/${draftId}/sections/${sectionId}`,
    { data }
  );
  return res.data;
}

export async function removeSection(draftId: number, sectionId: number): Promise<void> {
  await http.request<{ success: boolean }>(
    "delete",
    `/api/v1/contract-draft/${draftId}/sections/${sectionId}`
  );
}

export async function generateSection(
  draftId: number,
  sectionId: number,
  instruction?: string
): Promise<number> {
  const res = await http.request<{ success: boolean; data: { task_id: number } }>(
    "post",
    `/api/v1/contract-draft/${draftId}/sections/${sectionId}/generate`,
    { data: { instruction: instruction ?? "" } }
  );
  return res.data.task_id;
}

export async function reviewSection(draftId: number, sectionId: number): Promise<number> {
  const res = await http.request<{ success: boolean; data: { task_id: number } }>(
    "post",
    `/api/v1/contract-draft/${draftId}/sections/${sectionId}/review`,
    { data: {} }
  );
  return res.data.task_id;
}

export async function requestCompleteness(draftId: number): Promise<number> {
  const res = await http.request<{ success: boolean; data: { task_id: number } }>(
    "post",
    `/api/v1/contract-draft/${draftId}/completeness-check`,
    { data: {} }
  );
  return res.data.task_id;
}

export async function ignoreCompletenessHint(
  draftId: number,
  sectionKey: string
): Promise<void> {
  await http.request<{ success: boolean }>(
    "post",
    `/api/v1/contract-draft/${draftId}/completeness-ignore`,
    { data: { section_key: sectionKey } }
  );
}
```

- [ ] **Step 2: typecheck + Commit**

```bash
cd packages/web && pnpm typecheck
git add packages/web/src/api/contract-draft.ts
git commit -m "feat(web): 合同起草API封装"
```

---

### Task 12: 双色分段纯函数 lib

**Files:**
- Create: `packages/web/src/views/finance/contract/draft/lib/segments.ts`
- Test: `packages/web/src/views/finance/contract/draft/lib/__tests__/segments.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from "vitest";
import { buildRenderSegments, fillPlaceholders } from "../segments";
import type { RiskAnnotation } from "@/api/contract-draft";

const risk = (text: string, level: "red" | "yellow"): RiskAnnotation => ({
  text,
  level,
  reason: "测试原因",
  legal_basis: "《民法典》",
  source: "rule"
});

describe("fillPlaceholders", () => {
  it("已知键替换、未知键保留", () => {
    expect(fillPlaceholders("甲方{{party_a}}与{{unknown}}", { party_a: "某公司" })).toBe(
      "甲方某公司与{{unknown}}"
    );
  });
});

describe("buildRenderSegments", () => {
  it("占位符切成 keyword 段并带填充值", () => {
    const segs = buildRenderSegments("甲方{{party_a}}付款", [], { party_a: "某公司" });
    expect(segs).toEqual([
      { text: "甲方", kind: "plain" },
      { text: "某公司", kind: "keyword", key: "party_a" },
      { text: "付款", kind: "plain" }
    ]);
  });

  it("无填充值的占位符原样展示", () => {
    const segs = buildRenderSegments("{{amount}}元", [], {});
    expect(segs[0]).toEqual({ text: "{{amount}}", kind: "keyword", key: "amount" });
  });

  it("风险片段切成 risk 段并带原因", () => {
    const segs = buildRenderSegments("每日千分之三违约金条款。", [risk("每日千分之三", "yellow")], {});
    const riskSeg = segs.find(s => s.kind === "risk-yellow");
    expect(riskSeg?.text).toBe("每日千分之三");
    expect(riskSeg?.reason).toBe("测试原因");
  });

  it("风险文本不存在于正文时忽略", () => {
    const segs = buildRenderSegments("正常条款。", [risk("不存在的片段", "red")], {});
    expect(segs.every(s => s.kind === "plain" || s.kind === "keyword")).toBe(true);
  });

  it("风险段与占位符共存", () => {
    const segs = buildRenderSegments(
      "{{party_a}}免除人身损害责任。",
      [risk("免除人身损害责任", "red")],
      { party_a: "某公司" }
    );
    expect(segs.map(s => s.kind)).toEqual(["keyword", "risk-red", "plain"]);
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
cd packages/web && pnpm test -- src/views/finance/contract/draft/lib/__tests__/segments.test.ts
```
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 写实现**

```ts
// lib/segments.ts — 条款正文渲染分段：关键字（占位符）与风险片段双色高亮的纯函数。
import type { RiskAnnotation } from "@/api/contract-draft";

export interface RenderSegment {
  text: string;
  kind: "plain" | "keyword" | "risk-red" | "risk-yellow";
  key?: string;
  reason?: string;
  legalBasis?: string;
}

const PLACEHOLDER_RE = /\{\{(\w+)\}\}/g;

export function fillPlaceholders(text: string, values: Record<string, string>): string {
  return text.replace(PLACEHOLDER_RE, (raw, key: string) => {
    const v = values[key];
    return v && v.length > 0 ? v : raw;
  });
}

function splitByPlaceholders(text: string, values: Record<string, string>): RenderSegment[] {
  const segments: RenderSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(PLACEHOLDER_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) segments.push({ text: text.slice(last, idx), kind: "plain" });
    const key = m[1];
    const value = values[key];
    segments.push({ text: value && value.length > 0 ? value : m[0], kind: "keyword", key });
    last = idx + m[0].length;
  }
  if (last < text.length) segments.push({ text: text.slice(last), kind: "plain" });
  return segments;
}

/** 先按风险片段（首次出现、互不重叠）切分，再对非风险部分做占位符切分。 */
export function buildRenderSegments(
  content: string,
  risks: RiskAnnotation[],
  values: Record<string, string>
): RenderSegment[] {
  const hits: Array<{ start: number; end: number; risk: RiskAnnotation }> = [];
  for (const r of risks) {
    if (!r.text) continue;
    const start = content.indexOf(r.text);
    if (start < 0) continue;
    const end = start + r.text.length;
    if (hits.some(h => start < h.end && end > h.start)) continue;
    hits.push({ start, end, risk: r });
  }
  hits.sort((a, b) => a.start - b.start);

  const segments: RenderSegment[] = [];
  let cursor = 0;
  for (const h of hits) {
    if (h.start > cursor) segments.push(...splitByPlaceholders(content.slice(cursor, h.start), values));
    segments.push({
      text: h.risk.text,
      kind: h.risk.level === "red" ? "risk-red" : "risk-yellow",
      reason: h.risk.reason,
      legalBasis: h.risk.legal_basis
    });
    cursor = h.end;
  }
  if (cursor < content.length) segments.push(...splitByPlaceholders(content.slice(cursor), values));
  return segments;
}

export function parseRiskAnnotations(json: string | null): RiskAnnotation[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter(
          (r): r is RiskAnnotation =>
            !!r && typeof r === "object" && typeof (r as RiskAnnotation).text === "string"
        )
      : [];
  } catch {
    return [];
  }
}
```

- [ ] **Step 4: 运行测试通过 + Commit**

```bash
cd packages/web && pnpm test -- src/views/finance/contract/draft/lib/__tests__/segments.test.ts && pnpm typecheck
git add packages/web/src/views/finance/contract/draft/lib/
git commit -m "feat(web): 条款关键字/风险双色分段纯函数"
```

---

### Task 13: 逐节生成轮询 composable

**Files:**
- Create: `packages/web/src/views/finance/contract/draft/composables/useContractDraftAI.ts`
- Test: `packages/web/src/views/finance/contract/draft/composables/__tests__/useContractDraftAI.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from "vitest";
import { useContractDraftAI } from "../useContractDraftAI";
import type { ContractDraftSection } from "@/api/contract-draft";

const sectionWith = (over: Partial<ContractDraftSection>): ContractDraftSection => ({
  id: 1,
  draft_id: 9,
  section_key: "payment",
  title: "付款",
  source: "default_template",
  instruction: null,
  content: "",
  risk_annotations_json: null,
  ai_task_id: null,
  ai_status: null,
  review_task_id: null,
  review_status: null,
  review_result_json: null,
  sort_order: 70,
  status: "active",
  created_at: "",
  updated_at: "",
  ...over
});

describe("useContractDraftAI", () => {
  it("生成：轮询至 done 并返回最新节", async () => {
    const polls = [
      sectionWith({ ai_status: "generating" }),
      sectionWith({ ai_status: "done", content: "生成完成正文" })
    ];
    let i = 0;
    const ai = useContractDraftAI({
      generate: async () => 42,
      getSection: async () => polls[Math.min(i++, polls.length - 1)],
      sleep: async () => undefined,
      intervalMs: 1,
      maxPolls: 10
    });
    const result = await ai.generateForSection(9, 1, "");
    expect(result?.content).toBe("生成完成正文");
    expect(ai.stateOf(1).phase).toBe("done");
  });

  it("生成失败：phase=error 且携带信息", async () => {
    const ai = useContractDraftAI({
      generate: async () => 42,
      getSection: async () => sectionWith({ ai_status: "error" }),
      sleep: async () => undefined,
      intervalMs: 1,
      maxPolls: 5
    });
    const result = await ai.generateForSection(9, 1, "");
    expect(result).toBeNull();
    expect(ai.stateOf(1).phase).toBe("error");
  });

  it("超过轮询上限：phase=error", async () => {
    const ai = useContractDraftAI({
      generate: async () => 42,
      getSection: async () => sectionWith({ ai_status: "generating" }),
      sleep: async () => undefined,
      intervalMs: 1,
      maxPolls: 3
    });
    const result = await ai.generateForSection(9, 1, "");
    expect(result).toBeNull();
    expect(ai.stateOf(1).phase).toBe("error");
    expect(ai.stateOf(1).error).toContain("超时");
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
cd packages/web && pnpm test -- src/views/finance/contract/draft/composables/__tests__/useContractDraftAI.test.ts
```
Expected: FAIL。

- [ ] **Step 3: 写实现（Deps 注入 + 懒 import + 不可变 Map 更新，照 useDedupAI 范式）**

```ts
import { shallowRef } from "vue";
import type { ContractDraftSection } from "@/api/contract-draft";

export interface SectionAiState {
  phase: "idle" | "generating" | "reviewing" | "done" | "error";
  error: string;
}

interface Deps {
  generate?: (draftId: number, sectionId: number, instruction?: string) => Promise<number>;
  review?: (draftId: number, sectionId: number) => Promise<number>;
  getSection?: (draftId: number, sectionId: number) => Promise<ContractDraftSection>;
  sleep?: (ms: number) => Promise<void>;
  intervalMs?: number;
  maxPolls?: number;
}

const realSleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const IDLE: SectionAiState = { phase: "idle", error: "" };

async function defaultGenerate(draftId: number, sectionId: number, instruction?: string) {
  const { generateSection } = await import("@/api/contract-draft");
  return generateSection(draftId, sectionId, instruction);
}
async function defaultReview(draftId: number, sectionId: number) {
  const { reviewSection } = await import("@/api/contract-draft");
  return reviewSection(draftId, sectionId);
}
async function defaultGetSection(draftId: number, sectionId: number) {
  const { getSection } = await import("@/api/contract-draft");
  return getSection(draftId, sectionId);
}

export function useContractDraftAI(deps: Deps = {}) {
  const generate = deps.generate ?? defaultGenerate;
  const review = deps.review ?? defaultReview;
  const getSection = deps.getSection ?? defaultGetSection;
  const sleep = deps.sleep ?? realSleep;
  const intervalMs = deps.intervalMs ?? 2000;
  const maxPolls = deps.maxPolls ?? 150;

  const states = shallowRef<Map<number, SectionAiState>>(new Map());

  const setState = (sectionId: number, state: SectionAiState) => {
    states.value = new Map(states.value).set(sectionId, state);
  };
  const stateOf = (sectionId: number): SectionAiState => states.value.get(sectionId) ?? IDLE;

  async function pollUntil(
    draftId: number,
    sectionId: number,
    field: "ai_status" | "review_status"
  ): Promise<ContractDraftSection | null> {
    for (let i = 0; i < maxPolls; i++) {
      const section = await getSection(draftId, sectionId);
      if (section[field] === "done") {
        setState(sectionId, { phase: "done", error: "" });
        return section;
      }
      if (section[field] === "error") {
        setState(sectionId, { phase: "error", error: "AI 处理失败，请重试" });
        return null;
      }
      await sleep(intervalMs);
    }
    setState(sectionId, { phase: "error", error: "AI 处理超时，请重试" });
    return null;
  }

  async function generateForSection(
    draftId: number,
    sectionId: number,
    instruction?: string
  ): Promise<ContractDraftSection | null> {
    setState(sectionId, { phase: "generating", error: "" });
    try {
      await generate(draftId, sectionId, instruction);
      return await pollUntil(draftId, sectionId, "ai_status");
    } catch (e: unknown) {
      setState(sectionId, {
        phase: "error",
        error: e instanceof Error ? e.message : "网络异常，请重试"
      });
      return null;
    }
  }

  async function reviewForSection(
    draftId: number,
    sectionId: number
  ): Promise<ContractDraftSection | null> {
    setState(sectionId, { phase: "reviewing", error: "" });
    try {
      await review(draftId, sectionId);
      return await pollUntil(draftId, sectionId, "review_status");
    } catch (e: unknown) {
      setState(sectionId, {
        phase: "error",
        error: e instanceof Error ? e.message : "网络异常，请重试"
      });
      return null;
    }
  }

  return { states, stateOf, generateForSection, reviewForSection };
}
```

- [ ] **Step 4: 运行测试通过 + Commit**

```bash
cd packages/web && pnpm test -- src/views/finance/contract/draft/composables/__tests__/useContractDraftAI.test.ts && pnpm typecheck
git add packages/web/src/views/finance/contract/draft/composables/
git commit -m "feat(web): 合同起草逐节生成轮询composable"
```

---

### Task 14: 组件与标签

**Files:**
- Create: `packages/web/src/views/finance/contract/draft/draft-labels.ts`
- Create: `packages/web/src/views/finance/contract/draft/components/DraftInitCard.vue`
- Create: `packages/web/src/views/finance/contract/draft/components/SectionListPanel.vue`
- Create: `packages/web/src/views/finance/contract/draft/components/SectionCard.vue`
- Create: `packages/web/src/views/finance/contract/draft/components/CompletenessDialog.vue`

- [ ] **Step 1: draft-labels.ts（仿 payment-labels.ts 范式）**

```ts
export type DraftTagType = "primary" | "success" | "warning" | "danger" | "info";

export const sectionAiStatusTagType: Record<string, DraftTagType> = {
  generating: "warning",
  done: "success",
  error: "danger"
};

export const sectionAiStatusLabelMap: Record<string, string> = {
  generating: "生成中",
  done: "已生成",
  error: "失败"
};

export const sectionSourceLabelMap: Record<string, string> = {
  default_template: "默认模板",
  ai_generated: "AI 生成",
  manual: "手工编辑"
};

export const requiredLevelLabelMap: Record<string, string> = {
  core: "核心",
  recommended: "建议",
  optional: "可选"
};

export const toDraftLabel = (map: Record<string, string>, value: string | null | undefined): string =>
  value ? (map[value] ?? value) : "-";
```

- [ ] **Step 2: DraftInitCard.vue（新建草稿表单）**

```vue
<script setup lang="ts">
import { reactive } from "vue";
import type { DraftDirection } from "@/api/contract-draft";

const emit = defineEmits<{
  (e: "create", payload: { direction: DraftDirection; title: string; counterparty_name: string }): void;
}>();

const form = reactive({
  direction: "inbound" as DraftDirection,
  title: "",
  counterparty_name: ""
});
</script>

<template>
  <el-card class="init-card">
    <template #header>新建 AI 合同草稿</template>
    <el-form label-width="96px">
      <el-form-item label="合同立场" required>
        <el-radio-group v-model="form.direction">
          <el-radio-button value="inbound">对甲方（我方为乙方）</el-radio-button>
          <el-radio-button value="outbound">对分包商（我方为甲方）</el-radio-button>
        </el-radio-group>
      </el-form-item>
      <el-form-item label="草稿标题">
        <el-input v-model="form.title" maxlength="120" placeholder="留空自动命名" />
      </el-form-item>
      <el-form-item label="对方单位">
        <el-input v-model="form.counterparty_name" maxlength="120" placeholder="可稍后填写" />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" @click="emit('create', { ...form })">创建并加载默认条款</el-button>
      </el-form-item>
    </el-form>
  </el-card>
</template>
```

- [ ] **Step 3: SectionListPanel.vue（左侧节列表：选中/增删/排序）**

```vue
<script setup lang="ts">
import { computed, ref } from "vue";
import type { ClauseTemplate, ContractDraftSection } from "@/api/contract-draft";
import {
  requiredLevelLabelMap,
  sectionAiStatusLabelMap,
  sectionAiStatusTagType,
  toDraftLabel
} from "../draft-labels";

const props = defineProps<{
  sections: ContractDraftSection[];
  templates: ClauseTemplate[];
  activeId: number | null;
}>();
const emit = defineEmits<{
  (e: "select", id: number): void;
  (e: "add", payload: { section_key?: string; title?: string }): void;
  (e: "remove", id: number): void;
  (e: "move", payload: { id: number; delta: -1 | 1 }): void;
}>();

const addVisible = ref(false);
const addKey = ref("");
const customTitle = ref("");

const addable = computed(() =>
  props.templates.filter(t => !props.sections.some(s => s.section_key === t.section_key))
);

const submitAdd = () => {
  if (addKey.value) emit("add", { section_key: addKey.value });
  else if (customTitle.value.trim()) emit("add", { title: customTitle.value.trim() });
  addVisible.value = false;
  addKey.value = "";
  customTitle.value = "";
};
</script>

<template>
  <el-card>
    <template #header>
      <div class="panel-header">
        <span>合同条款（{{ sections.length }} 节）</span>
        <el-button size="small" type="primary" plain @click="addVisible = true">添加节</el-button>
      </div>
    </template>
    <ul class="section-list">
      <li
        v-for="(s, idx) in sections"
        :key="s.id"
        :class="{ active: s.id === activeId }"
        @click="emit('select', s.id)"
      >
        <span class="title">{{ s.title }}</span>
        <span class="ops">
          <el-tag v-if="s.ai_status" size="small" :type="sectionAiStatusTagType[s.ai_status] ?? 'info'">
            {{ toDraftLabel(sectionAiStatusLabelMap, s.ai_status) }}
          </el-tag>
          <el-button link size="small" :disabled="idx === 0" @click.stop="emit('move', { id: s.id, delta: -1 })">↑</el-button>
          <el-button link size="small" :disabled="idx === sections.length - 1" @click.stop="emit('move', { id: s.id, delta: 1 })">↓</el-button>
          <el-button link size="small" type="danger" @click.stop="emit('remove', s.id)">删</el-button>
        </span>
      </li>
    </ul>
    <el-dialog v-model="addVisible" title="添加条款节" width="420px" append-to-body>
      <el-form label-width="80px">
        <el-form-item label="从条款库">
          <el-select v-model="addKey" clearable placeholder="选择条款节" style="width: 100%">
            <el-option
              v-for="t in addable"
              :key="t.id"
              :value="t.section_key"
              :label="`${t.title}（${toDraftLabel(requiredLevelLabelMap, t.required_level)}）`"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="或自定义">
          <el-input v-model="customTitle" maxlength="120" placeholder="自定义节标题" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="addVisible = false">取消</el-button>
        <el-button type="primary" @click="submitAdd">添加</el-button>
      </template>
    </el-dialog>
  </el-card>
</template>

<style scoped>
.panel-header { display: flex; align-items: center; justify-content: space-between; }
.section-list { margin: 0; padding: 0; list-style: none; }
.section-list li {
  display: flex; align-items: center; justify-content: space-between;
  padding: 6px 8px; cursor: pointer; border-radius: 4px;
}
.section-list li.active { background: var(--el-color-primary-light-9); }
.section-list .title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.section-list .ops { display: flex; align-items: center; gap: 2px; }
</style>
```

- [ ] **Step 4: SectionCard.vue（单节：双色高亮渲染 + 指令生成 + 手工编辑 + 交叉审查）**

```vue
<script setup lang="ts">
import { computed, ref } from "vue";
import type { ContractDraftSection } from "@/api/contract-draft";
import { buildRenderSegments, parseRiskAnnotations } from "../lib/segments";
import type { SectionAiState } from "../composables/useContractDraftAI";
import { sectionSourceLabelMap, toDraftLabel } from "../draft-labels";

const props = defineProps<{
  section: ContractDraftSection;
  keywordValues: Record<string, string>;
  aiState: SectionAiState;
}>();
const emit = defineEmits<{
  (e: "generate", payload: { sectionId: number; instruction: string }): void;
  (e: "review", sectionId: number): void;
  (e: "save", payload: { sectionId: number; content: string }): void;
}>();

const instruction = ref(props.section.instruction ?? "");
const editing = ref(false);
const editContent = ref("");

const busy = computed(
  () => props.aiState.phase === "generating" || props.aiState.phase === "reviewing"
);
const segments = computed(() =>
  buildRenderSegments(
    props.section.content,
    parseRiskAnnotations(props.section.risk_annotations_json),
    props.keywordValues
  )
);
const reviewIssues = computed(() => {
  if (!props.section.review_result_json) return [];
  try {
    const parsed = JSON.parse(props.section.review_result_json) as {
      issues?: Array<{ text: string; severity: string; reason: string; suggestion?: string }>;
    };
    return parsed.issues ?? [];
  } catch {
    return [];
  }
});

const startEdit = () => {
  editContent.value = props.section.content;
  editing.value = true;
};
const saveEdit = () => {
  emit("save", { sectionId: props.section.id, content: editContent.value });
  editing.value = false;
};
</script>

<template>
  <el-card class="section-card" :id="`section-${section.id}`">
    <template #header>
      <div class="card-header">
        <span>
          {{ section.title }}
          <el-tag size="small" type="info">{{ toDraftLabel(sectionSourceLabelMap, section.source) }}</el-tag>
        </span>
        <span class="actions">
          <el-button size="small" :loading="busy" @click="emit('generate', { sectionId: section.id, instruction: '' })">
            默认生成
          </el-button>
          <el-button size="small" :loading="busy" :disabled="!instruction.trim()"
            @click="emit('generate', { sectionId: section.id, instruction })">
            按指令生成
          </el-button>
          <el-button size="small" :loading="busy" :disabled="!section.content" @click="emit('review', section.id)">
            AI 交叉审查
          </el-button>
          <el-button size="small" v-if="!editing" @click="startEdit">编辑</el-button>
        </span>
      </div>
    </template>

    <el-input
      v-model="instruction"
      maxlength="500"
      show-word-limit
      placeholder="个性化指令（可选）：例如 付款节点改为按月固定日期、违约金上限调整为万分之五每日"
      class="instruction-input"
    />

    <el-alert v-if="aiState.phase === 'error'" type="error" :title="aiState.error" :closable="false" />

    <div v-if="!editing" class="content-view">
      <template v-for="(seg, i) in segments" :key="i">
        <span v-if="seg.kind === 'plain'">{{ seg.text }}</span>
        <span v-else-if="seg.kind === 'keyword'" class="seg-keyword" :title="`关键字：${seg.key}`">{{ seg.text }}</span>
        <el-tooltip v-else :content="`${seg.reason}${seg.legalBasis ? '（' + seg.legalBasis + '）' : ''}`" placement="top">
          <span :class="seg.kind === 'risk-red' ? 'seg-risk-red' : 'seg-risk-yellow'">{{ seg.text }}</span>
        </el-tooltip>
      </template>
      <el-empty v-if="!section.content" description="尚无正文，点击生成或编辑" :image-size="48" />
    </div>
    <div v-else>
      <el-input v-model="editContent" type="textarea" :autosize="{ minRows: 6, maxRows: 24 }" />
      <div class="edit-actions">
        <el-button size="small" @click="editing = false">取消</el-button>
        <el-button size="small" type="primary" @click="saveEdit">保存</el-button>
      </div>
    </div>

    <el-collapse v-if="reviewIssues.length">
      <el-collapse-item :title="`交叉审查发现 ${reviewIssues.length} 个问题`">
        <ul class="review-list">
          <li v-for="(issue, i) in reviewIssues" :key="i">
            <el-tag size="small" :type="issue.severity === 'red' ? 'danger' : 'warning'">
              {{ issue.severity === 'red' ? '红' : '黄' }}
            </el-tag>
            <span class="issue-text">「{{ issue.text }}」{{ issue.reason }}</span>
            <span v-if="issue.suggestion" class="issue-suggestion">建议：{{ issue.suggestion }}</span>
          </li>
        </ul>
      </el-collapse-item>
    </el-collapse>
  </el-card>
</template>

<style scoped>
.card-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.instruction-input { margin-bottom: 8px; }
.content-view { white-space: pre-wrap; line-height: 1.9; }
.seg-keyword { background: var(--el-color-primary-light-8); border-radius: 3px; padding: 0 3px; }
.seg-risk-red { background: var(--el-color-danger-light-7); border-bottom: 2px solid var(--el-color-danger); cursor: help; }
.seg-risk-yellow { background: var(--el-color-warning-light-7); border-bottom: 2px solid var(--el-color-warning); cursor: help; }
.edit-actions { margin-top: 8px; text-align: right; }
.review-list { margin: 0; padding-left: 8px; list-style: none; }
.review-list li { margin-bottom: 6px; }
.issue-text { margin-left: 6px; }
.issue-suggestion { margin-left: 6px; color: var(--el-text-color-secondary); }
</style>
```

- [ ] **Step 5: CompletenessDialog.vue（遗漏提示：添加/忽略）**

```vue
<script setup lang="ts">
import { computed } from "vue";
import { requiredLevelLabelMap, toDraftLabel } from "../draft-labels";

export interface MissingHint {
  section_key: string;
  title: string;
  level: string;
  reason: string;
}

const props = defineProps<{
  visible: boolean;
  missing: MissingHint[];
  ignored: string[];
}>();
const emit = defineEmits<{
  (e: "update:visible", v: boolean): void;
  (e: "add", sectionKey: string): void;
  (e: "ignore", sectionKey: string): void;
}>();

const pending = computed(() => props.missing.filter(m => !props.ignored.includes(m.section_key)));
</script>

<template>
  <el-dialog
    :model-value="visible"
    title="完整性检查提示（仅提示，不阻塞）"
    width="560px"
    @update:model-value="v => emit('update:visible', v)"
  >
    <el-empty v-if="!pending.length" description="没有待处理的遗漏提示" :image-size="48" />
    <ul v-else class="hint-list">
      <li v-for="m in pending" :key="m.section_key">
        <div>
          <el-tag size="small" :type="m.level === 'core' ? 'danger' : 'warning'">
            {{ toDraftLabel(requiredLevelLabelMap, m.level) }}
          </el-tag>
          <b class="hint-title">{{ m.title }}</b>
        </div>
        <div class="hint-reason">{{ m.reason }}</div>
        <div class="hint-actions">
          <el-button size="small" type="primary" plain @click="emit('add', m.section_key)">添加该节</el-button>
          <el-button size="small" @click="emit('ignore', m.section_key)">忽略（留痕）</el-button>
        </div>
      </li>
    </ul>
  </el-dialog>
</template>

<style scoped>
.hint-list { margin: 0; padding: 0; list-style: none; }
.hint-list li { padding: 10px 0; border-bottom: 1px solid var(--el-border-color-lighter); }
.hint-title { margin-left: 6px; }
.hint-reason { margin: 4px 0; color: var(--el-text-color-secondary); }
.hint-actions { text-align: right; }
</style>
```

- [ ] **Step 6: typecheck + Commit**

```bash
cd packages/web && pnpm typecheck
git add packages/web/src/views/finance/contract/draft/draft-labels.ts packages/web/src/views/finance/contract/draft/components/
git commit -m "feat(web): 合同起草组件（节列表/节卡片/遗漏提示/新建表单）"
```

---

### Task 15: 流水线页 + 路由 + 入口按钮

**Files:**
- Create: `packages/web/src/views/finance/contract/draft/index.vue`
- Modify: `packages/web/src/router/modules/finance.ts`（`ContractDetail` 条目之后插入）
- Modify: `packages/web/src/views/finance/contract/index.vue`（L94 附近 + L162 附近）

- [ ] **Step 1: 写 index.vue**

```vue
<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import {
  addSection as apiAddSection,
  createDraft,
  getDraft,
  getSection,
  ignoreCompletenessHint,
  listClauseTemplates,
  removeSection,
  requestCompleteness,
  updateDraft,
  updateSection,
  type ClauseTemplate,
  type ContractDraft,
  type ContractDraftSection,
  type DraftDirection
} from "@/api/contract-draft";
import { listEntities, type Entity } from "@/api/entity";
import { useProjectOptions } from "@/composables/useProjectOptions";
import { useContractDraftAI } from "./composables/useContractDraftAI";
import DraftInitCard from "./components/DraftInitCard.vue";
import SectionListPanel from "./components/SectionListPanel.vue";
import SectionCard from "./components/SectionCard.vue";
import CompletenessDialog, { type MissingHint } from "./components/CompletenessDialog.vue";

defineOptions({ name: "ContractDraftWorkbench" });

const route = useRoute();
const router = useRouter();
const { projects, loadProjects } = useProjectOptions();

const draft = ref<ContractDraft | null>(null);
const sections = ref<ContractDraftSection[]>([]);
const templates = ref<ClauseTemplate[]>([]);
const entities = ref<Entity[]>([]);
const activeSectionId = ref<number | null>(null);
const completenessVisible = ref(false);
const missingHints = ref<MissingHint[]>([]);
const saving = ref(false);
const checking = ref(false);

const ai = useContractDraftAI();

// 关键字字段清单（与条款库占位符对齐；甲乙方主体信息按立场自动映射）
const KEYWORD_FIELDS: Array<{ key: string; label: string }> = [
  { key: "project_name", label: "工程名称" },
  { key: "location", label: "工程地点" },
  { key: "pipe_spec", label: "管材规格" },
  { key: "length", label: "顶进长度(米)" },
  { key: "unit_price", label: "综合单价(元/米)" },
  { key: "amount", label: "合同总价(元)" },
  { key: "tax_rate", label: "税率(%)" },
  { key: "start_date", label: "开工日期" },
  { key: "end_date", label: "竣工日期" },
  { key: "sign_date", label: "签约日期" },
  { key: "dispute_venue", label: "争议管辖地" }
];
const keywords = ref<Record<string, string>>({});

const ourEntity = computed(() => entities.value.find(e => e.id === draft.value?.entity_id));
const keywordValues = computed<Record<string, string>>(() => {
  const our = ourEntity.value;
  const cp = draft.value;
  const base: Record<string, string> = { ...keywords.value };
  if (cp?.direction === "inbound") {
    // 我方为乙方
    if (cp.counterparty_name) base.party_a = cp.counterparty_name;
    if (cp.counterparty_credit_code) base.party_a_credit_code = cp.counterparty_credit_code;
    if (cp.counterparty_legal_person) base.party_a_legal_person = cp.counterparty_legal_person;
    if (cp.counterparty_address) base.party_a_address = cp.counterparty_address;
    if (our) {
      base.party_b = our.entity_name;
      if (our.tax_id) base.party_b_credit_code = our.tax_id;
      if (our.legal_person) base.party_b_legal_person = our.legal_person;
      if (our.primary_bank_name) base.party_b_bank_name = our.primary_bank_name;
      if (our.primary_bank_account_no) base.party_b_bank_account = our.primary_bank_account_no;
    }
  } else if (cp) {
    // 我方为甲方
    if (our) {
      base.party_a = our.entity_name;
      if (our.tax_id) base.party_a_credit_code = our.tax_id;
      if (our.legal_person) base.party_a_legal_person = our.legal_person;
      if (our.primary_bank_name) base.party_a_bank_name = our.primary_bank_name;
      if (our.primary_bank_account_no) base.party_a_bank_account = our.primary_bank_account_no;
    }
    if (cp.counterparty_name) base.party_b = cp.counterparty_name;
    if (cp.counterparty_credit_code) base.party_b_credit_code = cp.counterparty_credit_code;
    if (cp.counterparty_legal_person) base.party_b_legal_person = cp.counterparty_legal_person;
    if (cp.counterparty_address) base.party_b_address = cp.counterparty_address;
  }
  return base;
});

const ignoredHints = computed<string[]>(() => {
  if (!draft.value) return [];
  try {
    const parsed = JSON.parse(draft.value.ignored_hints_json) as unknown;
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
});

const applyDetail = (detail: { draft: ContractDraft; sections: ContractDraftSection[] }) => {
  draft.value = detail.draft;
  sections.value = detail.sections;
  try {
    const parsed = JSON.parse(detail.draft.keywords_json) as Record<string, unknown>;
    const next: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) if (typeof v === "string") next[k] = v;
    keywords.value = next;
  } catch {
    keywords.value = {};
  }
};

const loadTemplates = async (direction: DraftDirection) => {
  templates.value = await listClauseTemplates(direction);
};

const onCreate = async (payload: { direction: DraftDirection; title: string; counterparty_name: string }) => {
  const detail = await createDraft(payload);
  applyDetail(detail);
  await loadTemplates(detail.draft.direction);
  await router.replace({ query: { id: String(detail.draft.id) } });
};

const saveDraftMeta = async () => {
  if (!draft.value) return;
  saving.value = true;
  try {
    const res = await updateDraft(draft.value.id, {
      title: draft.value.title,
      project_id: draft.value.project_id ?? undefined,
      entity_id: draft.value.entity_id ?? undefined,
      counterparty_name: draft.value.counterparty_name,
      counterparty_credit_code: draft.value.counterparty_credit_code,
      counterparty_legal_person: draft.value.counterparty_legal_person,
      counterparty_address: draft.value.counterparty_address,
      counterparty_contact: draft.value.counterparty_contact,
      counterparty_phone: draft.value.counterparty_phone,
      counterparty_bank_name: draft.value.counterparty_bank_name,
      counterparty_bank_account: draft.value.counterparty_bank_account,
      keywords: keywords.value
    });
    draft.value = res.draft;
    if (res.keyword_findings.length) {
      ElMessage.warning(res.keyword_findings.map(f => f.reason).join("；"));
    } else {
      ElMessage.success("已保存");
    }
  } finally {
    saving.value = false;
  }
};

const refreshSection = (section: ContractDraftSection | null) => {
  if (!section) return;
  sections.value = sections.value.map(s => (s.id === section.id ? section : s));
};

const onGenerate = async (payload: { sectionId: number; instruction: string }) => {
  if (!draft.value) return;
  refreshSection(await ai.generateForSection(draft.value.id, payload.sectionId, payload.instruction));
};

const onReview = async (sectionId: number) => {
  if (!draft.value) return;
  refreshSection(await ai.reviewForSection(draft.value.id, sectionId));
};

const onSave = async (payload: { sectionId: number; content: string }) => {
  if (!draft.value) return;
  refreshSection(await updateSection(draft.value.id, payload.sectionId, { content: payload.content }));
  ElMessage.success("已保存该节");
};

const onAddSection = async (payload: { section_key?: string; title?: string }) => {
  if (!draft.value) return;
  const section = await apiAddSection(draft.value.id, payload);
  sections.value = [...sections.value, section].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
};

const onRemoveSection = async (sectionId: number) => {
  if (!draft.value) return;
  await removeSection(draft.value.id, sectionId);
  sections.value = sections.value.filter(s => s.id !== sectionId);
};

const onMoveSection = async (payload: { id: number; delta: -1 | 1 }) => {
  if (!draft.value) return;
  const idx = sections.value.findIndex(s => s.id === payload.id);
  const swapIdx = idx + payload.delta;
  if (idx < 0 || swapIdx < 0 || swapIdx >= sections.value.length) return;
  const a = sections.value[idx];
  const b = sections.value[swapIdx];
  const [updatedA, updatedB] = await Promise.all([
    updateSection(draft.value.id, a.id, { sort_order: b.sort_order }),
    updateSection(draft.value.id, b.id, { sort_order: a.sort_order })
  ]);
  sections.value = sections.value
    .map(s => (s.id === updatedA.id ? updatedA : s.id === updatedB.id ? updatedB : s))
    .sort((x, y) => x.sort_order - y.sort_order || x.id - y.id);
};

const runCompleteness = async () => {
  if (!draft.value) return;
  checking.value = true;
  try {
    await requestCompleteness(draft.value.id);
    // 轮询草稿完整性状态（沿用 2s × 60 次）
    for (let i = 0; i < 60; i++) {
      const detail = await getDraft(draft.value.id);
      if (detail.draft.completeness_status === "done") {
        applyDetail(detail);
        try {
          const parsed = JSON.parse(detail.draft.completeness_result_json ?? "{}") as {
            missing?: MissingHint[];
          };
          missingHints.value = parsed.missing ?? [];
        } catch {
          missingHints.value = [];
        }
        completenessVisible.value = true;
        return;
      }
      if (detail.draft.completeness_status === "error") {
        ElMessage.error("完整性检查失败，请重试");
        return;
      }
      await new Promise(r => setTimeout(r, 2000));
    }
    ElMessage.error("完整性检查超时，请重试");
  } finally {
    checking.value = false;
  }
};

const onHintAdd = async (sectionKey: string) => {
  await onAddSection({ section_key: sectionKey });
  missingHints.value = missingHints.value.filter(m => m.section_key !== sectionKey);
};

const onHintIgnore = async (sectionKey: string) => {
  if (!draft.value) return;
  await ignoreCompletenessHint(draft.value.id, sectionKey);
  const detail = await getDraft(draft.value.id);
  applyDetail(detail);
};

const onSelectSection = (id: number) => {
  activeSectionId.value = id;
  document.getElementById(`section-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
};

onMounted(async () => {
  await Promise.all([
    loadProjects(),
    listEntities({ status: "active" }).then(res => (entities.value = res.data))
  ]);
  const id = Number(route.query.id);
  if (Number.isInteger(id) && id > 0) {
    const detail = await getDraft(id);
    applyDetail(detail);
    await loadTemplates(detail.draft.direction);
  }
});
</script>

<template>
  <div class="draft-page">
    <DraftInitCard v-if="!draft" @create="onCreate" />
    <template v-else>
      <el-row :gutter="12">
        <el-col :span="8">
          <el-card class="meta-card">
            <template #header>
              <div class="meta-header">
                <span>{{ draft.direction === "inbound" ? "对甲方合同" : "对分包商合同" }}</span>
                <el-button size="small" type="primary" :loading="saving" @click="saveDraftMeta">保存信息</el-button>
              </div>
            </template>
            <el-form label-width="96px" size="small">
              <el-form-item label="草稿标题">
                <el-input v-model="draft.title" maxlength="120" />
              </el-form-item>
              <el-form-item label="关联项目">
                <el-select v-model="draft.project_id" clearable filterable style="width: 100%">
                  <el-option v-for="p in projects" :key="p.id" :value="p.id" :label="p.project_name" />
                </el-select>
              </el-form-item>
              <el-form-item label="我方主体">
                <el-select v-model="draft.entity_id" clearable filterable style="width: 100%">
                  <el-option v-for="e in entities" :key="e.id" :value="e.id" :label="e.entity_name" />
                </el-select>
              </el-form-item>
              <el-form-item label="对方单位">
                <el-input v-model="draft.counterparty_name" maxlength="120" />
              </el-form-item>
              <el-form-item label="信用代码">
                <el-input v-model="draft.counterparty_credit_code" maxlength="32" />
              </el-form-item>
              <el-form-item label="法定代表人">
                <el-input v-model="draft.counterparty_legal_person" maxlength="60" />
              </el-form-item>
              <el-form-item label="对方地址">
                <el-input v-model="draft.counterparty_address" maxlength="200" />
              </el-form-item>
              <el-divider>合同关键字</el-divider>
              <el-form-item v-for="f in KEYWORD_FIELDS" :key="f.key" :label="f.label">
                <el-input v-model="keywords[f.key]" />
              </el-form-item>
            </el-form>
          </el-card>
          <SectionListPanel
            :sections="sections"
            :templates="templates"
            :active-id="activeSectionId"
            @select="onSelectSection"
            @add="onAddSection"
            @remove="onRemoveSection"
            @move="onMoveSection"
          />
        </el-col>
        <el-col :span="16">
          <div class="toolbar">
            <el-alert
              type="info"
              :closable="false"
              title="AI 辅助起草的内容为草稿，须经负责人审核后方可作为正式合同使用"
            />
            <el-button type="warning" plain :loading="checking" @click="runCompleteness">
              完整性检查
            </el-button>
          </div>
          <SectionCard
            v-for="s in sections"
            :key="s.id"
            :section="s"
            :keyword-values="keywordValues"
            :ai-state="ai.stateOf(s.id)"
            @generate="onGenerate"
            @review="onReview"
            @save="onSave"
          />
        </el-col>
      </el-row>
      <CompletenessDialog
        v-model:visible="completenessVisible"
        :missing="missingHints"
        :ignored="ignoredHints"
        @add="onHintAdd"
        @ignore="onHintIgnore"
      />
    </template>
  </div>
</template>

<style scoped>
.draft-page { padding: 12px; }
.meta-card { margin-bottom: 12px; }
.meta-header { display: flex; align-items: center; justify-content: space-between; }
.toolbar { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
.toolbar :deep(.el-alert) { flex: 1; }
.section-card { margin-bottom: 12px; }
</style>
```

- [ ] **Step 2: 路由注册（finance.ts 的 `ContractDetail` 条目之后插入）**

```ts
        {
          path: "/finance/contract/draft",
          name: "ContractDraftWorkbench",
          component: () => import("@/views/finance/contract/draft/index.vue"),
          meta: {
            title: "AI 合同起草",
            roles: ["super_admin", "manager", "finance"],
            showLink: false
          }
        },
```

- [ ] **Step 3: 合同列表页入口按钮**

`packages/web/src/views/finance/contract/index.vue`：在 L94 附近 `goCreate` 定义之后加：

```ts
const goDraft = () => {
  router.push("/finance/contract/draft");
};
```

在 L162 附近 `<el-button @click="goCreate">新建合同</el-button>` 之后加：

```html
<el-button type="success" plain @click="goDraft">AI 起草</el-button>
```

- [ ] **Step 4: 验证**

```bash
cd packages/web && pnpm typecheck && pnpm test && pnpm lint:eslint:check
```
Expected: 全部 PASS（lint 如报 prettier 格式问题先跑 `pnpm lint:prettier` 再复检）。

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/views/finance/contract/draft/index.vue packages/web/src/router/modules/finance.ts packages/web/src/views/finance/contract/index.vue
git commit -m "feat(web): AI合同起草流水线页与入口"
```

---

### Task 16: 本地端到端验证 + 文档同步

**Files:**
- Modify: `doc/开发计划.md`、`doc/UI设计文档.md`、`doc/开发记录.md`

- [ ] **Step 1: 全量静态检查**

```bash
cd packages/api && pnpm typecheck && pnpm lint && pnpm test
cd ../web && pnpm typecheck && pnpm test && pnpm lint:eslint:check
```
Expected: 全部 PASS。

- [ ] **Step 2: 本地端到端（MOCK 模式）**

```bash
# 终端 A
cd packages/api && pnpm dev
# 终端 B
cd packages/web && pnpm dev
```

浏览器打开 `http://localhost:8849`，登录后进入 财务中心 → 合同列表 → 「AI 起草」按钮，验证清单：
1. 创建 inbound 草稿 → 默认节自动加载（core+recommended，含 首部/工程概况/付款/落款 等）；
2. 任一节点击「默认生成」→ 状态变「生成中」→ 数秒内回填 mock 正文，`每逾期一日按每日千分之三支付违约金` 片段呈黄色高亮、hover 显示理由（mock 输出 + 规则层都会命中它）；
3. 填写「我方主体」「对方单位」后，正文中 `{{party_a}}`/`{{party_b}}` 占位符以关键字色显示为实际名称；
4. 「AI 交叉审查」→ 出现审查问题折叠面板（mock 返回 1 条黄色）；
5. 「完整性检查」→ 弹窗提示缺失节（mock 返回 geology_risk），「添加该节」后节列表出现该节，「忽略」后刷新不再出现；
6. 手工编辑某节保存 → source 变「手工编辑」；
7. 创建 outbound 草稿 → 默认节含 农民工工资支付/安全责任承担与追偿 等 outbound 专属节。

- [ ] **Step 3: 检查任务队列隐私清洗**

```bash
cd packages/api && npx wrangler d1 execute hybcdg-prod-db --local --command "SELECT task_type, status, payload_json, result_json FROM task_queue WHERE biz_type='contract_draft' ORDER BY id DESC LIMIT 5"
```
Expected: completed 任务的 payload_json 与 result_json 均为 `{}`。

- [ ] **Step 4: 文档同步**

- `doc/开发计划.md`：在最后一个 Phase 之后新增条目：

```markdown
### Phase 24：AI 合同起草（M1 已完成 / M2-M3 规划中）
- [x] M1：草稿数据模型（contract_draft 4 表）+ 双立场条款库（脱敏 seed）+ cf_ai 执行器（env.AI 直调，Unified Billing）+ contract-draft API + Web 逐节生成流水线页（双色高亮/交叉审查/完整性提示）
- [ ] M2：定稿转正式合同 + docx/PDF 导出（runner→R2 回传、中文字体）+ /upload/object 签名访问 + 审批闭环
- [ ] M3：小程序分包简化版 + 管理层反馈微调条款库
- 设计文档：docs/superpowers/specs/2026-07-22-contract-generation-design.md
```

- `doc/UI设计文档.md`：在合同管理章节（3.3 附近）末尾新增小节：

```markdown
#### AI 合同起草工作台（/finance/contract/draft）
- 入口：合同列表页「AI 起草」按钮；roles: super_admin / manager / finance。
- 布局：左列 = 草稿基本信息与关键字表单 + 条款节列表（增删/排序/状态徽标）；右列 = 逐节卡片（默认生成 / 按个性化指令生成 / AI 交叉审查 / 手工编辑）。
- 高亮：关键字占位符（primary 浅底）与风险片段（红/黄底 + hover 法条理由）双色体系；风险数据来自 AI 输出 + 规则层合并。
- 完整性检查：弹窗列缺失节（core 红 / recommended 黄），逐条「添加该节 / 忽略（留痕）」，只提示不阻塞。
- 页面常驻提示：AI 内容为草稿，须经负责人审核。定稿/导出/送审在 M2 提供。
```

- `doc/开发记录.md`：文件末尾 append（保持单文件 append-only 约定）：

```markdown
## 2026-07-XX AI 合同起草 M1
- 新增 contract_draft/contract_draft_section/contract_clause_template/contract_draft_revision 四表（0062），双立场条款库 seed（0063，源自两份顶管范本，已脱敏），cf_ai provider+提示词+路由 seed（0064）。
- cf_ai 执行链路：AI Slot createTask → Worker 内 env.AI.run 直调（Unified Billing，terra/sonnet-5 均衡交替、critic 异厂商、sol 停用）；三路触发（waitUntil/TASK_CREATED/cron 兜底）全部经 pending→running 原子抢占幂等；APP_ENV=local 走确定性 mock。
- 合规双层：规则层（废止法引用/背靠背/身份证号/质保金>3%/违约金畸高等）+ LLM 交叉审查；风险标注驱动前端红黄双色高亮。
- 注意：wrangler.toml [ai] binding 顶层与 env.prod 双段同步；生产上线前 owner 需在 CF dashboard 为 Unified Billing 充值 credits；生产迁移 0062-0064 需手动 --remote 先行。
```

（`2026-07-XX` 替换为实际完成日期。）

- [ ] **Step 5: 收尾 Commit**

```bash
git add doc/开发计划.md doc/UI设计文档.md doc/开发记录.md
git commit -m "docs: AI合同起草M1文档同步"
```

---

## 发布清单（M1 合入 main 时执行，不属于本计划自动步骤）

1. owner 在 CF dashboard 完成 Unified Billing credits 充值并设置消费上限（涉支付，须本人操作）；
2. `cd packages/api && npx wrangler d1 migrations apply hybcdg-prod-db --remote`（0062/0063/0064）；
3. push main（自动部署 ~90s）；
4. 验证 `https://api.hybcdg.com/api/v1/system/health` 返回 `ok=true`；
5. 生产冒烟：创建草稿 → 生成一节（真实模型）→ 检查 ai_audit_log 有 cf_ai 记录、task_queue 已清洗。

## Self-Review 结论（计划作者自查）

- 规格覆盖：spec §4 数据模型（Task 1）、§3 条款库与校验规则（Task 2/6）、§5 AI 链路（Task 3/4/5/7/8/9）、§6 Web 交互（Task 11-15）、§8 安全中 M1 范围项（指令限长、agent 令牌拒绝、任务清洗：Task 8/10）均有对应任务；§6 定稿与 §8 /upload/object 签名访问属 M2，已在"发布清单/不做"侧注明。
- 类型一致性：`RiskAnnotation` 前后端字段一致（text/level/reason/legal_basis/source）；task_type 三处登记（types/ai.ts、路由 seed、cf-ai.ts CF_AI_TASK_TYPES）名称一致；`completeTask` 的 nodeId 校验由执行器抢占时写入 `assigned_node_id = 'cf-ai-worker'` 满足。
- 已知留白（有意）：runner 节点 CAPABILITIES 不加新任务类型（cf_ai 任务不该被 Python 节点认领，这是设计而非遗漏）。

