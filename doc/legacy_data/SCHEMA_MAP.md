# 旧财务数据结构映射与迁移兼容性分析

**生成日期**: 2026-02-28  
**数据源**: `doc/legacy_data/fin_data/` (7个Excel文件)  
**目标**: 映射到 `packages/api/migrations/` 中的财务表结构

---

## 1. 文件清单与行数统计

| 文件名 | 行数 | 主要用途 | 映射目标表 |
|--------|------|---------|----------|
| `对外付款申请_20260228101021.xlsx` | 74 | 付款申请流程 | `payment_request` |
| `对外付款合同结算管理_20260228101109.xlsx` | 31 | 合同管理 | `contract` |
| `个人报销预申请_20260228101235.xlsx` | 125 | 报销预申请 | `reimbursement_envelope` |
| `个人报销集中申报_20260228101252.xlsx` | 2090 | 报销集中申报 | `reimbursement_batch` |
| `常用收款人（外部）_20260228101032.xlsx` | 181 | 外部收款人目录 | `payee` |
| `常用收款人（内部）_20260228101145.xlsx` | 25 | 内部收款人目录 | `payee` |
| `公司目录（我方）_20260228101307.xlsx` | 14 | 公司/实体目录 | `entity` |

**总计**: 2,540 条数据记录

---

## 2. 详细字段映射与兼容性分析

### 2.1 对外付款申请 → `payment_request` + `payee`

#### 源表结构 (31列)
```
data_id | 流水号 | 申请人 | 预计付款日期 | 报销类别 | 所属项目/工程 | 工程全称 | 合同号 | 合同状态 | 
付款内容（详情） | 付款金额 | 付款金额大写 | 发票类型 | 上传发票 | 备注 | 
收款单位/收款人 | 收款方开户行信息 | 收款方账号 | 收款方电话 | 付款方式 | 办理人 | 
指定日期付款 | 指定付款日期 | 付款凭证上传 | 实际付款日期 | 提交人 | 提交时间 | 更新时间 | 
流程状态 | 当前节点 | 当前负责人
```

#### 字段映射表

| 旧字段 | 数据类型 | 非空率 | 目标表 | 目标字段 | 兼容性 | 备注 |
|--------|---------|--------|--------|---------|--------|------|
| `data_id` | TEXT | 100% | payment_request | `legacy_data_id` | ✅ 完全兼容 | 用于去重和追溯 |
| `流水号` | TEXT | 100% | payment_request | `serial_no` | ✅ 完全兼容 | 已有UNIQUE约束 |
| `申请人` | TEXT | 100% | payment_request | `applicant_userid` | ⚠️ 需映射 | 需从名字映射到WeCom userid |
| `预计付款日期` | DATETIME | 100% | payment_request | `expected_payment_date` | ✅ 完全兼容 | ISO 8601转换 |
| `报销类别` | TEXT | 100% | payment_request | `category` | ✅ 完全兼容 | 值: 行政费/机械费/劳务费/材料费 |
| `所属项目/工程` | TEXT | 100% | payment_request | `project_id` | ⚠️ 需映射 | 需从工程名映射到project_id |
| `工程全称` | TEXT | 100% | - | - | ℹ️ 参考字段 | 用于项目匹配验证 |
| `合同号` | TEXT | 74% | payment_request | `contract_id` | ⚠️ 可选 | 26%的记录无合同号 |
| `合同状态` | TEXT | 74% | - | - | ℹ️ 参考字段 | 仅用于验证 |
| `付款内容（详情）` | TEXT | 100% | payment_request | `content` | ✅ 完全兼容 | 详细描述 |
| `付款金额` | FLOAT | 100% | payment_request | `amount` | ✅ 完全兼容 | 数值类型 |
| `付款金额大写` | TEXT | 100% | payment_request | `amount_cn` | ✅ 完全兼容 | 已生成，可直接使用 |
| `发票类型` | TEXT | 100% | - | - | ℹ️ 参考字段 | 值: 无发票/普票/专票 |
| `上传发票` | TEXT | 82% | payment_request | `attachments_json` | ⚠️ 需转换 | 文件key，需转为JSON数组 |
| `备注` | TEXT | 45% | payment_request | `remark` | ✅ 完全兼容 | 可选字段 |
| `收款单位/收款人` | TEXT | 100% | payee | `name` | ✅ 完全兼容 | 创建或关联payee |
| `收款方开户行信息` | TEXT | 100% | payee | `bank_name` | ✅ 完全兼容 | 银行名称 |
| `收款方账号` | TEXT | 100% | payee | `bank_account` | ✅ 完全兼容 | 账户号 |
| `收款方电话` | TEXT | 41% | payee | `phone` | ✅ 完全兼容 | 可选字段 |
| `付款方式` | TEXT | 99% | - | - | ℹ️ 参考字段 | 描述性字段，不直接映射 |
| `办理人` | TEXT | 99% | - | - | ℹ️ 参考字段 | 处理人员，可记录在审批日志 |
| `指定日期付款` | TEXT | 1% | - | - | ⚠️ 极少使用 | 仅1条记录有值 |
| `指定付款日期` | DATETIME | 100% | - | - | ℹ️ 参考字段 | 与预计付款日期重复 |
| `付款凭证上传` | TEXT | 93% | - | - | ⚠️ 需处理 | 文件key，应存储在R2或扩展字段 |
| `实际付款日期` | DATETIME | 100% | - | - | ℹ️ 参考字段 | 可记录在payment_execution表 |
| `提交人` | TEXT | 100% | - | - | ℹ️ 审计字段 | 记录在created_by或审计日志 |
| `提交时间` | DATETIME | 100% | payment_request | `created_at` | ✅ 完全兼容 | ISO 8601转换 |
| `更新时间` | DATETIME | 100% | payment_request | `updated_at` | ✅ 完全兼容 | ISO 8601转换 |
| `流程状态` | TEXT | 100% | payment_request | `status` | ⚠️ 需映射 | 值映射: 进行中→pending_approval, 流转完成→approved/paid |
| `当前节点` | TEXT | 11% | - | - | ℹ️ 审批字段 | 记录在approval_instance |
| `当前负责人` | TEXT | 11% | - | - | ℹ️ 审批字段 | 记录在approval_instance |

