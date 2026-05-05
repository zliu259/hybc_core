# UI 设计文档（页面级）

## 1. 文档定位与指向
- 本文档为页面级 UI 设计规范，覆盖 Web 管理端与企业微信小程序。
- Web 代码主目录：`packages/web/src`
- 小程序代码主目录：`packages/miniapp`
- 后端接口前缀统一：`/api/v1`

## 2. 全局设计语言

### 2.1 风格目标
- 关键词：工程化、可信、稳重、高信息密度。
- 设计原则：先可读、再效率、后风格；高风险操作优先防误触。

### 2.2 视觉 Tokens
- 背景：`#f4f1ea`
- 卡片：`#fffaf2`
- 主文字：`#2a241d`
- 次文字：`#6e6458`
- 强调色：`#2f6c5f`
- 边框：`#d9ceb9`
- 成功：`#2f7a53`
- 警告：`#c4872b`
- 危险：`#bd3f3f`
- 信息：`#2d5f9a`

### 2.3 排版与布局
- 字体：`Noto Sans SC`, `PingFang SC`, sans-serif
- H1: 32-36；H2: 24-28；H3: 18-20；正文：14-16
- 表格行高：40-44
- 响应断点：`>=1200`、`768-1199`、`<768`

## 3. Web 页面级规范（PureAdmin）

### 3.1 页面总索引（必须有明确文件指向）
- 个人工作台首页：`packages/web/src/views/welcome/index.vue`
- 个人工作台-我的申请：`packages/web/src/views/workspace/my-applications/index.vue`
- 工作台我的报销提交：`packages/web/src/views/workspace/reimbursement/list.vue`
- 仪表盘：`packages/web/src/views/dashboard/index.vue`
- 实体管理：`packages/web/src/views/entity/index.vue`
- 财务中心-实体资料管理：`packages/web/src/views/entity/index.vue`（路由：`/finance/entity/profile`）
- 数据字典管理：`packages/web/src/views/dict/index.vue`
- 项目列表：`packages/web/src/views/project/list.vue`
- 项目选择大厅：`packages/web/src/views/project/hub.vue`
- 项目立项：`packages/web/src/views/project/create.vue`
- 项目详情：`packages/web/src/views/project/detail.vue`
- 企业微信通讯录：`packages/web/src/views/wecom/contacts.vue`
- 企业微信成员查看（管理员）：`packages/web/src/views/wecom/member-admin.vue`
- 企业微信 JS-SDK 能力台：`packages/web/src/views/wecom/sdk.vue`
- 合同管理列表：`packages/web/src/views/finance/contract/index.vue`
- 合同执行监控大屏：`packages/web/src/views/finance/contract/monitor.vue`
- 合同详情/创建：`packages/web/src/views/finance/contract/detail.vue`
- 对外付款申请列表：`packages/web/src/views/finance/payment/index.vue`
- 资金流出智能发单台：`packages/web/src/views/finance/payment/wizard.vue`
- 对外付款申请详情：`packages/web/src/views/finance/payment/detail.vue`
- 收款人管理：`packages/web/src/views/finance/payee/index.vue`
  - 个人工作台路径 `/workspace/payee` 下仅显示“与当前账号姓名匹配”的内部收款人记录（服务端按 `nickname/username` 与收款人姓名匹配过滤）。
- 报销处理列表：`packages/web/src/views/finance/reimbursement/list.vue`
- 报销信封生成器（正式离线版）：`packages/web/src/views/finance/reimbursement/envelope-generator.vue`
- 报销详情：`packages/web/src/views/finance/reimbursement/detail.vue`
- 报销预审工作台：`packages/web/src/views/finance/reimbursement/precheck.vue`
- 报销查重中心：`packages/web/src/views/finance/reimbursement/duplicate.vue`
- 报销集中审批批次列表：`packages/web/src/views/finance/reimbursement/batch.vue`
- 报内报销集中打款台：`packages/web/src/views/finance/reimbursement/payout.vue`
- 报销集中审批批次详情：`packages/web/src/views/finance/reimbursement/batch-detail.vue`
- 收款合同管理：`packages/web/src/views/finance/receipt/contract.vue`
- 发票管理：`packages/web/src/views/finance/receipt/invoice.vue`
- 收款登记列表：`packages/web/src/views/finance/receipt/list.vue`
- 收款统计仪表盘：`packages/web/src/views/finance/receipt/dashboard.vue`
- 审批中心：`packages/web/src/views/approval/index.vue`
- 审批统一工作台：`packages/web/src/views/approval/unified-tasklist.vue`
- 资产任务中心（复用审批统一工作台资产模式）：`packages/web/src/views/approval/unified-tasklist.vue`
- 审批监控台（超管）：`packages/web/src/views/approval/admin-monitor.vue`
- 审批详情：`packages/web/src/views/approval/detail.vue`
- 审批模板配置：`packages/web/src/views/approval/template-config.vue`
- 金额阈值配置：`packages/web/src/views/approval/threshold-config.vue`
- AI配置管理：`packages/web/src/views/ai/config.vue`
- 计算节点监控与Runner运行参数：`packages/web/src/views/ai/nodes.vue`
- AI关卡任务管理（超管）：`packages/web/src/views/admin/ai-gate-tasks.vue`
- 企微推送监控（超管）：`packages/web/src/views/admin/wecom-push-monitor.vue`
  - 新增“扫描当前节点并强制推送”按钮，调用 `POST /api/v1/admin/wecom-push/force-current-nodes`，用于对当前所有在途审批节点待办执行强制推送。
- 资产台账：`packages/web/src/views/asset/list.vue`
- 资产运维看板：`packages/web/src/views/asset/ledger.vue`
- 资产详情：`packages/web/src/views/asset/detail.vue`
- 设备总览：`packages/web/src/views/asset/dashboard.vue`
- 仓库管理：`packages/web/src/views/warehouse/index.vue`
- 库房总控台：`packages/web/src/views/warehouse/control-center.vue`
- 库房任务调度台：`packages/web/src/views/warehouse/task-dispatch.vue`
- 返库检查维护：`packages/web/src/views/warehouse/return-maintenance.vue`
- 顶管机组合方案台：`packages/web/src/views/warehouse/tbm-composition.vue`
- 操作手册库：`packages/web/src/views/warehouse/manual-library.vue`
- 仓库库存：`packages/web/src/views/warehouse/inventory.vue`
- 库存预警中心：`packages/web/src/views/warehouse/alert.vue`
- 出入库单管理：`packages/web/src/views/warehouse/stock-order.vue`
- 出入库调度看板：`packages/web/src/views/warehouse/dispatch.vue`
- 资产工单中心：`packages/web/src/views/warehouse/work-order.vue`
- 消耗品管理总览：`packages/web/src/views/warehouse/consumables.vue`
- 公司资产盘库：`packages/web/src/views/warehouse/stocktake.vue`
- 项目设备规划：`packages/web/src/views/warehouse/equipment-plan.vue`
- 项目设备视图：`packages/web/src/views/project/equipment-view.vue`
- 操作员日志列表：`packages/web/src/views/construction/operator-log/list.vue`
- 操作员日志填报：`packages/web/src/views/construction/operator-log/form.vue`
- 管理员日志：`packages/web/src/views/construction/manager-log/index.vue`
- 贯通报告：`packages/web/src/views/construction/breakthrough-report/index.vue`
- 现场勘查：`packages/web/src/views/construction/site-survey/index.vue`
- 日志公示看板：`packages/web/src/views/construction/dashboard.vue`
- 进度预警视图：`packages/web/src/views/construction/progress-alert.vue`
- 系统配置：`packages/web/src/views/admin/system.vue`
- 全局技术支持抽屉：`packages/web/src/layout/components/lay-support/index.vue`

### 3.2 页面模板规范
- 列表页模板：`页面标题区 + 筛选区 + 表格区 + 分页区`
- 详情页模板：`主信息区 + 审批轨迹区 + 风险区 + 底部动作条`
- 表单页模板：`分组表单 + 联动校验 + 提交结果反馈`

### 3.3 页面逐项要求

#### A. 仪表盘 `views/dashboard/index.vue`
- KPI 区：应付、应收、报销待办、审批待办。
- 趋势区：周/月趋势图。
- 风险区：AI 风险结论与规则告警分栏展示。
- API 指向：`/api/v1/dashboard/*`

#### B. 项目列表 `views/project/list.vue`
- 固定筛选：项目状态、时间范围、项目经理。
- 表格列：项目编号、名称、状态、进度、负责人、更新时间。
- 行操作：查看详情、编辑、归档（归档二次确认）。
- API 指向：`/api/v1/project`

#### C. 项目详情 `views/project/detail.vue`
- 上区：项目主信息卡。
- 中区：标段、里程碑、财务摘要。
- 下区：关联单据与事件时间线。
- API 指向：`/api/v1/project/:id`, `/api/v1/project/:id/financial-summary`

#### D. 合同管理 `views/finance/contract/index.vue`
- 固定筛选：合同方向、项目、状态、关键字。
- 表格列：合同号、方向、对方单位、合同类型、总额、已付、剩余、状态、AI审查状态。
- 行操作：查看详情、软删除。
- API 指向：`/api/v1/contract`

#### E. 合同详情 `views/finance/contract/detail.vue`
- 表单区：方向、项目、实体、对方单位、类型、经办人、日期、金额、附件、备注。
- 摘要区：合同总额、已付金额、剩余额度。
- AI区：审查状态、风险等级、分数、总结、建议。
- API 指向：`/api/v1/contract/:id`, `/api/v1/contract/:id/ai-review`

#### F. 对外付款申请列表 `views/finance/payment/index.vue`
- 固定筛选：合同号、项目、审批状态、金额区间。
- 表格列：申请单号、合同号、金额、申请人、付款方式（中文）、状态、提交时间、支付时间。
- 强约束：超额风险标红并显示剩余额度。
- 状态筛选支持显式查看“已取消/已废止”记录（选择 `cancelled` 时返回该状态列表）。
- API 指向：`/api/v1/payment`

#### G. 对外付款申请详情 `views/finance/payment/detail.vue`
- 左侧：申请信息、合同信息、附件。
- 右侧：审批轨迹、风险评估报告。
- 付款执行：`已审批`状态下登记支付日期、支付流水号、付款账户、付款备注并标记付款。
- 底部动作：通过/拒绝/退回/转签（必须填写意见）、标记付款。
- 审批中显示“付款主体与账户调整”操作区（随审批流展示，不再依赖 `available_actions` 才可见），避免审批人看不到付款实体/账户选择控件。
- 支持从付款详情直接跳转到对应审批详情（`/approval/detail/:id`），用于条目状态不一致时快速核对：`packages/web/src/views/finance/payment/detail.vue`
- 付款附件预览统一改为抽屉模式（`el-drawer`），在详情页内完成预览与下载：`packages/web/src/views/finance/payment/detail.vue`
- API 指向：`/api/v1/payment/:id`, `/api/v1/payment/:id/mark-paid`, `/api/v1/approval/:id/*`

#### H. 收款人管理 `views/finance/payee/index.vue`
- 双标签页：外部收款人/内部收款人。
- 表格列：名称、开户行、账号、电话、创建时间。
- 操作：新增、编辑、软删除。
- API 指向：`/api/v1/payment/payee/*`

#### F. 报销处理列表 `views/finance/reimbursement/list.vue`
- 展示维度：信封编号、项目、填报人（姓名）、金额、状态、PDF状态。
- 默认打开首个标签“报销提交”，并区分入口语义：
  - 工作台入口：展示“我的提交”；
  - 财务中心入口：展示全部报销提交（办公室/领导可查看全量并代员工发起）。
- 角色化流程视图：
  - 报销提交：统一提交视图（含代员工发起入口）
  - 办公室：处理与审查（复核提示/智能核查/收件核查）
  - 财务与领导：集中审批与历史
- 支持入口：UUID快速打开信封（办公室）、进入详情执行登记/提交/收件核查/预审动作。
- 页面收敛：移除“批量生成未登记信封”入口，实体信封由办公室线下发放并通过 UUID 入流。
- 员工视图收敛为单一“发起报销”按钮，不再提供独立“电子发票上传”与“扫码/输入UUID打开信封”重复入口。
- 功能融合：复核提示、智能核查、复核通过/补充/驳回直接并入业务列表操作，不再依赖独立功能页。
- 报销处理页（财务中心入口）常驻“信封生成器”按钮，避免因分段切换看不到入口。
- 页面信息架构收敛为“顶部标题/动作 + 摘要指标 + 筛选面板 + 表格区”，将角色说明并入页面副标题，避免提示条、筛选项、动作按钮混排造成首屏复杂：`packages/web/src/views/finance/reimbursement/list.vue`
- 报销提交列表默认隐藏 `cancelled` 记录；仅在状态筛选显式选择“已废止”时展示：`packages/web/src/views/finance/reimbursement/list.vue`、`packages/web/src/api/reimbursement.ts`、`packages/api/src/routes/reimbursement.ts`
- 报销提交列表“状态”筛选支持多选，前端将多选状态合并为逗号参数传递，后端按 `IN` 条件过滤，避免多选后筛选报错：`packages/web/src/views/finance/reimbursement/list.vue`、`packages/web/src/views/workspace/reimbursement/list.vue`、`packages/web/src/api/reimbursement.ts`、`packages/api/src/routes/reimbursement.ts`
- 报销集中审批中心候选条目改为“后端强约束可送审清单”：仅返回 `status=received + precheck_status=approved + batch_id IS NULL` 且项目/被报销人匹配的条目，避免草稿/待审批/已提交条目混入候选并导致重复批次审批：`packages/web/src/views/finance/reimbursement/batch.vue`、`packages/web/src/api/reimbursement.ts`、`packages/api/src/routes/reimbursement.ts`
- 员工侧不再暴露 OCR/异常检测/预审 等技术步骤名词；员工仅看到“提交后后台静默核查”的业务提示：`packages/web/src/views/workspace/reimbursement/list.vue`、`packages/web/src/views/finance/reimbursement/detail.vue`、`packages/miniapp/pages/reimbursement/index.{js,wxml}`
- API 指向：`/api/v1/reimbursement`, `/api/v1/reimbursement/:id/trigger-anomaly-check`, `/api/v1/reimbursement/:id/precheck`

#### F-1. 报销信封生成器（正式离线版） `views/finance/reimbursement/envelope-generator.vue`
- 本地离线生成：在浏览器端批量生成 UUID4 与二维码，不调用后端生成接口。
- 参数输入：生成数量、统一输出尺寸（纸张/信封共用一个尺寸入口，支持常见尺寸与自定义）。
- 支持自定义标题与横向/纵向打印方向选择。
- 结果布局：每份仅包含二维码与 UUID 字符串，不显示“报销信封1/2”等序号文案；并预留“封装日期____年__月__日、签收日期____年__月__日、填报人”填写位。
- 输出能力：支持横向或纵向直接生成 PDF、PDF 打印（新窗口打印）；同时支持导出 CSV 与导入/导出批次 JSON（用于离线复打与跨设备交接）。
- 排版细节：二维码尺寸下调；UUID 字号与正文一致，提升人工核对可读性。

#### F-2. 报销详情 `views/finance/reimbursement/detail.vue`
- 页面分区：基础信息、信封标识、状态总览、附件（拖拽上传）、操作区。
- 表单区：项目、填报人、通道、费用日期、金额、类别、说明。
- 附件区：拖拽上传替代 JSON 手工录入；附件列表展示类型、文件名、大小、状态。
  - 附件操作区提供显式“下载”按钮（不再依赖点击文件名跳转），避免在工作台路由下误跳转。
- UUID 规则：
  - “报销识别号”与 `envelope_uuid` 统一；
  - 创建态支持“绑定现有信封UUID”（预打印离线信封）；
  - 实物信封创建强制提供 UUID（输入或扫码），无 UUID 不允许建单；
  - 非创建态在附件已入库或非草稿时视为锁定。
- 状态总览统一中文化显示（状态、核对状态、复核状态、PDF状态）；员工工作台路由下隐藏技术处理状态，仅保留业务状态。
- 审计与签收：
  - 员工提交后才进入后台静默核查；识别结果与智能核查结果仅作为办公室处理提示，不得覆盖员工原始填报内容；
  - 电子发票上传后保留草稿态，提交后进入办公室核查流，核查通过后才签收（`received`）；
  - 实物信封需办公室收到并核查后签收。
- 查重强制：
  - 存在查重风险时，申请人需“坚持提交”后才允许进入办公室预审通过；
  - 页面显示审计提示，办公室侧可见坚持提交标记并执行复核。
