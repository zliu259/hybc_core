BEGIN TRANSACTION;

DELETE FROM approval_transfer
WHERE instance_id IN (SELECT id FROM approval_instance WHERE instance_no LIKE 'MOCK-AP-%');

DELETE FROM approval_initiator_action
WHERE instance_id IN (SELECT id FROM approval_instance WHERE instance_no LIKE 'MOCK-AP-%');

DELETE FROM approval_task
WHERE instance_id IN (SELECT id FROM approval_instance WHERE instance_no LIKE 'MOCK-AP-%');

DELETE FROM approval_node_instance
WHERE instance_id IN (SELECT id FROM approval_instance WHERE instance_no LIKE 'MOCK-AP-%');

UPDATE contract
SET approval_instance_id = NULL, updated_at = datetime('now')
WHERE contract_no LIKE 'MOCK-CT-%';

UPDATE payment_request
SET approval_instance_id = NULL, updated_at = datetime('now')
WHERE serial_no LIKE 'MOCK-PM-%';

UPDATE reimbursement_batch
SET approval_instance_id = NULL, updated_at = datetime('now')
WHERE batch_no LIKE 'MOCK-RB-%';

UPDATE reimbursement_envelope
SET approval_instance_id = NULL, updated_at = datetime('now')
WHERE envelope_no LIKE 'MOCK-RM-%';

UPDATE stock_order
SET approval_instance_id = NULL, updated_at = datetime('now')
WHERE order_no LIKE 'MOCK-SO-%';

DELETE FROM approval_instance WHERE instance_no LIKE 'MOCK-AP-%';

DELETE FROM manager_log_photo
WHERE manager_log_id IN (
  SELECT id FROM manager_log WHERE project_id IN (SELECT id FROM project WHERE project_code LIKE 'MOCK-%')
);

DELETE FROM site_survey_item
WHERE survey_id IN (
  SELECT id FROM site_survey WHERE project_id IN (SELECT id FROM project WHERE project_code LIKE 'MOCK-%')
);

DELETE FROM reimbursement_duplicate_check
WHERE envelope_id IN (SELECT id FROM reimbursement_envelope WHERE envelope_no LIKE 'MOCK-RM-%');

DELETE FROM reimbursement_duplicate_check
WHERE matched_envelope_id IN (SELECT id FROM reimbursement_envelope WHERE envelope_no LIKE 'MOCK-RM-%');

DELETE FROM reimbursement_batch_item
WHERE batch_id IN (SELECT id FROM reimbursement_batch WHERE batch_no LIKE 'MOCK-RB-%');

DELETE FROM reimbursement_batch_item
WHERE envelope_id IN (SELECT id FROM reimbursement_envelope WHERE envelope_no LIKE 'MOCK-RM-%');

DELETE FROM envelope_attachment
WHERE envelope_id IN (SELECT id FROM reimbursement_envelope WHERE envelope_no LIKE 'MOCK-RM-%');

DELETE FROM stock_order_item
WHERE stock_order_id IN (SELECT id FROM stock_order WHERE order_no LIKE 'MOCK-SO-%');

DELETE FROM project_equipment_plan_item
WHERE plan_id IN (SELECT id FROM project_equipment_plan WHERE plan_no LIKE 'MOCK-EP-%');

DELETE FROM tracked_asset_document
WHERE tracked_asset_id IN (
  SELECT id FROM tracked_asset WHERE asset_code LIKE 'MOCK-AT-%'
);

DELETE FROM tracked_asset_event
WHERE tracked_asset_id IN (
  SELECT id FROM tracked_asset WHERE asset_code LIKE 'MOCK-AT-%'
);

DELETE FROM inventory_consumption
WHERE warehouse_id IN (SELECT id FROM warehouse WHERE warehouse_code LIKE 'MOCK-WH-%');

DELETE FROM inventory
WHERE warehouse_id IN (SELECT id FROM warehouse WHERE warehouse_code LIKE 'MOCK-WH-%');

DELETE FROM task_queue
WHERE task_code LIKE 'MOCK-TASK-%';

DELETE FROM ai_audit_log
WHERE biz_id IN (
  SELECT id FROM payment_request WHERE serial_no LIKE 'MOCK-PM-%'
);

DELETE FROM ai_routing_rule
WHERE rule_name LIKE 'MOCK-%';

DELETE FROM ai_prompt_template
WHERE template_key LIKE 'mock_%';

DELETE FROM ai_provider_config
WHERE provider_key LIKE 'mock_%';

DELETE FROM compute_node
WHERE node_id LIKE 'mock-node-%';

DELETE FROM receipt WHERE receipt_no LIKE 'MOCK-RC-%';
DELETE FROM invoice WHERE invoice_no LIKE 'MOCK-IV-%';
DELETE FROM payment_request WHERE serial_no LIKE 'MOCK-PM-%';
DELETE FROM contract_amount_change WHERE reason LIKE '%[mock-seed]%';
DELETE FROM contract WHERE contract_no LIKE 'MOCK-CT-%';
DELETE FROM payee WHERE created_by_userid = 'mock-seed';

DELETE FROM reimbursement_batch WHERE batch_no LIKE 'MOCK-RB-%';
DELETE FROM reimbursement_envelope WHERE envelope_no LIKE 'MOCK-RM-%';

DELETE FROM project_equipment_plan WHERE plan_no LIKE 'MOCK-EP-%';
DELETE FROM stock_order WHERE order_no LIKE 'MOCK-SO-%';

DELETE FROM tracked_asset WHERE asset_code LIKE 'MOCK-AT-%';
DELETE FROM asset_type WHERE type_code LIKE 'MOCK-TYPE-%';
DELETE FROM warehouse WHERE warehouse_code LIKE 'MOCK-WH-%';

DELETE FROM operator_log WHERE project_id IN (SELECT id FROM project WHERE project_code LIKE 'MOCK-%');
DELETE FROM manager_log WHERE project_id IN (SELECT id FROM project WHERE project_code LIKE 'MOCK-%');
DELETE FROM breakthrough_report WHERE report_no LIKE 'MOCK-GT-%';
DELETE FROM site_survey WHERE project_id IN (SELECT id FROM project WHERE project_code LIKE 'MOCK-%');

DELETE FROM project_section WHERE project_id IN (SELECT id FROM project WHERE project_code LIKE 'MOCK-%');
DELETE FROM project WHERE project_code LIKE 'MOCK-%';

