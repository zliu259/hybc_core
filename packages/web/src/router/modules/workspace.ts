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
      component: () => import("@/views/workspace/reimbursement/list.vue"),
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
    }
  ]
} satisfies RouteConfigsTable;