- 操作区收敛：保存、实物扫码登记、实物提交、办公室核查签收/异常、复核动作；员工端不再展示 OCR 刷新一类技术按钮。
- 提交入口补齐：电子发票通道在 `draft/submitted` 状态同样显示“提交电子发票报销”，避免仅见“保存”不见“提交”的操作断层。
- UUID 逻辑对齐 miniapp：创建态下若通道为“电子发票”，绑定 UUID 输入禁用并自动清空，创建请求不传 `preferred_envelope_uuid`，由后端自动生成。
- 提交流程统一：`POST /api/v1/reimbursement/:id/submit` 对实物/电子通道均可执行（前提满足附件、状态、权限校验），避免电子通道点击提交时报 400。
- 超管废止能力：报销详情新增“废止报销提交”动作（仅 `super_admin` 可见），可对 `draft/submitted/received/unregistered` 状态执行废止，废止后状态为 `cancelled`：`packages/web/src/views/finance/reimbursement/detail.vue`、`packages/api/src/routes/reimbursement.ts`
- 办公室修正能力：办公室角色（super_admin/manager/site_manager/finance）可在报销 `submitted/received` 状态对员工提交信息进行修正并保存：`packages/web/src/views/finance/reimbursement/detail.vue`、`packages/api/src/routes/reimbursement.ts`
- 附件预览补齐：报销详情附件区新增“预览”操作，与“下载”并列，预览统一使用右侧抽屉（`el-drawer`）承载，不再打开新页面，支持办公室在详情页快速核查附件：`packages/web/src/views/finance/reimbursement/detail.vue`
- 详情页加载反馈：进入报销详情时，基础选项数据与详情数据回填阶段统一显示 loading，避免空白等待与旧数据残留感知：`packages/web/src/views/finance/reimbursement/detail.vue`
- 后台静默审查提示：办公室详情页新增“后台静默审查提示”区，展示识别建议与智能核查摘要，供办公室签收处理参考：`packages/web/src/views/finance/reimbursement/detail.vue`
- 详情页首屏新增状态摘要（当前状态、报销金额、报销通道、后台核查），后台静默审查与重复风险合并进折叠区，降低基础表单与审查信息同时展示的阅读压力：`packages/web/src/views/finance/reimbursement/detail.vue`
- API 指向：`/api/v1/reimbursement/:id`, `/api/v1/reimbursement/scan`, `/api/v1/reimbursement/:id/submit`, `/api/v1/reimbursement/verify`, `/api/v1/reimbursement/:id/generate-pdf`, `/api/v1/reimbursement/:id/ocr-status`, `/api/v1/reimbursement/:id/trigger-anomaly-check`, `/api/v1/reimbursement/:id/precheck`, `/api/v1/reimbursement/resolve/by-uuid`

#### F-3. 功能页融合说明（预审/查重）
- 原“预审工作台”“查重中心”已从对内付款主路由下线，功能融合进报销业务页（列表/详情/批次）以减少页面切换与理解成本。
- 预审与异常检测在报销列表直接可操作，批次详情继续承载 AI 审计与审批联动。

#### F-5. 报销集中审批批次列表 `views/finance/reimbursement/batch.vue`
- 新增“候选报销条目”工作区：按项目 + 申请人自动列出未完成报销，可一键自动勾选“已收件+复核通过”并创建后立即送审。
- 展示维度：批次号、项目、申报人、信封数、总金额、智能审核状态、审批状态。
- 创建并送审要求项目、被报销人、收款方式与候选条目；付款实体、付款账户、账户显示为可选项，可由审批人员在审批详情页补充。
- 新增“历史完成（财务/领导）”区域：展示已付款/已拒绝等过往批次，支持进入批次详情追踪。
- API 指向：`/api/v1/reimbursement/batch`

#### F-6. 报销集中审批批次详情 `views/finance/reimbursement/batch-detail.vue`
- 展示维度：批次信息、智能审核报告、批次信封明细、查重风险汇总。
- 操作区：触发智能审核、提交集中审批、跳转“集中打款登记台”、跳转审批详情。
- API 指向：`/api/v1/reimbursement/batch/:id`, `/api/v1/reimbursement/batch/:id/trigger-audit`, `/api/v1/reimbursement/batch/:id/audit-report`, `/api/v1/reimbursement/batch/:id/submit-approval`, `/api/v1/reimbursement/batch/:id/mark-paid`

#### F-7. 报销集中打款登记台 `views/finance/reimbursement/payout.vue`
- 面向已审批报销批次的财务打款登记页面，支持单批次/多批次操作。
- 打款登记字段：打款日期、支付流水号、支付实体、支付账号、付款账户显示文本。
- 新增支付凭证上传区：支持上传打款截图/回单等附件，并在提交时一起保存。
- API 指向：`/api/v1/reimbursement/batch`, `/api/v1/reimbursement/batch/:id`, `/api/v1/reimbursement/batch/:id/mark-paid`, `/api/v1/entity`, `/api/v1/entity/:id/bank-accounts`, `/api/v1/upload/sign`

#### G. 收款合同管理 `views/finance/receipt/contract.vue`
- 核心列：合同号、项目、对方单位、合同总额、已开票、已收款、状态。
- 操作：新建收款合同（direction=inbound）、查看合同详情并提交审批。
- API 指向：`/api/v1/contract?direction=inbound`, `/api/v1/contract/:id/submit-approval`

#### G-2. 发票管理 `views/finance/receipt/invoice.vue`
- 双对象视图：`开票申请` + `正式发票`（Tabs）。
- 开票申请核心列：申请单号、合同号、客户名称、客户税号、价税合计、类型、状态。
- 开票申请列表文案：类型与状态均中文化展示；提交审批后显示“查看进度”入口，直达审批详情。
- 开票申请动作：新建申请、提交审批（draft/rejected）、审批通过后签发正式发票（approved/ready_to_issue）。
- 支持审批详情反向跳转定位：当路由 query 传入 `keyword` 时，页面自动回填关键字并加载开票申请列表，便于从审批页按申请单号落位。
- 正式发票签发改为“附件优先”模式：签发时仅上传发票附件，发票代码/号码/校验码/日期/金额等字段由二维码/OCR自动回填，不再要求人工逐项录入：`packages/web/src/views/finance/receipt/invoice.vue`、`packages/api/src/routes/receipt.ts`
- 新建开票申请（行政友好模式）：
  - 对方信息支持“名录选择/手工录入”双模式，字段改为“对方名称/对方税号/对方联系方式”；
  - 勾选“保存对方信息”时，手工录入可沉淀到对方名录（缺失联系方式可回填）；
  - 我方开票主体默认由收款合同带出（可人工调整）；
  - 发票类目可自定义输入；税率使用百分数输入（如 `13` 表示 13%）；
  - 税率支持 0/1/3/6/9/13 快捷填入按钮；
  - 开票明细使用可编辑子表（subtable），不再要求手填 JSON；
  - 开票明细支持“复制上一行”与“从模板导入”，减少重复录入；
  - 不含税金额/预计税额/价税合计由明细与税率自动计算；
  - 汇款凭证改为拖拽上传附件（可视化列表）。
- 正式发票核心列：系统单号、税务发票号、合同号、抬头、开票日期、价税合计、校验状态。
- 正式发票动作：触发 OCR/二维码校验、删除。
- 校验与约束：
  - 先审后签发：`invoice_request -> approval -> issue`；
  - 已开票总额 + 本次签发不含税金额 ≤ 合同总额（后端强校验）；
  - 签发后可上传电子票据并触发自动校验。
- API 指向：`/api/v1/receipt/invoice-request*`、`/api/v1/receipt/invoice*`

#### G-3. 收款登记列表 `views/finance/receipt/list.vue`
- 核心列：收款单号、合同号、关联发票号、收款日期、金额、收款账户、凭证状态、登记人、状态。
- 新增收款登记：
  - 收款账户改为“我方实体 + 银行账户”下拉选择（仅展示 active 账户）；
  - 必须上传至少一份收款凭证后方可提交；
  - 收款凭证通过签名上传链路落 R2，并在收款记录保存 `vouchers_json`。
- 操作：新增收款登记、发起退款（全部/部分）、删除登记。
- 退款规则：退款创建后立即提交审批；审批上下文需包含合同信息、收款登记信息；若存在关联发票，审批明细展示发票信息并进入“红冲发票签发”流程节点。
- 校验：合同收款总额与发票收款总额上限联动（后端强校验）；退款金额不得超过可退余额。
- API 指向：`/api/v1/receipt`、`/api/v1/receipt/receipt-accounts`、`/api/v1/receipt/refund*`

#### G-3-1. 收款登记详情 `views/finance/receipt/detail.vue`
- 展示维度：收款登记主信息、合同信息、关联发票信息、收款凭证附件列表、退款记录列表。
- 附件能力：收款凭证支持明细查看；退款记录支持在详情页上传并维护“银行汇款单”附件。
- 退款操作：可在详情页发起全额/部分退款并立即提审，形成“查看-操作”闭环。
- API 指向：`/api/v1/receipt/:id`、`/api/v1/receipt/refund`、`/api/v1/receipt/refund/:id/submit-approval`、`/api/v1/receipt/refund/:id/bank-slips`

#### G-4. 收款统计仪表盘 `views/finance/receipt/dashboard.vue`
- 指标：收款合同已开票、收款合同已到账、收款登记笔数、对外付款已支付、报销累计。
- 支持按项目切换统计。
- API 指向：`/api/v1/project/:id/financial-summary`

#### H. 审批中心 `views/approval/index.vue`
- Tab：待审批、已处理、抄送我。
- 待审批/已处理列表列：业务类型、审批单号、所属项目、金额、业务明细、摘要、发起人、节点/操作、时间、状态（用于审批快速识别）。
- API 指向：`/api/v1/approval/pending`

#### I. 审批详情 `views/approval/detail.vue`
- 上区：业务摘要（单据关键字段）。
- 中区：流程图 + 历史操作 + 业务明细（已覆盖 `开票申请` 与 `收款退款` 明细区）。
- 审批流程节点中的人工审批意见使用红色高亮（`#f56c6c`）展示，强化对后续环节审批人的提示：`packages/web/src/views/approval/detail.vue`
- 收款退款明细区（`biz_type=receipt_refund`）：展示退款单、收款记录、合同信息；当存在关联发票时展示发票信息，并提示流程含“红冲发票签发”节点。
- 业务摘要新增“业务编号”可点击跳转：按业务类型路由到对应业务页面（付款详情/合同详情/报销批次详情/发票申请列表/收款详情）。
- 业务明细区编号字段（付款流水号、合同号、报销批次号、开票申请号、退款单号）统一支持点击跳转对应业务页，减少审批与业务核对的页面切换成本。
- 跳转可点击态需与财务域路由权限一致：无财务域访问权限时显示为只读文本，避免误导点击。
- 下区：动作区（通过/拒绝/退回/转签/撤回）。
- Web 端审批动作完成（通过/驳回/退回/转办）后，先显示成功提示，再自动跳转到“待我审批”列表（`/approval/index`），与 miniapp `pages/approval-detail/index.js` 行为对齐：`packages/web/src/views/approval/detail.vue`
- API 指向：`/api/v1/approval/:id/*`、`/api/v1/receipt/refund/:id`

#### I-1. 审批监控台（超管） `views/approval/admin-monitor.vue`
- 列表维度：审批单号、业务类型、摘要、发起人、当前节点、状态、提交时间、完成时间。
- 筛选条件：业务类型、状态（支持多选，默认：进行中/已通过/已驳回）、发起人（企微成员下拉，仅显示姓名）、摘要关键字。
- 筛选条件本地持久化：按“当前登录用户 + 当前浏览器设备”保存上次筛选值，刷新/重进页面自动恢复，重置时同步清空本地缓存。
- 行动作：查看详情、强制通过、强制转签（仅 `in_progress` 且 `super_admin` 可见）。
- 强制通过流程：先拉取审批详情并列出 pending 任务，再选择任务 + 填写意见后执行。
- API 指向：`/api/v1/approval/admin/all`、`/api/v1/approval/:id/force-approve`、`/api/v1/approval/:id/force-transfer`

#### I-2. 审批模板配置 `views/approval/template-config.vue`
- 模板列表表格：模板编码、名称、业务类型、状态、操作（编辑/预览/删除）。
- 创建/编辑弹窗：基本信息 + ApprovalFlowDesigner 可视化编辑器（显示节点连线、负责人摘要）。
- 预览弹窗：只读模式 ApprovalFlowDesigner（保留连线和负责人摘要展示）。
- 节点配置面板：审批人/抄送人改为企微人员下拉多选（按名称+userid展示），支持快速检索。
- AI关卡节点：`ai_slot_id` 支持下拉选择（来源于后端可用 AI Slot 选项），也可手动输入自定义值。
- 设计器实现：`packages/web/src/components/ApprovalFlowDesigner/{index.vue,serializer.ts,types.ts,NodeConfigPanel.vue}`。
- API 指向：`/api/v1/admin/approval-config`

#### I-3. 金额阈值配置 `views/approval/threshold-config.vue`
- 顶部模板选择器。
- 阈值表格：条件字段、运算符、阈值、目标分支、优先级。
- 创建/编辑弹窗：between运算符时显示双值输入。
- API 指向：`/api/v1/admin/threshold`

#### I-4. AI配置管理 `views/ai/config.vue`
- 3标签页：AI供应商 / 路由规则 / 提示词模板。
- 初始化区：支持填写默认 OpenAI 模型与 Endpoint，并一键初始化 AI 供应商、路由规则、提示词模板。
- 供应商Tab：CRUD表格（key、名称、endpoint、模型、优先级、并发）。
- 路由规则Tab：CRUD表格（规则名、业务类型、任务类型、供应商、优先级）。
- 提示词Tab：CRUD表格（key、名称、版本）+ 编辑弹窗含system/user prompt大文本区。
- API 指向：`/api/v1/admin/bootstrap/near-production-openai`, `/api/v1/admin/ai-provider`, `/api/v1/admin/ai-routing`, `/api/v1/admin/ai-prompt`

#### I-5. 计算节点监控 `views/ai/nodes.vue`
- 节点列表卡片：节点ID、名称、类型、状态（颜色标签）、能力、CPU/内存、最后心跳（相对时间）。
- 30秒自动刷新。
- Runner运行参数卡片：支持在线维护 `OPENAI_API_KEY`、`OPENAI_MODEL`、`OPENAI_BASE_URL`、合同文本/视觉模型键，参数落库后同步到 KV 供 Runner 轮询读取。
- AI运行测试卡片：可按任务类型创建测试任务，任务进入队列后在下方队列表追踪结果。
- 任务队列卡片：筛选（状态/任务类型）+ 表格 + 分页。
- API 指向：`/api/v1/admin/runner-runtime-config`, `/api/v1/admin/ai-runtime/test-task`, `/api/v1/task/nodes`, `/api/v1/task/queue`

#### J. 资产台账 `views/asset/list.vue`
- 列：资产码、类型、状态、资产归属（自有/租入）、所在项目、责任人、更新时间。
- 支持：按资产类型动态展示属性字段。
- 支持：按资产归属筛选；新建资产可指定归属（默认自有）。
- 交互：资产编码与资产名称支持点击进入单设备管理详情页（`/warehouse-assets/device/:id`，页面文件 `views/asset/detail.vue`）。
- 升级要求：支持“整机业务视图 / 部件资产视图”切换，列表页默认以资产类型筛选为主，并可按 whole-machine number、shell、core、console 关键字检索。
- API 指向：`/api/v1/asset`

#### J-2. 资产详情 `views/asset/detail.vue`
- 模块：基础信息、当前配置、Factory/Current/Project-Temporary 参数区、部件关系、事件时间线、文档库。
- 交互：支持按 whole-machine view 查看当前 shell/core/console 组合，也支持切换到 shell 或 core 独立履历视图。
- 升级要求：当资产为顶管机相关设备时，页面需要显式展示 `available now / available after modification / blocked by maintenance / returned quarantine` 等状态标签。
- API 指向：`/api/v1/asset/:id`, `/api/v1/asset/:id/event`, `/api/v1/asset/:id/document`

#### K. 仓库管理 `views/warehouse/index.vue`
- 模块：仓库 KPI 总览（仓库数/待处理制单/库存预警/库存条目）、业务入口（制单/调度/库存/资产查验）、仓库档案列表。
- 交互：软删除，状态维护（active/inactive）。
- API 指向：`/api/v1/warehouse`

#### K-2. 仓库库存 `views/warehouse/inventory.vue`
- 模块：库存总览、筛选、耗材消耗登记、页内预警清单。
- 交互：按仓库/资产类型过滤，登记消耗后刷新库存；预警项支持一键触发 AI 分析。
- API 指向：`/api/v1/warehouse/inventory`, `/api/v1/warehouse/consumption`, `/api/v1/warehouse/inventory/alert`, `/api/v1/warehouse/inventory/alert/:id/analyze`

#### K-3. 库存预警中心 `views/warehouse/alert.vue`
- 模块：低库存清单、缺口展示、AI分析触发。
- 交互：预警项支持一键触发 `inventory_alert_analysis`。
- API 指向：`/api/v1/warehouse/inventory/alert`, `/api/v1/warehouse/inventory/alert/:id/analyze`