DELETE FROM entity_invoice_profile WHERE entity_id IN (SELECT id FROM entity WHERE entity_code LIKE 'MOCK-ENT-%');
DELETE FROM entity_bank_account WHERE entity_id IN (SELECT id FROM entity WHERE entity_code LIKE 'MOCK-ENT-%');
DELETE FROM entity WHERE entity_code LIKE 'MOCK-ENT-%';

INSERT INTO entity (entity_code, entity_name, legal_person, status, created_at, updated_at) VALUES
('MOCK-ENT-LAB', 'Mock 劳务公司', '张测试', 'active', datetime('now'), datetime('now')),
('MOCK-ENT-MEC', 'Mock 机械公司', '李测试', 'active', datetime('now'), datetime('now')),
('MOCK-ENT-MUN', 'Mock 市政公司', '王测试', 'active', datetime('now'), datetime('now'));

INSERT INTO entity_bank_account (entity_id, bank_name, account_name, account_no, status, created_at, updated_at)
SELECT id, '中国银行东莞分行', entity_name || '基本户', '6222-0000-0000-' || printf('%04d', id), 'active', datetime('now'), datetime('now')
FROM entity WHERE entity_code LIKE 'MOCK-ENT-%';

INSERT INTO entity_invoice_profile (entity_id, invoice_title, tax_no, address, phone, bank_name, bank_account, created_at, updated_at)
SELECT
  id,
  entity_name || '（开票抬头）',
  '91441900MOCK' || printf('%04d', id),
  '东莞市南城街道测试路' || printf('%02d', id) || '号',
  '0769-8888' || printf('%04d', id),
  '中国银行东莞分行',
  '6222-0000-0000-' || printf('%04d', id),
  datetime('now'),
  datetime('now')
FROM entity WHERE entity_code LIKE 'MOCK-ENT-%';

INSERT INTO project (project_code, project_name, entity_id, manager_userid, status, start_date, end_date, created_at, updated_at)
VALUES
('MOCK-PJ-001', 'Mock 松山湖顶管一期', (SELECT id FROM entity WHERE entity_code = 'MOCK-ENT-LAB'), 'manager', 'active', '2025-11-01', '2026-12-31', datetime('now'), datetime('now')),
('MOCK-PJ-002', 'Mock 南城雨污分流改造', (SELECT id FROM entity WHERE entity_code = 'MOCK-ENT-MEC'), 'site_manager', 'preparing', '2026-01-10', '2026-10-30', datetime('now'), datetime('now')),
('MOCK-PJ-003', 'Mock 万江管网修复工程', (SELECT id FROM entity WHERE entity_code = 'MOCK-ENT-MUN'), 'manager', 'completing', '2025-03-01', '2026-05-31', datetime('now'), datetime('now'));

INSERT INTO project_section (project_id, section_code, section_name, section_length, status, created_at, updated_at)
VALUES
((SELECT id FROM project WHERE project_code = 'MOCK-PJ-001'), 'S1', '松山湖北段', 1250.0, 'active', datetime('now'), datetime('now')),
((SELECT id FROM project WHERE project_code = 'MOCK-PJ-001'), 'S2', '松山湖南段', 980.0, 'active', datetime('now'), datetime('now')),
((SELECT id FROM project WHERE project_code = 'MOCK-PJ-002'), 'A1', '南城主干道', 760.0, 'preparing', datetime('now'), datetime('now')),
((SELECT id FROM project WHERE project_code = 'MOCK-PJ-003'), 'W1', '万江老城区', 640.0, 'completing', datetime('now'), datetime('now'));

INSERT INTO payee (name, bank_name, bank_account, phone, type, status, created_by_userid, created_at, updated_at)
VALUES
('Mock 材料供应商A', '建设银行东莞分行', '6217-0000-0000-1101', '13800001101', 'external', 'active', 'mock-seed', datetime('now'), datetime('now')),
('Mock 劳务队B', '工商银行东莞分行', '6212-0000-0000-2202', '13800002202', 'external', 'active', 'mock-seed', datetime('now'), datetime('now')),
('Mock 机械租赁C', '农业银行东莞分行', '6228-0000-0000-3303', '13800003303', 'external', 'active', 'mock-seed', datetime('now'), datetime('now'));

INSERT INTO contract (
  contract_no, direction, project_id, entity_id, counterparty, contract_type, handler_userid,
  contract_date, total_amount, paid_amount, invoiced_amount, received_amount,
  status, ai_review_status, ai_review_result, attachments_json, remark, created_at, updated_at
) VALUES
(
  'MOCK-CT-20260220-0001', 'outbound',
  (SELECT id FROM project WHERE project_code = 'MOCK-PJ-001'),
  (SELECT id FROM entity WHERE entity_code = 'MOCK-ENT-LAB'),
  'Mock 材料供应商A', 'material', 'manager', '2026-02-01',
  1200000, 380000, 0, 0,
  'active', 'completed',
  '{"overall_risk":"low","summary":"mock contract review pass"}',
  '["mock/contracts/ct-0001.pdf"]',
  '[mock-seed] outbound active contract', datetime('now'), datetime('now')
),
(
  'MOCK-CT-20260220-0002', 'outbound',
  (SELECT id FROM project WHERE project_code = 'MOCK-PJ-002'),
  (SELECT id FROM entity WHERE entity_code = 'MOCK-ENT-MEC'),
  'Mock 劳务队B', 'labor', 'site_manager', '2026-02-05',
  460000, 0, 0, 0,
  'pending_approval', 'pending', NULL,
  '["mock/contracts/ct-0002.pdf"]',
  '[mock-seed] outbound pending approval', datetime('now'), datetime('now')
),
(
  'MOCK-CT-20260220-0003', 'inbound',
  (SELECT id FROM project WHERE project_code = 'MOCK-PJ-003'),
  (SELECT id FROM entity WHERE entity_code = 'MOCK-ENT-MUN'),
  'Mock 市政甲方D', 'general', 'manager', '2026-01-18',
  800000, 0, 350000, 220000,
  'active', 'none', NULL,
  '["mock/contracts/ct-0003.pdf"]',
  '[mock-seed] inbound active contract', datetime('now'), datetime('now')
),
(
  'MOCK-CT-20260220-0004', 'outbound',
  (SELECT id FROM project WHERE project_code = 'MOCK-PJ-001'),
  (SELECT id FROM entity WHERE entity_code = 'MOCK-ENT-LAB'),
  'Mock 机械租赁C', 'machinery', 'manager', '2025-09-10',
  300000, 300000, 0, 0,
  'completed', 'completed',
  '{"overall_risk":"low","summary":"historical contract"}',
  '["mock/contracts/ct-0004.pdf"]',
  '[mock-seed] completed historical contract', datetime('now'), datetime('now')
);

