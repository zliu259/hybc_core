ALTER TABLE project_section ADD COLUMN jacking_method TEXT;

ALTER TABLE operator_log ADD COLUMN cutter_current_text TEXT;
ALTER TABLE operator_log ADD COLUMN cutter_frequency_hz REAL;
ALTER TABLE operator_log ADD COLUMN main_thrust_text TEXT;
ALTER TABLE operator_log ADD COLUMN cumulative_footage_m REAL;
ALTER TABLE operator_log ADD COLUMN horizontal_deviation_direction TEXT;
ALTER TABLE operator_log ADD COLUMN horizontal_deviation_mm REAL;
ALTER TABLE operator_log ADD COLUMN vertical_deviation_direction TEXT;
ALTER TABLE operator_log ADD COLUMN vertical_deviation_mm REAL;