#### K-4. 出入库单管理 `views/warehouse/stock-order.vue`
- 模块：出入库单列表、购物车式创建表单、模板快速套用、关键字快速加入。
- 交互：草稿单可提交审批；审批通过后可执行；草稿/待审可取消。
- 交互增强：支持“扫码值/关键字 + 数量”快速加入清单，支持预制模板一键套用后继续编辑。
- 租赁增强：制单时可选关联 `rental_term_id`，逾期租期在出库前阻断；关联租期的入库执行会回填“已归还”。
- 组合增强：清单行支持直接标记 `configuration_role`（整机 / 机壳 / 机芯 / 操作台 / 通用）与 `requires_modification`，用于把“已组合设备直接出库”与“兼容组合但需改装”两类方案在同一制单页内表达。
- 升级要求：主要设备出库项支持两种模式——已组合设备直接选取、compatible 组件组合选取并显示 `modification required` 提示；返库执行后主要设备自动进入 returned quarantine，不直接恢复可用。
- API 指向：`/api/v1/warehouse/stock-order`, `/api/v1/warehouse/stock-order/:id/submit-approval`, `/api/v1/warehouse/stock-order/:id/execute`

#### K-5. 项目设备规划 `views/warehouse/equipment-plan.vue`
- 模块：设备规划列表、新建规划、AI推荐触发、推荐结果查看、确认生成出库单。
- 交互：确认时自动生成出库单并回写规划单。
- 升级要求：规划结果需区分 `available now` 与 `available after modification`，并把 modification required 组合显式回传到出库单配置页。
- API 指向：`/api/v1/warehouse/equipment-plan`, `/api/v1/warehouse/equipment-plan/:id/trigger-recommend`, `/api/v1/warehouse/equipment-plan/:id/recommendation`, `/api/v1/warehouse/equipment-plan/:id/confirm`

#### K-5.1 出入库调度看板 `views/warehouse/dispatch.vue`
- 模块：调度状态总览、`available_now / available_after_modification / blocked / reserved / in_transit / on_project / scrapped` 七状态分栏、组合配置标签、阻塞工单与预留记录聚合视图。
- 交互：支持按 warehouse / asset_type / project / dispatch_state 过滤；支持从资产卡片跳转到 `views/asset/detail.vue`，在卡片内直接查看调度原因、组合配置、阻塞工单与预留记录。
- 升级要求：若对象依赖 `special override` 才可放行，调度看板必须显式展示 override 标识、审批状态与补检要求，不能与普通 `available now` 混淆。
- API 指向：`/api/v1/asset/dashboard/dispatch-board`, `/api/v1/asset/:id`

#### K-6. 消耗品管理总览 `views/warehouse/consumables.vue`
- 模块：消耗品 KPI、库存清单、消耗记录、消耗登记。
- 交互：按仓库/消耗品类型/项目筛选，支持直接跳转出入库制单与公司盘库页面。
- API 指向：`/api/v1/warehouse/inventory`, `/api/v1/warehouse/consumption`, `/api/v1/asset/type`

#### K-7. 公司资产盘库 `views/warehouse/stocktake.vue`
- 模块：盘点任务列表、盘点执行区、差异汇总。
- 交互：支持全公司/单仓库创建盘点任务；盘库过程中支持页内直接新增设备/消耗品并填写数量与状态（正常/新增/破损/盘亏），录入后自动计算差异并完成盘点。
- API 指向：`/api/v1/warehouse/stocktake`, `/api/v1/warehouse/stocktake/:id`, `/api/v1/warehouse/stocktake/:id/line`, `/api/v1/warehouse/stocktake/:id/line/:lineId`, `/api/v1/warehouse/stocktake/:id/complete`

#### K-8. 设备总览 `views/asset/dashboard.vue`
- 模块：按类型/状态/位置三维统计。
- 升级要求：增加顶管机专项统计：当前可用整机数、可改装后可用数、returned quarantine 数、buried shell 数、recovered core 数。
- API 指向：`/api/v1/asset/dashboard/overview`

#### K-9. 项目设备视图 `views/project/equipment-view.vue`
- 模块：项目设备清单、项目维度物资消耗汇总。
- 租赁提示：展示租赁模式、到期日、逾期天数，并在页头显示租赁设备与逾期设备汇总告警。
- 升级要求：项目视图需显示当前 whole-machine configuration、关键部件状态、是否依赖 special override 放行、以及项目侧 freight attribution 摘要。
- API 指向：`/api/v1/asset/dashboard/project/:projectId`

#### K-10. 资产工单中心 `views/warehouse/work-order.vue`
- 模块：inspection / maintenance / servicing / modification / scrapping 五类资产工单列表、创建表单、负责人分配、阻塞开关联动、结果摘要编辑。
- 交互：支持按资产、组合配置、出入库单三类对象发起工单；支持草稿提审、审批通过后开始、进行中完成、非终态取消；支持在页内编辑负责人、计划日期、阻塞标记与结果摘要。
- 角色可见性：
  - 项目经理：可查看自己项目发起相关任务与阻塞原因，不可关闭库房维保任务。
  - 办公室：可查看审核补充相关任务、资料缺失、特批流。
  - 库房：可查看并执行 inspection / maintenance / modification / scrapping 任务。
  - 管理层：可查看 special override 队列与高风险阻塞任务。
- API 指向：`/api/v1/warehouse/work-order`, `/api/v1/warehouse/work-order/:id/submit-approval`, `/api/v1/warehouse/work-order/:id/start`, `/api/v1/warehouse/work-order/:id/complete`, `/api/v1/warehouse/work-order/:id/cancel`

#### K-11. 仓库升级角色可见性矩阵
- 项目经理：发起出入库申请、查看项目设备规划与自己项目的阻塞原因。
- 办公室：审核补充出入库单、查看资料缺口、参与特批流转。
- 库房：执行出入库、安排运输、处理 inspection / maintenance / servicing / modification / scrapping 任务。
- 管理层：审批 special override、查看高风险资产与关键阻塞。

#### L. 系统配置 `views/admin/system.vue`
- 配置项：审批阈值、AI 路由、字典项、角色权限。
- 所有修改必须记录操作审计。
- API 指向：`/api/v1/admin/*`

### 3.4 Web 项目工作区（新增 IA）

#### 3.4.1 页面与路由映射（必须保留旧路由兼容）
- 工作区主壳：`packages/web/src/views/project/workspace/index.vue`
- 项目面板：`packages/web/src/views/project/workspace/project-panel.vue`
- 设备面板：`packages/web/src/views/project/workspace/equipment-panel.vue`
- 财务面板：`packages/web/src/views/project/workspace/finance-panel.vue`
- 路由模块：`packages/web/src/router/modules/project.ts`
- 兼容约束：`packages/web/src/views/project/detail.vue` 在首发阶段必须继续可访问。

#### 3.4.2 交互模型
- 入口：从 `views/project/list.vue` 行操作进入“项目工作区”。
- 标签：工作区内固定三标签（项目 / 设备 / 财务），支持深链（URL 直接定位到标签）。
- 隔离：切换 `projectId` 时必须重置面板缓存，禁止跨项目数据残留。
- 容错：任一子面板加载失败时仅影响当前标签，不阻断整个工作区。

#### 3.4.3 权限与可见性
- `super_admin`、`manager`：可见全部面板能力。
- `site_manager`：可见项目/设备面板；财务面板按字段级权限降级展示。
- `operator`：默认只读；不可见高敏金额字段与高风险操作。
- 所有敏感数据展示以 API 返回权限为准，前端仅做补充隐藏，不做越权放行。

#### 3.4.4 API 指向
- 工作区项目数据：`/api/v1/project/:id`
- 工作区财务摘要：`/api/v1/project/:id/financial-summary`
- 工作区设备摘要：`/api/v1/asset/dashboard/project/:projectId`

#### 3.4.5 项目面板一站式信息聚合（新增）
- 文件管理区：位于 `packages/web/src/views/project/workspace/project-panel.vue`，支持项目相关人员上传并沉淀项目文件，文件可选绑定标段。
- 项目信息编辑区：位于 `packages/web/src/views/project/workspace/project-panel.vue`，支持在工作区直接查看/编辑 `location_text`（具体位置）、`project_briefing`（项目交底）、`project_start_at`（开始时间）。
- 标段详情弹窗：在项目面板“标段总览”点击“查看详情”进入，显示标段基础信息、该标段操作员日志、该标段贯通报告。
- 项目日志聚合区：仅展示项目级管理员日志（项目相关内容），不再承载施工日志/标段贯通内容。
- 标段内日志能力：施工日志与贯通报告统一下沉到“标段详情抽屉”，支持查看、新增与编辑。
- 贯通报告标段绑定：贯通报告按 `section_id` 归集，并在对应标段详情下追溯。
- 对应 API：`/api/v1/project/:id/files`、`/api/v1/project/:id/files/:fileId`、`/api/v1/log/operator?project_id=:id&section_id=:sectionId`、`/api/v1/survey/breakthrough?project_id=:id&section_id=:sectionId`。

### 3.5 Sprint 1 重构落地点（2026-02）
- 默认首页路由切换到个人工作台：`packages/web/src/router/modules/home.ts`（`/` -> `/workspace/home`，保留 `/welcome` 兼容重定向）。
- 个人工作台页面：`packages/web/src/views/welcome/index.vue`（欢迎卡、快捷入口、报销时间线、证书网格与到期预警）。
- 个人资质与证书卡片新增文件动作：`packages/web/src/views/welcome/index.vue`（单证书支持“查看/下载”附件；未上传附件时按钮禁用并提示）。
- 全局技术支持抽屉入口：`packages/web/src/layout/components/lay-navbar/index.vue`。
- 全局技术支持抽屉实现：`packages/web/src/layout/components/lay-support/index.vue`。
- 技术支持 API 封装：`packages/web/src/api/support.ts`（`POST /api/v1/support/tickets`、`GET /api/v1/support/tickets?creator_id=me`）。
- Sprint 1 菜单收敛：`packages/web/src/router/modules/{project,finance,asset,warehouse,construction,entity,dict,wecom,account,ai}.ts` 顶层菜单设为隐藏，保留路由可访问与后续 Sprint 渐进恢复。
- Sprint 1 审批动作约束：`packages/web/src/views/approval/unified-tasklist.vue` 中通过/驳回/转签均要求填写审批意见。

### 3.6 Sprint 2 重构落地点（2026-02）
- 菜单恢复与命名对齐：
  - `packages/web/src/router/modules/project.ts` 顶层菜单恢复可见，标题调整为“项目与现场指挥”。
  - `packages/web/src/router/modules/warehouse.ts` 顶层菜单恢复可见，标题调整为“库房调度”。
  - `packages/web/src/router/modules/asset.ts` 顶层菜单恢复可见，标题调整为“资产台账”。
- 项目选择大厅（卡片流）补齐创建动作门槛：`packages/web/src/views/project/hub.vue`，仅允许 `super_admin/manager/site_manager` 显示“+ 创建项目”。
- 项目选择大厅卡片信息增强与排序：`packages/web/src/views/project/hub.vue`
  - 卡片新增展示：`project_start_at/start_date`（开工时间）、`location_text`（位置合成字段）、`project_briefing`（项目交底）
  - 排序规则调整为：状态优先（施工中 > 筹备中 > 规划中 > 收尾中 > 已归档），同状态按开工时间倒序
  - 交互补充：支持分页、按状态筛选、按位置筛选
- 出入库制单台重构为“左检索 + 右购物车”模式：`packages/web/src/views/warehouse/stock-order.vue`。
- 库房调度台升级为“资产状态读模型看板”：`packages/web/src/views/warehouse/dispatch.vue`，按七种调度状态分栏展示，并在卡片内聚合调度原因、配置关系、阻塞工单与预留记录。
- 新增资产工单中心页面：`packages/web/src/views/warehouse/work-order.vue`，承接 inspection / maintenance / servicing / modification / scrapping 五类工单的创建、提审、开始、完成、取消。
- 项目工作区详情交互改为抽屉优先：
  - `packages/web/src/views/project/workspace/project-panel.vue`：标段详情由 `Dialog` 改为 `Drawer`；文件详情新增右侧抽屉。
- `packages/web/src/views/project/workspace/equipment-panel.vue`：设备行新增详情入口并使用右侧抽屉承载详情。
- `packages/web/src/views/project/workspace/equipment-panel.vue`：新增租赁告警条、租赁列（模式/到期/逾期天数）和抽屉内租赁信息展示。

### 3.7 Sprint 3 重构落地点（2026-02）
- 财务中心菜单恢复并命名对齐：`packages/web/src/router/modules/finance.ts`（顶层标题“财务中心”）。
- 合同执行监控高密度改造：`packages/web/src/views/finance/contract/monitor.vue`
  - 表格切换为紧凑模式（`size=small`）
  - 打款进度增加风险等级标签（正常/阈值预警/超高风险）
  - 阈值色带与金额变更抽屉保留
- 智能发单台关系输入收敛：`packages/web/src/views/finance/payment/wizard.vue`
  - 超阈值合同流中“对方单位”改为 `el-select`（来源收款人）
  - 收款人数据源限定为 `type=external`，智能发单台不展示内部收款人（内部收款人仅用于报销打款场景）。
  - 在“对方单位”与“直接付款-收款人”字段旁均提供“快速添加外部收款人”按钮，弹窗提交后自动刷新下拉并在当前流程自动选中新建项。
  - 合同下拉按最新时间优先排序（新合同在顶部），降低历史合同误选概率。
  - 在“收款人/对方单位”选中后展示完整收款信息（收款人、开户行、银行账号、联系电话）用于提审前核对。
  - 付款金额、实体 ID 保持 `el-input-number` 数值控件
- 报销集中打款流程抽屉化：`packages/web/src/views/finance/reimbursement/payout.vue`
  - 登记打款从 `Dialog` 改为 `Drawer`
  - 新增批量选择金额汇总展示（批次数 + 合计金额）
- 财务快照看板图表化：`packages/web/src/views/finance/receipt/dashboard.vue`
  - 新增 ECharts 柱状图（应收已开票/应收已到账/对外付款/报销总额）
  - 保留 KPI 卡片与项目筛选，形成“卡片 + 图表”双层快照

### 3.8 Sprint 4 重构落地点（2026-02）
- 超管统一入口：`packages/web/src/router/modules/admin.ts`
  - 汇聚审批流程设计、阈值规则、AI/Runner、服务监控中心、系统底座、企微集成、Raw Ops、Helpdesk
  - 所有子页严格 `super_admin` 可见
- 业务数据全量运维台（左树右表）：`packages/web/src/views/admin/raw-ops.vue`
  - 左侧数据域树（实体/字典/企微成员/企微部门）
  - 右侧高密度表格与刷新操作
  - 顶部高风险红色告警
- IT 支持工单处理台：`packages/web/src/views/admin/helpdesk.vue`
  - 工单列表 + 状态筛选
  - 单条详情右侧抽屉
  - 处理说明填写与“标记已解决”闭环动作
- 支持工单超管 API 扩展：`packages/web/src/api/support.ts`
  - `GET /api/v1/support/tickets`
  - `GET /api/v1/support/tickets/:id`
  - `POST /api/v1/support/tickets/:id/resolve`
- 系统底座权限收敛为超管：
  - `packages/web/src/router/modules/entity.ts`
  - `packages/web/src/router/modules/dict.ts`
  - `packages/web/src/router/modules/wecom.ts`
- 服务监控中心（前后端健康总览）：`packages/web/src/views/admin/ops-center.vue`
  - 聚合 Worker D1/KV/R2/Queue、Bridge 服务、Runner 服务状态
  - 展示最近心跳节点与在线统计
- 企微推送监控（超管）：`packages/web/src/views/admin/wecom-push-monitor.vue`
  - 聚合 `wecom_template_card_*` 事件的发送成功/失败、隔离保护触发、成功率
  - 展示高频错误 Top 10 与最近推送事件明细
  - 提供推送跳转配置表单（`WECOM_MINIAPP_APPID`、`WECOM_APPROVAL_WEB_BASE_URL`、`WECOM_APPROVAL_MINI_PAGE_PATH`、`WECOM_APPROVAL_DEFAULT_TARGET`）
  - API 指向：`/api/v1/admin/wecom-push/monitor`

### 3.9 UI Refactor Plan 补齐项（2026-02）
- IA 规范路径补齐：
  - `packages/web/src/router/modules/workspace.ts`（`/workspace/home`）
  - `packages/web/src/router/modules/field.ts`（`/field/projects`、`/field/project/:id`）
  - `packages/web/src/router/modules/warehouse-assets.ts`（`/warehouse-assets/ledger`、`/warehouse-assets/creator`、`/warehouse-assets/templates`、`/warehouse-assets/dispatch`）
  - `packages/web/src/router/modules/finance.ts` 新增 `/finance/snapshot`
- 旧路径别名重定向（redirect-only）：
  - `packages/web/src/router/modules/{project,warehouse,asset,ai,entity,dict,wecom}.ts`
  - `packages/web/src/router/modules/approval.ts` 的模板/阈值旧入口重定向到 `/admin/*`
- 项目工作区补齐文件库标签页：
  - `packages/web/src/views/project/workspace/index.vue`
  - `packages/web/src/views/project/workspace/file-panel.vue`
- 财务阈值风险强化（>90%行高亮）：
  - `packages/web/src/views/finance/contract/monitor.vue`
- Raw Ops 管理能力补齐（超管侧实体/字典 CRUD）：
  - `packages/web/src/views/admin/raw-ops.vue`
- 技术支持附件从“名称记录”升级到“file_key 上传提交”：
  - `packages/web/src/layout/components/lay-support/index.vue`
  - `packages/web/src/views/admin/helpdesk.vue`（详情抽屉展示附件）

