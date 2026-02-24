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
- 仪表盘：`packages/web/src/views/dashboard/index.vue`
- 实体管理：`packages/web/src/views/entity/index.vue`
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
- 报销信封列表：`packages/web/src/views/finance/reimbursement/list.vue`
- 报销信封详情：`packages/web/src/views/finance/reimbursement/detail.vue`
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
- 审批详情：`packages/web/src/views/approval/detail.vue`
- 审批模板配置：`packages/web/src/views/approval/template-config.vue`
- 金额阈值配置：`packages/web/src/views/approval/threshold-config.vue`
- AI配置管理：`packages/web/src/views/ai/config.vue`
- 计算节点监控：`packages/web/src/views/ai/nodes.vue`
- 资产台账：`packages/web/src/views/asset/list.vue`
- 资产运维看板：`packages/web/src/views/asset/ledger.vue`
- 资产详情：`packages/web/src/views/asset/detail.vue`
- 设备总览：`packages/web/src/views/asset/dashboard.vue`
- 仓库管理：`packages/web/src/views/warehouse/index.vue`
- 仓库库存：`packages/web/src/views/warehouse/inventory.vue`
- 库存预警中心：`packages/web/src/views/warehouse/alert.vue`
- 出入库单管理：`packages/web/src/views/warehouse/stock-order.vue`
- 出入库调度看板：`packages/web/src/views/warehouse/dispatch.vue`
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
- 表格列：申请单号、合同号、金额、申请人、状态、提交时间、支付时间。
- 强约束：超额风险标红并显示剩余额度。
- API 指向：`/api/v1/payment`

#### G. 对外付款申请详情 `views/finance/payment/detail.vue`
- 左侧：申请信息、合同信息、附件。
- 右侧：审批轨迹、风险评估报告。
- 付款执行：`已审批`状态下登记支付日期、支付流水号、付款账户、付款备注并标记付款。
- 底部动作：通过/拒绝/退回/转签（必须填写意见）、标记付款。
- API 指向：`/api/v1/payment/:id`, `/api/v1/payment/:id/mark-paid`, `/api/v1/approval/:id/*`

#### H. 收款人管理 `views/finance/payee/index.vue`
- 双标签页：外部收款人/内部收款人。
- 表格列：名称、开户行、账号、电话、创建时间。
- 操作：新增、编辑、软删除。
- API 指向：`/api/v1/payment/payee/*`

#### F. 报销信封列表 `views/finance/reimbursement/list.vue`
- 展示维度：信封编号、UUID、项目、填报人、金额、状态、PDF状态。
- 支持入口：批量生成信封、进入信封详情执行扫码填报/收件核对/PDF生成。
- API 指向：`/api/v1/reimbursement`

#### F-2. 报销信封详情 `views/finance/reimbursement/detail.vue`
- 表单区：项目、填报人、通道、发票号、费用日期、金额、类别、说明、附件JSON。
- 操作区：保存、扫码填报（模拟）、收件通过/异常、触发PDF生成、刷新PDF状态、刷新OCR状态、触发异常检测、预审动作。
- API 指向：`/api/v1/reimbursement/:id`, `/api/v1/reimbursement/scan`, `/api/v1/reimbursement/verify`, `/api/v1/reimbursement/:id/generate-pdf`, `/api/v1/reimbursement/:id/ocr-status`, `/api/v1/reimbursement/:id/trigger-anomaly-check`, `/api/v1/reimbursement/:id/precheck`

#### F-3. 报销预审工作台 `views/finance/reimbursement/precheck.vue`
- 展示维度：信封编号、项目、填报人、金额、查重线索、预审状态。
- 操作区：触发异常检测、预审通过/补充/驳回、跳转信封详情。
- API 指向：`/api/v1/reimbursement/precheck/pending`, `/api/v1/reimbursement/:id/trigger-anomaly-check`, `/api/v1/reimbursement/:id/precheck`

#### F-4. 报销查重中心 `views/finance/reimbursement/duplicate.vue`
- 展示维度：信封编号、匹配类型、风险等级、匹配发票号、金额、说明。
- 支持按风险等级筛选并跳转到对应信封详情。
- API 指向：`/api/v1/reimbursement/duplicate-center`

