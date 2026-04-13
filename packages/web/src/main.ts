import App from "./App.vue";
import router from "./router";
import { setupStore } from "@/store";
import { getPlatformConfig } from "./config";
import { MotionPlugin } from "@vueuse/motion";
// import { useEcharts } from "@/plugins/echarts";
import { createApp, type Directive } from "vue";
import { useElementPlus } from "@/plugins/elementPlus";
import { injectResponsiveStorage } from "@/utils/responsive";

import Table from "@pureadmin/table";
// import PureDescriptions from "@pureadmin/descriptions";

// 引入重置样式
import "./style/reset.scss";
// 导入公共样式
import "./style/index.scss";
// 一定要在main.ts中导入tailwind.css，防止vite每次hmr都会请求src/style/index.scss整体css文件导致热更新慢的问题
import "./style/tailwind.css";
import "element-plus/dist/index.css";
// 导入字体图标
import "./assets/iconfont/iconfont.js";
import "./assets/iconfont/iconfont.css";

const dynamicImportReloadKey = "hybc:dynamic-import-reload-state";
const currentRouteToken = () =>
  `${window.location.pathname}${window.location.search}${window.location.hash}`;

type DynamicImportReloadState = {
  token: string;
  count: number;
  message?: string;
};

const readReloadState = (): DynamicImportReloadState | null => {
  const raw = window.sessionStorage.getItem(dynamicImportReloadKey);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as DynamicImportReloadState;
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.token !== "string") return null;
    const count =
      typeof parsed.count === "number" && Number.isFinite(parsed.count)
        ? parsed.count
        : 0;
    return { ...parsed, count };
  } catch {
    return null;
  }
};

const writeReloadState = (state: DynamicImportReloadState) => {
  window.sessionStorage.setItem(dynamicImportReloadKey, JSON.stringify(state));
};

const clearReloadState = () => {
  window.sessionStorage.removeItem(dynamicImportReloadKey);
};

const shouldHandleDynamicImportError = (message: string): boolean => {
  if (!message.trim()) return false;
  return (
    message.includes("Failed to fetch dynamically imported module") ||
    message.includes("Importing a module script failed") ||
    message.includes("Expected a JavaScript-or-Wasm module script")
  );
};

const reloadOnDynamicImportError = (message: string): void => {
  const token = currentRouteToken();
  const prev = readReloadState();
  const count = prev?.token === token ? prev.count : 0;
  if (count >= 2) {
    console.error(
      "[dynamic-import] reload skipped to avoid loop",
      message || "unknown dynamic import error"
    );
    return;
  }
  writeReloadState({
    token,
    count: count + 1,
    message: message.slice(0, 300)
  });
  window.location.reload();
};

window.addEventListener("vite:preloadError", event => {
  const payload = (event as Event & { payload?: unknown }).payload;
  const message =
    payload instanceof Error ? payload.message : String(payload ?? "");
  if (!shouldHandleDynamicImportError(message)) return;
  event.preventDefault();
  reloadOnDynamicImportError(message);
});

window.addEventListener("unhandledrejection", event => {
  const reason = event.reason;
  const message =
    reason instanceof Error ? reason.message : String(reason ?? "");
  if (!shouldHandleDynamicImportError(message)) return;
  event.preventDefault();
  reloadOnDynamicImportError(message);
});

const app = createApp(App);

// 自定义指令
import * as directives from "@/directives";
Object.keys(directives).forEach(key => {
  app.directive(key, (directives as { [key: string]: Directive })[key]);
});

// 全局注册@iconify/vue图标库
import {
  IconifyIconOffline,
  IconifyIconOnline,
  FontIcon
} from "./components/ReIcon";
app.component("IconifyIconOffline", IconifyIconOffline);
app.component("IconifyIconOnline", IconifyIconOnline);
app.component("FontIcon", FontIcon);

// 全局注册按钮级别权限组件
import { Auth } from "@/components/ReAuth";
import { Perms } from "@/components/RePerms";
app.component("Auth", Auth);
app.component("Perms", Perms);

// 全局注册vue-tippy
import "tippy.js/dist/tippy.css";
import "tippy.js/themes/light.css";
import VueTippy from "vue-tippy";
app.use(VueTippy);

getPlatformConfig(app).then(async config => {
  setupStore(app);
  app.use(router);
  await router.isReady();
  injectResponsiveStorage(app, config);
  app.use(MotionPlugin).use(useElementPlus).use(Table);
  // .use(PureDescriptions)
  // .use(useEcharts);
  app.mount("#app");
  clearReloadState();
});