#### 关键发现
- **去重主键**: `data_id` (100% 非空)
- **业务主键**: `serial_no` (100% 非空，UNIQUE)
- **缺失映射**: `applicant_userid` 需从名字反向查询WeCom
- **可选关联**: `contract_id` (26%缺失，需处理)
- **文件存储**: 发票和凭证需转移到R2，仅存储key

---

### 2.2 对外付款合同结算管理 → `contract`

#### 源表结构 (19列)
```
data_id | 合同号 | 所属工程 | 工程全称 | 合同类型 | 经办人 | 合同日期 | 
合同甲方 | 合同乙方 | 合同金额 | 合同金额大写 | 合同内容 | 合同扫描件 | 
提交人 | 提交时间 | 更新时间 | 流程状态 | 当前节点 | 当前负责人
```

#### 字段映射表

| 旧字段 | 数据类型 | 非空率 | 目标表 | 目标字段 | 兼容性 | 备注 |
|--------|---------|--------|--------|---------|--------|------|
| `data_id` | TEXT | 100% | contract | `legacy_data_id` | ✅ 完全兼容 | 用于去重 |
| `合同号` | TEXT | 100% | contract | `contract_no` | ✅ 完全兼容 | UNIQUE约束 |
| `所属工程` | TEXT | 100% | contract | `project_id` | ⚠️ 需映射 | 从工程名映射到project_id |
| `工程全称` | TEXT | 100% | - | - | ℹ️ 参考字段 | 用于验证 |
| `合同类型` | TEXT | 100% | contract | `contract_type` | ✅ 完全兼容 | 值: 人工/机械/总包/其他 |
| `经办人` | TEXT | 100% | contract | `handler_userid` | ⚠️ 需映射 | 从名字映射到WeCom userid |
| `合同日期` | DATETIME | 100% | contract | `contract_date` | ✅ 完全兼容 | ISO 8601转换 |
| `合同甲方` | TEXT | 100% | contract | `counterparty` | ✅ 完全兼容 | 对方单位名称 |
| `合同乙方` | TEXT | 100% | - | - | ℹ️ 参考字段 | 应为我方(entity)，可验证 |
| `合同金额` | FLOAT | 100% | contract | `total_amount` | ✅ 完全兼容 | 数值类型 |
| `合同金额大写` | TEXT | 100% | - | - | ℹ️ 参考字段 | 已生成，可验证 |
| `合同内容` | TEXT | 100% | contract | `remark` | ✅ 完全兼容 | 合同摘要 |
| `合同扫描件` | TEXT | 100% | contract | `attachments_json` | ⚠️ 需转换 | 文件key，转为JSON数组 |
| `提交人` | TEXT | 100% | - | - | ℹ️ 审计字段 | 记录在created_by |
| `提交时间` | DATETIME | 100% | contract | `created_at` | ✅ 完全兼容 | ISO 8601转换 |
| `更新时间` | DATETIME | 100% | contract | `updated_at` | ✅ 完全兼容 | ISO 8601转换 |
| `流程状态` | TEXT | 100% | contract | `status` | ⚠️ 需映射 | 值映射: 进行中→pending_approval, 流转完成→active |
| `当前节点` | TEXT | 20% | - | - | ℹ️ 审批字段 | 记录在approval_instance |
| `当前负责人` | TEXT | 20% | - | - | ℹ️ 审批字段 | 记录在approval_instance |