#### F-5. 报销集中审批批次列表 `views/finance/reimbursement/batch.vue`
- 展示维度：批次号、项目、申报人、信封数、总金额、AI审计状态、审批状态。
- 操作区：新建审批批次（可自动按项目+申报人汇总或手动指定信封ID）、进入批次详情。
- API 指向：`/api/v1/reimbursement/batch`

#### F-6. 报销集中审批批次详情 `views/finance/reimbursement/batch-detail.vue`
- 展示维度：批次信息、AI审计报告、批次信封明细、查重风险汇总。
- 操作区：触发AI审计、提交集中审批、标记批次付款、跳转审批详情。
- API 指向：`/api/v1/reimbursement/batch/:id`, `/api/v1/reimbursement/batch/:id/trigger-audit`, `/api/v1/reimbursement/batch/:id/audit-report`, `/api/v1/reimbursement/batch/:id/submit-approval`, `/api/v1/reimbursement/batch/:id/mark-paid`

#### G. 收款合同管理 `views/finance/receipt/contract.vue`
- 核心列：合同号、项目、对方单位、合同总额、已开票、已收款、状态。
- 操作：新建收款合同（direction=inbound）、查看合同详情并提交审批。
- API 指向：`/api/v1/contract?direction=inbound`, `/api/v1/contract/:id/submit-approval`

#### G-2. 发票管理 `views/finance/receipt/invoice.vue`
- 核心列：发票单号、合同号、发票抬头、税号、开票日期、金额、状态。
- 操作：签发发票、删除发票。
- 校验：已开票总额 + 本次开票 ≤ 合同总额（后端强校验）。
- API 指向：`/api/v1/receipt/invoice`

#### G-3. 收款登记列表 `views/finance/receipt/list.vue`
- 核心列：收款单号、合同号、关联发票号、收款日期、金额、收款账户、登记人、状态。
- 操作：新增收款登记、删除登记。
- 校验：合同收款总额与发票收款总额上限联动（后端强校验）。
- API 指向：`/api/v1/receipt`

#### G-4. 收款统计仪表盘 `views/finance/receipt/dashboard.vue`
- 指标：收款合同已开票、收款合同已到账、收款登记笔数、对外付款已支付、报销累计。
- 支持按项目切换统计。
- API 指向：`/api/v1/project/:id/financial-summary`

#### H. 审批中心 `views/approval/index.vue`
- Tab：待审批、已处理、抄送我。
- 列表列：业务类型、发起人、当前节点、超时状态。
- API 指向：`/api/v1/approval/pending`

#### I. 审批详情 `views/approval/detail.vue`
- 上区：业务摘要（单据关键字段）。
- 中区：流程图 + 历史操作。
- 下区：动作区（通过/拒绝/退回/转签/撤回）。
- API 指向：`/api/v1/approval/:id/*`

#### I-2. 审批模板配置 `views/approval/template-config.vue`
- 模板列表表格：模板编码、名称、业务类型、状态、操作（编辑/预览/删除）。
- 创建/编辑弹窗：基本信息 + ApprovalFlowDesigner 可视化编辑器。
- 预览弹窗：只读模式 ApprovalFlowDesigner。
- API 指向：`/api/v1/admin/approval-config`

#### I-3. 金额阈值配置 `views/approval/threshold-config.vue`
- 顶部模板选择器。
- 阈值表格：条件字段、运算符、阈值、目标分支、优先级。
- 创建/编辑弹窗：between运算符时显示双值输入。
- API 指向：`/api/v1/admin/threshold`

#### I-4. AI配置管理 `views/ai/config.vue`
- 3标签页：AI供应商 / 路由规则 / 提示词模板。
- 供应商Tab：CRUD表格（key、名称、endpoint、模型、优先级、并发）。
- 路由规则Tab：CRUD表格（规则名、业务类型、任务类型、供应商、优先级）。
- 提示词Tab：CRUD表格（key、名称、版本）+ 编辑弹窗含system/user prompt大文本区。
- API 指向：`/api/v1/admin/ai-provider`, `/api/v1/admin/ai-routing`, `/api/v1/admin/ai-prompt`

