const Layout = () => import("@/layout/index.vue");

export default {
  path: "/wh",
  name: "Wh",
  component: Layout,
  redirect: "/wh/overview",
  meta: {
    icon: "ep:goods",
    title: "库房",
    rank: 16
  },
  children: [
    {
      path: "/wh/overview",
      name: "WhOverview",
      component: () => import("@/views/wh/overview/index.vue"),
      meta: { title: "总览" }
    },
    {
      path: "/wh/kit",
      name: "WhKit",
      component: () => import("@/views/wh/kit/index.vue"),
      meta: { title: "项目配套" }
    },
    {
      path: "/wh/kit/:id",
      name: "WhKitDetail",
      component: () => import("@/views/wh/kit/detail.vue"),
      meta: { title: "配套清单", showLink: false }
    },
    {
      path: "/wh/kit/project/:projectId",
      name: "WhKitProjectLedger",
      component: () => import("@/views/wh/kit/project-ledger.vue"),
      meta: { title: "项目物资", showLink: false }
    },
    {
      path: "/wh/kit-template",
      name: "WhKitTemplate",
      component: () => import("@/views/wh/kit/template.vue"),
      meta: { title: "配套模板", showLink: false }
    },
    {
      path: "/wh/device",
      name: "WhDevice",
      component: () => import("@/views/wh/device/index.vue"),
      meta: { title: "设备" }
    },
    {
      path: "/wh/device/:id",
      name: "WhDeviceDetail",
      component: () => import("@/views/wh/device/detail.vue"),
      meta: { title: "设备详情", showLink: false }
    },
    {
      path: "/wh/material",
      name: "WhMaterial",
      component: () => import("@/views/wh/material/index.vue"),
      meta: { title: "物资" }
    },
    {
      path: "/wh/doc",
      name: "WhDoc",
      component: () => import("@/views/wh/doc/index.vue"),
      meta: { title: "库房单" }
    },
    {
      path: "/wh/task",
      name: "WhTask",
      component: () => import("@/views/wh/task/index.vue"),
      meta: { title: "任务" }
    },
    {
      path: "/wh/settings",
      name: "WhSettings",
      component: () => import("@/views/wh/settings/index.vue"),
      meta: { title: "库房设置", showLink: false }
    }
  ]
} satisfies RouteConfigsTable;
