CREATE TABLE IF NOT EXISTS warehouse_task_package (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  package_no TEXT NOT NULL UNIQUE,
  package_title TEXT NOT NULL,
  package_type TEXT NOT NULL DEFAULT 'daily',
  warehouse_id INTEGER,
  project_id INTEGER,
  priority TEXT NOT NULL DEFAULT 'normal',
  status TEXT NOT NULL DEFAULT 'open',
  assignee_userid TEXT,
  assigned_by_userid TEXT,
  planned_start_date TEXT,
  due_date TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  source_biz_type TEXT,
  source_biz_id INTEGER,
  remark TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (warehouse_id) REFERENCES warehouse(id),
  FOREIGN KEY (project_id) REFERENCES project(id)
);

CREATE INDEX IF NOT EXISTS idx_warehouse_task_package_status
  ON warehouse_task_package(status);
CREATE INDEX IF NOT EXISTS idx_warehouse_task_package_assignee
  ON warehouse_task_package(assignee_userid);
CREATE INDEX IF NOT EXISTS idx_warehouse_task_package_warehouse_id
  ON warehouse_task_package(warehouse_id);

ALTER TABLE warehouse_asset_work_order ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE warehouse_asset_work_order ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal';
ALTER TABLE warehouse_asset_work_order ADD COLUMN package_id INTEGER;
ALTER TABLE warehouse_asset_work_order ADD COLUMN assigned_by_userid TEXT;
ALTER TABLE warehouse_asset_work_order ADD COLUMN reviewer_userid TEXT;
ALTER TABLE warehouse_asset_work_order ADD COLUMN submitted_at TEXT;
ALTER TABLE warehouse_asset_work_order ADD COLUMN reviewed_at TEXT;
ALTER TABLE warehouse_asset_work_order ADD COLUMN manual_version_id INTEGER;
ALTER TABLE warehouse_asset_work_order ADD COLUMN mobile_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE warehouse_asset_work_order ADD COLUMN required_photo_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE warehouse_asset_work_order ADD COLUMN completion_summary_json TEXT;

CREATE INDEX IF NOT EXISTS idx_warehouse_asset_work_order_package_id
  ON warehouse_asset_work_order(package_id);
CREATE INDEX IF NOT EXISTS idx_warehouse_asset_work_order_assignee_status
  ON warehouse_asset_work_order(assignee_userid, status);
CREATE INDEX IF NOT EXISTS idx_warehouse_asset_work_order_source
  ON warehouse_asset_work_order(source);

CREATE TABLE IF NOT EXISTS warehouse_task_step (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_order_id INTEGER NOT NULL,
  step_no INTEGER NOT NULL,
  step_title TEXT NOT NULL,
  step_type TEXT NOT NULL DEFAULT 'check',
  required_flag INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'pending',
  manual_version_id INTEGER,
  result_json TEXT,
  completed_by_userid TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (work_order_id) REFERENCES warehouse_asset_work_order(id)
);

CREATE INDEX IF NOT EXISTS idx_warehouse_task_step_work_order_id
  ON warehouse_task_step(work_order_id);

CREATE TABLE IF NOT EXISTS warehouse_task_evidence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_order_id INTEGER NOT NULL,
  step_id INTEGER,
  tracked_asset_id INTEGER,
  evidence_type TEXT NOT NULL,
  file_key TEXT,
  file_name TEXT,
  summary TEXT,
  operator_userid TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (work_order_id) REFERENCES warehouse_asset_work_order(id),
  FOREIGN KEY (step_id) REFERENCES warehouse_task_step(id),
  FOREIGN KEY (tracked_asset_id) REFERENCES tracked_asset(id)
);

CREATE INDEX IF NOT EXISTS idx_warehouse_task_evidence_work_order_id
  ON warehouse_task_evidence(work_order_id);
CREATE INDEX IF NOT EXISTS idx_warehouse_task_evidence_tracked_asset_id
  ON warehouse_task_evidence(tracked_asset_id);

CREATE TABLE IF NOT EXISTS warehouse_manual (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  manual_code TEXT NOT NULL UNIQUE,
  manual_title TEXT NOT NULL,
  manual_type TEXT NOT NULL DEFAULT 'operation',
  asset_type_id INTEGER,
  status TEXT NOT NULL DEFAULT 'draft',
  owner_userid TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (asset_type_id) REFERENCES asset_type(id)
);

CREATE INDEX IF NOT EXISTS idx_warehouse_manual_status
  ON warehouse_manual(status);
CREATE INDEX IF NOT EXISTS idx_warehouse_manual_asset_type_id
  ON warehouse_manual(asset_type_id);

CREATE TABLE IF NOT EXISTS warehouse_manual_version (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  manual_id INTEGER NOT NULL,
  version_no INTEGER NOT NULL,
  content_json TEXT NOT NULL,
  ai_draft_task_id INTEGER,
  ai_draft_status TEXT NOT NULL DEFAULT 'none',
  status TEXT NOT NULL DEFAULT 'draft',
  published_by_userid TEXT,
  published_at TEXT,
  created_by_userid TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (manual_id, version_no),
  FOREIGN KEY (manual_id) REFERENCES warehouse_manual(id)
);

CREATE INDEX IF NOT EXISTS idx_warehouse_manual_version_manual_id
  ON warehouse_manual_version(manual_id);
CREATE INDEX IF NOT EXISTS idx_warehouse_manual_version_status
  ON warehouse_manual_version(status);

CREATE TABLE IF NOT EXISTS warehouse_manual_binding (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  manual_id INTEGER NOT NULL,
  asset_type_id INTEGER,
  work_order_type TEXT,
  configuration_role TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (manual_id) REFERENCES warehouse_manual(id),
  FOREIGN KEY (asset_type_id) REFERENCES asset_type(id)
);

CREATE INDEX IF NOT EXISTS idx_warehouse_manual_binding_asset_type
  ON warehouse_manual_binding(asset_type_id, work_order_type);