#### I-5. 计算节点监控 `views/ai/nodes.vue`
- 节点列表卡片：节点ID、名称、类型、状态（颜色标签）、能力、CPU/内存、最后心跳（相对时间）。
- 30秒自动刷新。
- 任务队列卡片：筛选（状态/任务类型）+ 表格 + 分页。
- API 指向：`/api/v1/task/nodes`, `/api/v1/task/queue`

#### J. 资产台账 `views/asset/list.vue`
- 列：资产码、类型、状态、所在项目、责任人、更新时间。
- 支持：按资产类型动态展示属性字段。
- API 指向：`/api/v1/asset`

#### K. 仓库管理 `views/warehouse/index.vue`
- 模块：仓库档案列表、关键字检索、新增/编辑弹窗。
- 交互：软删除，状态维护（active/inactive）。
- API 指向：`/api/v1/warehouse`

#### K-2. 仓库库存 `views/warehouse/inventory.vue`
- 模块：库存总览、筛选、耗材消耗登记。
- 交互：按仓库/资产类型过滤，登记消耗后刷新库存。
- API 指向：`/api/v1/warehouse/inventory`, `/api/v1/warehouse/consumption`

#### K-3. 库存预警中心 `views/warehouse/alert.vue`
- 模块：低库存清单、缺口展示、AI分析触发。
- 交互：预警项支持一键触发 `inventory_alert_analysis`。
- API 指向：`/api/v1/warehouse/inventory/alert`, `/api/v1/warehouse/inventory/alert/:id/analyze`

#### K-4. 出入库单管理 `views/warehouse/stock-order.vue`
- 模块：出入库单列表、创建表单、审批提交与执行。
- 交互：草稿单可提交审批；审批通过后可执行；草稿/待审可取消。
- API 指向：`/api/v1/warehouse/stock-order`, `/api/v1/warehouse/stock-order/:id/submit-approval`, `/api/v1/warehouse/stock-order/:id/execute`

#### K-5. 项目设备规划 `views/warehouse/equipment-plan.vue`
- 模块：设备规划列表、新建规划、AI推荐触发、推荐结果查看、确认生成出库单。
- 交互：确认时自动生成出库单并回写规划单。
- API 指向：`/api/v1/warehouse/equipment-plan`, `/api/v1/warehouse/equipment-plan/:id/trigger-recommend`, `/api/v1/warehouse/equipment-plan/:id/recommendation`, `/api/v1/warehouse/equipment-plan/:id/confirm`

#### K-6. 设备总览 `views/asset/dashboard.vue`
- 模块：按类型/状态/位置三维统计。
- API 指向：`/api/v1/asset/dashboard/overview`

#### K-7. 项目设备视图 `views/project/equipment-view.vue`
- 模块：项目设备清单、项目维度物资消耗汇总。
- API 指向：`/api/v1/asset/dashboard/project/:projectId`

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
- 标段详情弹窗：在项目面板“标段总览”点击“查看详情”进入，显示标段基础信息、该标段操作员日志、该标段贯通报告。
- 项目日志聚合区：同页集中展示该项目全部操作员日志、管理员日志、贯通报告，保证参与人员无需跨模块即可获取项目全貌。
- 贯通报告标段绑定：贯通报告按 `section_id` 归集，在项目层与标段层均可追溯。
- 对应 API：`/api/v1/project/:id/files`、`/api/v1/project/:id/files/:fileId`、`/api/v1/log/operator?project_id=:id&section_id=:sectionId`、`/api/v1/survey/breakthrough?project_id=:id&section_id=:sectionId`。

### 3.5 Sprint 1 重构落地点（2026-02）
- 默认首页路由切换到个人工作台：`packages/web/src/router/modules/home.ts`（`/` -> `/workspace/home`，保留 `/welcome` 兼容重定向）。
- 个人工作台页面：`packages/web/src/views/welcome/index.vue`（欢迎卡、快捷入口、收款卡区、报销时间线、证书网格与到期预警）。
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
- 出入库制单台重构为“左检索 + 右购物车”模式：`packages/web/src/views/warehouse/stock-order.vue`。
- 双向对冲调度看板补齐签收核验对话框：`packages/web/src/views/warehouse/dispatch.vue`，签收前必须完成设备状态复核与实际送达数量确认。
- 项目工作区详情交互改为抽屉优先：
  - `packages/web/src/views/project/workspace/project-panel.vue`：标段详情由 `Dialog` 改为 `Drawer`；文件详情新增右侧抽屉。
  - `packages/web/src/views/project/workspace/equipment-panel.vue`：设备行新增详情入口并使用右侧抽屉承载详情。

