const Layout = () => import("@/layout/index.vue");

export default {
  path: "/dict",
  name: "Dict",
  component: Layout,
  redirect: "/admin/system-base/dict",
  meta: {
    icon: "ep:collection-tag",
    title: "数据字典",
    rank: 12,
    showLink: false
  },
  children: [
    {
      path: "/dict/index",
      name: "DictManagement",
      redirect: "/admin/system-base/dict",
      meta: {
        title: "数据字典(旧路径)",
        showLink: false
      }
    }
  ]
} satisfies RouteConfigsTable;
