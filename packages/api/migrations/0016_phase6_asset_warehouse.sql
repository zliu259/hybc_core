CREATE TABLE IF NOT EXISTS warehouse (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  warehouse_code TEXT NOT NULL UNIQUE,
  warehouse_name TEXT NOT NULL,
  location TEXT,
  manager_userid TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  remark TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_warehouse_code ON warehouse(warehouse_code);
CREATE INDEX idx_warehouse_status ON warehouse(status);

CREATE TABLE IF NOT EXISTS asset_type (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type_code TEXT NOT NULL UNIQUE,
  type_name TEXT NOT NULL,
  tracked_flag INTEGER NOT NULL DEFAULT 0,
  unit TEXT NOT NULL DEFAULT '件',
  property_schema TEXT,
  min_stock REAL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_asset_type_code ON asset_type(type_code);
CREATE INDEX idx_asset_type_status ON asset_type(status);

CREATE TABLE IF NOT EXISTS tracked_asset (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_code TEXT NOT NULL UNIQUE,
  asset_type_id INTEGER NOT NULL,
  asset_name TEXT NOT NULL,
  brand TEXT,
  model TEXT,
  serial_no TEXT,
  status TEXT NOT NULL DEFAULT 'idle',
  current_project_id INTEGER,
  current_warehouse_id INTEGER,
  current_location TEXT,
  properties_json TEXT,
  purchased_date TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (asset_type_id) REFERENCES asset_type(id),
  FOREIGN KEY (current_project_id) REFERENCES project(id),
  FOREIGN KEY (current_warehouse_id) REFERENCES warehouse(id)
);

CREATE INDEX idx_tracked_asset_code ON tracked_asset(asset_code);
CREATE INDEX idx_tracked_asset_type_id ON tracked_asset(asset_type_id);
CREATE INDEX idx_tracked_asset_status ON tracked_asset(status);
CREATE INDEX idx_tracked_asset_project_id ON tracked_asset(current_project_id);
CREATE INDEX idx_tracked_asset_warehouse_id ON tracked_asset(current_warehouse_id);

CREATE TABLE IF NOT EXISTS tracked_asset_document (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tracked_asset_id INTEGER NOT NULL,
  doc_type TEXT NOT NULL,
  file_key TEXT NOT NULL,
  file_name TEXT,
  remark TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  FOREIGN KEY (tracked_asset_id) REFERENCES tracked_asset(id)
);

CREATE INDEX idx_tracked_asset_document_asset_id ON tracked_asset_document(tracked_asset_id);

CREATE TABLE IF NOT EXISTS tracked_asset_event (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tracked_asset_id INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  event_time TEXT NOT NULL,
  operator_userid TEXT NOT NULL,
  project_id INTEGER,
  warehouse_id INTEGER,
  detail TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (tracked_asset_id) REFERENCES tracked_asset(id)
);

CREATE INDEX idx_tracked_asset_event_asset_id ON tracked_asset_event(tracked_asset_id);
CREATE INDEX idx_tracked_asset_event_type ON tracked_asset_event(event_type);
CREATE INDEX idx_tracked_asset_event_time ON tracked_asset_event(event_time);

CREATE TABLE IF NOT EXISTS inventory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  warehouse_id INTEGER NOT NULL,
  asset_type_id INTEGER NOT NULL,
  quantity REAL NOT NULL DEFAULT 0,
  min_stock REAL,
  status TEXT NOT NULL DEFAULT 'active',
  updated_at TEXT NOT NULL,
  UNIQUE (warehouse_id, asset_type_id),
  FOREIGN KEY (warehouse_id) REFERENCES warehouse(id),
  FOREIGN KEY (asset_type_id) REFERENCES asset_type(id)
);

CREATE INDEX idx_inventory_warehouse_id ON inventory(warehouse_id);
CREATE INDEX idx_inventory_asset_type_id ON inventory(asset_type_id);

CREATE TABLE IF NOT EXISTS stock_order (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no TEXT NOT NULL UNIQUE,
  order_type TEXT NOT NULL,
  project_id INTEGER,
  from_warehouse_id INTEGER,
  to_warehouse_id INTEGER,
  applicant_userid TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  approval_instance_id INTEGER,
  executed_at TEXT,
  remark TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES project(id),
  FOREIGN KEY (from_warehouse_id) REFERENCES warehouse(id),
  FOREIGN KEY (to_warehouse_id) REFERENCES warehouse(id)
);

CREATE INDEX idx_stock_order_no ON stock_order(order_no);
CREATE INDEX idx_stock_order_type ON stock_order(order_type);
CREATE INDEX idx_stock_order_status ON stock_order(status);

CREATE TABLE IF NOT EXISTS stock_order_item (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stock_order_id INTEGER NOT NULL,
  asset_type_id INTEGER,
  tracked_asset_id INTEGER,
  quantity REAL NOT NULL DEFAULT 0,
  unit TEXT,
  remark TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  FOREIGN KEY (stock_order_id) REFERENCES stock_order(id),
  FOREIGN KEY (asset_type_id) REFERENCES asset_type(id),
  FOREIGN KEY (tracked_asset_id) REFERENCES tracked_asset(id)
);

CREATE INDEX idx_stock_order_item_order_id ON stock_order_item(stock_order_id);
CREATE INDEX idx_stock_order_item_asset_type_id ON stock_order_item(asset_type_id);
CREATE INDEX idx_stock_order_item_tracked_asset_id ON stock_order_item(tracked_asset_id);

CREATE TABLE IF NOT EXISTS project_equipment_plan (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_no TEXT NOT NULL UNIQUE,
  project_id INTEGER NOT NULL,
  applicant_userid TEXT NOT NULL,
  plan_status TEXT NOT NULL DEFAULT 'draft',
  ai_status TEXT NOT NULL DEFAULT 'none',
  ai_task_id INTEGER,
  recommendation_result_json TEXT,
  stock_order_id INTEGER,
  remark TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES project(id),
  FOREIGN KEY (stock_order_id) REFERENCES stock_order(id)
);

CREATE INDEX idx_project_equipment_plan_no ON project_equipment_plan(plan_no);
CREATE INDEX idx_project_equipment_plan_project_id ON project_equipment_plan(project_id);
CREATE INDEX idx_project_equipment_plan_status ON project_equipment_plan(plan_status);

CREATE TABLE IF NOT EXISTS project_equipment_plan_item (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL,
  asset_type_id INTEGER NOT NULL,
  planned_qty REAL NOT NULL DEFAULT 0,
  recommended_qty REAL,
  source TEXT,
  note TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (plan_id) REFERENCES project_equipment_plan(id),
  FOREIGN KEY (asset_type_id) REFERENCES asset_type(id)
);

CREATE INDEX idx_project_equipment_plan_item_plan_id ON project_equipment_plan_item(plan_id);
CREATE INDEX idx_project_equipment_plan_item_asset_type_id ON project_equipment_plan_item(asset_type_id);

CREATE TABLE IF NOT EXISTS inventory_consumption (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  warehouse_id INTEGER NOT NULL,
  project_id INTEGER,
  asset_type_id INTEGER NOT NULL,
  quantity REAL NOT NULL,
  consumed_date TEXT NOT NULL,
  recorder_userid TEXT NOT NULL,
  remark TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (warehouse_id) REFERENCES warehouse(id),
  FOREIGN KEY (project_id) REFERENCES project(id),
  FOREIGN KEY (asset_type_id) REFERENCES asset_type(id)
);

CREATE INDEX idx_inventory_consumption_warehouse_id ON inventory_consumption(warehouse_id);
CREATE INDEX idx_inventory_consumption_project_id ON inventory_consumption(project_id);
CREATE INDEX idx_inventory_consumption_asset_type_id ON inventory_consumption(asset_type_id);

INSERT OR IGNORE INTO approval_template (
  template_code,
  template_name,
  biz_type,
  config_json,
  status,
  created_by,
  created_at,
  updated_at
) VALUES (
  'TPL-STOCK-ORDER',
  '出入库单审批模板',
  'stock_order',
  '{"version":1,"start_key":"warehouse_review","nodes":[{"key":"warehouse_review","type":"sequential","name":"仓库负责人审核","assignee_userids":["site_manager"],"next_key":"finance_review"},{"key":"finance_review","type":"sequential","name":"财务复核","assignee_userids":["finance_manager"],"next_key":"archive_cc"},{"key":"archive_cc","type":"cc","name":"抄送归档","assignee_userids":["manager"],"next_key":null}]}',
  'active',
  'system',
  datetime('now'),
  datetime('now')
);
