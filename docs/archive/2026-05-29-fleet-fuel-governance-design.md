# 车辆与油卡治理闭环设计

## 背景

当前仓库已存在车辆与油卡基础能力：

- Web：`packages/web/src/views/finance/fleet/`
  - `application.vue`：员工油卡额度申请
  - `vehicles.vue`：车辆档案、油卡绑定、办公室处理混合页
  - `applications-list.vue`：油卡申请全量处理页
  - `dashboard.vue`：车辆用油总览
- API：`packages/api/src/routes/fleet.ts`
  - 车辆档案、油卡、油卡绑定、额度申请、余额日志、申请废除
- 小程序：`packages/miniapp/pages/fuel-apply/index.*`
  - 一线人员发起油卡额度申请
- 已有基础表：
  - `company_vehicle`
  - `company_vehicle_mileage_log`
  - `fuel_card`
  - `fuel_card_user_binding`
  - `fuel_quota_application`
  - `fuel_card_balance_log`
  - `event_log`
  - `api_audit_log`

本次优化不是单纯页面美化，而是把车辆与油卡升级为完整治理闭环：申请、处理、规则、通知、审计、管理总览。

## 已确认方向

- 实施范围：Web、小程序油卡申请、企微待办通知、规则配置、审计、管理总览全部纳入。
- 处理链路：`员工/现场操作员提交 -> 财务/办公室处理 -> 经理查看总览`。
- 管理首页优先级：先判断公司总体用油成本和油卡余额是否健康。
- 实施策略：治理闭环优先，先建立状态、规则、通知、审计和聚合主干，再优化页面体验。

## 目标

1. 不同角色有清晰的工作入口和处理职责。
2. 员工和现场操作员可以在 Web 或小程序完成提交、查看结果、补充材料。
3. 财务和办公室可以在专门工作台处理待办、查看规则命中和历史证据、回写油卡余额。
4. 经理不进入逐单审批链路，主要通过驾驶舱判断公司车辆和用油健康状况。
5. 超级管理员可以配置规则、查看审计、处理高风险兜底动作。
6. 企微通知覆盖提交、超时、处理结果和余额预警，并记录发送状态。

## 非目标

1. 本次不把油卡额度申请接入通用审批流，不引入经理逐单审批。
2. 本次规则不自动阻断员工提交，规则结果用于风险提示和处理建议。
3. 本次不重做车辆维修、保险、保养、违章等完整车务系统。
4. 本次不改变 WeCom `userid` 作为用户身份主键的原则。

## 角色与职责

| 角色 | 职责 | 主要入口 |
| --- | --- | --- |
| 员工/现场操作员 | 提交油卡额度申请，补充退回材料，查看处理结果 | Web 工作台、小程序油卡申请 |
| 财务/办公室 | 处理油卡申请，核对规则命中、照片、里程和余额，回写油卡余额 | Web 油卡处理工作台 |
| 经理/管理人员 | 查看公司总体用油成本、油卡余额健康、车辆用油覆盖 | Web 用油健康总览 |
| 超级管理员 | 规则配置、审计查询、通知监控、废除异常申请 | Web 规则与审计中心 |

## 申请状态机

`fuel_quota_application.status` 扩展为：

| 状态 | 含义 | 进入方式 | 下一步 |
| --- | --- | --- | --- |
| `pending` | 待办公室处理 | 员工提交或补充后重新提交 | `processed` / `rejected` / `needs_info` / `cancelled` |
| `needs_info` | 退回补充 | 办公室认为资料不完整 | 员工补充后回到 `pending` |
| `processed` | 已通过并回写余额 | 办公室通过处理 | 终态 |
| `rejected` | 已拒绝 | 办公室拒绝 | 终态 |
| `cancelled` | 已废除 | 超级管理员兜底废除 | 终态 |

小程序可保留本地 `draft` 概念，但不需要入库为正式状态。

## 数据模型设计

### 扩展 `fuel_quota_application`

新增字段建议：

