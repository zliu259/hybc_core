const Layout = () => import("@/layout/index.vue");

export default {
  path: "/entity",
  name: "Entity",
  component: Layout,
  redirect: "/admin/system-base/entity",
  meta: {
    icon: "ep:office-building",
    title: "实体管理",
    rank: 11,
    showLink: false
  },
  children: [
    {
      path: "/entity/index",
      name: "EntityManagement",
      redirect: "/admin/system-base/entity",
      meta: {
        title: "实体管理(旧路径)",
        showLink: false
      }
    }
  ]
} satisfies RouteConfigsTable;