### 3.10 顶部通知中心 API 化（2026-02）
- 顶部 `通知/消息/待办` 全量改为实时 API 数据，不再使用本地 mock：
  - `packages/web/src/layout/components/lay-notice/index.vue`
  - 通知：`listCcApprovals`
  - 消息：`listProcessedApprovals`
  - 待办：`listPendingApprovals`
- 移除无用组件与静态数据：
  - `packages/web/src/layout/components/lay-notice/components/NoticeList.vue`（删除）
  - `packages/web/src/layout/components/lay-notice/components/NoticeItem.vue`（删除）
  - `packages/web/src/layout/components/lay-notice/data.ts`（删除）

### 3.11 个人工作台交互调整（2026-02）
- 个人身份信息增强（全名 + 角色 + 权限）：
  - `packages/web/src/views/welcome/index.vue`
- 发起报销改为直接进入标准报销创建页（不再使用首页旧弹窗）：
  - `packages/web/src/views/welcome/index.vue`
  - 统一跳转 `/workspace/my-reimbursement/detail/create`
- 个人工作台新增“发起对外付款”按钮：
  - `packages/web/src/views/welcome/index.vue`
  - 通过工作台隐藏路由拉起智能发单台：`/workspace/payment/wizard`
  - 发起后详情页留在 workspace 路径：`/workspace/payment/detail/:id`
- 工作台首页移除“填报施工日志/填报项目日志”双入口，统一为“进入项目大厅”：
  - 跳转：`/project/hub`
  - 文件：`packages/web/src/views/welcome/index.vue`

### 3.12 项目工作区 Project Tab 重构（2026-02）
- `tab=project` 从“信息+文件+表格堆叠”改为“项目运营驾驶舱”布局：
  - 文件能力从 `project-panel` 完全移除（已迁移到 `tab=files` 的 `file-panel`）
  - 标段总览改为卡片式并引入顶进进度条（累计顶进/标段里程）
  - 项目日志一站式视图仅保留项目日志（管理员日志）并支持单条日志详情抽屉
  - 标段详情抽屉补齐施工日志/贯通报告查看、新增、编辑
  - 增加项目管理辅助动作（项目日志中心直达、日报/周报汇总触发）
  - 快速填写项目日志中的照片输入从 `file_key` 文本改为直接上传照片
- 关键文件：
  - `packages/web/src/views/project/workspace/project-panel.vue`
  - `packages/web/src/views/project/workspace/index.vue`

## 4. 小程序页面级规范（企业微信）

### 4.0 设计基准与参考
- 企业微信样式规范参考：`https://developer.work.weixin.qq.com/document/path/90305`
- TDesign 小程序组件库参考：`https://tdesign.tencent.com/miniprogram/`
- 设计目标：在企业微信容器内保持原生一致性（轻量、清晰、可读），同时通过 TDesign 提升组件一致性与交互反馈质量。
- 落地策略：业务结构保持现有 Phase 10 信息架构，仅重塑视觉层与交互层，不改变后端接口契约。

### 4.1 页面总索引
- 工作台（Tab1）：`packages/miniapp/pages/index/index`
- 库房（Tab2）：`packages/miniapp/pages/warehouse/index`
- 公司资产盘库：`packages/miniapp/pages/warehouse-stocktake/index`
- 审批与申请（Tab3）：`packages/miniapp/pages/finance/index`
- 我的（Tab4）：`packages/miniapp/pages/profile/index`
- 登录恢复页：`packages/miniapp/pages/login/index`
- 日志中心：`packages/miniapp/pages/log/index`
- 操作员日志：`packages/miniapp/pages/operator-log/index`
- 管理员日志：`packages/miniapp/pages/manager-log/index`
- 审批待办：`packages/miniapp/pages/approval/index`
- 发起对外付款（智能发单台）：`packages/miniapp/pages/payment-apply/index`
- 员工加油申请：`packages/miniapp/pages/fuel-apply/index`
- 我的报销提交（列表）：`packages/miniapp/pages/reimbursement-list/index`
- 报销提交详情/新建：`packages/miniapp/pages/reimbursement/index`
- 查询中心（高权限入口）：`packages/miniapp/pages/query/index`
- 合同查询（高权限）：`packages/miniapp/pages/query-contract/index`
- 付款查询（高权限）：`packages/miniapp/pages/query-payment/index`
- 收款查询（高权限）：`packages/miniapp/pages/query-receipt/index`
- 合同查询详情（高权限）：`packages/miniapp/pages/query-contract-detail/index`
- 付款查询详情（高权限）：`packages/miniapp/pages/query-payment-detail/index`
- 收款查询详情（高权限）：`packages/miniapp/pages/query-receipt-detail/index`
- 设备扫码：`packages/miniapp/pages/asset/index`
- 现场勘查：`packages/miniapp/pages/survey/index`
- 项目进度概览：`packages/miniapp/pages/progress/index`
- 通知消息：`packages/miniapp/pages/notice/index`

### 4.2 页面要求
- 工作台Tab：首页展示红黄绿 KPI、九宫格高频入口，并支持角色化“创建项目”入口。
- 库房Tab：聚合库房与资产管理入口（出入库制单、调度看板、库存预警、资产查验、公司资产盘库），不承载项目/现场内容。
- 出入库制单（miniapp）对齐 Web：支持多条目购物车（设备+耗材同单提审），不再限制单据仅单一设备类型。
- 出入库制单（miniapp）选型加速：支持“扫码匹配资产类型”与“关键字检索资产类型”双通道。
- 出入库制单（miniapp）模板加速：支持预制模板一键套用并继续逐项修改数量/删除后提交。
- 审批与申请Tab：通过分段器组织“待我审批/发起申请”，并提供快速审批与发单入口。
- 我的Tab：放置个人申请时间线、证书预警、联调配置、会话管理。
- 日志中心：仅负责日志角色入口分流（操作员/管理员）。
- 操作员日志页：支持 AI 预填 + 提交，班次使用中文选择（白班/夜班），内部存储保持 day/night。
- 管理员日志页：支持拍照上传 + 结构化提交。
- 审批页：移动端单手可完成通过/拒绝/退回/转签，危险动作前需确认弹窗。
- 报销页：支持个人报销草稿创建/编辑、绑定 UUID、附件上传（实物/电子）、提交与 OCR 状态追踪。
- 查询中心（仅 `super_admin/finance/manager`）：
  - 工作台新增“查询”入口，进入后以卡片展示“合同查询/付款查询/收款查询”。
  - 三个查询页统一支持：申请人、时间范围、项目名称筛选。
  - 列表统一分页口径：每页 10 条，上一页/下一页切换。
  - 列表条目支持点击进入详情页；详情页以只读卡片形式展示关键字段。
  - 申请人显示规则统一为“仅姓名”，若姓名缺失显示 `-`。
  - 付款查询列表需展示“所属项目名称”，避免仅凭项目ID识别。
  - 合同详情支持附件查看，并支持从“关联付款/关联收款”点击跳转到对应详情页。
  - 付款详情支持附件查看、审批记录展示，并支持点击跳转到审批详情页。
  - 查询列表中的状态标签按状态语义着色（例如待审批=橙色、生效/已付款=绿色、废止/拒绝=红色）。
- 报销详情页补齐附件全链路能力：
  - 可按类型上传附件（发票/收据/合同/其他）
  - 支持图片上传与文件上传双路径
  - 支持已上传附件查看与下载
- 设备页：支持扫码识别资产、状态查看与出入库事件确认。
- 勘查页：支持 GPS 定位、拍照上传、表单提交。
- 进度页：支持项目日志指标与预警列表查看。
- 个人中心：支持查看用户信息、API 地址配置（开发联调）与退出登录确认。
- 登录恢复页：当自动登录失败时承接错误展示，并提供品牌化企业微信登录按钮（沿用 Web 登录按钮 PNG 视觉）。
- 通用交互：所有异步提交场景需有 loading、按钮禁用、空态提示与字段校验反馈。
- 低操作成本原则：
  - 项目选择统一使用下拉选择组件（`hy-project-picker`），避免手输项目ID。
  - 支持“定位匹配项目”快捷动作；若项目未配置坐标，则保留手动选择。
  - 业务例外：`智能发单台` 与 `我的报销提交` 流程禁用 GPS 自动匹配，项目仅允许人工显式选择，避免地理偏差导致错绑。
  - 日期统一使用 `picker mode=date`，避免手输日期格式。
  - 班次统一使用中文选项（白班/夜班），内部存储使用英文值（day/night）。

### 4.2.1 Miniapp UI 重构落地点（2026-02）
- 全局视觉系统：`packages/miniapp/app.wxss`
  - 补齐红黄绿语义色、放大触控区、统一 KPI 卡片样式。
  - 新增全局悬浮语音助手 FAB 样式（呼吸动画）。
- 4 Tabs 信息架构（文案与顺序）：`packages/miniapp/app.json`
  - `工作台`、`库房`、`流程`、`我的`。
- 工作台首页重构：`packages/miniapp/pages/index/index.{js,wxml,wxss}`
  - 欢迎区 + 红黄绿 KPI + 大入口网格 + 项目清单 + 全局语音助手。
- 库房页重构：`packages/miniapp/pages/warehouse/index.{js,wxml,wxss}`
  - 库房 KPI（仓库数、待处理制单、库存预警、库存条目）与库房业务入口聚合。
  - 新增 `packages/miniapp/pages/{warehouse-stock-order,warehouse-inventory,warehouse-dispatch}/index.*` 承接制单、库存、调度。
  - `warehouse-stock-order` 采用“检索库 + 购物车清单”结构，支持扫码加入、关键字筛选、模板套用、统一提审。
- 审批与申请页重构：`packages/miniapp/pages/finance/index.{js,wxml,wxss}`
  - 待办/发起分段器 + 快捷动作入口 + 全局语音助手。
- 我的页重构：`packages/miniapp/pages/profile/index.{js,wxml,wxss}`
  - 个人申请时间线、证书预警卡、联调配置区。
  - 个人证书卡新增附件入口：支持“查看/下载”证书文件（无附件时显示占位并给出提示）。
- 核心业务页视觉强化：
  - 审批：`packages/miniapp/pages/approval/index.{js,wxml,wxss}`（红黄绿摘要 + 长按后滑动解锁通过）
  - 报销：
    - `packages/miniapp/pages/reimbursement-list/index.{js,wxml,wxss}`（我的报销提交列表）
    - `packages/miniapp/pages/reimbursement/index.{js,wxml,wxss}`（报销详情/新建，非办公室个人操作闭环）
  - 对外付款：`packages/miniapp/pages/payment-apply/index.{js,wxml,json}`（付款草稿创建 + 提交审批）
  - 施工日志：`packages/miniapp/pages/{log,operator-log,manager-log}/index.{js,wxml,wxss}`（双轨入口与语音提示）
  - 设备/勘查：`packages/miniapp/pages/{asset,survey}/index.{js,wxml}`（图标化状态与风险提示）
- 交互反馈工具：`packages/miniapp/utils/interaction.js`
  - 封装短震/长震与统一 toast，供审批/报销/勘查等关键流程复用。
- 权限一致性补齐：
  - `packages/miniapp/pages/finance/index.{js,wxml}`：按角色显示“对外付款”入口
- `packages/miniapp/pages/reimbursement/index.{js,wxml}`：聚焦个人报销操作（保存草稿、上传附件、提交报销）
  - UUID 绑定区前置到页面上部，先绑定再录入，减少现场漏绑。
  - `uuid/发票号/金额/类别` 输入框统一标准高度，避免文字显示被压缩。
  - 电子发票按钮文案收敛为“上传电子发票（自动OCR）”；提示文案明确“资料确认后点击提交报销”。
  - 当报销通道为“电子发票”时，UUID 输入与扫码录入自动禁用，UUID 由后端自动生成。
  - `packages/miniapp/pages/approval/index.{js,wxml}`：转签改为动态成员选择（基于企业微信通讯录）
  - `packages/api/src/routes/survey.ts`：现场勘查提交支持 `operator` 角色

### 4.2.2 Miniapp 语音助手联动（2026-02）
- 后端语音能力：
  - 新增 `packages/api/src/routes/voice.ts`
  - `POST /api/v1/voice/stt`：提交语音识别任务（基于 AI Slot task_queue）
  - `GET /api/v1/voice/stt/:taskId`：轮询识别状态与转写文本
  - `POST /api/v1/voice/command-parse`：将文本解析为小程序动作（navigate/switchTab）
- AI 任务类型扩展：
  - 更新 `packages/api/src/types/ai.ts`，新增 `voice_stt` 任务类型
  - 更新 `packages/api/src/index.ts`，注册 `/api/v1/voice` 路由
- 小程序录音上传与指令执行：
  - 新增 `packages/miniapp/utils/voice-assistant.js`（录音、上传、STT轮询、指令解析、动作执行）
  - 更新 `packages/miniapp/utils/wx.js`，新增 `wxRecordAudioOnce`
  - 语音助手 FAB 接入页面：
    - `packages/miniapp/pages/index/index.js`
    - `packages/miniapp/pages/finance/index.js`
    - `packages/miniapp/pages/warehouse/index.js`
    - `packages/miniapp/pages/log/index.js`
    - `packages/miniapp/pages/profile/index.js`
    - `packages/miniapp/pages/reimbursement/index.js`

### 4.2.3 进度看板项目选择优化（2026-02）
- miniapp 项目进度看板改为“项目名称下拉”而非“输入项目编号”：
  - `packages/miniapp/pages/progress/index.js`
  - `packages/miniapp/pages/progress/index.wxml`
  - 复用组件 `packages/miniapp/components/business/project-picker/index.{js,wxml}`
- web 施工进度看板改为“项目名称下拉（显示名称+编号）”而非“项目ID输入框”：
  - `packages/web/src/views/construction/dashboard.vue`
  - 复用 API `packages/web/src/api/project.ts` 的 `listProjects`

### 4.3 TDesign 组件库使用规范（小程序）

#### 4.3.1 全局接入
- 依赖：`packages/miniapp/package.json` 使用 `tdesign-miniprogram`。
- 全局样式入口：`packages/miniapp/app.wxss` 通过 `@import "tdesign-miniprogram/common/style/index.wxss";` 引入。
- 全局组件注册：`packages/miniapp/app.json` 统一注册 `t-button`、`t-tag`、`t-empty`、`t-divider`、`t-loading`、`t-cell`、`t-cell-group`、`t-notice-bar`。

#### 4.3.2 视觉与排版规范
- 页面背景采用低对比浅灰（`#f3f5f8`），信息承载用白卡片，强调层级优先通过字重和间距，不依赖重阴影。
- 标题层级：页面主标题 `32rpx/600`，说明文字 `24rpx`，保持企业场景高可读性。
- 间距节奏采用 8 的倍数（8/16/24/32rpx），页面边距 `24rpx`，关键动作区留足触控空间。

#### 4.3.3 组件映射（页面级）
- 工作台 `packages/miniapp/pages/index/index.wxml`：`t-button` + 统计卡片 + 分区入口网格。
- 日志中心 `packages/miniapp/pages/log/index.wxml`：`hy-panel-card` + 快捷入口，完成角色分流。
- 操作员日志 `packages/miniapp/pages/operator-log/index.wxml`：`hy-project-picker`、日期选择、班次中文选择、`t-button`，强化“预填-校对-提交”。
- 管理员日志 `packages/miniapp/pages/manager-log/index.wxml`：`hy-project-picker`、日期选择、拍照上传、`hy-status-chip`。
- 审批 `packages/miniapp/pages/approval/index.wxml`：`t-button`、`t-empty`，用于动作一致性与无数据空态。
- 报销 `packages/miniapp/pages/reimbursement/index.wxml`：`t-notice-bar`、`t-tag`、`t-button`，用于链路状态可视化（OCR/PDF）。
- 查询中心 `packages/miniapp/pages/query/index.wxml`：`hy-panel-card` + 入口卡片网格，统一承接高权限查询入口。
- 合同/付款/收款查询：
  - `packages/miniapp/pages/query-contract/index.wxml`
  - `packages/miniapp/pages/query-payment/index.wxml`
  - `packages/miniapp/pages/query-receipt/index.wxml`
  - 统一使用 `picker + input + t-button + hy-status-chip` 组合完成筛选、分页与状态展示。
- 合同/付款/收款查询详情：
  - `packages/miniapp/pages/query-contract-detail/index.wxml`
  - `packages/miniapp/pages/query-payment-detail/index.wxml`
  - `packages/miniapp/pages/query-receipt-detail/index.wxml`
  - 统一使用 `hy-panel-card + status-chip + 只读字段卡片` 展示详情，保持与列表页视觉一致。
- 勘查 `packages/miniapp/pages/survey/index.wxml`：`t-notice-bar`、`t-tag`、`t-button`，突出定位与图片采集流程。
- 设备 `packages/miniapp/pages/asset/index.wxml`：`t-notice-bar`、`t-empty`、`t-button`，突出扫码与状态查看。
- 进度 `packages/miniapp/pages/progress/index.wxml`：`t-cell`、`t-empty`、`t-button`，提升指标与预警信息扫描效率。
- 通知 `packages/miniapp/pages/notice/index.wxml`：`t-empty` + 列表卡片，保持消息列表简洁。
- 个人中心 `packages/miniapp/pages/profile/index.wxml`：`t-notice-bar`、`t-button`，支持联调配置与安全退出。