### 3.7 Sprint 3 重构落地点（2026-02）
- 财务中心菜单恢复并命名对齐：`packages/web/src/router/modules/finance.ts`（顶层标题“财务中心”）。
- 合同执行监控高密度改造：`packages/web/src/views/finance/contract/monitor.vue`
  - 表格切换为紧凑模式（`size=small`）
  - 打款进度增加风险等级标签（正常/阈值预警/超高风险）
  - 阈值色带与金额变更抽屉保留
- 智能发单台关系输入收敛：`packages/web/src/views/finance/payment/wizard.vue`
  - 超阈值合同流中“对方单位”改为 `el-select`（来源收款人）
  - 付款金额、实体 ID 保持 `el-input-number` 数值控件
- 报销集中打款流程抽屉化：`packages/web/src/views/finance/reimbursement/payout.vue`
  - 登记打款从 `Dialog` 改为 `Drawer`
  - 新增批量选择金额汇总展示（批次数 + 合计金额）
- 财务快照看板图表化：`packages/web/src/views/finance/receipt/dashboard.vue`
  - 新增 ECharts 柱状图（应收已开票/应收已到账/对外付款/报销总额）
  - 保留 KPI 卡片与项目筛选，形成“卡片 + 图表”双层快照

### 3.8 Sprint 4 重构落地点（2026-02）
- 超管统一入口：`packages/web/src/router/modules/admin.ts`
  - 汇聚审批流程设计、阈值规则、AI/Runner、系统底座、企微集成、Raw Ops、Helpdesk
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

## 4. 小程序页面级规范（企业微信）

### 4.0 设计基准与参考
- 企业微信样式规范参考：`https://developer.work.weixin.qq.com/document/path/90305`
- TDesign 小程序组件库参考：`https://tdesign.tencent.com/miniprogram/`
- 设计目标：在企业微信容器内保持原生一致性（轻量、清晰、可读），同时通过 TDesign 提升组件一致性与交互反馈质量。
- 落地策略：业务结构保持现有 Phase 10 信息架构，仅重塑视觉层与交互层，不改变后端接口契约。

### 4.1 页面总索引
- 工作台（Tab1）：`packages/miniapp/pages/index/index`
- 现场（Tab2）：`packages/miniapp/pages/warehouse/index`
- 审批与申请（Tab3）：`packages/miniapp/pages/finance/index`
- 我的（Tab4）：`packages/miniapp/pages/profile/index`
- 日志中心：`packages/miniapp/pages/log/index`
- 操作员日志：`packages/miniapp/pages/operator-log/index`
- 管理员日志：`packages/miniapp/pages/manager-log/index`
- 审批待办：`packages/miniapp/pages/approval/index`
- 报销扫码：`packages/miniapp/pages/reimbursement/index`
- 设备扫码：`packages/miniapp/pages/asset/index`
- 现场勘查：`packages/miniapp/pages/survey/index`
- 项目进度概览：`packages/miniapp/pages/progress/index`
- 通知消息：`packages/miniapp/pages/notice/index`

### 4.2 页面要求
- 工作台Tab：首页展示红黄绿 KPI、九宫格高频入口、项目筛选与清单，并支持角色化“创建项目”入口。
- 现场Tab：展示项目进度环/顶段进度条，并聚合双轨日志、设备查验、安全勘查入口。
- 审批与申请Tab：通过分段器组织“待我审批/发起申请”，并提供快速审批与发单入口。
- 我的Tab：放置个人申请时间线、证书预警、联调配置、会话管理。
- 日志中心：仅负责日志角色入口分流（操作员/管理员）。
- 操作员日志页：支持 AI 预填 + 提交，班次使用中文选择（白班/夜班），内部存储保持 day/night。
- 管理员日志页：支持拍照上传 + 结构化提交。
- 审批页：移动端单手可完成通过/拒绝/退回/转签，危险动作前需确认弹窗。
- 报销页：支持二维码识别、电子发票拍照上传(OCR)、PDF 生成状态追踪。
- 设备页：支持扫码识别资产、状态查看与出入库事件确认。
- 勘查页：支持 GPS 定位、拍照上传、表单提交。
- 进度页：支持项目日志指标与预警列表查看。
- 个人中心：支持查看用户信息、API 地址配置（开发联调）与退出登录确认。
- 通用交互：所有异步提交场景需有 loading、按钮禁用、空态提示与字段校验反馈。
- 低操作成本原则：
  - 项目选择统一使用下拉选择组件（`hy-project-picker`），避免手输项目ID。
  - 支持“定位匹配项目”快捷动作；若项目未配置坐标，则保留手动选择。
  - 日期统一使用 `picker mode=date`，避免手输日期格式。
  - 班次统一使用中文选项（白班/夜班），内部存储使用英文值（day/night）。

