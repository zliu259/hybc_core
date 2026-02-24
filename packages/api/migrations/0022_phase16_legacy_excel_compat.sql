ALTER TABLE project ADD COLUMN legacy_data_id TEXT;
ALTER TABLE project ADD COLUMN project_short_name TEXT;
ALTER TABLE project ADD COLUMN project_alias TEXT;
ALTER TABLE project ADD COLUMN province TEXT;
ALTER TABLE project ADD COLUMN city TEXT;
ALTER TABLE project ADD COLUMN district TEXT;
ALTER TABLE project ADD COLUMN address_detail TEXT;
ALTER TABLE project ADD COLUMN geotech_soil TEXT;
ALTER TABLE project ADD COLUMN machine_type TEXT;
ALTER TABLE project ADD COLUMN pipe_material TEXT;
ALTER TABLE project ADD COLUMN pipe_spec TEXT;
ALTER TABLE project ADD COLUMN legacy_note TEXT;

ALTER TABLE project_section ADD COLUMN legacy_section_ref TEXT;
ALTER TABLE project_section ADD COLUMN design_slope REAL;
ALTER TABLE project_section ADD COLUMN pipe_diameter_mm REAL;

ALTER TABLE operator_log ADD COLUMN legacy_data_id TEXT;
ALTER TABLE operator_log ADD COLUMN section_text TEXT;
ALTER TABLE operator_log ADD COLUMN operator_name TEXT;
ALTER TABLE operator_log ADD COLUMN shift_cn TEXT;
ALTER TABLE operator_log ADD COLUMN main_thrust_mpa REAL;
ALTER TABLE operator_log ADD COLUMN jacking_count INTEGER;
ALTER TABLE operator_log ADD COLUMN chamber_pressure_mpa REAL;
ALTER TABLE operator_log ADD COLUMN cutter_current_a REAL;
ALTER TABLE operator_log ADD COLUMN screw_current_a REAL;
ALTER TABLE operator_log ADD COLUMN soil_type TEXT;
ALTER TABLE operator_log ADD COLUMN deviation_direction TEXT;
ALTER TABLE operator_log ADD COLUMN deviation_value_mm REAL;
ALTER TABLE operator_log ADD COLUMN photo_keys_raw TEXT;
ALTER TABLE operator_log ADD COLUMN wechat_openid TEXT;
ALTER TABLE operator_log ADD COLUMN submitted_by_name TEXT;
ALTER TABLE operator_log ADD COLUMN submitted_at TEXT;
ALTER TABLE operator_log ADD COLUMN legacy_extra_json TEXT;

ALTER TABLE manager_log ADD COLUMN legacy_data_id TEXT;
ALTER TABLE manager_log ADD COLUMN submitter_name TEXT;
ALTER TABLE manager_log ADD COLUMN tomorrow_plan TEXT;
ALTER TABLE manager_log ADD COLUMN submitted_at TEXT;

ALTER TABLE breakthrough_report ADD COLUMN legacy_data_id TEXT;
ALTER TABLE breakthrough_report ADD COLUMN section_text TEXT;
ALTER TABLE breakthrough_report ADD COLUMN start_date TEXT;
ALTER TABLE breakthrough_report ADD COLUMN jacking_days INTEGER;
ALTER TABLE breakthrough_report ADD COLUMN pipe_diameter TEXT;
ALTER TABLE breakthrough_report ADD COLUMN total_length_m REAL;
ALTER TABLE breakthrough_report ADD COLUMN total_pipe_count INTEGER;
ALTER TABLE breakthrough_report ADD COLUMN deviation_direction TEXT;
ALTER TABLE breakthrough_report ADD COLUMN deviation_value_mm REAL;
ALTER TABLE breakthrough_report ADD COLUMN other_notes TEXT;
ALTER TABLE breakthrough_report ADD COLUMN submitted_at TEXT;

CREATE INDEX IF NOT EXISTS idx_project_legacy_data_id ON project(legacy_data_id);
CREATE INDEX IF NOT EXISTS idx_operator_log_legacy_data_id ON operator_log(legacy_data_id);
CREATE INDEX IF NOT EXISTS idx_manager_log_legacy_data_id ON manager_log(legacy_data_id);
CREATE INDEX IF NOT EXISTS idx_breakthrough_report_legacy_data_id ON breakthrough_report(legacy_data_id);
