# 车辆保养记录 — 设计文档

- 日期：2026-06-24
- 状态：已确认（待实现）
- 模块归属：车队（车辆油卡）模块增量

## 1. 背景与目标

为公司车辆增加"保养记录"台账：员工通过**网页**与**小程序**填写车辆的保养记录，记录与现有**车辆主档**（`company_vehicle`）挂钩，便于按车辆查阅保养历史与费用。

记录字段：里程、保养内容、时间、保养人、费用、附件。

## 2. 处理方式（已确认）

**纯记录台账**：员工填写后直接入库、可查看与筛选，**不接入审批引擎、不需要办公室处理工作台、不发送通知**。结构上对标现有"里程登记"（`company_vehicle_mileage_log`），是车队模块的轻量增量。

## 3. 关键决策记录

| 决策点 | 结论 |
|--------|------|
| 处理方式 | 纯记录台账，无审批 |
| 保养人字段 | 自由文本（可填修理厂/4S 店或人名） |
| 保养内容 | 分类（字典）+ 详情文本 |
| 权限模型 | 分级：全员可新增；管理层看全部并可编辑/作废；普通操作员只看自己填的 |
| Web 菜单 | 独立顶层菜单"车辆保养"，对全角色可见（含 operator）；页面内按角色区分，operator 仅见本人记录且无编辑/作废按钮 |
| 里程存储 | 记录自带 `mileage_km`，**不**自动写入现有里程登记表（避免耦合） |
| 费用 | 仅作为台账数字记录，**不**联动报销/付款 |
| 里程必填性 | 必填 |
| 单号 | 自动生成 `record_no`（前缀 `BY`），便于引用 |
| 删除策略 | 软删除（`status = voided`），遵循项目约定 |
| 附件存储 | `attachments_json`（`[{file_key,file_name,file_size}]`），支持图片与 PDF 等 |
| 代码归属 | 独立模块，不塞进已超长的 `fleet.ts`(1785 行) / `vehicles.vue`(516 行) |

## 4. 数据模型

### 4.1 新表 `vehicle_maintenance_record`

迁移文件：`packages/api/migrations/0052_vehicle_maintenance_record.sql`

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `id` | INTEGER | PK AUTOINCREMENT | |
| `record_no` | TEXT | NOT NULL UNIQUE | 保养单号，后端 `generateSerial` 生成，格式 `BY-YYYYMMDD-NNNN`（4 位流水号，零填充） |
| `vehicle_id` | INTEGER | NOT NULL, FK→`company_vehicle(id)` | 挂钩车辆主档 |
| `maintenance_type` | TEXT | NOT NULL | 保养类型，存字典 `dict_value` |
| `content` | TEXT | NOT NULL | 保养内容详情 |
| `mileage_km` | REAL | NOT NULL | 项目里程（保养时里程） |
| `service_provider` | TEXT | NULL | 保养人/服务方（自由文本） |
| `cost` | REAL | NULL | 费用（仅记录） |
| `serviced_at` | TEXT | NOT NULL | 保养时间（ISO 8601 日期，默认今天） |
| `attachments_json` | TEXT | NULL | `[{file_key,file_name,file_size}]` |
| `remark` | TEXT | NULL | 备注 |
| `status` | TEXT | NOT NULL DEFAULT 'active' | `active` / `voided` |
| `created_by_userid` | TEXT | NOT NULL | 登记人（`auth.sub`） |
| `voided_by_userid` | TEXT | NULL | 作废操作人 |
| `voided_at` | TEXT | NULL | 作废时间 |
| `void_reason` | TEXT | NULL | 作废原因 |
| `created_at` | TEXT | NOT NULL | |
| `updated_at` | TEXT | NOT NULL | |

索引：
- `idx_vehicle_maintenance_record_vehicle_id` (vehicle_id)
- `idx_vehicle_maintenance_record_serviced_at` (serviced_at)
- `idx_vehicle_maintenance_record_created_by` (created_by_userid)
- `idx_vehicle_maintenance_record_status` (status)
- `idx_vehicle_maintenance_record_type` (maintenance_type)

### 4.2 字典播种（同一迁移）

`dict_type = 'vehicle_maintenance_type'`：

| dict_label | dict_value | sort_order |
|-----------|-----------|-----------|
| 常规保养 | routine | 10 |
| 维修 | repair | 20 |
| 轮胎 | tire | 30 |
| 保险年检 | inspection | 40 |
| 事故处理 | accident | 50 |
| 其他 | other | 90 |

使用 `INSERT OR IGNORE INTO sys_dict (...) VALUES (...)`，可安全重复执行。

## 5. 后端 API

新文件：`packages/api/src/routes/vehicle-maintenance.ts`，在 `index.ts` 挂载到 `/api/v1/fleet/maintenance`。

### 5.1 端点

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| GET | `/api/v1/fleet/maintenance` | 全员 | 列表；查询参数：`vehicle_id?`、`maintenance_type?`、`mine?`、`date_from?`、`date_to?`、`status?`、`page?`、`pageSize?`；**operator 强制只返回 `created_by_userid = self`**，管理层返回全部 |
| GET | `/api/v1/fleet/maintenance/:id` | 全员（operator 仅限本人记录） | 详情，JOIN 车辆信息，返回附件数组 |
| POST | `/api/v1/fleet/maintenance` | 全员 | 新增 |
| PUT | `/api/v1/fleet/maintenance/:id` | 管理层 | 编辑 |
| POST | `/api/v1/fleet/maintenance/:id/void` | 管理层 | 作废（软删除，body 带 `reason?`） |

