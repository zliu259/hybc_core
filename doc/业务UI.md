这份文档是为前端与前后端联调团队准备的**最终执行级蓝图**。它将之前的交互构想严格映射到了你已实现的 `/api/v1/*` 路由上，并明确了页面级组件的选择与数据流转逻辑。

---

# 系统 Web 端全景 UI 设计与 API 对接白皮书 (Vue 3 + PureAdmin Thin)

## 一、 财务管理 (对外付款+合同监控)

此模块是资金流出的核心防线，UI 需强化“预警”与“阈值”的视觉反馈。

### 1.1 合同执行与监控大屏 (Contract Monitor)

**【UI 精细设计】**

* **组件体系：** 使用 `el-table` (宽表) 配合自定义的列模板。
* **视觉高亮：**
* **金额进度条：** 使用 `el-progress`。将“已打款金额”与“合同总金额”的占比可视化。`< 80%` 为默认蓝色，`80%-95%` 为橙色，`> 95%` 强制标红。
* **状态标签：** 合同状态使用 `el-tag`（`draft`: 灰, `active`: 绿, `completed`: 蓝）。


* **交互面板：** 点击【变更金额】出 `el-drawer`，填写变更缘由与差额，触发变更审批。

**【API 对接定义】**

* **列表拉取：** `GET /api/v1/contract?direction=outbound`
* *前端需聚合数据：* 后端返回的实体中已包含 `total_amount` 和 `paid_amount`，直接计算比例渲染进度条。


* **金额变更提交：** `POST /api/v1/contract/:id/amount-change/:changeId/submit-approval`
* *Payload:* `{ instance_config: { ... } }` (带入 Phase 2 的实例级二次设置)。



### 1.2 资金流出智能发单台 (Smart Payment Wizard)

**【UI 精细设计】**

* **组件体系：** 居中卡片表单 `el-card` + 向导组件 `el-steps`。
* **交互逻辑：**
* 单一输入框起手：“请输入预计付款总额”。
* 失去焦点 (blur) 时，前端防抖调用阈值校验。若超出阈值，下方动态展开 `el-steps` 引导进入“新建合同”流程；若未超，直接展示收款人及事由表单。
* 若走合同流程，在 Step 3 出现 Switch 开关：`[同时发起首笔预付款]`。



**【API 对接定义】**

* **匹配阈值规则：** `GET /api/v1/admin/thresholds?biz_type=payment_request` (前端缓存匹配，或请求后端实时测算)。
* **联合提交 (合并事务逻辑)：**
* 先创建合同：`POST /api/v1/contract`
* 若开启首笔付款，获取上一步 `contract_id`，紧接发起：`POST /api/v1/payment`
* 分别触发审批：`POST /api/v1/contract/:id/submit-approval`。



### 1.3 报内报销集中打款台 (Reimbursement Batch)

**【UI 精细设计】**

* **组件体系：** 嵌套表格 `el-table` (支持 Expand 展开行)。
* **视觉层级：**
* 主行：报销批次 (`reimbursement_batch`)，展示总金额、包含信封数、批次状态 (`approved`)。
* 展开行：子表格展示该批次内各信封的归属人、报销明细及**收款银行账户**。


* **操作流：** 选中单行或多行批次，点击顶部悬浮栏的 `[登记打款]` 弹窗。

**【API 对接定义】**

* **批次获取：** `GET /api/v1/reimbursement/batch?status=approved`
* **执行打款动作：** `POST /api/v1/reimbursement/batch/:id/mark-paid`
* *Payload (来自 Phase 14):* `{ paid_at: '2026-02-21', payment_reference: '流水号', payment_account: '建行尾号xxxx' }`



---

## 二、 项目管理 (全卡片化现场指挥台)

彻底摒弃传统表格，一切以信息流和视觉卡片为主。

### 2.1 项目选择大厅 (Project Hub)

**【UI 精细设计】**

* **组件体系：** 响应式网格 `el-row` + `el-col` 嵌套自定义 Card 组件。
* **视觉表现：** 卡片右上角显示项目状态标记，中央是一个 `el-progress` (type="circle") 展示工程进度。卡片悬浮 (hover) 时产生上浮阴影。

**【API 对接定义】**

* **拉取列表：** `GET /api/v1/project`

### 2.2 项目面板 (Project Workspace)

**【UI 精细设计】**

* **顶栏 (Header)：** 标题旁放置 `el-dropdown` 用于切换项目状态。标题下方横铺一个 `el-alert` (type="warning", effect="dark")，绑定项目“交底信息”字段。
* **动态与日志瀑布流 (Masonry)：**
* 使用 CSS Columns 或 Vue-Masonry 构建两列/三列瀑布流。
* **颜色映射字典：** 白班 (`bg-blue-50`, Icon: ☀️), 夜班 (`bg-indigo-900 text-white`, Icon: 🌙), 预警 (`bg-red-50`, Icon: ⚠️)。
* 卡片高度自适应，点击弹出 `el-drawer` 看全量图文。