INSERT INTO payment_request (
  serial_no, contract_id, project_id, applicant_userid, expected_payment_date, category, payee_id,
  amount, amount_cn, content, payment_method, status, approval_instance_id,
  ai_risk_status, ai_risk_result, attachments_json, remark, created_at, updated_at
) VALUES
(
  'MOCK-PM-20260220-0001',
  (SELECT id FROM contract WHERE contract_no = 'MOCK-CT-20260220-0001'),
  (SELECT id FROM project WHERE project_code = 'MOCK-PJ-001'),
  'site_manager', '2026-02-12', '材料费',
  (SELECT id FROM payee WHERE name = 'Mock 材料供应商A'),
  200000, '贰拾万元整', '钢筋混凝土管采购第一批', '银行转账', 'paid', NULL,
  'completed', '{"overall_risk":"low","summary":"normal"}',
  '["mock/payment/pm-0001.pdf"]', '[mock-seed] paid sample', datetime('now'), datetime('now')
),
(
  'MOCK-PM-20260220-0002',
  (SELECT id FROM contract WHERE contract_no = 'MOCK-CT-20260220-0001'),
  (SELECT id FROM project WHERE project_code = 'MOCK-PJ-001'),
  'site_manager', '2026-02-18', '机械费',
  (SELECT id FROM payee WHERE name = 'Mock 机械租赁C'),
  180000, '壹拾捌万元整', '顶管机租赁费二期', '银行转账', 'paid', NULL,
  'completed', '{"overall_risk":"low","summary":"normal"}',
  '["mock/payment/pm-0002.pdf"]', '[mock-seed] paid sample', datetime('now'), datetime('now')
),
(
  'MOCK-PM-20260220-0003',
  (SELECT id FROM contract WHERE contract_no = 'MOCK-CT-20260220-0001'),
  (SELECT id FROM project WHERE project_code = 'MOCK-PJ-001'),
  'site_manager', '2026-02-25', '劳务费',
  (SELECT id FROM payee WHERE name = 'Mock 劳务队B'),
  120000, '壹拾贰万元整', '劳务班组月度结算', '银行转账', 'approved', NULL,
  'completed', '{"overall_risk":"medium","summary":"need invoice follow-up"}',
  '["mock/payment/pm-0003.pdf"]', '[mock-seed] approved sample', datetime('now'), datetime('now')
),
(
  'MOCK-PM-20260220-0004',
  (SELECT id FROM contract WHERE contract_no = 'MOCK-CT-20260220-0002'),
  (SELECT id FROM project WHERE project_code = 'MOCK-PJ-002'),
  'site_manager', '2026-02-28', '材料费',
  (SELECT id FROM payee WHERE name = 'Mock 材料供应商A'),
  90000, '玖万元整', '项目准备期材料预付款', '银行转账', 'pending_approval', NULL,
  'pending', NULL,
  '["mock/payment/pm-0004.pdf"]', '[mock-seed] pending approval sample', datetime('now'), datetime('now')
);

INSERT INTO contract_amount_change (
  contract_id, change_type, old_amount, new_amount, reason, status, approval_instance_id, applicant_userid, created_at, updated_at
) VALUES
(
  (SELECT id FROM contract WHERE contract_no = 'MOCK-CT-20260220-0001'),
  'increase', 1200000, 1320000,
  '[mock-seed] 管材价格上涨导致合同增补',
  'approved', NULL, 'manager', datetime('now'), datetime('now')
),
(
  (SELECT id FROM contract WHERE contract_no = 'MOCK-CT-20260220-0003'),
  'adjust', 800000, 780000,
  '[mock-seed] 结算折扣调整',
  'pending', NULL, 'manager', datetime('now'), datetime('now')
);

INSERT INTO invoice (
  invoice_no, contract_id, project_id, issuer_userid, issue_date, amount, title, tax_no, file_key, status, remark, created_at, updated_at
) VALUES
(
  'MOCK-IV-20260220-0001',
  (SELECT id FROM contract WHERE contract_no = 'MOCK-CT-20260220-0003'),
  (SELECT id FROM project WHERE project_code = 'MOCK-PJ-003'),
  'manager', '2026-02-03', 200000,
  'Mock 市政甲方D 工程款发票', '91320000MOCKD001',
  'mock/invoice/iv-0001.pdf', 'issued', '[mock-seed] inbound invoice', datetime('now'), datetime('now')
),
(
  'MOCK-IV-20260220-0002',
  (SELECT id FROM contract WHERE contract_no = 'MOCK-CT-20260220-0003'),
  (SELECT id FROM project WHERE project_code = 'MOCK-PJ-003'),
  'manager', '2026-02-15', 150000,
  'Mock 市政甲方D 工程款发票（二期）', '91320000MOCKD001',
  'mock/invoice/iv-0002.pdf', 'issued', '[mock-seed] inbound invoice', datetime('now'), datetime('now')
);

INSERT INTO receipt (
  receipt_no, contract_id, project_id, invoice_id, receiver_userid, received_date, amount, payment_account, status, remark, created_at, updated_at
) VALUES
(
  'MOCK-RC-20260220-0001',
  (SELECT id FROM contract WHERE contract_no = 'MOCK-CT-20260220-0003'),
  (SELECT id FROM project WHERE project_code = 'MOCK-PJ-003'),
  (SELECT id FROM invoice WHERE invoice_no = 'MOCK-IV-20260220-0001'),
  'manager', '2026-02-10', 220000,
  '中国银行东莞分行-市政公司基本户', 'recorded', '[mock-seed] inbound receipt', datetime('now'), datetime('now')
);

INSERT INTO reimbursement_batch (
  batch_no, project_id, applicant_userid, total_amount, item_count, status,
  ai_audit_status, ai_audit_result, approval_instance_id, created_at, updated_at
) VALUES
(
  'MOCK-RB-20260220-0001',
  (SELECT id FROM project WHERE project_code = 'MOCK-PJ-001'),
  'operator', 8600, 2, 'approved',
  'completed', '{"risk":"low","summary":"no severe duplicate"}', NULL,
  datetime('now'), datetime('now')
),
(
  'MOCK-RB-20260220-0002',
  (SELECT id FROM project WHERE project_code = 'MOCK-PJ-002'),
  'operator', 4300, 1, 'pending_approval',
  'completed', '{"risk":"medium","summary":"await manager check"}', NULL,
  datetime('now'), datetime('now')
);

