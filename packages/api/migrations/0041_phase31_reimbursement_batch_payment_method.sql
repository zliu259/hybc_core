ALTER TABLE reimbursement_batch ADD COLUMN payment_method TEXT;

CREATE INDEX IF NOT EXISTS idx_reimbursement_batch_payment_method
ON reimbursement_batch(payment_method);
