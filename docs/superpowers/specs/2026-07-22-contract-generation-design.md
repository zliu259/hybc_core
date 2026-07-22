# AI 合同起草功能设计文档

- 日期：2026-07-22
- 状态：已获 owner 批准的设计（范本已提供并拆解；outbound 待管理层会议校准）
- **M2 范围修订（2026-07-22 owner）**：不做 PDF 导出（合同送对方审阅需可编辑 docx）；新增生产样本挖掘驱动的条款库 v2 与设备租赁族，见 `2026-07-22-contract-sample-findings.md` 与 M2 计划。
- 范围：packages/api + packages/web + packages/miniapp；新增 CF `[ai]` binding

## 1. 背景与目标

为顶管施工业务新增 AI 辅助合同起草功能。合同分两个方向：

- **对甲方（inbound，我方为乙方/承包方）**：条款必须明确、可执行、留证据，杜绝含糊表述，防止我方利益受损；
- **对分包商（outbound，我方为甲方/发包方）**：在合法边界内尽可能传导责任、避免给我方挖坑。

以《民法典》合同编为基准，不受法律保护的条款不得生成。产出物永远是**草稿**，人工确认、走审批后才成为正式合同（沿用仓库"AI 只出草稿"铁律）。

## 2. 已拍板决策（owner 确认，不再讨论）

1. **AI 通道**：CF AI 目录直调。wrangler 加 `[ai]` binding（顶层与 env.prod 双段同步 + types/env.ts），`env.AI.run()` 调第三方模型，Unified Billing 统一计费（CF dashboard 充值 credits，无需 OpenAI/Anthropic 平台 key）。保留 AI Slot createTask → task_queue 异步抽象，新 provider_key `cf_ai` 的任务由 **Worker 在 Queue 消费者内执行**，不经 Python task-runner；现有 contract_review 等 runner 任务不迁移。
2. **模型使用**：`openai/gpt-5.6-terra` 与 `anthropic/claude-sonnet-5` **均衡使用**；`openai/gpt-5.6-sol` 注册但停用（status=disabled，留待启用）。默认策略：起草按节在两模型间交替；合规交叉审查一律用与起草方**不同**的模型（异厂商 critic）。GPT-5.6 系用 Responses API 格式（input/instructions），Claude 用 Messages 格式，provider 层归一化。
3. **范本用法**：两者结合——范本拆成结构化条款库做骨架与合规拦截；AI 生成每节时附范本对应段落做风格参考。
4. **对方主体**：不建往来单位主数据表，结构化字段只存草稿表。
5. **小程序**：进分包，含轻量逐节编辑（单节默认指令重生成 + 采纳/跳过），定稿引导 web 端。
6. **section 全部可选装**：不同合同不需要全部 section，使用人可自由增删；**AI 负责遗漏风险提示**（不强制、不阻塞）。
7. **outbound 无范本**：先按 inbound 骨架镜像翻转生成初稿，owner 在管理层会议收集意见后微调两个方向。

## 3. 范本拆解结论

两份范本（济南长清 3 米顶管施工协议、聊城 1800 铁路顶管协议）中恒越百川**均为乙方**，即均为 inbound 方向。

### 3.1 section 骨架（条款库目录）

