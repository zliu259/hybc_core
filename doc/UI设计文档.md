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
  - 2026-11-06 重做，下面的规则取代本文后面对个人工作台的旧描述（3.11 等）。
  - 头部：问候、角色、日期和一句话结论（几件事等你处理、最久等了多久），右边是发起报销、发起对外付款、油卡额度申请。
  - 待处理：退回、油卡、审批合在一张清单里。退回的排最前，同类里等得最久的在前；等待满 3 天变橙，满 7 天变红。标签可按类型筛选，每行直达审批详情或修改页。
  - 右栏：常用入口 8 个（按角色给，Lucide 图标，颜色含义和小程序工作台一致，只放这个角色进得去的页面）、我的报销（只显示没走完的）。
  - 各块数据分别取，一块取不到不影响其他块；待办没取全时结论写“至少 N 件事”。
  - 去掉了“个人资质与证书”：后端没有存储，文件只在页面内存里，刷新就没了。
  - 代码：`views/welcome/workbench-view.ts`（逻辑和测试）、`components/WorkbenchQueue.vue`、`WorkbenchEntries.vue`、`WorkbenchReimbursements.vue`。
- 个人工作台-我的申请：`packages/web/src/views/workspace/my-applications/index.vue`
- 工作台我的报销提交：`packages/web/src/views/workspace/reimbursement/list.vue`
- 仪表盘：`packages/web/src/views/dashboard/index.vue`
- 实体管理：`packages/web/src/views/entity/index.vue`
- 财务中心-实体资料管理：`packages/web/src/views/entity/index.vue`（路由：`/finance/entity/profile`）
- 数据字典管理：`packages/web/src/views/dict/index.vue`
- 项目列表：`packages/web/src/views/project/list.vue`
- 项目选择大厅：`packages/web/src/views/project/hub.vue`（2026-11-06 起负责人显示名字；项目工作区头部的负责人、项目经理下拉框同样只显示名字）
- 人员显示规则（2026-11-06）：页面上只读的人员（负责人、填报人、执行人、处理人、操作人等）一律显示名字，用 `useWecomUserOptions` 的 `userNameOf`；通讯录里没有的人（如已离职）显示账号，不留空。选人下拉框也只显示名字，只能按名字搜索。企业微信通讯录、成员查看页的账号列保留。
- 项目立项：`packages/web/src/views/project/create.vue`
- 项目详情：`packages/web/src/views/project/detail.vue`
- 企业微信通讯录：`packages/web/src/views/wecom/contacts.vue`
- 企业微信成员查看（管理员）：`packages/web/src/views/wecom/member-admin.vue`
- 企业微信 JS-SDK 能力台：`packages/web/src/views/wecom/sdk.vue`
- 合同管理总览（2026-11-06 起合并原合同列表和合同执行监控）：`packages/web/src/views/finance/contract/index.vue`
- 合同详情/创建：`packages/web/src/views/finance/contract/detail.vue`
- 对外付款申请列表：`packages/web/src/views/finance/payment/index.vue`
- 资金流出智能发单台：`packages/web/src/views/finance/payment/wizard.vue`
  - （2026-07-14）合同选择改为「摘要」显示：`对方单位｜合同类型｜剩余额度｜提交人`（提交人取经办人 `handler_userid`）；默认仅列出"自己经办且剩余额度>0"的合同，「加载全部合同」按钮切换查看他人合同，剩余额度≤0（已执行完）不显示；金额区新增「按合同付款」入口（选合同后带入直付流程、项目预填、尽量匹配收款方）。
- 对外付款申请详情：`packages/web/src/views/finance/payment/detail.vue`
- 收款人管理：`packages/web/src/views/finance/payee/index.vue`
  - 个人工作台路径 `/workspace/payee` 下仅显示“与当前账号姓名匹配”的内部收款人记录（服务端按 `nickname/username` 与收款人姓名匹配过滤）。
- 报销付款工作台：`packages/web/src/views/finance/reimbursement/list.vue`
- 报销信封生成器（正式离线版）：`packages/web/src/views/finance/reimbursement/envelope-generator.vue`
- 报销详情：`packages/web/src/views/finance/reimbursement/detail.vue`
- 报销预审工作台：`packages/web/src/views/finance/reimbursement/precheck.vue`
- 报销查重中心：`packages/web/src/views/finance/reimbursement/duplicate.vue`
- 报销集中审批批次列表：`packages/web/src/views/finance/reimbursement/batch.vue`
- 报内报销集中打款台：`packages/web/src/views/finance/reimbursement/payout.vue`
- 报销集中审批批次详情：`packages/web/src/views/finance/reimbursement/batch-detail.vue`
- 收款工作台：`packages/web/src/views/finance/receipt/workbench.vue`
- 收款合同管理：`packages/web/src/views/finance/receipt/contract.vue`
- 发票管理：`packages/web/src/views/finance/receipt/invoice.vue`
- 收款登记列表：`packages/web/src/views/finance/receipt/list.vue`
- 收款统计仪表盘：`packages/web/src/views/finance/receipt/dashboard.vue`
- 审批中心（唯一审批台）：`packages/web/src/views/approval/index.vue`
- 审批监控台（超管/经理只读）：`packages/web/src/views/approval/admin-monitor.vue`
- 审批详情：`packages/web/src/views/approval/detail.vue`
- 审批模板配置：`packages/web/src/views/approval/template-config.vue`
- 金额阈值配置：`packages/web/src/views/approval/threshold-config.vue`
- AI配置管理：`packages/web/src/views/ai/config.vue`
- 计算节点监控与Runner运行参数：`packages/web/src/views/ai/nodes.vue`
- AI关卡任务管理（超管）：`packages/web/src/views/admin/ai-gate-tasks.vue`
- 企微推送监控（超管）：`packages/web/src/views/admin/wecom-push-monitor.vue`
  - 新增“扫描当前节点并强制推送”按钮，调用 `POST /api/v1/admin/wecom-push/force-current-nodes`，用于对当前所有在途审批节点待办执行强制推送。
- 企业微信智能机器人设置（超管）：`packages/web/src/views/admin/wecom-bot-settings.vue`
  - 位于“系统底层与引擎”，承载企业级智能机器人工具接入配置，不放在单个项目工作区。
  - 展示工具清单地址、工具调用地址和 Token 配置状态，支持复制地址与保存工具调用 Token；Token 保存后不回显。
  - 支持保存企业微信群机器人 Webhook URL；真实 URL 写入 KV，页面和 D1 只使用 `Webhook Secret Ref`。
  - 维护群聊目录，支持手动添加群聊、搜索群聊、同步外部客户群；内部普通群无法由企业微信 API 全量枚举时，通过手动或工具调用发现记录补齐。
- 库房（2026-11 重做；旧的资产台账、仓库、调度、工单、组合方案、手册、盘库等页面已下线，见下文「J. 库房」）：
  - 总览：`packages/web/src/views/wh/overview/index.vue`
  - 设备：`packages/web/src/views/wh/device/index.vue`；设备详情：`packages/web/src/views/wh/device/detail.vue`（隐藏路由 `/wh/device/:id`）
  - 物资：`packages/web/src/views/wh/material/index.vue`
  - 库房单：`packages/web/src/views/wh/doc/index.vue`
  - 任务：`packages/web/src/views/wh/task/index.vue`
  - 设置：`packages/web/src/views/wh/settings/index.vue`（隐藏路由，从总览进入）
  - 项目配套：`packages/web/src/views/wh/kit/index.vue`；清单详情 `kit/detail.vue`（`/wh/kit/:id`）、项目物资 `kit/project-ledger.vue`（`/wh/kit/project/:projectId`）、配套模板 `kit/template.vue`（`/wh/kit-template`），后三个是隐藏路由
- 项目设备视图：`packages/web/src/views/project/equipment-view.vue`（只读，显示项目上现有的设备和物资）
- 项目工作区项目群绑定：`packages/web/src/views/project/workspace/components/wecom-tool-binding-panel.vue`
  - 作为独立 Tab 嵌入 `packages/web/src/views/project/workspace/index.vue`，Tab 名称为“项目群绑定”。
  - Tab 入口仅对 `super_admin` 显示；非超级管理员访问 `tab=wecom` 时自动回到“项目动态与工作段”。
  - 仅承载项目维度群绑定，不再展示企业级工具 Token、工具地址和 Webhook URL 配置。
  - 群聊 ID 使用可搜索下拉，从系统群聊目录加载；支持 `allow-create` 直接输入未入库群聊 ID。
  - 选择目录内群聊时自动带出绑定名称和 `Webhook Secret Ref`，降低重复录入。
  - 支持配置智能机器人 ID、允许调用的只读工具、日志推送 Webhook secret 引用、问答启用和日志推送启用。
  - 支持新增、编辑、停用和单绑定测试推送；测试推送按钮需有行级 loading，完成后刷新推送结果。
  - 下方展示最近工具调用记录和最近推送结果，失败记录直接显示错误原因。
  - 列表加载、保存、测试推送和停用操作必须有明确 loading；保存、测试或停用后刷新绑定列表与记录区。
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

> **2026-11-06 改版为合同管理总览**，合并原合同列表和合同执行监控（`monitor.vue` 已删除，`/finance/contract/monitor` 重定向到本页）。以下为现行设计，本节后面的旧说明以此为准。

- **切换**：顶部分付款合同、收款合同，默认付款合同。不再有“全部方向”的看法，两类合同的进度含义不同。
- **一句话结论**：付款合同说有几份快付到合同额、几份已超付；收款合同说还有多少钱没到账。没有要关注的合同时直接说没有。
- **进度分布带**：在执行的合同按份数铺开。下方档位按钮同时是筛选，再点一次取消。
  - 付款合同：正常（不到 80%）、接近额度（80%–95%）、即将付满（超过 95%）、已付清、超付、未定总额（单价合同，有才列出）。阈值沿用原监控页。
  - 收款合同：未到账、回款中、已收齐、超收（有才列出）、未定总额（有才列出）。
- **在执行的口径**：`active`、`completed`，加上还没生效但已有钱进出的合同。已终止、未付款的草稿和待审批不算。
- **列表**：状态页签和进度档位二选一。项目、关键字同时影响汇总和列表。按档筛选时最接近上限的排在前面。
- **行内进度**：付款合同显示已付、剩余（或超付）和 80%、95% 刻度；收款合同显示已到账、未到账，已开票垫在进度条底下。比例向下取整，没付清不会显示 100%。已终止合同进度条变灰，不报警。
- **操作**：详情（点行也可以）、变更金额（只有生效中的合同）、删除。
- **配色**：石板蓝 `#56708a`（正常、回款中）、琥珀 `#d4820f`（接近额度）、印章红 `#b8322a`（即将付满）、苔绿 `#5b7f63`（已付清、已收齐）、深红 `#6f1616`（超付、超收）。这几个颜色只表示进度。
- **组件**：`components/ContractOverviewHead.vue`、`components/ContractGauge.vue`；文案和进度计算在 `contract-overview-view.ts`。
- **API 指向**：`GET /api/v1/contract/overview-summary`（`direction`、`project_id`、`keyword`；角色 `super_admin`、`manager`、`finance`）；`GET /api/v1/contract` 新增 `band` 筛选，每行带 `project_name`、`execution_band`。档位在服务端用 SQL 算，见 `packages/api/src/routes/contract-overview.ts`。

- 固定筛选：合同方向、项目、状态、关键字。
- 表格列：合同号、方向、对方单位、合同类型、总额、已付、剩余、状态、AI审查状态。
- 行操作：查看详情（2026-08 起点击行或「详情」按钮改为右侧抽屉打开，见 §10 财务详情抽屉化）、软删除。
- API 指向：`/api/v1/contract`

#### E. 合同详情 `views/finance/contract/detail.vue`

（2026-11-06 重排，与付款详情、小程序同一阅读顺序）

- 阅读顺序：头部（合同号、状态、对方单位、项目/主体/经办人、金额大写、执行进度）→ 退回或驳回原因 → AI 审查 → 合同信息 → 关联付款（付款合同）或开票记录、收款登记（收款合同）→ 金额变更记录 → 附件 → 审批流程。没有金额变更时整段不占位。
- 头部操作只显示当前状态和角色能用的，规则在 `contract-detail-view.ts` 的 `resolveContractCapabilities`，须与后端 `requireRoles` 和状态校验一致：
  - 草稿、待审查：提交审批（超管、经理、项目经理、财务）、触发AI审查（超管、经理、财务）。
  - 生效中：发起金额变更（超管、经理、财务）。
- 合同信息：阅读视图和「编辑资料」表单。方向、项目、我方主体只有新建时能选，更新接口不接受这三个字段（改主体见开发记录的直连 D1 手法）。金额只有草稿能直接改，其他状态提示走金额变更，保存时不提交金额；超管在锁定状态下用「超管编辑」开关解锁，必须写修改说明。备注里的系统修改记录单独折叠，保存时原样保留。
- 执行进度：付款合同看已付和余额，收款合同看已开票和已到账；总额不大于 0（单价合同）时不算比例和余额。
- 关联付款的合计只算有效付款，作废和被拒的不计入。
- 金额变更：`GET /contract/:id` 随行返回 `approval_status`，状态显示待提交、审批中、已退回、已撤回、已通过等；审批在跑时不再给提交按钮，改给「查看审批」。
- 附件：沿用审批详情的列表和预览。审批进行中业务接口不允许写，当前审批人和超管走 `POST /approval/:id/attachments`；其余走 `PUT /contract/:id`。可编辑时才能移除。新建时附件先记在页面，随合同一起创建。
- AI 审查、审批流程复用审批详情的 `AiVerdictPanel`、`FlowTimeline`。审批详情只对参与人和超管开放，取不到时提示看不到，也不给跳转入口。
- 组件：`components/ContractDetailPanel.vue`（容器，页面与 `ContractDetailDrawer.vue` 共用）、`ContractActions.vue`、`ContractProgress.vue`、`ContractInfoSection.vue`、`ContractPayments.vue`、`ContractInboundRecords.vue`、`ContractAmountChanges.vue`、`AmountChangeDrawer.vue`（合同执行监控共用）。与付款详情共用 `finance/shared/components/` 下的 `ApprovalSubmitDialog.vue`、`BizAttachments.vue`、`FinPanels.vue`。
- API 指向：`/api/v1/contract/:id`（2026-11-06 起随单返回 `project`、`entity`）、`/api/v1/contract/:id/submit-approval`、`/api/v1/contract/:id/trigger-review`、`/api/v1/contract/:id/amount-change`、`/api/v1/approval/:id`、`/api/v1/approval/:id/attachments`

#### E-1. 合同生成工作台 `views/finance/contract/draft/index.vue`（2026-07-22 新增 M1；2026-07-23 布局重构 UI2）

- 入口：侧边栏「实用工具 → 合同生成」（与查重对比同组）；roles：`super_admin` / `manager` / `finance`；路由 `/finance/contract/draft`。
- 双态页面：无 `?id` 时为列表态 = 新建卡（合同类型四族 + 立场）+ 历史草稿列表（`DraftListCard`：标题/类型/立场/状态/更新时间到分钟，行操作「继续编辑」「删除」——仅 drafting/finalized 可删，converted 留档禁删并 tooltip 说明）；有 `?id` 时为工作台态。「继续编辑」写回 query 走既有加载逻辑；「返回列表」清 query 并刷新列表。
- 立场：新建时选合同立场——`inbound`（对甲方，我方为乙方）/`outbound`（对分包商，我方为甲方）；两种立场加载不同的默认条款集合。
- 顶部状态 Banner（`DraftBanner`，替代原左列基本信息卡）：左区 = 草稿标题（点击即改，blur/回车确认并保存）+ 族/立场/状态标签 + converted 态「查看正式合同」链接；右区 = 我方主体（选中即加载其开户账户并在第二行小字显示税号/法人）、开户账户、关联项目、对方单位、「对方详情」弹层（信用代码/法人/地址/联系人/电话/开户行/账号七字段，保存即落库）、「保存」「返回列表」。
- 左列纯目录（span 6）：条款节列表 sticky 吸顶（header 与「添加节」固定、条目区内滚），条目加大（padding 10px 12px / 14px 字号），序号+标题一行、AI 状态 tag 右对齐，删除按钮 hover 才显示；保留 HTML5 拖拽排序（上下移按钮已移除）。
- 滚动跟随（scrollspy）：IntersectionObserver 观察每个节卡片，视口内最靠上的节高亮目录；点击目录平滑跳转（500ms 抑制防跳变；smooth 静默失效环境有瞬时兜底）。注意：PureAdmin 布局给 `el-scrollbar__view` 内联 `overflow:hidden` 会劫持 sticky 滚动容器，本页以 `:has(.draft-page)` 定向放开（不影响其他页面）。
- 右列逐节卡片（span 18）：默认生成 / 按个性化指令生成 / AI 交叉审查 / 手工编辑 / 模版变体切换。
- 关键字编辑唯一入口 = 正文点选（关键字 popover 改值即静默落库）；原左列关键字表单块已移除。正文未出现占位符的关键字在纯文本预览抽屉底部一行提示（不阻塞导出）。
- 双色高亮：关键字占位符（primary 浅底）与风险片段（红/黄底 + hover 显示理由与法条）双色体系；风险数据来自 AI 输出 `risk_spans` 与规则层 `checkClauseText` 合并。
- 交叉审查：起草与审查用不同厂商模型（terra 起草 / claude-sonnet-5 审查），结果以折叠面板展示逐条问题与建议。
- 完整性检查：弹窗列缺失节（core 红 / recommended 黄），逐条「添加该节 / 忽略（留痕）」，只提示不阻塞。
- 页面常驻提示：AI 内容为草稿，须经负责人审核；定稿转正式合同入口在右列工具条。
- API 指向：`/api/v1/contract-draft`（CRUD+列表）、`/:id/sections/:sid/generate`、`/:id/sections/:sid/review`、`/:id/completeness-check`、`/:id/completeness-ignore`、`/templates`。

#### F. 对外付款处理台（原「申请列表」）`views/finance/payment/index.vue`（2026-07-08 重构为阶段式付款处理台）

