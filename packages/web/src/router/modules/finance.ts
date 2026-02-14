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
    }
  ]
} satisfies RouteConfigsTable;
