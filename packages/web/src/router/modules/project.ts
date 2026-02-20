const Layout = () => import("@/layout/index.vue");

export default {
  path: "/project",
  name: "Project",
  component: Layout,
  redirect: "/project/list",
  meta: {
    icon: "ep:briefcase",
    title: "项目管理",
    rank: 13
  },
  children: [
    {
      path: "/project/list",
      name: "ProjectList",
      component: () => import("@/views/project/list.vue"),
      meta: {
        title: "项目列表",
        roles: ["super_admin", "manager", "site_manager", "operator"]
      }
    },
    {
      path: "/project/create",
      name: "ProjectCreate",
      component: () => import("@/views/project/create.vue"),
      meta: {
        title: "项目立项",
        roles: ["super_admin", "manager", "site_manager"]
      }
    },
    {
      path: "/project/detail/:id",
      name: "ProjectDetail",
      component: () => import("@/views/project/detail.vue"),
      meta: {
        title: "项目详情",
        showLink: false,
        roles: ["super_admin", "manager", "site_manager", "operator"]
      }
    },
    {
      path: "/project/equipment-view",
      name: "ProjectEquipmentView",
      component: () => import("@/views/project/equipment-view.vue"),
      meta: {
        title: "项目设备视图",
        roles: ["super_admin", "manager", "site_manager", "operator"]
      }
    },
    {
      path: "/project/workspace",
      name: "ProjectWorkspaceEntry",
      component: () => import("@/views/project/workspace-entry.vue"),
      meta: {
        title: "项目化视图",
        roles: ["super_admin", "manager", "site_manager", "operator"]
      }
    },
    {
      path: "/project/workspace/:id",
      name: "ProjectWorkspace",
      component: () => import("@/views/project/workspace/index.vue"),
      meta: {
        title: "项目工作区",
        showLink: false,
        roles: ["super_admin", "manager", "site_manager", "operator"]
      }
    }
  ]
} satisfies RouteConfigsTable;