- 顶部汇总条：4 块可点击汇总，点击即切换到对应阶段页签——待付总额（`approved` 状态未付金额之和）、本月已付（`paid_at` 落在当月的 `paid` 金额之和）、超期未付（`approved` 且 `expected_payment_date` 早于今天的笔数，标红）、退回待改（`draft` 且关联审批实例状态为 `returned`/`pending`/`withdrawn` 的笔数，标红）。
- 五阶段页签（`el-tabs` + 徽标计数）：待处理（`draft`，退回件叠加「已退回」标签）、审批中（`pending_approval`）、待付款（`approved`，超期行标红且置顶排序）、已付款（`paid`）、全部（不筛状态）。
- 表格列：流水号、所属项目、付款内容、金额、收款方（`payee.name`，列表接口随行带回 `payee_name`）、标签（已退回/超期/状态）、AI风险、申请时间、支付时间（2026-07-08：移除合同号列，新增付款内容列；2026-11-09：金额大写列换成收款方，去掉付款方式列）。
- 条件筛选栏（2026-11-09，`components/PaymentFilterPanel.vue`，位于阶段页签和表格之间，和阶段页签叠加生效）：所属项目、申请人（企微通讯录）、收款方（名称模糊）、付款内容（内容或流水号模糊，原表头搜索框移到这里）、金额区间（元，含两端）、申请日期区间、支付日期区间、AI风险。下拉和日期选完立即查询；文本和金额回车或点「查询」生效；「重置」清空全部条件。最低金额大于最高金额时提示、不发请求。日期按北京时间的日期比较，和表格显示一致。已移除合同号筛选与状态下拉筛选（阶段页签取代原状态筛选）。
- 行内动作随页签/行状态变化：待处理页签或退回行显示「去修改」（跳转 `detail/:id?edit=1`）；退回行或审批中页签显示「审批详情」（跳转 `/approval/detail/:id`）；`approved` 行显示「标记付款」；始终显示「详情」（2026-08 起改为右侧抽屉打开，见 §10；「去修改」仍走详情页路由）。
- 发起付款统一跳转智能发单向导（`/finance/payment/wizard`），列表页不再承担创建职责。
- API 指向：`/api/v1/payment`（2026-11-09 新增筛选参数 `payee_keyword`、`amount_min`/`amount_max`、`created_from`/`created_to`、`paid_from`/`paid_to`、`ai_risk_status`，参数不合法返回 400 和中文说明）、`/api/v1/payment/console-summary`（2026-07-08 新增，聚合五阶段计数/待付总额/本月已付金额/超期数/退回数）。

#### G. 对外付款申请详情 `views/finance/payment/detail.vue`

（2026-11-06 重排，与小程序付款详情、审批详情同一阅读顺序）

- 阅读顺序：头部（流水号、状态、事由、项目/收款方/付款单位等、金额大写）→ 退回或驳回原因 → AI 审查 → 申请信息 → 付款执行 → 附件 → 审批流程。金额大写按金额现算，不读存量 `amount_cn`。
- 操作集中在头部，只显示当前状态和角色能用的按钮，不摆灰按钮；规则在 `payment-detail-view.ts` 的 `resolvePaymentCapabilities`，须与后端 `requireRoles` 和状态校验一致：
  - 草稿：提交审批、触发风险评估（操作员只有提交）。
  - 已审批：标记付款（超管、经理、财务）。
  - 超管：废除付款、重新激活（只显示当前状态可用的那个）。
- 申请信息：草稿且有写权限时是表单，否则是阅读视图；合同余额、项目、付款单位来自详情接口随单返回的 `contract`、`project`、`payment_entity`，不再拉全量列表（列表有条数上限，超出时会显示额度 0、主体为空）。超管在锁定状态下用「超管编辑」开关解锁，必须写修改说明。备注里的系统修改记录单独折叠，保存时原样保留。
- 付款执行：已付款看支付日期、流水号、经办人；已审批未付款提示一句；审批中只有当前审批人（或超管编辑模式）能改付款单位和账户，默认显示一行摘要。
- 附件：沿用审批详情的列表和预览抽屉。草稿、审批结束后走 `PUT /payment/:id`；审批进行中业务接口不允许写，当前审批人和超管走 `POST /approval/:id/attachments`。只有草稿或超管编辑模式能移除。
- AI 审查、审批流程直接复用审批详情的 `AiVerdictPanel`、`FlowTimeline`，样式在本页换成财务分节样式。审批详情只对参与人和超管开放，取不到时提示看不到，也不给跳转入口。
- 组件：`components/PaymentDetailPanel.vue`（容器，`detail.vue` 与列表抽屉 `PaymentDetailDrawer.vue` 共用）、`PaymentActions.vue`（头部操作）、`PaymentSubmitDialog.vue`、`PaymentMarkPaidDialog.vue`、`PaymentInfoCard.vue`、`PayoutPanel.vue`、`PaymentAttachments.vue`。
- 支持 `?edit=1` 深链：从付款处理台「去修改」进入时滚动到申请信息表单（能否修改仍由权限决定）。
- API 指向：`/api/v1/payment/:id`（2026-11-06 起随单返回 `project`、`payment_entity`，`contract` 增加 `entity_id`）、`/api/v1/payment/:id/mark-paid`、`/api/v1/approval/:id`、`/api/v1/approval/:id/attachments`

#### H. 收款人管理 `views/finance/payee/index.vue`

- 双标签页：外部收款人/内部收款人。
- 表格列：名称、开户行、账号、电话、创建时间。
- 操作：新增、编辑、软删除。
- API 指向：`/api/v1/payment/payee/*`

#### F. 报销付款工作台 `views/finance/reimbursement/office-workbench.vue`（2026-07-08 重构为三步流水线工作台，取代原财务中心三视图 `list.vue`）

- 财务中心报销入口改为 `office-workbench.vue`：单页承载「① 签收与复核 → ② 成批送审 → ③ 付款」三步流水线，顶部步骤条替代原“报销提交/核对签收与复核/提交审批/付款标记”四段视图。
- 步骤条徽标口径（来自 `workbench-summary` 聚合接口，非前端本地计数）：
  - ① 签收与复核 = `to_receive`（待签收）+ `to_precheck`（待复核）
  - ② 成批送审 = `to_batch`（待成批）+ `batches_to_submit`（待送审批次，`reimbursement_batch.status='draft'`）
  - ③ 付款 = `batches_to_pay`（待付批次，`reimbursement_batch.status='approved'`）
  - 计数排除 `cancelled` 信封；无数据时接口回退为 `0` 而非报错，前端徽标为 `0` 时不渲染。
- 第①步「签收与复核」内含三个服务端精确过滤 + 分页的子页签，切换页签即重新请求（带 `loadSeq` 竞态防护，丢弃过期响应）：
  - 待签收：`status=submitted`，行内动作「签收」（打开详情抽屉执行签收）。
  - 待复核：`status=received` 且 `precheck_status IN (none,pending,supplement)`，行内动作「复核通过 / 补充材料 / 复核驳回 / 智能核查 / 二次静默审查」。
  - 待成批：`status=received` 且 `precheck_status=approved`，行内动作「去成批 →」（切到第②步）。
  - 表格列：信封编号、项目、填报人（企微姓名映射）、通道（实物/电子标签）、金额、报销内容（`description`，超长省略悬浮提示）、异常提示（复用 `reimbursement-labels.ts` 的 `rowAnomalyTags`）、复核状态、状态标签。
- 第②步「成批送审」嵌入 `packages/web/src/views/finance/reimbursement/batch.vue`（按项目 + 被报销人汇总可送审条目并创建批次，候选清单后端强约束 `status=received + precheck_status=approved + batch_id IS NULL`）。
- 第③步「付款」嵌入 `packages/web/src/views/finance/reimbursement/payout.vue`（对已审批批次登记付款流水、付款账户和凭证）。
- 步骤/子页签切换后台自动刷新徽标（`switchStep`/`switchIntakeTab` 均触发 `loadSummary`），详情抽屉内动作完成后（签收/复核/触发核查）联动刷新当前列表与徽标。
- 顶部工具区常驻三个入口：「代员工发起」（新建报销）、「UUID 快速签收」（弹窗输入 UUID 直接定位并打开对应信封详情抽屉）、「信封生成器」（`envelope-generator.vue`）。
- 全流程查询：顶部输入框支持信封号 / UUID / 发票号 / 事由关键字模糊查询（不受当前步骤限制，`exclude_cancelled=false`，带 `querySeq` 竞态防护），查询结果模式下替换主视图为结果表格，新增「当前站点」列——由纯函数 `resolveStation(row)`（`packages/web/src/views/finance/reimbursement/reimbursement-station.ts`）按状态/复核状态/批次归属推导条目当前所处流程节点的中文标签，命中批次的行可「批次详情」直达 `batch/:id`；「返回工作台」退出查询模式。
- 状态标签与异常标签逻辑收敛进共享模块 `packages/web/src/views/finance/reimbursement/reimbursement-labels.ts`（`reimbursementStatusTagType`、`rowAnomalyTags`、`tableRowClassName`，命名类型导出），工作台与查询结果表格共用，避免逻辑漂移。
- `/workspace/my-reimbursement` 员工工作台**仍使用** `list.vue`（仅“我的提交”单一列表视图，不含财务中心三视图/子页签），零回归；`list.vue` 已配套移除财务中心三视图相关死代码（833→510 行）并收敛过时文案。
- API 指向：`/api/v1/reimbursement`、`/api/v1/reimbursement/workbench-summary`（2026-07-08 新增，`requireRoles(super_admin/manager/finance)`，聚合返回 `to_receive/to_precheck/to_batch/batches_to_submit/batches_to_pay` 五项计数）、`/api/v1/reimbursement/:id/trigger-anomaly-check`、`/api/v1/reimbursement/:id/precheck`；列表接口新增服务端过滤参数 `precheck_status`（逗号分隔多值，`IN` 条件过滤，与既有 `status` 参数正交组合）。
- **第 4 个 tab「草稿与异常」**（2026-07-10 新增，仅 `super_admin` 可见）：与前三个 tab 并列，`intakeTab='admin_zone'`，走独立的 `ADMIN_QUERY` 预设（不复用 `INTAKE_QUERY`），角标计数来自 `workbench-summary` 新增的 `admin_draft/admin_returned/admin_cancelled`（其余角色不请求、不下发）。
  - 三个子筛选（`el-radio-button`）：「草稿/未登记」（`status IN (draft, unregistered)`，排除信封生成器预生成的库存空白信封 `applicant_userid==='__UNASSIGNED__'`，通过列表接口 `exclude_unassigned=true`）、「退回滞留」（`status='submitted' AND precheck_status IN (rejected, supplement)`）、「已废止」（`status='cancelled'`）。
  - 表格新增「滞留天数」列（`updated_at` 距今天数）。
  - 支持多选 + 批量「一键废止所选」/「一键删除所选」，操作前二次确认弹窗显示条数与金额合计；删除为软删除（列表不再可见，数据与审计日志保留），仅「草稿/未登记/已废止」可删除，其余状态需先废止；操作后刷新当前子筛选列表与四个 tab 角标。
  - 切换主 tab 或子筛选时均清空已选批量项，避免跨筛选残留选择导致误操作。
  - API 指向：`POST /api/v1/reimbursement/void-batch`、`POST /api/v1/reimbursement/delete-batch`（均 `requireRoles(["super_admin"])`，显式 `envelope_ids` 列表，逐条审计）。

#### F-1. 报销信封生成器（正式离线版） `views/finance/reimbursement/envelope-generator.vue`

- 本地离线生成：在浏览器端批量生成 UUID4 与二维码，不调用后端生成接口。
- 参数输入：生成数量、统一输出尺寸（纸张/信封共用一个尺寸入口，支持常见尺寸与自定义）。
- 支持自定义标题与横向/纵向打印方向选择。
- 结果布局：每份仅包含二维码与 UUID 字符串，不显示“报销信封1/2”等序号文案；并预留“封装日期\_**\_年**月**日、签收日期\_\_**年**月**日、填报人”填写位。
- 输出能力：支持横向或纵向直接生成 PDF、PDF 打印（新窗口打印）；同时支持导出 CSV 与导入/导出批次 JSON（用于离线复打与跨设备交接）。
- 排版细节：二维码尺寸下调；UUID 字号与正文一致，提升人工核对可读性。

#### F-2. 报销详情 `views/finance/reimbursement/detail.vue`（2026-11-07 改版）

设计见 `docs/superpowers/specs/2026-11-06-reimbursement-multi-attachment-design.md` 第 6、7 节，样稿 `2026-11-06-reimbursement-detail-mock.html`。`detail.vue` 是薄入口，外部接口不变（`envelopeId`、`drawerMode`、`workspaceView`，事件 `close`、`changed`、`created`），内容在 `detail/` 下。

- **顶部 `VerdictHeader`**：第一行结论（26px/600，有问题时 `#b4470c`），第二行该做什么（`#1361d8`），第三行小字谁报销、多少钱、哪个项目；办公室有「留意」时多一行提醒。右边是接口 `guidance.actions` 给的按钮（第一个是主按钮）、「更多」和返回或关闭。工作台路由用 `guidance.applicant`，其他入口有 `office` 用 `office`。上传中由前端覆盖为「还有 N 张发票没传完」，提交不可点。打开已有的单时，数据没到显示「正在加载…」，失败显示「这张报销没有加载出来」并隐藏下方内容。
- **左列 `AttachmentPicker`（300px）**：顶部是「报销信息」卡片（2026-11-10 起，原来只是一行字，办公室常注意不到）：浅蓝底、蓝色图标，标题右边写「查看 / 修改 ›」（不能改时「查看 ›」，选中时「正在查看」），下面是报销金额（16px/600）和「项目 · 填报人 X」（最多两行）；看发票时也能一眼看到报的是多少。分组标题「发票 N 张」，有非发票、没读到金额或合并文件时写「附件 N 个」；可编辑时有上传框（一次选或拖多个，只收 PDF、JPG、PNG，单个 20MB，同时传 3 个，失败的单独重试）；文件行显示销售方（没有用文件名）和状态或金额，标「疑似重复」「含 N 张发票」「留意」，可删除的有删除。排序：还在传的、重复、失败、不是发票、没金额、合并文件、留意的，然后金额从大到小。
- **右侧 `AttachmentViewer`**：选中文件时显示原件（图片或 iframe，每次切换重新取签名地址）和销售方、发票号、开票日期、金额；没金额或合并文件时显示「系统读到的内容」；合并文件写明「这个文件含 N 张发票，系统没法逐张查重」；重复时写说明并能跳到那张单；办公室能看到留意的理由；失败的可重新识别；能删的时候文件名右边「下载」旁有「删除这张发票」。
- **删发票**（2026-11-10）：提交前和被退回时申请人能删；已提交、已签收还没成批没送审的，办公室能删（办公室角色删自己的单只有财务、超管可以），用于重复发票。确认框写明报销金额从多少改为多少（减去这张识别出的金额，最少到 0）；没识别出金额的写「不会自动改，删除后请到报销信息里核对」。提交后删要填原因（选填，疑似重复时默认「重复发票」），记审计 `reimbursement.envelope.attachment_delete`。删完回到「报销信息」，金额和合计已更新；已复核通过的退回待复核；和它重复的另一张报销会重新查重，提醒一起消失。
- **右侧 `EnvelopeInfoPanel`**：选中「报销信息」时显示。项目、填报人、通道、费用日期、报销金额、类别、说明；改动后才出现「保存」，提交前自动保存，不做失焦保存。报销金额没改过时等于已识别合计，改过不再覆盖。下方是报销识别号、信封识别号和状态、发票抬头（显示、识别原文、来源、办公室指定）、PDF 状态和文件、批次；对应不到具体发票的重复（金额接近）列在这里。
- **底部 `TotalsBar`**：票面合计、申报、差额。一致为绿色，有差额为警示色，没读全写「算不出」或「另有 N 个没有金额」，不比差额。
- **更多 `MoreActionsMenu`**：换绑信封、切换通道、拆单、全部重新识别（原「二次静默审查」）、废止（必填原因）。权限沿用原来的判断（`useEnvelopePermissions`）。
- **弹窗 `ActionDialogs`**：核查签收（备注可选）、标记异常、要求补充、驳回（都必填，申请人会看到原话）、废止、换绑、全部重新识别确认。复核通过的重复放行和电子发票放行仍是原来的理由提示框。
- **默认选中**：新建和草稿选「报销信息」；办公室打开时选有问题的发票，其次金额最大的；申请人看已提交的单选「报销信息」。
- **自动刷新**：有附件在识别时每 3 秒静默刷新，只更新数据，不动上传项，不冲掉正在填的表单；拆单弹窗打开时暂停。没有手动刷新按钮。
- **宽度**：小于 860px（含抽屉）上下排列，用容器查询判断，因为页面也放在 `batch.vue`、`batch-detail.vue`、`payout.vue`、`office-workbench.vue` 的抽屉里。
- **去掉**：状态总览、三张统计卡、智能核查摘要、可读版识别结果、附件类型选择、发票号字段、刷新识别状态按钮。
- **API 指向**：`GET /api/v1/reimbursement/:id`（`guidance`、`attachment_views`、`review_totals`）、`POST /:id/attachments`、`POST /:id/attachments/:attachmentId/rerecognize`、`POST /:id/attachments/:attachmentId/delete`（`reason`，返回 `deducted_amount`、`amount`、`precheck_reset`）、`POST /:id/submit`（`resubmitted`）、`POST /:id/void`（`reason`），其余沿用。

#### F-3. 功能页融合说明（预审/查重）

- 原“预审工作台”“查重中心”已从对内付款主路由下线，功能融合进报销业务页（列表/详情/批次）以减少页面切换与理解成本。
- 预审与异常检测在报销列表直接可操作，批次详情继续承载 AI 审计与审批联动。

#### F-5. 报销集中审批批次列表 `views/finance/reimbursement/batch.vue`

