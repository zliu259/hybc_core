# 旧财务数据迁移执行检查清单

**文档用途**: 迁移前、迁移中、迁移后的质量保证检查  
**最后更新**: 2026-02-28  
**负责人**: 系统管理员 + 财务部门

---

## 阶段A: 迁移前准备 (第1周)

### A1. 环境与工具准备

- [ ] Python 3.11+ 已安装，openpyxl库已安装
- [ ] D1数据库连接正常，可执行SQL查询
- [ ] 迁移脚本 `0022_phase16_legacy_excel_compat.sql` 已执行
- [ ] 新增的 `legacy_data_id` 字段已在所有目标表中创建
- [ ] 备份现有数据库 (完整备份)
- [ ] 测试库已准备，与生产库结构一致

### A2. 数据源验证

- [ ] 所有7个Excel文件已下载到 `doc/legacy_data/fin_data/`
- [ ] 文件完整性检查 (文件大小、行数统计)
  - [ ] `对外付款申请_20260228101021.xlsx` (74行)
  - [ ] `对外付款合同结算管理_20260228101109.xlsx` (31行)
  - [ ] `个人报销预申请_20260228101235.xlsx` (125行)
  - [ ] `个人报销集中申报_20260228101252.xlsx` (2090行)
  - [ ] `常用收款人（外部）_20260228101032.xlsx` (181行)
  - [ ] `常用收款人（内部）_20260228101145.xlsx` (25行)
  - [ ] `公司目录（我方）_20260228101307.xlsx` (14行)
- [ ] 所有文件可正常打开，无损坏

### A3. 映射数据准备

#### 项目映射表
- [ ] 从 `project` 表导出完整的项目列表 (id, project_code, project_name)
- [ ] 生成项目代码/名称对照表 (Excel或CSV)
- [ ] 与财务部门确认所有旧系统项目名称的映射关系
- [ ] 记录无法映射的项目名称，标记为"待人工确认"

#### 用户映射表
- [ ] 从WeCom通讯录导出完整的用户列表 (userid, name, department)
- [ ] 生成用户名-userid对照表
- [ ] 检查是否有重名用户，标记为"待人工确认"
- [ ] 检查是否有已离职用户，标记为"待人工确认"

#### 实体映射表
- [ ] 从 `entity` 表导出完整的实体列表 (id, entity_name, tax_id)
- [ ] 与财务部门确认所有旧系统实体名称的映射关系
- [ ] 记录无法映射的实体名称，标记为"待人工确认"

### A4. 清洗脚本开发

- [ ] 开发Python清洗脚本 (参考 SCHEMA_MAP.md 第9章)
- [ ] 脚本包含以下功能:
  - [ ] 读取Excel文件
  - [ ] 字段映射和类型转换
  - [ ] 去重检查 (legacy_data_id)
  - [ ] 项目/用户/实体映射
  - [ ] 日期格式转换 (ISO 8601)
  - [ ] 文件key处理 (逗号分隔→JSON数组)
  - [ ] 状态值映射
  - [ ] 错误日志记录
- [ ] 脚本已测试，可正常运行
- [ ] 脚本输出格式已定义 (CSV/JSON)

### A5. 沟通与审批

- [ ] 与财务部门沟通迁移计划和风险
- [ ] 获得财务部门的书面确认
- [ ] 与项目经理沟通迁移时间窗口
- [ ] 制定迁移回滚方案
- [ ] 通知所有相关人员迁移计划

---

## 阶段B: 数据提取与清洗 (第1-2周)

### B1. 执行清洗脚本

- [ ] 运行清洗脚本，处理所有7个Excel文件
- [ ] 脚本执行成功，无异常错误
- [ ] 生成清洗结果文件 (CSV格式)
  - [ ] `payee_cleaned.csv` (206条)
  - [ ] `entity_cleaned.csv` (13条)
  - [ ] `contract_cleaned.csv` (30条)
  - [ ] `payment_request_cleaned.csv` (73条)
  - [ ] `reimbursement_envelope_cleaned.csv` (125条)
  - [ ] `reimbursement_batch_cleaned.csv` (需特殊处理)

