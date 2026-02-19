CREATE TABLE IF NOT EXISTS invoice (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_no TEXT NOT NULL UNIQUE,
  contract_id INTEGER NOT NULL,
  project_id INTEGER NOT NULL,
  issuer_userid TEXT NOT NULL,
  issue_date TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  tax_no TEXT,
  file_key TEXT,
  status TEXT NOT NULL DEFAULT 'issued',
  remark TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (contract_id) REFERENCES contract(id)
);

CREATE INDEX idx_invoice_no ON invoice(invoice_no);
CREATE INDEX idx_invoice_contract_id ON invoice(contract_id);
CREATE INDEX idx_invoice_project_id ON invoice(project_id);
CREATE INDEX idx_invoice_status ON invoice(status);

CREATE TABLE IF NOT EXISTS receipt (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_no TEXT NOT NULL UNIQUE,
  contract_id INTEGER NOT NULL,
  project_id INTEGER NOT NULL,
  invoice_id INTEGER,
  receiver_userid TEXT NOT NULL,
  received_date TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  payment_account TEXT,
  status TEXT NOT NULL DEFAULT 'recorded',
  remark TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (contract_id) REFERENCES contract(id),
  FOREIGN KEY (invoice_id) REFERENCES invoice(id)
);

CREATE INDEX idx_receipt_no ON receipt(receipt_no);
CREATE INDEX idx_receipt_contract_id ON receipt(contract_id);
CREATE INDEX idx_receipt_project_id ON receipt(project_id);
CREATE INDEX idx_receipt_invoice_id ON receipt(invoice_id);
CREATE INDEX idx_receipt_status ON receipt(status);

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
  'TPL-INBOUND-CONTRACT',
  '收款合同审批模板',
  'inbound_contract',
  '{"version":1,"start_key":"dept_review","nodes":[{"key":"dept_review","type":"sequential","name":"部门负责人审批","assignee_userids":["site_manager"],"next_key":"finance_review"},{"key":"finance_review","type":"sequential","name":"财务复核","assignee_userids":["finance_manager"],"conditions":[{"field":"amount","operator":"gt","value":500000,"next_key":"gm_approve"}],"default_next_key":"archive_cc"},{"key":"gm_approve","type":"sequential","name":"总经理审批","assignee_userids":["general_manager"],"next_key":"archive_cc"},{"key":"archive_cc","type":"cc","name":"抄送归档","assignee_userids":["manager"],"next_key":null}]}',
  'active',
  'system',
  datetime('now'),
  datetime('now')
);
