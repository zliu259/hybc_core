ALTER TABLE project ADD COLUMN location_text TEXT;
ALTER TABLE project ADD COLUMN project_briefing TEXT;
ALTER TABLE project ADD COLUMN project_start_at TEXT;

ALTER TABLE project_section ADD COLUMN pipe_material TEXT;
ALTER TABLE project_section ADD COLUMN pipe_model TEXT;
ALTER TABLE project_section ADD COLUMN soil_type TEXT;
ALTER TABLE project_section ADD COLUMN assigned_machine_type TEXT;
ALTER TABLE project_section ADD COLUMN ai_machine_match_note TEXT;
ALTER TABLE project_section ADD COLUMN ai_machine_match_score REAL;

CREATE INDEX IF NOT EXISTS idx_project_project_start_at ON project(project_start_at);
