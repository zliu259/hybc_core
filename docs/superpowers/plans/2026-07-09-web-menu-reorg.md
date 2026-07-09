# 前端入口重排 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重排 `packages/web` 的菜单/路由入口——车辆保养记录并入财务中心「车辆中心」、审批流转移入财务中心、财务中心实体资料去重进系统设置、查重对比归入新「小工具」组、并把「系统底层与引擎」改名「系统设置」且 14 个平铺项重组为 5 个分组。

**Architecture:** 纯 `src/router/modules/*.ts` 导航层改动。安全铁律：**绝不改任何叶子页面已有的 `path`**，只移动菜单节点位置；被移走的旧顶层 path 一律保留 `showLink:false` 的 `redirect` 桩，保证旧地址不 404（不停机）。所有已有 route `name` 保持稳定。不碰 `.vue` / `api/` / `store/` / 后端 / DB。

**Tech Stack:** Vue 3 + PureAdmin（vue-router，路由 module 由 `import.meta.glob` 自动注册；`buildHierarchyTree` + `formatTwoStageRoutes` 拍平三级+ 路由，`constantMenus` 保留原层级渲染菜单）。

**验证手段（无测试框架，用类型/静态/结构校验替代 TDD）:** 每个 task 后 `cd packages/web && npm run typecheck`（tsc + vue-tsc）+ 结构 grep；全部完成后 Task 6 做 eslint + dev-server 人工核对。所有命令在 `packages/web` 下执行（当前分支 `feat/web-menu-reorg`，非 worktree，node_modules 齐全）。

---

### Task 1: 系统设置改名 + 14 项重组为 5 分组（admin.ts）

**Files:**
- Modify (整体重写): `packages/web/src/router/modules/admin.ts`

叶子 path 全部不变，仅在其上包 5 个分组节点；顶层标题改「系统设置」。

- [ ] **Step 1: 用以下内容整体替换 `admin.ts`**