#### 关键发现
- **去重主键**: `data_id` (100% 非空)
- **业务主键**: `contract_no` (100% 非空，UNIQUE)
- **缺失映射**: `handler_userid` 需从名字反向查询
- **方向字段**: 所有记录应为 `direction='outbound'`
- **实体字段**: `entity_id` 需从合同乙方推断或手动配置

---

### 2.3 个人报销预申请 → `reimbursement_envelope`

#### 源表结构 (20列)
```
data_id | 流水号 | 费用发生日期 | 所属工程 | 报销类别 | 报销内容 | 报销金额 | 金额大写 | 
票据类型 | 附件上传 | 报销备注 | 报销状态 | 是否收到发票 | 票据信息与报销信息是否一致 | 
提交人 | 提交时间 | 更新时间 | 流程状态 | 当前节点 | 当前负责人
```

#### 字段映射表

| 旧字段 | 数据类型 | 非空率 | 目标表 | 目标字段 | 兼容性 | 备注 |
|--------|---------|--------|--------|---------|--------|------|
| `data_id` | TEXT | 100% | reimbursement_envelope | `legacy_data_id` | ✅ 完全兼容 | 用于去重 |
| `流水号` | TEXT | 100% | reimbursement_envelope | `envelope_no` | ✅ 完全兼容 | 业务流水号 |
| `费用发生日期` | DATETIME | 100% | reimbursement_envelope | `expense_date` | ✅ 完全兼容 | ISO 8601转换 |
| `所属工程` | TEXT | 100% | reimbursement_envelope | `project_id` | ⚠️ 需映射 | 从工程名映射到project_id |
| `报销类别` | TEXT | 100% | reimbursement_envelope | `category` | ✅ 完全兼容 | 值: 行政费/机械费/劳务费/材料费 |
| `报销内容` | TEXT | 100% | reimbursement_envelope | `description` | ✅ 完全兼容 | 详细描述 |
| `报销金额` | FLOAT | 100% | reimbursement_envelope | `amount` | ✅ 完全兼容 | 数值类型 |
| `金额大写` | TEXT | 100% | - | - | ℹ️ 参考字段 | 已生成，可验证 |
| `票据类型` | TEXT | 100% | - | - | ℹ️ 参考字段 | 值: 无发票/普票/专票/收据/车票 |
| `附件上传` | TEXT | 100% | envelope_attachment | `file_key` | ⚠️ 需转换 | 逗号分隔的文件key，需拆分 |
| `报销备注` | TEXT | 0% | reimbursement_envelope | `remark` | ✅ 完全兼容 | 所有记录为空 |
| `报销状态` | TEXT | 100% | - | - | ℹ️ 参考字段 | 值: 集中申报/已完成 |
| `是否收到发票` | TEXT | 100% | - | - | ℹ️ 参考字段 | 值: 无需发票/是 |
| `票据信息与报销信息是否一致` | TEXT | 100% | - | - | ℹ️ 参考字段 | 值: 一致 |
| `提交人` | TEXT | 100% | reimbursement_envelope | `applicant_userid` | ⚠️ 需映射 | 从名字映射到WeCom userid |
| `提交时间` | DATETIME | 100% | reimbursement_envelope | `submitted_at` | ✅ 完全兼容 | ISO 8601转换 |
| `更新时间` | DATETIME | 100% | reimbursement_envelope | `updated_at` | ✅ 完全兼容 | ISO 8601转换 |
| `流程状态` | TEXT | 100% | reimbursement_envelope | `status` | ⚠️ 需映射 | 值映射: 集中申报→draft, 已完成→approved |
| `当前节点` | TEXT | 0% | - | - | ℹ️ 审批字段 | 所有记录为空 |
| `当前负责人` | TEXT | 0% | - | - | ℹ️ 审批字段 | 所有记录为空 |

#### 关键发现
- **去重主键**: `data_id` (100% 非空)
- **业务主键**: `envelope_no` (100% 非空)
- **缺失映射**: `applicant_userid` 需从名字反向查询
- **文件处理**: `附件上传` 为逗号分隔，需拆分到 `envelope_attachment` 表
- **UUID生成**: 需生成 `envelope_uuid` 用于二维码

---

### 2.4 个人报销集中申报 → `reimbursement_batch`

#### 源表结构 (19列)
```
data_id | 待报销人 | 申报日期 | 所属项目/工程 | 报销详情 | 报销总金额 | 总金额大写 | 备注 | 
付款方式 | 办理人 | 指定日期付款 | 指定付款日期 | 付款凭证上传 | 提交人 | 提交时间 | 
更新时间 | 流程状态 | 当前节点 | 当前负责人
```

#### 字段映射表

