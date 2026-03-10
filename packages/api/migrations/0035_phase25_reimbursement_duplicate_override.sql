ALTER TABLE reimbursement_envelope ADD COLUMN invoice_unique_no TEXT;
ALTER TABLE reimbursement_envelope ADD COLUMN duplicate_override_requested INTEGER NOT NULL DEFAULT 0;
ALTER TABLE reimbursement_envelope ADD COLUMN duplicate_override_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_reimbursement_invoice_unique_no
  ON reimbursement_envelope(invoice_unique_no);
