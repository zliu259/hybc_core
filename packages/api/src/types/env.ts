export interface Env {
  DB: D1Database;
  LEGACY_DB: D1Database;
  KV: KVNamespace;
  FILES: R2Bucket;
  EVENT_QUEUE: Queue;
  APP_ENV: string;
}
