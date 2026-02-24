const Layout = () => import("@/layout/index.vue");

export default {
  path: "/project",
  name: "Project",
  component: Layout,
  redirect: "/field/projects",
  meta: {
    icon: "ep:briefcase",
    title: "项目与现场指挥(旧路径)",
    showLink: false
  },
  children: [
    {
      path: "/project/hub",
      name: "ProjectHub",
      redirect: "/field/projects",
      meta: {
        title: "项目选择大厅(旧路径)",
        showLink: false
      }
    },
    {
      path: "/project/list",
      name: "ProjectList",
      redirect: "/field/projects",
      meta: {
        title: "项目列表(旧路径)",
        showLink: false
      }
    },
    {
      path: "/project/create",
      name: "ProjectCreate",
      redirect: "/field/project/create",
      meta: {
        title: "项目立项(旧路径)",
        showLink: false
      }
    },
    {
      path: "/project/detail/:id",
      name: "ProjectDetail",
      component: () => import("@/views/project/workspace/index.vue"),
      meta: {
        title: "项目详情(旧路径)",
        showLink: false,
        roles: ["super_admin", "manager", "site_manager", "operator"]
      }
    },
    {
      path: "/project/equipment-view",
      name: "ProjectEquipmentView",
      redirect: "/field/projects",
      meta: {
        title: "项目设备视图(旧路径)",
        showLink: false
      }
    },
    {
      path: "/project/workspace",
      name: "ProjectWorkspaceEntry",
      redirect: "/field/projects",
      meta: {
        title: "项目化视图(旧路径)",
        showLink: false
      }
    },
    {
      path: "/project/workspace/:id",
      name: "ProjectWorkspace",
      component: () => import("@/views/project/workspace/index.vue"),
      meta: {
        title: "项目工作区(旧路径)",
        showLink: false,
        roles: ["super_admin", "manager", "site_manager", "operator"]
      }
    }
  ]
} satisfies RouteConfigsTable;