#### 4.3.6 业务组件下沉规范（components/）
- 业务组件目录：`packages/miniapp/components/business/`
- 组件分层原则：
  - `panel-card`：统一页面区块容器（标题、副标题、内容 slot），用于替代页面内重复 `.card + .title + .sub` 结构。
  - `status-chip`：统一状态标签封装（基于 `t-tag`），用于 OCR/PDF/数量等轻状态展示。
- 当前已下沉组件：
  - `packages/miniapp/components/business/panel-card/index.*`
  - `packages/miniapp/components/business/status-chip/index.*`
- 页面改造要求：
  - 业务页优先使用 `hy-panel-card` 承载每个功能区块，禁止重复定义局部卡片容器样式。
  - 状态短信息优先使用 `hy-status-chip`，禁止页面内直接堆叠零散 `t-tag` 并各自定义色值。

#### 4.3.4 交互与反馈规范
- 异步操作统一：按钮 `loading + disabled`，避免重复提交。
- 危险/不可逆动作：必须二次确认（弹窗）后执行。
- 空数据态：统一使用 `t-empty`；非空态优先卡片或 `t-cell` 展示。
- 状态信息：统一使用 `t-tag`（如 OCR/PDF 状态），避免纯文本弱提示。
- 表单字段：必填项在标签侧使用 `required` 语义标记，与前端校验规则一致。

#### 4.3.5 图标与入口信息密度优化
- 入口型页面（项目/财务/库房/日志中心）统一使用“图标 + 标题 + 说明”三段式入口卡片，提升扫描效率。
- 卡片标题支持图标（`hy-panel-card` 的 `icon` 属性），确保区块语义一眼可辨。
- 个人中心信息行使用图标前缀，降低纯文本信息疲劳。

#### 4.3.5 禁止事项
- 禁止页面内随意引入未注册的第三方 UI 组件，避免风格和交互碎片化。
- 禁止在业务页硬编码大量独立色值，优先复用全局 tokens 与语义类。
- 禁止以 toast 代替关键确认流程（删除、拒绝、转签等动作必须确认）。

### 4.4 小程序项目模块重构约束（新增）

#### 4.4.1 页面与路径映射
- 项目列表（重构后主入口）：`packages/miniapp/pages/index/index`
- 项目列表（独立长列表页）：`packages/miniapp/pages/project-list/index`
- 项目详情（新增）：`packages/miniapp/pages/project-detail/index`
- 标段详情（新增）：`packages/miniapp/pages/project-section/index`
- 项目模块配置：`packages/miniapp/app.json`
- 项目接口封装：`packages/miniapp/utils/request.js`

#### 4.4.2 角色行为边界
- 参与者（项目成员）：可见详情中的协同动作入口（按后端权限返回）。
- 非参与者：允许浏览全部项目列表与详情，但详情必须是只读模式。
- 非参与者禁止项：提交审批、提交财务类动作、库存/出入库写操作、配置型操作。
- 任何写操作均以服务端鉴权为最终裁决；前端只读态仅用于降低误触。
- 项目日志边界与 Web 统一：项目详情中的“项目日志一站式视图”仅展示项目级管理员日志。
- 标段内容边界与 Web 统一：施工日志与贯通报告仅在“标段详情”上下文展示与维护（查看/新增/编辑）。
- 项目日志移动端交互：默认折叠，按日期降序展示，列表头只显示日期（精确到天）和中文状态；点击后展开完整内容与照片。
- 标段入口移动端交互：项目详情中的标段卡片仅负责跳转，点击后进入独立标段页查看施工日志与贯通信息，减少长列表滚动与误触。
- 工作台首页边界：`pages/index/index` 不直接承载项目长列表，仅提供“进入项目列表”入口，避免首页过长影响首屏操作效率。
- 工作台与库房边界：项目/现场相关能力留在工作台与项目页，`pages/warehouse/index` 仅承载库房与资产管理能力。
- 施工日志填写交互：`pages/operator-log/index` 使用“项目 -> 标段选择器”模式，禁止手输标段ID。
- 班次判定交互：默认按填写时间自动判定（晚间偏白班收尾、早间偏夜班收尾），仍允许手动改班次并提供一键重判。
- 下管数量交互：允许填写“本班下管数”或“累计下管数”任一项，前端自动联动推算另一项，并展示历史累计提示。

#### 4.4.3 范围锁定（本期禁止变更）
- 财务模块入口与行为保持不变：`packages/miniapp/pages/finance/index`
- 库房模块入口调整为“库房管理工作台”并对齐 Web：`packages/miniapp/pages/{warehouse,warehouse-stock-order,warehouse-inventory,warehouse-dispatch}/index`
- 本期允许调整仅限项目模块的信息架构、页面跳转与只读提示层。

### 4.2.4 审批状态可视化补齐（2026-03）
- 小程序审批页补齐三视图切换：`packages/miniapp/pages/approval/index.wxml`
- 小程序审批页状态数据与动作联动：`packages/miniapp/pages/approval/index.js`
- 小程序审批页状态样式与分段标签：`packages/miniapp/pages/approval/index.wxss`

### 3.13 审批流程初始化与状态视图补齐（2026-03）
- 审批模板页新增“一键初始化默认流程”入口：`packages/web/src/views/approval/template-config.vue`
- 审批中心列表补齐实例状态/动作中文态与筛选联动：`packages/web/src/views/approval/index.vue`
- 审批 API 参数扩展（biz_type/keyword/status）：`packages/web/src/api/approval.ts`
- 审批初始化 API 封装：`packages/web/src/api/admin.ts`

### 3.14 合同详情与审批AI视图增强（2026-03）
- 合同详情页附件录入从 JSON 文本改为“拖拽上传 + 预览/下载”文件管理：`packages/web/src/views/finance/contract/detail.vue`
- 合同详情页在审批进行中显示锁定提示，并禁用可编辑字段与保存动作：`packages/web/src/views/finance/contract/detail.vue`
- 合同金额输入改为普通数字输入框，输入后实时显示加粗中文大写金额：`packages/web/src/views/finance/contract/detail.vue`
- 审批详情页新增“AI审核结果”专栏（节点、状态、结论、建议、错误信息、完成时间）：`packages/web/src/views/approval/detail.vue`
- 审批流程时间线新增“设定审批人”显示（每节点 assignee_userids 全量可见）：`packages/web/src/views/approval/detail.vue`
- 审批详情响应类型扩展 AI关卡结果字段：`packages/web/src/api/approval.ts`、`packages/api/src/types/approval.ts`、`packages/api/src/services/approval/engine.ts`

### 3.15 AI关卡卡点处置能力（2026-03）
- 新增超管 AI 关卡任务管理视图（全量列表、状态筛选、关键字查询）：`packages/web/src/views/admin/ai-gate-tasks.vue`
- 新增超管手动处置动作（放行/驳回/补充意见）：`packages/web/src/views/admin/ai-gate-tasks.vue`
- 新增后端 AI关卡任务管理 API：`packages/api/src/routes/admin.ts`
- 审批返回到 AI 节点后强制触发重新审核（避免复用旧结论）：`packages/api/src/services/approval/executors.ts`、`packages/api/src/services/approval/operations.ts`
- Runner 监控页新增“手动激活节点”操作（超管）：`packages/web/src/views/ai/nodes.vue`
- 新增 Runner 手动激活 API：`packages/api/src/routes/admin.ts`

### 3.16 智能发单台附件必传与成功回跳（2026-03）
- 智能发单台新增合同附件、付款附件上传区，支持拖拽上传并在页内展示附件清单：`packages/web/src/views/finance/payment/wizard.vue`
- 发起校验收敛：合同流必须存在合同附件；直接付款必须存在付款附件；启用“首笔预付款”时必须存在首笔付款附件：`packages/web/src/views/finance/payment/wizard.vue`
- 提交流程保持“创建并提审”闭环后自动跳转到刚创建的详情页（合同跳转合同详情，付款跳转付款详情）：`packages/web/src/views/finance/payment/wizard.vue`

### 3.17 发单台与付款详情审批可用性增强（2026-03）
- 智能发单台合同流字段补齐为“合同审查前置采集”模式：合同类型、经办人、合同日期、主体、对方单位、合同附件在发起前完成填写，减少提交后补录：`packages/web/src/views/finance/payment/wizard.vue`
- 智能发单台“合同+同步付款”场景改为仅填写付款额外字段（首笔金额、付款类别、付款日期、付款方式、付款事由、首笔附件），不再重复填写合同内字段：`packages/web/src/views/finance/payment/wizard.vue`
- 智能发单台“直接付款”场景要求完整付款审批字段（类别/日期/方式/内容/附件）后方可提交：`packages/web/src/views/finance/payment/wizard.vue`
- 金额相关展示统一为“千分位 + 两位小数 + 中文大写”双显式格式，降低操作歧义：`packages/web/src/views/finance/payment/wizard.vue`、`packages/web/src/views/finance/contract/detail.vue`、`packages/web/src/views/finance/payment/detail.vue`
- 合同详情增强“我方主体”展示：显示主体全名并联动显示付款账号信息（开户行/账号）：`packages/web/src/views/finance/contract/detail.vue`
- 付款详情增强信息聚合：项目名称、我方主体及账号、对方主体及账号、审批节点与意见、AI审核意见、附件查看/上传/下载：`packages/web/src/views/finance/payment/detail.vue`
- 付款详情审批中锁定业务字段，但保留附件补传能力；审批中禁删附件以支持补传付款凭证：`packages/web/src/views/finance/payment/detail.vue`

### 3.18 审批提交设置可视化改造（2026-03）
- 合同详情与付款详情的“审批提交设置”改为可视化表单优先（审批摘要、临时审批人多选、审批说明），降低 JSON 配置心智负担：`packages/web/src/views/finance/contract/detail.vue`、`packages/web/src/views/finance/payment/detail.vue`
- JSON 高级模式仅对 `super_admin` 暴露，其他角色仅可使用可视化模式：`packages/web/src/views/finance/contract/detail.vue`、`packages/web/src/views/finance/payment/detail.vue`
- 可视化模式新增“审批说明常用模板”下拉，支持一键填充审批说明文本以提升提审效率：`packages/web/src/views/finance/contract/detail.vue`、`packages/web/src/views/finance/payment/detail.vue`

### 3.19 对外付款附件上传链路修复（2026-03）
- 对外付款相关页面的附件上传 URL 统一通过 API 基地址解析，避免在生产环境命中前端网关导致 `PUT` 请求 `405`：`packages/web/src/api/upload.ts`
- 对外付款页（付款详情、智能发单台、合同详情）上传逻辑统一改为使用解析后的绝对上传地址：`packages/web/src/views/finance/payment/detail.vue`、`packages/web/src/views/finance/payment/wizard.vue`、`packages/web/src/views/finance/contract/detail.vue`

### 3.20 审批台申请详情增强与AI关卡上下文修复（2026-03）
- 审批详情页新增按业务类型展示申请明细：
  - 付款申请：显示付款关键字段与附件清单（可直接查看附件）
  - 合同申请：显示合同关键字段与附件清单
  - 报销批次：显示批次关键字段与明细项列表
  对应文件：`packages/web/src/views/approval/detail.vue`
- AI关卡任务载荷补齐业务上下文与申请摘要，避免模板变量 `context` 为空导致模型拒绝判断：`packages/api/src/services/approval/engine.ts`、`packages/api/src/services/approval/executors.ts`
- 提交审批时后端补齐结构化上下文（申请内容、金额、对象信息、附件元信息）供 AI 关卡判定使用：`packages/api/src/routes/payment.ts`、`packages/api/src/routes/contract.ts`、`packages/api/src/routes/reimbursement.ts`

### 3.21 AI关卡附件正文理解增强（2026-03）
- `approval_ai_gate` 任务启用附件正文处理链路：与 `contract_review` 一致支持附件下载、正文抽取与视觉回退：`task-runner/runner/executor.py`
- 文件处理策略：
  - `docx`：直接提取段落文本
  - `doc`：二进制文本片段抽取（可读内容提取）
  - `pdf`：优先提取可选中文本，文本不足时转图片页走视觉输入
  - 图片：直接以 data URL 作为视觉输入
- 提示词变量渲染增强：对象变量（如 `context`）改为 JSON 字符串渲染，避免模板出现 `[object Object]`：`packages/api/src/services/ai-slot.ts`

### 3.22 流转台附件下载与快速预览优化（2026-03）
- 流转台审批详情附件链接改为绝对 API 地址，修复点击下载跳转首页问题：`packages/web/src/views/approval/detail.vue`
- 流转台新增附件抽屉预览能力，支持 PDF/图片/TXT 快速内嵌预览，其他格式保留下载打开：`packages/web/src/views/approval/detail.vue`
- AI关卡 context 兜底增强：当业务侧未显式提供 context 时，后端自动补齐最小上下文（biz_type/biz_id/biz_summary），避免空 context 导致模型拒绝：`packages/api/src/services/approval/engine.ts`、`packages/api/src/services/approval/executors.ts`

### 3.23 AI审批台结果展示优化与北京时间统一（2026-03）
- AI审核结果表格精简为核心信息：节点、状态（中文）、结论（建议通过/建议拒绝/建议补充材料）、总结（comment）、完成时间：`packages/web/src/views/approval/detail.vue`
- 审批流程线中 AI 节点动作改为建议性结论文案，并在同一行追加 comment：`packages/web/src/views/approval/detail.vue`
- AI关卡任务总览（超管页）状态与动作文案中文化，时间统一北京时间：`packages/web/src/views/admin/ai-gate-tasks.vue`
- 审批中心相关页面时间统一格式为北京时间 `YYYY-MM-DD HH:mm:ss`：`packages/web/src/views/approval/detail.vue`、`packages/web/src/views/approval/index.vue`、`packages/web/src/views/approval/unified-tasklist.vue`、`packages/web/src/utils/datetime.ts`
- AI审核结果新增 `summary` JSON 兼容解析（回填 outcome/comment），避免历史数据顶层字段为空导致“结论/总结”空白：`packages/web/src/views/approval/detail.vue`

### 3.24 Web付款无合同阈值放行与审批明细名称化（2026-03）
- 智能发单台（阈值内）支持“无合同/无需合同”选项，仍可按需关联已有合同，且提交时强校验超阈值必须走合同流：`packages/web/src/views/finance/payment/wizard.vue`
- 智能发单台在选择已有关联合同时，实时显示合同可用额度（`total_amount - paid_amount`），并在提交前前端拦截“申请金额超过合同可用额度”的场景：`packages/web/src/views/finance/payment/wizard.vue`
- 付款申请后端支持 `contract_id` 可空，并在无合同时按 `payment_request` 阈值规则校验金额上限：`packages/api/src/routes/payment.ts`、`packages/api/src/types/contract.ts`
- 付款提审自动触发风险评估（无需手工点击），并统一风险任务载荷结构：`packages/api/src/routes/payment.ts`
- AI关卡上下文补齐合同信息与合同附件，合并 `payment_attachments + contract_attachments` 进入统一 `attachments`，避免仅凭付款附件做片面判断：`packages/api/src/routes/payment.ts`、`packages/api/src/services/ai-slot.ts`
- 审批详情“申请明细”中的合同/项目/主体/人员改为展示名称（或合同号+对方单位），不再直接显示 ID：`packages/web/src/views/approval/detail.vue`
- Web 付款 API 类型同步支持可空合同：`packages/web/src/api/payment.ts`

### 3.25 Web 付款详情与发单提交可用性加固（2026-03）
- 付款详情附件“查看/下载”统一改为绝对 API 地址并补齐下载属性，修复工作台路由下点击附件误跳转问题：`packages/web/src/views/finance/payment/detail.vue`
- 付款详情新增超管“废除付款”动作（危险确认 + 状态刷新），补齐高权限终止路径：`packages/web/src/views/finance/payment/detail.vue`、`packages/web/src/api/payment.ts`
- 后端新增 `POST /api/v1/payment/:id/void`（仅 `super_admin`），废除时同步取消在途审批任务/实例，已付款场景回退合同 `paid_amount`：`packages/api/src/routes/payment.ts`、`packages/api/src/services/event-bus.ts`
- Web 智能发单台提交动作补齐防重与反馈统一：提交中 loading、成功提示“提交成功”并返回上一级、失败提示“提交失败，请重试”：`packages/web/src/views/finance/payment/wizard.vue`

