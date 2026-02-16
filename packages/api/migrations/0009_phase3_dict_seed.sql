-- Phase 3: 对外付款 — dictionary seed data

-- contract_type (合同类型) — already partially seeded in Phase 1, add if missing
INSERT OR IGNORE INTO sys_dict (dict_type, dict_label, dict_value, sort_order, status, created_at, updated_at)
VALUES
  ('contract_type', '人工',   'labor',     1, 'active', datetime('now'), datetime('now')),
  ('contract_type', '机械',   'machinery', 2, 'active', datetime('now'), datetime('now')),
  ('contract_type', '总包',   'general',   3, 'active', datetime('now'), datetime('now')),
  ('contract_type', '材料',   'material',  4, 'active', datetime('now'), datetime('now')),
  ('contract_type', '其他',   'other',     5, 'active', datetime('now'), datetime('now'));

-- payment_category (付款类别)
INSERT OR IGNORE INTO sys_dict (dict_type, dict_label, dict_value, sort_order, status, created_at, updated_at)
VALUES
  ('payment_category', '特殊审批', 'special_approval', 1, 'active', datetime('now'), datetime('now')),
  ('payment_category', '行政费',   'admin_fee',        2, 'active', datetime('now'), datetime('now')),
  ('payment_category', '劳务费',   'labor_fee',        3, 'active', datetime('now'), datetime('now')),
  ('payment_category', '机械费',   'machinery_fee',    4, 'active', datetime('now'), datetime('now')),
  ('payment_category', '材料费',   'material_fee',     5, 'active', datetime('now'), datetime('now')),
  ('payment_category', '分包费',   'subcontract_fee',  6, 'active', datetime('now'), datetime('now')),
  ('payment_category', '其他费用', 'other_fee',        7, 'active', datetime('now'), datetime('now'));

-- contract_direction (合同方向)
INSERT OR IGNORE INTO sys_dict (dict_type, dict_label, dict_value, sort_order, status, created_at, updated_at)
VALUES
  ('contract_direction', '对外付款', 'outbound', 1, 'active', datetime('now'), datetime('now')),
  ('contract_direction', '收款',     'inbound',  2, 'active', datetime('now'), datetime('now'));

-- contract_status (合同状态 — for display labels)
INSERT OR IGNORE INTO sys_dict (dict_type, dict_label, dict_value, sort_order, status, created_at, updated_at)
VALUES
  ('contract_status', '草稿',   'draft',            1, 'active', datetime('now'), datetime('now')),
  ('contract_status', '待审查', 'pending_review',   2, 'active', datetime('now'), datetime('now')),
  ('contract_status', '待审批', 'pending_approval', 3, 'active', datetime('now'), datetime('now')),
  ('contract_status', '生效中', 'active',           4, 'active', datetime('now'), datetime('now')),
  ('contract_status', '已完成', 'completed',        5, 'active', datetime('now'), datetime('now')),
  ('contract_status', '已终止', 'terminated',       6, 'active', datetime('now'), datetime('now'));

-- payment_request_status (付款申请状态)
INSERT OR IGNORE INTO sys_dict (dict_type, dict_label, dict_value, sort_order, status, created_at, updated_at)
VALUES
  ('payment_request_status', '草稿',   'draft',            1, 'active', datetime('now'), datetime('now')),
  ('payment_request_status', '待审批', 'pending_approval', 2, 'active', datetime('now'), datetime('now')),
  ('payment_request_status', '已审批', 'approved',         3, 'active', datetime('now'), datetime('now')),
  ('payment_request_status', '已付款', 'paid',             4, 'active', datetime('now'), datetime('now')),
  ('payment_request_status', '已拒绝', 'rejected',         5, 'active', datetime('now'), datetime('now')),
  ('payment_request_status', '已取消', 'cancelled',        6, 'active', datetime('now'), datetime('now'));
