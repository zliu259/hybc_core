CREATE TABLE IF NOT EXISTS wecom_group_chat_directory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL UNIQUE,
  chat_name TEXT NOT NULL,
  chat_type TEXT NOT NULL DEFAULT 'manual',
  owner_userid TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  webhook_secret_ref TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  raw_json TEXT,
  last_synced_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_wecom_group_chat_directory_chat_name
  ON wecom_group_chat_directory(chat_name);

CREATE INDEX IF NOT EXISTS idx_wecom_group_chat_directory_chat_type
  ON wecom_group_chat_directory(chat_type);

CREATE INDEX IF NOT EXISTS idx_wecom_group_chat_directory_owner
  ON wecom_group_chat_directory(owner_userid);

CREATE INDEX IF NOT EXISTS idx_wecom_group_chat_directory_status
  ON wecom_group_chat_directory(status);
