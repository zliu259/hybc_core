ALTER TABLE reimbursement_batch ADD COLUMN paid_at TEXT;
ALTER TABLE reimbursement_batch ADD COLUMN payment_reference TEXT;
ALTER TABLE reimbursement_batch ADD COLUMN payment_account TEXT;
ALTER TABLE reimbursement_batch ADD COLUMN payment_entity_id INTEGER;
ALTER TABLE reimbursement_batch ADD COLUMN payment_entity_bank_account_id INTEGER;
ALTER TABLE reimbursement_batch ADD COLUMN payment_vouchers_json TEXT;

CREATE INDEX IF NOT EXISTS idx_reimbursement_batch_payment_entity
  ON reimbursement_batch(payment_entity_id);

CREATE INDEX IF NOT EXISTS idx_reimbursement_batch_paid_at
  ON reimbursement_batch(paid_at);
