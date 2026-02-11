CREATE TABLE IF NOT EXISTS sys_health (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sys_health_created_at ON sys_health(created_at);
