# 报销付款工作台三步流水线设计(办公室一条龙)

- 日期:2026-07-08
- 状态:已评审通过,待实现
- 范围:Web(packages/web)+ API 增量(packages/api),无数据库变更,小程序不动
- 目标:办公室人员一条龙处理报销;消除「报销提交视图仍显示已提交条目」等状态混乱

## 背景与审计结论

现工作台(`views/finance/reimbursement/list.vue`,897 行,财务中心与员工工作台两条路由共用)按四步组织,但视图按状态原样堆叠而非按「这一步等我做什么」组织:

1. **submitted 双视图重叠**:「报销提交」预设过滤 unregistered/draft/submitted,「核对签收与复核」预设 submitted/received——员工已提交条目在第 1 步滞留(投诉点)且两步重复出现。
2. **第 2 步三种待办混表**:待签收(submitted)、待复核(received+待复核/待补充)、复核完待成批(received+通过)混在一张表,无法判断「我做完了没」。
3. **无阶段计数**:步骤条无徽标,积压不可见。
4. **跨步追踪断裂**:成批后信封从 1/2 步消失,「这单到哪了」只能翻批次。
5. 第 1 步对办公室无操作价值(全员草稿);超管需要能查看废弃(cancelled)条目。

信封状态机(不变):`unregistered → draft → submitted → received(precheck: pending/approved/supplement/rejected)→ batched → pending_approval → approved → paid`,终态 `rejected/cancelled`。

## 一、页面与路由结构

| 路由 | 现状 | 改造后 |
|---|---|---|
| `/finance/reimbursement`(财务中心) | list.vue 四步 | **新组件 `views/finance/reimbursement/office-workbench.vue`** 三步流水线 |
| `/workspace/my-reimbursement`(员工) | 同一个 list.vue | **保持指向 list.vue,零改动**(list.vue 中财务中心专属分支成为死代码可顺带精简,但员工动线不得变化) |

- 顶部动作区(office-workbench):**全流程查询框、UUID 快速签收、代员工发起、信封生成器**。后三者沿用现有逻辑(quickScan 弹窗、`/finance/reimbursement/detail/create`、envelope-generator 路由)。
- 原第 1 步「报销提交」从财务中心消失;超管查看废弃由全流程查询覆盖(见三)。

## 二、三步流水线(office-workbench.vue)

### 步骤条(可点击,带积压徽标)

| 步骤 | 徽标口径 |
|---|---|
| ① 签收与复核 | 待签收 + 待复核 |
| ② 成批送审 | 待成批候选数 |
| ③ 付款 | 待付批次数(approved 批次) |

### 第①步:三个子页签(各带计数)

| 子页签 | 口径 | 行内动作 |
|---|---|---|
| 待签收 | `status='submitted'` | **签收**(打开该信封详情抽屉并定位收件核查区,复用现有 `POST /api/v1/reimbursement/verify` 动线,不新建端点)、详情 |
| 待复核 | `status='received'` 且 `precheck_status IN ('none','pending','supplement')` | 复核通过/补充材料/复核驳回(现有 `precheckEnvelope`)、智能核查、二次静默审查、详情;`supplement` 条目加「待补充」标签 |
| 待成批 | `status='received'` 且 `precheck_status='approved'` 且 `batch_id IS NULL` | **去成批 →**(切换到第②步)、详情 |

- 现有异常提示标签(重复风险/核对异常/复核驳回)、高风险行标红逻辑整体迁移保留。
- 每个动作成功后同时刷新当前列表与徽标计数(重拉 workbench-summary)。

### 第②③步:嵌入现有组件

- 第②步嵌入 `batch.vue`(候选=received+approved+未成批,后端强约束已存在;批次创建与送审不改)。
- 第③步嵌入 `payout.vue`(approved 批次登记打款,不改)。
- 嵌入方式沿用现 list.vue 的做法(动态组件/条件渲染),仅步骤条与标题文案适配三步。

