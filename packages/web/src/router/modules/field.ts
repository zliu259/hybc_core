const Layout = () => import("@/layout/index.vue");

export default {
  path: "/field",
  name: "FieldCommand",
  component: Layout,
  redirect: "/field/projects",
  meta: {
    icon: "ep:briefcase",
    title: "项目与现场指挥",
    rank: 13
  },
  children: [
    {
      path: "/field/projects",
      name: "FieldProjectHub",
      component: () => import("@/views/project/hub.vue"),
      meta: {
        title: "项目选择大厅",
        roles: ["super_admin", "manager", "site_manager"]
      }
    },
    {
      path: "/field/project/create",
      name: "FieldProjectCreate",
      component: () => import("@/views/project/create.vue"),
      meta: {
        title: "项目立项",
        roles: ["super_admin", "manager", "site_manager"]
      }
    },
    {
      path: "/field/project/:id",
      name: "FieldProjectWorkspace",
      component: () => import("@/views/project/workspace/index.vue"),
      meta: {
        title: "项目工作区",
        showLink: false,
        roles: ["super_admin", "manager", "site_manager"]
      }
    }
  ]
} satisfies RouteConfigsTable;
