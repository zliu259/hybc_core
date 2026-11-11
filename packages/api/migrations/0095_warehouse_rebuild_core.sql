-- 0095_warehouse_rebuild_core.sql
-- 库房重做阶段 1 的核心表。设计见 docs/superpowers/specs/2026-11-11-warehouse-rebuild-design.md。
-- 旧库房和资产表在 0096 删除；配套清单、盘点、资料的表在各自阶段再建。
-- wh_guard 是批内断言用的空表，见 src/services/warehouse/guard.ts，任何时候都应该是空的。

CREATE TABLE IF NOT EXISTS wh_guard (ok INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS warehouse_member (
  userid TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('keeper', 'doc_admin')),
  added_by_userid TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (userid, role)
);

CREATE TABLE IF NOT EXISTS device_category (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS device (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  alias TEXT,
  category_id INTEGER NOT NULL,
  machine_type TEXT,
  diameter_mm INTEGER,
  manufacturer TEXT,
  model TEXT,
  serial_no TEXT,
  spec TEXT,
  ownership TEXT NOT NULL DEFAULT 'owned' CHECK (ownership IN ('owned', 'leased_in')),
  purchased_date TEXT,
  location TEXT NOT NULL DEFAULT 'warehouse' CHECK (location IN ('warehouse', 'project', 'scrapped')),
  current_project_id INTEGER,
  storage_note TEXT,
  photo_key TEXT,
  remark TEXT,
  version INTEGER NOT NULL DEFAULT 0,
  created_by_userid TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CONSTRAINT device_project_matches_location
    CHECK ((location = 'project') = (current_project_id IS NOT NULL)),
  FOREIGN KEY (category_id) REFERENCES device_category(id),
  FOREIGN KEY (current_project_id) REFERENCES project(id)
);
CREATE INDEX IF NOT EXISTS idx_device_category_id ON device(category_id);
CREATE INDEX IF NOT EXISTS idx_device_location ON device(location);
CREATE INDEX IF NOT EXISTS idx_device_current_project_id ON device(current_project_id);

CREATE TABLE IF NOT EXISTS device_event (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  ref_type TEXT,
  ref_id INTEGER,
  summary TEXT NOT NULL,
  photo_keys_json TEXT,
  operator_userid TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (device_id) REFERENCES device(id)
);
CREATE INDEX IF NOT EXISTS idx_device_event_device_id ON device_event(device_id);

CREATE TABLE IF NOT EXISTS material (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  material_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  spec TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL,
  category TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('turnover', 'consumable')),
  quantity REAL NOT NULL DEFAULT 0,
  unit_price REAL,
  min_stock REAL,
  storage_note TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  remark TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CONSTRAINT material_quantity_non_negative CHECK (quantity >= 0),
  UNIQUE (name, spec)
);
CREATE INDEX IF NOT EXISTS idx_material_category ON material(category);

CREATE TABLE IF NOT EXISTS wh_doc (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_no TEXT NOT NULL UNIQUE,
  doc_type TEXT NOT NULL CHECK (doc_type IN
    ('opening', 'inbound', 'out', 'back', 'transfer', 'adjust', 'scrap', 'unscrap')),
  project_id INTEGER,
  to_project_id INTEGER,
  project_kit_id INTEGER,
  counterparty TEXT,
  handover_name TEXT,
  remark TEXT,
  photo_keys_json TEXT,
  stocktake_id INTEGER,
  reverses_doc_id INTEGER UNIQUE,
  operator_userid TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  client_request_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES project(id),
  FOREIGN KEY (to_project_id) REFERENCES project(id),
  FOREIGN KEY (reverses_doc_id) REFERENCES wh_doc(id)
);
CREATE INDEX IF NOT EXISTS idx_wh_doc_project_id ON wh_doc(project_id);
CREATE INDEX IF NOT EXISTS idx_wh_doc_doc_type ON wh_doc(doc_type);
CREATE INDEX IF NOT EXISTS idx_wh_doc_occurred_at ON wh_doc(occurred_at);

CREATE TABLE IF NOT EXISTS wh_doc_line (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id INTEGER NOT NULL,
  device_id INTEGER,
  material_id INTEGER,
  quantity REAL NOT NULL CHECK (quantity > 0),
  outcome TEXT NOT NULL DEFAULT 'normal' CHECK (outcome IN ('normal', 'returned', 'lost')),
  stock_delta REAL NOT NULL DEFAULT 0,
  balance_after REAL,
  project_id INTEGER,
  project_delta REAL NOT NULL DEFAULT 0,
  usage_meters REAL,
  soil_type TEXT,
  note TEXT,
  created_at TEXT NOT NULL,
  CONSTRAINT wh_doc_line_one_target CHECK ((device_id IS NULL) <> (material_id IS NULL)),
  FOREIGN KEY (doc_id) REFERENCES wh_doc(id),
  FOREIGN KEY (device_id) REFERENCES device(id),
  FOREIGN KEY (material_id) REFERENCES material(id),
  FOREIGN KEY (project_id) REFERENCES project(id)
);
CREATE INDEX IF NOT EXISTS idx_wh_doc_line_doc_id ON wh_doc_line(doc_id);
CREATE INDEX IF NOT EXISTS idx_wh_doc_line_device_id ON wh_doc_line(device_id);
CREATE INDEX IF NOT EXISTS idx_wh_doc_line_material_id ON wh_doc_line(material_id);
CREATE INDEX IF NOT EXISTS idx_wh_doc_line_project_id_material_id ON wh_doc_line(project_id, material_id);

CREATE TABLE IF NOT EXISTS wh_task (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_no TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('inspection', 'maintenance', 'servicing', 'other')),
  source TEXT NOT NULL CHECK (source IN ('return', 'followup', 'manual')),
  device_id INTEGER,
  title TEXT NOT NULL,
  description TEXT,
  systems_json TEXT,
  blocking INTEGER NOT NULL DEFAULT 0 CHECK (blocking IN (0, 1)),
  required_photo_count INTEGER NOT NULL DEFAULT 0,
  due_date TEXT,
  assignee_userid TEXT,
  created_by_userid TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'submitted', 'done', 'cancelled')),
  result TEXT CHECK (result IS NULL OR result IN ('pass', 'fail')),
  result_note TEXT,
  review_note TEXT,
  supplement_round INTEGER NOT NULL DEFAULT 0,
  parent_task_id INTEGER,
  origin_doc_id INTEGER,
  submitted_at TEXT,
  done_at TEXT,
  done_by_userid TEXT,
  cancel_reason TEXT,
  version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (device_id) REFERENCES device(id)
);
CREATE INDEX IF NOT EXISTS idx_wh_task_device_id ON wh_task(device_id);
CREATE INDEX IF NOT EXISTS idx_wh_task_assignee_userid ON wh_task(assignee_userid);
CREATE INDEX IF NOT EXISTS idx_wh_task_status ON wh_task(status);

CREATE TABLE IF NOT EXISTS wh_task_photo (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL,
  file_key TEXT NOT NULL,
  uploaded_by_userid TEXT NOT NULL,
  created_at TEXT NOT NULL,
  deleted_at TEXT,
  FOREIGN KEY (task_id) REFERENCES wh_task(id)
);
CREATE INDEX IF NOT EXISTS idx_wh_task_photo_task_id ON wh_task_photo(task_id);
