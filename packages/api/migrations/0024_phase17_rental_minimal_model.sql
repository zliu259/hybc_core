ALTER TABLE project ADD COLUMN project_kind TEXT NOT NULL DEFAULT 'internal';
ALTER TABLE project ADD COLUMN external_party_name TEXT;

ALTER TABLE tracked_asset ADD COLUMN ownership_type TEXT NOT NULL DEFAULT 'owned';

CREATE TABLE IF NOT EXISTS asset_rental_term (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rental_no TEXT NOT NULL UNIQUE,
  tracked_asset_id INTEGER NOT NULL,
  rental_mode TEXT NOT NULL,
  project_id INTEGER,
  contract_id INTEGER,
  finance_mode TEXT NOT NULL DEFAULT 'contract',
  start_date TEXT NOT NULL,
  due_date TEXT NOT NULL,
  returned_date TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  note TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tracked_asset_id) REFERENCES tracked_asset(id),
  FOREIGN KEY (project_id) REFERENCES project(id)
);

CREATE INDEX IF NOT EXISTS idx_asset_rental_term_asset ON asset_rental_term(tracked_asset_id);
CREATE INDEX IF NOT EXISTS idx_asset_rental_term_project ON asset_rental_term(project_id);
CREATE INDEX IF NOT EXISTS idx_asset_rental_term_status ON asset_rental_term(status);
CREATE INDEX IF NOT EXISTS idx_asset_rental_term_due_date ON asset_rental_term(due_date);

ALTER TABLE stock_order ADD COLUMN rental_term_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_stock_order_rental_term_id ON stock_order(rental_term_id);
