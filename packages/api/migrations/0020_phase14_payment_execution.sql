ALTER TABLE payment_request ADD COLUMN paid_at TEXT;
ALTER TABLE payment_request ADD COLUMN paid_by_userid TEXT;
ALTER TABLE payment_request ADD COLUMN payment_reference TEXT;
ALTER TABLE payment_request ADD COLUMN payment_account TEXT;

CREATE INDEX IF NOT EXISTS idx_payment_request_paid_at ON payment_request(paid_at);
