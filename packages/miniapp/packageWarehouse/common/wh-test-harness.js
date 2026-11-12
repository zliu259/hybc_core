/**
 * 库房分包页面流程测试的夹具（只给 *.test.js 用，不打进小程序包）。
 * 跑的是真实页面代码和真实视图模块，只替换接口、登录态、上传、扫码选图和 wx。
 */
const path = require("path");

const ROOT = path.join(__dirname, "../..");

const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

/** setData 的键可以是 "form.title"、"rows[2].qty" 这样的路径。 */
const setByPath = (target, keyPath, value) => {
  const keys = keyPath.replace(/\[(\d+)\]/g, ".$1").split(".");
  const root = Array.isArray(target) ? [...target] : { ...target };
  let node = root;
  keys.slice(0, -1).forEach((key, index) => {
    const current = node[key];
    const nextIsIndex = /^\d+$/.test(keys[index + 1]);
    const copy = Array.isArray(current)
      ? [...current]
      : current && typeof current === "object"
        ? { ...current }
        : nextIsIndex
          ? []
          : {};
    node[key] = copy;
    node = copy;
  });
  node[keys[keys.length - 1]] = value;
  return root;
};

const isThrown = (value) => value instanceof Error || Boolean(value && value.errMsg);

/**
 * @param {{ page: string, profile?: object }} options page 相对小程序根目录，如 "packageWarehouse/device/index"
 */
