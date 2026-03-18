const Layout = () => import("@/layout/index.vue");

export default {
  path: "/workspace",
  name: "Workspace",
  component: Layout,
  redirect: "/workspace/home",
  meta: {
    icon: "ep/home-filled",
    title: "个人工作台",
    rank: 2
  },
  children: [
    {
      path: "/workspace/home",
      name: "WorkspaceHome",
      component: () => import("@/views/welcome/index.vue"),
      meta: {
        title: "个人工作台",
        roles: ["super_admin", "manager", "site_manager", "finance", "operator"]
      }
    },
    {
      path: "/workspace/my-reimbursement",
      name: "WorkspaceMyReimbursement",
      component: () => import("@/views/finance/reimbursement/list.vue"),
      meta: {
        title: "我的报销",
        roles: ["super_admin", "manager", "site_manager", "finance", "operator"]
      }
    },
    {
      path: "/workspace/my-reimbursement/detail/:id",
      name: "WorkspaceMyReimbursementDetail",
      component: () => import("@/views/finance/reimbursement/detail.vue"),
      meta: {
        title: "我的报销详情",
        roles: [
          "super_admin",
          "manager",
          "site_manager",
          "finance",
          "operator"
        ],
        showLink: false
      }
    },
    {
      path: "/workspace/my-applications",
      name: "WorkspaceMyApplications",
      component: () => import("@/views/workspace/my-applications/index.vue"),
      meta: {
        title: "我的申请",
        roles: ["super_admin", "manager", "site_manager", "finance", "operator"]
      }
    },
    {
      path: "/workspace/payment/wizard",
      name: "WorkspacePaymentWizard",
      component: () => import("@/views/finance/payment/wizard.vue"),
      meta: {
        title: "发起对外付款",
        roles: [
          "super_admin",
          "manager",
          "site_manager",
          "finance",
          "operator"
        ],
        showLink: false
      }
    },
    {
      path: "/workspace/payment/detail/:id",
      name: "WorkspacePaymentDetail",
      component: () => import("@/views/finance/payment/detail.vue"),
      meta: {
        title: "付款申请详情",
        roles: [
          "super_admin",
          "manager",
          "site_manager",
          "finance",
          "operator"
        ],
        showLink: false
      }
    },
    {
      path: "/workspace/fuel-application",
      name: "WorkspaceFuelApplication",
      component: () => import("@/views/finance/fleet/application.vue"),
      meta: {
        title: "油卡额度申请",
        roles: [
          "super_admin",
          "manager",
          "site_manager",
          "finance",
          "operator"
        ],
        showLink: false
      }
    },
    {
      path: "/workspace/payee",
      name: "WorkspacePayeeList",
      component: () => import("@/views/finance/payee/index.vue"),
      meta: {
        title: "外部收款人",
        roles: [
          "super_admin",
          "manager",
          "site_manager",
          "finance",
          "operator"
        ],
        showLink: false
      }
    },
    {
      path: "/workspace/payee-external",
      name: "WorkspacePayeeExternal",
      component: () => import("@/views/finance/payee/index.vue"),
      meta: {
        title: "添加外部收款人",
        roles: [
          "super_admin",
          "manager",
          "site_manager",
          "finance",
          "operator"
        ],
        showLink: false
      }
    }
  ]
} satisfies RouteConfigsTable;
