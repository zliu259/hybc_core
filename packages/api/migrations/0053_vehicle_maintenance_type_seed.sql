-- 在 0052 的基础上补充常见车辆保养类型字典（幂等，INSERT OR IGNORE 不影响已存在项）。
INSERT OR IGNORE INTO sys_dict (dict_type, dict_label, dict_value, sort_order, status, created_at, updated_at) VALUES
  ('vehicle_maintenance_type', '大保养', 'major_service', 15, 'active', datetime('now'), datetime('now')),
  ('vehicle_maintenance_type', '刹车系统', 'brake', 35, 'active', datetime('now'), datetime('now')),
  ('vehicle_maintenance_type', '电瓶更换', 'battery', 36, 'active', datetime('now'), datetime('now')),
  ('vehicle_maintenance_type', '空调系统', 'air_conditioning', 37, 'active', datetime('now'), datetime('now')),
  ('vehicle_maintenance_type', '钣金喷漆', 'bodywork', 38, 'active', datetime('now'), datetime('now'));
