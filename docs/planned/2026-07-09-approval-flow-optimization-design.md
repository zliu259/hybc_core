# 审批流转优化设计(统一审批台 + 监控台 Tabs + 返回修复)

- 日期:2026-07-09
- 状态:已评审通过,待实现
- 范围:Web(packages/web)+ API 增量(packages/api),无数据库变更,小程序不动
- 目标:消除两个重复的审批台;修复详情页返回丢失来源的 bug;审批监控台状态改 Tabs 并向 manager 只读开放

## 背景与审计结论

审批相关页面现状(`packages/web/src/views/approval/`,路由 `router/modules/approval.ts`):

1. **两个重复的「审批台」**:
   - `index.vue`(审批中心,`/approval/index`,`showLink:false`,全角色)——完整三页签列表(待审批/已处理/抄送我的),行点击进 `detail.vue` 操作。是真正的个人审批台:欢迎页「待我审批」与 `/approval` 重定向都落这里。
   - `unified-tasklist.vue`(统一审批台,`/approval/unified-tasklist`,在导航菜单,全角色)——左右分栏 master-detail:左待办池,右内联「通过/驳回/转签」,仅待审批,详情很薄,页头写「审批中心 - 统一工作台」。
   - 导航菜单显示「统一审批台」(薄版),但实际入口是「审批中心」(全版、隐藏)。重复且割裂。

2. **详情页返回 bug**:`detail.vue:58` 硬编码 `pendingApprovalRoute = { path: "/approval/index" }`,`detail.vue:1305` `goBack = () => router.push(pendingApprovalRoute)`。从监控台(`/approval/admin-monitor`)点「查看详情」进入后,返回按钮把用户送到 `/approval/index`(审批中心),回不到监控台。

3. **监控台用筛选器**:`admin-monitor.vue` 用 biz_type 下拉 + 状态多选(默认 in_progress/approved/rejected,持久化 localStorage)+ 发起人 + 关键字。`/api/v1/approval/admin/all` 仅 `super_admin`。无计数端点。用户要求:状态改 Tabs(像对外付款/报销工作台),manager 需要只读监控整体状况。

## 一、统一审批台:以「审批中心」为唯一台

### index.vue 待审批行新增内联快捷操作

- 「待审批」页签表格新增「操作」列:**通过 / 驳回 / 转签 / 详情**。
- 通过/驳回/转签点击打开**共享轻量对话框**:
  - 通过:意见文本框(可选)→ `approveApproval(instanceId, { comment })`。
  - 驳回:意见文本框(必填)→ `rejectApproval(instanceId, { comment })`。
  - 转签:选人(`wecomUsers`)+ 原因(必填)→ `transferApproval(instanceId, { to_userid, reason })`。
  - 提交成功后 `message` 提示并 `loadPending()` 刷新当前页签(条目流出待办)。
- 复用 `unified-tasklist.vue` 已验证的调用方式(它现在就是这样调 `approveApproval(selectedId)` 等),仅把动作从分栏迁到表格行内联对话框。
- 「详情」按钮 → `/approval/detail/{id}?from=desk`(见第二节)。已处理/抄送页签行为不变(行点击进详情,带 `?from=desk`)。

### 删除 unified-tasklist

- 删除 `packages/web/src/views/approval/unified-tasklist.vue`。
- `router/modules/approval.ts`:`/approval/unified-tasklist` 路由改为 `redirect: "/approval/index"`(保 `showLink:false`,防旧链接/收藏 404);导航菜单不再出现「统一审批台」。
- 全仓 grep `unified-tasklist` 与 `ApprovalUnifiedTasklist`,清理其它引用(若有跳转)。

## 二、详情页返回 = 回到来处

- `detail.vue`:把固定的 `pendingApprovalRoute` 改为**来源感知**的返回目标:
  - 读 `route.query.from`:`monitor` → `/approval/admin-monitor`;`desk` → `/approval/index`;其它/缺省 → `/approval/index`。
  - `goBack()`:若存在有效 `from` 则 `router.push` 对应路由;否则 `router.back()`(浏览器历史);历史不可用时兜底 `/approval/index`。
  - 用一个 computed `backRoute` 统一解析,`el-page-header @back` 与任何「返回」入口共用。
- **执行动作后的跳转不变**:通过/驳回等成功后仍 `router.push` 到「待我审批」(`/approval/index`),保留现有「正在返回待我审批」提示——那是有意设计(动作完成回个人待办),不受 `from` 影响。
- 所有进入详情的入口补 `?from=`:
  - `index.vue`(审批中心)→ `?from=desk`
  - `admin-monitor.vue` → `?from=monitor`
  - 其它既有入口(欢迎页待办、我的申请、等待我处理等)**不强制改**;缺省回 `/approval/index` 与今日行为一致,零回归。

