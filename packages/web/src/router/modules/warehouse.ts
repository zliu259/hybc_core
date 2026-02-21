const Layout = () => import("@/layout/index.vue");

export default {
  path: "/warehouse",
  name: "Warehouse",
  component: Layout,
  redirect: "/warehouse/index",
  meta: {
    icon: "ep:goods",
    title: "仓库管理",
    rank: 17
  },
  children: [
    {
      path: "/warehouse/index",
      name: "WarehouseIndex",
      component: () => import("@/views/warehouse/index.vue"),
      meta: {
        title: "仓库信息",
        roles: ["super_admin", "manager", "site_manager", "operator"]
      }
    },
    {
      path: "/warehouse/inventory",
      name: "WarehouseInventory",
      component: () => import("@/views/warehouse/inventory.vue"),
      meta: {
        title: "库存概览",
        roles: ["super_admin", "manager", "site_manager", "operator"]
      }
    },
    {
      path: "/warehouse/alert",
      name: "WarehouseAlert",
      component: () => import("@/views/warehouse/alert.vue"),
      meta: {
        title: "预警中心",
        roles: ["super_admin", "manager", "site_manager", "operator"]
      }
    },
    {
      path: "/warehouse/stock-order",
      name: "WarehouseStockOrder",
      component: () => import("@/views/warehouse/stock-order.vue"),
      meta: {
        title: "出入库单",
        roles: ["super_admin", "manager", "site_manager", "operator"]
      }
    },
    {
      path: "/warehouse/dispatch",
      name: "WarehouseDispatch",
      component: () => import("@/views/warehouse/dispatch.vue"),
      meta: {
        title: "出入库调度",
        roles: ["super_admin", "manager", "site_manager", "operator"]
      }
    },
    {
      path: "/warehouse/equipment-plan",
      name: "WarehouseEquipmentPlan",
      component: () => import("@/views/warehouse/equipment-plan.vue"),
      meta: {
        title: "设备规划",
        roles: ["super_admin", "manager", "site_manager", "operator"]
      }
    }
  ]
} satisfies RouteConfigsTable;