"管理层" = `super_admin / manager / finance / site_manager`（与 `fleet.ts` 中 `canViewFleetWide` 口径一致）。

### 5.2 创建校验（POST）

- `vehicle_id`：必填，且对应车辆存在
- `maintenance_type`：必填，需为有效字典值
- `content`：必填，非空
- `mileage_km`：必填，数字且 ≥ 0
- `serviced_at`：必填（缺省时后端补今天）
- `cost`：若提供需 ≥ 0
- `attachments_json`：若提供需为合法 JSON 数组

### 5.3 复用现有能力

- `generateSerial`（`services/serial`）生成 `record_no`，调用 `generateSerial(c.env.DB, "BY", "vehicle_maintenance_record", "record_no")`
- `appendApiAuditLog`（`services/fleet-governance`）写审计：动作 `create/update/void`，target_type `vehicle_maintenance_record`
- 附件直传：`POST /api/v1/upload/sign` → 直传 R2；读取 `GET /api/v1/upload/object/:key`
- 时间统一 `new Date().toISOString()`

## 6. 前端（Web）

- `packages/web/src/api/vehicle-maintenance.ts`：API 封装 + TypeScript 类型（`VehicleMaintenanceRecord` 等）
- `packages/web/src/views/vehicle-maintenance/index.vue`：新页面
  - 顶部筛选栏：车辆、保养类型（拉字典）、日期区间、状态
  - "新增保养记录"对话框：车辆下拉（拉 `/fleet/vehicles?status=active`）、类型下拉（拉字典）、里程、内容（多行）、保养人、费用、保养日期、附件上传
  - 列表表格：单号、车辆/车牌、类型、里程、费用、保养时间、登记人、状态、操作（详情/编辑/作废）
  - **详情抽屉**：展示完整信息 + 附件列表（查看/下载），沿用最近发票/报销的抽屉模式
  - 角色区分：operator 仅见本人记录、无编辑/作废按钮；管理层见全部并可编辑/作废
- 路由：**新建独立顶层菜单** `packages/web/src/router/modules/vehicle-maintenance.ts`，菜单标题"车辆保养"，路径 `/vehicle-maintenance`，对全角色可见（含 operator）。router/modules 目录会被 `import.meta.glob` 自动加载，无需手动注册
- 保养类型 label：通过 `/api/v1/dict?dict_type=vehicle_maintenance_type` 拉取并映射

## 7. 小程序

- 新页面 `packages/miniapp/pages/vehicle-maintenance/`（`index.js/wxml/wxss/json`），仿 `pages/fuel-apply/`：
  - 选车辆（picker，拉 `/fleet/vehicles?status=active`）
  - 选保养类型（picker，拉字典）
  - 填里程、内容（textarea）、保养人、费用、保养日期
  - 传附件：`uploadFileToR2(filePath, { category: 'vehicle-maintenance', fileName })`
  - 提交：`POST /api/v1/fleet/maintenance`
  - 下方展示"我的保养记录"列表（`mine=true`）
- `app.json` 注册页面路径
- 在工作台 / 财务入口加入口按钮

## 8. 文件清单

**新增：**
- `packages/api/migrations/0052_vehicle_maintenance_record.sql`
- `packages/api/src/routes/vehicle-maintenance-policy.ts`（纯函数：校验/权限范围）
- `packages/api/src/routes/vehicle-maintenance-policy.test.ts`（vitest 单测）
- `packages/api/src/routes/vehicle-maintenance.ts`（Hono 路由）
- `packages/web/src/api/vehicle-maintenance.ts`
- `packages/web/src/views/vehicle-maintenance/index.vue`
- `packages/web/src/router/modules/vehicle-maintenance.ts`（独立顶层菜单）
- `packages/miniapp/pages/vehicle-maintenance/index.{js,wxml,wxss,json}`

**修改：**
- `packages/api/src/index.ts`（挂载路由，须在 `/api/v1/fleet` 之前）
- `packages/miniapp/app.json`（注册页面）
- `packages/miniapp/pages/finance/index.js`（在 `applyActions` 加入口卡片）
- `doc/开发记录.md`（追加）、`doc/UI设计文档.md`（更新）

## 9. 测试计划

遵循项目既有的"纯函数 + vitest 单测"模式（参照 `reimbursement-create-policy.ts` / `.test.ts`）：把校验与权限范围抽成纯函数放 `vehicle-maintenance-policy.ts`，由 `vehicle-maintenance-policy.test.ts` 覆盖：
- 创建校验：必填项缺失、无效字典值、负数 cost/mileage、非法 attachments_json
- 列表权限范围：operator 强制限定本人；管理层不限定；privileged + mine=true 限定本人
- 管理判定：`canManageMaintenance` 对管理层为真、对 operator 为假

路由处理器（`vehicle-maintenance.ts`）调用上述纯函数；DB 交互通过 `npm run typecheck` 与本地 wrangler 验证。目标覆盖率 80%+。

## 10. 明确不做（YAGNI，v1）

- ❌ 审批流
- ❌ 保养到期提醒（按里程/时间）
- ❌ 联动报销/付款
- ❌ 导出
- ❌ 费用统计看板

以上均可作为后续增量，结构上不冲突。

## 11. 后续可扩展项

- 保养到期提醒：基于 `serviced_at` + `mileage_km` 与车辆当前里程做规则提醒（可复用车队 governance 思路）
- 费用统计：按车辆/类型/月份聚合的看板
- 与里程登记联动：保养时可选同步生成一条 `company_vehicle_mileage_log`