### 4.5 小程序审批端与Web审批台信息对齐（2026-03）
- 小程序审批中心从“仅列表+动作”升级为“可展开审批详情”，补齐与 Web 一致的决策关键信息：`packages/miniapp/pages/approval/index.js`、`packages/miniapp/pages/approval/index.wxml`、`packages/miniapp/pages/approval/index.wxss`
- 详情弹层补齐业务摘要与流程信息：审批编号、业务类型、发起人、状态、提交流转时间、节点意见与动作：`packages/miniapp/pages/approval/index.wxml`
- 按业务类型展示申请明细：付款/合同/报销批次字段对齐 Web 审批详情，降低跨端歧义：`packages/miniapp/pages/approval/index.js`、`packages/miniapp/pages/approval/index.wxml`
- 附件处理补齐：小程序端支持附件查看（图片预览，文档下载后打开），与 Web 审批决策链一致：`packages/miniapp/pages/approval/index.js`
- AI审核结果补齐：显示状态、建议结论（通过/拒绝/补充材料）与 comment，总结结构兼容 `summary` JSON：`packages/miniapp/pages/approval/index.js`、`packages/miniapp/pages/approval/index.wxml`
- 时间统一：小程序审批页时间统一转换并显示为北京时间 `YYYY-MM-DD HH:mm:ss`：`packages/miniapp/pages/approval/index.js`

### 4.6 小程序审批中心重构（去快速审批，详情页闭环）（2026-03）
- 审批中心列表页重构为“轻量卡片导航”，移除列表内快速审批动作，减少文字堆叠与误触：`packages/miniapp/pages/approval/index.js`、`packages/miniapp/pages/approval/index.wxml`、`packages/miniapp/pages/approval/index.wxss`
- 新增独立审批详情页，所有审批动作（通过/驳回/退回/转签）在详情页完成，形成直觉闭环：`packages/miniapp/pages/approval-detail/index.js`、`packages/miniapp/pages/approval-detail/index.wxml`、`packages/miniapp/pages/approval-detail/index.wxss`
- 路由补齐：新增小程序审批详情页面注册：`packages/miniapp/app.json`
- 首页入口文案同步更新为“进入审批中心查看详情”，与新交互一致：`packages/miniapp/pages/index/index.js`

### 4.7 小程序审批详情视觉减负优化（2026-03）
- 审批详情页面按信息域分色分区（摘要/业务明细/附件/AI结果/流程/操作意见），并增加板块分界线，降低视觉疲劳：`packages/miniapp/pages/approval-detail/index.wxml`、`packages/miniapp/pages/approval-detail/index.wxss`
- 信息点改为 dot + key/value 结构，并对关键值使用 tag（如业务类型、状态、AI结论）做颜色提示：`packages/miniapp/pages/approval-detail/index.wxml`
- 底部补齐固定操作栏，提供清晰、持续可见的审批动作按钮，避免长页滚动后找不到操作入口：`packages/miniapp/pages/approval-detail/index.wxml`、`packages/miniapp/pages/approval-detail/index.wxss`
- 审批流程默认折叠，支持一键展开/收起节点，降低初始阅读负担：`packages/miniapp/pages/approval-detail/index.wxml`、`packages/miniapp/pages/approval-detail/index.js`
- 操作按钮显示增加兜底策略（当接口未回传 `available_actions` 时按待办任务推断），避免底部操作区缺失：`packages/miniapp/pages/approval-detail/index.js`
- 底部操作布局优化为单排 40/40/20（通过/退回/更多），其余动作收纳到“更多”弹层，减少主操作区噪音：`packages/miniapp/pages/approval-detail/index.wxml`、`packages/miniapp/pages/approval-detail/index.js`、`packages/miniapp/pages/approval-detail/index.wxss`

### 4.8 工作台待办入口与提醒模块优化（2026-03）
- 工作台 `#/workspace/home` 顶部“待我审批”按钮改为带气泡未完成数，便于快速感知待办压力：`packages/web/src/views/welcome/index.vue`
- “待我审批”按钮从原目标页收敛到统一审批台入口：`/approval/index`，避免进入信息不足页面：`packages/web/src/views/welcome/index.vue`
- “我的待办提醒”模块由时间线改为可点击卡片列表 + 状态点样式，支持点击条目直达审批详情：`packages/web/src/views/welcome/index.vue`
- “我的待办提醒”标题追加未完成数量（与按钮气泡一致），并保留“进入统一审批台”快捷入口：`packages/web/src/views/welcome/index.vue`

### 4.9 审批结束锁定规则前端防回退加固（2026-03）
- 合同详情与付款详情的审批锁定判定收敛为共享 helper，避免页面各自维护条件导致回退：`packages/web/src/views/finance/shared/approvalLock.ts`、`packages/web/src/views/finance/contract/detail.vue`、`packages/web/src/views/finance/payment/detail.vue`
- 两个详情页新增“超管编辑模式开启后将强制留痕”的显式提示，降低误操作风险：`packages/web/src/views/finance/contract/detail.vue`、`packages/web/src/views/finance/payment/detail.vue`
- 付款详情上传控件状态与文案对齐：审批中允许补传附件（仍禁止删除），避免“提示可上传但控件禁用”的冲突：`packages/web/src/views/finance/payment/detail.vue`

### 4.10 审批申请明细（付款）可读性与动作防重入（2026-03）
- 审批详情页“申请明细（付款）”中的付款类别、付款方式统一中文化显示，避免原始值直出：`packages/web/src/views/approval/detail.vue`
- 审批详情页“申请明细（付款）”的关联合同改为可点击链接，直接跳转合同详情页：`packages/web/src/views/approval/detail.vue`
- 合同详情与付款详情在审批进行中/审批已结束时禁用“提交审批”“触发AI审查/风险评估”按钮，防止重复提审与不必要 AI 消耗：`packages/web/src/views/finance/contract/detail.vue`、`packages/web/src/views/finance/payment/detail.vue`

### 4.11 超管审批流程强制改派（2026-03）
- 审批详情流程线为 `super_admin` 增加“强制改派”入口，仅对待处理人工任务显示，支持直接替换当前审批人：`packages/web/src/views/approval/detail.vue`
- 审批详情新增“强制改派审批人（超管）”弹窗，要求填写改派原因并选择目标审批人，提交后即时刷新流程：`packages/web/src/views/approval/detail.vue`
- 新增超管专用后端接口 `POST /api/v1/approval/:id/force-transfer`，强制改派会写入 `approval_transfer` 留痕并标记来源：`packages/api/src/routes/approval.ts`、`packages/api/src/services/approval/operations.ts`、`packages/api/src/types/approval.ts`、`packages/web/src/api/approval.ts`

### 4.14 审批台附件补传（2026-03）
- 审批详情页支持在审批台直接上传附件到对应业务数据（当前支持付款申请、合同审批）：`packages/web/src/views/approval/detail.vue`
- 前端新增审批附件上传 API：`packages/web/src/api/approval.ts`
- 后端新增 `POST /api/v1/approval/:id/attachments`，按审批实例定位业务并写回 `attachments_json`，限制为“当前待处理审批人或超管”可操作：`packages/api/src/routes/approval.ts`

### 4.12 正式发票签发附件化与自动回填（2026-03）
- 发票签发弹窗收敛为“上传发票附件 + 备注”，去除开票日期、发票代码、号码、校验码、金额等人工输入项：`packages/web/src/views/finance/receipt/invoice.vue`
- 签发接口改为仅要求 `file_key`，签发后自动触发 `ocr_extract` 任务进行二维码/OCR解析并回填发票字段：`packages/api/src/routes/receipt.ts`、`packages/web/src/api/receipt.ts`
- 发票校验状态接口在任务完成后会同步回填 `invoice_code/invoice_number/check_code/issue_date/amount_with_tax/title/tax_no/qr_code`，并保留匹配结果：`packages/api/src/routes/receipt.ts`
- OCR 默认抽取 schema 补充 `invoice_code/check_code/qr_code_text`，提升回填完整度：`task-runner/runner/executor.py`

### 4.13 财务快照看板多维升级（2026-03）
- 快照看板升级为多维分析视图，支持按时间（按月/按年）、项目、办公室行政、业务类型筛选：`packages/web/src/views/finance/receipt/dashboard.vue`
- 新增管理分析指标：对外付款/对内付款/收款三类金额、完成量、待处理量，以及全口径资金总额：`packages/web/src/views/finance/receipt/dashboard.vue`
- 新增图表：
  - 趋势图（时间维度堆叠柱 + 合计折线）
  - 结构图（业务占比环形图）
  文件：`packages/web/src/views/finance/receipt/dashboard.vue`
- 新增“明细追踪”表：展示业务类型、单号、项目、办公室行政、金额、状态、业务时间、最近追踪时间、追踪信息；点击单号可跳转对应业务页面：`packages/web/src/views/finance/receipt/dashboard.vue`
- 新增后端聚合接口 `GET /api/v1/dashboard/finance-snapshot`，统一输出 summary/charts/details/pagination，支撑前端一屏分析与钻取：`packages/api/src/routes/dashboard.ts`、`packages/web/src/api/dashboard.ts`

### 4.14 报销信封生命周期重构（2026-03）
- 预生成实物信封改为“未登记”状态，现场人员在发起报销时扫码登记并绑定填报人，避免批量生成阶段提前占用身份：`packages/api/src/routes/reimbursement.ts`、`packages/web/src/views/finance/reimbursement/list.vue`
- 新增实物信封提交动作 `POST /api/v1/reimbursement/:id/submit`：要求已登记且至少有一个附件后才能提交，并自动触发 OCR/异常检测任务：`packages/api/src/routes/reimbursement.ts`、`packages/web/src/views/finance/reimbursement/detail.vue`
- 电子发票上传改为直达“已接收”阶段，并在入池后立即触发 AI 审计链路（OCR + 异常检测）：`packages/api/src/routes/reimbursement.ts`、`packages/web/src/views/finance/reimbursement/list.vue`
- 新增 UUID 快速定位接口 `GET /api/v1/reimbursement/resolve/by-uuid`，办公室可通过扫码/粘贴 UUID 快速打开对应报销信封：`packages/api/src/routes/reimbursement.ts`、`packages/web/src/api/reimbursement.ts`、`packages/web/src/views/finance/reimbursement/list.vue`
- 小程序报销流程对齐 Web 个人报销：新增“我的报销提交”列表页，并将详情页统一为“保存草稿 → 上传附件（实物/电子）→ 提交报销”闭环：`packages/miniapp/pages/reimbursement-list/index.{js,wxml,wxss}`、`packages/miniapp/pages/reimbursement/index.{js,wxml,wxss}`

### 4.15 报销前端角色化流程重组（2026-03）
- 报销入口页改为角色化多视图（员工/办公室/财务），降低“同页混合多角色动作”的理解成本：`packages/web/src/views/finance/reimbursement/list.vue`
- 员工视图默认锁定“我的提交”（按当前用户过滤），并提供发起报销入口（实物信封/电子发票）与 UUID 快速打开：`packages/web/src/views/finance/reimbursement/list.vue`
- 办公室视图聚焦 submitted/received 阶段处理，直达预审工作台与查重中心：`packages/web/src/views/finance/reimbursement/list.vue`
- 财务集中审批页新增“候选条目自动汇总 + 一键创建并送审 + 历史完成批次”三段布局，满足发起、送审、复盘一体化：`packages/web/src/views/finance/reimbursement/batch.vue`
- 路由权限收敛：报销集中审批入口移除 operator，仅保留 super_admin/manager/site_manager/finance：`packages/web/src/router/modules/finance.ts`

### 4.16 对内付款路由精简与工作台入口迁移（2026-03）
- 员工报销入口迁移至个人工作台，新增“我的报销”路由与详情路由：`packages/web/src/router/modules/workspace.ts`、`packages/web/src/views/welcome/index.vue`
- 对内付款主路由限定为办公室/领导/财务页面，移除 operator 在该主路由下的入口角色：`packages/web/src/router/modules/finance.ts`
- 对内付款路由下移除“预审工作台”“查重中心”独立页面入口，改为业务页内联处理：`packages/web/src/router/modules/finance.ts`、`packages/web/src/views/finance/reimbursement/list.vue`

### 4.17 Miniapp 智能发单台全面对齐（2026-03）
- miniapp 对外付款页重构为“阈值识别 + 双流程（直付/合同）”的一体化页面，阈值内直接创建付款并提审，超阈值自动转合同流程：`packages/miniapp/pages/payment-apply/index.{js,wxml,wxss,json}`
- 直付流程字段与 Web 对齐：合同（可选）、项目、收款方、付款日期、付款类别、付款方式、付款事由、备注、附件（图片/文件）与提交审批动作：`packages/miniapp/pages/payment-apply/index.{js,wxml}`
- 合同流程字段与 Web 对齐：项目、我方主体、对方单位、经办人、合同日期、合同类型、合同附件，并支持“同时发起首笔预付款”子流程（金额/类别/日期/方式/事由/附件）：`packages/miniapp/pages/payment-apply/index.{js,wxml}`
- 收款方数据源与 Web 对齐为仅外部收款人（`type=external`），智能发单台不展示内部收款人，避免与报销打款场景混淆：`packages/miniapp/pages/payment-apply/index.js`
- 直付与合同两种流程均支持“快速添加外部收款人”，新增成功后刷新下拉并在当前流程自动选中新建项：`packages/miniapp/pages/payment-apply/index.{js,wxml,wxss}`
- 快速添加外部收款人流程增强：当远端刷新失败时保留本地回填与自动选中，避免“创建成功但下拉未更新”导致误判失败：`packages/miniapp/pages/payment-apply/index.js`
- 收款方/对方单位选中后新增账户核对卡片，展示完整信息（收款人、开户行、银行账号、联系电话），与 Web 核对逻辑一致：`packages/miniapp/pages/payment-apply/index.{js,wxml,wxss}`
- 快速添加外部收款人组件位置前置到“预计付款总额”与“直付/合同流程区”之间，弹出后更易感知与填写：`packages/miniapp/pages/payment-apply/index.wxml`
- 项目选择组件绑定改为纯 data 数值字段（`directProjectValue/contractProjectValue`），避免模板表达式计算导致的绑定不稳定：`packages/miniapp/pages/payment-apply/index.{js,wxml}`
- 首笔预付款类别在 UI 使用中文标签（预付款/进度款/结算款），提交值保留后端枚举（`prepayment/progress/settlement`），兼顾可读性与接口契约：`packages/miniapp/pages/payment-apply/index.js`

### 4.18 Miniapp 项目选择去 GPS 化（指定流程）（2026-03）
- `智能发单台` 与 `我的报销提交` 两个流程中的项目选择禁用 GPS 定位匹配按钮，仅保留人工选择与刷新：`packages/miniapp/pages/payment-apply/index.wxml`、`packages/miniapp/pages/reimbursement/index.wxml`
- `hy-project-picker` 新增 `enableGps` 配置项（默认开启）；业务页可按流程关闭 GPS 匹配而不影响其他页面：`packages/miniapp/components/business/project-picker/index.{js,wxml}`

### 4.19 Miniapp 一键催办（审批人可选 + 二次企微推送）（2026-03）
- 个人中心“一键催办”由静态按钮改为真实催办流程：先选择审批单，再选择待审批人，最后确认发送催办：`packages/miniapp/pages/profile/index.{js,wxml}`
- 新增审批可催办列表接口 `GET /api/v1/approval/remindable`（发起人视角，仅返回仍在处理中的审批及其待审批任务）：`packages/api/src/routes/approval.ts`
- 新增催办动作接口 `POST /api/v1/approval/:id/urge`，允许发起人（及管理角色）对指定 pending task 发起二次提醒：`packages/api/src/routes/approval.ts`、`packages/api/src/types/approval.ts`
- 企微模板卡推送服务新增催办模式（标题/文案区分）与去重可控参数；催办场景关闭重复检查以确保二次消息可达：`packages/api/src/services/wecom-approval-push.ts`
- 催办推送结果写入事件日志（`wecom_template_card_urge_sent` / `wecom_template_card_urge_failed`），便于后续运营与审计追踪：`packages/api/src/routes/approval.ts`

### 4.20 Miniapp 图标字体网络依赖收敛（2026-03）
- 个人中心与业务卡片组件移除直接 `t-icon` 依赖，改为本地图标字符展示，避免渲染层外网字体请求：`packages/miniapp/pages/profile/index.{wxml,wxss}`、`packages/miniapp/components/business/panel-card/index.{wxml,wxss,json}`
- 全局组件注册移除 `t-icon` 显式挂载，减少页面级无必要 icon 组件装载：`packages/miniapp/app.json`
- TDesign icon 样式中的远程字体源替换为本地 fallback，避免 `tdesign.gtimg.com` 字体拉取失败报错：`packages/miniapp/tdesign-miniprogram/icon/icon.wxss`、`packages/miniapp/miniprogram_npm/tdesign-miniprogram/icon/icon.wxss`

### 4.21 Miniapp 四大板块汉化补齐（2026-03）
- 资金流出与审批详情补齐枚举汉化：付款类别、付款方式、合同方向、合同类型统一展示中文标签，不再直出后端英文枚举：`packages/miniapp/pages/approval-detail/index.{js,wxml}`
- 库房板块补齐状态汉化：调度看板与库存列表改为中文状态文案（草稿/待审批/已执行/预警等），避免展示原始状态码：`packages/miniapp/pages/warehouse-dispatch/index.{js,wxml}`、`packages/miniapp/pages/warehouse-inventory/index.{js,wxml}`
- 工作台下项目链路补齐班次/状态汉化：标段详情日志中的班次显示改为白班/夜班，项目与标段状态未知兜底统一中文：`packages/miniapp/pages/project-section/index.{js,wxml}`、`packages/miniapp/pages/project-detail/index.js`、`packages/miniapp/pages/project-list/index.js`
- 个人中心补齐角色与认证方式汉化：角色从英文 role id 改为中文角色名，认证方式与动态状态文案统一中文展示：`packages/miniapp/pages/profile/index.{js,wxml}`
- 资产板块补齐候选设备状态汉化：设备候选列表状态不再显示英文枚举值：`packages/miniapp/pages/asset/index.{js,wxml}`