```ts
const Layout = () => import("@/layout/index.vue");

export default {
  path: "/admin",
  name: "AdminSettings",
  component: Layout,
  redirect: "/admin/workflow-designer",
  meta: {
    icon: "ep:setting",
    title: "系统设置",
    rank: 90
  },
  children: [
    {
      path: "/admin/g-approval",
      name: "AdminGroupApproval",
      component: Layout,
      redirect: "/admin/workflow-designer",
      meta: {
        title: "审批引擎",
        roles: ["super_admin"]
      },
      children: [
        {
          path: "/admin/workflow-designer",
          name: "AdminWorkflowDesigner",
          component: () => import("@/views/approval/template-config.vue"),
          meta: {
            title: "审批流程设计器",
            roles: ["super_admin"]
          }
        },
        {
          path: "/admin/threshold-rules",
          name: "AdminThresholdRules",
          component: () => import("@/views/approval/threshold-config.vue"),
          meta: {
            title: "阈值管控中心",
            roles: ["super_admin"]
          }
        }
      ]
    },
    {
      path: "/admin/g-ai",
      name: "AdminGroupAi",
      component: Layout,
      redirect: "/admin/ai-center",
      meta: {
        title: "AI 与计算节点",
        roles: ["super_admin", "manager", "site_manager"]
      },
      children: [
        {
          path: "/admin/ai-center",
          name: "AdminAiCenter",
          component: () => import("@/views/ai/config.vue"),
          meta: {
            title: "AI引擎配置",
            roles: ["super_admin"]
          }
        },
        {
          path: "/admin/ai-gate-tasks",
          name: "AdminAiGateTasks",
          component: () => import("@/views/admin/ai-gate-tasks.vue"),
          meta: {
            title: "AI关卡任务管理",
            roles: ["super_admin"]
          }
        },
        {
          path: "/admin/runner-center",
          name: "AdminRunnerCenter",
          component: () => import("@/views/ai/nodes.vue"),
          meta: {
            title: "Runner监控中心",
            roles: ["super_admin"]
          }
        },
        {
          path: "/admin/vertex-bridge",
          name: "AdminVertexBridge",
          component: () => import("@/views/admin/vertex-bridge.vue"),
          meta: {
            title: "Vertex现场控制区",
            roles: ["super_admin", "manager", "site_manager"]
          }
        }
      ]
    },
    {
      path: "/admin/g-wecom",
      name: "AdminGroupWecom",
      component: Layout,
      redirect: "/admin/wecom-integration",
      meta: {
        title: "企业微信",
        roles: ["super_admin"]
      },
      children: [
        {
          path: "/admin/wecom-integration",
          name: "AdminWeComIntegration",
          component: () => import("@/views/wecom/member-admin.vue"),
          meta: {
            title: "企业微信集成",
            roles: ["super_admin"]
          }
        },
        {
          path: "/admin/wecom-bot-settings",
          name: "AdminWeComBotSettings",
          component: () => import("@/views/admin/wecom-bot-settings.vue"),
          meta: {
            title: "企业微信智能机器人",
            roles: ["super_admin"]
          }
        },
        {
          path: "/admin/wecom-push-monitor",
          name: "AdminWeComPushMonitor",
          component: () => import("@/views/admin/wecom-push-monitor.vue"),
          meta: {
            title: "企微推送监控",
            roles: ["super_admin"]
          }
        }
      ]
    },
    {
      path: "/admin/g-ops",
      name: "AdminGroupOps",
      component: Layout,
      redirect: "/admin/ops-center",
      meta: {
        title: "系统监控与运维",
        roles: ["super_admin"]
      },
      children: [
        {
          path: "/admin/ops-center",
          name: "AdminOpsCenter",
          component: () => import("@/views/admin/ops-center.vue"),
          meta: {
            title: "服务监控中心",
            roles: ["super_admin"]
          }
        },
        {
          path: "/admin/raw-ops",
          name: "AdminRawOps",
          component: () => import("@/views/admin/raw-ops.vue"),
          meta: {
            title: "业务数据全量运维台",
            roles: ["super_admin"]
          }
        },
        {
          path: "/admin/helpdesk",
          name: "AdminHelpdesk",
          component: () => import("@/views/admin/helpdesk.vue"),
          meta: {
            title: "IT支持工单处理",
            roles: ["super_admin"]
          }
        }
      ]
    },
    {
      path: "/admin/g-base",
      name: "AdminGroupBase",
      component: Layout,
      redirect: "/admin/system-base/entity",
      meta: {
        title: "基础数据",
        roles: ["super_admin"]
      },
      children: [
        {
          path: "/admin/system-base/entity",
          name: "AdminSystemBaseEntity",
          component: () => import("@/views/entity/index.vue"),
          meta: {
            title: "实体与基座管理",
            roles: ["super_admin"]
          }
        },
        {
          path: "/admin/system-base/dict",
          name: "AdminSystemBaseDict",
          component: () => import("@/views/dict/index.vue"),
          meta: {
            title: "基础字典管理",
            roles: ["super_admin"]
          }
        }
      ]
    }
  ]
} satisfies RouteConfigsTable;
```

- [ ] **Step 2: Typecheck**

Run: `cd packages/web && npm run typecheck`
Expected: PASS（无新错误）

- [ ] **Step 3: 结构校验——确认所有旧叶子 path 仍在、标题已改**

Run: `cd packages/web && grep -c "\"/admin/\(workflow-designer\|threshold-rules\|ai-center\|ai-gate-tasks\|runner-center\|vertex-bridge\|wecom-integration\|wecom-bot-settings\|wecom-push-monitor\|ops-center\|raw-ops\|helpdesk\|system-base/entity\|system-base/dict\)\"" src/router/modules/admin.ts && grep -c "系统设置" src/router/modules/admin.ts`
Expected: 第一条 = 14；第二条 ≥ 1

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/router/modules/admin.ts
git commit -m "refactor(web): 系统底层与引擎改名系统设置并按类别重组为5个分组"
```

---

### Task 2: 查重对比归入「小工具」组（bidding.ts）

**Files:**
- Modify: `packages/web/src/router/modules/bidding.ts`（仅顶层 `meta.title` 与 `icon`）

叶子 `/bidding/dedup` 与所有 `name` 保持不变，避免破坏收藏夹/深链。

- [ ] **Step 1: 改顶层 meta——`icon` 换工具图标、`title` 改「小工具」**

将开头的 meta 块：

```ts
  meta: {
    icon: "ri:file-copy-2-line",
    title: "投标",
    rank: 20
  },
