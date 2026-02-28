ALTER TABLE entity ADD COLUMN legacy_data_id TEXT;
ALTER TABLE entity ADD COLUMN tax_id TEXT;
ALTER TABLE entity ADD COLUMN legacy_source TEXT;
ALTER TABLE entity ADD COLUMN legacy_submitted_by TEXT;
ALTER TABLE entity ADD COLUMN legacy_submitted_at TEXT;

ALTER TABLE payee ADD COLUMN legacy_data_id TEXT;
ALTER TABLE payee ADD COLUMN legacy_source TEXT;
ALTER TABLE payee ADD COLUMN legacy_submitted_by TEXT;
ALTER TABLE payee ADD COLUMN legacy_submitted_at TEXT;

ALTER TABLE contract ADD COLUMN legacy_data_id TEXT;
ALTER TABLE contract ADD COLUMN legacy_project_name TEXT;
ALTER TABLE contract ADD COLUMN legacy_project_full_name TEXT;
ALTER TABLE contract ADD COLUMN legacy_contract_status TEXT;
ALTER TABLE contract ADD COLUMN legacy_current_node TEXT;
ALTER TABLE contract ADD COLUMN legacy_current_owner TEXT;
ALTER TABLE contract ADD COLUMN legacy_submitter_name TEXT;
ALTER TABLE contract ADD COLUMN legacy_submitted_at TEXT;
ALTER TABLE contract ADD COLUMN legacy_contract_party_a TEXT;
ALTER TABLE contract ADD COLUMN legacy_contract_party_b TEXT;

ALTER TABLE payment_request ADD COLUMN legacy_data_id TEXT;
ALTER TABLE payment_request ADD COLUMN legacy_applicant_name TEXT;
ALTER TABLE payment_request ADD COLUMN legacy_project_name TEXT;
ALTER TABLE payment_request ADD COLUMN legacy_project_full_name TEXT;
ALTER TABLE payment_request ADD COLUMN legacy_contract_no TEXT;
ALTER TABLE payment_request ADD COLUMN legacy_contract_status TEXT;
ALTER TABLE payment_request ADD COLUMN legacy_invoice_type TEXT;
ALTER TABLE payment_request ADD COLUMN legacy_payee_name TEXT;
ALTER TABLE payment_request ADD COLUMN legacy_payee_bank_name TEXT;
ALTER TABLE payment_request ADD COLUMN legacy_payee_account TEXT;
ALTER TABLE payment_request ADD COLUMN legacy_payee_phone TEXT;
ALTER TABLE payment_request ADD COLUMN legacy_handler_name TEXT;
ALTER TABLE payment_request ADD COLUMN legacy_specified_pay_flag TEXT;
ALTER TABLE payment_request ADD COLUMN legacy_specified_pay_date TEXT;
ALTER TABLE payment_request ADD COLUMN legacy_voucher_keys_raw TEXT;
ALTER TABLE payment_request ADD COLUMN legacy_flow_status TEXT;
ALTER TABLE payment_request ADD COLUMN legacy_current_node TEXT;
ALTER TABLE payment_request ADD COLUMN legacy_current_owner TEXT;
ALTER TABLE payment_request ADD COLUMN legacy_submitter_name TEXT;
ALTER TABLE payment_request ADD COLUMN legacy_submitted_at TEXT;

ALTER TABLE reimbursement_envelope ADD COLUMN legacy_data_id TEXT;
ALTER TABLE reimbursement_envelope ADD COLUMN legacy_serial_no TEXT;
ALTER TABLE reimbursement_envelope ADD COLUMN legacy_project_name TEXT;
ALTER TABLE reimbursement_envelope ADD COLUMN legacy_ticket_type TEXT;
ALTER TABLE reimbursement_envelope ADD COLUMN legacy_invoice_received_flag TEXT;
ALTER TABLE reimbursement_envelope ADD COLUMN legacy_ticket_match_flag TEXT;
ALTER TABLE reimbursement_envelope ADD COLUMN legacy_reimbursement_status TEXT;
ALTER TABLE reimbursement_envelope ADD COLUMN legacy_flow_status TEXT;
ALTER TABLE reimbursement_envelope ADD COLUMN legacy_current_node TEXT;
ALTER TABLE reimbursement_envelope ADD COLUMN legacy_current_owner TEXT;
ALTER TABLE reimbursement_envelope ADD COLUMN legacy_submitter_name TEXT;
ALTER TABLE reimbursement_envelope ADD COLUMN legacy_submitted_at TEXT;

