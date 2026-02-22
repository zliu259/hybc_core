import { getWeComJsSdkConfig } from "@/api/wecom";

type JsApiCallbackPayload = {
  errMsg?: string;
  [key: string]: unknown;
};

type JsApiCallback = (result: JsApiCallbackPayload) => void;

type WeComWx = {
  config: (options: Record<string, unknown>) => void;
  ready: (callback: () => void) => void;
  error: (callback: (error: unknown) => void) => void;
  agentConfig: (options: Record<string, unknown>) => void;
  invoke: (api: string, payload: Record<string, unknown>, callback: JsApiCallback) => void;
};

type WeComWw = {
  register: (options: Record<string, unknown>) => void;
  createWWLoginPanel?: (options: Record<string, unknown>) => {
    unmount: () => void;
  };
  [key: string]: unknown;
};

type WeComSdkWindow = Window & {
  wx?: WeComWx;
  ww?: WeComWw;
};

type LoginPanelOptions = {
  el: string;
  appid: string;
  agentid: string;
  redirectUri: string;
  state: string;
  onLoginSuccess: (code: string) => void;
  onLoginFail?: (error: unknown) => void;
};

const JWXWORK_SCRIPT =
  "https://wwcdn.weixin.qq.com/node/wework/wwopen/js/jwxwork-1.0.0.js";
const LEGACY_WX_SCRIPT = "https://res.wx.qq.com/open/js/jweixin-1.2.0.js";
const LOGIN_PANEL_SCRIPT =
  "https://wwcdn.weixin.qq.com/node/wework/wwopen/js/wwLogin-1.2.7.js";

const loadScript = async (src: string): Promise<void> => {
  if (document.querySelector(`script[src=\"${src}\"]`)) return;

  await new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
    document.head.appendChild(script);
  });
};

const ensureJsSdkGlobal = async (): Promise<{ mode: "ww" | "wx"; windowRef: WeComSdkWindow }> => {
  const windowRef = window as WeComSdkWindow;

  if (windowRef.ww?.register) {
    return { mode: "ww", windowRef };
  }
  if (windowRef.wx?.config) {
    return { mode: "wx", windowRef };
  }

  try {
    await loadScript(JWXWORK_SCRIPT);
  } catch {
    await loadScript(LEGACY_WX_SCRIPT);
  }

  if (windowRef.ww?.register) {
    return { mode: "ww", windowRef };
  }
  if (windowRef.wx?.config) {
    return { mode: "wx", windowRef };
  }

  throw new Error("WeCom JS-SDK is unavailable");
};

const invokeInWw = async (
  ww: WeComWw,
  api: string,
  payload: Record<string, unknown>
): Promise<JsApiCallbackPayload> => {
  const method = ww[api];
  if (typeof method !== "function") {
    throw new Error(`JS-SDK method not available: ${api}`);
  }

  return new Promise<JsApiCallbackPayload>((resolve, reject) => {
    (method as (options: Record<string, unknown>) => void)({
      ...payload,
      success: (result: JsApiCallbackPayload) => resolve(result),
      fail: (error: unknown) => reject(error)
    });
  });
};

const invokeInWx = async (
  wx: WeComWx,
  api: string,
  payload: Record<string, unknown>
): Promise<JsApiCallbackPayload> => {
  return new Promise<JsApiCallbackPayload>((resolve) => {
    wx.invoke(api, payload, (result) => {
      resolve(result);
    });
  });
};

export const initWeComJsSdk = async (jsApiList: string[]) => {
  const { mode, windowRef } = await ensureJsSdkGlobal();
  const cleanUrl = window.location.href.split("#")[0] ?? window.location.href;
  const configResult = await getWeComJsSdkConfig(cleanUrl);
  const config = configResult.data;

  if (mode === "ww" && windowRef.ww) {
    await new Promise<void>((resolve, reject) => {
      windowRef.ww?.register({
        corpId: config.corpId,
        agentId: config.agentId,
        jsApiList,
        getConfigSignature: async () => ({
          timestamp: config.timestamp,
          nonceStr: config.nonceStr,
          signature: config.signature
        }),
        getAgentConfigSignature: async () => ({
          timestamp: config.timestamp,
          nonceStr: config.nonceStr,
          signature: config.agentSignature
        }),
        success: () => resolve(),
        fail: (error: unknown) => reject(error)
      });
    });

    return {
      mode,
      invoke: (api: string, payload: Record<string, unknown> = {}) =>
        invokeInWw(windowRef.ww as WeComWw, api, payload)
    };
  }

  if (mode === "wx" && windowRef.wx) {
    await new Promise<void>((resolve, reject) => {
      windowRef.wx?.config({
        beta: true,
        debug: false,
        appId: config.corpId,
        timestamp: config.timestamp,
        nonceStr: config.nonceStr,
        signature: config.signature,
        jsApiList
      });

      windowRef.wx?.ready(() => {
        windowRef.wx?.agentConfig({
          corpid: config.corpId,
          agentid: config.agentId,
          timestamp: config.timestamp,
          nonceStr: config.nonceStr,
          signature: config.agentSignature,
          jsApiList,
          success: () => resolve(),
          fail: (error: unknown) => reject(error)
        });
      });

      windowRef.wx?.error((error) => reject(error));
    });

    return {
      mode,
      invoke: (api: string, payload: Record<string, unknown> = {}) =>
        invokeInWx(windowRef.wx as WeComWx, api, payload)
    };
  }

  throw new Error("Failed to initialize WeCom JS-SDK");
};

export const createWeComLoginPanel = async (options: LoginPanelOptions) => {
  await loadScript(LOGIN_PANEL_SCRIPT);
  const windowRef = window as WeComSdkWindow;
  const ww = windowRef.ww;

  if (!ww?.createWWLoginPanel) {
    throw new Error("createWWLoginPanel is unavailable");
  }

  return ww.createWWLoginPanel({
    el: options.el,
    params: {
      login_type: "CorpApp",
      appid: options.appid,
      agentid: options.agentid,
      redirect_uri: options.redirectUri,
      state: options.state,
      redirect_type: "callback",
      panel_size: "small",
      lang: "zh"
    },
    onLoginSuccess: ({ code }: { code: string }) => {
      options.onLoginSuccess(code);
    },
    onLoginFail: (error: unknown) => {
      options.onLoginFail?.(error);
    }
  });
};

export const isInWeComClient = () => {
  return /wxwork/i.test(navigator.userAgent);
};