```

替换为：

```ts
  meta: {
    icon: "ri:tools-line",
    title: "小工具",
    rank: 20
  },
```

- [ ] **Step 2: Typecheck**

Run: `cd packages/web && npm run typecheck`
Expected: PASS

- [ ] **Step 3: 结构校验**

Run: `cd packages/web && grep -q "title: \"小工具\"" src/router/modules/bidding.ts && grep -q "\"/bidding/dedup\"" src/router/modules/bidding.ts && echo OK`
Expected: `OK`（标题已改、dedup 叶子 path 仍在）

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/router/modules/bidding.ts
git commit -m "refactor(web): 查重对比归入小工具组（投标改名小工具）"
```

---

### Task 3: 车辆保养记录并入财务中心「车辆中心」

**Files:**
- Modify: `packages/web/src/router/modules/vehicle-maintenance.ts`（改为隐藏 redirect 桩）
- Modify: `packages/web/src/router/modules/finance.ts`（fleet 组改名「车辆中心」+ 新增保养记录叶子）

- [ ] **Step 1: 把 `vehicle-maintenance.ts` 整体替换为隐藏重定向桩**

```ts
const Layout = () => import("@/layout/index.vue");

export default {
  path: "/vehicle-maintenance",
  name: "VehicleMaintenance",
  component: Layout,
  redirect: "/finance/fleet/maintenance",
  meta: {
    icon: "ep/tools",
    title: "车辆保养",
    rank: 18,
    showLink: false
  },
  children: [
    {
      path: "/vehicle-maintenance/index",
      name: "VehicleMaintenanceIndex",
      redirect: "/finance/fleet/maintenance",
      meta: {
        title: "车辆保养记录(旧路径)",
        showLink: false
      }
    }
  ]
} satisfies RouteConfigsTable;
```

- [ ] **Step 2: `finance.ts` 里 fleet 组改名「车辆中心」**

将（`FinanceFleetCenter` 的 meta）：

```ts
      meta: {
        title: "车辆油卡",
        roles: ["super_admin", "manager", "finance"]
      },
```

替换为：

```ts
      meta: {
        title: "车辆中心",
        roles: ["super_admin", "manager", "finance"]
      },
```

- [ ] **Step 3: `finance.ts` 里在 fleet 组末尾（`FleetFuelDashboard` 之后）新增保养记录叶子**

将「用油健康总览」这个叶子对象：

```ts
        {
          path: "/finance/fleet/dashboard",
          name: "FleetFuelDashboard",
          component: () => import("@/views/finance/fleet/dashboard.vue"),
          meta: {
            title: "用油健康总览",
            roles: ["super_admin", "manager", "finance"]
          }
        }
      ]
    },
```

替换为（在其后追加保养记录叶子）：

```ts
        {
          path: "/finance/fleet/dashboard",
          name: "FleetFuelDashboard",
          component: () => import("@/views/finance/fleet/dashboard.vue"),
          meta: {
            title: "用油健康总览",
            roles: ["super_admin", "manager", "finance"]
          }
        },
        {
          path: "/finance/fleet/maintenance",
          name: "FleetMaintenanceRecords",
          component: () => import("@/views/vehicle-maintenance/index.vue"),
          meta: {
            title: "车辆保养记录",
            roles: [
              "super_admin",
              "manager",
              "finance",
              "site_manager",
              "operator"
            ]
          }
        }
      ]
    },
```

- [ ] **Step 4: Typecheck**

Run: `cd packages/web && npm run typecheck`
Expected: PASS

- [ ] **Step 5: 结构校验——新叶子在 finance、旧路径 redirect 在位**

