const Layout = () => import("@/layout/index.vue");

export default {
  path: "/approval",
  name: "Approval",
  component: Layout,
  redirect: "/approval/index",
  meta: {
    icon: "ep:stamp",
    title: "审批中心",
    rank: 20
  },
  children: [
    {
      path: "/approval/index",
      name: "ApprovalCenter",
      component: () => import("@/views/approval/index.vue"),
      meta: {
        title: "审批中心",
        roles: ["super_admin", "manager", "site_manager", "operator"]
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
      component: () => import("@/views/approval/template-config.vue"),
      meta: {
        title: "审批模板配置",
        roles: ["super_admin"]
      }
    },
    {
      path: "/approval/threshold-config",
      name: "ApprovalThresholdConfig",
      component: () => import("@/views/approval/threshold-config.vue"),
      meta: {
        title: "金额阈值配置",
        roles: ["super_admin"]
      }
    }
  ]
} satisfies RouteConfigsTable;
