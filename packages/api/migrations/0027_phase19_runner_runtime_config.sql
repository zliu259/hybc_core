CREATE TABLE IF NOT EXISTS runner_runtime_config (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  config_key TEXT NOT NULL UNIQUE,
  config_value TEXT NOT NULL,
  is_secret INTEGER NOT NULL DEFAULT 0,
  updated_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_runner_runtime_config_key ON runner_runtime_config(config_key);
