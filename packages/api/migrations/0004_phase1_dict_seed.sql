INSERT OR IGNORE INTO sys_dict (dict_type, dict_label, dict_value, sort_order, status, created_at, updated_at)
VALUES
  ('payment_method', '银行转账', 'bank_transfer', 10, 'active', datetime('now'), datetime('now')),
  ('payment_method', '现金', 'cash', 20, 'active', datetime('now'), datetime('now')),
  ('payment_method', '支票', 'check', 30, 'active', datetime('now'), datetime('now')),
  ('expense_category', '材料费', 'material', 10, 'active', datetime('now'), datetime('now')),
  ('expense_category', '人工费', 'labor', 20, 'active', datetime('now'), datetime('now')),
  ('expense_category', '机械费', 'machine', 30, 'active', datetime('now'), datetime('now')),
  ('contract_type', '对外付款合同', 'outbound', 10, 'active', datetime('now'), datetime('now')),
  ('contract_type', '收款合同', 'inbound', 20, 'active', datetime('now'), datetime('now')),
  ('soil_type', '粉质黏土', 'silty_clay', 10, 'active', datetime('now'), datetime('now')),
  ('soil_type', '砂土', 'sand', 20, 'active', datetime('now'), datetime('now')),
  ('pipe_type', '钢筋混凝土管', 'rcp', 10, 'active', datetime('now'), datetime('now')),
  ('pipe_type', '钢管', 'steel_pipe', 20, 'active', datetime('now'), datetime('now')),
  ('tbm_type', '泥水平衡', 'slurry_shield', 10, 'active', datetime('now'), datetime('now')),
  ('tbm_type', '土压平衡', 'epb', 20, 'active', datetime('now'), datetime('now'));
