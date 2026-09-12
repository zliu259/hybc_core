-- 0087_reimbursement_invoice_title.sql
-- 报销信封「发票抬头（购买方）」：OCR 预填 + 办公室修正 + 存量回填。
-- 背景：报销款须由发票抬头对应的我方主体支付；2026-09-11 RM-20260911-0001 混抬头成批被迫解散。
-- 回填数据源：reimbursement_invoice_review.extraction_json.buyer_name（0037 建表，runner ocr_extract 已输出）。
-- 两条 UPDATE 均带守卫，幂等；本地 mock 库无识别数据时自然空跑。

ALTER TABLE reimbursement_envelope ADD COLUMN invoice_title_entity_id INTEGER;
ALTER TABLE reimbursement_envelope ADD COLUMN invoice_title_name TEXT;
ALTER TABLE reimbursement_envelope ADD COLUMN invoice_title_source TEXT;
CREATE INDEX IF NOT EXISTS idx_reimbursement_envelope_invoice_title_entity_id
  ON reimbursement_envelope(invoice_title_entity_id);

ALTER TABLE reimbursement_batch ADD COLUMN invoice_title_entity_id INTEGER;
ALTER TABLE reimbursement_batch ADD COLUMN mixed_title_reason TEXT;

-- 回填 1：抬头原文（每个信封取最新一轮里 id 最小的非空 buyer_name 完成行，与运行时 pickBuyerNameFromReviews 的回退顺序一致）
UPDATE reimbursement_envelope
   SET invoice_title_name = (
         SELECT trim(json_extract(r.extraction_json, '$.buyer_name'))
           FROM reimbursement_invoice_review r
          WHERE r.envelope_id = reimbursement_envelope.id
            AND r.task_status = 'completed'
            AND json_valid(r.extraction_json)
            AND json_type(r.extraction_json, '$.buyer_name') = 'text'
            AND trim(json_extract(r.extraction_json, '$.buyer_name')) != ''
          ORDER BY r.review_round DESC, r.id ASC
          LIMIT 1
       ),
       invoice_title_source = 'ocr'
 WHERE status != 'deleted'
   AND invoice_title_source IS NULL
   AND EXISTS (
         SELECT 1
           FROM reimbursement_invoice_review r
          WHERE r.envelope_id = reimbursement_envelope.id
            AND r.task_status = 'completed'
            AND json_valid(r.extraction_json)
            AND json_type(r.extraction_json, '$.buyer_name') = 'text'
            AND trim(json_extract(r.extraction_json, '$.buyer_name')) != ''
       );

-- 回填 2：归一化（去半角/全角空格、半角括号转全角）后与 active 主体精确比对，恰好一个命中才写
UPDATE reimbursement_envelope
   SET invoice_title_entity_id = (
         SELECT e.id
           FROM entity e
          WHERE e.status = 'active'
            AND REPLACE(REPLACE(REPLACE(REPLACE(e.entity_name, ' ', ''), '　', ''), '(', '（'), ')', '）')
              = REPLACE(REPLACE(REPLACE(REPLACE(reimbursement_envelope.invoice_title_name, ' ', ''), '　', ''), '(', '（'), ')', '）')
          LIMIT 1
       )
 WHERE invoice_title_source = 'ocr'
   AND invoice_title_name IS NOT NULL
   AND invoice_title_entity_id IS NULL
   AND (
         SELECT COUNT(*)
           FROM entity e
          WHERE e.status = 'active'
            AND REPLACE(REPLACE(REPLACE(REPLACE(e.entity_name, ' ', ''), '　', ''), '(', '（'), ')', '）')
              = REPLACE(REPLACE(REPLACE(REPLACE(reimbursement_envelope.invoice_title_name, ' ', ''), '　', ''), '(', '（'), ')', '）')
       ) = 1;
