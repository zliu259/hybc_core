-- 报销拆单溯源：记录新单由哪张原单拆出、拆单原因
ALTER TABLE reimbursement_envelope ADD COLUMN split_from_envelope_id INTEGER;
ALTER TABLE reimbursement_envelope ADD COLUMN split_reason TEXT;
CREATE INDEX idx_reimbursement_split_from ON reimbursement_envelope(split_from_envelope_id);
