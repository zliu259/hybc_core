const Layout = () => import("@/layout/index.vue");

export default {
  path: "/approval",
  name: "Approval",
  component: Layout,
  redirect: "/approval/index",
  meta: {
    icon: "ep:stamp",
    title: "审批流转",
    rank: 20
  },
  children: [
    {
      path: "/approval/index",
      name: "ApprovalCenter",
      component: () => import("@/views/approval/index.vue"),
      meta: {
        title: "审批中心",
        showLink: false,
        roles: ["super_admin", "manager", "site_manager", "finance", "operator"]
      }
    },
    {
      path: "/approval/unified-tasklist",
      name: "ApprovalUnifiedTasklist",
      component: () => import("@/views/approval/unified-tasklist.vue"),
      meta: {
        title: "统一审批台",
        roles: ["super_admin", "manager", "site_manager", "finance", "operator"]
      }
    },
    {
      path: "/approval/admin-monitor",
      name: "ApprovalAdminMonitor",
      component: () => import("@/views/approval/admin-monitor.vue"),
      meta: {
        title: "审批监控台",
        roles: ["super_admin"]
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
} satisfies RouteConfigsTable;
