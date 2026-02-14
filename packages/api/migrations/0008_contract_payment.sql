-- Phase 3: 对外付款 — contract, contract_amount_change, payment_request, payee
-- Unified contract table supports both outbound (Phase 3) and inbound (Phase 5)

-- ─── Contract ──────────

CREATE TABLE IF NOT EXISTS contract (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_no   TEXT    NOT NULL UNIQUE,
  direction     TEXT    NOT NULL DEFAULT 'outbound',   -- outbound | inbound
  project_id    INTEGER NOT NULL,
  entity_id     INTEGER NOT NULL,                      -- our legal entity
  counterparty  TEXT    NOT NULL,                      -- the other party
  contract_type TEXT    NOT NULL,                      -- from sys_dict: 人工/机械/总包/其他
  handler_userid TEXT   NOT NULL,                      -- 经办人 (WeCom userid)
  contract_date TEXT    NOT NULL,                      -- ISO 8601
  total_amount  REAL    NOT NULL DEFAULT 0,
  paid_amount   REAL    NOT NULL DEFAULT 0,            -- auto-tracked
  invoiced_amount REAL  NOT NULL DEFAULT 0,            -- for inbound (Phase 5)
  received_amount REAL  NOT NULL DEFAULT 0,            -- for inbound (Phase 5)
  status        TEXT    NOT NULL DEFAULT 'draft',      -- draft/pending_review/pending_approval/active/completed/terminated/deleted
  ai_review_status TEXT NOT NULL DEFAULT 'none',       -- none/pending/completed/failed
  ai_review_result TEXT,                               -- JSON: ContractReviewReport
  approval_instance_id INTEGER,
  attachments_json TEXT,                               -- JSON: array of R2 file keys
  remark        TEXT,
  created_at    TEXT    NOT NULL,
  updated_at    TEXT    NOT NULL
);

CREATE INDEX idx_contract_project_id ON contract(project_id);
CREATE INDEX idx_contract_entity_id ON contract(entity_id);
CREATE INDEX idx_contract_direction ON contract(direction);
CREATE INDEX idx_contract_status ON contract(status);
CREATE INDEX idx_contract_handler ON contract(handler_userid);
CREATE INDEX idx_contract_contract_no ON contract(contract_no);

-- ─── Contract Amount Change ──────────

CREATE TABLE IF NOT EXISTS contract_amount_change (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_id   INTEGER NOT NULL,
  change_type   TEXT    NOT NULL,                      -- increase/decrease/adjust
  old_amount    REAL    NOT NULL,
  new_amount    REAL    NOT NULL,
  reason        TEXT    NOT NULL,
  status        TEXT    NOT NULL DEFAULT 'pending',    -- pending/approved/rejected
  approval_instance_id INTEGER,
  applicant_userid TEXT NOT NULL,
  created_at    TEXT    NOT NULL,
  updated_at    TEXT    NOT NULL,
  FOREIGN KEY (contract_id) REFERENCES contract(id)
);

CREATE INDEX idx_contract_amount_change_contract_id ON contract_amount_change(contract_id);
CREATE INDEX idx_contract_amount_change_status ON contract_amount_change(status);

-- ─── Payee ──────────

CREATE TABLE IF NOT EXISTS payee (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  bank_name     TEXT    NOT NULL,
  bank_account  TEXT    NOT NULL,
  phone         TEXT,
  type          TEXT    NOT NULL DEFAULT 'external',   -- internal/external
  status        TEXT    NOT NULL DEFAULT 'active',     -- active/deleted
  created_by_userid TEXT NOT NULL,
  created_at    TEXT    NOT NULL,
  updated_at    TEXT    NOT NULL
);

CREATE INDEX idx_payee_type ON payee(type);
CREATE INDEX idx_payee_status ON payee(status);

-- ─── Payment Request ──────────

CREATE TABLE IF NOT EXISTS payment_request (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  serial_no     TEXT    NOT NULL UNIQUE,
  contract_id   INTEGER NOT NULL,
  project_id    INTEGER NOT NULL,
  applicant_userid TEXT NOT NULL,
  expected_payment_date TEXT NOT NULL,                 -- ISO 8601
  category      TEXT    NOT NULL,                      -- from sys_dict: 特殊审批/行政费/劳务费/机械费
  payee_id      INTEGER NOT NULL,
  amount        REAL    NOT NULL,
  amount_cn     TEXT    NOT NULL,                      -- 金额大写 (backend-generated)
  content       TEXT    NOT NULL,                      -- 付款内容详情
  payment_method TEXT   NOT NULL,                      -- from sys_dict
  status        TEXT    NOT NULL DEFAULT 'draft',      -- draft/pending_approval/approved/paid/rejected/cancelled
  approval_instance_id INTEGER,
  ai_risk_status TEXT   NOT NULL DEFAULT 'none',       -- none/pending/completed/failed
  ai_risk_result TEXT,                                 -- JSON: PaymentRiskReport
  attachments_json TEXT,                               -- JSON: array of R2 file keys
  remark        TEXT,
  created_at    TEXT    NOT NULL,
  updated_at    TEXT    NOT NULL,
  FOREIGN KEY (contract_id) REFERENCES contract(id),
  FOREIGN KEY (payee_id) REFERENCES payee(id)
);

CREATE INDEX idx_payment_request_serial_no ON payment_request(serial_no);
CREATE INDEX idx_payment_request_contract_id ON payment_request(contract_id);
CREATE INDEX idx_payment_request_project_id ON payment_request(project_id);
CREATE INDEX idx_payment_request_status ON payment_request(status);
CREATE INDEX idx_payment_request_applicant ON payment_request(applicant_userid);
