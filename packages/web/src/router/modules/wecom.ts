const Layout = () => import("@/layout/index.vue");

export default {
  path: "/wecom",
  name: "WeCom",
  component: Layout,
  redirect: "/wecom/contacts",
  meta: {
    icon: "ep:user",
    title: "企业微信",
    rank: 14
  },
  children: [
    {
      path: "/wecom/contacts",
      name: "WeComContacts",
      component: () => import("@/views/wecom/contacts.vue"),
      meta: {
        title: "通讯录",
        roles: ["super_admin", "manager", "site_manager"]
      }
    }
  ]
} satisfies RouteConfigsTable;
