const Layout = () => import("@/layout/index.vue");

export default {
  path: "/dict",
  name: "Dict",
  component: Layout,
  redirect: "/dict/index",
  meta: {
    icon: "ep:collection-tag",
    title: "数据字典",
    rank: 12
  },
  children: [
    {
      path: "/dict/index",
      name: "DictManagement",
      component: () => import("@/views/dict/index.vue"),
      meta: {
        title: "数据字典",
        roles: ["super_admin", "manager"]
      }
    }
  ]
} satisfies RouteConfigsTable;