### B2. 清洗日志分析

- [ ] 生成清洗日志文件 (JSON格式)
- [ ] 分析日志中的错误和警告:
  - [ ] 未匹配的项目名称 (记录数量和列表)
  - [ ] 未匹配的用户名 (记录数量和列表)
  - [ ] 未匹配的实体名称 (记录数量和列表)
  - [ ] 重复的legacy_data_id (应为0)
  - [ ] 无效的日期格式 (应为0)
  - [ ] 无效的金额值 (应为0)
- [ ] 统计各类错误的数量和比例
- [ ] 生成错误汇总报告

### B3. 数据质量检查

#### payee表
- [ ] 总记录数: 206条 (外部181 + 内部25)
- [ ] `legacy_data_id` 非空率: 100%
- [ ] `name` 非空率: 100%
- [ ] `bank_account` 非空率: 100%
- [ ] `type` 值正确 (internal/external)
- [ ] `status` 值正确 (active)
- [ ] 无重复的 `name + bank_account` 组合

#### entity表
- [ ] 总记录数: 13条
- [ ] `legacy_data_id` 非空率: 100%
- [ ] `entity_name` 非空率: 100%
- [ ] `tax_id` 非空率: 100%
- [ ] 无重复的 `tax_id`

#### contract表
- [ ] 总记录数: 30条
- [ ] `legacy_data_id` 非空率: 100%
- [ ] `contract_no` 非空率: 100%
- [ ] `total_amount` > 0: 100%
- [ ] `project_id` 映射成功率: >= 90%
- [ ] `handler_userid` 映射成功率: >= 90%
- [ ] `entity_id` 映射成功率: >= 80%
- [ ] 无重复的 `contract_no`

#### payment_request表
- [ ] 总记录数: 73条
- [ ] `legacy_data_id` 非空率: 100%
- [ ] `serial_no` 非空率: 100%
- [ ] `amount` > 0: 100%
- [ ] `project_id` 映射成功率: >= 90%
- [ ] `applicant_userid` 映射成功率: >= 90%
- [ ] `payee_id` 映射成功率: >= 95%
- [ ] `contract_id` 映射成功率: >= 70% (26%可为NULL)
- [ ] 无重复的 `serial_no`

#### reimbursement_envelope表
- [ ] 总记录数: 125条
- [ ] `legacy_data_id` 非空率: 100%
- [ ] `envelope_no` 非空率: 100%
- [ ] `amount` > 0: 100%
- [ ] `project_id` 映射成功率: >= 90%
- [ ] `applicant_userid` 映射成功率: >= 90%
- [ ] `envelope_uuid` 已生成且唯一: 100%
- [ ] 无重复的 `envelope_no`

### B4. 人工确认

- [ ] 财务部门审核清洗日志中的未匹配项
- [ ] 补充项目映射关系 (如有)
- [ ] 补充用户映射关系 (如有)
- [ ] 补充实体映射关系 (如有)
- [ ] 更新清洗脚本，重新运行
- [ ] 生成最终的清洗结果文件

---

## 阶段C: 抽样验证 (第2周)

### C1. 抽样数据准备

- [ ] 从每个表中随机抽样10%的记录
  - [ ] payee: 20条
  - [ ] entity: 1条
  - [ ] contract: 3条
  - [ ] payment_request: 7条
  - [ ] reimbursement_envelope: 12条
- [ ] 生成抽样数据清单 (Excel格式)

### C2. 手工比对

- [ ] 财务部门逐条比对源数据和清洗结果
- [ ] 检查以下内容:
  - [ ] 字段映射是否正确
  - [ ] 数据类型转换是否正确
  - [ ] 日期格式是否正确
  - [ ] 金额是否正确
  - [ ] 项目/用户/实体映射是否正确
  - [ ] 文件key是否正确
- [ ] 记录所有发现的问题
- [ ] 生成比对报告

### C3. 问题修复