| 旧字段 | 数据类型 | 非空率 | 目标表 | 目标字段 | 兼容性 | 备注 |
|--------|---------|--------|--------|---------|--------|------|
| `data_id` | TEXT | 33% | reimbursement_batch | `legacy_data_id` | ⚠️ 部分缺失 | 67%的记录为空(子行) |
| `待报销人` | TEXT | 33% | reimbursement_batch | `applicant_userid` | ⚠️ 部分缺失 | 需从名字映射，67%缺失 |
| `申报日期` | DATETIME | 33% | reimbursement_batch | `created_at` | ⚠️ 部分缺失 | 67%缺失 |
| `所属项目/工程` | TEXT | 33% | reimbursement_batch | `project_id` | ⚠️ 部分缺失 | 67%缺失，需映射 |
| `报销详情` | TEXT | 100% | - | - | ℹ️ 参考字段 | 包含流水号，用于关联envelope |
| `报销总金额` | FLOAT | 33% | reimbursement_batch | `total_amount` | ⚠️ 部分缺失 | 67%缺失 |
| `总金额大写` | TEXT | 33% | - | - | ℹ️ 参考字段 | 67%缺失 |
| `备注` | TEXT | 0% | reimbursement_batch | `remark` | ✅ 完全兼容 | 所有记录为空 |
| `付款方式` | TEXT | 29% | - | - | ℹ️ 参考字段 | 67%缺失 |
| `办理人` | TEXT | 29% | - | - | ℹ️ 参考字段 | 67%缺失 |
| `指定日期付款` | TEXT | 0% | - | - | ℹ️ 参考字段 | 所有记录为空 |
| `指定付款日期` | DATETIME | 0% | - | - | ℹ️ 参考字段 | 所有记录为空 |
| `付款凭证上传` | TEXT | 29% | - | - | ⚠️ 需处理 | 67%缺失 |
| `提交人` | TEXT | 33% | - | - | ℹ️ 审计字段 | 67%缺失 |
| `提交时间` | DATETIME | 33% | reimbursement_batch | `created_at` | ⚠️ 部分缺失 | 67%缺失 |
| `更新时间` | DATETIME | 33% | reimbursement_batch | `updated_at` | ⚠️ 部分缺失 | 67%缺失 |
| `流程状态` | TEXT | 33% | reimbursement_batch | `status` | ⚠️ 部分缺失 | 67%缺失 |
| `当前节点` | TEXT | 4% | - | - | ℹ️ 审批字段 | 96%缺失 |
| `当前负责人` | TEXT | 4% | - | - | ℹ️ 审批字段 | 96%缺失 |

#### 关键发现
- **数据结构异常**: 67%的行为"子行"(仅包含报销详情)，主行数据缺失
- **去重主键**: `data_id` 仅33%非空，不可靠
- **关联策略**: 需通过 `报销详情` 字段中的流水号关联到 `reimbursement_envelope`
- **迁移风险**: ⚠️ **高风险** - 需要复杂的数据清洗和重组
- **建议**: 优先迁移 `个人报销预申请` 表，此表作为补充参考

---

### 2.5 常用收款人（外部）→ `payee` (type='external')

#### 源表结构 (8列)
```
data_id | 收款单位 | 收款方开户行 | 收款方账户 | 电话 | 提交人 | 提交时间 | 更新时间
```

#### 字段映射表

| 旧字段 | 数据类型 | 非空率 | 目标表 | 目标字段 | 兼容性 | 备注 |
|--------|---------|--------|--------|---------|--------|------|
| `data_id` | TEXT | 100% | payee | `legacy_data_id` | ✅ 完全兼容 | 用于去重 |
| `收款单位` | TEXT | 100% | payee | `name` | ✅ 完全兼容 | 单位名称 |
| `收款方开户行` | TEXT | 100% | payee | `bank_name` | ✅ 完全兼容 | 银行名称 |
| `收款方账户` | TEXT | 100% | payee | `bank_account` | ✅ 完全兼容 | 账户号 |
| `电话` | TEXT | 68% | payee | `phone` | ✅ 完全兼容 | 可选字段 |
| `提交人` | TEXT | 100% | - | - | ℹ️ 审计字段 | 记录在created_by |
| `提交时间` | DATETIME | 100% | payee | `created_at` | ✅ 完全兼容 | ISO 8601转换 |
| `更新时间` | DATETIME | 100% | payee | `updated_at` | ✅ 完全兼容 | ISO 8601转换 |

#### 关键发现
- **去重主键**: `data_id` (100% 非空)
- **业务主键**: `name` + `bank_account` (组合唯一)
- **完全兼容**: 所有字段都能直接映射
- **类型标记**: 所有记录应设置 `type='external'`
- **状态**: 所有记录应设置 `status='active'`

---

### 2.6 常用收款人（内部）→ `payee` (type='internal')

#### 源表结构 (8列)
```
data_id | 收款人姓名 | 收款方开户行 | 收款方账户 | 电话 | 提交人 | 提交时间 | 更新时间
```

#### 字段映射表

