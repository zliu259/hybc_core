CREATE TABLE IF NOT EXISTS reimbursement_envelope (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  envelope_no TEXT NOT NULL UNIQUE,
  envelope_uuid TEXT NOT NULL UNIQUE,
  project_id INTEGER NOT NULL,
  applicant_userid TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'physical',
  invoice_no TEXT,
  expense_date TEXT,
  amount REAL NOT NULL DEFAULT 0,
  category TEXT,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  precheck_status TEXT NOT NULL DEFAULT 'none',
  precheck_comment TEXT,
  verification_status TEXT NOT NULL DEFAULT 'pending',
  verification_note TEXT,
  batch_id INTEGER,
  approval_instance_id INTEGER,
  pdf_task_id INTEGER,
  pdf_status TEXT NOT NULL DEFAULT 'none',
  pdf_file_key TEXT,
  ocr_task_id INTEGER,
  ocr_status TEXT NOT NULL DEFAULT 'none',
  duplicate_check_status TEXT NOT NULL DEFAULT 'none',
  submitted_at TEXT,
  received_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (batch_id) REFERENCES reimbursement_batch(id)
);

CREATE INDEX idx_reimbursement_envelope_no ON reimbursement_envelope(envelope_no);
CREATE INDEX idx_reimbursement_envelope_uuid ON reimbursement_envelope(envelope_uuid);
CREATE INDEX idx_reimbursement_project_id ON reimbursement_envelope(project_id);
CREATE INDEX idx_reimbursement_status ON reimbursement_envelope(status);
CREATE INDEX idx_reimbursement_applicant ON reimbursement_envelope(applicant_userid);
CREATE INDEX idx_reimbursement_invoice_no ON reimbursement_envelope(invoice_no);

CREATE TABLE IF NOT EXISTS envelope_attachment (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  envelope_id INTEGER NOT NULL,
  attachment_type TEXT NOT NULL DEFAULT 'invoice',
  file_key TEXT NOT NULL,
  file_name TEXT,
  file_size INTEGER,
  invoice_no TEXT,
  amount REAL,
  issue_date TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  FOREIGN KEY (envelope_id) REFERENCES reimbursement_envelope(id)
);

CREATE INDEX idx_envelope_attachment_envelope_id ON envelope_attachment(envelope_id);
CREATE INDEX idx_envelope_attachment_invoice_no ON envelope_attachment(invoice_no);

CREATE TABLE IF NOT EXISTS reimbursement_batch (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_no TEXT NOT NULL UNIQUE,
  project_id INTEGER NOT NULL,
  applicant_userid TEXT NOT NULL,
  total_amount REAL NOT NULL DEFAULT 0,
  item_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  ai_audit_status TEXT NOT NULL DEFAULT 'none',
  ai_audit_result TEXT,
  approval_instance_id INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_reimbursement_batch_no ON reimbursement_batch(batch_no);
CREATE INDEX idx_reimbursement_batch_status ON reimbursement_batch(status);
CREATE INDEX idx_reimbursement_batch_applicant ON reimbursement_batch(applicant_userid);

CREATE TABLE IF NOT EXISTS reimbursement_batch_item (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id INTEGER NOT NULL,
  envelope_id INTEGER NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  FOREIGN KEY (batch_id) REFERENCES reimbursement_batch(id),
  FOREIGN KEY (envelope_id) REFERENCES reimbursement_envelope(id),
  UNIQUE (batch_id, envelope_id)
);

CREATE INDEX idx_reimbursement_batch_item_batch_id ON reimbursement_batch_item(batch_id);
CREATE INDEX idx_reimbursement_batch_item_envelope_id ON reimbursement_batch_item(envelope_id);

CREATE TABLE IF NOT EXISTS reimbursement_duplicate_check (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  envelope_id INTEGER NOT NULL,
  matched_envelope_id INTEGER,
  matched_invoice_no TEXT,
  match_type TEXT NOT NULL,
  match_score REAL,
  risk_level TEXT NOT NULL DEFAULT 'low',
  summary TEXT,
  evidence_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (envelope_id) REFERENCES reimbursement_envelope(id),
  FOREIGN KEY (matched_envelope_id) REFERENCES reimbursement_envelope(id)
);

CREATE INDEX idx_reimbursement_duplicate_envelope ON reimbursement_duplicate_check(envelope_id);
CREATE INDEX idx_reimbursement_duplicate_risk_level ON reimbursement_duplicate_check(risk_level);
