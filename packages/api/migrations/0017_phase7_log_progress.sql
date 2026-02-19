CREATE TABLE IF NOT EXISTS operator_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  section_id INTEGER,
  log_date TEXT NOT NULL,
  shift TEXT NOT NULL,
  weather TEXT,
  completed_pipe_count INTEGER NOT NULL DEFAULT 0,
  cumulative_pipe_count INTEGER NOT NULL DEFAULT 0,
  footage_m REAL,
  issue_summary TEXT,
  remark TEXT,
  operator_userid TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES project(id),
  FOREIGN KEY (section_id) REFERENCES project_section(id)
);

CREATE INDEX idx_operator_log_project_id ON operator_log(project_id);
CREATE INDEX idx_operator_log_log_date ON operator_log(log_date);
CREATE INDEX idx_operator_log_shift ON operator_log(shift);
CREATE INDEX idx_operator_log_operator_userid ON operator_log(operator_userid);

CREATE TABLE IF NOT EXISTS manager_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  log_date TEXT NOT NULL,
  title TEXT,
  detail_html TEXT,
  risk_note TEXT,
  manager_userid TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES project(id)
);

CREATE INDEX idx_manager_log_project_id ON manager_log(project_id);
CREATE INDEX idx_manager_log_log_date ON manager_log(log_date);
CREATE INDEX idx_manager_log_manager_userid ON manager_log(manager_userid);

CREATE TABLE IF NOT EXISTS manager_log_photo (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  manager_log_id INTEGER NOT NULL,
  file_key TEXT NOT NULL,
  caption TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  FOREIGN KEY (manager_log_id) REFERENCES manager_log(id)
);

CREATE INDEX idx_manager_log_photo_log_id ON manager_log_photo(manager_log_id);

CREATE TABLE IF NOT EXISTS breakthrough_report (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_no TEXT NOT NULL UNIQUE,
  project_id INTEGER NOT NULL,
  section_id INTEGER,
  report_date TEXT NOT NULL,
  breakthrough_m REAL,
  summary TEXT,
  detail TEXT,
  reporter_userid TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES project(id),
  FOREIGN KEY (section_id) REFERENCES project_section(id)
);

CREATE INDEX idx_breakthrough_report_project_id ON breakthrough_report(project_id);
CREATE INDEX idx_breakthrough_report_report_date ON breakthrough_report(report_date);

CREATE TABLE IF NOT EXISTS site_survey (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  survey_date TEXT NOT NULL,
  location TEXT,
  weather TEXT,
  summary TEXT,
  surveyor_userid TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES project(id)
);

CREATE INDEX idx_site_survey_project_id ON site_survey(project_id);
CREATE INDEX idx_site_survey_survey_date ON site_survey(survey_date);

CREATE TABLE IF NOT EXISTS site_survey_item (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  survey_id INTEGER NOT NULL,
  item_name TEXT NOT NULL,
  item_value TEXT,
  remark TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (survey_id) REFERENCES site_survey(id)
);

CREATE INDEX idx_site_survey_item_survey_id ON site_survey_item(survey_id);
