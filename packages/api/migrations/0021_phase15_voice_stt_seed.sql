INSERT OR IGNORE INTO sys_dict (
  dict_type,
  dict_label,
  dict_value,
  sort_order,
  status,
  created_at,
  updated_at
)
VALUES
  ('ai_task_type', '语音识别', 'voice_stt', 9, 'active', datetime('now'), datetime('now'));
