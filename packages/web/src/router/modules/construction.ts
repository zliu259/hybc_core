const Layout = () => import("@/layout/index.vue");

export default {
  path: "/construction",
  name: "Construction",
  component: Layout,
  redirect: "/construction/operator-log/list",
  meta: {
    icon: "ep:histogram",
    title: "施工日志",
    rank: 18,
    showLink: false
  },
  children: [
    {
      path: "/construction/operator-log/list",
      name: "OperatorLogList",
      component: () => import("@/views/construction/operator-log/list.vue"),
      meta: {
        title: "操作员日志",
        roles: ["super_admin", "manager", "site_manager", "operator"]
      }
    },
    {
      path: "/construction/operator-log/form",
      name: "OperatorLogForm",
      component: () => import("@/views/construction/operator-log/form.vue"),
      meta: {
        title: "日志填报",
        roles: ["super_admin", "manager", "site_manager", "operator"]
      }
    },
    {
      path: "/construction/manager-log",
      name: "ManagerLog",
      component: () => import("@/views/construction/manager-log/index.vue"),
      meta: {
        title: "管理员日志",
        roles: ["super_admin", "manager", "site_manager"]
      }
    },
    {
      path: "/construction/breakthrough-report",
      name: "BreakthroughReport",
      component: () =>
        import("@/views/construction/breakthrough-report/index.vue"),
      meta: {
        title: "贯通报告",
        roles: ["super_admin", "manager", "site_manager", "operator"]
      }
    },
    {
      path: "/construction/site-survey",
      name: "SiteSurvey",
      component: () => import("@/views/construction/site-survey/index.vue"),
      meta: {
        title: "现场勘查",
        roles: ["super_admin", "manager", "site_manager", "operator"]
      }
    },
    {
      path: "/construction/dashboard",
      name: "ConstructionDashboard",
      component: () => import("@/views/construction/dashboard.vue"),
      meta: {
        title: "日志公示看板",
        roles: ["super_admin", "manager", "site_manager", "operator"]
      }
    },
    {
      path: "/construction/progress-alert",
      name: "ConstructionProgressAlert",
      component: () => import("@/views/construction/progress-alert.vue"),
      meta: {
        title: "进度预警",
        roles: ["super_admin", "manager", "site_manager", "operator"]
      }
    }
  ]
} satisfies RouteConfigsTable;
