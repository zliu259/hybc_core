ALTER TABLE fuel_quota_application ADD COLUMN risk_level TEXT NOT NULL DEFAULT 'normal';
ALTER TABLE fuel_quota_application ADD COLUMN risk_summary TEXT;
ALTER TABLE fuel_quota_application ADD COLUMN needs_info_reason TEXT;
ALTER TABLE fuel_quota_application ADD COLUMN resubmitted_at TEXT;
ALTER TABLE fuel_quota_application ADD COLUMN supplement_count INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS fleet_fuel_rule_policy (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  policy_name TEXT NOT NULL,
  policy_type TEXT NOT NULL,
  config_json TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'warning',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_fleet_fuel_rule_policy_type
  ON fleet_fuel_rule_policy(policy_type);

CREATE INDEX IF NOT EXISTS idx_fleet_fuel_rule_policy_enabled
  ON fleet_fuel_rule_policy(enabled);

CREATE TABLE IF NOT EXISTS fuel_quota_rule_hit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER NOT NULL,
  policy_id INTEGER NOT NULL,
  policy_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  hit_message TEXT NOT NULL,
  suggested_action TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (application_id) REFERENCES fuel_quota_application(id),
  FOREIGN KEY (policy_id) REFERENCES fleet_fuel_rule_policy(id)
);

CREATE INDEX IF NOT EXISTS idx_fuel_quota_rule_hit_application_id
  ON fuel_quota_rule_hit(application_id);

CREATE INDEX IF NOT EXISTS idx_fuel_quota_rule_hit_policy_type
  ON fuel_quota_rule_hit(policy_type);

CREATE TABLE IF NOT EXISTS fleet_wecom_notification (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER,
  notification_type TEXT NOT NULL,
  target_userids_json TEXT,
  target_group_key TEXT,
  message_summary TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  sent_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (application_id) REFERENCES fuel_quota_application(id)
);

CREATE INDEX IF NOT EXISTS idx_fleet_wecom_notification_application_id
  ON fleet_wecom_notification(application_id);

CREATE INDEX IF NOT EXISTS idx_fleet_wecom_notification_status
  ON fleet_wecom_notification(status);

CREATE INDEX IF NOT EXISTS idx_fleet_wecom_notification_type
  ON fleet_wecom_notification(notification_type);

INSERT INTO fleet_fuel_rule_policy (
  policy_name,
  policy_type,
  config_json,
  severity,
  enabled,
  created_by,
  created_at,
  updated_at
) VALUES
  ('单次申请额度超过 1000 元', 'amount_limit', '{"max_amount":1000}', 'warning', 1, 'system', datetime('now'), datetime('now')),
  ('单人每月申请超过 6 次', 'monthly_frequency', '{"max_count":6}', 'warning', 1, 'system', datetime('now'), datetime('now')),
  ('本次里程较上次增加超过 1500 公里', 'mileage_delta', '{"max_delta_km":1500}', 'warning', 1, 'system', datetime('now'), datetime('now')),
  ('油卡余额低于 300 元', 'card_balance', '{"min_balance":300}', 'high', 1, 'system', datetime('now'), datetime('now')),
  ('现场照片必填', 'photo_required', '{"required":true}', 'warning', 1, 'system', datetime('now'), datetime('now'));
