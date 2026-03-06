import type { Env } from "../types/env";
import { loadRunnerRuntimeMap } from "./runner-runtime";

type WeComSendResponse = {
  errcode?: number;
  errmsg?: string;
  invaliduser?: string;
  invalidparty?: string;
  invalidtag?: string;
  unlicenseduser?: string;
  msgid?: string;
};

type ApprovalPushPayload = {
  instanceId: number;
  instanceNo: string;
  bizType: string;
  bizSummary: string;
  currentNodeName: string;
  assigneeUserId: string;
};

type WeComPushRouteConfig = {
  webBaseUrl: string | null;
  miniAppId: string | null;
  miniPagePathTemplate: string | null;
  defaultTarget: "web" | "miniapp";
};

const ACCESS_TOKEN_KV_KEY = "wecom:access-token:v1";
const TOKEN_DEFAULT_TTL_SECONDS = 60 * 60;

const weComErrorMessage = (errmsg: string | undefined, fallback: string): string => {
  if (!errmsg || errmsg === "ok") return fallback;
  return errmsg;
};

const normalizeBridgeProxyUrl = (env: Env): string | null => {
  const explicit = env.WECHAT_BRIDGE_PROXY_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");

  const base = env.WECHAT_BRIDGE_BASE_URL?.trim();
  if (!base) return null;
  const normalized = base.replace(/\/$/, "");
  if (normalized.endsWith("/wecom/proxy")) return normalized;
  return `${normalized}/wecom/proxy`;
};

const putCachedString = async (
  env: Env,
  key: string,
  value: string,
  expiresInSeconds?: number
) => {
  const ttl = Math.max(60, (expiresInSeconds ?? TOKEN_DEFAULT_TTL_SECONDS) - 300);
  await env.KV.put(key, value, { expirationTtl: ttl });
};

const fetchViaBridgeStrict = async <T>(
  env: Env,
  targetUrl: string,
  options?: {
    method?: "GET" | "POST";
    body?: unknown;
    headers?: Record<string, string>;
  }
): Promise<T> => {
  const proxyUrl = normalizeBridgeProxyUrl(env);
  if (!proxyUrl) {
    throw new Error("WECHAT_BRIDGE_BASE_URL/WECHAT_BRIDGE_PROXY_URL is not configured");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);

  const headers: Record<string, string> = {
    "content-type": "application/json"
  };
  if (env.WECHAT_BRIDGE_TOKEN) {
    headers["x-bridge-token"] = env.WECHAT_BRIDGE_TOKEN;
  }

  const resp = await fetch(proxyUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      url: targetUrl,
      method: options?.method ?? "GET",
      body: options?.body,
      headers: options?.headers ?? {}
    }),
    redirect: "manual",
    signal: controller.signal
  }).finally(() => clearTimeout(timeout));

  if (resp.status >= 300 && resp.status < 400) {
    const location = resp.headers.get("location") ?? "";
    throw new Error(`bridge redirected ${resp.status}${location ? ` to ${location}` : ""}`);
  }

  if (!resp.ok) {
    const bodyText = await resp.text();
    throw new Error(`bridge response ${resp.status}: ${bodyText.slice(0, 300)}`);
  }

  return (await resp.json()) as T;
};

const fetchWeComAccessToken = async (env: Env): Promise<string> => {
  const cached = await env.KV.get(ACCESS_TOKEN_KV_KEY);
  if (cached) return cached;

  if (!env.WECHAT_CORPID || !env.WECHAT_SECRET) {
    throw new Error("WECHAT_CORPID/WECHAT_SECRET is not configured");
  }

  const tokenJson = await fetchViaBridgeStrict<{
    errcode?: number;
    errmsg?: string;
    access_token?: string;
    expires_in?: number;
  }>(
    env,
    `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${encodeURIComponent(env.WECHAT_CORPID)}&corpsecret=${encodeURIComponent(env.WECHAT_SECRET)}`
  );

  if (tokenJson.errcode !== 0 || !tokenJson.access_token) {
    throw new Error(
      weComErrorMessage(tokenJson.errmsg, "Failed to get WeCom access_token")
    );
  }

  await putCachedString(env, ACCESS_TOKEN_KV_KEY, tokenJson.access_token, tokenJson.expires_in);
  return tokenJson.access_token;
};

const resolveWebDetailUrl = (
  env: Env,
  instanceId: number,
  config: WeComPushRouteConfig
): string | null => {
  const explicit = config.webBaseUrl;
  if (explicit) {
    const base = explicit.replace(/\/$/, "");
    return `${base}/approval/detail/${instanceId}`;
  }

  const redirect = env.WECHAT_REDIRECT_URI?.trim();
  if (!redirect) return null;
  try {
    const parsed = new URL(redirect);
    return `${parsed.origin}/approval/detail/${instanceId}`;
  } catch {
    return null;
  }
};

