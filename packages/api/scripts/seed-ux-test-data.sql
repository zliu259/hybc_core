PRAGMA foreign_keys = OFF;

DELETE FROM project_equipment_plan_item
WHERE plan_id IN (SELECT id FROM project_equipment_plan WHERE plan_no LIKE 'UX-%');

DELETE FROM stock_order_item
WHERE stock_order_id IN (SELECT id FROM stock_order WHERE order_no LIKE 'UX-%');

DELETE FROM reimbursement_batch_item
WHERE batch_id IN (SELECT id FROM reimbursement_batch WHERE batch_no LIKE 'UX-%')
   OR envelope_id IN (SELECT id FROM reimbursement_envelope WHERE envelope_no LIKE 'UX-%');

DELETE FROM envelope_attachment
WHERE envelope_id IN (SELECT id FROM reimbursement_envelope WHERE envelope_no LIKE 'UX-%');

DELETE FROM reimbursement_duplicate_check
WHERE envelope_id IN (SELECT id FROM reimbursement_envelope WHERE envelope_no LIKE 'UX-%')
   OR matched_envelope_id IN (SELECT id FROM reimbursement_envelope WHERE envelope_no LIKE 'UX-%');

DELETE FROM inventory
WHERE warehouse_id IN (SELECT id FROM warehouse WHERE warehouse_code LIKE 'UX-%');

DELETE FROM inventory_consumption
WHERE warehouse_id IN (SELECT id FROM warehouse WHERE warehouse_code LIKE 'UX-%');

DELETE FROM tracked_asset_document
WHERE tracked_asset_id IN (SELECT id FROM tracked_asset WHERE asset_code LIKE 'UX-%');

DELETE FROM tracked_asset_event
WHERE tracked_asset_id IN (SELECT id FROM tracked_asset WHERE asset_code LIKE 'UX-%');

DELETE FROM project_equipment_plan WHERE plan_no LIKE 'UX-%';
DELETE FROM stock_order WHERE order_no LIKE 'UX-%';
DELETE FROM reimbursement_envelope WHERE envelope_no LIKE 'UX-%';
DELETE FROM reimbursement_batch WHERE batch_no LIKE 'UX-%';
DELETE FROM payment_request WHERE serial_no LIKE 'UX-%';
DELETE FROM contract_amount_change WHERE reason LIKE '%[ux-seed]%';
DELETE FROM contract WHERE contract_no LIKE 'UX-%';

DELETE FROM payee
WHERE created_by_userid = 'ux-seed' OR name LIKE 'UX Test %';

DELETE FROM tracked_asset WHERE asset_code LIKE 'UX-%';
DELETE FROM asset_type WHERE type_code LIKE 'UX-%';
DELETE FROM warehouse WHERE warehouse_code LIKE 'UX-%';

DELETE FROM project_section
WHERE project_id IN (SELECT id FROM project WHERE project_code LIKE 'UX-%');

DELETE FROM project WHERE project_code LIKE 'UX-%';

DELETE FROM entity_invoice_profile
WHERE entity_id IN (SELECT id FROM entity WHERE entity_code LIKE 'UX-%');

DELETE FROM entity_bank_account
WHERE entity_id IN (SELECT id FROM entity WHERE entity_code LIKE 'UX-%');

DELETE FROM entity WHERE entity_code LIKE 'UX-%';

INSERT INTO entity (
  entity_code,
  entity_name,
  legal_person,
  status,
  created_at,
  updated_at
) VALUES (
  'UX-ENT-001',
  'UX Test 施工主体公司',
  '刘测试',
  'active',
  datetime('now'),
  datetime('now')
);

INSERT INTO entity_bank_account (
  entity_id,
  bank_name,
  account_name,
  account_no,
  status,
  created_at,
  updated_at
)
VALUES (
  (SELECT id FROM entity WHERE entity_code = 'UX-ENT-001'),
  '中国银行东莞分行',
  'UX Test 施工主体公司基本户',
  '6222000000009001',
  'active',
  datetime('now'),
  datetime('now')
);

INSERT INTO entity_invoice_profile (
  entity_id,
  invoice_title,
  tax_no,
  address,
  phone,
  bank_name,
  bank_account,
  created_at,
  updated_at
)
VALUES (
  (SELECT id FROM entity WHERE entity_code = 'UX-ENT-001'),
  'UX Test 施工主体公司',
  '91441900UXTEST0001',
  '东莞市南城街道测试路18号',
  '0769-80001234',
  '中国银行东莞分行',
  '6222000000009001',
  datetime('now'),
  datetime('now')
);

