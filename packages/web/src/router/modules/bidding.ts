const Layout = () => import("@/layout/index.vue");

export default {
  path: "/bidding",
  name: "Bidding",
  component: Layout,
  redirect: "/bidding/dedup",
  meta: {
    icon: "ri:tools-line",
    title: "实用工具",
    rank: 20
  },
  children: [
    {
      path: "/bidding/dedup",
      name: "BiddingDedup",
      component: () => import("@/views/bidding/dedup/index.vue"),
      meta: {
        title: "查重对比",
        roles: ["super_admin", "manager", "site_manager", "operator"]
      }
    },
    {
      path: "/finance/contract/draft",
      name: "ContractDraftWorkbench",
      component: () => import("@/views/finance/contract/draft/index.vue"),
      meta: {
        title: "合同生成",
        roles: ["super_admin", "manager", "finance"]
      }
    }
  ]
} satisfies RouteConfigsTable;
