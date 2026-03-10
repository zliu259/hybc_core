ALTER TABLE entity ADD COLUMN company_attribute TEXT NOT NULL DEFAULT 'self_owned';
ALTER TABLE entity ADD COLUMN storage_quota_mb INTEGER NOT NULL DEFAULT 1024;
ALTER TABLE entity ADD COLUMN storage_used_mb INTEGER NOT NULL DEFAULT 0;
ALTER TABLE entity ADD COLUMN primary_bank_name TEXT;
ALTER TABLE entity ADD COLUMN primary_bank_branch_no TEXT;
ALTER TABLE entity ADD COLUMN primary_bank_account_no TEXT;

ALTER TABLE entity_bank_account ADD COLUMN bank_branch_no TEXT;
ALTER TABLE entity_bank_account ADD COLUMN bank_line_no TEXT;

CREATE TABLE IF NOT EXISTS entity_attachment (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_id INTEGER NOT NULL,
  file_key TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_size INTEGER,
  file_category TEXT NOT NULL DEFAULT 'business_license',
  status TEXT NOT NULL DEFAULT 'active',
  uploaded_by_userid TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (entity_id) REFERENCES entity(id)
);

CREATE INDEX IF NOT EXISTS idx_entity_attachment_entity_id ON entity_attachment(entity_id);
CREATE INDEX IF NOT EXISTS idx_entity_attachment_status ON entity_attachment(status);

CREATE TABLE IF NOT EXISTS company_vehicle (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_uuid TEXT NOT NULL UNIQUE,
  entity_id INTEGER,
  ownership_type TEXT NOT NULL DEFAULT 'company_owned',
  owner_name TEXT,
  current_plate_no TEXT NOT NULL,
  vehicle_model TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (entity_id) REFERENCES entity(id)
);

CREATE INDEX IF NOT EXISTS idx_company_vehicle_entity_id ON company_vehicle(entity_id);
CREATE INDEX IF NOT EXISTS idx_company_vehicle_status ON company_vehicle(status);
CREATE INDEX IF NOT EXISTS idx_company_vehicle_plate_no ON company_vehicle(current_plate_no);

CREATE TABLE IF NOT EXISTS company_vehicle_plate_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER NOT NULL,
  plate_no TEXT NOT NULL,
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (vehicle_id) REFERENCES company_vehicle(id)
);

CREATE INDEX IF NOT EXISTS idx_company_vehicle_plate_history_vehicle_id ON company_vehicle_plate_history(vehicle_id);

CREATE TABLE IF NOT EXISTS company_vehicle_mileage_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER NOT NULL,
  mileage_km REAL NOT NULL,
  operator_userid TEXT NOT NULL,
  remark TEXT,
  photo_keys_json TEXT,
  recorded_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (vehicle_id) REFERENCES company_vehicle(id)
);

CREATE INDEX IF NOT EXISTS idx_company_vehicle_mileage_log_vehicle_id ON company_vehicle_mileage_log(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_company_vehicle_mileage_log_recorded_at ON company_vehicle_mileage_log(recorded_at);

CREATE TABLE IF NOT EXISTS fuel_card (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_no TEXT NOT NULL UNIQUE,
  issued_to_entity_id INTEGER,
  latest_balance REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (issued_to_entity_id) REFERENCES entity(id)
);

CREATE INDEX IF NOT EXISTS idx_fuel_card_entity_id ON fuel_card(issued_to_entity_id);

CREATE TABLE IF NOT EXISTS fuel_card_vehicle_binding (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fuel_card_id INTEGER NOT NULL,
  vehicle_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (fuel_card_id) REFERENCES fuel_card(id),
  FOREIGN KEY (vehicle_id) REFERENCES company_vehicle(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_fuel_card_vehicle_binding_unique ON fuel_card_vehicle_binding(fuel_card_id, vehicle_id);
CREATE INDEX IF NOT EXISTS idx_fuel_card_vehicle_binding_vehicle_id ON fuel_card_vehicle_binding(vehicle_id);

CREATE TABLE IF NOT EXISTS fuel_quota_application (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_no TEXT NOT NULL UNIQUE,
  applicant_userid TEXT NOT NULL,
  vehicle_id INTEGER NOT NULL,
  requested_amount REAL NOT NULL,
  vehicle_mileage_km REAL NOT NULL,
  photo_keys_json TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  requested_at TEXT NOT NULL,
  processed_by_userid TEXT,
  processed_at TEXT,
  office_remark TEXT,
  fuel_card_id INTEGER,
  latest_card_balance REAL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (vehicle_id) REFERENCES company_vehicle(id),
  FOREIGN KEY (fuel_card_id) REFERENCES fuel_card(id)
);

CREATE INDEX IF NOT EXISTS idx_fuel_quota_application_vehicle_id ON fuel_quota_application(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_fuel_quota_application_status ON fuel_quota_application(status);
CREATE INDEX IF NOT EXISTS idx_fuel_quota_application_requested_at ON fuel_quota_application(requested_at);
CREATE INDEX IF NOT EXISTS idx_fuel_quota_application_applicant_userid ON fuel_quota_application(applicant_userid);