- 新增“候选报销条目”工作区：按项目 + 申请人自动列出未完成报销，可一键自动勾选“已收件+复核通过”并创建后立即送审。
- 展示维度：批次号、项目、申报人、信封数、总金额、智能审核状态、审批状态。
- 创建并送审要求项目、被报销人、收款方式与候选条目；付款实体、付款账户、账户显示为可选项，可由审批人员在审批详情页补充。
- 新增“历史完成（财务/领导）”区域：展示已付款/已拒绝等过往批次，支持打开批次详情追踪。
- 候选报销条目“查看”使用右侧详情抽屉，不离开集中审批页面：`packages/web/src/views/finance/reimbursement/batch.vue`
- 审批批次“详情”使用右侧批次详情抽屉，创建并送审成功后也在当前页面打开批次详情，避免跳转导致候选区、筛选和历史区重新加载：`packages/web/src/views/finance/reimbursement/batch.vue`、`packages/web/src/views/finance/reimbursement/batch-detail.vue`
- **「AI 一键成批」入口**（2026-07-10 新增）：候选条目工作区顶部新增按钮，打开 `AiBatchProposalsDrawer.vue` 建议批次确认抽屉——后端按「项目 + 收款人」自动分组给出建议批次列表（`GET /api/v1/reimbursement/batch/proposals`，`exclude_unassigned=true` 排除库存空白信封），抽屉内逐组勾选确认后，前端按组顺序编排调用既有 `POST /batch` → `POST /batch/:id/submit-approval` → `POST /batch/:id/trigger-audit` 创建并送审（无独立“确认批次”后端接口，前端编排、逐组独立成败）；每组结果（成功/失败原因）在抽屉内逐条展示，成功的组同步刷新候选区与历史区。
- API 指向：`/api/v1/reimbursement/batch`、`/api/v1/reimbursement/batch/proposals`（2026-07-10 新增，只读）
- **按发票抬头成批**（2026-09-12 新增）：候选筛选栏新增「发票抬头」（各 active 主体 + 未识别），候选表新增「发票抬头」列（主体名 / 原文+「未匹配主体」/「未识别」），汇总区新增「勾选抬头」；创建时所选信封抬头全部一致则自动预填付款实体（不覆盖已手填的账户显示），出现两种以上（含已识别+未识别）弹输入框要求填写 2–200 字混批理由（`POST /batch` 返回 400 `MIXED_INVOICE_TITLE` 时同样补理由重试一次，同一 Idempotency-Key），全部未识别不算混合；提交的信封 id 取勾选快照，创建后核对入批条数。信封抬头由 OCR 购买方名称自动匹配我方主体（只看最新识别轮，全失败轮不清空，已成批后不再改写），办公室可在信封详情「发票抬头（购买方）」卡片指定或清除（`PUT /reimbursement/:id` 的 `invoice_title_entity_id`，手工值不被 OCR 覆盖）；批次详情、审批页支付方案（保存与「通过」都拦）、集中打款台在付款实体 ≠ 批次抬头主体时标红并二次确认，不硬拦。办公室工作台「待成批」列表与 AI 一键成批抽屉显示抬头，建议分组键增加抬头。展示文案统一走 `reimbursement-title.ts`（与 API `reimbursement-batch-title-policy.ts` 规则逐字同步）。

#### F-6. 报销集中审批批次详情 `views/finance/reimbursement/batch-detail.vue`

- 展示维度：批次信息、智能审核报告、批次信封明细、查重风险汇总。
- 操作区：触发智能审核、提交集中审批、跳转“集中打款登记台”、跳转审批详情。
- 批次详情支持路由页与右侧抽屉两种承载方式；抽屉模式通过 `batchId` 载入指定批次，并在智能审核、提交审批、二次编辑、凭证保存和条目基础信息编辑后通知父页面刷新当前列表：`packages/web/src/views/finance/reimbursement/batch-detail.vue`
- 批次信封明细中的单项“详情”使用右侧抽屉打开，避免离开批次详情并重新加载批次上下文：`packages/web/src/views/finance/reimbursement/batch-detail.vue`
- API 指向：`/api/v1/reimbursement/batch/:id`, `/api/v1/reimbursement/batch/:id/trigger-audit`, `/api/v1/reimbursement/batch/:id/audit-report`, `/api/v1/reimbursement/batch/:id/submit-approval`, `/api/v1/reimbursement/batch/:id/mark-paid`

#### F-7. 报销集中打款登记台 `views/finance/reimbursement/payout.vue`

- 面向已审批报销批次的财务打款登记页面，支持单批次/多批次操作。
- 打款登记字段：打款日期、支付流水号、支付实体、支付账号、付款账户显示文本。
- 新增支付凭证上传区：支持上传打款截图/回单等附件，并在提交时一起保存。
- 批次展开后的报销条目提供“详情”入口，使用右侧抽屉快速查看与处理，不影响当前打款登记台状态：`packages/web/src/views/finance/reimbursement/payout.vue`
- API 指向：`/api/v1/reimbursement/batch`, `/api/v1/reimbursement/batch/:id`, `/api/v1/reimbursement/batch/:id/mark-paid`, `/api/v1/entity`, `/api/v1/entity/:id/bank-accounts`, `/api/v1/upload/sign`

#### G. 收款工作台 `views/finance/receipt/workbench.vue`

- 财务中心“收款”入口默认进入收款工作台，按办公室实际操作顺序展示：收款合同 → 开票处理 → 收款登记 → 收款看板。
- 工作台嵌入既有收款合同、发票管理、收款登记和统计看板页面，办公室无需在多个子菜单之间查找功能。
- 旧路由 `/finance/receipt/contract`、`/finance/receipt/invoice`、`/finance/receipt` 保留为隐藏路由，用于详情跳转和历史链接兼容。
- API 指向：沿用各子页面现有 API。

#### G-1. 收款合同管理 `views/finance/receipt/contract.vue`

- 核心列：合同号、项目、对方单位、合同总额、已开票、已收款、状态。
- “已开票”展示税后价税合计口径，由后端按发票 `amount_with_tax` 汇总并兼容旧发票 `amount`：`packages/web/src/views/finance/receipt/contract.vue`、`packages/api/src/routes/contract.ts`、`packages/api/src/routes/receipt.ts`
- 操作：新建收款合同（direction=inbound，仍走路由页）、查看合同详情并提交审批（2026-08 起「详情」改为右侧抽屉打开，复用 `ContractDetailDrawer`，见 §10）。
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
  - 明细列“单价/金额”改为“含税单价/含税金额”，行金额按 `数量 × 含税单价` 计算；
  - 开票明细支持“复制上一行”与“从模板导入”，减少重复录入；
  - 含税金额合计由明细行求和，不含税金额按 `含税金额合计 ÷ (1 + 税率)` 倒推，预计税额按 `含税金额合计 - 不含税金额` 计算；
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
- （2026-08）页面主体抽为 `components/ReceiptDetailPanel.vue`（收款 id 走 props），路由页保留为薄壳供深链接使用；收款登记列表「详情」改为 `components/ReceiptDetailDrawer.vue` 右侧抽屉打开，见 §10。
- 附件能力：收款凭证支持明细查看；退款记录支持在详情页上传并维护“银行汇款单”附件。
- 退款操作：可在详情页发起全额/部分退款并立即提审，形成“查看-操作”闭环。
- API 指向：`/api/v1/receipt/:id`、`/api/v1/receipt/refund`、`/api/v1/receipt/refund/:id/submit-approval`、`/api/v1/receipt/refund/:id/bank-slips`

#### G-4. 收款统计仪表盘 `views/finance/receipt/dashboard.vue`

- 指标：收款合同已开票、收款合同已到账、收款登记笔数、对外付款已支付、报销累计。
- 支持按项目切换统计。
- API 指向：`/api/v1/project/:id/financial-summary`

#### H. 审批中心 `views/approval/index.vue`

- 唯一审批台：原“统一审批台”（`unified-tasklist.vue`）已删除，旧路径 `/approval/unified-tasklist` 302 重定向到 `/approval/index`，导航菜单不再出现独立入口，全部审批处理动作收敛到本页。
- Tab：待审批、已处理、抄送我。
- 待审批/已处理列表列：业务类型、审批单号、所属项目、金额、业务明细、摘要、发起人、节点/操作、时间、状态（用于审批快速识别）。
- 待审批表格新增“操作”列：通过 / 驳回 / 转签 / 详情，无需进详情页即可处理当前节点：
  - 通过 / 驳回 / 转签点击打开共享轻量对话框：通过意见可选，驳回意见必填，转签需选择企微人员并填写原因（必填）。
  - 提交成功后提示并刷新当前页签，条目随即流出待办；提交失败显示错误提示，不静默吞错。
  - “详情”按钮进入 `detail.vue`，带 `?from=desk`，供详情页返回时定位回本页；已处理/抄送页签行点击进详情同样带 `?from=desk`，行为不变。
- 报销审批条目的“业务明细”支持直接点击跳转对应报销批次详情，便于从我的待办直接核对报销业务：`packages/web/src/views/approval/index.vue`
- API 指向：`/api/v1/approval/pending`、`/api/v1/approval/:id/approve`、`/api/v1/approval/:id/reject`、`/api/v1/approval/:id/transfer`

#### I. 审批详情 `views/approval/detail.vue`

2026-11-06 改版。页面只服务一件事：让审批人看清这笔钱并做决定。路由组件只负责布局，业务逻辑拆在 `views/approval/detail/`（`biz-view.ts` 各业务统一成「头部 + 明细行」、`useApprovalDetail/useApprovalActions/usePayoutPlan/useAttachmentPreview` 组合函数、`components/` 展示组件）。

- **布局**：宽屏左右两栏（主栏自适应 + 右栏 360px），窄于 1080px 变单栏且决策面板排在内容之后。
- **头部**（`ApprovalHero`）：状态、等待节点、业务类型与业务编号（有财务域权限才可点）；金额按付款凭证版式小写在上、大写在下，大写按金额现算，不读 `amount_cn`；其下是事由与关键事实（付款单展示**付款单位**和收款方，合同展示我方主体，另有项目、发起人、时间）。付款单位和付款账户对所有查看者可见，没选时显示「尚未指定」。
- **AI 审查**（`AiVerdictPanel`）：三态判定 + 一句话摘要；**AI 读取范围**（`CoverageNote`，没读全时黄色告警并列出未读页）；需关注项逐条展示维度、说明、依据；通过项折叠为「另有 N 项未见异常」；合同审查/付款风控/报销审计报告折叠在下方；此前轮次的结论折叠。没有 AI 结果时只显示一行说明。
- **明细**（`BizDetailPanel`）：无边框两列键值。备注里系统追加的 `[超管修改 …]` 日志拆出来，折叠成「支付信息修改记录（N 条）」。报销单据、开票项目表放在明细内。
- **附件**（`AttachmentPanel`）：一行一个，文件类型文字标签、可读的文件大小；点行预览，抽屉内可前后翻（`AttachmentPreviewDrawer`）；上传改为头部小按钮。
- **决策面板**（`DecisionPanel`，右栏吸顶）：「通过」是主按钮，不写意见时记为「同意」；快捷意见一键填入；「退回」「驳回」次级；转办、撤回、取消/终止收进「更多」。驳回未写原因就地报错并聚焦输入框；驳回、撤回、取消/终止需二次确认。退回弹窗只列当前可用的方式并带入已写意见。
- **支付方案**：默认折叠成一行摘要，点「修改」展开；付款账户只在选中主体时才请求。审批时**只有改动过才提交**，避免每次审批都往备注写一条修改日志。
- **审批流程**（`FlowTimeline`，规则在 `detail/flow-view.ts`）：待处理节点才显示待办人；已完成节点显示「谁、什么动作、何时」；通过时「同意/通过」这类意见不重复显示，驳回、退回写什么都显示；AI 任务只留一句结论；超管可对待办强制改派。
  - 节点状态不照搬库里的值（2026-11-06）：驳回的节点写「已驳回」（引擎落成 completed）；流程结束或进入下一轮后，卡住的节点写「已中止」，没走到的写「未执行」；流程结束时没轮到的人写「未处理」。
  - 通过时的意见：只有恰好是「同意、通过、已阅、ok」才隐藏，其他都显示（2026-11-06 线上核对，人工通过 2,312 条里有 72 条实际意见）。小程序流程区默认折叠，当前轮有实际意见或流程已停下时默认展开。
  - 多轮（退回或撤回后重新提交会新开一轮）：Web 切换「第 N 轮」，并说明上一轮或这一轮是怎么结束的；小程序只展开当前轮，标题带「第 N 轮」，前面的轮次折叠并写结束原因。
  - 流程停止提示（`notices.ts`）：除驳回、退回外，取消、撤回、付款作废也显示谁操作和原因。付款作废自 2026-11-06 起必须填原因，并写入 `approval_initiator_action`；存量作废只记在付款备注，从备注解析。
- **动作后流转**：通过/驳回/退回/转办成功后自动打开下一条待办（`from=monitor` 回监控台）；没有待办时回「待我审批」并提示已处理完。服务端报错原文展示，不再笼统提示「操作失败」。
- **加载**：实例先到先渲染，业务详情与报告随后补齐；名称映射后台加载，到达后原地替换；操作后静默刷新不闪遮罩。
- **吸顶实现注意**：全局布局给滚动区内联了 `overflow:hidden` 会令 sticky 失效，本页用 `:has()` 局部改为 `overflow:clip`，勿改回。
- 返回按钮按 `?from=` 回到来处；API 指向：`/api/v1/approval/:id/*`（`ai_gate_reviews[].findings/evidence_coverage` 由 2026-11-06 新增）、各业务详情接口。
- 小程序同步版本见 §4.37（按手机竖屏重排，不照搬本节布局）。

#### I-1. 审批监控台（超管/经理只读） `views/approval/admin-monitor.vue`

- 列表维度：审批单号、业务类型、摘要、发起人、当前节点、状态、提交时间、完成时间。
- 状态筛选改为四个页签：进行中 / 已通过 / 已驳回 / 全部（不传 status）；切页签即查询并页码归零。页签徽标计数取自 `GET /api/v1/approval/admin/summary`（`in_progress`/`approved`/`rejected`/`total` 四项全局聚合计数，不随下方次级筛选变化），计数接口失败时徽标不显示、不阻塞列表加载。
- 次级筛选保留：业务类型、发起人（企微成员下拉，仅显示姓名）、摘要关键字；查询/重置只作用于这三项，不影响当前页签。
- 已移除筛选条件本地持久化（不再按“当前登录用户 + 当前浏览器设备”保存/恢复状态筛选到 localStorage）。
- 行动作：查看详情（链接带 `?from=monitor`，供详情页“返回”定位回本页）、强制通过、强制转签（仅 `in_progress` 且 `super_admin` 可见；manager 无强制按钮，仅只读浏览列表）。
- 强制通过流程：先拉取审批详情并列出 pending 任务，再选择任务 + 填写意见后执行；强制通过/强制转签成功后同步刷新列表与页签徽标计数。
- 页面访问角色：`super_admin`、`manager`（放开只读监控，无强制操作入口）。
- API 指向：`/api/v1/approval/admin/all`（`super_admin`/`manager` 可读）、`/api/v1/approval/admin/summary`（同权限，四项聚合计数）、`/api/v1/approval/:id/force-approve`、`/api/v1/approval/:id/force-transfer`（仅 `super_admin`）。

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
- 初始化区：支持填写默认 OpenAI 模型与 Endpoint，并一键初始化 AI 供应商、路由规则、提示词模板；OpenAI 模型默认值为 `gpt-5.5`。
- 供应商Tab：CRUD表格（key、名称、endpoint、模型、优先级、并发）。
- 路由规则Tab：CRUD表格（规则名、业务类型、任务类型、供应商、优先级）。
- 提示词Tab：CRUD表格（key、名称、版本）+ 编辑弹窗含system/user prompt大文本区。
- API 指向：`/api/v1/admin/bootstrap/near-production-openai`, `/api/v1/admin/ai-provider`, `/api/v1/admin/ai-routing`, `/api/v1/admin/ai-prompt`

#### I-5. 计算节点监控 `views/ai/nodes.vue`

- 节点列表卡片：节点ID、名称、类型、状态（颜色标签）、能力、CPU/内存、最后心跳（相对时间）。
- 30秒自动刷新。
- Runner运行参数卡片：支持在线维护 `OPENAI_API_KEY`、`OPENAI_MODEL`、`OPENAI_BASE_URL`、合同文本/视觉模型键，参数落库后同步到 KV 供 Runner 轮询读取；`OPENAI_MODEL` 与合同文本模型未配置时默认回落到 `gpt-5.5`。
- AI运行测试卡片：可按任务类型创建测试任务，任务进入队列后在下方队列表追踪结果。
- 任务队列卡片：筛选（状态/任务类型）+ 表格 + 分页。
- API 指向：`/api/v1/admin/runner-runtime-config`, `/api/v1/admin/ai-runtime/test-task`, `/api/v1/task/nodes`, `/api/v1/task/queue`

#### J. 库房（2026-11 重做）

设计稿：`docs/superpowers/specs/2026-11-11-warehouse-rebuild-design.md`。菜单「库房」下七个页面：总览、项目配套、设备、物资、库房单、设备资料库、任务；设置、设备详情、清单详情、项目物资、配套模板是隐藏路由。旧的资产台账、仓库、调度看板、工单中心、组合方案、手册库、盘库等页面在阶段 1 一起下线。

通用规则：

- 只有一个库房，不选仓库。设备一台一台流转，物资按数量记账；所有数量变化都来自「库房单」，库房单不能改不能删，只能冲销。
- 设备状态（可用、待检、维修中、暂不可用、在项目、已报废）由位置和未完成的任务算出来，页面上没有改状态的入口。
- 写操作都带 `client_request_id`（库房单、导入）或 `version`（任务）：双击、重发不会多记一笔；任务被别人先改时提示「数据已变化，请刷新后重试」并重新加载。
- 权限：库管（设置里的名单）能录单、导入、建设备和物资、派工、确认；经理和超管能报废和改设置；只有超管能撤销报废；其他人只读；被派到任务的人能传照片、提交。
- 失败提示统一用后端返回的中文；页面上不出现英文枚举值和数字 ID。

##### J-1. 总览 `views/wh/overview/index.vue`

- 卡片：待确认清单、待确认任务、待派工任务、超期任务、待检设备、维修中设备、在项目设备、低库存物资。点卡片进对应的筛选列表（待确认清单 → `/wh/kit?status=submitted`，待派工 → `/wh/task?status=unassigned`，低库存 → `/wh/material?low_stock=1`）。
- 最近的库房单；还没设库管时顶部提示。右上角「设置」。
- API：`GET /api/v1/warehouse/overview`

##### J-2. 设置 `views/wh/settings/index.vue`