| 字段 | 类型 | 用途 |
| --- | --- | --- |
| `risk_level` | `TEXT` | `normal` / `warning` / `high` |
| `risk_summary` | `TEXT` | 提交时固化的规则风险摘要 |
| `needs_info_reason` | `TEXT` | 退回补充原因 |
| `resubmitted_at` | `TEXT` | 最近一次补充后重新提交时间 |
| `supplement_count` | `INTEGER` | 补充次数 |

旧数据兼容：没有风险字段的历史申请按 `normal` 展示；没有补充次数按 `0` 展示。

### 新增 `fleet_fuel_rule_policy`

用于规则配置，不把规则写死在页面或接口里。

| 字段 | 用途 |
| --- | --- |
| `id` | 主键 |
| `policy_name` | 规则名称 |
| `policy_type` | `amount_limit` / `monthly_frequency` / `mileage_delta` / `card_balance` / `photo_required` |
| `config_json` | 规则阈值和文案配置 |
| `severity` | `info` / `warning` / `high` |
| `enabled` | 是否启用 |
| `created_by` | 创建人 `userid` |
| `created_at` / `updated_at` | ISO 8601 时间 |

### 新增 `fuel_quota_rule_hit`

用于固化每张申请提交时的规则命中结果。

| 字段 | 用途 |
| --- | --- |
| `id` | 主键 |
| `application_id` | 关联油卡申请 |
| `policy_id` | 关联规则 |
| `policy_type` | 冗余规则类型，便于查询 |
| `severity` | 命中风险级别 |
| `hit_message` | 给办公室看的解释文案 |
| `suggested_action` | `review` / `verify_balance` / `request_info` |
| `created_at` | ISO 8601 时间 |

### 新增 `fleet_wecom_notification`

用于记录企微通知，不只依赖外部发送结果。

| 字段 | 用途 |
| --- | --- |
| `id` | 主键 |
| `application_id` | 关联油卡申请 |
| `notification_type` | `submitted` / `timeout` / `processed` / `needs_info` / `balance_warning` |
| `target_userids_json` | 目标用户 |
| `target_group_key` | 目标群组或角色分组 |
| `message_summary` | 消息摘要 |
| `status` | `pending` / `sent` / `failed` / `skipped` |
| `error_message` | 失败原因 |
| `retry_count` | 重试次数 |
| `sent_at` | 发送时间 |
| `created_at` / `updated_at` | ISO 8601 时间 |

## 后端 API 设计

### 申请与处理

- `POST /api/v1/fleet/fuel-applications`
  - 保持现有提交入口。
  - 提交后执行规则评估，写入 `fuel_quota_rule_hit`。
  - 更新申请 `risk_level` / `risk_summary`。
  - 写入 `event_log`：`fuel_quota_application_submitted`。
  - 创建企微通知记录：`submitted`。

- `POST /api/v1/fleet/fuel-applications/:id/process`
  - 保持通过/拒绝处理。
  - 通过时回写 `fuel_card.latest_balance` 并写 `fuel_card_balance_log`。
  - 写入 `api_audit_log` 和 `event_log`。
  - 创建处理结果通知记录。

- `POST /api/v1/fleet/fuel-applications/:id/request-info`
  - 新增退回补充。
  - 设置状态为 `needs_info`。
  - 记录 `needs_info_reason`。
  - 创建通知申请人的企微通知记录。

- `POST /api/v1/fleet/fuel-applications/:id/resubmit`
  - 新增补充后重新提交。
  - 允许申请人更新里程、照片、备注。
  - 状态回到 `pending`。
  - 重新执行规则评估并记录补充次数。

### 规则与审计

- `GET /api/v1/fleet/rule-policies`
- `POST /api/v1/fleet/rule-policies`
- `PUT /api/v1/fleet/rule-policies/:id`
- `POST /api/v1/fleet/rule-policies/:id/toggle`
- `GET /api/v1/fleet/fuel-applications/:id/rule-hits`
- `GET /api/v1/fleet/notifications`
- `POST /api/v1/fleet/notifications/:id/retry`
- `GET /api/v1/fleet/audit`

