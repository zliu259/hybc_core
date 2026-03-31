const Layout = () => import("@/layout/index.vue");

export default {
  path: "/warehouse-assets",
  name: "WarehouseAssets",
  component: Layout,
  redirect: "/warehouse-assets/ledger",
  meta: {
    icon: "ep:goods",
    title: "库房与资产",
    rank: 16
  },
  children: [
    {
      path: "/warehouse-assets/ledger",
      name: "WarehouseAssetsLedger",
      component: () => import("@/views/asset/ledger.vue"),
      meta: {
        title: "资产设备台账",
        roles: ["super_admin", "manager", "site_manager"]
      }
    },
    {
      path: "/warehouse-assets/creator",
      name: "WarehouseAssetsCreator",
      component: () => import("@/views/warehouse/stock-order.vue"),
      meta: {
        title: "出入库制单工作台",
        roles: ["super_admin", "manager", "site_manager"]
      }
    },
    {
      path: "/warehouse-assets/templates",
      name: "WarehouseAssetsTemplates",
      component: () => import("@/views/warehouse/templates.vue"),
      meta: {
        title: "搭配模板管理",
        roles: ["super_admin", "manager", "site_manager"]
      }
    },
    {
      path: "/warehouse-assets/consumables",
      name: "WarehouseAssetsConsumables",
      component: () => import("@/views/warehouse/consumables.vue"),
      meta: {
        title: "消耗品管理总览",
        roles: ["super_admin", "manager", "site_manager"]
      }
    },
    {
      path: "/warehouse-assets/stocktake",
      name: "WarehouseAssetsStocktake",
      component: () => import("@/views/warehouse/stocktake.vue"),
      meta: {
        title: "公司资产盘库",
        roles: ["super_admin", "manager", "site_manager"]
      }
    },
    {
      path: "/warehouse-assets/dispatch",
      name: "WarehouseAssetsDispatch",
      component: () => import("@/views/warehouse/dispatch.vue"),
      meta: {
        title: "可用资产调度台",
        roles: ["super_admin", "manager", "site_manager"]
      }
    },
    {
      path: "/warehouse-assets/work-order",
      name: "WarehouseAssetsWorkOrder",
      component: () => import("@/views/warehouse/work-order.vue"),
      meta: {
        title: "资产工单中心",
        roles: ["super_admin", "manager", "site_manager", "operator"]
      }
    },
    {
      path: "/warehouse-assets/device/:id",
      name: "WarehouseAssetsDeviceDetail",
      component: () => import("@/views/asset/detail.vue"),
      meta: {
        title: "设备管理",
        showLink: false,
        roles: ["super_admin", "manager", "site_manager"]
      }
    }
  ]
} satisfies RouteConfigsTable;
