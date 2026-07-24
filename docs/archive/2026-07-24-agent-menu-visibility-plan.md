# 智能体接入菜单开放 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将“智能体接入配置”和“设备授权”开放到“系统设置 → AI 与计算节点”，供全部现有角色直接从菜单访问，同时保持两个确认入口隐藏。

**Architecture:** 把两个可见的绝对路径子路由从隐藏的 `agent.ts` 移入 `admin.ts` 的 `AdminGroupAi.children`，因此 URL 与页面组件保持不变，只改变侧边菜单归属。隐藏的 `/agent` 路由组继续承载设备授权确认和高危操作确认页。

**Tech Stack:** Vue 3、Vue Router、PureAdmin 静态路由、TypeScript、Vitest。

**Status:** 已按计划实现并归档；仓库规则要求未经明确授权不创建 Git commit。

## Global Constraints

- `/agent/setup` 和 `/agent/grants` 的 URL、路由名与页面组件不得变化。
- `super_admin`、`manager`、`site_manager`、`finance`、`operator` 均可看到两个新菜单。
- `/agent/authorize` 和 `/agent/confirm` 必须继续设置 `showLink: false`。
- AI 引擎、AI 关卡、Runner 等既有页面的子路由角色不得放宽。
- 不修改 MCP、API、数据库、高危写生产开关或页面业务交互。
- UI 映射必须同步更新 `doc/UI设计文档.md`。
- 开发记录只追加到 `doc/开发记录.md`。
- 未经用户明确要求，不创建 Git commit。

---

### Task 1: 用路由回归测试驱动菜单迁移

**Files:**
- Create: `packages/web/src/router/modules/agent-menu.test.ts`
- Modify: `packages/web/src/router/modules/admin.ts`
- Modify: `packages/web/src/router/modules/agent.ts`

**Interfaces:**
- Consumes: PureAdmin `RouteConfigsTable` 静态路由对象。
- Produces: `AdminGroupAi` 下可见的 `AgentSetup`、`AgentGrants` 路由；隐藏 Agent 组下的 `AgentAuthorize`、`AgentConfirm` 路由。

- [ ] **Step 1: 写入失败的路由结构测试**

```ts
import { describe, expect, it } from "vitest";

import adminRoutes from "./admin";
import agentRoutes from "./agent";

type RouteMeta = {
  showLink?: boolean;
  roles?: string[];
  title?: string;
};

type RouteNode = {
  path: string;
  name?: string;
  component?: unknown;
  meta?: RouteMeta;
  children?: RouteNode[];
};

const ALL_ROLES = [
  "super_admin",
  "manager",
  "site_manager",
  "finance",
  "operator"
];

const asRoute = (route: unknown): RouteNode => route as RouteNode;

const requireChild = (parent: RouteNode, path: string): RouteNode => {
  const child = parent.children?.find(route => route.path === path);
  expect(child, `missing route ${path}`).toBeDefined();
  if (!child) throw new Error(`missing route ${path}`);
  return child;
};

describe("智能体接入菜单路由", () => {
  it("在 AI 与计算节点下向全部角色开放接入配置和设备授权", () => {
    const aiGroup = requireChild(asRoute(adminRoutes), "/admin/g-ai");
    expect(aiGroup.meta?.roles).toEqual(ALL_ROLES);

    const setup = requireChild(aiGroup, "/agent/setup");
    expect(setup.name).toBe("AgentSetup");
    expect(setup.meta).toEqual({
      title: "智能体接入配置",
      roles: ALL_ROLES
    });
    expect(typeof setup.component).toBe("function");

    const grants = requireChild(aiGroup, "/agent/grants");
    expect(grants.name).toBe("AgentGrants");
    expect(grants.meta).toEqual({
      title: "设备授权",
      roles: ALL_ROLES
    });
    expect(typeof grants.component).toBe("function");
  });

  it("保留设备授权确认和高危操作确认两个隐藏入口", () => {
    const hiddenAgentGroup = asRoute(agentRoutes);
    expect(hiddenAgentGroup.meta?.showLink).toBe(false);
    expect(hiddenAgentGroup.children?.map(route => route.path)).toEqual([
      "/agent/authorize",
      "/agent/confirm"
    ]);

    for (const route of hiddenAgentGroup.children ?? []) {
      expect(route.meta?.showLink).toBe(false);
      expect(route.meta?.roles).toEqual(ALL_ROLES);
    }
  });

  it("不放宽既有 AI 管理页面权限", () => {
    const aiGroup = requireChild(asRoute(adminRoutes), "/admin/g-ai");
    expect(requireChild(aiGroup, "/admin/ai-center").meta?.roles).toEqual([
      "super_admin"
    ]);
    expect(requireChild(aiGroup, "/admin/ai-gate-tasks").meta?.roles).toEqual([
      "super_admin"
    ]);
    expect(requireChild(aiGroup, "/admin/runner-center").meta?.roles).toEqual([
      "super_admin"
    ]);
    expect(requireChild(aiGroup, "/admin/vertex-bridge").meta?.roles).toEqual([
      "super_admin",
      "manager",
      "site_manager"
    ]);
  });
});
```