- 库管和资料管理员名单（从企微通讯录选人）、设备类别、默认检查人、返库检查要拍几张照片（0–9，默认 3）。
- **设备类别**一行有四样：名称、编号开头、排序、启用开关。「编号开头」是这个类别下新建设备不填编号时自动编号用的字母（顶管机 DG → `DG-034`），1 到 4 个英文字母，输小写会存成大写，不填用 SB；两个类别用同一个开头时提示「这个编号开头已经被别的类别用了」。表格下面有一句说明。改开头不动已有设备的编号。面板一打开就列出已有的类别。
- 企微通知开关（阶段 3）：默认关，一拨就保存。卡片点开的页面只在新版小程序里有，所以要等新版小程序发布后再打开。
- 经理、超管可改，其他人只读。
- **微盘镜像**卡片（阶段 4B，`components/WedriveMirrorCard.vue`）：只给库管、资料管理员、经理、超管看，按钮只有经理和超管有。
  - 顶上一句话：「还没有建微盘空间」「已暂停：<原因>」（红）「镜像已关闭」「N 份没传上去」（橙）「正在镜像，还有 N 份」「微盘和系统一致」（绿）。
  - 下面是各状态的份数（已同步、等待同步、没传上去、不镜像；有已经删除但微盘里没删掉的，多一项「该删没删掉」，顶上那句话也会说「N 份该删的还留在微盘里」）、本月调用次数「已用 a / 预算 b（企业每月上限 1000 次）」、单个文件上限、谁能看到（「还没有开放，微盘里谁也看不到」「全公司，只能下载」，或者「不确定：上次开放没收到企业微信的答复，请到微盘里看一下成员」，这时「对全公司开放」还在，可以再点一次）。
  - 按钮按状态出现：「初始化微盘空间」（先确认）、「恢复镜像」（暂停时）、「全部重试」（有没传上去的）、「对全公司开放」、「开启镜像 / 关闭镜像」。「对全公司开放」的确认框：「开放后，全公司的人都能在企业微信的微盘里看到『设备资料库』并下载里面的文件。」还有资料没镜像完时后端不让开放，提示还有几份。
  - 不自动刷新，右上角有「刷新」。微盘那头报错时提示里带企微的错误码；连不上时写「连不上企业微信的微盘接口」。
- API：`/api/v1/warehouse/me`、`/member`、`/device-category`、`/settings`；微盘镜像是 `/api/v1/doc-library/wedrive/status|setup|settings|open|retry-failed`

##### J-3. 设备 `views/wh/device/index.vue`、`detail.vue`

- 列表：编号、名称、现场叫法、类别、机型、口径、状态、所在项目；按状态页签（带数量）、类别、关键字筛选。新增（编号不填自动生成 `SB-0001`）、粘贴表格导入（任何一行出错整批不导入，逐行报错）、勾选后打印二维码标签（内容 `HYBC:D:<编号>`，新窗口打印）。
- 详情：基础信息和状态标签；维修使用记录（每次返库的项目、时间、顶进米数、土质，累计顶进；维修记录按液压、电气、传动、其他分栏）；时间线（建档、发出、返库、检查、维修、报废、备注）；报废（必须写原因、传照片）和撤销报废。
- API：`/api/v1/warehouse/device`、`/device/import`、`/device/:id`、`/device/:id/note`、`/device/:id/scrap`、`/device/:id/unscrap`

##### J-4. 物资 `views/wh/material/index.vue`

- 列表：编号（`WZ-0001`）、品名、规格、单位、分节、管法（周转/消耗）、在库、最低库存、库位；可只看低库存。
- 新增、粘贴表格导入（可带期初数量，自动生成一张期初单）；每条物资的流水抽屉（单号、类型、变化、余额）。
- API：`/api/v1/warehouse/material`、`/material/import`、`/material/:id/ledger`

##### J-5. 库房单 `views/wh/doc/index.vue`

- 列表按类型页签（入库、发往项目、项目返库、项目间转场、期初、盘点调整、报废），可按单号和时间筛选；点行看详情。
- 录入四种：
  - 入库：供应商、物资和数量。
  - 发往项目：选项目和领料人；设备只能选可用的；物资不能超过在库数量（表单里先拦一次）。
  - 项目返库：选项目后自动带出在这个项目上的设备和物资，默认全部退回；每行可改退回数和丢失损坏数，设备填顶进距离和土质。提交后每台设备生成一个返库检查任务，提示「已生成 N 个检查任务」。
  - 项目间转场：从甲项目转到乙项目，数量默认等于在场数。
- 详情抽屉：抬头、每行变化（退回/报损、在库变化、顶进米数）；冲销（确认后生成一张数量相反的单，原单保留；数量已经变动、冲不回去时显示后端原因）。
- API：`/api/v1/warehouse/doc`、`/doc/:id`、`/doc/:id/reverse`、`/project/:projectId/holdings`

##### J-6. 任务 `views/wh/task/index.vue`

- 页签「我的」「全部」（库管默认全部）；状态筛选：待派工、待执行、待确认、已完成、已取消。列：任务号（`KFR-`）、类型、标题、设备、执行人、期限（超期标红）、状态、照片数/要求数。
- 库管「新建任务」：检查、维修、保养、其他；标题、设备（可不选）、说明、是否挡住发出、照片要求、期限、执行人。
- 详情抽屉：
  - 任务信息；被退回时顶部红色提示框显示退回要求。
  - 照片缩略图可点开预览；执行人在待执行时可上传、删自己的照片。
  - 执行人的提交区：检查任务选合格或不合格，维修任务勾涉及的系统，写简报。照片不够时后端提示「还差 N 张照片」。非库管提交后待确认；库管自己做的任务提交即完成。
  - 库管的操作：派工/改派、确认完成、退回补充（必须写要求，照片保留）、取消（必须写原因）。
- 检查不合格在完成时自动生成「维修：<设备名>」任务（挡住发出，待派工），设备显示维修中；维修完成后设备回到可用，维修记录进设备详情。
- API：`/api/v1/warehouse/task`（`scope`、`status`、`assigned=yes|no` 筛选）、`/task/:id`、`/task/:id/assign`、`/photo`、`/submit`、`/confirm`、`/send-back`、`/cancel`

##### J-7. 项目配套（阶段 2）`views/wh/kit/*`

现有那张「设备出入库登记表」的系统版。清单只记计划，已发、已退、报损、在场都从库房单算出来。

- **清单列表** `kit/index.vue`：按状态页签（草稿、待确认、已确认、已关闭）、项目、关键字筛选；列为清单号（`PT-`）、项目、标题、模板、行数、状态、更新时间。能建清单的人看到「新建清单」，库管另有「配套模板」。
- **新建**：选项目（只是现场负责人时只列自己负责的项目；按建档时间排，最新建的项目在最前）、标题；四选一：按项目参数生成（默认）/ 选模板 / 复制已有清单（可以是别的项目的）/ 空白。从模板生成时，物资行按品名找物资：模板写了规格就选同规格的，同品名只有一种规格就直接选上，否则显示「待选规格」。
  - **按项目参数生成**（`KitCreateDialog.vue` 加 `KitPlanForm.vue`、`KitPlanPreview.vue`，状态在 `useKitPlan.ts`）：选了项目就从工作段和项目档案取参数填好，每一项下面标来源（工作段、项目档案；手改过的不标）。参数是机型、管径、总长度、最长一段、段数、套数、土质，和「甲方提供」发电、住宿两个勾选。模板按机型和管径预选最接近的，可以换。参数不对时列出原因，「预览」点不了。点「预览」看主要设备（几台、库里哪几台合适）、提醒（模板和项目管径不同、几行要重新选规格、缺哪个参数）、每一行的数量和算式；甲方提供的行标「现场已有」。看过预览才能「创建」；改了参数或模板要重新预览。对话框在这一项下宽 760px。
- **清单详情** `kit/detail.vue`：抬头（项目、标题、来源、创建/提交/确认人和时间、备注、作废原因）；按项目参数生成的清单在抬头下面多一行生成时的参数和所用的模板（`KitPlanSummary.vue`，只读），计划数量下面显示这一行的算式，数量和生成时不同的行标「已改，生成时是 N」；行表格可改分节、类型、品名和规格（物资行是同品名规格的下拉，也能搜别的物资）、设备类别、单位、计划、来源（库房发、现场采购、租赁、现场已有）、备注，可加行删行。
  - 提交前把还没选规格的行标红并滚到第一行；提交时先保存再提交。库管提交直接确认，其他人提交后等库管确认。
  - 未确认的可以「作废」（必须写原因）；已确认的不能再改，要追加就新建一份清单。
  - 已确认后表格多「已发、待发、在库」三列：一个项目多份清单时，已发数按确认先后依次分给各行。库管看到「按清单发货」和「关闭清单」（项目没结清时关闭会被拒绝，并说明还有几台设备、几种周转件在场）。
- **按清单发货**：打开发货单，项目固定；物资行按待发数预填（同一物资几行合并）；设备区按类别提示「顶管机 DN1200：还需 1 台（可用 3）」，旁边的选择器只列这个类别里可用的设备；清单外的东西也能加。单据详情显示配套清单号。
- **项目物资** `kit/project-ledger.vue`：顶部显示「已结清」或「未结清（N 台设备、M 种周转件在场）」；物资表列为分节、编号、品名和规格、单位、管法、计划、已发、转出、已退、报损、在场、首次出库、最后退库、报损金额（报损数 × 单价，没单价显示「-」），下面是报损金额合计；设备类别表（计划、已发、在场）和在场设备；本项目的清单列表，结清后库管可以在这里关闭。「项目返库」打开返库单并带出在场清单。
- **配套模板** `kit/template.vue`：模板列表（名称、机型、行数、在用/停用）；点开编辑抬头和行，保存带版本号（别人先改了提示「数据已变化」）；「粘贴导入」从 Excel 粘贴整张表（列：分节、类型、品名、规格、单位、默认数量、设备类别、备注），类型认 设备/按台、物资/周转/消耗、备忘，设备类别必须先在设置里建好，有错的行逐行列出、整批不进表格。只有库管能改。
  - 模板抬头多一个「管径（毫米）」，列表多一列管径。每一行多一列「计算规则」（`TemplateRuleCell.vue`）：平时显示一句话（例如「按最长一段 ×2 +60 · 每套一份」，没配显示「固定」），点「改」在格子里展开六样设置：计算方式（固定、按总长、按最长一段、按段）、系数、另加、每套一份、规格随管径（只有物资行）、标记（主机、发电、住宿）；备忘行没有这一列的内容。「粘贴导入」多认同名的六个可选列，没有这些列就都是固定。
- 权限：看清单所有人都能看；建、改、提交、作废：库管、经理、现场负责人（只限自己负责的项目）；确认、关闭、按清单发货、维护模板：库管。
- API：`/api/v1/warehouse/kit-template`、`/kit`、`/kit/:id`、`/kit/:id/submit`、`/confirm`、`/discard`、`/close`、`/kit/:id/fulfilment`、`/project/:projectId/ledger`；发货单 `POST /api/v1/warehouse/doc` 可带 `project_kit_id`

##### J-8. 项目设备视图 `views/project/equipment-view.vue`、`workspace/equipment-panel.vue`

- 显示这个项目上现在有的设备和物资（来自库房单的累计），只读。
- API：`GET /api/v1/warehouse/project/:projectId/holdings`

##### J-9. 旧接口占位

已发布的小程序和 MCP 还在调旧路径。阶段 3 的新小程序页面已经不调这些路径，但占位要等新版小程序发布约一周后再删（另开 PR），并且 `GET /warehouse/stock-order` 留到阶段 5（MCP 的 `list_stock_orders` 还在用）。阶段 5 已经把 MCP 的 `list_stock_orders` 换成了 `list_devices`（`@hybc/mcp` 0.2.0），但装着旧版的人还在调旧路径，所以这个占位和别的占位一起留到删占位的那个 PR。在那之前：旧的列表接口返回空数组，其他旧路径返回「库房功能已升级，请使用新版页面」；`/warehouse/inventory` 和 `/warehouse/inventory/alert` 由新物资表接管。已发布的小程序库房页会显示空数据。

##### J-10. 设备资料库（阶段 4A）`views/wh/doc-library/*`

菜单「库房 → 设备资料库」，路由 `/wh/doc-library`（带 `?device_id=` 时直接筛到那台设备）。计划 `docs/superpowers/plans/2026-11-12-warehouse-phase4a-doc-library.md`。看资料是全部五个角色；上传、替换、改、删、对外链接要库管或资料管理员（`caps.is_doc_admin`）。

- **左边目录**：全部、通用、各设备类别，类别下面挂有资料的设备。数字是那一项自己的资料份数（类别只数归到类别本身的）。点一项，右边按它筛。
- **右边列表**：资料类别筛选、关键字（标题、文件名、设备编号）、「只看快到期和已过期的」、「显示旧版本」。列：标题（下面一行是文件名和大小）、资料类别、归属、上传（人和时间）、有效期至（30 天内到期标橙、已过期标红）、操作。
- **操作**：查看（所有人）；改（资料管理员）；「更多」里是替换文件、对外链接、历史版本（替换过才有）、删除。被替换的旧版本只有「查看」。
- **查看**：PDF 用 pdf.js 逐页画，先画 3 页，往下滚再画后面的，文件按 1 MiB 一段取；图片直接显示；视频能拖进度条；其他类型（Office、压缩包、图纸）只给下载。PDF 另有「在新窗口打开」（浏览器自带的查看器）。文件地址 15 分钟有效，打开对话框时才取。
- **改**：标题、资料类别、归属（某台设备可搜、某类设备、通用三选一）、有效期。文件本身不能改，要换文件用「替换」。别人先改过时提示并刷新。
- **删除**：确认框写明「删除后 Web 和小程序上都看不到，对外链接同时失效」。只能删最新版；删掉后它替换的上一版重新显示。
- **上传**：一次选或拖多个文件；归属默认跟着左边选中的那一项（选的是「全部」时要自己挑）；每个文件可改标题（默认文件名去扩展名）、资料类别（按文件名猜）、有效期（只有合格证、检测报告）。类型不支持、空文件、超过上限的当场列出原因，不进队列。同时传 2 个，逐个显示进度；失败的显示原因和「重试」；传完提示「N 个已上传，M 个失败」。上传中关对话框要确认。
- **替换**：只选一个文件，标题和类别带出旧的（可改），归属沿用旧文件；旧文件留作历史版本，原来的对外链接作废。
- **按文件夹导入**（现有资料迁入）：选一个文件夹或把文件夹拖进来。选的是总文件夹时按一级子文件夹分组；子文件夹名里有设备编号、或者等于设备名称或现场叫法就自动对上。预览表里每个文件夹可以改归到哪里或勾「跳过」，展开能改每个文件的资料类别；没对上的必须选好或跳过才能开始。导入完写明成功、失败各多少和跳过了哪些文件夹。
- **对外链接**：选有效天数（1 到 30，默认 7）生成；列出这个文件的全部链接（到期时间、下载次数、有效/已作废/已过期）；可以复制、作废。对话框里写明「拿到链接的人不用登录就能下载这一个文件」。
- **设备详情**多了「资料」卡片：这台设备的、这类设备的、通用的分三段，点标题查看；资料管理员有「上传到这台设备」。**任务抽屉**里有设备的任务多了「适用资料」（只列标题和类别，检查、维修、保养任务把保养维修记录和说明书排前面）。
- **微盘同步状态**（阶段 4B）：建过微盘空间、并且看的人是库管或资料管理员时才出现。写在标题那一格里，不单独占一列（1440 宽的屏幕上再加一列表格就要横着滚）：同步好的在文件名那一行后面跟「· 微盘已同步」；有问题的在标题后面出一个标签「微盘：等待同步」「微盘：没传上去」（红，鼠标放上去是原因）「微盘：不镜像」（橙，原因多半是超过镜像大小上限）。被替换的旧版本不在微盘里，不显示。「更多」里多一项「重新同步到微盘」。
- API：`/api/v1/doc-library/*`（`config`、`file`、`file/:id`、`file/:id/url`、`tree`、`for-device/:deviceId`、`upload/init|part|complete|abort`、`file/:id/share`、`share/:token`、`shared/:token`、`file/:id/remirror`）。

##### J-11. 盘点（阶段 5）`views/wh/stocktake/*`

菜单「库房 → 盘点」，路由 `/wh/stocktake`（列表）、`/wh/stocktake/:id`（一次盘点）。计划 `docs/superpowers/plans/2026-11-12-warehouse-phase5-stocktake-digest.md`。看盘点是全部五个角色；发起、录数、标记设备、完成、取消只有库管。

- **列表**：盘点单号、范围（物资、设备、全部）、状态（盘点中、已完成、已取消）、物资已盘（已盘条数 / 总条数）、设备找到（找到台数 / 账上在库台数）、调整单号、发起人和时间、备注。按状态分页签。同一时间只能有一次盘点：有进行中的时候顶上写明是哪一次，按钮是「继续盘点」（不是库管是「看这次盘点」）；没有的时候库管有「发起盘点」（选范围，可写备注）。
- **一次盘点**：顶上是单号、状态、范围、发起人和时间、进度；完成后多出完成人、调整单号（没有差额时写「没有差额，没出调整单」）；取消的写取消人和原因。范围是「全部」时有「物资」「设备」两个页签。
  - **物资**：筛「全部、没盘的、有差额的」，按类别筛，关键字搜品名、规格、编号；每页 50 条。每行：类别、品名规格（下面是编号和库位）、账面数、实盘数输入框、差额（盘亏红、盘盈绿、一样写「一致」）、备注。实盘数输完按回车或点别处就存，存的同时记下那一刻的账面数；清空输入框是清掉这一行；填的不是 0 以上、最多 3 位小数的数会提示并恢复原值。备注单独存，不会重记账面数。存一行的时候页面不转圈，可以接着录下一行。
  - **设备**：编号、名称、类别、库位、盘点结果、备注。顶上的输入框输编号回车等于标记找到（没有扫码枪也能用）；每行有「找到」「没找到」（可写备注）「清掉」。输的是账上不在库的设备（在项目、已报废）也会记下来，并提示「账上在「某项目」，盘完后补一张返库单」。
  - **完成盘点**：先重新取一次，弹出确认，逐条写明会发生什么：几条物资有差额会出调整单、还有几条没盘（这些不动）、几台在库设备没找到会在时间线上记「盘点未找到」、几台扫到了但账上不在库。一台设备都没标记过（比如选了「全部」但只盘了物资）时写「设备一台都没标记，这次不记设备的盘点结果」，完成后不会给设备记「没找到」，设备行显示「没标记」。确认后系统出一张「盘点调整」库房单把账面改对。完成之后只读。和别人的录入撞上时提示并刷新，再点一次。
  - **取消盘点**：可写原因；这次录的数都不算，库存不变。