| 旧字段 | 数据类型 | 非空率 | 目标表 | 目标字段 | 兼容性 | 备注 |
|--------|---------|--------|--------|---------|--------|------|
| `data_id` | TEXT | 100% | payee | `legacy_data_id` | ✅ 完全兼容 | 用于去重 |
| `收款人姓名` | TEXT | 100% | payee | `name` | ✅ 完全兼容 | 个人名称 |
| `收款方开户行` | TEXT | 100% | payee | `bank_name` | ✅ 完全兼容 | 银行名称 |
| `收款方账户` | TEXT | 100% | payee | `bank_account` | ✅ 完全兼容 | 账户号 |
| `电话` | TEXT | 88% | payee | `phone` | ✅ 完全兼容 | 可选字段 |
| `提交人` | TEXT | 100% | - | - | ℹ️ 审计字段 | 记录在created_by |
| `提交时间` | DATETIME | 100% | payee | `created_at` | ✅ 完全兼容 | ISO 8601转换 |
| `更新时间` | DATETIME | 100% | payee | `updated_at` | ✅ 完全兼容 | ISO 8601转换 |

#### 关键发现
- **去重主键**: `data_id` (100% 非空)
- **业务主键**: `name` + `bank_account` (组合唯一)
- **完全兼容**: 所有字段都能直接映射
- **类型标记**: 所有记录应设置 `type='internal'`
- **状态**: 所有记录应设置 `status='active'`
- **电话完整性**: 比外部收款人更完整(88% vs 68%)

---

### 2.7 公司目录（我方）→ `entity`

#### 源表结构 (6列)
```
data_id | 公司名称 | 税号 | 提交人 | 提交时间 | 更新时间
```

#### 字段映射表

| 旧字段 | 数据类型 | 非空率 | 目标表 | 目标字段 | 兼容性 | 备注 |
|--------|---------|--------|--------|---------|--------|------|
| `data_id` | TEXT | 100% | entity | `legacy_data_id` | ✅ 完全兼容 | 用于去重 |
| `公司名称` | TEXT | 100% | entity | `entity_name` | ✅ 完全兼容 | 公司名称 |
| `税号` | TEXT | 100% | entity | `tax_id` | ✅ 完全兼容 | 统一社会信用代码 |
| `提交人` | TEXT | 100% | - | - | ℹ️ 审计字段 | 记录在created_by |
| `提交时间` | DATETIME | 100% | entity | `created_at` | ✅ 完全兼容 | ISO 8601转换 |
| `更新时间` | DATETIME | 100% | entity | `updated_at` | ✅ 完全兼容 | ISO 8601转换 |

#### 关键发现
- **去重主键**: `data_id` (100% 非空)
- **业务主键**: `tax_id` (100% 非空，应UNIQUE)
- **完全兼容**: 所有字段都能直接映射
- **数据量小**: 仅13条记录，迁移风险低
- **现有表**: 需检查 `entity` 表是否已有这些记录

---

## 3. 跨表关系与外键映射

### 3.1 关系图

```
payment_request
  ├─ contract_id → contract.id
  ├─ payee_id → payee.id
  ├─ project_id → project.id
  └─ applicant_userid → (WeCom user)

contract
  ├─ project_id → project.id
  ├─ entity_id → entity.id
  └─ handler_userid → (WeCom user)

reimbursement_envelope
  ├─ project_id → project.id
  ├─ applicant_userid → (WeCom user)
  └─ batch_id → reimbursement_batch.id (可选)

reimbursement_batch
  ├─ project_id → project.id
  └─ applicant_userid → (WeCom user)

payee
  └─ created_by_userid → (WeCom user)

entity
  └─ (无外键)
```

### 3.2 关键映射规则

#### 项目映射 (project_id)
- **源字段**: `所属项目/工程` 或 `所属工程`
- **映射策略**:
  1. 优先匹配 `project.project_code` (工程简称，如 "25-15")
  2. 其次匹配 `project.project_name` (工程全称)
  3. 未匹配记录进入"人工确认池"，不直接入库
- **风险**: 项目名称可能变更或不规范

#### 用户映射 (userid)
- **源字段**: `申请人`, `经办人`, `提交人`, `办理人` 等
- **映射策略**:
  1. 从WeCom通讯录查询 `name` 对应的 `userid`
  2. 缓存在KV中，TTL 24小时
  3. 未找到的用户记录到清洗日志，需人工确认
- **风险**: 用户可能已离职或名字重复

#### 实体映射 (entity_id)
- **源字段**: `合同乙方` (对于outbound合同)
- **映射策略**:
  1. 从 `entity` 表查询 `entity_name` 匹配
  2. 对于payment_request，从关联的contract推断
  3. 未匹配记录需人工确认
- **风险**: 实体名称可能不规范

---

## 4. 数据清洗规则

### 4.1 日期字段标准化