- [ ] **Step 2: 运行目标测试并确认 RED**

Run:

```bash
pnpm --filter pure-admin-thin exec vitest run src/router/modules/agent-menu.test.ts
```

Expected: FAIL，错误明确指出 `AdminGroupAi` 缺少 `/agent/setup`。

- [ ] **Step 3: 在 `admin.ts` 中扩展父级角色并加入两个可见子路由**

把 `AdminGroupAi.meta.roles` 改为：

```ts
roles: ["super_admin", "manager", "site_manager", "finance", "operator"]
```

在 `AdminGroupAi.children` 中加入：

```ts
{
  path: "/agent/setup",
  name: "AgentSetup",
  component: () => import("@/views/agent/setup.vue"),
  meta: {
    title: "智能体接入配置",
    roles: ["super_admin", "manager", "site_manager", "finance", "operator"]
  }
},
{
  path: "/agent/grants",
  name: "AgentGrants",
  component: () => import("@/views/agent/grants.vue"),
  meta: {
    title: "设备授权",
    roles: ["super_admin", "manager", "site_manager", "finance", "operator"]
  }
}
```

- [ ] **Step 4: 从 `agent.ts` 删除两个已迁移的可见子路由**

删除 `AgentSetup` 和 `AgentGrants` 两个 child，保留 `/agent` 父路由的
`showLink: false`，并保留 `AgentAuthorize`、`AgentConfirm` 两个 child。

- [ ] **Step 5: 运行目标测试并确认 GREEN**

Run:

```bash
pnpm --filter pure-admin-thin exec vitest run src/router/modules/agent-menu.test.ts
```

Expected: 1 个测试文件、3 个测试全部通过。

- [ ] **Step 6: 对三个路由文件运行 ESLint**

Run:

```bash
pnpm --filter pure-admin-thin exec eslint src/router/modules/admin.ts src/router/modules/agent.ts src/router/modules/agent-menu.test.ts --max-warnings 0
```

Expected: exit 0，无 lint error 或 warning。

---

### Task 2: 同步长期 UI 文档、开发记录和归档索引

**Files:**
- Modify: `doc/UI设计文档.md`
- Modify: `doc/开发记录.md`
- Modify: `doc/README.md`
- Modify: `docs/planned/README.md`
- Modify: `docs/archive/README.md`
- Move: `docs/planned/2026-07-24-agent-menu-visibility-design.md` → `docs/archive/2026-07-24-agent-menu-visibility-design.md`
- Move: `docs/planned/2026-07-24-agent-menu-visibility-plan.md` → `docs/archive/2026-07-24-agent-menu-visibility-plan.md`

**Interfaces:**
- Consumes: Task 1 的最终路由层级和角色范围。
- Produces: 与当前实现一致的页面级映射、单一开发记录和文档状态索引。

- [ ] **Step 1: 修正 `doc/UI设计文档.md` 的页面映射**

把接入配置条目改为：

```md
- 接入配置：`/agent/setup` → `packages/web/src/views/agent/setup.vue`（菜单：系统设置 → AI 与计算节点 → 智能体接入配置，全角色可见）
```

把设备授权条目改为：

```md
- 设备授权：`/agent/grants` → `packages/web/src/views/agent/grants.vue`（菜单：系统设置 → AI 与计算节点 → 设备授权，全角色可见）
```

把 Web 路由模块说明改为同时指向：