| # | section_key | 名称 | 必要级 | 说明 |
|---|---|---|---|---|
| 1 | parties_basis | 首部/当事人与签约依据 | core | 引《民法典》；涉铁路加《铁路法》《铁路运输安全保护条例》 |
| 2 | project_overview | 工程概况 | core | 顶管专业参数：管径×节长×壁厚、顶进长度、工艺（土压平衡等）、桩号/标段 |
| 3 | scope_interface | 承包方式与工作界面 | core | 默认分工：甲供管材/工作坑/接收坑/水电/土方外弃；乙供顶管机/起重/减阻材料/人员 |
| 4 | quantity_pricing | 工程量与计价 | core | 综合单价×长度、据实结算、含税口径 |
| 5 | duration | 工期 | core | 开竣工日期（校验：竣工不得早于开工） |
| 6 | quality_acceptance | 质量与验收 | core | 验收方式/时限；inbound 推荐"逾期不验收视为合格" |
| 7 | payment | 价款结算与支付 | core | 节点付款、进度款比例、尾款期限 |
| 8 | invoice_tax | 发票与税务 | recommended | 发票类型/税率/备注栏；校验：品目须与业务实质一致、只向合同相对方开票 |
| 9 | safety | 安全施工 | core | 铁路项目附"结合部安全管理"变体 |
| 10 | civilized_construction | 文明施工 | optional | |
| 11 | party_a_duties | 甲方责任义务 | core | |
| 12 | party_b_duties | 乙方责任义务 | core | |
| 13 | breach | 违约责任 | core | 从范本"散落在甲方责任里"独立成节；违约金畸高提示 |
| 14 | geology_risk | 地质条件与地下障碍物风险分担 | recommended | 范本缺失、顶管行业最大风险点；inbound 归甲方，outbound 限定分包商核实义务 |
| 15 | claim_visa | 签证与索赔程序 | recommended | 范本缺失；程序与时限 |
| 16 | force_majeure | 不可抗力与工期顺延 | recommended | 范本缺失 |
| 17 | idle_compensation | 停窝工补偿 | optional | 范本仅有雏形（管材供应不足费用甲方担），扩展成完整条款 |
| 18 | handover_protection | 成品保护与移交 | optional | |
| 19 | insurance | 保险 | optional | |
| 20 | dispute | 争议解决 | core | inbound 备选：我方所在地法院/仲裁；标注"工程所在地法院"对乙方不利 |
| 21 | misc_effective | 其他与生效 | core | 份数、扫描传真件效力、未尽事宜 |
| 22 | signature_block | 落款 | core | 双方全要素：地址/税号/法人/开户行/账号/联系人/日期 |

outbound 专属节（镜像时新增）：农民工工资专用账户与实名制（outbound 为 core——《保障农民工工资支付条例》）、履约保证金、安全责任合法传导与内部追偿、我方单方解除情形清单、反索赔。

必要级语义：core=缺失时 AI 强提示（民法典 §470 建议条款 + 业务必备）；recommended=缺失时按合同参数条件提示（如顶管项目缺 geology_risk）；optional=不提示。**任何级别都不阻塞定稿**，忽略提示留痕。

### 3.2 范本瑕疵 → 自动校验规则

范本不能照抄，以下瑕疵转化为生成/定稿校验规则：

| 瑕疵（来源） | 规则 |
|---|---|
| 引用已废止《合同法》（济南范本） | 法律引用白名单：民法典及现行法；出现已废止法律名 → 拦截替换 |
| 工期倒挂：竣工早于开工（济南范本） | 日期逻辑校验：竣工≥开工；签约日期合理性 |
| 向第三方直接开票（济南范本） | 三流一致校验：发票抬头必须为合同相对方，第三方开票 → 红色风险标注 |
| 顶管施工开 1% 机械租赁发票（聊城范本） | 发票品目与业务实质匹配校验（建筑服务 9%/简易 3% 白名单），不符 → 风险标注 |
| 正文固化个人身份证号（济南范本） | 个人信息字段一律占位符化，禁止 AI 生成具体证件号 |
| 逾期付款违约金日千分之三（济南范本） | 违约金水平提示：年化折算显著超损失预期（参考 §585 调减风险）→ 黄色提示，不拦截 |

### 3.3 无效条款黑名单（生成硬拦截）

- §506：免除人身损害责任、免除故意/重大过失财产损失责任的免责条款；
- §496–497 格式条款：不合理免除己方责任/排除对方主要权利（生成时避免，检测到 → 红色标注+改写建议）；
- 转包、违法分包、肢解发包表述（《建筑法》§28–29）；借用资质安排；
- "背靠背"付款条款（业主付款为付款前提）——最高法 2024 批复对中小企业无效；outbound 改写为"合理付款期限+对账节点"；
- 质保金超过结算总额 3% 的部分；
- 安全生产责任转移给分包（只能约定内部追偿）。