* **文件库卡片区：** 左侧 `el-tree` (图纸/合同/审批件)，右侧文件使用方块形卡片，大图标置顶，文件名置底，支持拖拽上传至该区域。

**【API 对接定义】**

* **状态与交底更新：** `PUT /api/v1/project/:id` (更新 status 或 briefing 字段)。
* **日志拉取聚合：**
* `GET /api/v1/log/operator?project_id=:id`
* `GET /api/v1/log/manager?project_id=:id`
* `GET /api/v1/survey/breakthrough?project_id=:id`
* *(前端按 `created_at` 混排并映射卡片颜色)*。


* **文件管理：**
* 拉取：`GET /api/v1/project/:id/files`
* 上传：先调 `POST /api/v1/upload/url` 取 R2 签名，直传后调 `POST /api/v1/project/:id/files` 登记。



---

## 三、 Admin (审批流程与自动化引擎)

系统规则的可视化控制中心。

### 3.1 审批流程设计器 (Approval Flow Designer)

**【UI 精细设计】**

* **组件体系：** 引入 `@vue-flow/core` 与 `@vue-flow/background`。
* **左侧侧边栏：** 节点类型列表 (Sequential, Countersign, AI Gate, CC)，支持 `drag & drop`。
* **画布区：** 允许自由连线，节点渲染采用自定义 Node (包含类型 Icon、节点名称、审批人占位符)。
* **右侧配置抽屉：** 选中画布上的节点触发。表单包含：`node_type`, `approver_role`, `timeout_hours` (联动 Phase 3 的超时机制), `allow_transfer`。

**【API 对接定义】**

* **获取模板详情：** `GET /api/v1/admin/approval-templates/:id`
* **保存画布 JSON：** `PUT /api/v1/admin/approval-templates/:id`
* *Payload:* `{ template_json: { nodes: [...], edges: [...] } }` (引擎的 `template-parser.ts` 将负责解析此 JSON)。



### 3.2 阈值与路由管理 (Threshold Config)

**【UI 精细设计】**

* **组件体系：** `el-table` + 内嵌范围输入框。
* **表单表现：** 使用 `el-input-number` 构成 `[ Min ] ~ [ Max ]` 区间，右侧下拉框选择对应的“审批模板”。

**【API 对接定义】**

* **拉取/更新规则：** `GET/POST /api/v1/admin/thresholds`

---

## 四、 库房管理 (资产运维控制台)

### 4.1 资产台账与设备管理

**【UI 精细设计】**

* **组件体系：** 图片卡片列表 (`div.grid`)。
* **视觉表现：** 设备图片占卡片上方 60%，下方显示资产名与状态。状态映射：在库 (绿)、出库中 (蓝)、维修 (橙)。
* **工具栏：** 顶部放置批量操作区：`[打印入库单]`、`[批量生成二维码标签]`。

**【API 对接定义】**

* **台账拉取：** `GET /api/v1/asset`

### 4.2 出入库调度 (Stock Orders)

**【UI 精细设计】**

* **组件体系：** 类似 Trello 的 Kanban 拖拽面板 (可基于 `vuedraggable` 实现)。
* **栏目定义：** `待处理入库` | `待处理出库` | `调拨执行中` | `已完成`。
* **操作流：** 库管点击卡片弹出清单，清点实物后，点击卡片底部的 `[确认执行]`。

**【API 对接定义】**

* **任务拉取：** `GET /api/v1/warehouse/stock-order`
* **执行确认：** `POST /api/v1/warehouse/stock-order/:id/execute` (系统将自动核减库存并写流水)。

---

## 五、 审批中心 (沉浸式决断流)

### 5.1 统一工作台 (Unified Tasklist)

**【UI 精细设计】**

* **组件体系：** 左侧 `el-menu` (或卡片列表) + 右侧动态 Component 渲染。
* **布局逻辑 (Split View)：**
* **左栏 (占宽 30%)：** 展示待办列表。使用 `biz_type` (如 `outbound_contract`, `payment_request`) 映射不同的彩色边框和前缀文本。
* **右栏 (占宽 70%)：** 点击左侧单据后渲染。上方是具体业务组件 (只读态的表单/合同正文/AI风险报告)，底部固定吸底动作条 (Action Bar) 提供：`[通过] [驳回] [退回上步] [转签]` 按钮。



**【API 对接定义】**

* **拉取待办池：** `GET /api/v1/approval/pending`
* **提交动作：** `POST /api/v1/approval/instance/:id/approve` (或 `/reject`, `/transfer`)。
* *高级 Payload:* 提交通过时，可按 Phase 2 逻辑附带 `{ instance_config: { default_approver: 'xxx' } }` 供后续节点沿用。


---