```md
- Web API 封装：`packages/web/src/api/agent.ts`；可见菜单路由：`packages/web/src/router/modules/admin.ts`；隐藏确认路由：`packages/web/src/router/modules/agent.ts`
```

把 9.3 备注替换为：

```md
- “智能体接入配置”和“设备授权”位于“系统设置 → AI 与计算节点”，对全部现有角色可见；`/agent/authorize` 与 `/agent/confirm` 始终隐藏，仅允许业务链接直达。
```

- [ ] **Step 2: 追加唯一开发记录**

在 `doc/开发记录.md` 末尾追加：

```md
## 2026-07-24 10:54 (AEST)

### 智能体接入页面开放到系统设置

- 将 `/agent/setup`“智能体接入配置”和 `/agent/grants`“设备授权”从隐藏的独立 Agent 菜单组迁入“系统设置 → AI 与计算节点”，URL 和页面组件保持不变。
- “AI 与计算节点”父路由覆盖 `super_admin`、`manager`、`site_manager`、`finance`、`operator`；其他 AI 管理子页面继续执行原有角色限制。
- `/agent/authorize` 与 `/agent/confirm` 继续留在隐藏路由组，不进入侧边菜单。
- 新增路由结构回归测试，覆盖菜单归属、全角色可见、隐藏确认入口和既有 AI 权限不放宽。
```

- [ ] **Step 3: 把已实现设计与计划移入 archive**

使用补丁移动：

```text
docs/planned/2026-07-24-agent-menu-visibility-design.md
  → docs/archive/2026-07-24-agent-menu-visibility-design.md
docs/planned/2026-07-24-agent-menu-visibility-plan.md
  → docs/archive/2026-07-24-agent-menu-visibility-plan.md
```

- [ ] **Step 4: 更新三个文档索引**

`docs/planned/README.md` 的清单恢复为：

```md
暂无待实现计划。
```

在 `docs/archive/README.md` 的功能特性清单加入：

```md
- 智能体接入页面开放到系统设置：`2026-07-24-agent-menu-visibility-design.md`、`2026-07-24-agent-menu-visibility-plan.md`
```

`doc/README.md` 的待实现计划恢复为：

```md
- 详见 `docs/planned/README.md`。当前暂无待实现计划。
```

- [ ] **Step 5: 校验文档一致性**

Run:

```bash
rg -n "智能体接入配置|设备授权|agent/setup|agent/grants" doc/UI设计文档.md docs/archive/2026-07-24-agent-menu-visibility-design.md docs/archive/2026-07-24-agent-menu-visibility-plan.md
```

Expected: UI 文档明确显示两个页面位于“系统设置 → AI 与计算节点”；设计和计划均存在 archive。

Run:

```bash
git diff --check
```

Expected: exit 0。

---

### Task 3: 完整 Web 验证和最终审查

**Files:**
- Verify only: `packages/web`
- Review: all changed files

**Interfaces:**
- Consumes: Task 1 的路由实现和 Task 2 的文档同步。
- Produces: 可交付的、未提交的工作区变更及验证证据。

- [ ] **Step 1: 运行完整 Web 测试**

Run:

```bash
pnpm --filter pure-admin-thin run test
```

Expected: 全部测试通过，0 failed。

- [ ] **Step 2: 运行 Web 类型检查**

Run:

```bash
pnpm --filter pure-admin-thin run typecheck
```

Expected: exit 0，无 TypeScript/Vue 类型错误。

- [ ] **Step 3: 运行生产构建**

Run:

```bash
pnpm --filter pure-admin-thin run build
```

Expected: exit 0，Vite 生产构建完成。

- [ ] **Step 4: 检查差异和工作区**

Run:

```bash
git diff --check
git status --short
git diff -- packages/web/src/router/modules/admin.ts packages/web/src/router/modules/agent.ts packages/web/src/router/modules/agent-menu.test.ts doc/UI设计文档.md doc/开发记录.md doc/README.md docs/planned/README.md docs/archive/README.md docs/archive/2026-07-24-agent-menu-visibility-design.md docs/archive/2026-07-24-agent-menu-visibility-plan.md
```

Expected:

- 仅包含本功能的路由、测试和文档变更。
- 没有重复路由名。
- 没有把两个确认页暴露到菜单。
- 没有 Git commit。