- 盘点期间可以照常出入库：差额按录入那一刻的账面数算，之后发出去的不会被当成盘亏。设备盘点只出报告，不改设备位置。盘点调整单不能冲销，调错了再盘一次。
- **总览**多了「证书到期」数字（已过期加 30 天内到期的份数），点进去是设备资料库里只看快到期和已过期的。
- API：`/api/v1/warehouse/stocktake`（`GET` 列表、`POST` 发起）、`/stocktake/:id`、`/stocktake/:id/material-line/:lineId`（`PUT`）、`/stocktake/:id/device-scan`、`/stocktake/:id/complete`、`/stocktake/:id/cancel`。

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
- 标段详情弹窗：在项目面板“标段总览”点击“查看详情”进入，显示标段基础信息、该标段操作员日志、该标段贯通报告；标段基础信息需覆盖计划里程、管径/规格、设计坡度、顶进方式、管材、土质等项目/工作段级字段。
- 项目日志聚合区：仅展示项目级管理员日志（项目相关内容），不再承载施工日志/标段贯通内容。
- 标段内日志能力：施工日志与贯通报告统一下沉到“标段详情抽屉”，支持查看、新增与编辑。
- 贯通报告标段绑定：贯通报告按 `section_id` 归集，并在对应标段详情下追溯。
- 对应 API：`/api/v1/project/:id/files`、`/api/v1/project/:id/files/:fileId`、`/api/v1/log/operator?project_id=:id&section_id=:sectionId`、`/api/v1/survey/breakthrough?project_id=:id&section_id=:sectionId`。
- 外包日志入口：位于 `packages/web/src/views/project/workspace/project-panel.vue`，支持项目内生成/打印免登录二维码、停用旧二维码，并展示外包日志 AI 审计与人工复核列表。
- 外包日志 AI 复核详情：`packages/web/src/views/project/workspace/project-panel.vue` 的复核列表中，AI 摘要与 AI 问题在表格内保持单行预览，点击“详情”弹窗查看完整 AI 摘要、风险等级、分数和问题明细；列表右侧仍保留直接“通过 / 驳回”操作。
- 外包二维码复用打印：`packages/web/src/views/project/workspace/project-panel.vue` 的“打印外包日志二维码”弹窗支持查看并再次打印当前有效二维码；历史旧二维码若未保存明文 token，需要重新生成一次后才能查看/打印。
- 外包日志免登录页：`packages/web/src/views/public/project-log.vue`，路由 `/public/project-log/:token`，面向手机扫码填写同一项目下的标段施工日志与项目日志。
- 外包日志类型选择：扫码页支持选择填写“项目日志”“标段日志”，可单选或同时选择；选择标段日志时必须选择对应标段，后端采纳时只生成已选择类型对应的正式日志记录。
- 外包人员信息缓存：扫码页使用浏览器本地缓存保存填报人姓名、外包单位、联系电话，下次进入自动回填，不写入登录态。
- 外包日志免登录页状态：`packages/web/src/views/public/project-log.vue` 扫码后先进入外包日志工作台，提供“查看项目日志 / 查看工作段日志 / 填写项目日志 / 填写工作段日志”四个入口；填写工作段日志页必须在选择工作段后展示上一条同工作段日志，辅助现场人员快速对比累计数、累计顶进、设备参数、偏差、问题和备注；所有填写页继续提供加载等待、加载失败结果页、照片上传中提示、提交中表单禁用、防重复提交、提交成功编号与 AI 审计任务编号反馈。
- 外包日志查看深链：`packages/web/src/views/public/project-log.vue` 支持 `?mode=view_project` 与 `?mode=view_operator&section_id=:sectionId`，供企业微信群日志推送消息附带“原始链接”后直接进入对应查看页。
- 施工日志字段口径：Web 施工日志中心 `packages/web/src/views/construction/operator-log/form.vue`、项目工作区标段抽屉 `packages/web/src/views/project/workspace/project-panel.vue`、外包扫码页 `packages/web/src/views/public/project-log.vue` 统一支持本班/累计下管、本班/累计顶进、刀盘电流、刀盘频率、泥仓压力、顶力、水平偏差、高程偏差、天气、问题摘要和备注。
- 外包二维码有效性：除 `archived` 归档项目外，规划中、筹备中、施工中、收尾中等项目状态均允许生成和使用二维码；项目状态切换为 `archived` 时，后端自动撤销该项目有效二维码，公共扫码接口也实时拒绝归档项目。
- 外包日志 API 指向：`/api/v1/project/:id/public-log-link`、`/api/v1/project/:id/external-log-submissions`、`/api/v1/public/project-log/:token`、`/api/v1/public/project-log/:token/submissions`。

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

### 3.13 项目工作区新增标段入口与加载结果态（2026-05）

- 项目工作区保留在 `项目动态与工作段` 标签内承载标段总览：
  - 路由容器：`packages/web/src/views/project/workspace/index.vue`
  - 标段总览与新增入口：`packages/web/src/views/project/workspace/project-panel.vue`
- 标段总览头部新增“新增标段”操作，面向 `super_admin/manager/site_manager`：
  - 弹窗字段：标段编码、标段名称、计划里程、初始状态、管材、管型、土质。
  - 管径、坡度、顶进方式、管材、管型使用手动输入。
  - 土质使用固定下拉多选：粘土、粉土、细砂、中砂、粗砂、细砾、中砾、粗砾、卵石、漂石、强风化岩石、中风化岩石、弱风化岩石、岩石；提交时按 `、` 拼接保存到现有文本字段。
  - 拟派设备、匹配评分、匹配说明属于 AI 自动填写字段，不在新增标段人工表单中展示。
  - 创建中按钮展示 loading，成功后关闭弹窗并刷新标段总览。
  - 必填校验：标段编码、标段名称。
- 标段详情抽屉新增“标段基础信息”编辑区：
  - 文件：`packages/web/src/views/project/workspace/project-panel.vue`
  - 允许修改标段名称、里程、管径、坡度、顶进方式、管材、管型、土质；标段编码只读。
  - 土质与新增标段一致，支持固定选项多选并按 `、` 拼接保存。
  - 保存成功后同步刷新当前抽屉和标段总览卡片中的基础数据。
- 标段总览补齐加载反馈与结果返回：
  - 顶部显示“正在加载/已返回 N 个标段/加载失败”。
  - 支持手动刷新标段总览。
  - 空结果显示“暂无标段数据”。
  - 工作区整体加载失败时展示错误 Alert 和“重新加载”操作。
  - 标段详情抽屉加载失败时展示错误 Alert 和“重新加载详情”操作。

## 4. 小程序页面级规范（企业微信）

### 4.0 设计基准与参考

- 企业微信样式规范参考：`https://developer.work.weixin.qq.com/document/path/90305`
- TDesign 小程序组件库参考：`https://tdesign.tencent.com/miniprogram/`
- 设计目标：在企业微信容器内保持原生一致性（轻量、清晰、可读），同时通过 TDesign 提升组件一致性与交互反馈质量。
- 落地策略：业务结构保持现有 Phase 10 信息架构，仅重塑视觉层与交互层，不改变后端接口契约。

### 4.1 页面总索引

- 工作台（Tab1）：`packages/miniapp/pages/index/index`
  - 2026-11-06 重做，下面的规则取代本文后面对工作台的旧描述。第一屏的内容都能点。
  - 顺序：问候和日期、待办数字（待审批、被退回、待复核、进度预警、库房任务，按角色显示，点了直接去处理）、常用入口 8 个、待我审批前 3 条（点了直接进详情）、全部功能。
  - 待办数字最多 4 个，放不下时先去掉数字为 0 的；有事的不会被挤掉。没取到的显示 `-`，不能显示成 0。
  - 入口是实色方块配白色线条图标（Lucide，见 `assets/workbench/README.md`），颜色表示类别：现场绿、财务橙、项目和管理蓝、查询和记录灰。入口和后端角色一致，只放点得进去的。
  - 常用入口按角色给默认顺序；同一个入口用满 3 次后往前排，一次使用过程中位置不变。
  - 视图逻辑在 `utils/workbench-view.js`，流程测试 `utils/workbench-page.test.js`。
- 项目列表：`packages/miniapp/pages/project-list/index`（2026-11-06 重做）
  - 搜索和状态标签选了就生效，“只看我负责的”走接口 `manager_userid` 筛选；每页 20 条，上拉加载，下拉刷新。
  - 卡片只放项目名、状态、负责人、开工日期、位置。办公室、仓库两个占位项目不显示。已归档的项目排在后面，文字变浅。
- 项目详情：`packages/miniapp/pages/project-detail/index`（2026-11-06 重做）
  - 阅读顺序：头部（编号、状态、项目名、五段阶段条、项目经理、开工日期、位置、写项目日志）、项目交底、外部日志复核入口（只给有权限的人）、标段进度、项目日志、财务摘要。
  - 项目交底：至少两项“项：内容”才拆成一行一项，否则整段显示，避免一段话都被算成第一个冒号的内容。没填时写明还没有填写。
  - 项目日志默认露 5 条，可展开。“写项目日志”只显示给能写的人，已归档的项目不显示。
  - 某一块取不到只影响那一块，提示下拉刷新；项目本身取不到才显示错误页和重试。
  - 视图逻辑在 `utils/project-view.js`，流程测试 `utils/project-pages.test.js`。
- 流程查询（仅超级管理员）：`packages/miniapp/packageTools/query-approval/index`，入口在综合查询（2026-11-06 新增）
  - 按审批单号或摘要搜索，按状态、业务类型、发起人筛选，上拉加载。进行中的单子显示当前节点和等谁处理，点一条进审批详情。
  - 其他角色看不到入口，直接打开也会被挡回去。接口 `GET /api/v1/approval/admin/all` 仍允许 `super_admin`、`manager`，网页审批监控台在用。
- 项目驾驶舱（管理人员）：`packages/miniapp/pages/manager-dashboard/index`
- 外部日志复核：`packages/miniapp/pages/external-log-review/index`
- 库房（Tab2）：`packages/miniapp/pages/warehouse/index`
- 我的库房任务：`packages/miniapp/pages/warehouse-task/index`
- 公司资产盘库：`packages/miniapp/pages/warehouse-stocktake/index`
- 审批与申请（Tab3）：`packages/miniapp/pages/finance/index`
- 我的（Tab4）：`packages/miniapp/pages/profile/index`
- 账号与配置：`packages/miniapp/pages/profile-settings/index`
- 登录恢复页：`packages/miniapp/pages/login/index`
- 强制更新（2026-07-14）：冷启动检测到新发布版本时弹出不可取消的「立即重启」弹框并完全重启到新版（`wx.getUpdateManager`），逻辑在 `packages/miniapp/utils/update.js`，`app.js` onLaunch 接入。
- 日志中心：`packages/miniapp/pages/log/index`
- 操作员日志：`packages/miniapp/pages/operator-log/index`
- 管理员日志：`packages/miniapp/pages/manager-log/index`
- 审批待办：`packages/miniapp/pages/approval/index`
- 我发起的申请：`packages/miniapp/pages/approval-initiated/index`
- 退回申请编辑与重新提交：`packages/miniapp/pages/returned-approval-edit/index`
- 发起对外付款（智能发单台）：`packages/miniapp/pages/payment-apply/index`
- 付款申请三步分段（金额识别→信息填写→确认提交，2026-07-08，与 Web 智能发单向导同构）：`packages/miniapp/pages/payment-apply/index`
- 合同选择摘要化 + 合同优先入口（2026-07-14，与 Web 同构）：合同选择器标签改为摘要 `对方单位｜合同类型｜剩余额度｜提交人`，默认只显示"自己经办且剩余>0"的合同、可「加载全部合同」、剩余≤0 不显示；第一步新增「💼 通过已有合同发起付款」按钮，选中合同后带入直付流程。同时修复附件「移除」对首个附件失效的问题：`packages/miniapp/pages/payment-apply/index`
- 员工加油申请：`packages/miniapp/pages/fuel-apply/index`
- 我的报销提交（列表）：`packages/miniapp/pages/reimbursement-list/index`
- 报销提交详情/新建：`packages/miniapp/pages/reimbursement/index`
- 查询中心（高权限入口）：`packages/miniapp/pages/query/index`
- 合同查询（高权限）：`packages/miniapp/pages/query-contract/index`
- 付款查询（高权限）：`packages/miniapp/pages/query-payment/index`
- 付款查询五阶段页签与退回件「去修改」入口（2026-07-08，仅发起人本人可见）：`packages/miniapp/pages/query-payment/index`
- 收款查询（高权限）：`packages/miniapp/pages/query-receipt/index`
- 合同详情（2026-11-06 改版）：`packages/miniapp/pages/query-contract-detail/index`。查询入口限高权限；从审批详情「查看合同」进入不限角色。
- 付款详情（2026-11-06 改版）：`packages/miniapp/pages/query-payment-detail/index`。查询入口限高权限；从审批详情「查看付款单」进入不限角色。
- 收款查询详情（高权限）：`packages/miniapp/pages/query-receipt-detail/index`
- 设备扫码：`packages/miniapp/pages/asset/index`
- 现场勘查：`packages/miniapp/pages/survey/index`
- 项目进度概览：`packages/miniapp/pages/progress/index`
- 通知消息：`packages/miniapp/pages/notice/index`

### 4.2 页面要求

- 工作台Tab：首页展示红黄绿状态、待审批/进度预警/施工中项目 KPI、常用动作、管理入口和全部应用；管理入口必须为有权限人员显示“外部日志待复核”集中入口并展示待处理数量，避免 AI 未通过外部日志只能从单项目详情发现；保留“看项目/进入项目列表”入口作为单项目详情深看路径。
- 项目驾驶舱（仅在工作台对 `super_admin/manager` 突出展示入口）：面向公司管理人员即时查看施工中项目进展，页面聚合施工中项目卡片、进度预警、最近施工日志与管理日志；项目卡片点击进入 `packages/miniapp/pages/project-detail/index` 只读详情。
- 库房Tab：重构为执行人员“库房执行台”，首页只突出我的任务、扫码查验、待执行单据、盘库执行；库存预警与制单申请降为辅助入口，不承载 Web 端的派工、审核、AI 调度等全功能管理动作。
- 我的库房任务：承接 Web 库房任务调度台派发后的移动执行，按待开始/执行中/退回分类展示 `mobile_enabled=1` 的个人任务；详情页支持开始任务、查看操作手册与步骤、填写结果简报、上传现场照片并提交证据。
- 出入库制单（miniapp）对齐 Web：支持多条目购物车（设备+耗材同单提审），不再限制单据仅单一设备类型。
- 出入库制单（miniapp）选型加速：支持“扫码匹配资产类型”与“关键字检索资产类型”双通道。
- 出入库制单（miniapp）模板加速：支持预制模板一键套用并继续逐项修改数量/删除后提交。
- 审批与申请Tab：采用与工作台一致的“Hero + KPI + 胶囊分段 + 任务/动作卡片”结构；通过分段器组织“待我审批/发起申请”，待审批区展示决策任务卡，发起申请区展示业务动作卡。
- 我的Tab：作为个人工作台，放置个人概览、常用动作、个人申请时间线、证书预警；账号、认证、API 地址、刷新资料和退出登录统一进入 `packages/miniapp/pages/profile-settings/index`。
- 账号与配置页：集中展示用户 ID、昵称、角色、认证方式、企微验证时间；支持本机 API 地址保存/恢复默认、刷新资料和退出登录。
- 日志中心：仅负责日志角色入口分流（操作员/管理员）。
- 操作员日志页：支持 AI 预填 + 提交，班次使用中文选择（白班/夜班），内部存储保持 day/night；页面布局按“施工上下文 / 本班核心数据 / 现场补充 / 提交动作”分段，突出本班下管、累计下管、当日顶进、累计顶进等核心数字，并在现场补充区填写刀盘电流/频率、泥仓压力、顶力、水平/高程偏差、天气、问题和备注；项目选择仅允许非归档项目。
- 管理员日志页：支持拍照上传 + 结构化提交；页面布局按“日志上下文 / 现场概况 / 现场照片 / 提交动作”分段，照片状态必须在独立证据区显示；项目选择仅允许非归档项目。
- 审批页：移动端单手可完成通过/拒绝/退回/转签，危险动作前需确认弹窗。
- 报销页：支持个人报销草稿创建/编辑、绑定 UUID、附件上传（实物/电子）、提交与 OCR 状态追踪。
- 查询中心（仅 `super_admin/finance/manager`）：
  - 工作台新增“查询”入口，进入后以卡片展示“合同查询/付款查询/收款查询”。
  - 三个查询页统一支持：申请人、时间范围、项目名称筛选。
  - 列表统一分页口径：每页 10 条，上一页/下一页切换。
  - 列表条目支持点击进入详情页；详情页以只读卡片形式展示关键字段。
  - 申请人显示规则统一为“仅姓名”，若姓名缺失显示 `-`。
  - 付款查询列表需展示“所属项目名称”，避免仅凭项目ID识别。
  - 合同详情与审批详情同一版式和阅读顺序（凭证头部含执行进度 → AI 审查 → 合同明细 → 关联付款或收款记录 → 金额变更 → 附件 → 审批流程），只读；页面公共逻辑在 `utils/detail-page-common.js`。付款详情对查询角色提供「查看合同」。
  - 付款详情与审批详情同一版式和阅读顺序（凭证头部 → AI 审查 → 付款明细 → 付款执行 → 附件 → 审批流程），共用 `styles/detail-cards.wxss` 与 `templates/detail-cards.wxml`；可跳转到审批详情（参与人才有入口），只读。
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
  - `hy-project-picker` 支持 `excludeArchived` 参数；日志填写页必须启用该参数，避免向归档项目继续写入新日志。
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
  - 欢迎区 + 红黄绿状态条 + KPI + 常用动作 + 管理入口 + 全部应用；首页不直接承载项目长列表。
- 项目驾驶舱新增：`packages/miniapp/pages/manager-dashboard/index.{js,wxml,wxss,json}`
  - 使用 `/api/v1/project?status=active`、`/api/v1/log/dashboard`、`/api/v1/log/progress-alert`、`/api/v1/log/operator`、`/api/v1/log/manager` 聚合进行中项目、进度、预警和日志。
- 库房页重构：`packages/miniapp/pages/warehouse/index.{js,wxml,wxss}`
  - 库房 KPI（仓库数、待处理制单、库存预警、库存条目）与库房业务入口聚合。
  - 新增 `packages/miniapp/pages/{warehouse-stock-order,warehouse-inventory,warehouse-dispatch}/index.*` 承接制单、库存、调度。
  - `warehouse-stock-order` 采用“检索库 + 购物车清单”结构，支持扫码加入、关键字筛选、模板套用、统一提审。
