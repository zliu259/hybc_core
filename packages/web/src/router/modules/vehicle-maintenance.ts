const Layout = () => import("@/layout/index.vue");

export default {
  path: "/vehicle-maintenance",
  name: "VehicleMaintenance",
  component: Layout,
  redirect: "/vehicle-maintenance/index",
  meta: {
    icon: "ep/tools",
    title: "车辆保养",
    rank: 18
  },
  children: [
    {
      path: "/vehicle-maintenance/index",
      name: "VehicleMaintenanceIndex",
      component: () => import("@/views/vehicle-maintenance/index.vue"),
      meta: {
        title: "车辆保养记录",
        roles: ["super_admin", "manager", "finance", "site_manager", "operator"]
      }
    }
  ]
} satisfies RouteConfigsTable;
