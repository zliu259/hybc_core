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

const extractModuleUrl = (message: string): string => {
  const matched = message.match(/https?:\/\/[^\s"')]+\.js/);
  return matched ? matched[0] : "";
};

/**
 * 自愈被“污染”的 chunk 缓存。
 *
 * 背景：部署传播窗口内，Cloudflare Pages 可能对尚未就绪的 hash chunk 返回 SPA 回退页
 * （Content-Type: text/html），而 `/static/*` 带 `immutable` 缓存头，浏览器会把这份
 * “冒充 JS 的 HTML”长期缓存。此后 `import()` 该 chunk（或其被污染的传递依赖）会一直拿到
 * HTML → 模块加载失败 → 白屏。普通 `location.reload()` 绕不过该缓存条目。
 *
 * 这里用 `cache: "reload"` 从网络强制回源并**覆盖**被污染的缓存条目，并沿相对静态依赖
 * （`./xxx.js`）递归修复整条链路；完成后再重载，`import()` 即命中已修复的缓存而恢复。
 */
const refreshPoisonedModuleGraph = async (rootUrl: string): Promise<void> => {
  const seen = new Set<string>();
  const queue: string[] = [rootUrl];
  let budget = 60; // 兜底上限，避免异常情况下无限抓取
  while (queue.length > 0 && budget > 0) {
    budget -= 1;
    const url = queue.shift() as string;
    if (seen.has(url)) continue;
    seen.add(url);
    let response: Response;
    try {
      response = await fetch(url, { cache: "reload" });
    } catch {
      continue;
    }
    if (!response.ok) continue;
    const contentType = response.headers.get("content-type") || "";
    if (!/javascript|ecmascript/.test(contentType)) continue;
    let source = "";
    try {
      source = await response.text();
    } catch {
      continue;
    }
    // 仅跟随相对静态依赖（./xxx.js）——它们才是阻断模块链接的传递依赖
    const importRe = /(?:from|import)"(\.\/[^"]+\.js)"/g;
    let match: RegExpExecArray | null;
    while ((match = importRe.exec(source)) !== null) {
      try {
        queue.push(new URL(match[1], url).href);
      } catch {
        /* 忽略无法解析的说明符 */
      }
    }
  }
};

let dynamicImportHandling = false;

const reloadOnDynamicImportError = (message: string): void => {
  if (dynamicImportHandling) return;
  dynamicImportHandling = true;

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

  const rootUrl = extractModuleUrl(message);
  const reload = () => window.location.reload();
  if (rootUrl) {
    // 先覆盖被污染的缓存再重载；无论成功与否都重载，避免卡死
    refreshPoisonedModuleGraph(rootUrl).then(reload, reload);
  } else {
    reload();
  }
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
