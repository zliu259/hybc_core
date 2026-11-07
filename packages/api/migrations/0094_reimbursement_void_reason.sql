-- 废止时保存原因。历史单和批量废止没有原因，页面只显示「不再流转。」
ALTER TABLE reimbursement_envelope ADD COLUMN void_reason TEXT;
