const Layout = () => import("@/layout/index.vue");

export default {
  path: "/wecom",
  name: "WeCom",
  component: Layout,
  redirect: "/admin/wecom-integration",
  meta: {
    icon: "ep:user",
    title: "企业微信",
    rank: 14,
    showLink: false
  },
  children: [
    {
      path: "/wecom/contacts",
      name: "WeComContacts",
      redirect: "/admin/wecom-integration",
      meta: {
        title: "通讯录(旧路径)",
        showLink: false
      }
    },
    {
      path: "/wecom/member-admin",
      name: "WeComMemberAdmin",
      redirect: "/admin/wecom-integration",
      meta: {
        title: "成员查看(管理员)(旧路径)",
        showLink: false
      }
    },
    {
      path: "/wecom/sdk",
      name: "WeComSdk",
      redirect: "/admin/wecom-integration",
      meta: {
        title: "JS-SDK能力(旧路径)",
        showLink: false
      }
    }
  ]
} satisfies RouteConfigsTable;
