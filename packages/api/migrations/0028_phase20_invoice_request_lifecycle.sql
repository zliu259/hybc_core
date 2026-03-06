CREATE TABLE IF NOT EXISTS invoice_request (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_no TEXT NOT NULL UNIQUE,
  contract_id INTEGER NOT NULL,
  project_id INTEGER NOT NULL,
  customer_name TEXT NOT NULL,
  customer_tax_no TEXT NOT NULL,
  buyer_json TEXT,
  invoice_type TEXT NOT NULL,
  invoice_category TEXT NOT NULL,
  tax_rate REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'CNY',
  items_json TEXT NOT NULL,
  amount_without_tax REAL NOT NULL,
  tax_amount_estimated REAL NOT NULL,
  amount_with_tax REAL NOT NULL,
  business_contract_no TEXT,
  delivery_reference TEXT,
  payment_reference TEXT,
  applicant_userid TEXT NOT NULL,
  department TEXT,
  approval_instance_id INTEGER,
  status TEXT NOT NULL DEFAULT 'draft',
  review_comment TEXT,
  approved_at TEXT,
  rejected_at TEXT,
  issued_invoice_id INTEGER,
  attachments_json TEXT,
  remark TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (contract_id) REFERENCES contract(id),
  FOREIGN KEY (issued_invoice_id) REFERENCES invoice(id)
);

CREATE INDEX idx_invoice_request_contract_id ON invoice_request(contract_id);
CREATE INDEX idx_invoice_request_project_id ON invoice_request(project_id);
CREATE INDEX idx_invoice_request_status ON invoice_request(status);
CREATE INDEX idx_invoice_request_applicant ON invoice_request(applicant_userid);
CREATE INDEX idx_invoice_request_approval_instance ON invoice_request(approval_instance_id);

ALTER TABLE invoice ADD COLUMN invoice_request_id INTEGER;
ALTER TABLE invoice ADD COLUMN invoice_code TEXT;
ALTER TABLE invoice ADD COLUMN invoice_number TEXT;
ALTER TABLE invoice ADD COLUMN check_code TEXT;
ALTER TABLE invoice ADD COLUMN tax_amount REAL;
ALTER TABLE invoice ADD COLUMN amount_with_tax REAL;
ALTER TABLE invoice ADD COLUMN pdf_file_key TEXT;
ALTER TABLE invoice ADD COLUMN ofd_file_key TEXT;
ALTER TABLE invoice ADD COLUMN xml_file_key TEXT;
ALTER TABLE invoice ADD COLUMN qr_code TEXT;
ALTER TABLE invoice ADD COLUMN invoice_status_detail TEXT NOT NULL DEFAULT 'normal';
ALTER TABLE invoice ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'unpaid';
ALTER TABLE invoice ADD COLUMN send_status TEXT NOT NULL DEFAULT 'unsent';
ALTER TABLE invoice ADD COLUMN send_time TEXT;
ALTER TABLE invoice ADD COLUMN verification_status TEXT NOT NULL DEFAULT 'none';
ALTER TABLE invoice ADD COLUMN verification_task_id INTEGER;
ALTER TABLE invoice ADD COLUMN verification_result TEXT;

CREATE INDEX idx_invoice_request_link ON invoice(invoice_request_id);
CREATE INDEX idx_invoice_send_status ON invoice(send_status);
CREATE INDEX idx_invoice_verify_status ON invoice(verification_status);

INSERT OR IGNORE INTO approval_template (
  template_code,
  template_name,
  biz_type,
  config_json,
  status,
  created_by,
  created_at,
  updated_at
) VALUES (
  'TPL-INVOICE-REQUEST',
  '开票申请审批模板',
  'invoice_request',
  '{"version":1,"start_key":"dept_review","nodes":[{"key":"dept_review","type":"sequential","name":"部门负责人审批","assignee_userids":["site_manager"],"next_key":"finance_review"},{"key":"finance_review","type":"sequential","name":"财务复核","assignee_userids":["finance_manager"],"conditions":[{"field":"amount","operator":"gt","value":500000,"next_key":"gm_approve"}],"default_next_key":"archive_cc"},{"key":"gm_approve","type":"sequential","name":"总经理审批","assignee_userids":["general_manager"],"next_key":"archive_cc"},{"key":"archive_cc","type":"cc","name":"抄送归档","assignee_userids":["manager"],"next_key":null}]}',
  'active',
  'system',
  datetime('now'),
  datetime('now')
);