黑名单实现为规则层（关键词/模式）+ LLM 合规审查双层；规则层在 Worker 内同步执行，LLM 层为异步任务。

### 3.4 脱敏要求

条款库 seed 与风格参考段**必须脱敏**：范本中的真实单位名、账号、身份证号、联系人全部替换为占位符后再入库/上 R2。范本原始文件不入 git 仓库。

## 4. 数据模型（新迁移，编号以实施时最新为准，当前预计 0062+）

- **contract_draft**：草稿主表。direction(inbound/outbound)、project_id、entity_id（我方主体）、对方结构化字段（counterparty_name/credit_code/legal_person/address/contact/phone/bank_name/bank_account）、关键字 JSON（sign_date 等占位符值）、status（drafting→generating→reviewing→finalized→converted）、converted_contract_id、created_by_userid、软删除。
- **contract_draft_section**：节表。draft_id、section_key、title、source(default_template/ai_generated/manual)、instruction（个性化指令，限长）、content、risk_annotations_json（span+等级+理由+法条）、ai_task_id、status(pending/generating/done/error/accepted)、sort_order。
- **contract_clause_template**：条款库。section_key、direction_variant(inbound/outbound/both)、必要级、title、body_template（占位符文案）、style_ref（范本对应段落，脱敏后）、risk_notes、compliance_rules_json、version、status。
- **contract_draft_revision**：版本快照。draft_id、sections 快照 JSON、trigger(regenerate/manual_edit/finalize)、created_by。
- 占位符集：`{{party_a}} {{party_b}} {{party_a_*}} {{party_b_*}}（credit_code/legal_person/address/bank…） {{project_name}} {{location}} {{amount}} {{amount_cn}} {{unit_price}} {{length}} {{pipe_spec}} {{start_date}} {{end_date}} {{sign_date}}`。金额大写后端 amount-cn.ts 生成；正式合同号在转 contract 时经 serial.ts 生成，草稿不占号。

## 5. AI 执行链路

1. 入队：业务路由调 ai-slot `createTask`，新增 task_type：`contract_draft_section`（逐节起草）、`contract_compliance_review`（合规交叉审）、`contract_completeness_check`（遗漏提示）。三类均登记 types/ai.ts taskTypes；**不加入** runner CAPABILITIES（Python 节点永不认领）。
2. 执行：queue-handler 消费 TASK_CREATED，对 provider 解析为 `cf_ai` 的任务：条件 UPDATE 抢占（pending→running，抢不到即已被处理，跳过，保证 Queue 重投幂等）→ `env.AI.run()` → completeTask/failTask（审计落 ai_audit_log 不变）。超时/重试沿用 cron checkTimeouts + max_retries。
3. 模型归一层：`services/cf-ai-provider.ts` 封装两种请求格式（Responses/Messages）与输出解析；max_output_tokens 默认 8192、按任务可配；模型选择读配置（均衡交替 + critic 异厂商），sol 配置存在但 disabled。
4. 提示词：ai_prompt_template 三条模板（{{var}} 插值），admin seed 迁移，线上可热更。
5. 本地开发：MOCK_AI_ONLY=true 时 Worker 执行器返回确定性 mock（不调 env.AI），三类任务各一个 mock 分支。
6. 隐私：section 采纳后清对应 task_queue payload/result（照 bidding-dedup 终态清洗模式）。
7. 前置条件（owner 本人操作）：CF dashboard 为 Unified Billing 充值 credits 并配置消费上限/自动补充。

## 6. Web 端（packages/web）

目录 `views/finance/contract/draft/{components,composables,lib}`（仿 bidding/dedup 分层，单文件 ≤400 行）。

