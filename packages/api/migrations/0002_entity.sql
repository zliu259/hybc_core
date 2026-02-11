CREATE TABLE IF NOT EXISTS entity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_code TEXT NOT NULL UNIQUE,
  entity_name TEXT NOT NULL,
  legal_person TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS entity_bank_account (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_id INTEGER NOT NULL,
  bank_name TEXT NOT NULL,
  account_name TEXT NOT NULL,
  account_no TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (entity_id) REFERENCES entity(id)
);

CREATE INDEX IF NOT EXISTS idx_entity_bank_account_entity_id ON entity_bank_account(entity_id);

CREATE TABLE IF NOT EXISTS entity_invoice_profile (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_id INTEGER NOT NULL,
  invoice_title TEXT NOT NULL,
  tax_no TEXT NOT NULL,
  address TEXT,
  phone TEXT,
  bank_name TEXT,
  bank_account TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (entity_id) REFERENCES entity(id)
);

CREATE INDEX IF NOT EXISTS idx_entity_invoice_profile_entity_id ON entity_invoice_profile(entity_id);
