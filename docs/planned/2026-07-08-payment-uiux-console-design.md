# 对外付款 UI/UX 全面优化设计(付款处理台)

- 日期:2026-07-08
- 状态:已评审通过,待实现
- 范围:Web(packages/web)+ 小程序(packages/miniapp)+ API 增量(packages/api),无数据库变更
- 目标:增(创建)、查(查询)、管(管理)三条动线各自唯一且清晰,尽可能减少点击与心智负担

## 背景与问题

当前对外付款分散在 3 个 Web 页面与 2 个小程序页面,存在:

1. **双创建路径**:列表页「新建申请」→ 详情页创建模式;工作台「发起对外付款」→ 智能向导。路径不唯一,新人易迷路。
2. **管理动线围绕筛选器**:阶段积压(多少单待审、多少单待付、多少单被退回)不直观;超期未付、退回待改容易被淹没。
3. **详情页巨石**:`views/finance/payment/detail.vue` 1847 行,兼任创建/查看/编辑/审批/付款/超管编辑,维护困难。
4. **两端不一致**:小程序付款申请是一页长表单(992 行 JS),付款查询无阶段视图。

## 一、增:唯一创建路径

所有创建入口统一指向**智能发单向导**:

| 入口 | 现状 | 改造后 |
|---|---|---|
| 工作台「发起对外付款」 | → `/workspace/payment/wizard` | 不变 |
| 付款处理台「发起付款」(原列表页「新建申请」) | → `/finance/payment/detail/create` | → `/finance/payment/wizard` |
| 小程序「付款申请」 | 一页长表单 | 三步分段,与向导同构(见第四节) |

- **废除详情页创建模式**:`/finance/payment/detail/create` 路由保留但重定向到 `/finance/payment/wizard`(防旧链接失效);`detail.vue` 中 `isCreate` 分支代码整体移除。
- 向导完成提交后跳转到新单详情页(查看态)。

## 二、查+管:付款处理台(`views/finance/payment/index.vue` 重构)

### 顶部汇总条(4 块,点击跳转)

| 汇总块 | 口径 | 点击行为 |
|---|---|---|
| 待付总额 | SUM(amount) WHERE status='approved' | 切到「待付款」页签 |
| 本月已付 | SUM(amount) WHERE status='paid' AND paid_at ≥ 本月 1 日 | 切到「已付款」页签 |
| 超期未付 N 笔 | COUNT WHERE status='approved' AND expected_payment_date < 今天 | 切到「待付款」页签(超期行标红并置顶) |
| 退回待改 N 笔 | COUNT WHERE status='draft' AND approval_status ∈ RESUBMITTABLE(returned/pending/withdrawn) | 切到「待处理」页签 |

### 阶段页签(带计数)

| 页签 | status 口径 | 行内动作 |
|---|---|---|
| 待处理 | `draft`(行内标签区分「草稿」/「已退回」,退回=有审批实例且其状态可重提) | 去修改(进详情自动展开编辑)、审批详情(仅退回件) |
| 审批中 | `pending_approval` | 审批详情 |
| 待付款 | `approved` | 标记付款、详情;超期行标红并置顶 |
| 已付款 | `paid` | 详情 |
| 全部 | 不过滤(含 `rejected`/`cancelled`) | 详情 |

### 筛选与搜索

- 保留:项目筛选、表头「付款内容」全局搜索(服务端 `serial_no`/`content` 模糊,2026-07-08 已上线)。
- 新增:申请人筛选(复用 `useWecomUserOptions`)。
- 移除:「关联合同」下拉(合同信息在详情可见,减少顶部噪音;后端 `contract_id` 参数保留)。

### 交互细节

- 页签切换即查询(status 参数),分页归零;计数来自汇总接口,切页签不重复拉汇总。
- 「去修改」跳 `/finance/payment/detail/:id?edit=1`,详情页读 query 自动进入编辑态。
- 汇总接口失败时页签仍可用,计数与金额显示「-」,不阻塞列表(独立 try/catch)。

## 三、详情页瘦身(`detail.vue` 拆分)

`detail.vue` 改为容器(目标 <800 行),对外行为不变(查看/编辑/审批/付款/超管编辑照旧;退回可编辑沿用 2026-07-08 的 API 修复)。拆出子组件,目录 `views/finance/payment/components/`:

