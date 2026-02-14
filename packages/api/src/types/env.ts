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
  WECHAT_CORPID?: string;
  WECHAT_SECRET?: string;
  WECHAT_AGENT_ID?: string;
  WECHAT_REDIRECT_URI?: string;
}
