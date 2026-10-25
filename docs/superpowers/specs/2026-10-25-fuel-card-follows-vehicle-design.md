# 油卡跟车走：油卡额度申请按车选卡 设计

日期：2026-10-25 · 状态：owner 已批准（2026-10-25）；上线不做初始绑定，办公室 2026-10-26（周一）在档案页手动绑卡（owner 2026-10-25 决定）

## 1. 为什么要改

公司有一部分车是多人轮流开的，而实体油卡是放在车上、跟着车走的。系统现在把油卡绑在人身上：申请油卡额度时，油卡下拉只显示"绑给我的卡"，后端也拒绝不是绑给本人的卡。结果是借开别人常开的车时，申请人看不到这辆车的卡，申请不了。

生产上已经出现过：2026-10-12，刘昆用自己的 11 号卡为京JKV288 申请被拒；同一天 7 号卡被追加绑定给另一个账号（`GangTieZhangChengTieLuDingGuan_1`），由这个账号拿 7 号卡给京JKV288 申请才通过。现在的绕法就是"把车上那张卡挨个绑给每个可能开它的人"。

## 2. 现状（2026-10-25 调查）

### 代码

- 车辆 `company_vehicle`：只有手填的"权属人" `owner_name` 文本，不和员工账号关联。申请页的车辆下拉列出所有启用中的车。
- 油卡 `fuel_card`：通过 `fuel_card_user_binding`（0033 迁移）绑到员工 `userid`。
  - `GET /api/v1/fleet/fuel-cards`：`mine=true` 或非全局角色（非 super_admin/manager/finance）只返回绑给本人的卡；同时返回 `bind_userids` / `bind_user_count` 聚合字段。
  - `POST /api/v1/fleet/fuel-applications`：校验油卡 active，且油卡与 `auth.sub` 存在有效绑定（`packages/api/src/routes/fleet.ts:718`）。**不校验车和卡是否对应。**
  - `GET /fuel-cards/:id/balance-logs`：非全局角色要求本人绑定该卡。
- 车卡绑定：0032 迁移就建了 `fuel_card_vehicle_binding`（唯一索引 `(fuel_card_id, vehicle_id)`），以及 `POST /fuel-cards/:id/bind-vehicle`（裸 INSERT，无校验、无解绑）。Web/小程序都不调用，申请流程也不读。
- 历史：最初设计就是"按车辆绑卡"，0033 才切换为"员工绑定视角"（开发记录 2026-03 phase23 条目），当时未记录切换原因。本次等于切回车辆视角，并支持一车多卡。
- 申请单本身同时记录 `vehicle_id` 与 `fuel_card_id`。风控规则中"里程增量"按车算，"单人每月次数"按人算，"油卡余额"按卡算。
- 财务处理接口允许传 `fuel_card_id` 改卡，但处理工作台 UI 只回传原卡，没有改卡入口。

### 生产数据（只读查询）

- 车辆 9 辆（公司车 5、员工私车 4），全部 active；油卡 10 张，全部 active；油卡-员工绑定 11 条（7 号卡绑了 2 人）；**车卡绑定 0 条**；`company_vehicle_mileage_log` 0 条；申请 45 单，当前 1 单 `needs_info`（#41，常艳臣，京MKG902，5 号卡），无 `pending`。
- 多人共用的车 4 辆：京MKG902、蒙B170Q2、蒙B469Q6、京JKV288。
- 历史上同一张卡出现在多辆车上：5 号卡用于 3 辆车，6、7 号卡各用于 2 辆车。这是旧规则逼大家只能选自己名下的卡造成的，**历史 `fuel_card_id` 不能直接当成车卡对应关系**。

## 3. 已定规则（owner 2026-10-25 确认）