INSERT INTO reimbursement_envelope (
  envelope_no, envelope_uuid, project_id, applicant_userid, channel, invoice_no, expense_date, amount,
  category, description, status, precheck_status, precheck_comment, verification_status, verification_note,
  batch_id, approval_instance_id, pdf_task_id, pdf_status, pdf_file_key,
  ocr_task_id, ocr_status, duplicate_check_status, submitted_at, received_at, created_at, updated_at
) VALUES
(
  'MOCK-RM-20260220-0001', '11111111-1111-4111-8111-111111111111',
  (SELECT id FROM project WHERE project_code = 'MOCK-PJ-001'),
  'operator', 'physical', 'FP-MOCK-001', '2026-02-11', 3600,
  '材料费', '砂石辅料采购', 'paid', 'approved', '票据齐全', 'verified', '实物票据一致',
  (SELECT id FROM reimbursement_batch WHERE batch_no = 'MOCK-RB-20260220-0001'),
  NULL, NULL, 'completed', 'mock/reimburse/rm-0001.pdf',
  NULL, 'none', 'completed', '2026-02-12T09:00:00.000Z', '2026-02-12T16:00:00.000Z', datetime('now'), datetime('now')
),
(
  'MOCK-RM-20260220-0002', '22222222-2222-4222-8222-222222222222',
  (SELECT id FROM project WHERE project_code = 'MOCK-PJ-001'),
  'operator', 'electronic', 'FP-MOCK-002', '2026-02-13', 5000,
  '机械费', '油料与配件', 'paid', 'approved', 'OCR一致', 'verified', '电子票据核验通过',
  (SELECT id FROM reimbursement_batch WHERE batch_no = 'MOCK-RB-20260220-0001'),
  NULL, NULL, 'completed', 'mock/reimburse/rm-0002.pdf',
  NULL, 'completed', 'completed', '2026-02-13T08:30:00.000Z', '2026-02-13T15:20:00.000Z', datetime('now'), datetime('now')
),
(
  'MOCK-RM-20260220-0003', '33333333-3333-4333-8333-333333333333',
  (SELECT id FROM project WHERE project_code = 'MOCK-PJ-002'),
  'operator', 'electronic', 'FP-MOCK-003', '2026-02-16', 4300,
  '劳务费', '班组交通与补助', 'pending_approval', 'approved', '待批次审批', 'verified', '电子票据有效',
  (SELECT id FROM reimbursement_batch WHERE batch_no = 'MOCK-RB-20260220-0002'),
  NULL, NULL, 'none', NULL,
  NULL, 'completed', 'completed', '2026-02-16T10:00:00.000Z', '2026-02-16T15:00:00.000Z', datetime('now'), datetime('now')
),
(
  'MOCK-RM-20260220-0004', '44444444-4444-4444-8444-444444444444',
  (SELECT id FROM project WHERE project_code = 'MOCK-PJ-002'),
  'operator', 'physical', 'FP-MOCK-003', '2026-02-17', 4300,
  '劳务费', '用于查重中心展示的重复样本', 'submitted', 'pending', '待初审', 'pending', NULL,
  NULL, NULL, NULL, 'none', NULL,
  NULL, 'none', 'pending', '2026-02-17T09:30:00.000Z', NULL, datetime('now'), datetime('now')
);

INSERT INTO envelope_attachment (
  envelope_id, attachment_type, file_key, file_name, file_size, invoice_no, amount, issue_date, status, created_at
) VALUES
((SELECT id FROM reimbursement_envelope WHERE envelope_no = 'MOCK-RM-20260220-0001'), 'invoice', 'mock/reimburse/att-rm-0001-a.jpg', 'rm-0001-a.jpg', 122223, 'FP-MOCK-001', 3600, '2026-02-11', 'active', datetime('now')),
((SELECT id FROM reimbursement_envelope WHERE envelope_no = 'MOCK-RM-20260220-0002'), 'invoice', 'mock/reimburse/att-rm-0002-a.jpg', 'rm-0002-a.jpg', 143110, 'FP-MOCK-002', 5000, '2026-02-13', 'active', datetime('now')),
((SELECT id FROM reimbursement_envelope WHERE envelope_no = 'MOCK-RM-20260220-0003'), 'invoice', 'mock/reimburse/att-rm-0003-a.jpg', 'rm-0003-a.jpg', 110432, 'FP-MOCK-003', 4300, '2026-02-16', 'active', datetime('now')),
((SELECT id FROM reimbursement_envelope WHERE envelope_no = 'MOCK-RM-20260220-0004'), 'invoice', 'mock/reimburse/att-rm-0004-a.jpg', 'rm-0004-a.jpg', 106543, 'FP-MOCK-003', 4300, '2026-02-17', 'active', datetime('now'));

INSERT INTO reimbursement_batch_item (batch_id, envelope_id, amount, status, created_at) VALUES
((SELECT id FROM reimbursement_batch WHERE batch_no = 'MOCK-RB-20260220-0001'), (SELECT id FROM reimbursement_envelope WHERE envelope_no = 'MOCK-RM-20260220-0001'), 3600, 'active', datetime('now')),
((SELECT id FROM reimbursement_batch WHERE batch_no = 'MOCK-RB-20260220-0001'), (SELECT id FROM reimbursement_envelope WHERE envelope_no = 'MOCK-RM-20260220-0002'), 5000, 'active', datetime('now')),
((SELECT id FROM reimbursement_batch WHERE batch_no = 'MOCK-RB-20260220-0002'), (SELECT id FROM reimbursement_envelope WHERE envelope_no = 'MOCK-RM-20260220-0003'), 4300, 'active', datetime('now'));

