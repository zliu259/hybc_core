const Layout = () => import("@/layout/index.vue");

export default {
  path: "/workspace",
  name: "Workspace",
  component: Layout,
  redirect: "/workspace/home",
  meta: {
    icon: "ep/home-filled",
    title: "个人工作台",
    rank: 0
  },
  children: [
    {
      path: "/workspace/home",
      name: "WorkspaceHome",
      component: () => import("@/views/welcome/index.vue"),
      meta: {
        title: "个人工作台",
        roles: ["super_admin", "manager", "site_manager", "operator"]
      }
    }
  ]
} satisfies RouteConfigsTable;
