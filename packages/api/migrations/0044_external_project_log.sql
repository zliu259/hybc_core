CREATE TABLE IF NOT EXISTS project_public_log_link (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  allowed_log_types_json TEXT NOT NULL,
  expires_at TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_by_userid TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES project(id)
);

CREATE INDEX idx_project_public_log_link_project_id ON project_public_log_link(project_id);
CREATE INDEX idx_project_public_log_link_status ON project_public_log_link(status);

CREATE TABLE IF NOT EXISTS external_log_submission (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  section_id INTEGER,
  submitter_name TEXT NOT NULL,
  submitter_company TEXT,
  submitter_phone TEXT,
  log_date TEXT NOT NULL,
  shift TEXT NOT NULL,
  operator_log_payload_json TEXT NOT NULL,
  project_log_payload_json TEXT NOT NULL,
  photo_keys_json TEXT,
  review_status TEXT NOT NULL DEFAULT 'pending_ai_review',
  ai_review_task_id INTEGER,
  ai_review_result_json TEXT,
  ai_review_score INTEGER,
  ai_review_risk_level TEXT,
  ai_review_summary TEXT,
  reviewed_by_userid TEXT,
  reviewed_at TEXT,
  review_comment TEXT,
  adopted_operator_log_id INTEGER,
  adopted_manager_log_id INTEGER,
  client_ip_hash TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES project(id),
  FOREIGN KEY (section_id) REFERENCES project_section(id),
  FOREIGN KEY (ai_review_task_id) REFERENCES task_queue(id),
  FOREIGN KEY (adopted_operator_log_id) REFERENCES operator_log(id),
  FOREIGN KEY (adopted_manager_log_id) REFERENCES manager_log(id)
);

CREATE INDEX idx_external_log_submission_project_id ON external_log_submission(project_id);
CREATE INDEX idx_external_log_submission_section_id ON external_log_submission(section_id);
CREATE INDEX idx_external_log_submission_review_status ON external_log_submission(review_status);
CREATE INDEX idx_external_log_submission_log_date ON external_log_submission(log_date);

ALTER TABLE operator_log ADD COLUMN source_type TEXT NOT NULL DEFAULT 'internal';
ALTER TABLE operator_log ADD COLUMN external_submission_id INTEGER;
ALTER TABLE operator_log ADD COLUMN external_submitter_name TEXT;
ALTER TABLE operator_log ADD COLUMN external_submitter_company TEXT;

ALTER TABLE manager_log ADD COLUMN source_type TEXT NOT NULL DEFAULT 'internal';
ALTER TABLE manager_log ADD COLUMN external_submission_id INTEGER;
ALTER TABLE manager_log ADD COLUMN external_submitter_name TEXT;
ALTER TABLE manager_log ADD COLUMN external_submitter_company TEXT;
