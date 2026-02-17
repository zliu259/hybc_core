ALTER TABLE approval_instance
ADD COLUMN instance_config_json TEXT;

ALTER TABLE approval_node_instance
ADD COLUMN timeout_hours INTEGER;