INSERT INTO project (
  project_code,
  project_name,
  entity_id,
  manager_userid,
  status,
  start_date,
  end_date,
  created_at,
  updated_at
) VALUES (
  'UX-PJ-001',
  'UX Test 松山湖示例项目',
  (SELECT id FROM entity WHERE entity_code = 'UX-ENT-001'),
  'site_manager',
  'active',
  '2026-03-01',
  '2026-12-31',
  datetime('now'),
  datetime('now')
);

INSERT INTO project_section (
  project_id,
  section_code,
  section_name,
  section_length,
  status,
  created_at,
  updated_at
) VALUES (
  (SELECT id FROM project WHERE project_code = 'UX-PJ-001'),
  'UX-S1',
  'UX 测试区段',
  320.5,
  'active',
  datetime('now'),
  datetime('now')
);

INSERT INTO payee (
  name,
  bank_name,
  bank_account,
  phone,
  type,
  status,
  created_by_userid,
  created_at,
  updated_at
) VALUES (
  'UX Test 供应商A',
  '建设银行东莞分行',
  '6217000000009001',
  '13800009001',
  'external',
  'active',
  'ux-seed',
  datetime('now'),
  datetime('now')
);

INSERT INTO contract (
  contract_no,
  direction,
  project_id,
  entity_id,
  counterparty,
  contract_type,
  handler_userid,
  contract_date,
  total_amount,
  paid_amount,
  invoiced_amount,
  received_amount,
  status,
  ai_review_status,
  ai_review_result,
  attachments_json,
  remark,
  created_at,
  updated_at
) VALUES (
  'UX-CT-20260303-0001',
  'outbound',
  (SELECT id FROM project WHERE project_code = 'UX-PJ-001'),
  (SELECT id FROM entity WHERE entity_code = 'UX-ENT-001'),
  'UX Test 供应商A',
  'material',
  'site_manager',
  '2026-03-03',
  580000,
  0,
  0,
  0,
  'draft',
  'none',
  NULL,
  '["ux/contracts/ux-ct-0001.pdf"]',
  '[ux-seed] outbound contract at flow start',
  datetime('now'),
  datetime('now')
);

INSERT INTO payment_request (
  serial_no,
  contract_id,
  project_id,
  applicant_userid,
  expected_payment_date,
  category,
  payee_id,
  amount,
  amount_cn,
  content,
  payment_method,
  status,
  approval_instance_id,
  ai_risk_status,
  ai_risk_result,
  attachments_json,
  remark,
  created_at,
  updated_at
) VALUES (
  'UX-PM-20260303-0001',
  (SELECT id FROM contract WHERE contract_no = 'UX-CT-20260303-0001'),
  (SELECT id FROM project WHERE project_code = 'UX-PJ-001'),
  'site_manager',
  '2026-03-08',
  '材料费',
  (SELECT id FROM payee WHERE name = 'UX Test 供应商A'),
  68000,
  '陆万捌仟元整',
  'UX 测试材料首批采购 [ux-seed]',
  '银行转账',
  'draft',
  NULL,
  'none',
  NULL,
  '["ux/payment/ux-pm-0001.pdf"]',
  '[ux-seed] payment request at flow start',
  datetime('now'),
  datetime('now')
);

INSERT INTO reimbursement_batch (
  batch_no,
  project_id,
  applicant_userid,
  total_amount,
  item_count,
  status,
  ai_audit_status,
  ai_audit_result,
  approval_instance_id,
  created_at,
  updated_at
) VALUES (
  'UX-RB-20260303-0001',
  (SELECT id FROM project WHERE project_code = 'UX-PJ-001'),
  'operator',
  1200,
  1,
  'draft',
  'none',
  NULL,
  NULL,
  datetime('now'),
  datetime('now')
);

INSERT INTO reimbursement_envelope (
  envelope_no,
  envelope_uuid,
  project_id,
  applicant_userid,
  channel,
  invoice_no,
  expense_date,
  amount,
  category,
  description,
  status,
  precheck_status,
  precheck_comment,
  verification_status,
  verification_note,
  batch_id,
  approval_instance_id,
  pdf_task_id,
  pdf_status,
  pdf_file_key,
  ocr_task_id,
  ocr_status,
  duplicate_check_status,
  submitted_at,
  received_at,
  created_at,
  updated_at
) VALUES (
  'UX-RM-20260303-0001',
  '7f1f18e0-cf7f-49d0-b6f4-622f208f4a31',
  (SELECT id FROM project WHERE project_code = 'UX-PJ-001'),
  'operator',
  'electronic',
  'UX-FP-0001',
  '2026-03-02',
  1200,
  '行政费',
  'UX 测试差旅报销 [ux-seed]',
  'draft',
  'none',
  NULL,
  'pending',
  NULL,
  (SELECT id FROM reimbursement_batch WHERE batch_no = 'UX-RB-20260303-0001'),
  NULL,
  NULL,
  'none',
  NULL,
  NULL,
  'none',
  'none',
  NULL,
  NULL,
  datetime('now'),
  datetime('now')
);

