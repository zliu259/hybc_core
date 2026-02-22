const Layout = () => import("@/layout/index.vue");

export default {
  path: "/ai",
  name: "AiManagement",
  component: Layout,
  redirect: "/admin/ai-center",
  meta: {
    icon: "ep:cpu",
    title: "AI管理(旧路径)",
    showLink: false
  },
  children: [
    {
      path: "/ai/config",
      name: "AiConfig",
      redirect: "/admin/ai-center",
      meta: {
        title: "AI配置管理(旧路径)",
        showLink: false
      }
    },
    {
      path: "/ai/nodes",
      name: "ComputeNodes",
      redirect: "/admin/runner-center",
      meta: {
        title: "计算节点监控(旧路径)",
        showLink: false
      }
    }
  ]
} satisfies RouteConfigsTable;
