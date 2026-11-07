-- 同一单同一附件同一轮只能有一条识别记录。
-- 旧代码在 failed 行上重建时会插入同轮第二行：保留最新一行，其余挪到负数轮次，不删数据。
UPDATE reimbursement_invoice_review
   SET review_round = -id
 WHERE id NOT IN (
   SELECT MAX(id) FROM reimbursement_invoice_review
    GROUP BY envelope_id, attachment_id, review_round
 );

CREATE UNIQUE INDEX IF NOT EXISTS idx_reimbursement_invoice_review_attachment_round
  ON reimbursement_invoice_review(envelope_id, attachment_id, review_round);