规则配置写操作仅 `super_admin` 可用；财务和经理可只读查看规则命中。

### 管理驾驶舱

增强现有：

- `GET /api/v1/dashboard/vehicle-fuel-overview`

新增或扩展返回：

- 本期申请金额、通过金额、申请笔数。
- 活跃油卡余额总额。
- 低余额油卡数量。
- 余额异常变动数量。
- 在用车辆数、本期有申请车辆数、用油覆盖率。
- 公司车/员工车结构。
- 健康状态：`healthy` / `watch` / `risk`。
- 健康摘要：管理层可读的一句话说明。
- 二级钻取：余额健康分组、车辆用油排行、处理效率。

## 企微通知设计

通知通过事件或定时任务驱动，发送状态落入 `fleet_wecom_notification`。

| 场景 | 触发 | 接收人 | 内容 |
| --- | --- | --- | --- |
| 提交后 | `fuel_quota_application_submitted` | 财务/办公室 | 申请人、车辆、油卡、额度、风险摘要、处理入口 |
| 超时未处理 | 定时任务扫描 `pending` 超过阈值 | 财务/办公室 | 超时申请列表、处理入口 |
| 处理通过 | `process` 成功 | 申请人 | 通过结果、处理后余额、备注 |
| 拒绝 | `process` 拒绝 | 申请人 | 拒绝原因、备注 |
| 退回补充 | `request-info` | 申请人 | 补充原因、小程序/Web 补充入口 |
| 余额预警 | 余额低于规则阈值或变动异常 | 财务/办公室 | 卡号、余额、最近变动、建议复核 |

通知失败不影响主业务处理，但必须可查询、可重试。

## Web 信息架构

建议菜单重组为：

1. 油卡申请
   - 面向员工/现场操作员。
   - 路径保留 `/workspace/fuel-application`。
   - 展示本人可用油卡、最近申请、待补充申请。

2. 油卡处理工作台
   - 面向财务/办公室。
   - 队列分组：待处理、待补充、今日已处理、超时。
   - 列表和右侧详情联动。
   - 详情包含申请字段、照片、规则命中、历史申请、油卡余额日志。
   - 操作：通过并回写余额、退回补充、拒绝。

3. 车辆油卡档案
   - 聚焦车辆档案、油卡档案、员工绑定、余额日志。
   - 从当前 `vehicles.vue` 中拆出办公室处理逻辑。

4. 用油健康总览
   - 面向经理和管理人员。
   - 首屏优先成本和余额健康。
   - 异常和处理效率作为二级钻取。

5. 规则与审计中心
   - 面向超级管理员。
   - 包含规则配置、规则命中查询、企微通知记录、操作审计、废除记录。

旧路由应尽量保留重定向或兼容组件，避免已有入口失效。

## 小程序设计

`packages/miniapp/pages/fuel-apply/index.*` 保持轻量，不承载复杂管理能力。

增强点：

1. 提交前展示本人绑定油卡、余额、最近一次申请结果。
2. 提交后展示待处理状态、提交时间、处理结果。
3. 支持 `needs_info` 退回补充：
   - 展示补充原因。
   - 允许更新里程、照片、备注。
   - 补充提交后回到待处理。
4. 继续保留全屏 loading 和防重复提交。
5. 失败时保留用户输入，允许重试。

## 管理驾驶舱指标口径

首屏保留：

- 本期申请总额。
- 本期通过金额。
- 本期申请笔数。
- 活跃油卡余额总额。
- 低余额油卡数量。
- 余额异常变动数量。
- 在用车辆数量。
- 本期有用油申请车辆数量。
- 用油覆盖率。
- 综合健康状态和健康摘要。

二级区域：

- 用油成本趋势。
- 油卡余额健康分组。
- 车辆用油排行。
- 公司车/员工车结构。
- 长期无申请车辆。
- 待处理数、平均处理时长、超时数。

管理首页不展示逐单待办明细，逐单处理留在办公室工作台。

## 权限设计