| 源格式 | 目标格式 | 规则 |
|--------|---------|------|
| `datetime.datetime` | ISO 8601 TEXT | `strftime('%Y-%m-%dT%H:%M:%SZ')` |
| 空值 | NULL | 保留为NULL |

### 4.2 金额字段标准化

| 源字段 | 目标字段 | 规则 |
|--------|---------|------|
| `付款金额` | `amount` | 直接转REAL，保留小数点后2位 |
| `付款金额大写` | `amount_cn` | 直接使用，无需重新生成 |

### 4.3 文件字段处理

| 源字段 | 目标处理 | 规则 |
|--------|---------|------|
| `上传发票` | `attachments_json` | 逗号分隔→JSON数组: `["key1", "key2"]` |
| `付款凭证上传` | `attachments_json` | 逗号分隔→JSON数组 |
| `合同扫描件` | `attachments_json` | 逗号分隔→JSON数组 |
| `附件上传` | `envelope_attachment` | 逗号分隔→多行记录 |

### 4.4 状态字段映射

#### payment_request.status
```
进行中 → pending_approval
流转完成 → approved (或 paid，需根据实际付款日期判断)
```

#### contract.status
```
进行中 → pending_approval
流转完成 → active
```

#### reimbursement_envelope.status
```
集中申报 → draft
已完成 → approved
```

### 4.5 班次字段标准化 (如适用)
```
白班 → day
夜班 → night
```

---

## 5. 去重与幂等性策略

### 5.1 主键去重

| 表 | 去重字段 | 优先级 | 备注 |
|-----|---------|--------|------|
| payment_request | `legacy_data_id` | 1 | 100%非空 |
| payment_request | `serial_no` | 2 | UNIQUE约束 |
| contract | `legacy_data_id` | 1 | 100%非空 |
| contract | `contract_no` | 2 | UNIQUE约束 |
| reimbursement_envelope | `legacy_data_id` | 1 | 100%非空 |
| reimbursement_envelope | `envelope_no` | 2 | 业务流水号 |
| payee | `legacy_data_id` | 1 | 100%非空 |
| payee | `name + bank_account` | 2 | 组合唯一 |
| entity | `legacy_data_id` | 1 | 100%非空 |
| entity | `tax_id` | 2 | 应UNIQUE |

### 5.2 指纹去重 (当legacy_data_id缺失时)

```sql
-- payment_request
SELECT COUNT(*) FROM payment_request 
WHERE project_id = ? AND serial_no = ? AND amount = ? AND applicant_userid = ?;

-- contract
SELECT COUNT(*) FROM contract 
WHERE project_id = ? AND contract_no = ? AND total_amount = ?;

-- reimbursement_envelope
SELECT COUNT(*) FROM reimbursement_envelope 
WHERE project_id = ? AND envelope_no = ? AND amount = ?;
```

---

## 6. 迁移执行计划

### 6.1 阶段划分

#### 阶段A: 数据提取与清洗 (不入库)
1. 读取所有Excel文件
2. 执行字段映射和类型转换
3. 执行去重检查
4. 生成清洗结果文件 (CSV/JSON)
5. 生成清洗日志 (缺失字段、未匹配项)

#### 阶段B: 抽样验证 (10%)
1. 随机抽样10%的记录
2. 手工比对源数据和清洗结果
3. 验证字段映射的准确性
4. 确认项目/用户/实体映射规则

#### 阶段C: 全量导入 (测试库)
1. 创建临时导入表 (legacy_import_*)
2. 批量插入清洗后的数据
3. 执行完整性检查和约束验证
4. 生成导入报告

#### 阶段D: 业务验收
1. 财务人员抽样查验
2. 确认数据准确性和完整性
3. 冻结映射规则
4. 准备生产迁移窗口

### 6.2 优先级排序

| 优先级 | 表 | 理由 |
|--------|-----|------|
| 1 | `payee` (外部+内部) | 数据量小(206条)，完全兼容，无依赖 |
| 2 | `entity` | 数据量小(13条)，完全兼容，无依赖 |
| 3 | `contract` | 数据量中等(30条)，兼容性好，payment_request依赖 |
| 4 | `payment_request` | 数据量中等(73条)，兼容性好，依赖contract |
| 5 | `reimbursement_envelope` | 数据量大(125条)，兼容性好，独立 |
| 6 | `reimbursement_batch` | 数据量大(2090条)，**高风险**，需复杂清洗 |

---

## 7. 迁移兼容性检查清单

### 7.1 前置条件检查

- [ ] 所有项目已在 `project` 表中创建
- [ ] 所有用户已在WeCom通讯录中，且userid已同步到KV
- [ ] 所有实体已在 `entity` 表中创建
- [ ] 迁移脚本 `0022_phase16_legacy_excel_compat.sql` 已执行
- [ ] 新增的 `legacy_data_id` 字段已创建

### 7.2 数据质量检查

