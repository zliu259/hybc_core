const Layout = () => import("@/layout/index.vue");

export default {
  path: "/asset",
  name: "Asset",
  component: Layout,
  redirect: "/asset/list",
  meta: {
    icon: "ep:box",
    title: "资产管理",
    rank: 16
  },
  children: [
    {
      path: "/asset/type-config",
      name: "AssetTypeConfig",
      component: () => import("@/views/asset/type-config.vue"),
      meta: {
        title: "资产类型",
        roles: ["super_admin", "manager", "site_manager"]
      }
    },
    {
      path: "/asset/list",
      name: "AssetList",
      component: () => import("@/views/asset/list.vue"),
      meta: {
        title: "资产台账",
        roles: ["super_admin", "manager", "site_manager", "operator"]
      }
    },
    {
      path: "/asset/detail/:id",
      name: "AssetDetail",
      component: () => import("@/views/asset/detail.vue"),
      meta: {
        title: "资产详情",
        showLink: false,
        roles: ["super_admin", "manager", "site_manager", "operator"]
      }
    },
    {
      path: "/asset/dashboard",
      name: "AssetDashboard",
      component: () => import("@/views/asset/dashboard.vue"),
      meta: {
        title: "设备总览",
        roles: ["super_admin", "manager", "site_manager", "operator"]
      }
    }
  ]
} satisfies RouteConfigsTable;
