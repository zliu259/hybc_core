CREATE TABLE IF NOT EXISTS project_wecom_bot_binding (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  binding_name TEXT NOT NULL,
  group_chat_id TEXT,
  bot_id TEXT,
  allowed_tools_json TEXT NOT NULL,
  data_scope TEXT NOT NULL DEFAULT 'project',
  push_webhook_secret_ref TEXT,
  push_enabled INTEGER NOT NULL DEFAULT 1,
  qa_enabled INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active',
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES project(id)
);

CREATE INDEX IF NOT EXISTS idx_project_wecom_bot_binding_project_id
  ON project_wecom_bot_binding(project_id);

CREATE INDEX IF NOT EXISTS idx_project_wecom_bot_binding_group_chat_id
  ON project_wecom_bot_binding(group_chat_id);

CREATE INDEX IF NOT EXISTS idx_project_wecom_bot_binding_status
  ON project_wecom_bot_binding(status);

CREATE TABLE IF NOT EXISTS wecom_tool_call_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  binding_id INTEGER,
  project_id INTEGER,
  tool_name TEXT NOT NULL,
  caller_userid TEXT,
  group_chat_id TEXT,
  request_json TEXT NOT NULL,
  response_summary TEXT,
  status TEXT NOT NULL,
  error_message TEXT,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (binding_id) REFERENCES project_wecom_bot_binding(id),
  FOREIGN KEY (project_id) REFERENCES project(id)
);

CREATE INDEX IF NOT EXISTS idx_wecom_tool_call_audit_project_id
  ON wecom_tool_call_audit(project_id);

CREATE INDEX IF NOT EXISTS idx_wecom_tool_call_audit_binding_id
  ON wecom_tool_call_audit(binding_id);

CREATE INDEX IF NOT EXISTS idx_wecom_tool_call_audit_tool_name
  ON wecom_tool_call_audit(tool_name);

CREATE TABLE IF NOT EXISTS project_wecom_push_event (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  binding_id INTEGER,
  project_id INTEGER NOT NULL,
  source_event_type TEXT NOT NULL,
  source_biz_type TEXT NOT NULL,
  source_biz_id INTEGER NOT NULL,
  message_type TEXT NOT NULL,
  message_summary TEXT,
  status TEXT NOT NULL,
  error_message TEXT,
  webhook_secret_ref TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  pushed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (binding_id) REFERENCES project_wecom_bot_binding(id),
  FOREIGN KEY (project_id) REFERENCES project(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_project_wecom_push_event_unique_source
  ON project_wecom_push_event(binding_id, source_event_type, source_biz_type, source_biz_id);

CREATE INDEX IF NOT EXISTS idx_project_wecom_push_event_project_id
  ON project_wecom_push_event(project_id);

CREATE INDEX IF NOT EXISTS idx_project_wecom_push_event_status
  ON project_wecom_push_event(status);