- 审批与申请页重构：`packages/miniapp/pages/finance/index.{js,wxml,wxss}`
  - Hero 摘要、待审批/申请入口 KPI、胶囊式“待我审批/发起申请”分段。
  - 待我审批分段使用决策任务卡展示单号、摘要、类型、节点、状态、提交时间，点击进入审批详情。
  - 发起申请分段使用两列动作卡展示智能发单台、我的报销提交、信封扫码核查、油卡额度申请、我发起的申请；无权限动作显示禁用态。
- 我的页重构：`packages/miniapp/pages/profile/index.{js,wxml,wxss}`
  - 个人概览、关键数字、常用动作、个人申请时间线、证书预警卡；不再展示配置类明细。
  - 个人证书卡新增附件入口：支持“查看/下载”证书文件（无附件时显示占位并给出提示）。
- 账号与配置页新增：`packages/miniapp/pages/profile-settings/index.{js,wxml,wxss,json}`
  - 集中承载用户身份、认证状态、API 地址联调配置、刷新资料和退出登录。
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
- `packages/miniapp/packageFinance/reimbursement/index.{js,wxml,wxss}`（2026-11-07 改版，路由不变）：只面向申请人。从上到下：结论和该做什么（接口的 `guidance.applicant`）；文件列表（名称、状态或金额，失败的可重试，点开看销售方、发票号、日期、系统读到的内容和原件；可编辑时能删）；上传（图片一次最多 9 张，聊天记录和手机文件最多 30 个，只收 PDF、JPG、PNG，单个 20MB，同时传 2 个）；合计和报销金额（默认等于已识别合计，改过不再覆盖）；表单（通道、信封识别号、项目、类别、说明、费用日期）；底部提交或重新提交。去掉了五个状态标签、固定的「建议流程」提示、发票号输入、附件类型选择和替换或另建弹窗。逻辑在 `utils/upload-queue.js`、`utils/reimbursement-view.js`。
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
- 操作员日志 `packages/miniapp/pages/operator-log/index.wxml`：`hy-project-picker`、标段选择、日期选择、班次中文选择、核心数字卡片、设备参数/偏差补充区、`t-button`，强化“确认上下文-填写核心数字-补充异常-提交”。
- 管理员日志 `packages/miniapp/pages/manager-log/index.wxml`：`hy-project-picker`、日期选择、标题/内容填写、照片证据状态卡、`t-button`。
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
- 个人中心 `packages/miniapp/pages/profile/index.wxml`：`hy-panel-card`、`t-empty`、`t-button`，承载个人高频动作、申请动态和证书卡片。
- 账号与配置 `packages/miniapp/pages/profile-settings/index.wxml`：`hy-panel-card`、`t-button`，承载账号信息、认证信息、API 地址配置、刷新资料和安全退出。

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
- 项目驾驶舱（管理总览）：`packages/miniapp/pages/manager-dashboard/index`
- 项目列表（独立长列表页）：`packages/miniapp/pages/project-list/index`
- 项目详情（新增）：`packages/miniapp/pages/project-detail/index`
- 外部日志复核（新增）：`packages/miniapp/pages/external-log-review/index`
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
- 工作台首页边界：`pages/index/index` 不直接承载项目长列表，仅提供“看项目/进入项目列表”入口和管理人员“项目驾驶舱”入口，避免首页过长影响首屏操作效率。
- 项目驾驶舱边界：`pages/manager-dashboard/index` 只做公司管理视角的跨项目总览、预警与最近日志聚合；最近日志必须展示“项目-标段/项目级”上下文，避免只看日期无法判断日志归属；单项目工作段、项目日志、财务摘要等深看能力继续由 `pages/project-list/index` -> `pages/project-detail/index` 承载。
- 外部日志复核边界：`pages/project-detail/index` 仅对 `super_admin` 或项目负责人管理角色展示待复核入口；`pages/external-log-review/index` 复用 Web 端 `/api/v1/project/:id/external-log-submissions` 与 `/review` 接口，只处理 `needs_manual_review` 外部日志，支持放行写入正式日志或驳回。
- 工作台与库房边界：项目/现场相关能力留在工作台与项目页，`pages/warehouse/index` 仅承载库房与资产管理能力。
- 施工日志填写交互：`pages/operator-log/index` 使用“项目 -> 标段选择器”模式，禁止手输标段ID；字段口径与 Web/外部扫码端一致，支持累计顶进、刀盘电流/频率、泥仓压力、顶力、水平偏差、高程偏差等现场参数。
- 班次判定交互：默认按填写时间自动判定（晚间偏白班收尾、早间偏夜班收尾），仍允许手动改班次并提供一键重判。
- 下管数量交互：允许填写“本班下管数”或“累计下管数”任一项，前端自动联动推算另一项，并展示历史累计提示。

#### 4.4.3 范围锁定（本期禁止变更）

- 财务模块入口与行为保持不变：`packages/miniapp/pages/finance/index`
- 库房模块入口调整为“库房执行台”并对齐 Web 移动执行契约：`packages/miniapp/pages/{warehouse,warehouse-task,warehouse-stock-order,warehouse-inventory,warehouse-dispatch}/index`
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

### 3.26 智能发单台合同远程搜索（2026-08）

- 背景：发单台此前一次性只拉最新 200 条 outbound 合同、输入框仅做已加载选项的本地过滤，生产合同量超过 200 后存量/较早合同（如 CP25056）永远搜不到；「加载全部合同」也只是前端过滤开关。
- Web 端改造：`packages/web/src/views/finance/payment/wizard.vue`
  - 初始只拉「本人经办」合同全集（`applicant_userid`），默认视图不再受最新 200 条截断影响；
  - 三处合同下拉启用 el-select `remote` 远程搜索：输入 300ms 防抖调 `GET /api/v1/contract?direction=outbound&keyword=...`（合同号/对方单位/备注模糊），搜索态不限经办人；
  - 「加载全部合同」改为真实拉取全量视图（最新 200 条）并与合同池按 id 去重合并；
  - 已选合同不在当前视图时置顶保留，避免 remote 模式选项替换后选中项标签丢失；下拉关闭自动退出搜索态回落默认视图。
- 小程序端同构：`packages/miniapp/packageFinance/payment-apply/index.js` + `index.wxml`
  - `hy-search-picker` 组件新增 `remote`/`remoteLoading` 属性与 `search` 事件（输入防抖 300ms 抛关键词；远程态跳过本地拼音过滤，避免服务端按备注命中的结果被本地二次滤掉；`range`/`value`/`change` 下标语义不变，存量非远程用法零影响）：`packages/miniapp/components/business/search-picker/`
  - 页面三处合同选择器开启远程模式，统一 `rebuildContractView` 重建视图与选中下标（选中项置顶保留）；「加载全部合同」首次点击真实拉取合并；选完/清词/重开弹层自动恢复默认视图。
- 服务端零改动（keyword/applicant_userid 过滤原已支持）。配套数据修复见迁移 `0086`（存量合同经办人中文名→企微 userid，恢复「只看我的合同」对存量合同的命中）。

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

> 布局部分（分色分区、dot + key/value、40/40/20 底栏）已被 §4.37（2026-11）取代，以 §4.37 为准；退回后「编辑并重新提交」的规则不变。

- 审批详情页面按信息域分色分区（摘要/业务明细/附件/AI结果/流程/操作意见），并增加板块分界线，降低视觉疲劳：`packages/miniapp/pages/approval-detail/index.wxml`、`packages/miniapp/pages/approval-detail/index.wxss`
- 信息点改为 dot + key/value 结构，并对关键值使用 tag（如业务类型、状态、AI结论）做颜色提示：`packages/miniapp/pages/approval-detail/index.wxml`
- 底部补齐固定操作栏，提供清晰、持续可见的审批动作按钮，避免长页滚动后找不到操作入口：`packages/miniapp/pages/approval-detail/index.wxml`、`packages/miniapp/pages/approval-detail/index.wxss`
- 审批流程默认折叠，支持一键展开/收起节点，降低初始阅读负担：`packages/miniapp/pages/approval-detail/index.wxml`、`packages/miniapp/pages/approval-detail/index.js`
- 操作按钮显示增加兜底策略（当接口未回传 `available_actions` 时按待办任务推断），避免底部操作区缺失：`packages/miniapp/pages/approval-detail/index.js`
- 底部操作布局优化为单排 40/40/20（通过/退回/更多），其余动作收纳到“更多”弹层，减少主操作区噪音：`packages/miniapp/pages/approval-detail/index.wxml`、`packages/miniapp/pages/approval-detail/index.js`、`packages/miniapp/pages/approval-detail/index.wxss`
- 退回发起人后，发起人在审批详情页可见“编辑并重新提交”固定操作，跳转统一退回编辑页；该入口不受只读详情模式影响，用于从“我发起的申请”列表进入后完成移动端闭环：`packages/miniapp/pages/approval-detail/index.{js,wxml,wxss}`、`packages/miniapp/utils/returned-approval.js`
- 退回申请编辑页按 `biz_type` 加载对应业务单，支持付款、报销批次、库房出入库单、库房工单、收/付款合同和开票申请的业务字段修正，保存后调用各业务 `submit-approval` 接口重新启动同一审批实例的新轮次：`packages/miniapp/pages/returned-approval-edit/index.{js,wxml,wxss,json}`

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

### 4.37 小程序审批详情改版（2026-11）

`packages/miniapp/pages/approval-detail/`。思路与 Web §I 相同（先看清这笔钱再做决定），按手机竖屏重排。页面只负责调接口和 `setData`；规则和文案在 `utils/approval-decision.js`（动作、校验、支付方案、下一条待办）、`utils/approval-detail-view.js`（各业务统一成「头部 + 明细行」、AI 区、流程）、`utils/amount-cn.js`（金额）。页面仍在主包：路由 `pages/approval-detail/index` 写在企微推送模板（`wecom-approval-push.ts`）和已发出的卡片里，不能移到分包。

- **从上到下**：头部 → AI 审查 → 明细 → 支付方案（仅可审批时）→ 附件 → 审批流程，底部固定决策栏。
- **头部**：金额小写在上（60rpx）、大写在下，大写按金额现算，不读 `amount_cn`；状态标签与金额同行。其下是事由、驳回/退回原因、关键事实（收款方或主体、项目、发起人、时间），最后一行是「等待 XX」和业务编号。库房、开票等没有业务详情的单据不显示金额，事由取审批摘要。
- **AI 审查**：标签显示判定（审查中、审查失败单独文案），下面一句话结论。`evidence_coverage.complete === false` 时橙色告警排在结论**之前**，逐条列未读内容（如「未读第 4-6 页」）；读完时一行灰字带过；字段缺失不显示。`findings` 非 pass 项逐条列出（异常排在关注前），pass 项折叠为「另有 N 项未见异常」。旧数据没有 `findings` 时回退显示 `comment`。风控/合同/审计报告和此前轮次结论都折叠；没有关卡结论时报告默认展开；什么都没有时显示「这笔审批没有经过 AI 审查，请人工核对」。判定前缀是跨端契约，`aiDecisionFromComment` 只搬了位置，逻辑未改。
- **明细**：统一键值行，长文本保留换行，可长按复制。备注里的 `[超管修改 …]` 行拆出来，折叠成「支付信息修改记录（N 条）」。报销单据列在明细内，附件跟着单据走，不再单列一份。
- **支付方案**：默认一行摘要，点「修改」展开选择器。**只有改动过才提交**（基线取同步后的选择器值，改回原值不算改动），否则超管每次审批都会往备注写一条修改日志。换主体时默认带上该主体第一个账户，避免新主体配旧账户。选项新增「转账」（`personal_transfer`），与 Web 一致。
- **底部决策栏**：一个意见框 + 更多/退回/驳回/通过。通过意见可空（记为「同意」）；驳回、退回未写原因时就地报错并聚焦输入框；驳回、撤回、取消/终止二次确认。输入框聚焦时展开并显示快捷意见。键盘处理：`adjust-position=false` + `fixed`，用 `bindfocus`、`bindkeyboardheightchange` 的高度把栏顶到键盘上方。
- **更多**：转办（改用 `hy-search-picker` 可搜索列表，原 `wx.showActionSheet` 按微信文档最多 6 项，放不下通讯录）、撤回、取消审批（超管显示「终止流程」）。
- **只读视图**：审批动作全关。从「我发起的」（`from=initiated`）进入时保留撤回、取消（小程序此前没有这两个入口）；从付款查询进入什么都不能做。
- **动作后流转**：通过/驳回/退回/转办后打开下一条待办（`redirectTo`，返回仍回列表）；列表确认为空才提示「待办已处理完」并回列表；待办取不到时不下这个结论。撤回、取消留在本页刷新。服务端报错原文提示。
- **与 Web 的差异**：退回只退回发起人（Web 可选上一步/指定节点）；未选支付方案不拦通过（Web 拦）；没有付款主体与发票抬头不一致的确认；不支持审批台上传附件；开票、收款退款、库房单仍无业务明细。
- **验证**：电脑模拟器登录不通，只能真机。`utils/approval-detail-page.test.js` 用真实页面代码跑通主要流程，界面和键盘要真机确认。

### 4.38 小程序库房（2026-11 重做，阶段 3）

设计稿第 13 节，计划 `docs/superpowers/plans/2026-11-12-warehouse-phase3-miniapp-notify.md`。主包只留库房 tab 页，其余 9 个页面在分包 `packageWarehouse`。页面只负责取数和 `setData`；规则和文案在视图模块里（主包 `utils/wh-home-view.js`、`utils/wh-scan.js`，分包 `packageWarehouse/common/wh-*-view.js`），都配了 node 测试。**页面路径写进了企微卡片，不能改名。**

| 路径 | 参数 | 做什么 |
|---|---|---|
| `pages/warehouse/index` | 无 | 库房 tab 页，按身份显示 |
| `packageWarehouse/device/index` | `id` | 设备卡片 |
| `packageWarehouse/task-list/index` | `tab=mine\|confirm\|unassigned\|all` | 任务列表 |
| `packageWarehouse/task-detail/index` | `id` | 任务详情 |
| `packageWarehouse/task-new/index` | `deviceId`（可选） | 新建任务 |
| `packageWarehouse/kit-list/index` | `status`、`projectId`、`create=1`（都可选） | 清单列表、新建清单 |
| `packageWarehouse/kit/index` | `id` | 清单详情 |
| `packageWarehouse/ship/index` | `type=out\|back\|transfer\|in`，可选 `projectId`、`kitId`、`deviceId` | 发货、返库、转场、入库 |
| `packageWarehouse/project/index` | `projectId` | 项目在场 |
| `packageWarehouse/material/index` | `low=1`（可选） | 库存 |
| `packageWarehouse/docs/index` | `deviceId`、`code`（都可选） | 设备资料列表（阶段 4A） |
| `packageWarehouse/doc-view/index` | `id` | 看一份资料（阶段 4A） |
| `packageWarehouse/doc-upload/index` | `deviceId`（可选） | 上传资料（阶段 4A） |
| `packageWarehouse/stocktake/index` | `id`（可选） | 盘点（阶段 5） |