#### payment_request
- [ ] `serial_no` 无重复 (UNIQUE约束)
- [ ] `amount` > 0
- [ ] `expected_payment_date` >= `created_at`
- [ ] `contract_id` 存在或为NULL (26%可为NULL)
- [ ] `applicant_userid` 能映射到有效用户
- [ ] `project_id` 能映射到有效项目

#### contract
- [ ] `contract_no` 无重复 (UNIQUE约束)
- [ ] `total_amount` > 0
- [ ] `contract_date` 有效
- [ ] `handler_userid` 能映射到有效用户
- [ ] `project_id` 能映射到有效项目
- [ ] `entity_id` 能映射到有效实体

#### reimbursement_envelope
- [ ] `envelope_no` 无重复
- [ ] `amount` > 0
- [ ] `expense_date` 有效
- [ ] `applicant_userid` 能映射到有效用户
- [ ] `project_id` 能映射到有效项目
- [ ] `envelope_uuid` 已生成且唯一

#### payee
- [ ] `name` + `bank_account` 组合唯一
- [ ] `bank_account` 格式有效
- [ ] `type` 正确设置 (internal/external)

#### entity
- [ ] `tax_id` 无重复
- [ ] `entity_name` 有效

### 7.3 关系完整性检查

```sql
-- payment_request 的contract_id完整性
SELECT COUNT(*) FROM payment_request 
WHERE contract_id IS NOT NULL AND contract_id NOT IN (SELECT id FROM contract);

-- payment_request 的payee_id完整性
SELECT COUNT(*) FROM payment_request 
WHERE payee_id NOT IN (SELECT id FROM payee);

-- contract 的project_id完整性
SELECT COUNT(*) FROM contract 
WHERE project_id NOT IN (SELECT id FROM project);

-- contract 的entity_id完整性
SELECT COUNT(*) FROM contract 
WHERE entity_id NOT IN (SELECT id FROM entity);

-- reimbursement_envelope 的project_id完整性
SELECT COUNT(*) FROM reimbursement_envelope 
WHERE project_id NOT IN (SELECT id FROM project);
```

### 7.4 去重检查

```sql
-- 检查legacy_data_id重复
SELECT legacy_data_id, COUNT(*) FROM payment_request 
WHERE legacy_data_id IS NOT NULL 
GROUP BY legacy_data_id HAVING COUNT(*) > 1;

-- 检查serial_no重复
SELECT serial_no, COUNT(*) FROM payment_request 
GROUP BY serial_no HAVING COUNT(*) > 1;
```

### 7.5 API暴露审查

- [ ] 现有的 `/api/v1/payment/create` 接口不强制写入 `legacy_data_id`
- [ ] 现有的 `/api/v1/contract/create` 接口不强制写入 `legacy_data_id`
- [ ] 现有的 `/api/v1/reimbursement/create` 接口不强制写入 `legacy_data_id`
- [ ] 兼容字段保持为存储预留位，不污染日常录入体验

---

## 8. 已知风险与缓解措施

### 8.1 高风险项

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| **个人报销集中申报数据结构异常** | 67%的行为子行，无法直接映射 | 优先迁移预申请表，此表作为补充参考 |
| **项目名称不规范** | 无法准确映射到project_id | 生成未匹配清单，人工确认后补充 |
| **用户名重复或已离职** | 无法映射到有效userid | 生成未匹配清单，人工确认后补充 |
| **合同号与payment_request关联缺失** | 26%的payment_request无contract_id | 允许contract_id为NULL，后续人工补充 |
| **文件key有效性** | 文件可能已删除或key错误 | 迁移时仅保存key，不验证文件存在性 |

### 8.2 中等风险项

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| **金额大写验证** | 已生成的金额大写可能有误 | 迁移时保留原值，不重新生成 |
| **流程状态映射** | 旧系统状态与新系统不完全对应 | 按映射规则转换，异常值记录到日志 |
| **当前节点/负责人缺失** | 大部分记录无当前审批信息 | 迁移时设置为NULL，不影响业务 |

### 8.3 低风险项

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| **备注字段为空** | 部分表的备注字段100%为空 | 允许为NULL，无需特殊处理 |
| **电话号码缺失** | payee表的电话字段部分缺失 | 允许为NULL，可选字段 |

---

## 9. 清洗脚本框架 (伪代码)