INSERT INTO envelope_attachment (
  envelope_id,
  attachment_type,
  file_key,
  file_name,
  file_size,
  invoice_no,
  amount,
  issue_date,
  status,
  created_at
) VALUES (
  (SELECT id FROM reimbursement_envelope WHERE envelope_no = 'UX-RM-20260303-0001'),
  'invoice',
  'ux/reimburse/ux-rm-0001.jpg',
  'ux-rm-0001.jpg',
  102400,
  'UX-FP-0001',
  1200,
  '2026-03-02',
  'active',
  datetime('now')
);

INSERT INTO reimbursement_batch_item (
  batch_id,
  envelope_id,
  amount,
  status,
  created_at
) VALUES (
  (SELECT id FROM reimbursement_batch WHERE batch_no = 'UX-RB-20260303-0001'),
  (SELECT id FROM reimbursement_envelope WHERE envelope_no = 'UX-RM-20260303-0001'),
  1200,
  'active',
  datetime('now')
);

INSERT INTO warehouse (
  warehouse_code,
  warehouse_name,
  location,
  manager_userid,
  status,
  remark,
  created_at,
  updated_at
) VALUES (
  'UX-WH-001',
  'UX 测试仓',
  '东莞南城测试仓',
  'site_manager',
  'active',
  '[ux-seed] warehouse for UX flows',
  datetime('now'),
  datetime('now')
);

INSERT INTO asset_type (
  type_code,
  type_name,
  tracked_flag,
  unit,
  property_schema,
  min_stock,
  status,
  created_at,
  updated_at
) VALUES (
  'UX-TYPE-PIPE',
  'UX 测试管材',
  0,
  '根',
  NULL,
  20,
  'active',
  datetime('now'),
  datetime('now')
);

INSERT INTO inventory (
  warehouse_id,
  asset_type_id,
  quantity,
  min_stock,
  status,
  updated_at
) VALUES (
  (SELECT id FROM warehouse WHERE warehouse_code = 'UX-WH-001'),
  (SELECT id FROM asset_type WHERE type_code = 'UX-TYPE-PIPE'),
  55,
  20,
  'active',
  datetime('now')
);

INSERT INTO stock_order (
  order_no,
  order_type,
  project_id,
  from_warehouse_id,
  to_warehouse_id,
  applicant_userid,
  status,
  approval_instance_id,
  executed_at,
  remark,
  created_at,
  updated_at
) VALUES (
  'UX-SO-20260303-0001',
  'outbound',
  (SELECT id FROM project WHERE project_code = 'UX-PJ-001'),
  (SELECT id FROM warehouse WHERE warehouse_code = 'UX-WH-001'),
  NULL,
  'site_manager',
  'draft',
  NULL,
  NULL,
  '[ux-seed] stock order at flow start',
  datetime('now'),
  datetime('now')
);

INSERT INTO stock_order_item (
  stock_order_id,
  asset_type_id,
  tracked_asset_id,
  quantity,
  unit,
  remark,
  status,
  created_at
) VALUES (
  (SELECT id FROM stock_order WHERE order_no = 'UX-SO-20260303-0001'),
  (SELECT id FROM asset_type WHERE type_code = 'UX-TYPE-PIPE'),
  NULL,
  12,
  '根',
  'UX 测试出库明细',
  'active',
  datetime('now')
);

INSERT INTO project_equipment_plan (
  plan_no,
  project_id,
  applicant_userid,
  plan_status,
  ai_status,
  ai_task_id,
  recommendation_result_json,
  stock_order_id,
  remark,
  created_at,
  updated_at
) VALUES (
  'UX-EP-20260303-0001',
  (SELECT id FROM project WHERE project_code = 'UX-PJ-001'),
  'site_manager',
  'draft',
  'none',
  NULL,
  NULL,
  (SELECT id FROM stock_order WHERE order_no = 'UX-SO-20260303-0001'),
  '[ux-seed] equipment plan at start',
  datetime('now'),
  datetime('now')
);

INSERT INTO project_equipment_plan_item (
  plan_id,
  asset_type_id,
  planned_qty,
  recommended_qty,
  source,
  note,
  created_at
) VALUES (
  (SELECT id FROM project_equipment_plan WHERE plan_no = 'UX-EP-20260303-0001'),
  (SELECT id FROM asset_type WHERE type_code = 'UX-TYPE-PIPE'),
  15,
  NULL,
  'manual',
  'UX 手动录入计划',
  datetime('now')
);

PRAGMA foreign_keys = ON;
