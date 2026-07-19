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
    // P2 微信闸门上线前运营冻结：整组暂不进侧边菜单，页面仍可直达；P2 就绪后删除本行
    showLink: false
  },
  children: [
    {
      path: "/agent/setup",
      name: "AgentSetup",
      component: () => import("@/views/agent/setup.vue"),
      meta: {
        title: "接入配置",
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
    },
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