1. 油卡归属于车，不再归属于人。
2. 任何人可以为任何（启用中的）车辆的油卡申请额度。
3. 一辆车可以有 N 张油卡。
4. 一张卡同一时刻只属于一辆车；卡可以从一辆车转到另一辆车，转移要留历史。
5. 员工绑卡在申请流程中彻底拿掉；`fuel_card_user_binding` 表保留不删（软删原则），不再读写。
6. 申请流程：先选车 → 油卡下拉只出现这辆车名下的启用卡（只有一张时自动选中）→ 填额度、里程、照片 → 提交。后端校验"卡当前有效地挂在这辆车上，且卡、车都 active"。
7. 没有配卡的车不能申请，页面提示联系办公室配卡。
8. 财务处理时如要改卡，只能改为同一辆车名下的另一张有效卡。
9. 风控规则不改。
10. 历史申请单不回改。

## 4. 目标 / 非目标 / 反目标

**目标**
- 任何员工开任何车，都能在 Web 和小程序为该车的卡申请额度，不再需要办公室"把卡绑给人"。
- 办公室能在 Web 车辆油卡档案里维护"哪张卡在哪辆车上"，包括转移和解绑，并有记录可查。
- 申请时不可能再选到不属于这辆车的卡。

**非目标**
- 不做"每辆车的指定驾驶员名单"或任何驾驶员白名单。
- 不改风控规则、不新增"单车每月次数"规则。
- 不做油卡停用/编辑接口（现有系统也没有），不清洗历史里程数据，不接入通用审批流。
- 不改车辆档案的"权属人"字段语义。

**反目标（即使功能跑通，出现以下任一也算失败）**
- 单人单车单卡的员工（目前 5 辆车属于这种情况）提交步骤变多：选完车后卡必须自动带出。
- 在途申请（`needs_info` 的 #41）因新校验无法补充或无法处理。
- 历史申请单显示的车/卡被改动，或余额流水丢失关联。
- 小程序新版本审核上线之前，旧版小程序完全无法申请。

## 5. 设计

### 5.1 数据模型

`fuel_card_vehicle_binding` 在生产为空表（2026-10-25 已核实 0 行），用新迁移 `0090_fuel_card_vehicle_binding_rebuild.sql`（编号以实现时最新为准）重建，表名保持不变：

| 字段 | 说明 |
| --- | --- |
| `id` | 主键 |
| `fuel_card_id` | FK → `fuel_card.id` |
| `vehicle_id` | FK → `company_vehicle.id` |
| `status` | `active` / `inactive` |
| `bound_at` / `bound_by_userid` | 绑定时间与操作人 |
| `unbound_at` / `unbound_by_userid` | 解绑或转出时间与操作人，active 时为 NULL |
| `created_at` / `updated_at` | |

索引：
- `CREATE UNIQUE INDEX idx_fuel_card_vehicle_binding_active_card ON fuel_card_vehicle_binding(fuel_card_id) WHERE status = 'active'`，保证一张卡同时只挂一辆车。
- `idx_fuel_card_vehicle_binding_vehicle_id`（按车查卡）。
- 去掉旧的 `(fuel_card_id, vehicle_id)` 唯一索引，否则卡转出后无法再转回同一辆车。

历史以行保留：转移 = 旧行置 `inactive` + 写 `unbound_*`，再插入新行。【我的决定】迁移前需再次确认表为空；若非空则停止并人工处理，不要自动丢数据。

`fuel_card_user_binding` 不动。

### 5.2 API（`packages/api/src/routes/fleet.ts`）

- `GET /fuel-cards`
  - 去掉用户绑定 JOIN、`bind_userids` / `bind_user_count` 字段和"非全局角色只看本人"的限制；所有已登录角色都可查看油卡列表与余额。【我的决定：余额对所有人可见】
  - 新增返回当前绑定车辆：`vehicle_id`、`vehicle_plate_no`（未绑定为 NULL）。
  - 新增查询参数 `vehicle_id`：只返回当前有效挂在该车上的卡。
  - 兼容：仍接受 `mine=true` 但忽略它（旧版小程序会带这个参数，见 5.5）。
- `POST /fuel-cards/:id/bind-vehicle`（重写，角色不变：super_admin/manager/finance）
  - 校验卡存在且 active、车存在且 active。
  - 卡已挂在同一辆车上：幂等返回成功。
  - 卡挂在另一辆车上：关闭旧绑定并绑定新车（即"转移"），一次请求完成。
  - 写 `api_audit_log`（`target_type = fuel_card`，action 如 `fuel_card_bind_vehicle`，detail 带 from/to vehicle）。
  - 两步写在 D1 上不是真事务（见记忆：`runInTransaction` 在生产静默降级）。实现须保证中途失败不会留下"一卡两车"：部分唯一索引兜底，先关旧再插新，插入失败时如实报错，允许重试恢复。
