CREATE TABLE IF NOT EXISTS ai_provider_config (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_key TEXT NOT NULL UNIQUE,
  provider_name TEXT NOT NULL,
  api_endpoint TEXT,
  model_id TEXT,
  config_json TEXT,
  priority INTEGER NOT NULL DEFAULT 0,
  max_concurrent INTEGER NOT NULL DEFAULT 5,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_prompt_template (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_key TEXT NOT NULL UNIQUE,
  template_name TEXT NOT NULL,
  system_prompt TEXT NOT NULL,
  user_prompt_template TEXT NOT NULL,
  variables_schema TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_routing_rule (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_name TEXT NOT NULL,
  biz_type TEXT NOT NULL,
  task_type TEXT NOT NULL,
  condition_json TEXT,
  provider_id INTEGER NOT NULL,
  prompt_template_id INTEGER,
  priority INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (provider_id) REFERENCES ai_provider_config(id),
  FOREIGN KEY (prompt_template_id) REFERENCES ai_prompt_template(id)
);

CREATE INDEX IF NOT EXISTS idx_ai_routing_rule_biz_type ON ai_routing_rule(biz_type);
CREATE INDEX IF NOT EXISTS idx_ai_routing_rule_status ON ai_routing_rule(status);

CREATE TABLE IF NOT EXISTS ai_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER,
  biz_type TEXT NOT NULL,
  biz_id INTEGER NOT NULL,
  provider_key TEXT NOT NULL,
  model_id TEXT,
  prompt_hash TEXT,
  input_summary TEXT,
  output_summary TEXT,
  tokens_input INTEGER NOT NULL DEFAULT 0,
  tokens_output INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'success',
  error_message TEXT,
  compute_node_id TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_audit_log_biz ON ai_audit_log(biz_type, biz_id);
CREATE INDEX IF NOT EXISTS idx_ai_audit_log_created_at ON ai_audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_ai_audit_log_task_id ON ai_audit_log(task_id);

CREATE TABLE IF NOT EXISTS task_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_code TEXT NOT NULL UNIQUE,
  task_type TEXT NOT NULL,
  biz_type TEXT NOT NULL,
  biz_id INTEGER NOT NULL,
  priority INTEGER NOT NULL DEFAULT 5,
  payload_json TEXT NOT NULL,
  provider_id INTEGER,
  assigned_node_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  max_retries INTEGER NOT NULL DEFAULT 3,
  retry_count INTEGER NOT NULL DEFAULT 0,
  timeout_seconds INTEGER NOT NULL DEFAULT 300,
  result_json TEXT,
  error_message TEXT,
  assigned_at TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (provider_id) REFERENCES ai_provider_config(id)
);

CREATE INDEX IF NOT EXISTS idx_task_queue_status_priority ON task_queue(status, priority);
CREATE INDEX IF NOT EXISTS idx_task_queue_assigned_node ON task_queue(assigned_node_id);
CREATE INDEX IF NOT EXISTS idx_task_queue_biz ON task_queue(biz_type, biz_id);

CREATE TABLE IF NOT EXISTS compute_node (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  node_id TEXT NOT NULL UNIQUE,
  node_name TEXT NOT NULL,
  node_type TEXT NOT NULL,
  capabilities_json TEXT,
  status TEXT NOT NULL DEFAULT 'offline',
  cpu_cores INTEGER,
  memory_mb INTEGER,
  last_heartbeat_at TEXT,
  registered_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_compute_node_status ON compute_node(status);
