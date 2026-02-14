const Layout = () => import("@/layout/index.vue");

export default {
  path: "/ai",
  name: "AiManagement",
  component: Layout,
  redirect: "/ai/config",
  meta: {
    icon: "ep:cpu",
    title: "AI管理",
    rank: 80
  },
  children: [
    {
      path: "/ai/config",
      name: "AiConfig",
      component: () => import("@/views/ai/config.vue"),
      meta: {
        title: "AI配置管理",
        roles: ["super_admin"]
      }
    },
    {
      path: "/ai/nodes",
      name: "ComputeNodes",
      component: () => import("@/views/ai/nodes.vue"),
      meta: {
        title: "计算节点监控",
        roles: ["super_admin"]
      }
    }
  ]
} satisfies RouteConfigsTable;
