const Layout = () => import("@/layout/index.vue");

export default {
  path: "/",
  name: "Home",
  component: Layout,
  redirect: "/workspace/home",
  meta: {
    icon: "ep/home-filled",
    title: "首页",
    showLink: false
  },
  children: [
    {
      path: "/welcome",
      name: "WelcomeLegacyRedirect",
      redirect: "/workspace/home",
      meta: {
        title: "旧首页",
        showLink: false
      }
    }
  ]
} satisfies RouteConfigsTable;
