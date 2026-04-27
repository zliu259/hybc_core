-- Phase 31: 报销批次 — 被报销人收款人 + 付款建议（送审环节非必填，由审批人补录）
-- 设计要点：
-- 1. 全部 ADD COLUMN，可空，不破坏存量数据
-- 2. 建议值（proposed）独立于 mark-paid 写入的最终值，便于审计
-- 3. payee.linked_userid 用于按 WeCom userid 匹配内部收款人候选

ALTER TABLE payee ADD COLUMN linked_userid TEXT;
CREATE INDEX IF NOT EXISTS idx_payee_linked_userid ON payee(linked_userid);

ALTER TABLE reimbursement_batch ADD COLUMN payee_id INTEGER;
ALTER TABLE reimbursement_batch ADD COLUMN payment_entity_proposed_id INTEGER;
ALTER TABLE reimbursement_batch ADD COLUMN payment_entity_bank_account_proposed_id INTEGER;
ALTER TABLE reimbursement_batch ADD COLUMN proposed_payment_updated_by TEXT;
ALTER TABLE reimbursement_batch ADD COLUMN proposed_payment_updated_at TEXT;

CREATE INDEX IF NOT EXISTS idx_reimbursement_batch_payee_id
  ON reimbursement_batch(payee_id);
CREATE INDEX IF NOT EXISTS idx_reimbursement_batch_payment_entity_proposed
  ON reimbursement_batch(payment_entity_proposed_id);
