const Layout = () => import("@/layout/index.vue");

export default {
  path: "/bidding",
  name: "Bidding",
  component: Layout,
  redirect: "/bidding/dedup",
  meta: {
    icon: "ri:file-copy-2-line",
    title: "投标",
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
    }
  ]
} satisfies RouteConfigsTable;
