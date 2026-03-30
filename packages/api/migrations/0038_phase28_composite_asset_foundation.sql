ALTER TABLE stock_order ADD COLUMN override_status TEXT NOT NULL DEFAULT 'none';
ALTER TABLE stock_order ADD COLUMN override_reason TEXT;
ALTER TABLE stock_order ADD COLUMN override_approver_userid TEXT;
ALTER TABLE stock_order ADD COLUMN override_risk_acknowledged INTEGER NOT NULL DEFAULT 0;

ALTER TABLE stock_order_item ADD COLUMN configuration_role TEXT;
ALTER TABLE stock_order_item ADD COLUMN configuration_group_key TEXT;
ALTER TABLE stock_order_item ADD COLUMN requires_modification INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS asset_compatibility_rule (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  left_asset_type_id INTEGER NOT NULL,
  right_asset_type_id INTEGER NOT NULL,
  relation_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (left_asset_type_id) REFERENCES asset_type(id),
  FOREIGN KEY (right_asset_type_id) REFERENCES asset_type(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_asset_compatibility_rule_unique
  ON asset_compatibility_rule(left_asset_type_id, right_asset_type_id, relation_type);
CREATE INDEX IF NOT EXISTS idx_asset_compatibility_rule_left
  ON asset_compatibility_rule(left_asset_type_id);
CREATE INDEX IF NOT EXISTS idx_asset_compatibility_rule_right
  ON asset_compatibility_rule(right_asset_type_id);

CREATE TABLE IF NOT EXISTS tracked_asset_configuration (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  configuration_code TEXT NOT NULL UNIQUE,
  whole_machine_code TEXT,
  shell_asset_id INTEGER,
  core_asset_id INTEGER,
  console_asset_id INTEGER,
  status TEXT NOT NULL DEFAULT 'planned',
  project_id INTEGER,
  warehouse_id INTEGER,
  effective_from TEXT,
  effective_to TEXT,
  note TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (shell_asset_id) REFERENCES tracked_asset(id),
  FOREIGN KEY (core_asset_id) REFERENCES tracked_asset(id),
  FOREIGN KEY (console_asset_id) REFERENCES tracked_asset(id),
  FOREIGN KEY (project_id) REFERENCES project(id),
  FOREIGN KEY (warehouse_id) REFERENCES warehouse(id)
);

CREATE INDEX IF NOT EXISTS idx_tracked_asset_configuration_status
  ON tracked_asset_configuration(status);
CREATE INDEX IF NOT EXISTS idx_tracked_asset_configuration_shell
  ON tracked_asset_configuration(shell_asset_id);
CREATE INDEX IF NOT EXISTS idx_tracked_asset_configuration_core
  ON tracked_asset_configuration(core_asset_id);
CREATE INDEX IF NOT EXISTS idx_tracked_asset_configuration_console
  ON tracked_asset_configuration(console_asset_id);
CREATE INDEX IF NOT EXISTS idx_tracked_asset_configuration_machine_code
  ON tracked_asset_configuration(whole_machine_code);