### 4.22 Miniapp 员工加油申请入口与 Web 对齐（2026-03）
- 审批与申请页（发起申请分段）新增“员工加油申请”入口卡片，形成与 Web `油卡额度申请` 等价入口：`packages/miniapp/pages/finance/index.wxml`
- 审批与申请页语音助手菜单新增“我要发起加油申请”快捷动作：`packages/miniapp/pages/finance/index.js`
- 新增“员工加油申请”页面，字段与 Web 保持一致：所用车辆、申请额度、车辆里程、现场照片，提交后展示我的申请记录：`packages/miniapp/pages/fuel-apply/index.{js,wxml,wxss,json}`
- 小程序路由注册补齐：`packages/miniapp/app.json`

### 4.23 Miniapp 办公室报销扫码核查页（2026-03）
- 新增办公室专用页面“信封扫码核查”，支持扫码信封 UUID 二维码后快速打开对应报销电子档案（自动定位并跳转详情）：`packages/miniapp/pages/reimbursement-archive/index.{js,wxml,wxss,json}`
- 页面同时支持手动输入/粘贴 UUID（含扫码链接自动提取 `envelope_uuid`），并维护最近核查记录列表，方便连续核查：`packages/miniapp/pages/reimbursement-archive/index.js`
- 流程入口补齐：审批与申请页（发起申请分段）新增“信封扫码核查”卡片，并在语音助手菜单新增快捷动作：`packages/miniapp/pages/finance/index.{js,wxml}`
- 小程序路由注册补齐：`packages/miniapp/app.json`

### 4.24 Miniapp 待我审批直出列表（2026-03）
- 流程页“待我审批”分段移除“统一审批列表 / AI 摘要卡片”二选一入口，改为页内直接展示待审批实例列表：`packages/miniapp/pages/finance/index.wxml`
- 新增待审批列表数据加载与映射（类型、状态、节点、提交时间），点击列表项直接进入审批详情：`packages/miniapp/pages/finance/index.js`
- 增加待审批列表空态与加载态样式，避免分段切换后的空白感：`packages/miniapp/pages/finance/index.wxss`

### 4.25 项目创建编号与项目经理选择优化（2026-03）
- Web 项目立项支持项目编号自动生成（页面默认预填 + 一键重新生成）；提交时若编号为空则由后端自动补齐：`packages/web/src/views/project/create.vue`、`packages/api/src/routes/project.ts`
- Web 项目经理选择改为“按姓名显示、按 userid 回填提交”：`packages/web/src/views/project/create.vue`
- Miniapp 项目创建页项目经理输入框改为下拉选择（显示姓名、回填 userid），并同步支持项目编号自动生成：`packages/miniapp/pages/project-create/index.{js,wxml}`

### 4.26 合同详情附件跳转修复与经办人显示收敛（2026-03）
- 合同详情附件“预览/下载”链接改为绝对 API 地址，避免在个人工作台 hash 路由下被前端路由吞掉导致跳转错误：`packages/web/src/views/finance/contract/detail.vue`
- 合同详情“经办人”下拉展示改为仅姓名，提交值继续使用 `userid`，降低选择噪音：`packages/web/src/views/finance/contract/detail.vue`

### 4.27 Miniapp 智能发单台提交反馈统一（2026-03）
- 小程序智能发单台直付/合同两条提交流程统一为：提交中 loading 防重、成功提示“提交成功”并返回上一级、失败提示“提交失败，请重试”：`packages/miniapp/pages/payment-apply/index.js`、`packages/miniapp/pages/payment-apply/index.wxml`

### 4.28 Web 付款详情超管“重新激活”能力（2026-03）
- 付款详情新增超管“重新激活”按钮，仅在已废除（`cancelled`）状态显示可用；激活后恢复草稿态并可重新提审：`packages/web/src/views/finance/payment/detail.vue`
- 前端付款 API 新增 `reactivatePayment(id)`：`packages/web/src/api/payment.ts`
- 后端新增 `POST /api/v1/payment/:id/reactivate`（仅 `super_admin`），将已废除付款恢复为 `draft`，清理旧审批实例关联并保留审计留痕：`packages/api/src/routes/payment.ts`
- 事件总线新增 `PAYMENT_REACTIVATED` 事件类型，支持后续审计与自动化订阅：`packages/api/src/services/event-bus.ts`

### 4.29 Miniapp 实物报销 UUID 提交闸门加固（2026-03）
- 小程序个人报销提交在实物信封通道下新增“有效 UUID”强校验：创建草稿与提交动作均要求 UUID 为合法格式，拦截占位符/无效值：`packages/miniapp/pages/reimbursement/index.js`
- 扫码录入 UUID 支持从扫码结果中自动提取 `envelope_uuid` 参数或 UUID 片段，无法识别时直接阻断提交流程：`packages/miniapp/pages/reimbursement/index.js`

### 4.30 Miniapp 报销与审批防重/加载兜底（2026-03）
- 报销附件支持“提交前删除”：报销详情附件列表新增删除按钮，仅在 `draft/unregistered` 状态可用，误选图片可即时移除：`packages/miniapp/pages/reimbursement/index.{js,wxml}`、`packages/api/src/routes/reimbursement.ts`
- 报销提交防重补强：提交请求增加 `Idempotency-Key`，且后端对已提交状态返回幂等成功，避免重复点击/网络抖动重复提交：`packages/miniapp/pages/reimbursement/index.js`、`packages/api/src/routes/reimbursement.ts`
- 电子发票创建态修正：电子发票上传后保持 `draft`，OCR 回填不再自动推进为 `submitted`，确保员工确认后再提交并避免旧数据污染：`packages/api/src/routes/reimbursement.ts`
- 小程序审批详情将“付款主体/付款方式”从强制改为可后续补充；审批动作仅在实例处于 `pending/in_progress` 且当前节点待办属于本人时可用：`packages/miniapp/pages/approval-detail/index.js`
- 企业微信推送进入审批详情增加关键数据重试加载（审批详情/付款/合同/批次/选项），降低字段或选项偶发缺失：`packages/miniapp/pages/approval-detail/index.js`
- 后端提交兜底校验：`POST /api/v1/reimbursement/:id/submit` 在 `physical` 通道下强制校验已绑定 UUID 格式，不满足则拒绝提交：`packages/api/src/routes/reimbursement.ts`

### 4.31 Miniapp 报销提交流程去歧义（2026-03）
- 报销提交页字段顺序调整：`报销通道` 前置到 `绑定信封 UUID` 上方，保持“先选通道、再录 UUID”的心智顺序：`packages/miniapp/pages/reimbursement/index.wxml`
- 状态芯片简化：报销页顶部不再展示 `PDF状态` 与 `批次`，仅保留提交人必需的进度信息（报销ID/识别号/状态/核验/附件数）：`packages/miniapp/pages/reimbursement/index.wxml`
- 上传入口统一：将“上传附件(图片/文件)”与“上传电子发票（自动识别）”收敛为单一按钮“上传文件（统一入口）”，按报销通道自动分流（电子通道走自动识别，实物通道弹出图片/文件选择）：`packages/miniapp/pages/reimbursement/index.{js,wxml}`
- 全局助手动作同步：浮动助手中的上传动作改为统一入口，避免多上传动作并列造成误判：`packages/miniapp/pages/reimbursement/index.js`

### 4.32 Miniapp 报销上传格式扩展（2026-03）
- 统一上传入口扩展支持范围：可上传 PDF、常见图片（JPG/JPEG/PNG/WEBP/GIF/BMP）及常见票据/扫描格式（TIFF/HEIC/HEIF/OFD/XML）：`packages/miniapp/pages/reimbursement/index.{js,wxml}`
- 电子发票通道上传细分为“图片自动识别”与“PDF/票据文件自动识别”，同一入口下按用户选择分流：`packages/miniapp/pages/reimbursement/index.js`
- 普通附件上传增加格式白名单拦截，超出范围时给出明确提示，减少无效上传重试：`packages/miniapp/pages/reimbursement/index.js`
- 小程序上传 MIME 识别扩展：补充 `tif/tiff/heic/heif/ofd/xml` 的 `content-type` 映射，保证上传签名与对象存储类型一致：`packages/miniapp/utils/upload.js`
- 真机兼容加固：文件选择器兼容 `wx.chooseMessageFile` 与 `wx.qy.chooseMessageFile`，并统一兼容 `path/tempFilePath/tempPath` 路径字段，避免真机文件路径差异导致上传失败：`packages/miniapp/utils/wx.js`、`packages/miniapp/pages/reimbursement/index.js`
- 上传命名兜底：当临时文件路径无扩展名（如 `wxfile://tmp_*`）时自动回退 `.bin`，并优先使用原文件名推断扩展名，避免签名文件名异常：`packages/miniapp/utils/upload.js`

### 4.33 报销后台静默审查流程重构（2026-03）
- 后端静默审查改为“按票据附件逐张识别”模式：提交或办公室手动触发后，为每张附件创建独立 OCR 任务并记录识别轮次（`review_round`），支持二次静默审查全链路重跑：`packages/api/src/routes/reimbursement.ts`、`packages/api/migrations/0037_phase27_reimbursement_invoice_review_pipeline.sql`
- 电子发票审查策略改为二维码优先：优先从二维码文本提取发票核心字段并持久化，重复比对新增 `invoice_no + invoice_date` 与 `qr_hash` 维度（保留风险分级与证据）：`packages/api/src/routes/reimbursement.ts`
- 实体票据审查策略强化为 OCR/Vision 冗余：识别结果不完整或失败时写入办公室可读风险提示，并在静默审查结果中输出人工复核建议：`packages/api/src/routes/reimbursement.ts`
- 多票据金额一致性审查：静默审查结果新增“票据识别合计 vs 申报金额”对比结论（含 delta 与 mismatch 标记），用于发现员工汇总误差：`packages/api/src/routes/reimbursement.ts`
- Web 办公室二次静默审查入口：报销列表与详情新增“二次静默审查”按钮（权限受办公室角色控制），触发全流程重跑并自动轮询刷新：`packages/web/src/views/finance/reimbursement/{list.vue,detail.vue}`、`packages/web/src/api/reimbursement.ts`
- 手动重跑幂等兜底：二次静默审查接口支持 `Idempotency-Key`，防止重复点击导致并发重跑污染：`packages/api/src/routes/reimbursement.ts`、`packages/web/src/api/reimbursement.ts`

### 4.34 报销识别结果可读化展示（2026-03）
- 办公室“后台静默审查提示”中的“识别原始结果”改为“识别结果（可读版）”，不再直接展示 JSON 原文：`packages/web/src/views/finance/reimbursement/detail.vue`
- 识别结果展示内容结构化为中文摘要：审查轮次、票据识别统计、逐票据明细（发票号/日期/金额/来源/风险）、金额核对结论（申报金额 vs 识别合计 vs 差额）：`packages/web/src/views/finance/reimbursement/detail.vue`

### 4.35 Workspace 个人报销进度卡片改版（2026-03）
- Web 个人工作台“我的报销进度”卡片移除“报销编号（envelope_no）”展示，改为“项目名称 + 金额”主标题：`packages/web/src/views/welcome/index.vue`
- 展示形态由时间线改为点状条目列表，仅保留“审核中/待处理”条目，并在条目中展示“申报日期”：`packages/web/src/views/welcome/index.vue`
- 报销条目状态口径修正：`submitted/received/batched/pending_approval` 统一归并为“审核中”，`unregistered/draft` 归并为“待处理”；进度条目过滤改为基于状态集合，避免状态标签变更导致误筛：`packages/web/src/views/welcome/index.vue`
- 报销进度条目主标题支持点击跳转到对应报销详情（`/workspace/my-reimbursement/detail/:id`）：`packages/web/src/views/welcome/index.vue`

### 4.36 小程序文件上传入口改为“本地文件优先”（2026-04）
- 报销页统一上传入口文案调整为“上传本地文件（统一入口）”，电子/实物通道动作项对应改为“上传本地PDF/票据文件（自动识别）”与“上传本地文件”，减少“会话文件”误解：`packages/miniapp/pages/reimbursement/index.{js,wxml}`
- 智能发单台（对外付款）三处附件按钮文案统一调整为“上传本地文件”，与业务诉求一致：`packages/miniapp/pages/payment-apply/index.wxml`
- 小程序文件选择封装新增本地文件选择能力 `wxChooseLocalFile`（优先 `wx.chooseFile` / `wx.miniapp.chooseFile`），并保留 `wxChooseMessageFile` 兼容实现用于会话文件场景：`packages/miniapp/utils/wx.js`
- 报销与智能发单台文件上传逻辑改为调用 `wxChooseLocalFile`，不再默认拉起会话文件选择器：`packages/miniapp/pages/reimbursement/index.js`、`packages/miniapp/pages/payment-apply/index.js`
- 客户端能力降级补偿：当本地文件选择能力不可用时，报销与智能发单台提供“从会话文件选择”兼容路径（需用户确认），避免上传流程硬失败：`packages/miniapp/pages/reimbursement/index.js`、`packages/miniapp/pages/payment-apply/index.js`、`packages/miniapp/utils/wx.js`

### 4.36 报销智能核查摘要防JSON泄露（2026-03）
- 报销详情“智能核查摘要”优先解析 `ai_reasonability_summary` 与 `ai_reasonability.summary`，并输出办公室可读文本，不再以 JSON 兜底回显：`packages/web/src/views/finance/reimbursement/detail.vue`
- 摘要格式统一为：风险等级、结论、主要异常（分级）与建议动作（列表），避免多附件场景下暴露结构化原始对象：`packages/web/src/views/finance/reimbursement/detail.vue`

## 5. 组件与模块指向
- 通用表格：`packages/web/src/components/Table/*`
- 高级筛选条：`packages/web/src/components/FilterBar/*`
- 审批轨迹：`packages/web/src/components/ApprovalTimeline/*`
- 审批流程设计器：`packages/web/src/components/ApprovalFlowDesigner/*`
- 金额展示：`packages/web/src/components/AmountDisplay/*`
- 风险卡片：`packages/web/src/components/RiskCard/*`

## 6. 交互与风控要求
- 危险动作必须二次确认。
- 审批动作必须填写意见。
- 金额输入必须实时格式化并展示金额大写。
- AI 建议与业务规则告警必须分开展示。

## 7. 验收清单（页面级）
- 每个页面都有对应路由、视图文件、接口指向。

## 8. 车辆油卡与公司实体增强（2026-03）

### 8.1 页面与路由映射
- 公司实体管理（增强版）：`/admin/system-base/entity` → `packages/web/src/views/entity/index.vue`
- 财务中心实体资料管理：`/finance/entity/profile` → `packages/web/src/views/entity/index.vue`
- 油卡额度申请（员工入口）：`/finance/fleet/application` → `packages/web/src/views/finance/fleet/application.vue`
- 油卡额度全量处理页：`/finance/fleet/applications-all` → `packages/web/src/views/finance/fleet/applications-list.vue`
- 车辆档案与办公室处理：`/finance/fleet/vehicles` → `packages/web/src/views/finance/fleet/vehicles.vue`
  - 车辆档案支持按状态筛选（全部/启用中/已停用），可查看停用车辆。
  - 车辆档案操作支持“编辑”与“启用/停用”双向切换；编辑弹窗支持修改车牌号、车型、归属、所属实体、权属人、状态。
- 车辆用油领导总览：`/finance/fleet/dashboard` → `packages/web/src/views/finance/fleet/dashboard.vue`
  - 该总览固定按全公司口径统计，不提供“公司实体”筛选控件，避免统计范围误解与空数据误判。

### 8.2 API 指向
- 公司实体增强：`/api/v1/entity`、`/api/v1/entity/:id/attachments`、`/api/v1/entity/:id/storage-summary`
- 车辆与油卡：`/api/v1/fleet/vehicles`、`/api/v1/fleet/fuel-cards`、`/api/v1/fleet/fuel-applications`
- 油卡绑定与余额变动记录：`/api/v1/fleet/fuel-cards`（含绑定用户聚合字段）、`/api/v1/fleet/fuel-cards/:id/balance-logs`
- 办公室处理申请：`/api/v1/fleet/fuel-applications/:id/process`
- 办公室待办数字汇总：`/api/v1/fleet/fuel-applications/pending-summary`
- 领导总览：`/api/v1/dashboard/vehicle-fuel-overview`
- 实体附件管理动作：上传/下载/删除（下载通过 `/api/v1/upload/object/:key`）