- **库房 tab 页**：所有人有「扫一扫设备」、设备搜索框（输入后停 300ms 查，结果列在下面）、我的任务（最多 3 条，点「N 个待办」进列表）。项目负责人另有「我的项目」（在场设备台数、周转件种数、未确认清单数），点开进项目在场页。库管另有五个数字（待确认清单、待确认任务、待派工、超期任务、低库存，是 0 也显示，都能点）和七个动作（按清单发货、直接发货、项目返库、转场、入库、查库存、全部任务）。一次请求 `GET /warehouse/home` 取全部内容；失败时保留原内容并提示。
- **扫码**：只认 `HYBC:D:<设备编号>`，其他内容提示「不是设备码」；查不到提示「没有这台设备：<编号>」；取消不提示。
- **设备卡片**：编号、状态、位置、类别规格；未完成的任务（阻塞的标红）；使用记录和累计顶进米数；时间线（默认 10 条，可展开）。库管的按钮：在项目的设备有「返库」，可用的设备有「发货」，另有「建任务」「记事」。返库是底部面板，顶进距离和土质选填，确认后生成检查任务，即设计稿的「扫码，点返库，确认」三步。
- **任务列表**：库管四个页签（我的、待确认、待派工、全部），其他人只有「我的」。每页 20 条，触底加载；从详情回来刷新第一页。
- **任务详情**：独立页面。设备编号、名称、位置（点开进设备页）、执行人、期限、任务说明、退回要求（第几次退回）、照片缩略图。执行人：一次最多选 9 张，逐张上传，哪张失败停在哪张，已传的保留；只能删自己传的；提交区按任务类型显示「合格/不合格」或「涉及系统」，简报必填；照片不够、没选结果时就地提示。库管：执行人一栏变成可搜索的派工选择；底部「取消任务」「退回补充」「确认完成」，退回和取消必须写原因，取消阻塞任务先提示设备会被放开。
- **新建任务**：类型、标题、说明、设备（从设备页进来时锁定；否则可搜可扫）、执行人、期限、照片要求。建好直接进新任务的详情。
- **清单列表**：状态页签；有建清单权限的人底部有「新建清单」，面板里选项目、选模板（或空白）、填标题。没确认过就关闭的清单显示「已作废」。
- **清单详情**：行按分节折叠，默认全部收起（一份清单约 200 行）。能改时每行可改计划数、来源，「待选规格」的物资行可选规格；不加行、不删行、不改品名（在 Web 上做），这个工程用不上的行把数量填 0。提交前有没选规格的行就提示「有 N 行要先处理」并展开那几个分节；提交和确认前有改动先保存。保存时数量填错的行（如 `5.`）会被拦下并标出，不会被当成 0 存下。已确认的清单行上显示已发、待发；库管有「关闭清单」「按清单发货」。有没保存的改动时从别的页面回来不重新加载。
- **发货、返库、转场、入库**（同一个页面，按 `type` 区分）：按清单发货时物资按「还没发的数量」带出、同一物资的几行合并、设备按类别提示还需几台；返库和转场选了项目后按在场清单整单带出（返库默认全部退回、报损 0）。「扫码加设备」可连续扫；重复的、状态不对的、不是设备码的弹窗停住（扫码界面盖着页面，提示一闪就没了），点「继续扫」才接着扫，断网等其他错误直接停下。项目选择器在这个页面上不会自己选第一个项目（`autoSelect` 关掉），必须人选。返库时设备可顺手填顶进距离和土质，周转件分「退回」「丢失损坏」两栏，两者之和不能超过在场数；返库还能另加要退回的耗材。入库可填供应商、拍送货单。提交用页面打开时生成的请求号，失败重试是同一张单；成功后提示单号并返回上一页。提交超时其实已经成功、之后又改了内容再提交时，后端回的是原来那张单，页面会弹窗说明「有改动没记上」。
- **项目在场**：在场设备、在场周转件（已发、已退、报损）、这个项目的清单、最近 10 张库房单（被冲销的划掉）。库管底部有「转场」「发货」「项目返库」（已结清时没有返库和转场）；能给这个项目建清单的人在清单一段下面有「新建清单」。项目物资和库房单各取各的，一个失败不影响另一个。
- **库存**：品名规格搜索、只看低库存开关、每页 30 条。只读。
- **企微卡片**（设计稿第 10 节）：清单待确认 → 全体库管；清单已确认 → 提交人；派工 → 执行人（一张返库单生成多个任务时每人只收一张「N 个待办」）；退回补充 → 执行人；任务待确认 → 全体库管；检查不合格已生成维修任务 → 全体库管；发货、返库、转场及其冲销 → 项目负责人。不通知操作人自己；「全体库管」只算库管名单里的人。点卡片进上表对应的页面。
- **留在 Web 上的**：设备和物资主数据的新建和导入、模板维护、清单加行删行、冲销、报废、库房设置。
- **设备资料**（阶段 4A，计划 `docs/superpowers/plans/2026-11-12-warehouse-phase4a-doc-library.md`）：
  - 入口：库房 tab 页搜索框下面的「设备资料」（所有人）；设备卡片的「资料」一行（旁边是份数）；任务详情的「适用资料」（最多 5 条，点「全部」进这台设备的资料页；任务没有设备或设备没有资料时不显示）。
  - **资料列表** `docs/index`：不带参数是全库，有搜索框（停 300ms 查）、资料类别筛选、每页 20 条触底加载；带 `deviceId` 是这台设备适用的资料，分「这台设备」「这类设备」「通用」三段。快到期的写「30 天内到期」，过期的标红。资料管理员底部有「上传资料」，传完回来列表自己刷新。
  - **查看** `doc-view/index`：标题、文件名和大小、资料类别、归属、有效期、上传人和日期、历史版本（点开看旧版）。「打开」按文件类型：图片预览；`mp4`、`mov` 在页面里放；`pdf`、Word、Excel、PPT 下载后用系统查看器打开（超过 50 MB 先问一句）；压缩包、图纸、HEIC、txt 等写明「请在电脑上用网页版打开」。同一份文档再点「打开」不重新下载。系统查看器打不开（企微电脑端）时弹窗说明去哪儿看。
  - **上传** `doc-upload/index`（只有库管和资料管理员能进）：「从聊天记录选」一个文件，或「拍照或相册」一张图；类型不支持、超过手机上限（默认 200 MB）当场弹窗说明，不算选上。标题默认文件名（照片要自己填）、资料类别按文件名猜、归属（从设备页进来定死那台设备，否则某台设备可搜、某类设备、通用）、有效期（合格证和检测报告）。文件一片 8 MB 读着传，显示百分比；上传中离开页面会先问；失败后表单留着，再点「上传」——分片都传完、只是最后一步没成的话不重传。
  - 改、删、替换、对外链接、按文件夹导入只在 Web 上做。
- **盘点**（阶段 5，计划 `docs/superpowers/plans/2026-11-12-warehouse-phase5-stocktake-digest.md`）`stocktake/index`：
  - 入口：库房 tab 页「库房动作」里的「盘点」（只有库管有）。不带参数打开是进行中的那一次；带 `id` 是看那一次（可以是已完成的，只读）。
  - 没有进行中的盘点时：库管看到三个发起选项（物资和设备都盘、只盘物资、只盘设备），点了先确认再发起；别人看到「现在没有进行中的盘点」。
  - 盘点中：顶上是单号、范围、状态；范围是全部时有「物资 已盘/总数」「设备 找到/应在库」两个页签。不是库管的人能看、不能改，顶上有一条说明。
  - 物资：搜索框（品名、规格、编号，本地筛）、「全部、没盘、有差额」；一次最多出 60 行，多了提示输关键字找。每行右边是实盘数（没盘的写「没盘」）和账面数、差额。点一行弹出录数层：品名、账面数（盘过的行写的是录的时候记下的数）、实盘数（数字键盘）、备注；「保存」存下实盘数并记下那一刻的账面数，盘过的行有「清掉」。盘过的行实盘数没改时点保存只存备注，不重记账面数。
  - 设备：「连续扫码」扫到一台标记一台，直到取消；不是设备码、查不到的码、账上不在库的设备会弹窗停住，点「继续扫」才接着扫；断网、相机打不开直接停下。「输编号」是码坏了时用的。点一台可以标记找到、没找到（可写备注）、清掉标记。账上在项目的设备小标签写「账上在项目」，下面一行写项目名和「记得补返库单」。
  - 底部（库管、盘点中）：「取消盘点」（可写原因）和「完成盘点」。完成前重新取一次，确认框里逐条写明会发生什么（和 Web 一样的句子）；完成后弹出调整单号，页面变只读。和别人的录入撞上时提示并重新取。
- **每日摘要卡片**（阶段 5）：每天北京时间 8 点发给全体库管一张「库房每日摘要」，只列有内容的项：低库存、超期任务、待检超过 3 天的设备、证书（快到期和已过期分开写）。四项都没有就不发。点开进库房 tab 页。受通知总开关管。
- **验证**：页面流程测试在 `packageWarehouse/common/*-page.test.js`（真实页面代码，只替换接口、上传、扫码和 `wx`），`npm run test:wh` 一次全跑；`wh-wxml.test.js` 静态核对 WXML 标签成对、事件处理函数存在。版式只用静态预览核对过（真实 WXML/WXSS 加假数据），`t-button`、选择器、键盘、弹窗输入框要真机确认，清单见 2026-11-12 的开发记录。

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
- 付款单和报销批次的头部显示**付款单位**，付款单明细显示**付款账户**，对所有查看者可见，没选时显示「尚未指定」（2026-11-06 补，此前只在决策表单里，只有能审批的人看得到）。

### 8.1 页面与路由映射

- 公司实体管理（增强版）：`/admin/system-base/entity` → `packages/web/src/views/entity/index.vue`
- 财务中心实体资料管理：`/finance/entity/profile` → `packages/web/src/views/entity/index.vue`
- 油卡额度申请（员工入口）：`/finance/fleet/application` → `packages/web/src/views/finance/fleet/application.vue`
  - 2026-10 起油卡跟车走：先选车（可搜索，显示车牌 · 车型，无卡车辆标"未配卡"），油卡下拉只列该车名下的启用卡（卡号 + 余额），只有一张时自动选中；所选车辆未配卡时提示"该车辆尚未配置油卡，请联系办公室"并禁用提交。任何员工可为任何启用车辆申请，不再要求本人绑卡。
- 油卡处理工作台：`/finance/fleet/processing` → `packages/web/src/views/finance/fleet/processing-workbench.vue`
  - 财务/办公室使用，按待处理、待补充、已通过、已拒绝队列处理油卡申请；详情侧栏展示风险摘要、规则命中、车辆与油卡信息，并支持通过、退回补充、拒绝。
- 油卡申请全量记录：`/finance/fleet/applications-all` → `packages/web/src/views/finance/fleet/applications-list.vue`
  - 管理视角查看全量油卡申请；超级管理员仅可废除待处理或待补充申请，避免已处理余额流水状态被破坏。
- 车辆油卡档案：`/finance/fleet/vehicles` → `packages/web/src/views/finance/fleet/vehicles.vue`
  - 车辆档案支持按状态筛选（全部/启用中/已停用），可查看停用车辆。
  - 车辆档案操作支持“编辑”与“启用/停用”双向切换；编辑弹窗支持修改车牌号、车型、归属、所属实体、权属人、状态。
  - 车辆档案新增“油卡”列，显示该车当前挂着的卡号，无卡显示“未配卡”。
  - 油卡管理（2026-10 起）：下线“绑定员工”；新增“所属车辆”列与“绑定车辆 / 转移 / 解绑”操作。一张卡同一时刻只挂一辆车，卡已在别的车上时转移前二次确认；“查看记录”弹窗在余额流水下方展示车辆绑定记录（车牌、状态、绑定/解绑时间与操作人）。
- 用油健康总览：`/finance/fleet/dashboard` → `packages/web/src/views/finance/fleet/dashboard.vue`
  - 该总览固定按全公司口径统计，不提供“公司实体”筛选控件，避免统计范围误解与空数据误判。
- 规则与审计中心：`/finance/fleet/rules-audit` → `packages/web/src/views/finance/fleet/rules-audit.vue`
  - 超级管理员维护油卡规则、查看企微通知记录和操作审计。

### 8.2 API 指向

- 公司实体增强：`/api/v1/entity`、`/api/v1/entity/:id/attachments`、`/api/v1/entity/:id/storage-summary`
- 车辆与油卡：`/api/v1/fleet/vehicles`、`/api/v1/fleet/fuel-cards`、`/api/v1/fleet/fuel-applications`
- 油卡与车辆绑定：`/api/v1/fleet/fuel-cards?vehicle_id=`（返回当前所属车辆 `vehicle_id` / `vehicle_plate_no`）、`/api/v1/fleet/vehicles`（返回 `fuel_card_count` / `fuel_card_nos`）、`POST /api/v1/fleet/fuel-cards/:id/bind-vehicle`（绑定或转移）、`POST /api/v1/fleet/fuel-cards/:id/unbind-vehicle`、`GET /api/v1/fleet/fuel-cards/:id/vehicle-bindings`（绑定历史）；原 `bind-user` 已下线
- 余额变动记录：`/api/v1/fleet/fuel-cards/:id/balance-logs`（仅超管/经理/财务）
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
- 独立页面付款审批条目需在摘要中展示业务事项明细：审批列表接口返回 `biz_detail`，小程序列表对所有 `payment_request` 摘要补充付款单号与付款事由，避免从外层无法辨认具体付款内容：`packages/api/src/routes/approval.ts`、`packages/miniapp/pages/approval-initiated/index.{js,wxml,wxss}`
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

### 8.17 上传 URL API 域名修正（2026-06）

- Web 端所有仍直接使用签名返回 `uploadUrl` 的上传入口统一通过 `resolveUploadUrl()` 解析到 API 域名，避免相对路径在 `web.hybcdg.com` 下发起 PUT 导致 405：`packages/web/src/views/project/workspace/project-panel.vue`、`packages/web/src/views/project/workspace/file-panel.vue`、`packages/web/src/components/PhaseUpload/index.vue`、`packages/web/src/layout/components/lay-support/index.vue`

### 8.18 工作段趋势与预测（2026-06）

- 项目工作台的工作段抽屉新增“趋势与预测”区：展示剩余里程、历史日均、近三日日均、预计剩余天数，并以“进度/设备/偏差”三组折线图展示累计顶进、本班顶进、下管数、泥仓压力、刀盘频率、刀盘电流、水平/垂直偏差趋势；最近日志关键指标同步以表格展示：`packages/web/src/views/project/workspace/project-panel.vue`
- 外部日志查看页的“查看工作段日志”入口同步新增“趋势与预测”区，外包人员通过公开链接也可查看同一工作段最近 20 条日志的剩余里程、速度估算、预计剩余天数、趋势折线图与最近指标表：`packages/web/src/views/public/project-log.vue`
- 小程序工作段详情页新增同口径“趋势与预测”区：展示剩余里程、历史日均、近三日日均、预计剩余天数，并通过本地 uCharts canvas 组件按“进度 / 设备 / 偏差”三组切换展示累计顶进、本班顶进、下管数、泥仓压力、刀盘频率、刀盘电流、水平/高程偏差；最近日志关键指标以横向滚动表补充：`packages/miniapp/pages/project-section/index.{js,wxml,wxss,json}`、`packages/miniapp/components/qiun-wx-ucharts/*`
- 新增前端纯计算工具，按施工日志和工作段长度直接计算剩余米数、进度百分比、日均速度、近三日速度、预计剩余天数与偏差正负值：`packages/web/src/utils/project-section-progress.ts`
- 新增小程序端同口径纯计算工具与测试，供工作段详情页复用：`packages/miniapp/utils/project-section-progress.js`、`packages/miniapp/utils/project-section-progress.test.js`

### 8.19 车辆保养记录（2026-06）

- 新增独立顶层菜单"车辆保养"（全角色可见），Web 页面采用"标题与新增动作 + 筛选栏 + 列表表格 + 详情抽屉 + 新增/编辑对话框"结构：筛选支持车辆、保养类型、状态与保养日期区间；列表展示保养单号、车辆、类型、里程、费用、保养时间、登记人、状态；管理层额外显示编辑/作废动作，operator 仅见本人记录且无编辑/作废：`packages/web/src/views/vehicle-maintenance/index.vue`、`packages/web/src/router/modules/vehicle-maintenance.ts`、`packages/web/src/api/vehicle-maintenance.ts`
- 新增/编辑对话框字段：车辆、保养类型（拉字典 `vehicle_maintenance_type`）、保养内容、里程、保养人、费用、保养时间、备注、附件（直传 R2，可移除）；详情抽屉以描述列表展示完整信息并提供附件下载。
- 小程序新增"车辆保养记录"页面：选车辆、选保养类型、填里程/内容/保养人/费用/保养日期、上传附件，并在下方展示"我的保养记录"；从财务页入口卡片进入：`packages/miniapp/pages/vehicle-maintenance/index.{js,wxml,wxss,json}`、`packages/miniapp/pages/finance/index.js`
- 后端路由 `/api/v1/fleet/maintenance`（列表/详情/新增/编辑/作废），数据落表 `vehicle_maintenance_record`，挂钩 `company_vehicle`，软删除并保留作废人/时间/原因：`packages/api/src/routes/vehicle-maintenance.ts`

### 8.20 报销通道切换入口与编辑态通道锁定（2026-07-12）

- 报销详情「通道」栏新增办公室「切换通道」按钮（仅 `super_admin`/`finance`，状态 `draft/unregistered/submitted` 可见）：点击弹出确认框并可填写切换原因（选填，后端 trim 后截断 500 字符）；成功提示区分“实际切换 / 已是目标通道无需切换 / 补触发 AI 核验（自愈）”三种语义：`packages/web/src/views/finance/reimbursement/detail.vue`、`packages/web/src/api/reimbursement.ts`
- 编辑态通道下拉始终禁用（仅创建态可选），修复此前“看似可改、保存必被后端 400”的陷阱；不可切换时显示「通道创建后不可修改」灰色提示：`packages/web/src/views/finance/reimbursement/detail.vue`
- 新增后端切换通道接口 `POST /api/v1/reimbursement/:id/switch-channel`（乐观锁 UPDATE 防并发漂移；切换成功且有活跃附件时自动补触发 AI 核验；同通道重复请求幂等返回 `changed: false` 并带自愈补偿）：`packages/api/src/routes/reimbursement.ts`、`packages/api/src/routes/reimbursement-channel-switch-policy.ts`

### 8.21 智能发单台提交后重置与合同创建幂等（2026-09-28）

- 智能发单台提交成功后：清空直付/合同/首笔预付款三张表单、附件与金额，关闭首笔开关并轮换 run id，然后 `router.replace` 到「我的申请」（工作台路由 `/workspace/my-applications`）或付款列表（`/finance/payment`），不再 `router.back()` 或 push 自身路由：`packages/web/src/views/finance/payment/wizard.vue`
- 一轮发单共用一个 run id，合同创建 / 合同送审 / 付款创建 / 付款送审的 `Idempotency-Key` 均由「scope + run id + 步骤内容指纹」派生，失败重试同 key、改内容换 key：`packages/web/src/views/finance/payment/wizard-submit-keys.ts`、`packages/web/src/api/contract.ts`
- 后端 `POST /api/v1/contract` 支持 `Idempotency-Key`，缺省按内容指纹在 5 分钟窗内自动去重，与付款申请创建一致：`packages/api/src/routes/contract.ts`

### 8.22 小程序「我的车辆记录」（2026-11-08）

- 新增分包页「我的车辆记录」：顶部切换「油卡申请 / 保养记录」，各自按状态筛选、触底分页（每页 20 条）、下拉刷新，右上「新的油卡申请 / 新的保养记录」跳对应提交页；只看本人提交的（请求带 `mine=true`）：`packages/miniapp/packageFinance/vehicle-records/index.{js,wxml,wxss,json}`
  - 油卡卡片：单号、状态、申请额度、车牌 ｜ 里程、申请时间；待补充时带出补充原因。
  - 保养卡片：单号、状态（有效/已作废）、费用（没填显示浅色「未填费用」）、车牌 ｜ 类型 ｜ 里程、保养日期。
- 油卡申请详情：额度、状态、补充原因、车辆 · 车型、油卡卡号、里程、申请时间、补充次数（最近时间）；「办公室处理」卡片列处理人、处理时间、办公室备注（与补充原因相同时不重复）、处理后余额，待处理（含补充后重新提交）显示「办公室还没处理」；风险提示；现场照片点开预览。待补充时有「去补充资料」，跳 `fuel-apply?resubmit=<id>` 自动带入这张单：`packages/miniapp/packageFinance/fuel-record-detail/`、`packages/miniapp/packageFinance/fuel-apply/index.js`
- 保养记录详情：费用、状态、作废时间和原因（已作废时）、车辆、保养类型、里程、保养日期、保养人、提交时间、保养内容、备注、附件（图片预览、文件打开）：`packages/miniapp/packageFinance/maintenance-record-detail/`
- 两个详情页共用 `styles/detail-cards.wxss` 的版式，视图模型在分包内 `packageFinance/common/vehicle-records-view.js`。
- 入口：工作台新增「车辆记录」（slate，图标 Lucide clipboard-list）；「我的」页常用动作区第五张卡「我的车辆记录」占满一行：`packages/miniapp/utils/workbench-view.js`、`packages/miniapp/pages/profile/index.{js,wxml,wxss}`
- 后端：`GET /api/v1/fleet/fuel-applications` 带 `page`/`pageSize` 时分页并返回 `pagination`（不带时照旧整表返回）；新增 `GET /api/v1/fleet/fuel-applications/:id`，只允许申请人本人和 super_admin/manager/finance 查看：`packages/api/src/routes/fleet.ts`

