ALTER TABLE receipt ADD COLUMN receiver_entity_id INTEGER;
ALTER TABLE receipt ADD COLUMN receiver_account_id INTEGER;
ALTER TABLE receipt ADD COLUMN vouchers_json TEXT;

CREATE INDEX IF NOT EXISTS idx_receipt_receiver_entity_id ON receipt(receiver_entity_id);
CREATE INDEX IF NOT EXISTS idx_receipt_receiver_account_id ON receipt(receiver_account_id);

CREATE TABLE IF NOT EXISTS receipt_refund (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  refund_no TEXT NOT NULL UNIQUE,
  receipt_id INTEGER NOT NULL,
  contract_id INTEGER NOT NULL,
  project_id INTEGER NOT NULL,
  invoice_id INTEGER,
  applicant_userid TEXT NOT NULL,
  refund_mode TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  approval_instance_id INTEGER,
  requires_red_invoice INTEGER NOT NULL DEFAULT 0,
  red_invoice_status TEXT NOT NULL DEFAULT 'none',
  reason TEXT,
  remark TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (receipt_id) REFERENCES receipt(id),
  FOREIGN KEY (contract_id) REFERENCES contract(id),
  FOREIGN KEY (invoice_id) REFERENCES invoice(id)
);

CREATE INDEX IF NOT EXISTS idx_receipt_refund_receipt_id ON receipt_refund(receipt_id);
CREATE INDEX IF NOT EXISTS idx_receipt_refund_contract_id ON receipt_refund(contract_id);
CREATE INDEX IF NOT EXISTS idx_receipt_refund_status ON receipt_refund(status);
CREATE INDEX IF NOT EXISTS idx_receipt_refund_approval_instance_id ON receipt_refund(approval_instance_id);
