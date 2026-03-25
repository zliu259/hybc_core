ALTER TABLE reimbursement_envelope ADD COLUMN ocr_result_json TEXT;
ALTER TABLE reimbursement_envelope ADD COLUMN ocr_invoice_unique_no_hint TEXT;
ALTER TABLE reimbursement_envelope ADD COLUMN ocr_invoice_no_hint TEXT;
ALTER TABLE reimbursement_envelope ADD COLUMN ocr_expense_date_hint TEXT;
ALTER TABLE reimbursement_envelope ADD COLUMN silent_review_result TEXT;

CREATE TABLE IF NOT EXISTS api_idempotency_request (
  scope TEXT NOT NULL,
  actor_key TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  response_json TEXT,
  status_code INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (scope, actor_key, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_api_idempotency_created_at
  ON api_idempotency_request(created_at);

CREATE TABLE IF NOT EXISTS api_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_userid TEXT,
  actor_roles_json TEXT,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'success',
  detail_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_api_audit_log_target
  ON api_audit_log(target_type, target_id, created_at);

CREATE INDEX IF NOT EXISTS idx_api_audit_log_actor
  ON api_audit_log(actor_userid, created_at);

CREATE TABLE IF NOT EXISTS api_rate_limit_bucket (
  scope TEXT NOT NULL,
  actor_key TEXT NOT NULL,
  window_key TEXT NOT NULL,
  hit_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (scope, actor_key, window_key)
);

CREATE INDEX IF NOT EXISTS idx_api_rate_limit_updated_at
  ON api_rate_limit_bucket(updated_at);