INSERT INTO reimbursement_duplicate_check (
  envelope_id, matched_envelope_id, matched_invoice_no, match_type, match_score, risk_level, summary, evidence_json, created_at
) VALUES
(
  (SELECT id FROM reimbursement_envelope WHERE envelope_no = 'MOCK-RM-20260220-0004'),
  (SELECT id FROM reimbursement_envelope WHERE envelope_no = 'MOCK-RM-20260220-0003'),
  'FP-MOCK-003', 'exact', 1.0, 'high', '发票号完全重复（mock）',
  '{"source":"mock-seed","rule":"same-invoice-no"}', datetime('now')
),
(
  (SELECT id FROM reimbursement_envelope WHERE envelope_no = 'MOCK-RM-20260220-0004'),
  (SELECT id FROM reimbursement_envelope WHERE envelope_no = 'MOCK-RM-20260220-0001'),
  'FP-MOCK-001', 'fuzzy', 0.62, 'medium', '金额接近，需人工复核（mock）',
  '{"source":"mock-seed","rule":"fuzzy-amount"}', datetime('now')
);

INSERT INTO warehouse (warehouse_code, warehouse_name, location, manager_userid, status, remark, created_at, updated_at)
VALUES
('MOCK-WH-MAIN', 'Mock 主仓', '东莞南城仓储中心', 'site_manager', 'active', '[mock-seed] 主仓', datetime('now'), datetime('now')),
('MOCK-WH-SUB', 'Mock 分仓', '松山湖临时堆场', 'site_manager', 'active', '[mock-seed] 分仓', datetime('now'), datetime('now'));

INSERT INTO asset_type (type_code, type_name, tracked_flag, unit, property_schema, min_stock, status, created_at, updated_at)
VALUES
('MOCK-TYPE-TBM', 'Mock 盾构设备', 1, '台', '{"fields":[{"key":"power","label":"功率(kW)","type":"number"},{"key":"diameter","label":"管径(mm)","type":"number"}]}', 1, 'active', datetime('now'), datetime('now')),
('MOCK-TYPE-PIPE', 'Mock 管材', 0, '根', NULL, 80, 'active', datetime('now'), datetime('now')),
('MOCK-TYPE-OIL', 'Mock 液压油', 0, '桶', NULL, 25, 'active', datetime('now'), datetime('now'));

INSERT INTO tracked_asset (
  asset_code, asset_type_id, asset_name, brand, model, serial_no, status,
  current_project_id, current_warehouse_id, current_location, properties_json, purchased_date, created_at, updated_at
) VALUES
(
  'MOCK-AT-TBM-0001', (SELECT id FROM asset_type WHERE type_code = 'MOCK-TYPE-TBM'),
  'Mock 盾构机1号', 'HY-MOCK', 'TBM-1800', 'TBM-MOCK-0001',
  'using', (SELECT id FROM project WHERE project_code = 'MOCK-PJ-001'),
  NULL, 'project', '{"power":560,"diameter":1800}', '2025-08-01', datetime('now'), datetime('now')
),
(
  'MOCK-AT-TBM-0002', (SELECT id FROM asset_type WHERE type_code = 'MOCK-TYPE-TBM'),
  'Mock 盾构机2号', 'HY-MOCK', 'TBM-2200', 'TBM-MOCK-0002',
  'idle', NULL,
  (SELECT id FROM warehouse WHERE warehouse_code = 'MOCK-WH-MAIN'), 'warehouse', '{"power":620,"diameter":2200}', '2025-10-20', datetime('now'), datetime('now')
);

INSERT INTO tracked_asset_document (tracked_asset_id, doc_type, file_key, file_name, remark, status, created_at)
VALUES
((SELECT id FROM tracked_asset WHERE asset_code = 'MOCK-AT-TBM-0001'), 'manual', 'mock/assets/tbm-0001-manual.pdf', 'tbm-0001-manual.pdf', '设备说明书', 'active', datetime('now')),
((SELECT id FROM tracked_asset WHERE asset_code = 'MOCK-AT-TBM-0001'), 'maintenance', 'mock/assets/tbm-0001-maintenance.pdf', 'tbm-0001-maintenance.pdf', '维保记录', 'active', datetime('now'));

INSERT INTO tracked_asset_event (
  tracked_asset_id, event_type, event_time, operator_userid, project_id, warehouse_id, detail, created_at
) VALUES
((SELECT id FROM tracked_asset WHERE asset_code = 'MOCK-AT-TBM-0001'), 'assign_project', '2026-02-01T09:00:00.000Z', 'site_manager', (SELECT id FROM project WHERE project_code = 'MOCK-PJ-001'), NULL, '调拨至项目现场', datetime('now')),
((SELECT id FROM tracked_asset WHERE asset_code = 'MOCK-AT-TBM-0001'), 'maintenance', '2026-02-14T13:30:00.000Z', 'site_manager', (SELECT id FROM project WHERE project_code = 'MOCK-PJ-001'), NULL, '保养检修完成', datetime('now'));

INSERT INTO inventory (warehouse_id, asset_type_id, quantity, min_stock, status, updated_at)
VALUES
((SELECT id FROM warehouse WHERE warehouse_code = 'MOCK-WH-MAIN'), (SELECT id FROM asset_type WHERE type_code = 'MOCK-TYPE-PIPE'), 120, 100, 'active', datetime('now')),
((SELECT id FROM warehouse WHERE warehouse_code = 'MOCK-WH-MAIN'), (SELECT id FROM asset_type WHERE type_code = 'MOCK-TYPE-OIL'), 18, 25, 'active', datetime('now')),
((SELECT id FROM warehouse WHERE warehouse_code = 'MOCK-WH-SUB'), (SELECT id FROM asset_type WHERE type_code = 'MOCK-TYPE-PIPE'), 35, 40, 'active', datetime('now'));

INSERT INTO stock_order (
  order_no, order_type, project_id, from_warehouse_id, to_warehouse_id,
  applicant_userid, status, approval_instance_id, executed_at, remark, created_at, updated_at
) VALUES
(
  'MOCK-SO-20260220-0001', 'outbound',
  (SELECT id FROM project WHERE project_code = 'MOCK-PJ-001'),
  (SELECT id FROM warehouse WHERE warehouse_code = 'MOCK-WH-MAIN'), NULL,
  'site_manager', 'executed', NULL, '2026-02-18T10:20:00.000Z', '[mock-seed] 已执行出库单', datetime('now'), datetime('now')
),
(
  'MOCK-SO-20260220-0002', 'transfer',
  NULL,
  (SELECT id FROM warehouse WHERE warehouse_code = 'MOCK-WH-MAIN'),
  (SELECT id FROM warehouse WHERE warehouse_code = 'MOCK-WH-SUB'),
  'site_manager', 'pending_approval', NULL, NULL, '[mock-seed] 待审批调拨单', datetime('now'), datetime('now')
);

