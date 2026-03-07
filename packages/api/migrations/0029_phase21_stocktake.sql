CREATE TABLE IF NOT EXISTS stocktake_task (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_no TEXT NOT NULL UNIQUE,
  task_title TEXT NOT NULL,
  scope TEXT NOT NULL,
  warehouse_id INTEGER,
  planned_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'counting',
  creator_userid TEXT NOT NULL,
  completed_at TEXT,
  remark TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (warehouse_id) REFERENCES warehouse(id)
);

CREATE INDEX idx_stocktake_task_no ON stocktake_task(task_no);
CREATE INDEX idx_stocktake_task_scope ON stocktake_task(scope);
CREATE INDEX idx_stocktake_task_status ON stocktake_task(status);
CREATE INDEX idx_stocktake_task_warehouse_id ON stocktake_task(warehouse_id);
CREATE INDEX idx_stocktake_task_planned_date ON stocktake_task(planned_date);

CREATE TABLE IF NOT EXISTS stocktake_line (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stocktake_task_id INTEGER NOT NULL,
  warehouse_id INTEGER NOT NULL,
  item_kind TEXT NOT NULL,
  asset_type_id INTEGER,
  tracked_asset_id INTEGER,
  item_name TEXT NOT NULL,
  unit TEXT,
  expected_qty REAL NOT NULL DEFAULT 0,
  counted_qty REAL,
  diff_qty REAL NOT NULL DEFAULT 0,
  line_status TEXT NOT NULL DEFAULT 'normal',
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (stocktake_task_id) REFERENCES stocktake_task(id),
  FOREIGN KEY (warehouse_id) REFERENCES warehouse(id),
  FOREIGN KEY (asset_type_id) REFERENCES asset_type(id),
  FOREIGN KEY (tracked_asset_id) REFERENCES tracked_asset(id)
);

CREATE INDEX idx_stocktake_line_task_id ON stocktake_line(stocktake_task_id);
CREATE INDEX idx_stocktake_line_warehouse_id ON stocktake_line(warehouse_id);
CREATE INDEX idx_stocktake_line_item_kind ON stocktake_line(item_kind);
CREATE INDEX idx_stocktake_line_asset_type_id ON stocktake_line(asset_type_id);
CREATE INDEX idx_stocktake_line_tracked_asset_id ON stocktake_line(tracked_asset_id);
CREATE INDEX idx_stocktake_line_status ON stocktake_line(line_status);
