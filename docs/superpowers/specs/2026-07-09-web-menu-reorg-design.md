# 前端入口重排设计（Web 菜单/路由重组）

**日期:** 2026-07-09
**范围:** 仅 `packages/web`，纯导航（菜单/路由）改动 + 轻度页面清理
**约束:** 不碰后端与业务逻辑；不停机；不影响正在运行的业务

---

## 目标

整理前端各入口安放位置，收敛重复入口，让「系统底层与引擎」这个又乱又平铺的顶层菜单变得有条理，并按用户指令搬迁若干入口。

## 核心安全原则（贯穿所有改动）

1. **只改 `packages/web/src/router/modules/*.ts`**（菜单/路由树）与必要的隐藏 redirect；不改任何 `.vue` 页面的数据请求 / 业务逻辑；不碰 `api/`、`store/`、后端。
2. **绝不改动叶子页面已有的 `path`**——只移动它的菜单节点位置。凡是被移走的旧顶层 `path`，都保留一个 `showLink:false` 的 `redirect` 桩，保证会话中/收藏夹里的旧地址不 404（不停机）。
3. **保持所有已有 route `name` 稳定**（已确认外部无按 name 或硬编码 path 的导航引用，仅内部 API 调用，不受影响）。
4. 每一步都保证页面全程可达。

## 现状关键事实（探查所得）

- `entity.ts` / `dict.ts` 这两个顶层模块**已经是 `showLink:false` 的重定向桩**，分别 redirect 到 `/admin/system-base/entity` 与 `/admin/system-base/dict`。实体/字典的**规范页面本就在 `admin.ts` 里**。
- 因此 `finance.ts` 里的「实体资料管理」（`@/views/entity/index.vue`）是 admin 中「实体与基座管理」同一组件的**可见重复入口**——「移动到系统设置」本质是**去重**。
- 全库搜索确认：`/approval/*`、`/vehicle-maintenance/*`、`/bidding/dedup`、`/finance/entity/*` 在路由/视图之外**无硬编码 path 或按 name 的导航引用**，仅有内部 `api/` 调用（不改）。
- PureAdmin 路由：`buildHierarchyTree` + `formatTwoStageRoutes` 会把三级及以上路由拍平供 vue-router 匹配，而 `constantMenus` 保留原始层级用于菜单渲染。绝对路径（`/approval/index` 等）无论嵌套多深都能正确匹配——`finance.ts` 现有的三级结构（财务中心 > 对内付款 > 报销工作台）即为佐证。

---

## 逐项改动

### 1. 车辆保养记录 → 财务中心 / 「车辆油卡」改名「车辆中心」

- `finance.ts`：`FinanceFleetCenter` 组的 `meta.title` 由 `车辆油卡` → `车辆中心`。
- 在「车辆中心」组下新增叶子：
  - `title: 车辆保养记录`，`component: @/views/vehicle-maintenance/index.vue`
  - 新 `path: /finance/fleet/maintenance`，`name: FleetMaintenanceRecords`
  - `roles`: 沿用原车辆保养的五角色 `["super_admin","manager","finance","site_manager","operator"]`
- `vehicle-maintenance.ts`：改为**隐藏重定向桩**——顶层 `meta.showLink:false`；子路由 `/vehicle-maintenance/index` `redirect` → `/finance/fleet/maintenance`。顶层「车辆保养」菜单随之消失，旧 URL 仍可达。

### 2. 审批流转 → 财务中心

- 把整个「审批流转」组（审批中心 / 审批监控台 + 隐藏的 审批详情、旧路径 redirect）**从顶层搬到 `财务中心` 之下作为子分组**，`/approval/*` 的 `path` 与 `name` **全部保持不变**。
- 实现：将 `approval.ts` 的路由子树整体挪进 `finance.ts` 的 `children`（作为 `{ path:"/approval", component:Layout, redirect:"/approval/index", meta:{title:"审批流转", roles:[...]}, children:[...] }`），随后**删除 `approval.ts`**（避免自动 glob 重复注册为顶层）。
- 放置顺序：财务中心 children 内置于 收款 之后、车辆中心 前后皆可；建议 `对内付款 / 对外付款 / 收款 / 车辆中心 / 审批流转`。
- **已知副作用（用户已确认接受）:** operator 角色因可见「审批中心」，今后会在 `财务中心` 菜单下看到「审批流转」，而财务中心对其只显示这一项。

### 3. 实体资料管理（finance）→ 系统设置（去重）

