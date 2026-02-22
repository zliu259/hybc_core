const Layout = () => import("@/layout/index.vue");

export default {
  path: "/account",
  name: "Account",
  component: Layout,
  redirect: "/account/passkey",
  meta: {
    icon: "ep:lock",
    title: "账号安全",
    rank: 18,
    showLink: false
  },
  children: [
    {
      path: "/account/passkey",
      name: "AccountPasskey",
      component: () => import("@/views/account/passkey.vue"),
      meta: {
        title: "Passkey 管理",
        roles: ["super_admin", "manager", "site_manager", "operator"]
      }
    }
  ]
} satisfies RouteConfigsTable;
