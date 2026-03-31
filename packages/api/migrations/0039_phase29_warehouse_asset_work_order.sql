CREATE TABLE IF NOT EXISTS warehouse_asset_work_order (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_order_no TEXT NOT NULL UNIQUE,
  work_order_type TEXT NOT NULL,
  tracked_asset_id INTEGER,
  tracked_asset_configuration_id INTEGER,
  stock_order_id INTEGER,
  project_id INTEGER,
  warehouse_id INTEGER,
  applicant_userid TEXT NOT NULL,
  assignee_userid TEXT,
  blocking_flag INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'draft',
  approval_instance_id INTEGER,
  scheduled_date TEXT,
  started_at TEXT,
  completed_at TEXT,
  result_summary TEXT,
  remark TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tracked_asset_id) REFERENCES tracked_asset(id),
  FOREIGN KEY (tracked_asset_configuration_id) REFERENCES tracked_asset_configuration(id),
  FOREIGN KEY (stock_order_id) REFERENCES stock_order(id),
  FOREIGN KEY (project_id) REFERENCES project(id),
  FOREIGN KEY (warehouse_id) REFERENCES warehouse(id),
  FOREIGN KEY (approval_instance_id) REFERENCES approval_instance(id)
);

CREATE INDEX IF NOT EXISTS idx_warehouse_asset_work_order_status
  ON warehouse_asset_work_order(status);
CREATE INDEX IF NOT EXISTS idx_warehouse_asset_work_order_type
  ON warehouse_asset_work_order(work_order_type);
CREATE INDEX IF NOT EXISTS idx_warehouse_asset_work_order_project_id
  ON warehouse_asset_work_order(project_id);
CREATE INDEX IF NOT EXISTS idx_warehouse_asset_work_order_warehouse_id
  ON warehouse_asset_work_order(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_warehouse_asset_work_order_asset_id
  ON warehouse_asset_work_order(tracked_asset_id);
CREATE INDEX IF NOT EXISTS idx_warehouse_asset_work_order_configuration_id
  ON warehouse_asset_work_order(tracked_asset_configuration_id);
CREATE INDEX IF NOT EXISTS idx_warehouse_asset_work_order_stock_order_id
  ON warehouse_asset_work_order(stock_order_id);
CREATE INDEX IF NOT EXISTS idx_warehouse_asset_work_order_blocking
  ON warehouse_asset_work_order(blocking_flag, status);
