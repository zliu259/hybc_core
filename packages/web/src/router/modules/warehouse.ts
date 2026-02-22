const Layout = () => import("@/layout/index.vue");

export default {
  path: "/warehouse",
  name: "Warehouse",
  component: Layout,
  redirect: "/warehouse-assets/creator",
  meta: {
    icon: "ep:goods",
    title: "库房调度(旧路径)",
    showLink: false
  },
  children: [
    {
      path: "/warehouse/index",
      name: "WarehouseIndex",
      redirect: "/warehouse-assets/creator",
      meta: {
        title: "仓库信息(旧路径)",
        showLink: false
      }
    },
    {
      path: "/warehouse/inventory",
      name: "WarehouseInventory",
      redirect: "/warehouse-assets/ledger",
      meta: {
        title: "库存概览(旧路径)",
        showLink: false
      }
    },
    {
      path: "/warehouse/alert",
      name: "WarehouseAlert",
      redirect: "/warehouse-assets/dispatch",
      meta: {
        title: "预警中心(旧路径)",
        showLink: false
      }
    },
    {
      path: "/warehouse/stock-order",
      name: "WarehouseStockOrder",
      redirect: "/warehouse-assets/creator",
      meta: {
        title: "出入库单(旧路径)",
        showLink: false
      }
    },
    {
      path: "/warehouse/dispatch",
      name: "WarehouseDispatch",
      redirect: "/warehouse-assets/dispatch",
      meta: {
        title: "出入库调度(旧路径)",
        showLink: false
      }
    },
    {
      path: "/warehouse/equipment-plan",
      name: "WarehouseEquipmentPlan",
      redirect: "/warehouse-assets/templates",
      meta: {
        title: "设备规划(旧路径)",
        showLink: false
      }
    }
  ]
} satisfies RouteConfigsTable;
