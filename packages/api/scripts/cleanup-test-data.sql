PRAGMA foreign_keys = OFF;

UPDATE contract
SET approval_instance_id = NULL, updated_at = datetime('now')
WHERE contract_no LIKE 'MOCK-%'
   OR contract_no LIKE 'UX-%'
   OR remark LIKE '%[mock-seed]%'
   OR remark LIKE '%[ux-seed]%';

UPDATE payment_request
SET approval_instance_id = NULL, updated_at = datetime('now')
WHERE serial_no LIKE 'MOCK-%'
   OR serial_no LIKE 'UX-%'
   OR content LIKE '%Prod E2E%'
   OR content LIKE '%[ux-seed]%';

UPDATE reimbursement_batch
SET approval_instance_id = NULL, updated_at = datetime('now')
WHERE batch_no LIKE 'MOCK-%' OR batch_no LIKE 'UX-%';

UPDATE reimbursement_envelope
SET approval_instance_id = NULL, updated_at = datetime('now')
WHERE envelope_no LIKE 'MOCK-%' OR envelope_no LIKE 'UX-%';

UPDATE stock_order
SET approval_instance_id = NULL, updated_at = datetime('now')
WHERE order_no LIKE 'MOCK-%' OR order_no LIKE 'UX-%';

DELETE FROM approval_transfer
WHERE instance_id IN (
  SELECT id FROM approval_instance
  WHERE instance_no LIKE 'MOCK-%'
     OR instance_no LIKE 'UX-%'
     OR id = 5
);

DELETE FROM approval_task
WHERE instance_id IN (
  SELECT id FROM approval_instance
  WHERE instance_no LIKE 'MOCK-%'
     OR instance_no LIKE 'UX-%'
     OR id = 5
);

DELETE FROM approval_initiator_action
WHERE instance_id IN (
  SELECT id FROM approval_instance
  WHERE instance_no LIKE 'MOCK-%'
     OR instance_no LIKE 'UX-%'
     OR id = 5
);

DELETE FROM approval_node_instance
WHERE instance_id IN (
  SELECT id FROM approval_instance
  WHERE instance_no LIKE 'MOCK-%'
     OR instance_no LIKE 'UX-%'
     OR id = 5
);

DELETE FROM approval_instance
WHERE instance_no LIKE 'MOCK-%'
   OR instance_no LIKE 'UX-%'
   OR id = 5;

DELETE FROM manager_log_photo
WHERE manager_log_id IN (
  SELECT id FROM manager_log
  WHERE project_id IN (
    SELECT id FROM project
    WHERE project_code LIKE 'MOCK-%' OR project_code LIKE 'UX-%'
  )
);

DELETE FROM site_survey_item
WHERE survey_id IN (
  SELECT id FROM site_survey
  WHERE project_id IN (
    SELECT id FROM project
    WHERE project_code LIKE 'MOCK-%' OR project_code LIKE 'UX-%'
  )
);

DELETE FROM reimbursement_duplicate_check
WHERE envelope_id IN (
  SELECT id FROM reimbursement_envelope
  WHERE envelope_no LIKE 'MOCK-%' OR envelope_no LIKE 'UX-%'
);

DELETE FROM reimbursement_duplicate_check
WHERE matched_envelope_id IN (
  SELECT id FROM reimbursement_envelope
  WHERE envelope_no LIKE 'MOCK-%' OR envelope_no LIKE 'UX-%'
);

DELETE FROM reimbursement_batch_item
WHERE batch_id IN (
  SELECT id FROM reimbursement_batch
  WHERE batch_no LIKE 'MOCK-%' OR batch_no LIKE 'UX-%'
);

DELETE FROM reimbursement_batch_item
WHERE envelope_id IN (
  SELECT id FROM reimbursement_envelope
  WHERE envelope_no LIKE 'MOCK-%' OR envelope_no LIKE 'UX-%'
);

DELETE FROM envelope_attachment
WHERE envelope_id IN (
  SELECT id FROM reimbursement_envelope
  WHERE envelope_no LIKE 'MOCK-%' OR envelope_no LIKE 'UX-%'
);

DELETE FROM stock_order_item
WHERE stock_order_id IN (
  SELECT id FROM stock_order
  WHERE order_no LIKE 'MOCK-%' OR order_no LIKE 'UX-%'
);

DELETE FROM project_equipment_plan_item
WHERE plan_id IN (
  SELECT id FROM project_equipment_plan
  WHERE plan_no LIKE 'MOCK-%' OR plan_no LIKE 'UX-%'
);

DELETE FROM tracked_asset_document
WHERE tracked_asset_id IN (
  SELECT id FROM tracked_asset
  WHERE asset_code LIKE 'MOCK-%' OR asset_code LIKE 'UX-%'
);

DELETE FROM tracked_asset_event
WHERE tracked_asset_id IN (
  SELECT id FROM tracked_asset
  WHERE asset_code LIKE 'MOCK-%' OR asset_code LIKE 'UX-%'
);

DELETE FROM inventory_consumption
WHERE warehouse_id IN (
  SELECT id FROM warehouse
  WHERE warehouse_code LIKE 'MOCK-%' OR warehouse_code LIKE 'UX-%'
);

DELETE FROM inventory
WHERE warehouse_id IN (
  SELECT id FROM warehouse
  WHERE warehouse_code LIKE 'MOCK-%' OR warehouse_code LIKE 'UX-%'
);

