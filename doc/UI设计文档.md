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
- 仪表盘：`packages/web/src/views/dashboard/index.vue`
- 实体管理：`packages/web/src/views/entity/index.vue`
- 数据字典管理：`packages/web/src/views/dict/index.vue`
- 项目列表：`packages/web/src/views/project/list.vue`
- 项目立项：`packages/web/src/views/project/create.vue`
- 项目详情：`packages/web/src/views/project/detail.vue`
- 企业微信通讯录：`packages/web/src/views/wecom/contacts.vue`
- 合同管理列表：`packages/web/src/views/finance/contract/index.vue`
- 合同详情/创建：`packages/web/src/views/finance/contract/detail.vue`
- 对外付款申请列表：`packages/web/src/views/finance/payment/index.vue`
- 对外付款申请详情：`packages/web/src/views/finance/payment/detail.vue`
- 收款人管理：`packages/web/src/views/finance/payee/index.vue`
- 报销信封列表：`packages/web/src/views/finance/reimbursement/list.vue`
- 报销信封详情：`packages/web/src/views/finance/reimbursement/detail.vue`
- 报销预审工作台：`packages/web/src/views/finance/reimbursement/precheck.vue`
- 报销查重中心：`packages/web/src/views/finance/reimbursement/duplicate.vue`
- 报销集中审批批次列表：`packages/web/src/views/finance/reimbursement/batch.vue`
- 报销集中审批批次详情：`packages/web/src/views/finance/reimbursement/batch-detail.vue`
- 收款合同管理：`packages/web/src/views/finance/receipt/contract.vue`
- 发票管理：`packages/web/src/views/finance/receipt/invoice.vue`
- 收款登记列表：`packages/web/src/views/finance/receipt/list.vue`
- 收款统计仪表盘：`packages/web/src/views/finance/receipt/dashboard.vue`
- 审批中心：`packages/web/src/views/approval/index.vue`
- 审批详情：`packages/web/src/views/approval/detail.vue`
- 审批模板配置：`packages/web/src/views/approval/template-config.vue`
- 金额阈值配置：`packages/web/src/views/approval/threshold-config.vue`
- AI配置管理：`packages/web/src/views/ai/config.vue`
- 计算节点监控：`packages/web/src/views/ai/nodes.vue`
- 资产台账：`packages/web/src/views/asset/list.vue`
- 资产详情：`packages/web/src/views/asset/detail.vue`
- 设备总览：`packages/web/src/views/asset/dashboard.vue`
- 仓库管理：`packages/web/src/views/warehouse/index.vue`
- 仓库库存：`packages/web/src/views/warehouse/inventory.vue`
- 库存预警中心：`packages/web/src/views/warehouse/alert.vue`
- 出入库单管理：`packages/web/src/views/warehouse/stock-order.vue`
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
- 表格列：申请单号、合同号、金额、申请人、状态、提交时间。
- 强约束：超额风险标红并显示剩余额度。
- API 指向：`/api/v1/payment`

#### G. 对外付款申请详情 `views/finance/payment/detail.vue`
- 左侧：申请信息、合同信息、附件。
- 右侧：审批轨迹、风险评估报告。
- 底部动作：通过/拒绝/退回/转签（必须填写意见）。
- API 指向：`/api/v1/payment/:id`, `/api/v1/approval/:id/*`

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

## 4. 小程序页面级规范（企业微信）

### 4.1 页面总索引
- 工作台首页：`packages/miniapp/pages/index/index`
- 日志填报：`packages/miniapp/pages/log/index`
- 审批待办：`packages/miniapp/pages/approval/index`
- 报销扫码：`packages/miniapp/pages/reimbursement/index`
- 设备扫码：`packages/miniapp/pages/asset/index`

### 4.2 页面要求
- 首页：展示待办数量、快捷入口、系统通知。
- 日志页：支持班次、参数、照片上传与草稿保存。
- 审批页：移动端单手可完成通过/拒绝/退回。
- 报销页：支持二维码识别、发票上传、状态追踪。
- 设备页：支持扫码识别资产与出入库确认。

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