- `POST /fuel-cards/:id/unbind-vehicle`（新增，同角色）：关闭该卡当前有效绑定并写审计；卡未绑定时返回 400。
- `GET /fuel-cards/:id/vehicle-bindings`（新增，全局角色）：返回该卡的绑定历史，供档案页查看。【我的决定：可以并入现有"查看记录"弹窗】
- `POST /fuel-cards/:id/bind-user`：删除路由。【我的决定】
- `POST /fuel-applications`
  - 删除用户绑定校验。
  - 新增校验：车存在且 active；卡存在且 active；存在 `(fuel_card_id, vehicle_id, status='active')` 绑定。失败分别返回 400，错误信息由服务端直接返回中文，如"所选车辆无效或已停用""该油卡不属于所选车辆"。【我的决定】小程序 `utils/error-message.js` 遇到中文会原样显示（`localizeErrorMessage` 里的 `hasChinese` 分支），所以旧版小程序也能看懂，不需要另加映射。
- `POST /fuel-applications/:id/resubmit`：不改。车和卡在补充时本来就锁定，不重新校验绑定，保证 #41 这类在途单可以补充。
- `POST /fuel-applications/:id/process`：只有当请求里的 `fuel_card_id` 与申请单当前的卡不同，才要求新卡有效挂在申请单的车上；没传或相同则不校验绑定（兼容历史单）。现有"卡必须 active"的校验保留。
- `GET /fuel-cards/:id/balance-logs`：去掉"本人绑定"分支，改为仅全局角色可看（目前只有档案页使用）。【我的决定】
- `GET /vehicles`：不改返回结构。是否在列表里附带每辆车的卡数/卡号由实现决定（档案页需要显示）。

风控上下文 `loadFuelRuleContext` 不改。

### 5.3 Web

- `views/finance/fleet/vehicles.vue`（车辆油卡档案）
  - "油卡管理"页签：删掉"绑定员工"表单和"绑定员工"列；新增"所属车辆"列，以及"绑定/转移到车辆""解绑"操作。转移前确认（"该卡当前在 X 车上，确定转到 Y 车？"）。
  - "车辆档案"页签：新增"油卡"列，显示该车当前所有卡号。
  - 车辆停用时不自动解绑它的卡，档案页照常显示这些卡；申请会被"车辆已停用"的校验挡住。【我的决定】
  - 操作记录弹窗可展示车卡绑定历史。
- `views/finance/fleet/application.vue`（Web 申请页，也用于工作台隐式路由 `/workspace/fuel-application`）
  - 车辆下拉可搜索，显示车牌（+车型）。
  - 选车后按 `vehicle_id` 拉卡；只有一张时自动选中；换车时清空已选卡；卡选项显示卡号与余额。
  - 选中的车没配卡：显示提示"该车辆尚未配置油卡，请联系办公室"，并禁用提交。
  - 删掉 `listMyFuelCards`。
- `api/fleet.ts`：`FuelCard` 类型去掉 `bind_userids` / `bind_user_count`，加 `vehicle_id` / `vehicle_plate_no`；新增 bind/unbind/绑定历史的封装；删除 `bindFuelCardUser`。
- 处理工作台、全量记录页：不需要改，已经展示申请单上的车和卡。

### 5.4 小程序（`packages/miniapp/packageFinance/fuel-apply/`）

与 Web 申请页行为一致：选车 → 按车拉卡 → 单卡自动选中 → 无卡提示并禁止提交。车辆选择器可以换成已有的 `hy-search-picker`（原生 picker 的可搜索替代，`range/value/detail.value` 下标语义不变）。页面在 `packageFinance` 分包，不占主包体积。

"补充资料"流程：车和卡都锁定，显示申请单上记录的卡；不按车重新拉卡，也不触发"该车未配卡"的拦截，因为 resubmit 接口本来就不重新校验绑定。【我的决定】Web 的补充弹窗本来就不涉及车和卡，不用改。

