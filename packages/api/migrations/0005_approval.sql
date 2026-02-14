CREATE TABLE IF NOT EXISTS approval_template (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_code TEXT NOT NULL UNIQUE,
  template_name TEXT NOT NULL,
  biz_type TEXT NOT NULL,
  config_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_approval_template_biz_type ON approval_template(biz_type);
CREATE INDEX IF NOT EXISTS idx_approval_template_status ON approval_template(status);

CREATE TABLE IF NOT EXISTS approval_threshold (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id INTEGER NOT NULL,
  condition_field TEXT NOT NULL,
  operator TEXT NOT NULL,
  threshold_value REAL NOT NULL,
  threshold_value_upper REAL,
  target_branch TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (template_id) REFERENCES approval_template(id)
);

CREATE INDEX IF NOT EXISTS idx_approval_threshold_template_id ON approval_threshold(template_id);

CREATE TABLE IF NOT EXISTS approval_instance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  instance_no TEXT NOT NULL UNIQUE,
  template_id INTEGER NOT NULL,
  biz_type TEXT NOT NULL,
  biz_id INTEGER NOT NULL,
  biz_summary TEXT NOT NULL,
  initiator_userid TEXT NOT NULL,
  current_node_key TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  current_round INTEGER NOT NULL DEFAULT 1,
  submitted_at TEXT NOT NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (template_id) REFERENCES approval_template(id)
);

CREATE INDEX IF NOT EXISTS idx_approval_instance_status ON approval_instance(status);
CREATE INDEX IF NOT EXISTS idx_approval_instance_initiator ON approval_instance(initiator_userid);
CREATE INDEX IF NOT EXISTS idx_approval_instance_biz ON approval_instance(biz_type, biz_id);

CREATE TABLE IF NOT EXISTS approval_node_instance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  instance_id INTEGER NOT NULL,
  node_key TEXT NOT NULL,
  node_type TEXT NOT NULL,
  node_name TEXT NOT NULL,
  assignee_userids TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  round INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (instance_id) REFERENCES approval_instance(id)
);

CREATE INDEX IF NOT EXISTS idx_approval_node_instance_instance_id ON approval_node_instance(instance_id);
CREATE INDEX IF NOT EXISTS idx_approval_node_instance_status ON approval_node_instance(status);

CREATE TABLE IF NOT EXISTS approval_task (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  node_instance_id INTEGER NOT NULL,
  instance_id INTEGER NOT NULL,
  assignee_userid TEXT NOT NULL,
  action TEXT,
  comment TEXT,
  round INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'pending',
  acted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (node_instance_id) REFERENCES approval_node_instance(id),
  FOREIGN KEY (instance_id) REFERENCES approval_instance(id)
);

CREATE INDEX IF NOT EXISTS idx_approval_task_assignee_status ON approval_task(assignee_userid, status);
CREATE INDEX IF NOT EXISTS idx_approval_task_instance_id ON approval_task(instance_id);
CREATE INDEX IF NOT EXISTS idx_approval_task_node_instance_id ON approval_task(node_instance_id);

CREATE TABLE IF NOT EXISTS approval_transfer (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL,
  instance_id INTEGER NOT NULL,
  from_userid TEXT NOT NULL,
  to_userid TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES approval_task(id),
  FOREIGN KEY (instance_id) REFERENCES approval_instance(id)
);

CREATE INDEX IF NOT EXISTS idx_approval_transfer_instance_id ON approval_transfer(instance_id);

CREATE TABLE IF NOT EXISTS approval_initiator_action (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  instance_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  userid TEXT NOT NULL,
  comment TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (instance_id) REFERENCES approval_instance(id)
);
