const Layout = () => import("@/layout/index.vue");

export default {
  path: "/admin",
  name: "AdminSettings",
  component: Layout,
  redirect: "/admin/workflow-designer",
  meta: {
    icon: "ep:setting",
    title: "系统底层与引擎",
    rank: 90
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
    },
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
      path: "/admin/runner-center",
      name: "AdminRunnerCenter",
      component: () => import("@/views/ai/nodes.vue"),
      meta: {
        title: "Runner监控中心",
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
      path: "/admin/ops-center",
      name: "AdminOpsCenter",
      component: () => import("@/views/admin/ops-center.vue"),
      meta: {
        title: "服务监控中心",
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
    },
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
} satisfies RouteConfigsTable;