INSERT INTO stock_order_item (
  stock_order_id, asset_type_id, tracked_asset_id, quantity, unit, remark, status, created_at
) VALUES
(
  (SELECT id FROM stock_order WHERE order_no = 'MOCK-SO-20260220-0001'),
  (SELECT id FROM asset_type WHERE type_code = 'MOCK-TYPE-PIPE'),
  NULL, 24, '根', '项目一出库', 'active', datetime('now')
),
(
  (SELECT id FROM stock_order WHERE order_no = 'MOCK-SO-20260220-0002'),
  (SELECT id FROM asset_type WHERE type_code = 'MOCK-TYPE-OIL'),
  NULL, 8, '桶', '主仓调拨到分仓', 'active', datetime('now')
);

INSERT INTO project_equipment_plan (
  plan_no, project_id, applicant_userid, plan_status, ai_status, ai_task_id,
  recommendation_result_json, stock_order_id, remark, created_at, updated_at
) VALUES
(
  'MOCK-EP-20260220-0001',
  (SELECT id FROM project WHERE project_code = 'MOCK-PJ-002'),
  'site_manager', 'confirmed', 'completed', NULL,
  '{"items":[{"asset_type":"MOCK-TYPE-PIPE","planned_qty":60,"recommended_qty":68}],"summary":"提前备料"}',
  (SELECT id FROM stock_order WHERE order_no = 'MOCK-SO-20260220-0002'),
  '[mock-seed] AI 推荐已确认', datetime('now'), datetime('now')
);

INSERT INTO project_equipment_plan_item (
  plan_id, asset_type_id, planned_qty, recommended_qty, source, note, created_at
) VALUES
(
  (SELECT id FROM project_equipment_plan WHERE plan_no = 'MOCK-EP-20260220-0001'),
  (SELECT id FROM asset_type WHERE type_code = 'MOCK-TYPE-PIPE'),
  60, 68, 'ai', '根据历史消耗上调', datetime('now')
),
(
  (SELECT id FROM project_equipment_plan WHERE plan_no = 'MOCK-EP-20260220-0001'),
  (SELECT id FROM asset_type WHERE type_code = 'MOCK-TYPE-OIL'),
  12, 14, 'ai', '保养周期补充', datetime('now')
);

INSERT INTO inventory_consumption (
  warehouse_id, project_id, asset_type_id, quantity, consumed_date, recorder_userid, remark, created_at
) VALUES
(
  (SELECT id FROM warehouse WHERE warehouse_code = 'MOCK-WH-MAIN'),
  (SELECT id FROM project WHERE project_code = 'MOCK-PJ-001'),
  (SELECT id FROM asset_type WHERE type_code = 'MOCK-TYPE-PIPE'),
  10, '2026-02-15', 'operator', '日常施工消耗', datetime('now')
),
(
  (SELECT id FROM warehouse WHERE warehouse_code = 'MOCK-WH-MAIN'),
  (SELECT id FROM project WHERE project_code = 'MOCK-PJ-001'),
  (SELECT id FROM asset_type WHERE type_code = 'MOCK-TYPE-OIL'),
  3, '2026-02-16', 'operator', '设备保养消耗', datetime('now')
);

INSERT INTO operator_log (
  project_id, section_id, log_date, shift, weather,
  completed_pipe_count, cumulative_pipe_count, footage_m, issue_summary, remark,
  operator_userid, status, created_at, updated_at
) VALUES
(
  (SELECT id FROM project WHERE project_code = 'MOCK-PJ-001'),
  (SELECT id FROM project_section WHERE project_id = (SELECT id FROM project WHERE project_code = 'MOCK-PJ-001') AND section_code = 'S1'),
  '2026-02-18', 'day', '晴', 4, 128, 42.5,
  '渗水点已处理', '推进正常', 'operator', 'submitted', datetime('now'), datetime('now')
),
(
  (SELECT id FROM project WHERE project_code = 'MOCK-PJ-001'),
  (SELECT id FROM project_section WHERE project_id = (SELECT id FROM project WHERE project_code = 'MOCK-PJ-001') AND section_code = 'S1'),
  '2026-02-18', 'night', '多云', 3, 131, 31.0,
  '夜间设备振动偏大，已复检', '需持续观察', 'operator', 'submitted', datetime('now'), datetime('now')
);

INSERT INTO manager_log (
  project_id, log_date, title, detail_html, risk_note, manager_userid, status, created_at, updated_at
) VALUES
(
  (SELECT id FROM project WHERE project_code = 'MOCK-PJ-001'),
  '2026-02-18',
  'Mock 项目经理日报',
  '<p>本日推进平稳，设备保养完成。</p>',
  '次日关注夜间振动趋势',
  'site_manager',
  'submitted',
  datetime('now'), datetime('now')
);

INSERT INTO manager_log_photo (manager_log_id, file_key, caption, sort_order, status, created_at)
VALUES
(
  (SELECT id FROM manager_log WHERE title = 'Mock 项目经理日报'),
  'mock/log/manager-photo-001.jpg',
  '现场推进照片',
  0,
  'active',
  datetime('now')
);

INSERT INTO breakthrough_report (
  report_no, project_id, section_id, report_date, breakthrough_m, summary, detail, reporter_userid, status, created_at, updated_at
) VALUES
(
  'MOCK-GT-20260220-0001',
  (SELECT id FROM project WHERE project_code = 'MOCK-PJ-001'),
  (SELECT id FROM project_section WHERE project_id = (SELECT id FROM project WHERE project_code = 'MOCK-PJ-001') AND section_code = 'S2'),
  '2026-02-19', 18.2, '本周完成关键贯通节点', '围岩稳定，参数正常', 'site_manager', 'submitted', datetime('now'), datetime('now')
);

INSERT INTO site_survey (
  project_id, survey_date, location, weather, summary, surveyor_userid, status, created_at, updated_at
) VALUES
(
  (SELECT id FROM project WHERE project_code = 'MOCK-PJ-002'),
  '2026-02-17',
  '南城主干道K12+300',
  '阴',
  '交通导改点位与临时排水沟复核',
  'site_manager',
  'submitted',
  datetime('now'), datetime('now')
);

INSERT INTO site_survey_item (survey_id, item_name, item_value, remark, created_at)
VALUES
(
  (SELECT id FROM site_survey WHERE project_id = (SELECT id FROM project WHERE project_code = 'MOCK-PJ-002') ORDER BY id DESC LIMIT 1),
  '土质情况',
  '粉质黏土',
  '需加强支护',
  datetime('now')
),
(
  (SELECT id FROM site_survey WHERE project_id = (SELECT id FROM project WHERE project_code = 'MOCK-PJ-002') ORDER BY id DESC LIMIT 1),
  '地下水位',
  '2.1m',
  '较上周上升0.3m',
  datetime('now')
);