- **入口**：合同列表页"AI 起草"按钮 + 路由 `/finance/contract/draft`（roles: super_admin/manager/finance）。
- **流水线页**：左侧 section 列表（从条款库按 direction 预载默认集合；可增删、排序、从库中追加、自建空白节；每节状态徽标），右侧组装预览。
- **逐节生成**：每节独立入队/轮询（useContractDraftAI，照 useDedupAI 的 request→poll→accept/skip）；默认指令一键生成，或输入个性化指令生成；失败单节重试。
- **双色高亮**：占位符关键字一种颜色（点击定位到关键字表单联动编辑）；风险 span 另一种颜色（数据来自 risk_annotations_json，hover 展示理由+法条）。复用 dedup 句级分段高亮方案，无新依赖。
- **遗漏提示**：定稿前触发 `contract_completeness_check`，返回缺失节清单+风险说明，展示为可逐条"添加该节/忽略"的面板；忽略写入 draft 留痕。
- **定稿**（属 M2）：固化占位符（含后端大写金额）→ 生成 docx（web 端 docx 库 buildDocxBuffer；PDF 由 runner 生成）→ 上传 R2 挂附件 → 创建 contract（direction 对应）→ 自动触发既有 contract_review → submit-approval（幂等键沿用现有模式）。
- 提交类端点带 Idempotency-Key；审批锁复用 approvalLock。

## 7. 小程序端（packages/miniapp）

- 新分包页（沿用 packageFinance 或新 packageContract），入口加"流程"页 applyActions 卡片；主包零新增全局资源。
- 流程：选方向 → 选项目/我方主体（hy-search-picker）→ 填对方与关键字段 → 默认 section 集合直接发起整单生成（逐节任务后台串行）→ 节列表页（状态、**单节默认指令重生成、采纳/跳过**）→ 预览页（view/text 分段渲染，风险节标色块；不做 span 级高亮）→ 引导 web 端定稿。
- 轮询照 voice-assistant 模式；个性化指令、节增删排序不做。tdesign chat-markdown 仅作备选，启用前须真机实测主包体积。

## 8. 安全

- `GET /upload/object/:key` 现状无认证：合同文书落 R2 前，为其 category 启用签名访问（M2 完成，参考 warehouse-evidence-access 模式）。
- 个性化指令限长（≤500 字）+ 模式清洗，防 prompt 注入；AI 输出渲染前 sanitize，不引入 v-html。
- 生成文档带"AI 辅助起草，须经负责人审核"标注。
- 审计：ai_audit_log 自动；draft 的生成/采纳/忽略提示/定稿动作写业务审计。

## 9. 里程碑

- **M1**：迁移（4 张表+字典+提示词 seed）+ 条款库 seed（inbound 拆解 + outbound 镜像初稿）+ `[ai]` binding 与 cf_ai 执行器 + draft API + web 流水线页（生成/编辑/高亮/遗漏提示）。
- **M2**：定稿转正式合同 + docx 导出（web 端生成）+ PDF 导出（runner→R2 回传通道、中文字体）+ `/upload/object` 签名访问 + 审批闭环。
- **M3**：小程序分包页 + 管理层会议反馈微调条款库（inbound/outbound 双向）+ 模型权重调优。
- 文档同步（实施时）：doc/开发计划.md 新增条目、doc/UI设计文档.md 新增章节、doc/开发记录.md 追加。

## 10. 测试

- web：lib/composables 全部 vitest（高亮分段、占位符联动、轮询状态机），~80% 覆盖目标；
- api：校验规则纯函数（黑名单/日期/发票规则）独立模块+单测（仿 contract-amount-change-floor.ts 模式）；cf_ai 执行器幂等抢占测试；
- 本地端到端：MOCK_AI_ONLY mock 分支跑通 生成→采纳→定稿 全流程。

## 11. 明确不做（本期）

- 电子签章/在线签署（导出后线下用印）；
- 往来单位主数据表；
- MCP 侧暴露起草能力（属 P3，须遵循 park→confirm→replay）；
- 法律条文 RAG 知识库（合规逻辑编码在条款库元数据+提示词+规则校验中）；
- 现有 runner 任务迁移到 cf_ai 通道。
