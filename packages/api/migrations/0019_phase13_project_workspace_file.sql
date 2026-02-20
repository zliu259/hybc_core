CREATE TABLE IF NOT EXISTS project_file (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  section_id INTEGER,
  file_name TEXT NOT NULL,
  file_key TEXT NOT NULL,
  file_size INTEGER,
  category TEXT,
  remark TEXT,
  uploaded_by_userid TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES project(id),
  FOREIGN KEY (section_id) REFERENCES project_section(id)
);

CREATE INDEX IF NOT EXISTS idx_project_file_project_id ON project_file(project_id);
CREATE INDEX IF NOT EXISTS idx_project_file_section_id ON project_file(section_id);
CREATE INDEX IF NOT EXISTS idx_project_file_status ON project_file(status);