Run: `cd packages/web && grep -q "FleetMaintenanceRecords" src/router/modules/finance.ts && grep -q "车辆中心" src/router/modules/finance.ts && grep -q "redirect: \"/finance/fleet/maintenance\"" src/router/modules/vehicle-maintenance.ts && grep -q "showLink: false" src/router/modules/vehicle-maintenance.ts && echo OK`
Expected: `OK`

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/router/modules/finance.ts packages/web/src/router/modules/vehicle-maintenance.ts
git commit -m "refactor(web): 车辆保养记录并入财务中心车辆中心，旧路径保留重定向"
```

---

### Task 4: 审批流转移入财务中心（删除 approval.ts 顶层）

**Files:**
- Modify: `packages/web/src/router/modules/finance.ts`（新增「审批流转」子分组，`/approval/*` path 与 name 全不变）
- Delete: `packages/web/src/router/modules/approval.ts`

- [ ] **Step 1: 确认 approval 模块无被直接 import（仅靠 glob 注册）**

Run: `cd packages/web && grep -rn "modules/approval" src --include="*.ts" --include="*.vue" | grep -v "router/modules/approval.ts" || echo "no direct import"`
Expected: `no direct import`

- [ ] **Step 2: `finance.ts` 在「车辆中心」组之后插入完整的审批流转子分组**

在 `FinanceFleetCenter` 组对象（以 `车辆中心`… 结尾、`}` `,` 收尾）之后、`/finance/legacy-reimbursement` 桩之前，插入：

```ts
    {
      path: "/approval",
      name: "Approval",
      component: Layout,
      redirect: "/approval/index",
      meta: {
        title: "审批流转",
        roles: [
          "super_admin",
          "manager",
          "site_manager",
          "finance",
          "operator"
        ]
      },
      children: [
        {
          path: "/approval/index",
          name: "ApprovalCenter",
          component: () => import("@/views/approval/index.vue"),
          meta: {
            title: "审批中心",
            roles: [
              "super_admin",
              "manager",
              "site_manager",
              "finance",
              "operator"
            ]
          }
        },
        {
          path: "/approval/unified-tasklist",
          name: "ApprovalUnifiedTasklist",
          redirect: "/approval/index",
          meta: {
            title: "统一审批台(旧路径)",
            showLink: false
          }
        },
        {
          path: "/approval/admin-monitor",
          name: "ApprovalAdminMonitor",
          component: () => import("@/views/approval/admin-monitor.vue"),
          meta: {
            title: "审批监控台",
            roles: ["super_admin", "manager"]
          }
        },
        {
          path: "/approval/detail/:id",
          name: "ApprovalDetail",
          component: () => import("@/views/approval/detail.vue"),
          meta: {
            title: "审批详情",
            showLink: false
          }
        },
        {
          path: "/approval/template-config",
          name: "ApprovalTemplateConfig",
          redirect: "/admin/workflow-designer",
          meta: {
            title: "审批模板配置(旧路径)",
            showLink: false
          }
        },
        {
          path: "/approval/threshold-config",
          name: "ApprovalThresholdConfig",
          redirect: "/admin/threshold-rules",
          meta: {
            title: "金额阈值配置(旧路径)",
            showLink: false
          }
        }
      ]
    },
```

- [ ] **Step 3: 删除顶层 approval 模块文件**

```bash
git rm packages/web/src/router/modules/approval.ts
```

- [ ] **Step 4: Typecheck**

Run: `cd packages/web && npm run typecheck`
Expected: PASS

- [ ] **Step 5: 结构校验——审批子树已在 finance、approval.ts 已删、无重复 name**

Run: `cd packages/web && test ! -f src/router/modules/approval.ts && grep -q "name: \"ApprovalCenter\"" src/router/modules/finance.ts && [ "$(grep -rho "name: \"Approval\"" src/router/modules | wc -l | tr -d ' ')" = "1" ] && echo OK`
Expected: `OK`（approval.ts 不存在；审批中心在 finance；`name:"Approval"` 全库仅 1 处）

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/router/modules/finance.ts
git commit -m "refactor(web): 审批流转移入财务中心，approval 路径与 name 保持不变"
```

---

### Task 5: 财务中心实体资料去重（重定向到系统设置）

**Files:**
- Modify: `packages/web/src/router/modules/finance.ts`（`FinanceEntityCenter` 组由可见入口改为隐藏 redirect 桩）

规范实体页已在系统设置「基础数据」组（Task 1）；此处删除可见重复入口，保留旧地址重定向。

- [ ] **Step 1: 把 `FinanceEntityCenter` 组替换为隐藏重定向桩**

将：

```ts
    {
      path: "/finance/entity-center",
      name: "FinanceEntityCenter",
      component: Layout,
      redirect: "/finance/entity/profile",
      meta: {
        title: "实体公司资料",
        roles: ["super_admin", "manager", "finance"]
      },
      children: [
        {
          path: "/finance/entity/profile",
          name: "FinanceEntityProfile",
          component: () => import("@/views/entity/index.vue"),
          meta: {
            title: "实体资料管理",
            roles: ["super_admin", "manager", "finance"]
          }
        }
      ]
    },
```

替换为：

```ts
    {
      path: "/finance/entity-center",
      name: "FinanceEntityCenter",
      component: Layout,
      redirect: "/admin/system-base/entity",
      meta: {
        title: "实体公司资料(旧路径)",
        showLink: false
      },
      children: [
        {
          path: "/finance/entity/profile",
          name: "FinanceEntityProfile",
          redirect: "/admin/system-base/entity",
          meta: {
            title: "实体资料管理(旧路径)",
            showLink: false
          }
        }
      ]
    },
```

- [ ] **Step 2: Typecheck**

Run: `cd packages/web && npm run typecheck`
Expected: PASS

- [ ] **Step 3: 结构校验——finance 不再 import entity 组件、旧路径重定向在位**

Run: `cd packages/web && ! grep -q "views/entity/index.vue" src/router/modules/finance.ts && grep -q "redirect: \"/admin/system-base/entity\"" src/router/modules/finance.ts && echo OK`
Expected: `OK`（finance 不再直接挂 entity 页；`/finance/entity/profile` 重定向到系统设置）

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/router/modules/finance.ts
git commit -m "refactor(web): 财务中心实体资料去重，旧路径重定向至系统设置基础数据"
```

---

### Task 6: 全量验证（typecheck + eslint + dev 人工核对）

**Files:** 无改动（如发现问题回到对应 task 修复）

- [ ] **Step 1: Typecheck 全绿**

Run: `cd packages/web && npm run typecheck`
Expected: PASS

- [ ] **Step 2: ESLint 全绿（含 vue 路由/命名规则）**

Run: `cd packages/web && npm run lint:eslint`
Expected: 无 error（重点关注 `vue/no-dupe-keys`、路由重复 name 类告警）

- [ ] **Step 3: 起本地 dev server**

Run: `cd packages/web && npm run dev`
Expected: 启动成功（默认 8849）

- [ ] **Step 4: 人工核对菜单树（super_admin 登录）**

逐项确认：
- 顶层不再有独立「车辆保养」「审批流转」「投标」菜单。
- 财务中心 下含：对内付款 / 对外付款 / 收款 / **车辆中心**（内含「车辆保养记录」）/ **审批流转**（审批中心、审批监控台）；不再有可见的「实体公司资料/实体资料管理」。
- 「**小工具**」顶层组内含「查重对比」。
- 「**系统设置**」顶层含 5 组：审批引擎 / AI 与计算节点 / 企业微信 / 系统监控与运维 / 基础数据，各组展开后叶子齐全。

- [ ] **Step 5: 人工核对旧地址不 404（不停机验收）**

浏览器直接访问，确认均正常打开或重定向到正确页：
- `/vehicle-maintenance/index` → 车辆保养记录
- `/approval/index`、`/approval/admin-monitor` → 审批中心/监控台
- `/finance/entity/profile` → 系统设置实体页
- `/bidding/dedup` → 查重对比
- 任取一个系统设置叶子如 `/admin/ai-center`、`/admin/system-base/dict` → 正常打开

- [ ] **Step 6: 停掉 dev server，最终确认工作区干净**

Run: `cd /Users/zihaoliu/Documents/Code/hybc_core && git status --short`
Expected: 无未提交改动（所有 task 已各自 commit）

---

## Self-Review 记录

- **Spec 覆盖:** 6 项需求逐一映射——改名+重组(Task1) / 查重对比(Task2) / 车辆保养(Task3) / 审批流转(Task4) / 实体去重(Task5) / 验证(Task6)。全覆盖。
- **占位符扫描:** 无 TBD/TODO，每处代码步骤均给出完整路由对象。
- **类型/命名一致性:** 新增 `name` 唯一（`FleetMaintenanceRecords`、`AdminGroup*`）；`Approval`/`ApprovalCenter` 等迁移后全库仅一处（Task4 Step5 断言）；被移动叶子的 `path`/`name` 与原文件逐字一致。
- **不停机:** 每个被移走的旧顶层 path 都有 `showLink:false` 的 redirect 桩；系统设置叶子 path 零变更故无需 redirect。
