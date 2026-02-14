-- Phase 3: 对外付款 — dictionary seed data

-- contract_type (合同类型) — already partially seeded in Phase 1, add if missing
INSERT OR IGNORE INTO sys_dict (dict_type, dict_key, dict_value, sort_order, status, created_at, updated_at)
VALUES
  ('contract_type', 'labor',     '人工',   1, 'active', datetime('now'), datetime('now')),
  ('contract_type', 'machinery', '机械',   2, 'active', datetime('now'), datetime('now')),
  ('contract_type', 'general',   '总包',   3, 'active', datetime('now'), datetime('now')),
  ('contract_type', 'material',  '材料',   4, 'active', datetime('now'), datetime('now')),
  ('contract_type', 'other',     '其他',   5, 'active', datetime('now'), datetime('now'));

-- payment_category (付款类别)
INSERT OR IGNORE INTO sys_dict (dict_type, dict_key, dict_value, sort_order, status, created_at, updated_at)
VALUES
  ('payment_category', 'special_approval', '特殊审批', 1, 'active', datetime('now'), datetime('now')),
  ('payment_category', 'admin_fee',        '行政费',   2, 'active', datetime('now'), datetime('now')),
  ('payment_category', 'labor_fee',        '劳务费',   3, 'active', datetime('now'), datetime('now')),
  ('payment_category', 'machinery_fee',    '机械费',   4, 'active', datetime('now'), datetime('now')),
  ('payment_category', 'material_fee',     '材料费',   5, 'active', datetime('now'), datetime('now')),
  ('payment_category', 'subcontract_fee',  '分包费',   6, 'active', datetime('now'), datetime('now')),
  ('payment_category', 'other_fee',        '其他费用', 7, 'active', datetime('now'), datetime('now'));

-- contract_direction (合同方向)
INSERT OR IGNORE INTO sys_dict (dict_type, dict_key, dict_value, sort_order, status, created_at, updated_at)
VALUES
  ('contract_direction', 'outbound', '对外付款', 1, 'active', datetime('now'), datetime('now')),
  ('contract_direction', 'inbound',  '收款',     2, 'active', datetime('now'), datetime('now'));

-- contract_status (合同状态 — for display labels)
INSERT OR IGNORE INTO sys_dict (dict_type, dict_key, dict_value, sort_order, status, created_at, updated_at)
VALUES
  ('contract_status', 'draft',            '草稿',     1, 'active', datetime('now'), datetime('now')),
  ('contract_status', 'pending_review',   '待审查',   2, 'active', datetime('now'), datetime('now')),
  ('contract_status', 'pending_approval', '待审批',   3, 'active', datetime('now'), datetime('now')),
  ('contract_status', 'active',           '生效中',   4, 'active', datetime('now'), datetime('now')),
  ('contract_status', 'completed',        '已完成',   5, 'active', datetime('now'), datetime('now')),
  ('contract_status', 'terminated',       '已终止',   6, 'active', datetime('now'), datetime('now'));

-- payment_request_status (付款申请状态)
INSERT OR IGNORE INTO sys_dict (dict_type, dict_key, dict_value, sort_order, status, created_at, updated_at)
VALUES
  ('payment_request_status', 'draft',            '草稿',     1, 'active', datetime('now'), datetime('now')),
  ('payment_request_status', 'pending_approval', '待审批',   2, 'active', datetime('now'), datetime('now')),
  ('payment_request_status', 'approved',         '已审批',   3, 'active', datetime('now'), datetime('now')),
  ('payment_request_status', 'paid',             '已付款',   4, 'active', datetime('now'), datetime('now')),
  ('payment_request_status', 'rejected',         '已拒绝',   5, 'active', datetime('now'), datetime('now')),
  ('payment_request_status', 'cancelled',        '已取消',   6, 'active', datetime('now'), datetime('now'));
