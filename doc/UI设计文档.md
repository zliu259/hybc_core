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
- 项目列表：`packages/web/src/views/project/list.vue`
- 项目详情：`packages/web/src/views/project/detail.vue`
- 对外付款申请列表：`packages/web/src/views/finance/payment/list.vue`
- 对外付款申请详情：`packages/web/src/views/finance/payment/detail.vue`
- 报销批次列表：`packages/web/src/views/finance/reimbursement/list.vue`
- 收款登记列表：`packages/web/src/views/finance/receipt/list.vue`
- 审批中心：`packages/web/src/views/approval/index.vue`
- 审批详情：`packages/web/src/views/approval/detail.vue`
- 资产台账：`packages/web/src/views/asset/list.vue`
- 仓库库存：`packages/web/src/views/warehouse/index.vue`
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

#### D. 对外付款申请列表 `views/finance/payment/list.vue`
- 固定筛选：合同号、项目、审批状态、金额区间。
- 表格列：申请单号、合同号、金额、申请人、状态、提交时间。
- 强约束：超额风险标红并显示剩余额度。
- API 指向：`/api/v1/payment`

#### E. 对外付款申请详情 `views/finance/payment/detail.vue`
- 左侧：申请信息、合同信息、附件。
- 右侧：审批轨迹、风险评估报告。
- 底部动作：通过/拒绝/退回/转签（必须填写意见）。
- API 指向：`/api/v1/payment/:id`, `/api/v1/approval/:id/*`

#### F. 报销批次列表 `views/finance/reimbursement/list.vue`
- 展示维度：批次、申报人、总额、异常数量、审批状态。
- 支持入口：查看查重结果、查看 AI 审计报告。
- API 指向：`/api/v1/reimbursement`

#### G. 收款登记列表 `views/finance/receipt/list.vue`
- 核心列：收款编号、工程、收款账户、金额、收款日期。
- 校验提示：合同金额与已开票金额联动提醒。
- API 指向：`/api/v1/receipt`, `/api/v1/invoice`

#### H. 审批中心 `views/approval/index.vue`
- Tab：待审批、已处理、抄送我。
- 列表列：业务类型、发起人、当前节点、超时状态。
- API 指向：`/api/v1/approval/pending`

#### I. 审批详情 `views/approval/detail.vue`
- 上区：业务摘要（单据关键字段）。
- 中区：流程图 + 历史操作。
- 下区：动作区（通过/拒绝/退回/转签/撤回）。
- API 指向：`/api/v1/approval/:id/*`

#### J. 资产台账 `views/asset/list.vue`
- 列：资产码、类型、状态、所在项目、责任人、更新时间。
- 支持：按资产类型动态展示属性字段。
- API 指向：`/api/v1/asset`

#### K. 仓库库存 `views/warehouse/index.vue`
- 模块：库存总览、预警列表、出入库单。
- 交互：低库存预警置顶、可一键发起补货申请。
- API 指向：`/api/v1/warehouse`, `/api/v1/stock-order`

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
