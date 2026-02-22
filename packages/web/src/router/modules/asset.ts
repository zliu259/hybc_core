const Layout = () => import("@/layout/index.vue");

export default {
  path: "/asset",
  name: "Asset",
  component: Layout,
  redirect: "/warehouse-assets/ledger",
  meta: {
    icon: "ep:box",
    title: "资产台账(旧路径)",
    showLink: false
  },
  children: [
    {
      path: "/asset/type-config",
      name: "AssetTypeConfig",
      redirect: "/warehouse-assets/templates",
      meta: {
        title: "资产类型(旧路径)",
        showLink: false
      }
    },
    {
      path: "/asset/list",
      name: "AssetList",
      redirect: "/warehouse-assets/ledger",
      meta: {
        title: "资产台账(旧路径)",
        showLink: false
      }
    },
    {
      path: "/asset/ledger",
      name: "AssetLedgerBoard",
      redirect: "/warehouse-assets/ledger",
      meta: {
        title: "资产运维看板(旧路径)",
        showLink: false
      }
    },
    {
      path: "/asset/detail/:id",
      name: "AssetDetail",
      redirect: "/warehouse-assets/ledger",
      meta: {
        title: "资产详情(旧路径)",
        showLink: false,
        roles: ["super_admin", "manager", "site_manager", "operator"]
      }
    },
    {
      path: "/asset/dashboard",
      name: "AssetDashboard",
      redirect: "/warehouse-assets/ledger",
      meta: {
        title: "设备总览(旧路径)",
        showLink: false
      }
    }
  ]
} satisfies RouteConfigsTable;
