CREATE TABLE IF NOT EXISTS reimbursement_invoice_review (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  envelope_id INTEGER NOT NULL,
  attachment_id INTEGER NOT NULL,
  review_round INTEGER NOT NULL DEFAULT 1,
  channel TEXT NOT NULL,
  task_id INTEGER,
  task_status TEXT NOT NULL DEFAULT 'pending',
  extraction_json TEXT,
  qr_text TEXT,
  qr_hash TEXT,
  invoice_unique_no TEXT,
  invoice_no TEXT,
  invoice_date TEXT,
  invoice_amount REAL,
  confidence REAL,
  source TEXT,
  risk_level TEXT NOT NULL DEFAULT 'low',
  risk_hint TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (envelope_id) REFERENCES reimbursement_envelope(id),
  FOREIGN KEY (attachment_id) REFERENCES envelope_attachment(id)
);

CREATE INDEX IF NOT EXISTS idx_reimbursement_invoice_review_envelope_round
  ON reimbursement_invoice_review(envelope_id, review_round, id);

CREATE INDEX IF NOT EXISTS idx_reimbursement_invoice_review_invoice_no_date
  ON reimbursement_invoice_review(invoice_no, invoice_date);

CREATE INDEX IF NOT EXISTS idx_reimbursement_invoice_review_qr_hash
  ON reimbursement_invoice_review(qr_hash);

CREATE INDEX IF NOT EXISTS idx_reimbursement_invoice_review_task
  ON reimbursement_invoice_review(task_id, task_status);