- `finance.ts`：删除 `FinanceEntityCenter`「实体公司资料 / 实体资料管理」整组。
- 规范实体页已在系统设置的「基础数据」组内（见第 5 项），无需重复。
- 保留旧地址：新增隐藏 redirect `/finance/entity/profile` → `/admin/system-base/entity`（放在 `finance.ts` 里，`showLink:false`）。

### 4. 查重对比 → 新建「小工具」组

- `bidding.ts`：顶层 `meta.title` 由 `投标` → `小工具`，`icon` 换成工具类图标（如 `ri:tools-line`）。
- 叶子「查重对比」`path: /bidding/dedup` **保持不变**（稳定收藏夹/深链）。route `name` 可由 `Bidding`→`Tools`（外部无引用，安全）；子项 `name: BiddingDedup` 保持不变。

### 5. 全面重组「系统设置」（原 admin.ts 的 14 个平铺项 → 5 个子分组）

**所有叶子 `path` 保持不变**（仅在其上包一层分组节点），因此本项**无需任何 redirect**。每个分组为 `{ path:"/admin/g-xxx", component:Layout, redirect:<首个子项>, meta:{title, roles} }`。

- **审批引擎**: 审批流程设计器(`/admin/workflow-designer`) · 阈值管控中心(`/admin/threshold-rules`)
- **AI 与计算节点**: AI引擎配置(`/admin/ai-center`) · AI关卡任务管理(`/admin/ai-gate-tasks`) · Runner监控中心(`/admin/runner-center`) · Vertex现场控制区(`/admin/vertex-bridge`)
- **企业微信**: 企业微信集成(`/admin/wecom-integration`) · 企业微信智能机器人(`/admin/wecom-bot-settings`) · 企微推送监控(`/admin/wecom-push-monitor`)
- **系统监控与运维**: 服务监控中心(`/admin/ops-center`) · 业务数据全量运维台(`/admin/raw-ops`) · IT支持工单处理(`/admin/helpdesk`)
- **基础数据**: 实体与基座管理(`/admin/system-base/entity`) · 基础字典管理(`/admin/system-base/dict`)

分组容器路径需与现有叶子路径不冲突，形如 `/admin/g-approval`、`/admin/g-ai`、`/admin/g-wecom`、`/admin/g-ops`、`/admin/g-base`。分组 `roles` 取组内叶子并集中较宽者（保证有权用户可见组），叶子各自 `roles` 保持不变做最终鉴权。

**轻度页面清理范围界定:** 系统设置内 14 个页面均为各自独立的真实页面，无死页面可删；唯一真正重复的是实体页（已在第 3 项去重）。本次「轻度清理」= 该去重 + 顺手修复遇到的死菜单链接，不做更深的组件改动。

### 6. 系统底层与引擎 → 系统设置

- `admin.ts`：顶层 `meta.title` 由 `系统底层与引擎` → `系统设置`。`path:/admin`、`rank:90`、`name` 保持不变。

---

## 受影响文件清单（预期）

- `packages/web/src/router/modules/finance.ts` — 改 fleet 标题、加保养记录叶子、加审批流转子组、删实体组、加实体旧路径 redirect
- `packages/web/src/router/modules/approval.ts` — **删除**（内容迁入 finance.ts）
- `packages/web/src/router/modules/vehicle-maintenance.ts` — 改为隐藏 redirect 桩
- `packages/web/src/router/modules/bidding.ts` — 改标题/图标为「小工具」
- `packages/web/src/router/modules/admin.ts` — 改标题为「系统设置」+ 14 项重组为 5 组

不改动：任何 `.vue`、`api/`、`store/`、后端、后端路由、数据库。

## 验证方式

- `cd packages/web && npm run typecheck` 通过。
- `npm run lint:eslint` 通过（尤其 vue 路由/命名相关）。
- 本地 `npm run dev` 起站，人工核对：
  - 菜单树呈现符合上面的「after」结构；
  - 旧地址 `/vehicle-maintenance/index`、`/finance/entity/profile`、`/approval/index`、`/bidding/dedup` 均可正常打开（不 404）；
  - 系统设置 5 个分组各自展开、叶子页可打开。

## 明确不做（YAGNI / 越界）

- 不重写任何页面组件结构与业务逻辑。
- 不改任何后端 / API / DB。
- 不动 entity.ts / dict.ts 既有的隐藏重定向桩（已正常工作）。
- 不改叶子页面路径（除新增的车辆保养记录叶子外，全部保持）。
