# 智能体接入页面开放到系统设置设计

## 状态

- 已实现并归档。
- 采用方案 A：把两个可见页面直接挂到“系统设置 → AI 与计算节点”路由组，保留原 URL。

## 目标

让所有现有业务角色都能从侧边菜单直接访问：

- `/agent/setup`：智能体接入配置
- `/agent/grants`：设备授权

菜单层级统一为：

`系统设置 → AI 与计算节点 → 智能体接入配置 / 设备授权`

## 当前问题

`packages/web/src/router/modules/agent.ts` 的 `/agent` 父路由设置了
`showLink: false`，导致“接入配置”和“设备授权”虽可通过 URL 直达，但不会出现在侧边菜单。

现有“系统设置 → AI 与计算节点”由
`packages/web/src/router/modules/admin.ts` 中的 `AdminGroupAi` 承载，正是这两个页面应归属的位置。

## 路由设计

### 可见菜单

将以下两个绝对路径子路由定义移入 `AdminGroupAi.children`：

| 路径 | 路由名 | 页面 | 菜单标题 |
| --- | --- | --- | --- |
| `/agent/setup` | `AgentSetup` | `packages/web/src/views/agent/setup.vue` | 智能体接入配置 |
| `/agent/grants` | `AgentGrants` | `packages/web/src/views/agent/grants.vue` | 设备授权 |

URL 和页面组件保持不变，已有页面内链接、收藏地址及安装流程不需要迁移。

### 继续隐藏的安全入口

`packages/web/src/router/modules/agent.ts` 继续保留隐藏父路由，并仅承载：

- `/agent/authorize`：设备授权确认，只允许由设备授权链接进入。
- `/agent/confirm`：高危操作确认，只允许由企业微信确认卡片进入。

这两个子路由继续设置 `showLink: false`，不得出现在侧边菜单。

## 权限设计

`AdminGroupAi` 的父级角色扩展为全部现有角色：

- `super_admin`
- `manager`
- `site_manager`
- `finance`
- `operator`

新增的两个智能体菜单同样允许以上全部角色访问。其他 AI 与计算节点页面继续保留自身更严格的子路由角色限制，例如 AI 引擎配置和 Runner 监控仍仅允许 `super_admin`。

因此，放宽父路由只提供菜单容器可见性，不放宽其他管理页面的实际访问权限。

## 测试策略

先增加路由结构回归测试并确认测试因当前隐藏结构而失败，再进行最小实现：

1. 断言 `AdminGroupAi` 包含 `/agent/setup` 和 `/agent/grants`。
2. 断言父路由覆盖全部五类角色。
3. 断言两个可见页面保持原路径、路由名和页面组件。
4. 断言 `/agent/authorize`、`/agent/confirm` 仍在隐藏路由中且 `showLink: false`。
5. 断言现有 AI 管理子页面的角色权限没有被放宽。

实现后运行目标路由测试、Web typecheck、Web 测试及 Web 构建。

## 文档更新

实现时同步更新：

- `doc/UI设计文档.md`：修正两个页面的菜单层级和角色说明。
- `doc/开发记录.md`：追加符合统一时间格式的实现记录。
- `docs/planned/README.md`、`docs/archive/README.md`、`doc/README.md`：实现完成后把本设计从 planned 移入 archive 并更新索引。

## 非目标

- 不修改 MCP 服务、API 或授权令牌逻辑。
- 不开放高危确认页到菜单。
- 不改变高危写生产开关。
- 不修改页面视觉样式或业务交互。
- 不创建新的 URL 或兼容性重定向。

## 回滚

若需要回滚，只需从 `AdminGroupAi` 移除两个可见子路由并把它们恢复到隐藏的 `/agent` 路由组；页面组件、API 和数据均不受影响。
