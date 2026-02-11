CREATE TABLE IF NOT EXISTS project (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_code TEXT NOT NULL UNIQUE,
  project_name TEXT NOT NULL,
  entity_id INTEGER,
  manager_userid TEXT,
  status TEXT NOT NULL DEFAULT 'planning',
  start_date TEXT,
  end_date TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (entity_id) REFERENCES entity(id)
);

CREATE INDEX IF NOT EXISTS idx_project_status ON project(status);
CREATE INDEX IF NOT EXISTS idx_project_entity_id ON project(entity_id);

CREATE TABLE IF NOT EXISTS project_section (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  section_code TEXT NOT NULL,
  section_name TEXT NOT NULL,
  section_length REAL,
  status TEXT NOT NULL DEFAULT 'planning',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES project(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_project_section_project_code ON project_section(project_id, section_code);