| 组件 | 职责 |
|---|---|
| `PaymentInfoCard.vue` | 申请信息展示与编辑表单(draft/退回态可编辑) |
| `ApprovalActionPanel.vue` | 审批动作(通过/拒绝/退回/转签)与审批轨迹 |
| `PayoutPanel.vue` | 标记付款、付款凭证、付款主体/账户调整 |
| `AdminEditPanel.vue` | 超管编辑模式开关、修改说明、留痕提示 |

- 组件间通过 props(detail 对象)+ emit(refresh)通信,不引入新 store。
- 创建模式(`isCreate`)相关代码全部删除。
- 支持 `?edit=1` query:加载后自动展开 `PaymentInfoCard` 编辑态(仅当当前状态可编辑)。

## 四、小程序两页对齐

### `pages/payment-apply`(付款申请)

一页长表单改**三步分段**(同一页面内分步渲染,不拆页面):

1. 项目与合同(选项目 → 选合同,显示合同剩余可付额度)
2. 金额与内容(金额、付款内容、类别、期望付款日期)
3. 收款与方式(收款人、付款方式、备注)→ 提交

- 提交走既有 API,提交后进入既有成功态/跳转逻辑,不改接口。
- 每步下方「上一步/下一步」,最后一步「提交」;字段校验分步进行。

### `pages/query-payment`(付款查询)

- 顶部加五个阶段页签:待处理 / 审批中 / 待付款 / 已付款 / 全部(与 Web 同口径,status 参数查询)。
- 行内状态色沿用现有 statusTheme;「已退回」行显示红色标记与「去修改」入口 → 跳既有 `pages/returned-approval-edit`(biz_type=payment_request)。
- 汇总条不做(小屏放不下,YAGNI)。

## 五、API 增量(packages/api,无 D1 变更)

### 新增 `GET /api/v1/payment/console-summary`

一次聚合查询返回:

```json
{
  "success": true,
  "data": {
    "pending_count": 5,          // status='draft'
    "returned_count": 2,         // draft 且审批实例可重提
    "in_approval_count": 8,      // status='pending_approval'
    "to_pay_count": 3,           // status='approved'
    "to_pay_total": 1280000,     // SUM(amount) status='approved'
    "overdue_count": 3,          // approved 且 expected_payment_date < date('now')
    "paid_month_total": 860000   // SUM(amount) paid,paid_at ≥ 本月1日
  }
}
```

- 权限:显式 `requireRoles(["super_admin", "manager", "finance"])`。注意付款列表 GET 本身对全部认证角色开放(工作台「我的申请」以 `mine=true` 使用),但全局金额汇总不应暴露给 `site_manager`/`operator`,故汇总接口单独限角色。
- 实现为对 `payment_request` 的一条 CASE 聚合 SQL + 一条退回计数 JOIN,避免 N 次查询。

### 付款列表 `GET /api/v1/payment` 增强

- 返回字段增加 `approval_status`(LEFT JOIN `approval_instance`,无实例为 null),前端据此区分「草稿/已退回」并渲染行内动作。
- 现有参数(`status`/`project_id`/`keyword`/`applicant_userid` 等)不变;不新增 stage 参数,页签在前端映射为 status。

## 六、测试与验证

- **API**(vitest):console-summary 聚合口径用例(各状态计数/超期/本月已付);列表 `approval_status` 字段用例(有/无实例、returned)。
- **Web**:`npm run typecheck` + `npm run build`;手测五页签动线、汇总块跳转、去修改直达编辑、标记付款、旧创建路由重定向。
- **小程序**:`payment-apply` 分步切换与提交、`query-payment` 页签查询与退回件跳转;沿用仓库现有轻量测试模式(纯函数抽 utils 配 `.test.js`)。
- 上线:push main 自动部署;`doc/开发记录.md` 追加记录;`doc/UI设计文档.md` 同步页面说明;本文档移入 `docs/archive/`。

## 不做(YAGNI)

- 待付款批量标记付款、付款清单导出。
- 「催办」一键提醒:审批域目前只有 `/remindable` 列表与 `can_remind` 标记,没有发送提醒的端点;真正催办需要新端点 + 企微通知管道(n8n/Queue),隐藏工作量大,后续单独立项。本期审批中行内只提供「审批详情」。
- 付款并入统一审批台(方案 C)。
- 小程序汇总条与金额统计。
- 列表虚拟滚动等性能优化(当前数据量不需要)。

## 风险与兼容

- 详情页拆分是纯重构,须保持对外行为不变;以 typecheck + 手测回归兜底。
- 旧链接 `/finance/payment/detail/create` 重定向向导,不 404。
- 小程序付款申请分步只改交互层,提交 payload 不变,避免后端联动风险。
