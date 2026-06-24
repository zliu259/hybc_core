-- 车辆保养记录：纯记录台账，挂钩 company_vehicle，支持多附件、软删除。
CREATE TABLE IF NOT EXISTS vehicle_maintenance_record (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_no TEXT NOT NULL UNIQUE,
  vehicle_id INTEGER NOT NULL,
  maintenance_type TEXT NOT NULL,
  content TEXT NOT NULL,
  mileage_km REAL NOT NULL,
  service_provider TEXT,
  cost REAL,
  serviced_at TEXT NOT NULL,
  attachments_json TEXT,
  remark TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_by_userid TEXT NOT NULL,
  voided_by_userid TEXT,
  voided_at TEXT,
  void_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (vehicle_id) REFERENCES company_vehicle(id)
);

CREATE INDEX IF NOT EXISTS idx_vehicle_maintenance_record_vehicle_id ON vehicle_maintenance_record(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_maintenance_record_serviced_at ON vehicle_maintenance_record(serviced_at);
CREATE INDEX IF NOT EXISTS idx_vehicle_maintenance_record_created_by ON vehicle_maintenance_record(created_by_userid);
CREATE INDEX IF NOT EXISTS idx_vehicle_maintenance_record_status ON vehicle_maintenance_record(status);
CREATE INDEX IF NOT EXISTS idx_vehicle_maintenance_record_type ON vehicle_maintenance_record(maintenance_type);

INSERT OR IGNORE INTO sys_dict (dict_type, dict_label, dict_value, sort_order, status, created_at, updated_at) VALUES
  ('vehicle_maintenance_type', '常规保养', 'routine', 10, 'active', datetime('now'), datetime('now')),
  ('vehicle_maintenance_type', '维修', 'repair', 20, 'active', datetime('now'), datetime('now')),
  ('vehicle_maintenance_type', '轮胎', 'tire', 30, 'active', datetime('now'), datetime('now')),
  ('vehicle_maintenance_type', '保险年检', 'inspection', 40, 'active', datetime('now'), datetime('now')),
  ('vehicle_maintenance_type', '事故处理', 'accident', 50, 'active', datetime('now'), datetime('now')),
  ('vehicle_maintenance_type', '其他', 'other', 90, 'active', datetime('now'), datetime('now'));