## 三、全流程查询

- 顶部搜索框:关键字覆盖**信封号/UUID/发票号/事由**(后端 keyword 现有口径,已核实 `reimbursement.ts:1359`);旁挂申请人、项目下拉(复用现有筛选)。
- 触发后进入**查询结果模式**(替换步骤内容区,带「返回工作台」):跨全部状态搜索——调用现有列表 API,`exclude_cancelled=false` 且不传 status(后端该组合返回含 cancelled 的全部状态,已核实参数语义)。
- 结果行:信封号/申请人/项目/金额/状态标签/**当前站点**/操作(详情;batched 及之后的行加「批次详情」跳 `/finance/reimbursement/batch/:batch_id`)。
- 站点派生(纯前端,按 status+precheck_status+batch_id):

| 状态 | 站点显示 |
|---|---|
| unregistered/draft | 提交人手中 |
| submitted | 待签收(办公室) |
| received + precheck 非 approved | 待复核(办公室) |
| received + approved + 未成批 | 待成批(办公室) |
| batched / pending_approval | 审批中 |
| approved | 待付款 |
| paid | 已付款 |
| rejected / cancelled | 已驳回 / 已废弃 |

- 超管查看废弃条目即通过此查询(cancelled 行普通角色亦可见,仅查看;废止/恢复等管理动作沿用详情页既有能力,不新增)。

## 四、API 增量(无 D1 变更)

新增 `GET /api/v1/reimbursement/workbench-summary`:

```json
{
  "success": true,
  "data": {
    "to_receive": 3,        // status='submitted'
    "to_precheck": 2,       // status='received' AND precheck_status IN ('none','pending','supplement')
    "to_batch": 2,          // status='received' AND precheck_status='approved' AND batch_id IS NULL
    "batches_to_submit": 1, // reimbursement_batch.status='draft'
    "batches_to_pay": 1     // reimbursement_batch.status='approved'
  }
}
```

- 实现:信封表一条 CASE 聚合 + 批次表一条 CASE 聚合,共 2 条 SQL。
- 权限:与现财务中心报销路由一致 `requireRoles(["super_admin","manager","finance"])`(全局积压计数不暴露给现场角色)。
- 前端失败容错:徽标显示「-」,不阻塞列表(与付款处理台同模式)。

## 五、测试与验证

- **API**(vitest,TDD):workbench-summary 聚合口径用例(各桶计数、零数据回退、角色 403)、SQL 口径 pinning 断言。
- **Web**:`npm run typecheck` + `npm run build`;手测:三步动线(签收→复核→成批跳转→送审→付款)、子页签计数流转、全流程查询各站点显示、UUID 快速签收、代发起;**员工 `/workspace/my-reimbursement` 回归确认不变**。
- **文档**:`doc/UI设计文档.md` F 节(报销付款工作台)改写;`doc/开发记录.md` 追加;本文档与实施计划落地后移 `docs/archive/`。
- 上线:push main 自动部署;无迁移。

## 不做(YAGNI)

- 补充材料回流高亮/提醒(评审未选)。
- 废弃条目的恢复/批量清理动作(查看由查询覆盖;废止能力详情页已有)。
- 小程序端改动。
- 批量签收、批量复核(先看行内动作是否够用)。
- 步骤条计数的实时推送(动作后主动刷新即可)。

## 风险与兼容

- list.vue 为两路由共用组件:**先建新组件切财务中心路由,员工路由不动**,规避回归风险;list.vue 内财务中心专属死代码的清理放在验证通过之后、同一计划内的独立任务,且仅删除确证不被员工动线引用的分支。
- batch.vue/payout.vue 以嵌入复用为主,若其内部依赖 list.vue 传入的上下文(实施时核实 props/事件),按现状适配,不重构其内部。
- 查询模式含 cancelled:仅财务中心工作台可达,不影响员工视图口径。