## 三、审批监控台:状态 Tabs + manager 只读

### 前端 admin-monitor.vue

- **状态多选筛选器 → 四个页签**:进行中(`in_progress`)/ 已通过(`approved`)/ 已驳回(`rejected`)/ 全部(不传 status)。切页签即查询,页码归零。
- 页签徽标计数来自新端点 `GET /api/v1/approval/admin/summary`(见第四节);失败时徽标显示「-」不阻塞列表(与付款/报销工作台同模式)。
- 保留 **biz_type / 发起人 / 关键字** 为次级筛选(它们不是状态);移除状态相关的 localStorage 持久化(`restoreFilters`/`persistFilters`/`filterStorageKey`/`watch` 状态记忆整段删除)。
- 「查看详情」链接改为带 `?from=monitor`(`/approval/detail/{id}?from=monitor`)。
- 强制通过 / 强制转签按钮:`v-if` 由 `isSuperAdmin` 门控(现状即如此),manager 看不到。
- manager 只读:页面本身放开 manager 可进(路由 meta.roles 加 manager);列表/计数端点放开 manager 读。

### 路由

- `router/modules/approval.ts` 的 `/approval/admin-monitor` meta.roles:`["super_admin"]` → `["super_admin", "manager"]`。

## 四、API 增量(无 D1 变更)

### 新增 `GET /api/v1/approval/admin/summary`

```json
{ "success": true, "data": { "in_progress": 12, "approved": 340, "rejected": 18, "total": 402 } }
```

- 一条 CASE 聚合 SQL over `approval_instance`:
  - `in_progress` = `SUM(CASE WHEN status='in_progress' THEN 1 ELSE 0 END)`
  - `approved` = `status='approved'`
  - `rejected` = `status='rejected'`
  - `total` = `COUNT(*)`(全部,不排除任何状态,与「全部」页签口径一致)
- 权限:`super_admin` 或 `manager`(手写 `auth.roles.includes(...)` 判定,与 `admin/all` 同风格)。

### `GET /api/v1/approval/admin/all` 放开 manager 读

- 现有 `if (!auth.roles.includes("super_admin")) 403` 改为允许 `super_admin || manager`。
- 其余查询逻辑(biz_type/status/initiator/keyword/分页)不变。

### 强制操作保持 super_admin

- `force-approve` / `force-transfer` 端点角色门槛不变(仅 super_admin)。前端按钮已由 `isSuperAdmin` 门控。

## 五、测试与验证

- **API**(vitest,TDD):`admin/summary` 聚合口径用例(四计数、SQL 口径 pinning、manager 允许 / operator 403);`admin/all` manager 允许 + operator 仍 403 用例。
- **Web**:`npm run typecheck` + `npm run build`;手测:
  - 审批中心待审批行内联 通过/驳回/转签(含驳回必填意见校验)后条目流出;详情往返;已处理/抄送不回归。
  - 监控台四页签切换 + 徽标计数 + 次级筛选;manager 账号可只读进入且无强制按钮;超管强制通过/转签可用。
  - **返回 bug 修复验证**:从监控台进详情→返回→回到监控台;从审批中心进详情→返回→回到审批中心;直接打开详情 URL(无 from)→返回→ /approval/index。
  - `/approval/unified-tasklist` 旧链接 302 到 /approval/index。
- **文档**:`doc/UI设计文档.md` 审批章节更新;`doc/开发记录.md` 追加;本设计与计划落地后移 `docs/archive/`。
- 上线:push main 自动部署;无迁移。

## 不做(YAGNI)

- 监控台顶部汇总条(tab 徽标已是关键计数信号)。
- 监控台的强制操作扩权给 manager(高风险干预仍限超管)。
- 详情页「执行动作后跳转」的来源感知(动作后回个人待办是既定语义)。
- 欢迎页/我的申请等其它详情入口的 `?from=` 补全(缺省行为零回归,按需后续)。
- 小程序端审批页改动。

## 风险与兼容

- 内联审批动作复用 `unified-tasklist` 已在生产验证的 approve/reject/transfer 调用,后端按当前用户解析待办任务,行为等价——仅 UI 位置从分栏迁到表格。
- `?from=` 为附加 query,缺省回退与现状一致,老入口零回归。
- admin/all 放开 manager 读是**扩大可见范围**(只读);force 操作仍锁超管,无越权。manager 能看到全部审批实例摘要属既定「监控整体状况」诉求。