const resolveMiniProgramPagePath = (instanceId: number, config: WeComPushRouteConfig): string => {
  const template = config.miniPagePathTemplate || "pages/approval-detail/index?id={id}";
  if (template.includes("{id}")) {
    return template.replaceAll("{id}", String(instanceId));
  }
  const joinChar = template.includes("?") ? "&" : "?";
  return `${template}${joinChar}id=${instanceId}`;
};

const resolveRouteConfig = async (env: Env): Promise<WeComPushRouteConfig> => {
  try {
    const runtimeMap = await loadRunnerRuntimeMap(env);
    const defaultTargetRaw = runtimeMap.WECOM_APPROVAL_DEFAULT_TARGET ?? env.WECOM_APPROVAL_DEFAULT_TARGET;

    return {
      webBaseUrl:
        (runtimeMap.WECOM_APPROVAL_WEB_BASE_URL || env.WECOM_APPROVAL_WEB_BASE_URL || "").trim() ||
        null,
      miniAppId:
        (runtimeMap.WECOM_MINIAPP_APPID || env.WECOM_MINIAPP_APPID || "").trim() || null,
      miniPagePathTemplate:
        (runtimeMap.WECOM_APPROVAL_MINI_PAGE_PATH || env.WECOM_APPROVAL_MINI_PAGE_PATH || "").trim() ||
        null,
      defaultTarget: defaultTargetRaw === "web" ? "web" : "miniapp"
    };
  } catch {
    return {
      webBaseUrl: env.WECOM_APPROVAL_WEB_BASE_URL?.trim() || null,
      miniAppId: env.WECOM_MINIAPP_APPID?.trim() || null,
      miniPagePathTemplate: env.WECOM_APPROVAL_MINI_PAGE_PATH?.trim() || null,
      defaultTarget: env.WECOM_APPROVAL_DEFAULT_TARGET === "web" ? "web" : "miniapp"
    };
  }
};

const buildTemplateCard = async (env: Env, payload: ApprovalPushPayload) => {
  const routeConfig = await resolveRouteConfig(env);
  const webUrl = resolveWebDetailUrl(env, payload.instanceId, routeConfig);
  const miniAppId = routeConfig.miniAppId ?? "";
  const miniPagePath = miniAppId ? resolveMiniProgramPagePath(payload.instanceId, routeConfig) : "";
  const defaultTarget = routeConfig.defaultTarget;

  const jumpList: Array<Record<string, unknown>> = [];
  if (miniAppId) {
    jumpList.push({
      type: 2,
      title: "打开小程序",
      appid: miniAppId,
      pagepath: miniPagePath
    });
  }
  if (webUrl) {
    jumpList.push({
      type: 1,
      title: "打开Web",
      url: webUrl
    });
  }

  if (jumpList.length === 0) {
    throw new Error("No jump target configured: set WECOM_MINIAPP_APPID or WECOM_APPROVAL_WEB_BASE_URL/WECHAT_REDIRECT_URI");
  }

  const cardAction =
    defaultTarget === "web"
      ? webUrl
        ? { type: 1, url: webUrl }
        : { type: 2, appid: miniAppId, pagepath: miniPagePath }
      : miniAppId
        ? { type: 2, appid: miniAppId, pagepath: miniPagePath }
        : { type: 1, url: webUrl as string };

  return {
    card_type: "text_notice",
    source: {
      desc: "审批系统",
      desc_color: 0
    },
    main_title: {
      title: "审批待办提醒",
      desc: payload.bizSummary
    },
    emphasis_content: {
      title: payload.instanceNo,
      desc: "审批单号"
    },
    sub_title_text: `${payload.bizType} / ${payload.currentNodeName}有新的待办，请及时处理。`,
    jump_list: jumpList,
    card_action: cardAction
  };
};

export const sendApprovalTodoTemplateCard = async (
  env: Env,
  payload: ApprovalPushPayload
): Promise<{
  msgid: string | null;
  invaliduser: string | null;
  unlicenseduser: string | null;
}> => {
  if (!env.WECHAT_AGENT_ID) {
    throw new Error("WECHAT_AGENT_ID is not configured");
  }

  const accessToken = await fetchWeComAccessToken(env);
  const templateCard = await buildTemplateCard(env, payload);
  const requestBody = {
    touser: payload.assigneeUserId,
    msgtype: "template_card",
    agentid: Number(env.WECHAT_AGENT_ID),
    template_card: templateCard,
    enable_duplicate_check: 1,
    duplicate_check_interval: 600
  };

  const json = await fetchViaBridgeStrict<WeComSendResponse>(
    env,
    `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${encodeURIComponent(accessToken)}`,
    {
      method: "POST",
      body: requestBody
    }
  );

  if (json.errcode !== 0) {
    throw new Error(weComErrorMessage(json.errmsg, "Failed to send WeCom template card"));
  }

  return {
    msgid: json.msgid ?? null,
    invaliduser: json.invaliduser ?? null,
    unlicenseduser: json.unlicenseduser ?? null
  };
};
