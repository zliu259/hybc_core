const Layout = () => import("@/layout/index.vue");

export default {
  path: "/entity",
  name: "Entity",
  component: Layout,
  redirect: "/entity/index",
  meta: {
    icon: "ep:office-building",
    title: "实体管理",
    rank: 11
  },
  children: [
    {
      path: "/entity/index",
      name: "EntityManagement",
      component: () => import("@/views/entity/index.vue"),
      meta: {
        title: "实体管理",
        roles: ["super_admin", "manager"]
      }
    }
  ]
} satisfies RouteConfigsTable;