| 能力 | super_admin | manager | finance | site_manager | operator |
| --- | --- | --- | --- | --- | --- |
| 提交油卡申请 | 是 | 是 | 是 | 是 | 是 |
| 查看本人申请 | 是 | 是 | 是 | 是 | 是 |
| 处理油卡申请 | 是 | 否 | 是 | 否 | 否 |
| 查看用油健康总览 | 是 | 是 | 是 | 可只读 | 否 |
| 维护车辆档案 | 是 | 是 | 是 | 可按现有策略保留 | 否 |
| 维护油卡和绑定 | 是 | 否 | 是 | 否 | 否 |
| 配置规则 | 是 | 否 | 否 | 否 | 否 |
| 查看审计中心 | 是 | 可只读摘要 | 可只读相关 | 否 | 否 |
| 废除申请 | 是 | 否 | 否 | 否 | 否 |

实际路由权限以现有 `requireRoles` 和 Web 路由 `meta.roles` 为准，实施时保持最小必要开放。

## 审计设计

必须写审计的动作：

- 创建、更新、启停规则。
- 提交油卡申请。
- 退回补充。
- 补充后重新提交。
- 通过、拒绝、废除申请。
- 回写油卡余额。
- 手动重试企微通知。
- 修改油卡绑定。

事件类记录写 `event_log`，操作类记录写 `api_audit_log`。余额变化继续写 `fuel_card_balance_log`。

## 测试策略

后端：

- 申请提交时规则命中写入。
- 处理通过时余额回写和余额日志一致。
- 退回补充后状态流转正确。
- 补充后重新提交会重新评估规则。
- 通知记录创建、失败、重试状态正确。
- 规则配置权限仅超管可写。

Web：

- 员工只能看到自己的申请和补充入口。
- 财务可以处理待办并查看规则命中。
- 经理默认进入健康总览，不出现逐单处理主动作。
- 超管可以进入规则与审计中心。
- 旧路由兼容或重定向可达。

小程序：

- 提交申请成功后状态展示正确。
- `needs_info` 可以补充材料并重新提交。
- 重复提交被 loading 和接口幂等保护。

端到端角色验证：

- `operator`：提交、查看、补充。
- `finance`：收到待办、处理、回写余额。
- `manager`：查看总览和二级钻取。
- `super_admin`：配置规则、查审计、废除异常申请。

## 文档更新要求

实施时必须同步：

- `doc/UI设计文档.md`
  - 更新车辆油卡页面映射、角色入口、规则审计中心、小程序补充状态。
- `doc/开发记录.md`
  - 按 `## YYYY-MM-DD HH:mm (TZ)` 追加本次开发记录。
- `doc/README.md`
  - 若新增长期维护文档入口，则补充索引。
- 培训手册：
  - `doc/guide/02-经理手册.md`
  - `doc/guide/04-现场操作员手册.md`
  - `doc/guide/05-财务手册.md`

## 建议实施顺序

1. 数据迁移与后端 API 主干。
2. Web 员工申请页和油卡处理工作台。
3. 小程序退回补充与状态展示。
4. 企微通知与超时提醒。
5. 管理驾驶舱增强。
6. 规则与审计中心。
7. 文档、角色测试、端到端验证。

## 兼容与迁移

- 历史 `pending` / `processed` / `rejected` / `cancelled` 状态保持原义。
- 新增 `needs_info` 不影响旧数据。
- 旧申请没有规则命中记录时，页面展示为“无规则记录”而不是错误。
- 旧路由保留重定向或兼容入口。
- 油卡余额以 `fuel_card.latest_balance` 为当前值，`fuel_card_balance_log` 为变动事实。

## 风险与约束

- 规则口径必须在配置中固定，避免不同页面各自计算。
- 企微通知不能阻塞主业务流程，但必须留痕并支持重试。
- 小程序不应承载复杂管理功能，避免一线页面过重。
- 管理驾驶舱必须坚持全公司默认口径，避免过滤条件导致“无数据”误判。
- 所有用户关联继续使用企业微信 `userid`。
