const Layout = () => import("@/layout/index.vue");

export default {
  path: "/finance",
  name: "Finance",
  component: Layout,
  redirect: "/finance/outbound/contract",
  meta: {
    icon: "ep:money",
    title: "财务中心",
    rank: 15
  },
  children: [
    {
      path: "/finance/internal-payment",
      name: "FinanceInternalPayment",
      component: Layout,
      redirect: "/finance/reimbursement",
      meta: {
        title: "对内付款",
        roles: ["super_admin", "manager", "finance"]
      },
      children: [
        {
          path: "/finance/reimbursement",
          name: "ReimbursementList",
          component: () => import("@/views/finance/reimbursement/list.vue"),
          meta: {
            title: "报销付款工作台",
            roles: ["super_admin", "manager", "finance"]
          }
        },
        {
          path: "/finance/reimbursement/detail/:id",
          name: "ReimbursementDetail",
          component: () => import("@/views/finance/reimbursement/detail.vue"),
          meta: {
            title: "信封详情",
            roles: ["super_admin", "manager", "finance"],
            showLink: false
          }
        },
        {
          path: "/finance/reimbursement/batch",
          name: "ReimbursementBatchList",
          component: () => import("@/views/finance/reimbursement/batch.vue"),
          meta: {
            title: "报销集中审批",
            roles: ["super_admin", "manager", "finance"],
            showLink: false
          }
        },
        {
          path: "/finance/reimbursement/payout",
          name: "ReimbursementPayout",
          component: () => import("@/views/finance/reimbursement/payout.vue"),
          meta: {
            title: "报销集中打款",
            roles: ["super_admin", "manager", "finance"],
            showLink: false
          }
        },
        {
          path: "/finance/reimbursement/batch/:id",
          name: "ReimbursementBatchDetail",
          component: () =>
            import("@/views/finance/reimbursement/batch-detail.vue"),
          meta: {
            title: "报销批次详情",
            showLink: false
          }
        },
        {
          path: "/finance/reimbursement/envelope-generator",
          name: "ReimbursementEnvelopeGenerator",
          component: () =>
            import("@/views/finance/reimbursement/envelope-generator.vue"),
          meta: {
            title: "信封生成器",
            roles: ["super_admin", "manager", "finance"],
            showLink: false
          }
        }
      ]
    },
    {
      path: "/finance/outbound-payment",
      name: "FinanceOutboundPayment",
      component: Layout,
      redirect: "/finance/contract",
      meta: {
        title: "对外付款",
        roles: ["super_admin", "manager", "finance"]
      },
      children: [
        {
          path: "/finance/contract",
          name: "ContractList",
          component: () => import("@/views/finance/contract/index.vue"),
          meta: {
            title: "合同管理",
            roles: ["super_admin", "manager", "finance"]
          }
        },
        {
          path: "/finance/outbound/contract",
          name: "OutboundContractAlias",
          redirect: "/finance/contract",
          meta: {
            title: "合同管理(别名)",
            showLink: false
          }
        },
        {
          path: "/finance/contract/monitor",
          name: "ContractMonitor",
          component: () => import("@/views/finance/contract/monitor.vue"),
          meta: {
            title: "合同执行监控",
            roles: ["super_admin", "manager", "finance"]
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
            roles: ["super_admin", "manager", "finance"]
          }
        },
        {
          path: "/finance/payment/wizard",
          name: "SmartPaymentWizard",
          component: () => import("@/views/finance/payment/wizard.vue"),
          meta: {
            title: "智能发单台",
            roles: ["super_admin", "manager", "finance"]
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
            roles: ["super_admin", "manager", "finance"]
          }
        }
      ]
    },
    {
      path: "/finance/receipts",
      name: "FinanceReceipts",
      component: Layout,
      redirect: "/finance/receipt/contract",
      meta: {
        title: "收款",
        roles: ["super_admin", "manager", "finance"]
      },
      children: [
        {
          path: "/finance/receipt/contract",
          name: "InboundContractList",
          component: () => import("@/views/finance/receipt/contract.vue"),
          meta: {
            title: "收款合同",
            roles: ["super_admin", "manager", "finance"]
          }
        },
        {
          path: "/finance/receipt/invoice",
          name: "InvoiceList",
          component: () => import("@/views/finance/receipt/invoice.vue"),
          meta: {
            title: "发票管理",
            roles: ["super_admin", "manager", "finance"]
          }
        },
        {
          path: "/finance/receipt",
          name: "ReceiptList",
          component: () => import("@/views/finance/receipt/list.vue"),
          meta: {
            title: "收款登记",
            roles: ["super_admin", "manager", "finance"]
          }
        },
        {
          path: "/finance/receipt/detail/:id",
          name: "ReceiptDetail",
          component: () => import("@/views/finance/receipt/detail.vue"),
          meta: {
            title: "收款登记详情",
            roles: ["super_admin", "manager", "finance"],
            showLink: false
          }
        },
        {
          path: "/finance/snapshot",
          name: "FinanceSnapshot",
          component: () => import("@/views/finance/receipt/dashboard.vue"),
          meta: {
            title: "财务报表快照",
            roles: ["super_admin", "manager", "finance"]
          }
        },
        {
          path: "/finance/receipt/dashboard",
          name: "ReceiptDashboard",
          redirect: "/finance/snapshot",
          meta: {
            title: "收款统计(旧路径)",
            showLink: false
          }
        }
      ]
    },
    {
      path: "/finance/entity-center",
      name: "FinanceEntityCenter",
      component: Layout,
      redirect: "/finance/entity/profile",
      meta: {
        title: "实体公司资料",
        roles: ["super_admin", "manager", "finance"]
      },
      children: [
        {
          path: "/finance/entity/profile",
          name: "FinanceEntityProfile",
          component: () => import("@/views/entity/index.vue"),
          meta: {
            title: "实体资料管理",
            roles: ["super_admin", "manager", "finance"]
          }
        }
      ]
    },
    {
      path: "/finance/fleet-center",
      name: "FinanceFleetCenter",
      component: Layout,
      redirect: "/finance/fleet/application",
      meta: {
        title: "车辆油卡",
        roles: ["super_admin", "manager", "finance"]
      },
      children: [
        {
          path: "/finance/fleet/application",
          name: "FuelQuotaApplicationPage",
          component: () => import("@/views/finance/fleet/application.vue"),
          meta: {
            title: "油卡额度申请",
            roles: ["super_admin", "manager", "finance"]
          }
        },
        {
          path: "/finance/fleet/applications-all",
          name: "FuelQuotaApplicationAllList",
          component: () =>
            import("@/views/finance/fleet/applications-list.vue"),
          meta: {
            title: "油卡额度全量处理",
            roles: ["super_admin", "manager", "finance"]
          }
        },
        {
          path: "/finance/fleet/vehicles",
          name: "FleetVehicleOps",
          component: () => import("@/views/finance/fleet/vehicles.vue"),
          meta: {
            title: "车辆与办公室处理",
            roles: ["super_admin", "manager", "finance"]
          }
        },
        {
          path: "/finance/fleet/dashboard",
          name: "FleetFuelDashboard",
          component: () => import("@/views/finance/fleet/dashboard.vue"),
          meta: {
            title: "车辆用油总览",
            roles: ["super_admin", "manager", "finance"]
          }
        }
      ]
    },
    {
      path: "/finance/legacy-reimbursement",
      name: "ReimbursementLegacyRedirect",
      redirect: "/finance/reimbursement",
      meta: {
        title: "报销入口(旧路径)",
        showLink: false
      }
    }
  ]
} satisfies RouteConfigsTable;