INSERT INTO ai_provider_config (
  provider_key, provider_name, api_endpoint, model_id, config_json, priority, max_concurrent, status, created_at, updated_at
) VALUES
(
  'mock_local_rules',
  'Mock Local Rules Engine',
  'local://mock-rules',
  'mock-rules-v1',
  '{"mode":"deterministic"}',
  1, 10, 'active', datetime('now'), datetime('now')
);

INSERT INTO ai_prompt_template (
  template_key, template_name, system_prompt, user_prompt_template, variables_schema, version, status, created_at, updated_at
) VALUES
(
  'mock_reimbursement_audit',
  'Mock 报销审计模板',
  '你是财务审计助手。',
  '请分析批次 {{batch_no}} 的风险。',
  '{"type":"object","properties":{"batch_no":{"type":"string"}}}',
  1, 'active', datetime('now'), datetime('now')
);

INSERT INTO ai_routing_rule (
  rule_name, biz_type, task_type, condition_json, provider_id, prompt_template_id, priority, status, created_at, updated_at
) VALUES
(
  'MOCK-Reimbursement-Audit-Rule',
  'reimbursement_batch',
  'reimbursement_check',
  '{"project_scope":"mock"}',
  (SELECT id FROM ai_provider_config WHERE provider_key = 'mock_local_rules'),
  (SELECT id FROM ai_prompt_template WHERE template_key = 'mock_reimbursement_audit'),
  1,
  'active',
  datetime('now'), datetime('now')
);

INSERT INTO compute_node (
  node_id, node_name, node_type, capabilities_json, status, cpu_cores, memory_mb, last_heartbeat_at, registered_at, created_at, updated_at
) VALUES
(
  'mock-node-primary',
  'Mock Primary Node',
  'docker',
  '["contract_review","payment_risk_assessment","reimbursement_check"]',
  'online',
  8,
  16384,
  datetime('now'),
  datetime('now'),
  datetime('now'),
  datetime('now')
);

INSERT INTO task_queue (
  task_code, task_type, biz_type, biz_id, priority, payload_json, provider_id,
  assigned_node_id, status, max_retries, retry_count, timeout_seconds,
  result_json, error_message, assigned_at, started_at, completed_at, created_at, updated_at
) VALUES
(
  'MOCK-TASK-20260220-0001',
  'payment_risk_assessment',
  'payment_request',
  (SELECT id FROM payment_request WHERE serial_no = 'MOCK-PM-20260220-0004'),
  3,
  '{"source":"mock-seed","request":"risk-eval"}',
  (SELECT id FROM ai_provider_config WHERE provider_key = 'mock_local_rules'),
  'mock-node-primary',
  'completed',
  3, 0, 300,
  '{"output":"{\"overall_risk\":\"medium\",\"summary\":\"mock pending approval\"}"}',
  NULL,
  datetime('now'), datetime('now'), datetime('now'), datetime('now'), datetime('now')
),
(
  'MOCK-TASK-20260220-0002',
  'reimbursement_check',
  'reimbursement_batch',
  (SELECT id FROM reimbursement_batch WHERE batch_no = 'MOCK-RB-20260220-0002'),
  4,
  '{"source":"mock-seed","request":"batch-audit"}',
  (SELECT id FROM ai_provider_config WHERE provider_key = 'mock_local_rules'),
  'mock-node-primary',
  'completed',
  3, 0, 600,
  '{"output":"{\"risk\":\"medium\",\"summary\":\"duplicate invoice detected\"}"}',
  NULL,
  datetime('now'), datetime('now'), datetime('now'), datetime('now'), datetime('now')
);

INSERT INTO ai_audit_log (
  task_id, biz_type, biz_id, provider_key, model_id, prompt_hash, input_summary,
  output_summary, tokens_input, tokens_output, latency_ms, status, error_message,
  compute_node_id, created_at
) VALUES
(
  (SELECT id FROM task_queue WHERE task_code = 'MOCK-TASK-20260220-0001'),
  'payment_request',
  (SELECT id FROM payment_request WHERE serial_no = 'MOCK-PM-20260220-0004'),
  'mock_local_rules', 'mock-rules-v1', 'mock-hash-1',
  'payment request risk assess input', 'risk medium',
  480, 210, 920, 'success', NULL, 'mock-node-primary', datetime('now')
),
(
  (SELECT id FROM task_queue WHERE task_code = 'MOCK-TASK-20260220-0002'),
  'reimbursement_batch',
  (SELECT id FROM reimbursement_batch WHERE batch_no = 'MOCK-RB-20260220-0002'),
  'mock_local_rules', 'mock-rules-v1', 'mock-hash-2',
  'batch audit input', 'duplicate detected',
  620, 300, 1430, 'success', NULL, 'mock-node-primary', datetime('now')
);

INSERT INTO approval_instance (
  instance_no, template_id, biz_type, biz_id, biz_summary, initiator_userid,
  current_node_key, status, current_round, submitted_at, completed_at, created_at, updated_at, instance_config_json
) VALUES
(
  'MOCK-AP-20260220-0001',
  (SELECT id FROM approval_template WHERE template_code = 'TPL-OUTBOUND-CONTRACT'),
  'outbound_contract',
  (SELECT id FROM contract WHERE contract_no = 'MOCK-CT-20260220-0002'),
  'Mock 合同待审批',
  'site_manager',
  'finance_review',
  'in_progress',
  1,
  datetime('now'),
  NULL,
  datetime('now'), datetime('now'),
  '{"default_assignee_userids":["manager","finance_manager"]}'
),
(
  'MOCK-AP-20260220-0002',
  (SELECT id FROM approval_template WHERE template_code = 'TPL-PAYMENT-REQUEST'),
  'payment_request',
  (SELECT id FROM payment_request WHERE serial_no = 'MOCK-PM-20260220-0004'),
  'Mock 付款申请待审批',
  'site_manager',
  'dept_approve',
  'pending',
  1,
  datetime('now'),
  NULL,
  datetime('now'), datetime('now'),
  '{"default_assignee_userids":["site_manager"]}'
),
(
  'MOCK-AP-20260220-0003',
  (SELECT id FROM approval_template WHERE template_code = 'TPL-REIMBURSEMENT-BATCH'),
  'reimbursement_batch',
  (SELECT id FROM reimbursement_batch WHERE batch_no = 'MOCK-RB-20260220-0002'),
  'Mock 报销批次待审批',
  'operator',
  'dept_review',
  'pending',
  1,
  datetime('now'),
  NULL,
  datetime('now'), datetime('now'),
  '{"default_assignee_userids":["site_manager"]}'
),
(
  'MOCK-AP-20260220-0004',
  (SELECT id FROM approval_template WHERE template_code = 'TPL-STOCK-ORDER'),
  'stock_order',
  (SELECT id FROM stock_order WHERE order_no = 'MOCK-SO-20260220-0002'),
  'Mock 调拨单待审批',
  'site_manager',
  'warehouse_review',
  'pending',
  1,
  datetime('now'),
  NULL,
  datetime('now'), datetime('now'),
  '{"default_assignee_userids":["site_manager"]}'
);