DELETE FROM ai_audit_log
WHERE task_id IN (
  SELECT id FROM task_queue
  WHERE task_code LIKE 'MOCK-%'
     OR task_code LIKE 'E2E-%'
     OR task_code LIKE 'QREG-%'
     OR task_code LIKE 'CFONLY-%'
     OR task_code LIKE 'NOMAN-%'
     OR task_code LIKE 'LOWCOST-%'
     OR task_code LIKE 'AUTOCHK-%'
     OR task_code LIKE 'UX-%'
)
   OR (
    biz_type = 'payment_request'
    AND biz_id IN (
      SELECT id FROM payment_request
      WHERE serial_no LIKE 'MOCK-%'
         OR serial_no LIKE 'UX-%'
         OR content LIKE '%Prod E2E%'
         OR content LIKE '%[ux-seed]%'
    )
  );

DELETE FROM task_queue
WHERE task_code LIKE 'MOCK-%'
   OR task_code LIKE 'E2E-%'
   OR task_code LIKE 'QREG-%'
   OR task_code LIKE 'CFONLY-%'
   OR task_code LIKE 'NOMAN-%'
   OR task_code LIKE 'LOWCOST-%'
   OR task_code LIKE 'AUTOCHK-%'
   OR task_code LIKE 'UX-%';

DELETE FROM ai_routing_rule
WHERE rule_name LIKE 'MOCK-%' OR rule_name LIKE 'UX-%';

DELETE FROM ai_prompt_template
WHERE template_key LIKE 'mock_%' OR template_key LIKE 'ux_%';

DELETE FROM ai_provider_config
WHERE provider_key LIKE 'mock_%' OR provider_key LIKE 'ux_%';

DELETE FROM compute_node
WHERE node_id LIKE 'mock-node-%' OR node_id LIKE 'ux-node-%';

DELETE FROM receipt
WHERE receipt_no LIKE 'MOCK-%' OR receipt_no LIKE 'UX-%';

DELETE FROM invoice
WHERE invoice_no LIKE 'MOCK-%' OR invoice_no LIKE 'UX-%';

DELETE FROM payment_request
WHERE serial_no LIKE 'MOCK-%'
   OR serial_no LIKE 'UX-%'
   OR content LIKE '%Prod E2E%'
   OR content LIKE '%[ux-seed]%';

DELETE FROM contract_amount_change
WHERE reason LIKE '%[mock-seed]%' OR reason LIKE '%[ux-seed]%';

DELETE FROM contract
WHERE contract_no LIKE 'MOCK-%'
   OR contract_no LIKE 'UX-%'
   OR remark LIKE '%[mock-seed]%'
   OR remark LIKE '%[ux-seed]%';

DELETE FROM payee
WHERE created_by_userid = 'mock-seed'
   OR created_by_userid = 'ux-seed'
   OR name LIKE 'UX Test %';

DELETE FROM reimbursement_envelope
WHERE envelope_no LIKE 'MOCK-%' OR envelope_no LIKE 'UX-%';

DELETE FROM reimbursement_batch
WHERE batch_no LIKE 'MOCK-%' OR batch_no LIKE 'UX-%';

DELETE FROM project_equipment_plan
WHERE plan_no LIKE 'MOCK-%' OR plan_no LIKE 'UX-%';

DELETE FROM stock_order
WHERE order_no LIKE 'MOCK-%' OR order_no LIKE 'UX-%';

DELETE FROM tracked_asset
WHERE asset_code LIKE 'MOCK-%' OR asset_code LIKE 'UX-%';

DELETE FROM asset_type
WHERE type_code LIKE 'MOCK-%' OR type_code LIKE 'UX-%';

DELETE FROM warehouse
WHERE warehouse_code LIKE 'MOCK-%' OR warehouse_code LIKE 'UX-%';

DELETE FROM operator_log
WHERE project_id IN (
  SELECT id FROM project
  WHERE project_code LIKE 'MOCK-%' OR project_code LIKE 'UX-%'
);

DELETE FROM manager_log
WHERE project_id IN (
  SELECT id FROM project
  WHERE project_code LIKE 'MOCK-%' OR project_code LIKE 'UX-%'
);

DELETE FROM breakthrough_report
WHERE report_no LIKE 'MOCK-%' OR report_no LIKE 'UX-%';

DELETE FROM site_survey
WHERE project_id IN (
  SELECT id FROM project
  WHERE project_code LIKE 'MOCK-%' OR project_code LIKE 'UX-%'
);

DELETE FROM project_section
WHERE project_id IN (
  SELECT id FROM project
  WHERE project_code LIKE 'MOCK-%' OR project_code LIKE 'UX-%'
);

DELETE FROM project
WHERE project_code LIKE 'MOCK-%' OR project_code LIKE 'UX-%';

DELETE FROM entity_invoice_profile
WHERE entity_id IN (
  SELECT id FROM entity
  WHERE entity_code LIKE 'MOCK-%' OR entity_code LIKE 'UX-%'
);

DELETE FROM entity_bank_account
WHERE entity_id IN (
  SELECT id FROM entity
  WHERE entity_code LIKE 'MOCK-%' OR entity_code LIKE 'UX-%'
);

DELETE FROM entity
WHERE entity_code LIKE 'MOCK-%' OR entity_code LIKE 'UX-%';

PRAGMA foreign_keys = ON;