### 5.5 发布顺序与兼容

push 到 main 会自动部署 API 和 Web，但小程序要提审，有时间差。

1. 应用迁移（`--remote --env prod`）。
2. push，API 与 Web 自动部署（约 90 秒）。
3. **不做初始绑定**（owner 2026-10-25 决定）：上线后所有卡都处于"未绑定"，由办公室在 2026-10-26（周一）进入"车辆油卡档案 / 油卡管理"逐张"绑定车辆"，系统自动留审计。上线到办公室绑完之间，所有渠道的申请都会因"该车辆尚未配置油卡"或"该油卡不属于所选车辆"被拦下，这是已接受的空窗期。
4. 小程序提审上线。

旧版小程序在过渡期：仍请求 `fuel-cards?mine=true&status=active`，新 API 会返回全部启用卡（不再按人过滤），旧页面车和卡分别选择。选错组合时后端拒绝，旧版小程序会原样显示服务端返回的中文错误信息（见 5.2）。

### 5.6 测试

- `packages/api/src/services/fleet-governance.test.ts` 中依赖 `fuel_card_user_binding` / `bind.bind_userid` 的用例改为车卡绑定语义。
- 新增用例：
  - 绑定、幂等重复绑定、转移、解绑；
  - 转回原车（验证旧唯一索引已去掉）；
  - 申请时车卡不匹配、车 inactive、卡 inactive、车无卡；
  - process 改卡到别的车的卡被拒；
  - resubmit 不受绑定影响。
- Web：申请页"单卡自动选中 / 换车清空 / 无卡禁用"可以抽成纯函数并写 Vitest。
- 小程序：如抽出纯函数，按现有 `node utils/<name>.test.js` 形式测试。

### 5.7 文档

按仓库约定更新：
- `doc/开发记录.md`（追加一条）
- `doc/UI设计文档.md` 第 8 节
- `doc/guide/04-现场操作员手册.md`：把"本人绑定油卡"改为"所选车辆的油卡"
- `doc/guide/05-财务手册.md`：如涉及配卡操作

## 6. 车卡对应关系参考（供办公室绑卡时对照）

不再由系统或 Claude 写入初始绑定，以办公室按实物核对后的手动绑定为准。下表只是根据历史申请推出来的参考：前 6 条基本可以确定；3、5、6、10 号卡历史记录有矛盾，需要办公室按实际情况判断。

| 卡 | 卡号尾号 | 历史使用情况 | 草稿归属 |
| --- | --- | --- | --- |
| 2 | …2427 | 只用于京AMZ155 | 京AMZ155 |
| 4 | …2429 | 只用于京AFX7213 | 京AFX7213 |
| 7 | …2434 | 京JKV288 ×多次，京MKG902 ×2（肖连忠） | 京JKV288 |
| 8 | …3473 | 只用于京CU3438 | 京CU3438 |
| 9 | …3474 | 只用于京NTU010 | 京NTU010 |
| 11 | …3472 | 冀R202BB ×多次（另有 2 单被拒/废除） | 冀R202BB |
| 3 | …2428 | 只用于京MKG902（LiuYongChao） | 京MKG902？ |
| 5 | …2430 | 蒙B469Q6、蒙B170Q2、京MKG902 都用过（常艳臣） | **待定** |
| 6 | …2431 | 蒙B170Q2 ×3、蒙B469Q6 ×1（刘鹏） | 蒙B170Q2？ |
| 10 | …3471 | 从未用于申请 | **待定** |

初始绑定和之后的日常调整（新卡、转移、解绑）都由办公室在档案页操作。

## 7. 留给实现者

- 按车查卡的接口形态：`GET /fuel-cards?vehicle_id=` 或 `GET /vehicles/:id/fuel-cards`，二选一。
- 车辆列表是否附带卡信息，以及附带的方式。
- 档案页里绑定/转移的交互：行内操作或弹窗都可以。
- 错误信息的具体中文文案。
- 迁移文件的具体编号与写法（须满足 5.1 的约束）。