INSERT INTO approval_node_instance (
  instance_id, node_key, node_type, node_name, assignee_userids,
  status, round, sort_order, started_at, completed_at, created_at, updated_at, timeout_hours
) VALUES
(
  (SELECT id FROM approval_instance WHERE instance_no = 'MOCK-AP-20260220-0001'),
  'finance_review', 'sequential', '财务复核', '["finance_manager"]',
  'in_progress', 1, 1, datetime('now'), NULL, datetime('now'), datetime('now'), 24
),
(
  (SELECT id FROM approval_instance WHERE instance_no = 'MOCK-AP-20260220-0002'),
  'dept_approve', 'sequential', '部门负责人审批', '["site_manager"]',
  'pending', 1, 1, NULL, NULL, datetime('now'), datetime('now'), 24
),
(
  (SELECT id FROM approval_instance WHERE instance_no = 'MOCK-AP-20260220-0003'),
  'dept_review', 'sequential', '部门负责人审批', '["site_manager"]',
  'pending', 1, 1, NULL, NULL, datetime('now'), datetime('now'), 24
),
(
  (SELECT id FROM approval_instance WHERE instance_no = 'MOCK-AP-20260220-0004'),
  'warehouse_review', 'sequential', '仓库负责人审核', '["site_manager"]',
  'pending', 1, 1, NULL, NULL, datetime('now'), datetime('now'), 24
);

INSERT INTO approval_task (
  node_instance_id, instance_id, assignee_userid, action, comment, round, status, acted_at, created_at, updated_at
) VALUES
(
  (SELECT id FROM approval_node_instance WHERE instance_id = (SELECT id FROM approval_instance WHERE instance_no = 'MOCK-AP-20260220-0001') AND node_key = 'finance_review'),
  (SELECT id FROM approval_instance WHERE instance_no = 'MOCK-AP-20260220-0001'),
  'finance_manager', NULL, NULL, 1, 'pending', NULL, datetime('now'), datetime('now')
),
(
  (SELECT id FROM approval_node_instance WHERE instance_id = (SELECT id FROM approval_instance WHERE instance_no = 'MOCK-AP-20260220-0002') AND node_key = 'dept_approve'),
  (SELECT id FROM approval_instance WHERE instance_no = 'MOCK-AP-20260220-0002'),
  'site_manager', NULL, NULL, 1, 'pending', NULL, datetime('now'), datetime('now')
),
(
  (SELECT id FROM approval_node_instance WHERE instance_id = (SELECT id FROM approval_instance WHERE instance_no = 'MOCK-AP-20260220-0003') AND node_key = 'dept_review'),
  (SELECT id FROM approval_instance WHERE instance_no = 'MOCK-AP-20260220-0003'),
  'site_manager', NULL, NULL, 1, 'pending', NULL, datetime('now'), datetime('now')
),
(
  (SELECT id FROM approval_node_instance WHERE instance_id = (SELECT id FROM approval_instance WHERE instance_no = 'MOCK-AP-20260220-0004') AND node_key = 'warehouse_review'),
  (SELECT id FROM approval_instance WHERE instance_no = 'MOCK-AP-20260220-0004'),
  'site_manager', NULL, NULL, 1, 'pending', NULL, datetime('now'), datetime('now')
);

INSERT INTO approval_initiator_action (instance_id, action, userid, comment, created_at)
VALUES
(
  (SELECT id FROM approval_instance WHERE instance_no = 'MOCK-AP-20260220-0001'),
  'submit', 'site_manager', 'mock seed submit contract approval', datetime('now')
),
(
  (SELECT id FROM approval_instance WHERE instance_no = 'MOCK-AP-20260220-0002'),
  'submit', 'site_manager', 'mock seed submit payment approval', datetime('now')
),
(
  (SELECT id FROM approval_instance WHERE instance_no = 'MOCK-AP-20260220-0003'),
  'submit', 'operator', 'mock seed submit reimbursement batch approval', datetime('now')
),
(
  (SELECT id FROM approval_instance WHERE instance_no = 'MOCK-AP-20260220-0004'),
  'submit', 'site_manager', 'mock seed submit stock order approval', datetime('now')
);

UPDATE contract
SET approval_instance_id = (SELECT id FROM approval_instance WHERE instance_no = 'MOCK-AP-20260220-0001'),
    updated_at = datetime('now')
WHERE contract_no = 'MOCK-CT-20260220-0002';

UPDATE payment_request
SET approval_instance_id = (SELECT id FROM approval_instance WHERE instance_no = 'MOCK-AP-20260220-0002'),
    updated_at = datetime('now')
WHERE serial_no = 'MOCK-PM-20260220-0004';

UPDATE reimbursement_batch
SET approval_instance_id = (SELECT id FROM approval_instance WHERE instance_no = 'MOCK-AP-20260220-0003'),
    updated_at = datetime('now')
WHERE batch_no = 'MOCK-RB-20260220-0002';

UPDATE reimbursement_envelope
SET approval_instance_id = (SELECT id FROM approval_instance WHERE instance_no = 'MOCK-AP-20260220-0003'),
    updated_at = datetime('now')
WHERE envelope_no = 'MOCK-RM-20260220-0003';

UPDATE stock_order
SET approval_instance_id = (SELECT id FROM approval_instance WHERE instance_no = 'MOCK-AP-20260220-0004'),
    updated_at = datetime('now')
WHERE order_no = 'MOCK-SO-20260220-0002';

COMMIT;