## 9. 智能体接入（2026-07）

### 9.1 页面与路由映射

- 接入配置：`/agent/setup` → `packages/web/src/views/agent/setup.vue`（菜单：系统设置 → AI 与计算节点 → 智能体接入配置，全角色可见）
  - 选择 Agent 类型（Claude Code 推荐 / Codex / Claude Desktop / 其它）并填写设备名称，生成一键安装命令：macOS/Linux `curl | sh` 与 Windows PowerShell 两条，均带复制按钮。
  - 命令内含一次性 boot 授权码，有效期由接口返回的 `expires_in` 动态显示（当前 10 分钟、一次性）；访问令牌不落屏。授权有效期 180 天。
- 设备授权确认：`/agent/authorize?user_code=` → `packages/web/src/views/agent/authorize.vue`（不进菜单，由 CLI 设备流链接进入）
  - 未登录先经 WeCom OAuth，登录后自动回到本页（redirect 经 sessionStorage 贯通）。
  - 自动按 `user_code` 查询并展示设备名 / Agent / 客户端信息与只读权限说明；「同意授权」后设备端轮询自动发令牌，「拒绝」后设备端收到 denied。
  - 同意/拒绝动作绑定已加载记录（修改输入框即隐藏卡片，需重新查询）；`user_code` 变化时页面响应式刷新。
- 设备授权：`/agent/grants` → `packages/web/src/views/agent/grants.vue`（菜单：系统设置 → AI 与计算节点 → 设备授权，全角色可见）
  - 本人授权设备表：设备 / Agent / 令牌前缀 / 状态标签 / 创建 / 到期 / 最近使用（本地时区显示）；active 行可「吊销」（确认框，即时生效）。
  - super_admin 有「查看全部员工」开关（切换 admin 接口并增加员工列）。

### 9.2 API 指向

- 接入配置生成命令：`POST /api/v1/agent/setup/provision`
- 设备流同意页：`GET /api/v1/agent/device/info`、`POST /api/v1/agent/device/approve`、`POST /api/v1/agent/device/deny`
- 本人授权管理：`GET /api/v1/agent/grants`、`POST /api/v1/agent/grants/:id/revoke`
- 管理员全量视图：`GET /api/v1/admin/agent/grants`、`POST /api/v1/admin/agent/grants/:id/revoke`
- 高危操作确认页：`GET /api/v1/agent/pending/by-token/:token`（凭确认令牌取件）、`POST /api/v1/agent/pending/:id/confirm`、`POST /api/v1/agent/pending/:id/reject`
- Web API 封装：`packages/web/src/api/agent.ts`；可见菜单路由：`packages/web/src/router/modules/admin.ts`；隐藏确认路由：`packages/web/src/router/modules/agent.ts`

### 9.3 备注

- “智能体接入配置”和“设备授权”位于“系统设置 → AI 与计算节点”，对全部现有角色可见；`/agent/authorize` 与 `/agent/confirm` 始终隐藏，仅允许业务链接直达。

### 9.4 高危操作确认页（P2b，2026-07-19）

智能体令牌发起的高危写（当前为审批 `approve`/`reject`）不会直接落库：服务端把请求快照 park 住并向本人推送企业微信确认卡片，**只有员工本人在本页点确认，服务端才会重放原请求真正执行**。本页是「人在环」的唯一人类界面。

- 页面：`/agent/confirm?token=<confirm_token>` → `packages/web/src/views/agent/confirm.vue`（**不进菜单**，唯一入口是企业微信确认卡片上的「去确认」链接）
- 链接形态固定为 hash 路由 `${AGENT_WEB_BASE_URL}/#/agent/confirm?token=...`：web SPA 全环境 `VITE_ROUTER_HISTORY="hash"`，且 Cloudflare Pages 没有 SPA catch-all，path 形式会直接 404。
- 确认令牌只出现在链接 query 中，卡片正文与本页正文都不回显它；令牌也**绝不**回传给发起动作的智能体（否则智能体可自行确认，人在环归零）。

#### 展示内容（都是为了让员工能独立判断）

- 顶部固定警示：「下面这个操作由智能体发起，尚未生效。经你确认后，系统会以你的名义执行并记入审批记录。」
- **动作**：`{verb}{target}`，如「批准审批单 #9」。`verb` 为空说明该 `action_kind` 未在服务端登记 —— 此时如实显示「动作类型未登记（xxx）」，**绝不兜底成「批准」**。
- **状态**、**有效期至**（park 后 10 分钟）。
- **业务上下文**（后端按 `approval_instance` 查得，查不到则整块不渲染）：单号 / 业务类型 / 业务摘要 / 发起人。
- **智能体意见**：单独成块并显式标注「以下意见由智能体填写，确认后将以你的名义记入审批意见。请先核对再决定。」—— 这段话会被原样写进正式审批记录并**署上员工本人的名字**，不标注就等于让员工为一段自己没读过的话背书。智能体没填时显示「智能体未填写意见」。

#### 两个按钮与终态

仅当 `status === "pending"` 时才渲染按钮，否则渲染 `el-result` 终态卡片。

- 「确认执行」：先弹二次确认框（`ElMessageBox`，文案「即将以你的名义执行：{动作}。该操作不可撤销，确认继续？」，按钮「确认执行」/「再想想」），确认后才调 `confirm`。
- 「拒绝」：直接调 `reject`（拒绝本身无害，不需要二次确认）。若后端返回 `rejected: false`，说明该动作已被他路结算，页面以服务端返回的真实状态覆盖并提示「该动作已被处理」，**绝不谎报「已拒绝」**。

终态一律以服务端返回的视图为准，不在前端本地臆测：

| status | 页面文案 | 含义 |
| --- | --- | --- |
| `pending` | 待确认 | 仍可操作，渲染两个按钮 |
| `confirmed` / `executing` | 处理中 | 已认领，重放进行中 |
| `done` | 已执行 | 重放成功 |
| `failed` | 执行失败 | 重放跑完但目标接口返回业务错误（如「本人在该实例上没有待办」）——**动作确实执行过**，只是被业务规则拒绝 |
| `rejected` | 已拒绝 | 本人拒绝，目标接口从未被调用 |
| `expired` | 已过期 | 超过 10 分钟未处理 |

#### 两条特殊分支

- **503 可重试**：服务端重放密钥（`AGENT_REPLAY_SECRET`）暂不可用时返回 503。此时服务端**并未认领**该动作，行仍是可重试的，故页面只提示「系统尚未完成配置，请稍后重试或联系管理员」并**保持当前状态不变**，绝不让员工误以为动作已永久失败。
- **非本人打开**：后端对「令牌有效但不属于当前登录账号」和「令牌根本不存在」一律返回 **404**（而非 403 —— 403 等于向转发链上的任何人确认「这个令牌是真的」）。页面统一显示「无法打开此确认链接 / 链接可能已失效、已被处理，或不属于当前登录账号」，且**不渲染任何操作按钮**。该端点对智能体令牌永久关闭（只读白名单 + `requireHumanSession` 双道守门）。

## 10. 财务详情抽屉化（2026-08）

合同管理、对外付款处理台、收款工作台三处「查看详情」由整页路由跳转改为**右侧抽屉（el-drawer）**打开，减少列表↔详情往返的上下文切换。

### 统一架构：Panel + 薄壳路由页 + Drawer

每个业务详情拆为三层，**原路由不删**（审批详情、发单向导、看板等多处深链接仍指向 `/finance/*/detail/:id`）：

| 业务 | Panel（主体，id 走 props） | 薄壳路由页 | Drawer |
| --- | --- | --- | --- |
| 合同 | `contract/components/ContractDetailPanel.vue` | `contract/detail.vue` | `contract/components/ContractDetailDrawer.vue`（size 72%） |
| 付款 | `payment/components/PaymentDetailPanel.vue` | `payment/detail.vue` | `payment/components/PaymentDetailDrawer.vue`（size 72%） |
| 收款登记 | `receipt/components/ReceiptDetailPanel.vue` | `receipt/detail.vue` | `receipt/components/ReceiptDetailDrawer.vue`（size 640px） |

- **Panel**：原详情页全部逻辑与模板，业务 id（及合同的新建模式/初始方向、付款的 autoEdit）改由 props 传入；「返回」按钮 emit `back`。
- **薄壳路由页**：保留原组件名（keep-alive 依赖）与路由行为，读 `route.params`/`query` 后渲染 Panel，并以 `:key="String(route.params.id)"` 保证同路由换 id 强制重挂载；合同新建成功后 `router.replace` 至新 id。
- **Drawer**：`visible` prop + `update:visible`/`closed` emit（与既有 `PlainPreviewDrawer`/发票详情抽屉同约定），`direction="rtl"` + `destroy-on-close` + `append-to-body`；Panel 以 `v-if="id !== null"` 挂载，每次打开重新拉数据。

### 接入点

- 合同管理列表 `contract/index.vue`：点击行或「详情」开抽屉；「新建合同」「合同生成」仍走路由。
- 收款工作台·收款合同 `receipt/contract.vue`：「详情」开抽屉（复用 `ContractDetailDrawer`）；「新建收款合同」仍走路由。
- 对外付款处理台 `payment/index.vue`：「详情」开抽屉；「去修改」（`?edit=1`）与「审批详情」仍走路由（审批改单链路 `approval/biz-edit-routes.ts` 依赖页面路由）。
- 收款工作台·收款登记 `receipt/list.vue`：「详情」开抽屉。

### 凭证风视觉语言（2026-08 第二轮）

三个 Panel 统一升级为「财务凭证」设计语言，共享组件位于 `views/finance/shared/`：

- `components/FinanceDetailHeader.vue`：凭证表头——单号（等宽字体+一键复制）、状态/方向/AI 签、关键信息 meta 行、右侧金额大字（tabular-nums）+ 中文大写、底部虚线动作条；#extra 插槽承载扩展（如合同付款进度条）。暖纸渐变底 + 双细线收边。
- `components/FinSection.vue`：分节标题——琥珀短竖条 + 虚线延展线，取代原 el-divider；#extra 放节级动作/统计。
- `format.ts`：formatMoney 千分位金额格式化；金额列一律右对齐。

各 Panel 信息架构：

- **合同**：表头（合同号/方向/状态/AI 签 + 合同金额大写 + 编辑资料/提交审批/触发AI审查/返回 + 付款进度条「总额/已付/剩余 + 百分比」）→ 默认**阅读态**（合同信息 descriptions / 合同附件 / AI审查报告 / 金额变更记录 / 关联付款申请），「编辑资料」显式进入编辑态（原大表单 + 保存/取消编辑）；新建模式恒为编辑态。**关联付款申请点击行/「查看」弹出嵌套 PaymentDetailDrawer**，节头显示「共 N 笔 / 合计」，嵌套抽屉关闭后回刷合同（已付金额联动）。阅读态上传/移除附件即时落库；编辑态附件随「保存」提交、「取消编辑」回滚。
- **付款**：表头（流水号/状态/AI风险签 + 申请金额大写 + 项目/收款人/类别/方式/预计付款日/申请人 meta + 返回）→ 付款执行（标记付款/废除/激活 + 已付信息）→ 申请信息（`!canEditFields` 时为阅读态 descriptions，可编辑时保留表单）→ 附件 → AI风险评估/审批信息/AI审核意见分节。
- **收款登记**：表头（收款单号/状态签 + 收款金额 + 合同/对方/日期/账户/发票 meta + 发起退款）→ 收款信息 / 收款凭证附件（文件大小人性化）/ 退款记录（状态彩签，pending_approval=warning）。

### 交互约束

- **加载提示**：Panel 的 loading 覆盖全部初始化请求（含实体/项目/企微人员等参照数据，不只主详情接口），根元素 `v-loading` + `min-height: 240px`，抽屉打开即见加载动画。
- **关闭即刷新**：抽屉 `closed` 后列表重新拉数据（付款处理台同时刷新汇总条），抽屉内保存/提审/标记付款/退款的结果立即反映到列表。
- **弹层层级**：Panel 内的 el-dialog / 附件预览抽屉统一加 `append-to-body`，避免被外层抽屉 transform/overflow 裁剪。
- **健壮性**：`PaymentInfoCard` 的 requestId 改为取自 `detail.id`（不再依赖路由参数），详情未加载成功时保存/提审/风险评估/附件同步均拦截并提示，杜绝 `/payment/NaN` 畸形请求。

## 11. 收款以合同/项目为中心的整合 + 项目大厅重设计（2026-08）

### 11.1 收款合同版面集成开票与到账

- 收款合同详情（`ContractDetailPanel`，inbound 方向）表头进度条为「已开票/已到账」双口径（`invoiced_amount`/`received_amount`）；正文新增两节：
  - 「开票记录」：在途开票申请（过滤 issued/rejected/cancelled）+ 正式发票表；#extra 已开票合计 + 「去开票」。
  - 「收款登记」：该合同到账记录表，「查看」嵌套 `ReceiptDetailDrawer`；#extra 已到账合计 + 「新增收款登记」。
  - 「关联付款申请」节仅 outbound 渲染。
- 「去开票/新增收款登记」跳转收款工作台对应页签并发 `nav` 事件：抽屉链逐层关闭（Panel→ContractDetailDrawer→ProjectReceiptPanel→ProjectReceiptDrawer），避免抽屉遮挡目标页。
- 收款合同列表（`receipt/contract.vue`）：「已开票/已收款」合并为「收款进度」列（开票/到账两行迷你进度 + 金额）。

### 11.2 项目收款全貌抽屉 `receipt/components/ProjectReceiptPanel.vue` + `ProjectReceiptDrawer.vue`

- 项目视角收款汇总：凭证表头（项目编号/状态签/项目名/负责人 + 收款合同总额 + 开票/到账双进度）+ 三节（收款合同→嵌套合同抽屉、开票记录、收款登记→嵌套收款抽屉）。
- 数据：getProjectById + listContracts(inbound,project_id) + listInvoices/listInvoiceRequests/listReceipts(project_id)；超出拉取上限（合同200/发票500/申请200/收款500）时顶部 el-alert 提示数据不完整；加载失败 message 报错不静默。
- 入口：收款工作台头部「按项目查看收款全貌」（项目下拉 pageSize 500）+ 项目工作区财务面板主按钮（maskSensitive=true 不渲染）。

### 11.3 项目选择大厅 `project/hub.vue` 重设计

- 删除按状态硬编码百分比的圆环进度（原 active 恒 72% 假数据）。
- 卡片：左缘 4px 状态色条；状态签+开工日期首行；项目名+等宽编号；**五段生命周期阶段条**（规划→筹备→施工→收尾→归档：已过浅色/当前实色加高并显标签/未到空底，archived 整条灰化）；位置/负责人小标签 meta；briefing 两行 clamp；hover 抬升 + 右下「进入工作区 →」。
- 状态筛选改为 chips 行（激活琥珀实底）；关键字/位置/重置/创建保留。

### 11.4 项目工作区 `project/workspace/`

- `index.vue` 头卡：getProjectById 显示项目名/等宽编号/状态签 + 迷你阶段条 + 位置/负责人/开工日期；加载失败降级显示项目 ID，tabs 不受影响。
- `finance-panel.vue`：四个暖纸统计块（对外已付/已开票/已到账/报销累计，maskSensitive 显 ***）+ 收款登记笔数 + 「项目收款全貌」按钮（抽屉 @closed 回刷摘要）+ 保留快捷入口。
- `equipment-panel.vue`/`file-panel.vue`：节标题统一琥珀竖条样式、表格空态 el-empty、金额/数量列右对齐、按钮排布对齐（逻辑零改动）。`project-panel.vue` 未动。

## AI 关卡兜底审核人（2026-09-14）

- **系统管理 → AI关卡任务**：页面顶部新增「AI 关卡兜底审核人」卡片。下拉只列企微标签解析为超级管理员的人（下拉为空时提示可能是标签同步异常）；未配置时黄色提示「未配置兜底审核人，AI 拦截将退回发起人修改重提」，企微不可用时黄色提示「暂时无法核对 X 的角色…当前配置仍然生效」或「暂时无法读取通讯录…」，角色不符时黄色提示重新指定，正常时绿色提示「AI 拦截将转给 X（超级管理员）人工复核」。清空审核人需二次确认；保存后显示最近更新人（姓名）与时间。放行/驳回按钮仍只对审批中的实例可用。
- **审批详情（网页与小程序）**：AI 关卡节点上受理人为真人的任务打「人工复核」标签；pending 时显示「AI 拦截，等待人工复核」，作废时显示「人工复核任务已作废」，转签显示「人工复核 · 已转签」，已处理时动作前缀「人工复核 ·」。
- **企微通知**：审核人收待办卡（节点名取模板关卡节点名）；发起人收结果卡，标签「已转人工复核」，说明「AI 审查未通过，等待 X 人工复核」。

## 合同金额变更：申请附件与审批明细（2026-10-18）

- **合同执行监控 → 发起金额变更抽屉**（`finance/contract/monitor.vue`）：「变更缘由」下新增「附件」：「上传文件」按钮支持多选，类型同合同附件（pdf/图片/Word/Excel），选填、最多 20 个；已传文件逐行显示文件名、大小与「移除」。附件上传中禁用「提交审批」。缘由输入框限 1000 字并显示字数。接口报错（合同非生效、金额低于已付等）原样提示；若变更单已保存但送审失败，关闭抽屉并提示到合同详情「金额变更记录」重新提交。
- **审批详情（网页）**：新增「申请明细（合同金额变更）」区，见 §I。
- **审批详情（小程序）** `pages/approval-detail`：新增「申请明细（合同金额变更）」卡片（字段同网页），附件进入页面已有的「附件」卡片，点「查看」打开；无附件时卡片内提示「申请人未上传附件」。
- **合同详情 → 金额变更记录**：新增「附件」列，文件名可点击打开；无附件显示「-」。

## AI 任务撤回状态（2026-10-28）

- **系统管理 → AI关卡任务**：状态筛选新增 `cancelled`（业务作废/取消时由服务端撤回的任务）；列表中该状态打灰色（info）标签，备注列显示撤回原因（如「付款申请 PM-xxx 已作废，任务撤回」）。
- **AI 节点管理**（`ai/nodes.vue`）任务队列状态筛选同样新增 `cancelled`。
- **审批详情（网页）**：AI 关卡审查记录的任务状态为 `cancelled` 时打 info 标签，不再按未知状态处理。
- **审批详情（小程序）**：任务状态文案「已撤回」、中性主题；随下次提审生效。
