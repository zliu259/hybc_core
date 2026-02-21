const Layout = () => import("@/layout/index.vue");

export default {
  path: "/finance",
  name: "Finance",
  component: Layout,
  redirect: "/finance/contract",
  meta: {
    icon: "ep:money",
    title: "财务管理",
    rank: 15
  },
  children: [
    {
      path: "/finance/contract",
      name: "ContractList",
      component: () => import("@/views/finance/contract/index.vue"),
      meta: {
        title: "合同管理",
        roles: ["super_admin", "manager", "site_manager"]
      }
    },
    {
      path: "/finance/contract/monitor",
      name: "ContractMonitor",
      component: () => import("@/views/finance/contract/monitor.vue"),
      meta: {
        title: "合同执行监控",
        roles: ["super_admin", "manager", "site_manager"]
      }
    },
    {
      path: "/finance/contract/detail/:id",
      name: "ContractDetail",
      component: () => import("@/views/finance/contract/detail.vue"),
      meta: {
        title: "合同详情",
        showLink: false
      }
    },
    {
      path: "/finance/payment",
      name: "PaymentList",
      component: () => import("@/views/finance/payment/index.vue"),
      meta: {
        title: "付款管理",
        roles: ["super_admin", "manager", "site_manager"]
      }
    },
    {
      path: "/finance/payment/wizard",
      name: "SmartPaymentWizard",
      component: () => import("@/views/finance/payment/wizard.vue"),
      meta: {
        title: "智能发单台",
        roles: ["super_admin", "manager", "site_manager"]
      }
    },
    {
      path: "/finance/payment/detail/:id",
      name: "PaymentDetail",
      component: () => import("@/views/finance/payment/detail.vue"),
      meta: {
        title: "付款详情",
        showLink: false
      }
    },
    {
      path: "/finance/payee",
      name: "PayeeList",
      component: () => import("@/views/finance/payee/index.vue"),
      meta: {
        title: "收款人管理",
        roles: ["super_admin", "manager", "site_manager"]
      }
    },
    {
      path: "/finance/receipt/contract",
      name: "InboundContractList",
      component: () => import("@/views/finance/receipt/contract.vue"),
      meta: {
        title: "收款合同",
        roles: ["super_admin", "manager", "site_manager", "operator"]
      }
    },
    {
      path: "/finance/receipt/invoice",
      name: "InvoiceList",
      component: () => import("@/views/finance/receipt/invoice.vue"),
      meta: {
        title: "发票管理",
        roles: ["super_admin", "manager", "site_manager", "operator"]
      }
    },
    {
      path: "/finance/receipt",
      name: "ReceiptList",
      component: () => import("@/views/finance/receipt/list.vue"),
      meta: {
        title: "收款登记",
        roles: ["super_admin", "manager", "site_manager", "operator"]
      }
    },
    {
      path: "/finance/receipt/dashboard",
      name: "ReceiptDashboard",
      component: () => import("@/views/finance/receipt/dashboard.vue"),
      meta: {
        title: "收款统计",
        roles: ["super_admin", "manager", "site_manager", "operator"]
      }
    },
    {
      path: "/finance/reimbursement",
      name: "ReimbursementList",
      component: () => import("@/views/finance/reimbursement/list.vue"),
      meta: {
        title: "报销信封",
        roles: ["super_admin", "manager", "site_manager", "operator"]
      }
    },
    {
      path: "/finance/reimbursement/detail/:id",
      name: "ReimbursementDetail",
      component: () => import("@/views/finance/reimbursement/detail.vue"),
      meta: {
        title: "信封详情",
        showLink: false
      }
    },
    {
      path: "/finance/reimbursement/precheck",
      name: "ReimbursementPrecheck",
      component: () => import("@/views/finance/reimbursement/precheck.vue"),
      meta: {
        title: "预审工作台",
        roles: ["super_admin", "manager", "site_manager"]
      }
    },
    {
      path: "/finance/reimbursement/duplicate",
      name: "ReimbursementDuplicate",
      component: () => import("@/views/finance/reimbursement/duplicate.vue"),
      meta: {
        title: "查重中心",
        roles: ["super_admin", "manager", "site_manager"]
      }
    },
    {
      path: "/finance/reimbursement/batch",
      name: "ReimbursementBatchList",
      component: () => import("@/views/finance/reimbursement/batch.vue"),
      meta: {
        title: "报销集中审批",
        roles: ["super_admin", "manager", "site_manager", "operator"]
      }
    },
    {
      path: "/finance/reimbursement/payout",
      name: "ReimbursementPayout",
      component: () => import("@/views/finance/reimbursement/payout.vue"),
      meta: {
        title: "报销集中打款",
        roles: ["super_admin", "manager", "site_manager"]
      }
    },
    {
      path: "/finance/reimbursement/batch/:id",
      name: "ReimbursementBatchDetail",
      component: () => import("@/views/finance/reimbursement/batch-detail.vue"),
      meta: {
        title: "报销批次详情",
        showLink: false
      }
    }
  ]
} satisfies RouteConfigsTable;
