const Layout = () => import("@/layout/index.vue");

export default {
  path: "/vehicle-maintenance",
  name: "VehicleMaintenance",
  component: Layout,
  redirect: "/finance/fleet/maintenance",
  meta: {
    icon: "ep/tools",
    title: "车辆保养",
    rank: 18,
    showLink: false
  },
  children: [
    {
      path: "/vehicle-maintenance/index",
      name: "VehicleMaintenanceIndex",
      redirect: "/finance/fleet/maintenance",
      meta: {
        title: "车辆保养记录(旧路径)",
        showLink: false
      }
    }
  ]
} satisfies RouteConfigsTable;