### 8.3 个人工作台员工闭环（2026-03）
- 个人工作台首页保留入口：智能发单台、油卡额度申请、我的申请，支持普通员工从工作台直接发起并查看：`packages/web/src/views/welcome/index.vue`
- 个人工作台首页布局收敛为“个人概览 + 关键数字 + 常用操作 + 待办/报销/证书内容区”，统一白底面板、8px 圆角与灰蓝文字体系，避免欢迎卡、待办卡、证书卡视觉风格割裂：`packages/web/src/views/welcome/index.vue`
- 个人工作台首页已移除“我的内部收款信息 / 添加外部收款人 / 我的收款卡”相关入口与卡片，避免员工首页出现收款信息展示逻辑混乱：`packages/web/src/views/welcome/index.vue`
- 个人工作台首页新增“油卡办公室待办”数字提醒入口（财务/经理/超管可见）：`packages/web/src/views/welcome/index.vue`
- 新增“我的申请”页面，聚合展示员工本人发起的对外付款申请、报销申请、油卡额度申请：`packages/web/src/views/workspace/my-applications/index.vue`
- “我的申请”新增“我发起的审批”标签页，可查看本人发起审批并直达审批详情：`packages/web/src/views/workspace/my-applications/index.vue`、`packages/web/src/api/approval.ts`
- “我的申请-油卡额度申请”新增处理结果展示（处理备注、处理时间、处理人、处理后余额）：`packages/web/src/views/workspace/my-applications/index.vue`
- 个人工作台路由新增：`/workspace/my-applications`：`packages/web/src/router/modules/workspace.ts`
- 个人工作台路由新增：`/workspace/payee`（外部收款人维护入口）：`packages/web/src/router/modules/workspace.ts`
- 对外付款列表接口新增 `mine/applicant_userid` 过滤，支持员工仅查看本人申请：`packages/api/src/routes/payment.ts`、`packages/web/src/api/payment.ts`

### 8.4 路由可见性规则收敛（2026-03）
- 系统底层与引擎：仅 `super_admin` 可见（含服务监控中心）：`packages/web/src/router/modules/admin.ts`
- 个人工作台：全部角色可见（`super_admin/manager/site_manager/finance/operator`）：`packages/web/src/router/modules/workspace.ts`
- 项目与现场指挥：至少项目经理可见（`super_admin/manager/site_manager`）：`packages/web/src/router/modules/field.ts`、`packages/web/src/router/modules/project.ts`
- 财务中心：仅 `super_admin/manager/finance` 可见：`packages/web/src/router/modules/finance.ts`
- 库房管理（库房与资产）：至少经理可见（`super_admin/manager/site_manager`）：`packages/web/src/router/modules/warehouse-assets.ts`、`packages/web/src/router/modules/asset.ts`
- 统一审批台：全部角色可见：`packages/web/src/router/modules/approval.ts`
- 为保持员工在个人工作台可完成油卡申请，新增工作台隐式路由 `/workspace/fuel-application`（不在菜单展示）：`packages/web/src/router/modules/workspace.ts`
- 为保持全角色可新增外部收款人，后端 `POST /api/v1/payment/payee` 放开 `operator` 角色创建 `type=external`，`type=internal` 仍限制财务/管理角色：`packages/api/src/routes/payment.ts`

### 8.5 企业微信成员权限可视化（2026-03）
- 企业微信集成页新增“每个成员权限状况”可视化：系统角色、角色识别来源、权限清单：`packages/web/src/views/wecom/member-admin.vue`
- 企业微信联系人接口返回成员权限状态增强字段：`system_role`、`role_source`、`permissions`、`permission_status`：`packages/api/src/routes/auth.ts`
- 页面顶部新增权限识别模式提示（企业微信标签增强成功/失败回退账号兜底）：`packages/web/src/views/wecom/member-admin.vue`
- 每个高风险操作都有确认与结果反馈。
- 桌面端与移动端关键动作路径均可完成。
- 样式 token 与状态语义一致，不出现颜色语义冲突。

### 8.6 Web 付款提交流程前端防重复提交（2026-03）
- 对外付款 API 增强可选 `Idempotency-Key` 请求头透传，覆盖“创建付款申请”“提交付款审批”两个高风险动作：`packages/web/src/api/payment.ts`
- 智能发单台在“直接付款”“合同流首笔预付款”场景新增前端幂等键复用（同一填写指纹重试复用同 key），防止网络抖动后重复点击造成多次创建/提审：`packages/web/src/views/finance/payment/wizard.vue`
- 付款详情页“新建保存”“确认提交审批”新增前端幂等键复用与提交中防重入 loading，避免短时重试产生重复单：`packages/web/src/views/finance/payment/detail.vue`

### 8.7 Miniapp 全局防重复提交防护（2026-03）
- 小程序请求层新增“写操作并发去重”机制：对 `POST/PUT/PATCH/DELETE` 按“方法+路径+业务载荷（或显式 dedupeKey）”合并并发请求，避免同一动作短时多次点击触发重复写入：`packages/miniapp/utils/request.js`
- 小程序写操作默认自动补 `Idempotency-Key` 请求头，保证网络抖动与 relay fallback 场景下具备服务端幂等能力（同时保持 GET 读请求不受影响）：`packages/miniapp/utils/request.js`
- 该策略覆盖资金流出、报销、审批、油卡、资产、库房等业务页所有通过 `request()` 发起的提交类动作：`packages/miniapp/pages/payment-apply/index.js`、`packages/miniapp/pages/reimbursement/index.js`、`packages/miniapp/pages/approval-detail/index.js`（及其他调用 `request` 的页面）

### 8.8 Miniapp 审批与申请-发起申请补齐“我发起的申请”（2026-03）
- 小程序“审批与申请”页在“发起申请”分段仅保留“我发起的申请”入口卡片，不再在该页内直接摊平审批列表：`packages/miniapp/pages/finance/index.{js,wxml,wxss}`
- 新增独立页面承载“我发起的申请”列表（审批视图，只读）：`packages/miniapp/pages/approval-initiated/index.{js,wxml,wxss,json}`，并在 `packages/miniapp/app.json` 注册路由 `pages/approval-initiated/index`
- 独立页面新增筛选能力：可按“流程类型 + 流程状态”过滤列表，默认状态筛选为“审批中（pending/in_progress）”：`packages/miniapp/pages/approval-initiated/index.{js,wxml,wxss}`
- 列表条目统一跳转审批详情页（`/pages/approval-detail/index`），不跳转具体业务页面，满足“看审批不看业务页”路径约束：`packages/miniapp/pages/approval-initiated/index.js`
- 审批详情页新增只读模式（`readonly=1`），只保留查看，不展示审批意见与底部操作按钮：`packages/miniapp/pages/approval-detail/index.js`、`packages/miniapp/pages/approval-detail/index.wxml`
- 审批详情页加载态/错误态解耦：慢网加载中仅显示“加载审批详情中”，仅在请求结束且失败后才显示“详情不存在或无权限”等兜底文案，避免首屏误判：`packages/miniapp/pages/approval-detail/index.{js,wxml}`

### 8.9 发起人流程监管（三分桶）补齐（2026-04）
- Web「我的申请-我发起的审批」改造为发起人监管视图：按“被退回（待处理）/审批中/已完成”三分桶查看，并展示每个分组数量与当前分组列表：`packages/web/src/views/workspace/my-applications/index.vue`
- Web 审批 API 封装新增发起人监管参数与汇总接口：`initiatedBucket` 参数、`GET /api/v1/approval/initiated/summary` 调用与类型：`packages/web/src/api/approval.ts`
- Miniapp「我发起的申请」页面改造为同口径三分桶监管，支持按流程类型进一步筛选，列表项保留只读跳转审批详情：`packages/miniapp/pages/approval-initiated/index.{js,wxml,wxss}`
- API 侧对发起人列表做增量兼容扩展：`GET /api/v1/approval` 新增可选 `initiatedBucket` 过滤与派生字段（`initiated_bucket`/`last_updated_at` 等），并新增 `GET /api/v1/approval/initiated/summary`：`packages/api/src/routes/approval.ts`

### 8.10 报销批次审批改为“合理性汇总 + 抽查附件”模式（2026-04）
- 审批台（Web）报销批次详情新增单项 AI 结论与抽查附件能力：每条报销单可直接预览/下载附件，并展示单项合理性结论与票据识别风险，方便审批人按单抽查：`packages/web/src/views/approval/detail.vue`
- 审批台（Miniapp）报销批次详情同步补齐单项审查信息：展示每条报销单的单项 AI 结论与附件列表，支持在审批详情页直接查看附件：`packages/miniapp/pages/approval-detail/index.{js,wxml}`
- 报销批次详情 API 增强为“审批抽查可用”结构：`GET /api/v1/reimbursement/batch/:id` 在 item 级返回附件列表、单项合理性摘要、票据识别风险提示，供 Web/Miniapp 审批台统一消费：`packages/api/src/routes/reimbursement.ts`
- AI Gate 语义调整为“批次阶段以单项结论汇总与合理性判断为主，不再把缺少可读附件正文作为单独拒绝条件”；并为线上模板提供同步 SQL：`packages/api/src/routes/admin.ts`、`packages/api/scripts/sql/update-approval-ai-gate-prompt.sql`
- 审批 AI 载荷补齐报销批次单项审查上下文（`reimbursement_item_reviews`），使模型在批次阶段可直接基于单项历史结论输出汇总意见：`packages/api/src/services/ai-slot.ts`

### 8.11 报销列表风险可视化与办公室 UUID 纠偏（2026-04）
- 报销列表页移除 PDF 列，新增“通道类型”列（实物信封/电子发票），并把异常提示改为标签化展示（重复票据风险、收件核对异常、待补充材料、复核驳回）：`packages/web/src/views/finance/reimbursement/list.vue`
- 报销列表高风险行增加行级高亮（浅红底），便于办公室人员快速锁定需优先核查条目：`packages/web/src/views/finance/reimbursement/list.vue`
- 列表接口增强重复风险摘要字段，支持前端直接渲染风险标签：`duplicate_count` 与 `duplicate_risk_level`：`packages/api/src/routes/reimbursement.ts`、`packages/web/src/api/reimbursement.ts`
- 报销详情新增办公室“换绑UUID”入口（仅实物信封），允许对错误 UUID 进行人工纠偏并保留审计理由：`packages/web/src/views/finance/reimbursement/detail.vue`
- 新增后端办公室换绑接口 `POST /api/v1/reimbursement/:id/rebind-uuid`，并对通道稳定性加约束（创建绑定与更新流程均禁止跨通道漂移），避免实物信封被误改成电子发票：`packages/api/src/routes/reimbursement.ts`、`packages/api/src/routes/reimbursement-create-policy.ts`

### 8.12 报销集中审批“被报销人+支付方案”联动补齐（2026-04）
- 审批中心列表（Web）在待审批/已处理/抄送三栏新增“被报销人”列，报销批次场景优先展示 `biz_applicant_userid`，用于替代仅看发起人的歧义：`packages/web/src/views/approval/index.vue`、`packages/web/src/api/approval.ts`、`packages/api/src/routes/approval.ts`
- 审批详情（Web）报销批次明细将“申请人”文案统一为“被报销人”，并新增“支付方式/付款账户/审批状态/审批节点”展示：`packages/web/src/views/approval/detail.vue`、`packages/web/src/api/reimbursement.ts`
- 审批详情（Web）操作区扩展为“审批台支付方案”（支付方式 + 付款主体 + 付款账户），审批人可在审批前保存支付方案；报销批次走 `PUT /api/v1/reimbursement/batch/:id/payout-plan`，对外付款保持原路径：`packages/web/src/views/approval/detail.vue`、`packages/web/src/api/reimbursement.ts`、`packages/api/src/routes/reimbursement.ts`
- 报销批次列表/详情（Web）补齐“被报销人/收款方式”展示，并在批次详情绑定并显示审批实例状态与当前节点信息：`packages/web/src/views/finance/reimbursement/batch.vue`、`packages/web/src/views/finance/reimbursement/batch-detail.vue`、`packages/web/src/api/reimbursement.ts`
- 报销批次创建与送审（Web）支持同步传入收款方式，避免创建后再补录导致信息割裂：`packages/web/src/views/finance/reimbursement/batch.vue`、`packages/web/src/api/reimbursement.ts`
- 小程序审批列表新增“被报销人”展示；审批详情在报销批次场景新增支付方式/付款账户展示与审批人可编辑支付方案（同样走批次 payout-plan 接口）：`packages/miniapp/pages/approval/index.{js,wxml}`、`packages/miniapp/pages/approval-detail/index.{js,wxml}`、`packages/api/src/routes/reimbursement.ts`

### 8.13 报销批次详情“超管二次编辑 + 全量信息展示”补齐（2026-04）
- 报销批次详情页新增“超级管理员二次编辑”区域，允许超管在批次详情直接二次调整付款方式、被报销人收款账户、付款实体、付款账户及展示文本（调用 `PUT /api/v1/reimbursement/batch/:id/payout-plan`）：`packages/web/src/views/finance/reimbursement/batch-detail.vue`、`packages/web/src/api/reimbursement.ts`
- 报销批次详情页基础信息扩展为“全量业务视图”：批次状态、项目/被报销人、付款方式、付款账户、出款实体、出款银行账户、支付流水号、打款日期、创建/更新时间、审批实例状态/当前节点：`packages/web/src/views/finance/reimbursement/batch-detail.vue`
- 报销批次详情页布局收敛为“顶部摘要 + 关键动作 + 基础/收付款信息 + 折叠维护区 + 信封明细”，将超管编辑、支付凭证、查重/AI 报告默认收纳在折叠区，降低首屏复杂度：`packages/web/src/views/finance/reimbursement/batch-detail.vue`
- 报销批次详情页新增支付凭证区（读取并展示 `payment_vouchers`），支持直接预览/下载凭证文件：`packages/web/src/views/finance/reimbursement/batch-detail.vue`
- 报销批次详情接口补齐聚合字段，返回 `payment_entity`、`payment_bank_account`、`payment_vouchers`，减少前端二次拼接成本并保证详情一致性：`packages/api/src/routes/reimbursement.ts`、`packages/web/src/api/reimbursement.ts`

### 8.14 报销提交状态筛选多选与报错修复（2026-04）
- 报销提交列表（财务中心）状态筛选改为多选控件，支持一次筛选多个状态并折叠标签展示：`packages/web/src/views/finance/reimbursement/list.vue`
- 工作台“我的报销提交”状态筛选同步改为多选，保持 Web 两个入口口径一致：`packages/web/src/views/workspace/reimbursement/list.vue`
- 报销列表接口参数 `status` 扩展为可传逗号拼接状态集合，后端按 `status IN (...)` 执行过滤，兼容单状态与多状态筛选：`packages/web/src/api/reimbursement.ts`、`packages/api/src/routes/reimbursement.ts`

### 8.15 报销集中审批中心候选清单收敛 + 批次详情可维护增强（2026-04）
- 报销集中审批中心新增候选查询接口 `GET /api/v1/reimbursement/batch/candidates`，候选仅保留“可直接送审”条目（已收件 + 复核通过 + 未入批次），从源头消除不合格条目与重复批次风险：`packages/api/src/routes/reimbursement.ts`、`packages/web/src/api/reimbursement.ts`、`packages/web/src/views/finance/reimbursement/batch.vue`
- 报销集中审批中心页面布局收敛为“顶部摘要 + 创建批次面板 + 候选清单 + 批次 Tab”，付款实体/付款账户移动到“可选付款信息”折叠区，进行中与历史完成批次合并为 Tab，减少首屏复杂度：`packages/web/src/views/finance/reimbursement/batch.vue`
- 创建并送审动作新增二次确认弹窗，展示送审条目数、总金额、付款方式、被报销人收款账户、付款实体与付款账户；送审仅强制付款方式，付款实体/付款账户/账户显示允许为空并由审批人员在审批详情页补充：`packages/web/src/views/finance/reimbursement/batch.vue`、`packages/api/src/routes/reimbursement.ts`
- 报销批次付款方式新增“转账”（独立于“对公转账”），覆盖创建并送审、审批详情支付方案、批次详情超管二次编辑：`packages/api/src/routes/reimbursement.ts`、`packages/web/src/views/finance/reimbursement/batch.vue`、`packages/web/src/views/approval/detail.vue`、`packages/web/src/views/finance/reimbursement/batch-detail.vue`
- 批次详情新增“支付凭证上传与保存”能力，可在详情页直接上传/移除并持久化支付凭证：`PUT /api/v1/reimbursement/batch/:id/payment-vouchers`，页面文件：`packages/web/src/views/finance/reimbursement/batch-detail.vue`

### 8.16 报销提交与详情页面信息架构收敛（2026-04）
- 报销提交/处理列表页面改为“顶部标题与角色动作 + 摘要指标 + 筛选面板 + 表格区”，角色说明从多条提示条收敛到页面副标题，降低报销提交入口的首屏复杂度：`packages/web/src/views/finance/reimbursement/list.vue`
- 报销详情页面新增顶部状态摘要，并将后台静默审查与重复风险合并收纳到折叠区；基础信息、附件和操作区保持原业务位置，减少详情页一次性展开的信息量：`packages/web/src/views/finance/reimbursement/detail.vue`
- 批次详情新增“报销基础信息编辑”能力（发票号、费用日期、金额、类别、说明），支持对批次内单条报销做修正并自动回写批次合计：`PUT /api/v1/reimbursement/batch/:id/items/:envelopeId/basic-info`，页面文件：`packages/web/src/views/finance/reimbursement/batch-detail.vue`
