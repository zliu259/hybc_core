export interface Env {
  DB: D1Database;
  LEGACY_DB: D1Database;
  KV: KVNamespace;
  FILES: R2Bucket;
  EVENT_QUEUE: Queue;
  APP_ENV: string;
  JWT_SECRET: string;
  UPLOAD_SIGNING_SECRET: string;
  TASK_API_KEY: string;
  BRIDGE_HMAC_SECRET?: string;
  BRIDGE_HEALTH_URL?: string;
  RUNNER_HEALTH_URL?: string;
  WECHAT_CORPID?: string;
  WECHAT_SECRET?: string;
  WECHAT_AGENT_ID?: string;
  WECHAT_REDIRECT_URI?: string;
  WECHAT_ROLE_TAG_MAPPING?: string;
  WECHAT_BRIDGE_BASE_URL?: string;
  WECHAT_BRIDGE_PROXY_URL?: string;
  WECHAT_BRIDGE_TOKEN?: string;
  WECOM_APPROVAL_WEB_BASE_URL?: string;
  WECOM_MINIAPP_APPID?: string;
  WECOM_APPROVAL_MINI_PAGE_PATH?: string;
  WECOM_APPROVAL_DEFAULT_TARGET?: "web" | "miniapp";
  PASSKEY_RP_ID: string;
  PASSKEY_RP_NAME: string;
}
