const Layout = () => import("@/layout/index.vue");

export default {
  path: "/agent",
  name: "Agent",
  component: Layout,
  redirect: "/agent/setup",
  meta: {
    icon: "ep:cpu",
    title: "智能体接入",
    rank: 19,
    // 仅承载由设备授权链接或企业微信卡片进入的确认页，不进入侧边菜单。
    showLink: false
  },
  children: [
    {
      path: "/agent/authorize",
      name: "AgentAuthorize",
      component: () => import("@/views/agent/authorize.vue"),
      meta: {
        title: "设备授权确认",
        showLink: false,
        roles: ["super_admin", "manager", "site_manager", "finance", "operator"]
      }
    },
    {
      path: "/agent/confirm",
      name: "AgentConfirm",
      component: () => import("@/views/agent/confirm.vue"),
      meta: {
        title: "高危操作确认",
        showLink: false,
        roles: ["super_admin", "manager", "site_manager", "finance", "operator"]
      }
    }
  ]
} satisfies RouteConfigsTable;