```python
# 伪代码示例
def migrate_payment_request():
    """迁移对外付款申请"""
    excel_file = "对外付款申请_20260228101021.xlsx"
    wb = load_workbook(excel_file)
    ws = wb.active
    
    results = []
    errors = []
    
    for row_idx in range(2, ws.max_row + 1):
        try:
            # 提取字段
            data_id = ws.cell(row_idx, 1).value
            serial_no = ws.cell(row_idx, 2).value
            applicant_name = ws.cell(row_idx, 3).value
            # ... 其他字段
            
            # 去重检查
            if data_id and check_duplicate(data_id, 'payment_request'):
                errors.append(f"Row {row_idx}: Duplicate data_id {data_id}")
                continue
            
            # 映射项目
            project_code = extract_project_code(ws.cell(row_idx, 6).value)
            project_id = lookup_project(project_code)
            if not project_id:
                errors.append(f"Row {row_idx}: Cannot map project")
                continue
            
            # 映射用户
            applicant_userid = lookup_user(applicant_name)
            if not applicant_userid:
                errors.append(f"Row {row_idx}: Cannot map user {applicant_name}")
                continue
            
            # 映射合同 (可选)
            contract_no = ws.cell(row_idx, 8).value
            contract_id = lookup_contract(contract_no) if contract_no else None
            
            # 映射收款人
            payee_name = ws.cell(row_idx, 16).value
            payee_id = lookup_or_create_payee(payee_name, ...)
            
            # 构建记录
            record = {
                'legacy_data_id': data_id,
                'serial_no': serial_no,
                'contract_id': contract_id,
                'project_id': project_id,
                'applicant_userid': applicant_userid,
                'expected_payment_date': to_iso8601(ws.cell(row_idx, 4).value),
                'category': ws.cell(row_idx, 5).value,
                'payee_id': payee_id,
                'amount': float(ws.cell(row_idx, 11).value),
                'amount_cn': ws.cell(row_idx, 12).value,
                'content': ws.cell(row_idx, 10).value,
                'status': map_status(ws.cell(row_idx, 29).value),
                'created_at': to_iso8601(ws.cell(row_idx, 27).value),
                'updated_at': to_iso8601(ws.cell(row_idx, 28).value),
            }
            
            results.append(record)
            
        except Exception as e:
            errors.append(f"Row {row_idx}: {str(e)}")
    
    # 输出结果
    save_csv(results, "payment_request_cleaned.csv")
    save_json(errors, "payment_request_errors.json")
    
    return len(results), len(errors)
```

---

## 10. 总结与建议

### 10.1 迁移可行性评估

| 表 | 可行性 | 理由 |
|-----|--------|------|
| `payee` | ✅ 高 | 完全兼容，数据量小，无依赖 |
| `entity` | ✅ 高 | 完全兼容，数据量小，无依赖 |
| `contract` | ✅ 高 | 兼容性好，数据量中等，依赖简单 |
| `payment_request` | ✅ 高 | 兼容性好，数据量中等，依赖清晰 |
| `reimbursement_envelope` | ✅ 中高 | 兼容性好，数据量大，需映射 |
| `reimbursement_batch` | ⚠️ 中低 | **高风险**，数据结构异常，需复杂清洗 |

### 10.2 关键成功因素

1. **项目映射准确性**: 需要完整的项目代码/名称对照表
2. **用户映射准确性**: 需要WeCom通讯录的完整同步
3. **数据清洗自动化**: 建议开发Python脚本自动化清洗流程
4. **人工审核机制**: 未匹配项需要人工确认，不能自动跳过
5. **分阶段验证**: 不能一次性全量导入，需要抽样验证

### 10.3 建议的迁移顺序

1. **第1周**: 迁移 `payee` + `entity` (低风险，快速验证流程)
2. **第2周**: 迁移 `contract` + `payment_request` (中等风险，验证关系完整性)
3. **第3周**: 迁移 `reimbursement_envelope` (中等风险，验证文件处理)
4. **第4周**: 迁移 `reimbursement_batch` (高风险，需特殊处理)

### 10.4 后续维护

- 保留 `legacy_data_id` 字段用于追溯和去重
- 定期检查未匹配项，补充映射规则
- 监控新增数据中的legacy字段使用情况
- 6个月后评估是否可以清理legacy字段

---

## 附录A: 字段类型对照表

| 旧系统类型 | 新系统类型 | 转换规则 |
|-----------|-----------|---------|
| TEXT | TEXT | 直接使用 |
| DATETIME | TEXT (ISO 8601) | `strftime('%Y-%m-%dT%H:%M:%SZ')` |
| FLOAT | REAL | 直接转换 |
| INT | INTEGER | 直接转换 |
| 逗号分隔字符串 | JSON数组 | `json.dumps(s.split(','))` |
| 空值 | NULL | 保留为NULL |

---

## 附录B: 状态值映射表

### payment_request.status
```
进行中 → pending_approval
流转完成 → approved (或 paid，需根据实际付款日期判断)
```

### contract.status
```
进行中 → pending_approval
流转完成 → active
```

### reimbursement_envelope.status
```
集中申报 → draft
已完成 → approved
```

### payee.status
```
(所有记录) → active
```

---

**文档版本**: 1.0  
**最后更新**: 2026-02-28  
**维护人**: 系统管理员  
**下一步**: 执行阶段A数据提取与清洗