### 4.2.1 Miniapp UI 重构落地点（2026-02）
- 全局视觉系统：`packages/miniapp/app.wxss`
  - 补齐红黄绿语义色、放大触控区、统一 KPI 卡片样式。
  - 新增全局悬浮语音助手 FAB 样式（呼吸动画）。
- 4 Tabs 信息架构（文案与顺序）：`packages/miniapp/app.json`
  - `工作台`、`现场`、`流程`、`我的`。
- 工作台首页重构：`packages/miniapp/pages/index/index.{js,wxml,wxss}`
  - 欢迎区 + 红黄绿 KPI + 大入口网格 + 项目清单 + 全局语音助手。
- 现场页重构：`packages/miniapp/pages/warehouse/index.{js,wxml,wxss}`
  - 项目定位提示、顶段进度卡、现场动作入口聚合。
- 审批与申请页重构：`packages/miniapp/pages/finance/index.{js,wxml,wxss}`
  - 待办/发起分段器 + 快捷动作入口 + 全局语音助手。
- 我的页重构：`packages/miniapp/pages/profile/index.{js,wxml,wxss}`
  - 个人申请时间线、证书预警卡、联调配置区。
- 核心业务页视觉强化：
  - 审批：`packages/miniapp/pages/approval/index.{js,wxml,wxss}`（红黄绿摘要 + 长按后滑动解锁通过）
  - 报销：`packages/miniapp/pages/reimbursement/index.{js,wxml}`（扫码/OCR/PDF 三段链路与语音助手）
  - 对外付款：`packages/miniapp/pages/payment-apply/index.{js,wxml,json}`（付款草稿创建 + 提交审批）
  - 施工日志：`packages/miniapp/pages/{log,operator-log,manager-log}/index.{js,wxml,wxss}`（双轨入口与语音提示）
  - 设备/勘查：`packages/miniapp/pages/{asset,survey}/index.{js,wxml}`（图标化状态与风险提示）
- 交互反馈工具：`packages/miniapp/utils/interaction.js`
  - 封装短震/长震与统一 toast，供审批/报销/勘查等关键流程复用。
- 权限一致性补齐：
  - `packages/miniapp/pages/finance/index.{js,wxml}`：按角色显示“对外付款”入口
  - `packages/miniapp/pages/reimbursement/index.{js,wxml}`：按角色控制 PDF 生成入口
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
- 项目详情（新增）：`packages/miniapp/pages/project-detail/index`
- 项目模块配置：`packages/miniapp/app.json`
- 项目接口封装：`packages/miniapp/utils/request.js`

#### 4.4.2 角色行为边界
- 参与者（项目成员）：可见详情中的协同动作入口（按后端权限返回）。
- 非参与者：允许浏览全部项目列表与详情，但详情必须是只读模式。
- 非参与者禁止项：提交审批、提交财务类动作、库存/出入库写操作、配置型操作。
- 任何写操作均以服务端鉴权为最终裁决；前端只读态仅用于降低误触。

#### 4.4.3 范围锁定（本期禁止变更）
- 财务模块入口与行为保持不变：`packages/miniapp/pages/finance/index`
- 库房模块入口与行为保持不变：`packages/miniapp/pages/warehouse/index`
- 本期允许调整仅限项目模块的信息架构、页面跳转与只读提示层。

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
- 每个高风险操作都有确认与结果反馈。
- 桌面端与移动端关键动作路径均可完成。
- 样式 token 与状态语义一致，不出现颜色语义冲突。