const createPageHarness = ({ page, profile } = {}) => {
  const state = {
    /** 发出的请求，按顺序 */
    calls: [],
    navigations: [],
    redirects: [],
    toasts: [],
    modals: [],
    previews: [],
    titles: [],
    backs: 0,
    pullStops: 0,
    vibrations: 0,
    /** 扫码依次吐出的内容：字符串是扫到的文字，Error 或 { errMsg } 是失败；用完了算用户取消 */
    scans: [],
    /** 选图依次吐出的结果：每项是一组本地路径；用完了算用户取消 */
    images: [],
    /** 上传成功的文件 key */
    uploads: [],
    /** 这些本地路径上传时失败 */
    uploadFailures: [],
    /** showModal 点确定还是取消，以及 editable 时输入的内容 */
    modalConfirm: true,
    modalInput: "",
    /** showActionSheet 点第几项；-1 是取消 */
    actionSheetIndex: 0,
    storage: {},
    profile: profile || { username: "lz", nickname: "李震", roles: ["operator"] }
  };
  let handlers = [];
  let handlerSeq = 0;

  const stubbed = new Set();
  const stub = (file, exports) => {
    const resolved = require.resolve(path.join(ROOT, file));
    require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
    stubbed.add(resolved);
  };

  // 之前的用例加载过的项目模块都清掉，让它们重新绑定到这次的替身上
  Object.keys(require.cache)
    .filter((file) => file.startsWith(ROOT) && !file.includes("node_modules"))
    .filter((file) => file !== __filename)
    .forEach((file) => delete require.cache[file]);

  const findHandler = (method, requestPath) =>
    handlers
      .filter((item) => item.method === method && requestPath.includes(item.includes))
      .sort((a, b) => b.includes.length - a.includes.length || b.seq - a.seq)[0];

  const request = async ({ method = "GET", path: requestPath, data }) => {
    const call = { method, path: requestPath, data: clone(data) };
    state.calls.push(call);
    const handler = findHandler(method, requestPath);
    if (!handler) return method === "GET" ? { success: true, data: [] } : { success: true };
    if (handler.once) handlers = handlers.filter((item) => item !== handler);
    return handler.run(call);
  };

  const register = (method, includes, run, once) => {
    handlerSeq += 1;
    handlers = [...handlers, { method, includes, run, once: Boolean(once), seq: handlerSeq }];
  };

  const requestError = (message, statusCode) => {
    const error = new Error(message);
    error.__statusCode = statusCode;
    return error;
  };

  stub("utils/request.js", {
    request,
    buildUrl: (requestPath) => `https://test.local${requestPath}`,
    uploadBinary: async () => ({})
  });
  stub("utils/auth.js", {
    getUserProfile: () => state.profile,
    getToken: () => "test-token"
  });
  stub("utils/upload.js", {
    uploadFileToR2: async (filePath, options = {}) => {
      if (state.uploadFailures.includes(filePath)) throw new Error("上传失败");
      const key = `${options.category || "miniapp"}/${path.basename(filePath)}`;
      state.uploads.push(key);
      return { key };
    }
  });
  stub("utils/wx.js", {
    wxScanCode: async () => {
      if (state.scans.length === 0) throw { errMsg: "scanCode:fail cancel" };
      const next = state.scans.shift();
      if (isThrown(next)) throw next;
      return { result: next };
    },
    wxChooseMediaImage: async () => {
      if (state.images.length === 0) throw { errMsg: "chooseMedia:fail cancel" };
      const next = state.images.shift();
      if (isThrown(next)) throw next;
      return { tempFiles: next.map((filePath) => ({ path: filePath, tempFilePath: filePath })) };
    }
  });
  stub("utils/attachment-open.js", {
    resolveAttachmentUrl: (url, key) => url || `direct:${key}`,
    signAttachmentUrl: async (key) => `signed:${key}`,
    openQueryAttachment: async () => {},
    parseQueryAttachments: () => [],
    inferFileName: (value) => String(value || "")
  });

  global.wx = {
    navigateTo: ({ url }) => state.navigations.push(url),
    redirectTo: ({ url }) => state.redirects.push(url),
    switchTab: ({ url }) => state.navigations.push(url),
    navigateBack: () => {
      state.backs += 1;
    },
    showToast: ({ title }) => state.toasts.push(title),
    showModal: (options) => {
      state.modals.push({ title: options.title, content: options.content });
      const result = {
        confirm: state.modalConfirm,
        cancel: !state.modalConfirm,
        content: options.editable ? state.modalInput : undefined
      };
      Promise.resolve().then(() => options.success && options.success(result));
    },
    showActionSheet: (options) => {
      Promise.resolve().then(() => {
        if (state.actionSheetIndex < 0) {
          if (options.fail) options.fail({ errMsg: "showActionSheet:fail cancel" });
          return;
        }
        if (options.success) options.success({ tapIndex: state.actionSheetIndex });
      });
    },
    showLoading: () => {},
    hideLoading: () => {},
    previewImage: (options) => state.previews.push(options),
    stopPullDownRefresh: () => {
      state.pullStops += 1;
    },
    setNavigationBarTitle: ({ title }) => state.titles.push(title),
    pageScrollTo: () => {},
    vibrateShort: () => {
      state.vibrations += 1;
    },
    vibrateLong: () => {
      state.vibrations += 1;
    },
    getStorageSync: (key) => state.storage[key],
    setStorageSync: (key, value) => {
      state.storage[key] = value;
    }
  };

  let pageConfig = null;
  global.Page = (config) => {
    pageConfig = config;
  };
  global.getApp = () => ({ globalData: {} });

  const flush = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));

  return {
    state,
    /** 之后匹配到的请求返回这个响应；response 可以是函数（参数是这次请求）。路径按"包含"匹配，最长的优先。 */
    respond: (method, includes, response) =>
      register(method, includes, (call) => (typeof response === "function" ? response(call) : response)),
    /** 只对下一次匹配的请求生效。 */
    respondOnce: (method, includes, response) =>
      register(
        method,
        includes,
        (call) => (typeof response === "function" ? response(call) : response),
        true
      ),
    fail: (method, includes, message, statusCode = 400) =>
      register(method, includes, () => {
        throw requestError(message, statusCode);
      }),
    failOnce: (method, includes, message, statusCode = 400) =>
      register(
        method,
        includes,
        () => {
          throw requestError(message, statusCode);
        },
        true
      ),
    /** 某个方法、路径发过的请求 */
    callsTo: (method, includes) =>
      state.calls.filter((call) => call.method === method && call.path.includes(includes)),
    /** 加载页面并走 onLoad、onShow，返回带 setData 的页面对象。 */
    open: async (query = {}) => {
      const resolved = require.resolve(path.join(ROOT, `${page}.js`));
      delete require.cache[resolved];
      pageConfig = null;
      require(resolved);
      if (!pageConfig) throw new Error(`${page} 没有调用 Page()`);
      const instance = {
        ...pageConfig,
        data: clone(pageConfig.data) || {},
        setData(patch, callback) {
          this.data = Object.entries(patch).reduce(
            (data, [key, value]) => setByPath(data, key, value),
            this.data
          );
          if (typeof callback === "function") callback();
        }
      };
      if (typeof instance.onLoad === "function") await instance.onLoad(query);
      if (typeof instance.onShow === "function") await instance.onShow();
      await flush();
      return instance;
    },
    /** 小程序事件对象 */
    event: (dataset = {}, detail = {}) => ({ currentTarget: { dataset }, target: { dataset }, detail }),
    flush
  };
};

/**
 * 依次跑一组用例，哪条失败报哪条的名字。
 * @param {string} name
 * @param {[string, () => Promise<void> | void][]} tests
 */
const runTests = (name, tests) =>
  (async () => {
    for (const [title, fn] of tests) {
      try {
        await fn();
      } catch (error) {
        console.error(`失败：${title}`);
        throw error;
      }
    }
    console.log(`${name}: ${tests.length} ok`);
  })().catch((error) => {
    console.error(error);
    process.exit(1);
  });

module.exports = { createPageHarness, runTests };