ALTER TABLE reimbursement_batch ADD COLUMN legacy_data_id TEXT;
ALTER TABLE reimbursement_batch ADD COLUMN legacy_claimant_name TEXT;
ALTER TABLE reimbursement_batch ADD COLUMN legacy_project_name TEXT;
ALTER TABLE reimbursement_batch ADD COLUMN legacy_details_raw TEXT;
ALTER TABLE reimbursement_batch ADD COLUMN legacy_amount_cn TEXT;
ALTER TABLE reimbursement_batch ADD COLUMN legacy_payment_method TEXT;
ALTER TABLE reimbursement_batch ADD COLUMN legacy_handler_name TEXT;
ALTER TABLE reimbursement_batch ADD COLUMN legacy_specified_pay_flag TEXT;
ALTER TABLE reimbursement_batch ADD COLUMN legacy_specified_pay_date TEXT;
ALTER TABLE reimbursement_batch ADD COLUMN legacy_voucher_keys_raw TEXT;
ALTER TABLE reimbursement_batch ADD COLUMN legacy_flow_status TEXT;
ALTER TABLE reimbursement_batch ADD COLUMN legacy_current_node TEXT;
ALTER TABLE reimbursement_batch ADD COLUMN legacy_current_owner TEXT;
ALTER TABLE reimbursement_batch ADD COLUMN legacy_submitter_name TEXT;
ALTER TABLE reimbursement_batch ADD COLUMN legacy_submitted_at TEXT;

CREATE TABLE IF NOT EXISTS legacy_fin_import_job (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_code TEXT NOT NULL UNIQUE,
  source_file TEXT NOT NULL,
  target_table TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  total_rows INTEGER NOT NULL DEFAULT 0,
  success_rows INTEGER NOT NULL DEFAULT 0,
  failed_rows INTEGER NOT NULL DEFAULT 0,
  started_at TEXT,
  finished_at TEXT,
  operator_userid TEXT,
  summary_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS legacy_fin_import_error (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL,
  row_no INTEGER,
  legacy_data_id TEXT,
  error_code TEXT NOT NULL,
  error_message TEXT NOT NULL,
  raw_row_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (job_id) REFERENCES legacy_fin_import_job(id)
);

CREATE INDEX IF NOT EXISTS idx_entity_legacy_data_id ON entity(legacy_data_id);
CREATE INDEX IF NOT EXISTS idx_entity_tax_id ON entity(tax_id);
CREATE INDEX IF NOT EXISTS idx_payee_legacy_data_id ON payee(legacy_data_id);
CREATE INDEX IF NOT EXISTS idx_contract_legacy_data_id ON contract(legacy_data_id);
CREATE INDEX IF NOT EXISTS idx_payment_request_legacy_data_id ON payment_request(legacy_data_id);
CREATE INDEX IF NOT EXISTS idx_payment_request_legacy_contract_no ON payment_request(legacy_contract_no);
CREATE INDEX IF NOT EXISTS idx_reimbursement_envelope_legacy_data_id ON reimbursement_envelope(legacy_data_id);
CREATE INDEX IF NOT EXISTS idx_reimbursement_batch_legacy_data_id ON reimbursement_batch(legacy_data_id);
CREATE INDEX IF NOT EXISTS idx_legacy_fin_import_job_status ON legacy_fin_import_job(status);
CREATE INDEX IF NOT EXISTS idx_legacy_fin_import_error_job_id ON legacy_fin_import_error(job_id);