- [ ] 分析比对报告中的问题
- [ ] 修复清洗脚本中的bug
- [ ] 重新运行清洗脚本
- [ ] 重新进行抽样验证
- [ ] 确认所有问题已解决

### C4. 映射规则冻结

- [ ] 确认项目映射规则无误
- [ ] 确认用户映射规则无误
- [ ] 确认实体映射规则无误
- [ ] 确认状态值映射规则无误
- [ ] 文档化所有映射规则
- [ ] 获得财务部门的最终确认

---

## 阶段D: 全量导入 (第3周)

### D1. 导入前准备

- [ ] 再次备份现有数据库
- [ ] 创建临时导入表 (legacy_import_*)
- [ ] 准备导入脚本 (SQL或Python)
- [ ] 测试导入脚本，确保可正常运行
- [ ] 准备回滚脚本

### D2. 执行导入 (优先级顺序)

#### 第1步: 导入payee表
- [ ] 执行导入脚本
- [ ] 检查导入结果: 206条记录
- [ ] 验证UNIQUE约束: `name + bank_account`
- [ ] 验证外键约束: `created_by_userid` (可选)
- [ ] 生成导入报告

#### 第2步: 导入entity表
- [ ] 执行导入脚本
- [ ] 检查导入结果: 13条记录
- [ ] 验证UNIQUE约束: `tax_id`
- [ ] 生成导入报告

#### 第3步: 导入contract表
- [ ] 执行导入脚本
- [ ] 检查导入结果: 30条记录
- [ ] 验证UNIQUE约束: `contract_no`
- [ ] 验证外键约束: `project_id`, `entity_id`
- [ ] 生成导入报告

#### 第4步: 导入payment_request表
- [ ] 执行导入脚本
- [ ] 检查导入结果: 73条记录
- [ ] 验证UNIQUE约束: `serial_no`
- [ ] 验证外键约束: `contract_id`, `payee_id`, `project_id`
- [ ] 生成导入报告

#### 第5步: 导入reimbursement_envelope表
- [ ] 执行导入脚本
- [ ] 检查导入结果: 125条记录
- [ ] 验证UNIQUE约束: `envelope_no`, `envelope_uuid`
- [ ] 验证外键约束: `project_id`
- [ ] 生成导入报告

#### 第6步: 导入reimbursement_batch表 (高风险)
- [ ] 执行导入脚本 (需特殊处理)
- [ ] 检查导入结果
- [ ] 验证数据完整性
- [ ] 生成导入报告

### D3. 导入后验证

#### 数据完整性检查
```sql
-- payee表
SELECT COUNT(*) FROM payee WHERE legacy_data_id IS NOT NULL;
-- 预期: 206

-- entity表
SELECT COUNT(*) FROM entity WHERE legacy_data_id IS NOT NULL;
-- 预期: 13

-- contract表
SELECT COUNT(*) FROM contract WHERE legacy_data_id IS NOT NULL;
-- 预期: 30

-- payment_request表
SELECT COUNT(*) FROM payment_request WHERE legacy_data_id IS NOT NULL;
-- 预期: 73

-- reimbursement_envelope表
SELECT COUNT(*) FROM reimbursement_envelope WHERE legacy_data_id IS NOT NULL;
-- 预期: 125
```

- [ ] 所有计数检查通过

#### 外键完整性检查
```sql
-- payment_request的contract_id完整性
SELECT COUNT(*) FROM payment_request 
WHERE contract_id IS NOT NULL AND contract_id NOT IN (SELECT id FROM contract);
-- 预期: 0

-- payment_request的payee_id完整性
SELECT COUNT(*) FROM payment_request 
WHERE payee_id NOT IN (SELECT id FROM payee);
-- 预期: 0

-- contract的project_id完整性
SELECT COUNT(*) FROM contract 
WHERE project_id NOT IN (SELECT id FROM project);
-- 预期: 0

-- contract的entity_id完整性
SELECT COUNT(*) FROM contract 
WHERE entity_id NOT IN (SELECT id FROM entity);
-- 预期: 0

-- reimbursement_envelope的project_id完整性
SELECT COUNT(*) FROM reimbursement_envelope 
WHERE project_id NOT IN (SELECT id FROM project);
-- 预期: 0
```

