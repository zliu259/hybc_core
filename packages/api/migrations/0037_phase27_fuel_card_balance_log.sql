CREATE TABLE IF NOT EXISTS fuel_card_balance_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fuel_card_id INTEGER NOT NULL,
  operation_type TEXT NOT NULL,
  previous_balance REAL NOT NULL,
  new_balance REAL NOT NULL,
  change_amount REAL NOT NULL,
  related_application_id INTEGER,
  operator_userid TEXT,
  remark TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (fuel_card_id) REFERENCES fuel_card(id),
  FOREIGN KEY (related_application_id) REFERENCES fuel_quota_application(id)
);

CREATE INDEX IF NOT EXISTS idx_fuel_card_balance_log_card_id
  ON fuel_card_balance_log(fuel_card_id);

CREATE INDEX IF NOT EXISTS idx_fuel_card_balance_log_created_at
  ON fuel_card_balance_log(created_at);

CREATE INDEX IF NOT EXISTS idx_fuel_card_balance_log_application_id
  ON fuel_card_balance_log(related_application_id);