- [ ] 所有外键检查通过

#### 去重检查
```sql
-- 检查legacy_data_id重复
SELECT legacy_data_id, COUNT(*) FROM payment_request 
WHERE legacy_data_id IS NOT NULL 
GROUP BY legacy_data_id HAVING COUNT(*) > 1;
-- 预期: 0行

-- 检查serial_no重复
SELECT serial_no, COUNT(*) FROM payment_request 
GROUP BY serial_no HAVING COUNT(*) > 1;
-- 预期: 0行
```

- [ ] 所有去重检查通过

#### 约束检查
```sql
-- 检查payment_request的amount > 0
SELECT COUNT(*) FROM payment_request WHERE amount <= 0;
-- 预期: 0

-- 检查contract的total_amount > 0
SELECT COUNT(*) FROM contract WHERE total_amount <= 0;
-- 预期: 0

-- 检查reimbursement_envelope的amount > 0
SELECT COUNT(*) FROM reimbursement_envelope WHERE amount <= 0;
-- 预期: 0
```

- [ ] 所有约束检查通过

### D4. 导入报告生成

- [ ] 生成总体导入报告，包含:
  - [ ] 导入时间
  - [ ] 导入记录数 (按表统计)
  - [ ] 导入成功率
  - [ ] 发现的问题和解决方案
  - [ ] 性能指标 (导入耗时)
  - [ ] 建议和后续步骤

---

## 阶段E: 业务验收 (第3-4周)

### E1. 财务部门验收

- [ ] 财务部门抽样查验导入的数据 (10%)
- [ ] 检查以下内容:
  - [ ] 数据准确性
  - [ ] 数据完整性
  - [ ] 数据一致性
  - [ ] 业务逻辑正确性
- [ ] 记录所有发现的问题
- [ ] 生成验收报告

### E2. 系统功能测试

- [ ] 测试payment_request相关API
  - [ ] GET /api/v1/payment/list (包含legacy数据)
  - [ ] GET /api/v1/payment/{id}
  - [ ] 验证legacy_data_id字段可见性
- [ ] 测试contract相关API
  - [ ] GET /api/v1/contract/list (包含legacy数据)
  - [ ] GET /api/v1/contract/{id}
- [ ] 测试reimbursement相关API
  - [ ] GET /api/v1/reimbursement/list (包含legacy数据)
  - [ ] GET /api/v1/reimbursement/{id}
- [ ] 测试payee相关API
  - [ ] GET /api/v1/payee/list (包含legacy数据)
- [ ] 所有API测试通过

### E3. 性能测试

- [ ] 测试查询性能 (legacy_data_id索引)
  - [ ] 按legacy_data_id查询: < 100ms
  - [ ] 按project_id查询: < 500ms
  - [ ] 按applicant_userid查询: < 500ms
- [ ] 测试导出性能 (大数据量)
  - [ ] 导出payment_request: < 5s
  - [ ] 导出reimbursement_envelope: < 5s
- [ ] 所有性能测试通过

### E4. 安全审查

- [ ] 验证legacy_data_id字段的访问权限
- [ ] 验证legacy字段不会污染日常录入表单
- [ ] 验证API不强制写入legacy字段
- [ ] 验证审计日志记录了所有导入操作
- [ ] 所有安全审查通过

### E5. 最终确认

- [ ] 财务部门签字确认验收通过
- [ ] 项目经理确认可以上线
- [ ] 系统管理员确认所有检查通过
- [ ] 生成最终验收报告

---

## 阶段F: 上线与监控 (第4周)

### F1. 生产环境部署

- [ ] 备份生产数据库
- [ ] 在生产环境执行迁移脚本
- [ ] 验证生产环境导入成功
- [ ] 监控生产环境性能指标

### F2. 上线后监控 (1周)

- [ ] 每日检查导入数据的使用情况
- [ ] 监控API性能指标
- [ ] 监控数据库性能指标
- [ ] 收集用户反馈
- [ ] 记录所有问题和解决方案

### F3. 文档更新

- [ ] 更新系统文档，记录legacy数据迁移
- [ ] 更新API文档，说明legacy_data_id字段
- [ ] 更新运维文档，说明legacy数据的维护方式
- [ ] 更新开发指南，说明legacy数据的使用规范

### F4. 后续维护计划

- [ ] 定期检查未匹配项，补充映射规则
- [ ] 监控新增数据中的legacy字段使用情况
- [ ] 6个月后评估是否可以清理legacy字段
- [ ] 制定legacy数据的长期保留策略

---

## 风险与应急

### 高风险项应急方案

#### 风险1: 项目映射失败 (> 10%)
- **症状**: 大量payment_request无法映射到project_id
- **应急方案**:
  1. 停止导入
  2. 分析未匹配的项目名称
  3. 与财务部门确认映射关系
  4. 更新映射表
  5. 重新运行清洗脚本
  6. 重新导入

#### 风险2: 用户映射失败 (> 10%)
- **症状**: 大量payment_request无法映射到applicant_userid
- **应急方案**:
  1. 停止导入
  2. 分析未匹配的用户名
  3. 检查WeCom通讯录是否完整
  4. 补充用户映射关系
  5. 更新映射表
  6. 重新运行清洗脚本
  7. 重新导入

#### 风险3: 数据重复 (legacy_data_id重复)
- **症状**: 导入时发现legacy_data_id重复
- **应急方案**:
  1. 立即回滚
  2. 分析重复的原因
  3. 修复清洗脚本
  4. 清理已导入的数据
  5. 重新运行清洗脚本
  6. 重新导入

#### 风险4: 外键约束失败
- **症状**: 导入时发现外键约束错误
- **应急方案**:
  1. 立即回滚
  2. 检查依赖表是否已导入
  3. 检查映射是否正确
  4. 修复清洗脚本
  5. 按正确的顺序重新导入

### 回滚方案

- [ ] 回滚脚本已准备
- [ ] 回滚脚本已测试
- [ ] 回滚脚本可在5分钟内执行完成
- [ ] 回滚后数据库状态与导入前一致

---

## 执行命令速查（已落地）

以下命令基于 `packages/api` 执行：

```bash
npm run db:migrate:local
npm run legacy:fin:gen-mapping
npm run legacy:fin:dry-run
npm run legacy:fin:apply:local:base
npm run legacy:fin:apply:local
```

按阶段建议命令：

```bash
# 仅基础表（低风险）
python3 scripts/legacy_fin_import.py --mode apply --tables payee,entity

# 核心财务主链路（中风险）
python3 scripts/legacy_fin_import.py --mode apply --mapping-file doc/legacy_data/fin_data_mappings.generated.json --tables contract,payment_request,reimbursement_envelope

# 高风险批次（先 dry-run）
python3 scripts/legacy_fin_import.py --mode dry-run --tables reimbursement_batch
```

本地验证示例：

```bash
wrangler d1 execute hybcdg-prod-db --local --command "SELECT COUNT(*) FROM payment_request WHERE legacy_data_id IS NOT NULL;"
wrangler d1 execute hybcdg-prod-db --local --command "SELECT COUNT(*) FROM contract WHERE legacy_data_id IS NOT NULL;"
wrangler d1 execute hybcdg-prod-db --local --command "SELECT COUNT(*) FROM reimbursement_envelope WHERE legacy_data_id IS NOT NULL;"
```

---

## 签字确认

| 角色 | 姓名 | 日期 | 签字 |
|------|------|------|------|
| 系统管理员 | | | |
| 财务部门负责人 | | | |
| 项目经理 | | | |
| 数据库管理员 | | | |

---

**文档版本**: 1.0  
**最后更新**: 2026-02-28  
**下一步**: 开始阶段A准备工作
