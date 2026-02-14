INSERT OR IGNORE INTO sys_dict (dict_type, dict_label, dict_value, sort_order, status, created_at, updated_at)
VALUES
  ('approval_biz_type', '对外付款', 'payment_approval', 1, 'active', datetime('now'), datetime('now')),
  ('approval_biz_type', '报销', 'reimbursement_approval', 2, 'active', datetime('now'), datetime('now')),
  ('approval_biz_type', '合同', 'contract_approval', 3, 'active', datetime('now'), datetime('now')),
  ('approval_biz_type', '收款', 'receipt_approval', 4, 'active', datetime('now'), datetime('now')),
  ('approval_biz_type', '项目变更', 'project_change', 5, 'active', datetime('now'), datetime('now')),

  ('approval_node_type', '顺序签', 'sequential', 1, 'active', datetime('now'), datetime('now')),
  ('approval_node_type', '会签', 'countersign', 2, 'active', datetime('now'), datetime('now')),
  ('approval_node_type', '或签', 'or_sign', 3, 'active', datetime('now'), datetime('now')),
  ('approval_node_type', '自动', 'auto', 4, 'active', datetime('now'), datetime('now')),
  ('approval_node_type', '抄送', 'cc', 5, 'active', datetime('now'), datetime('now')),
  ('approval_node_type', 'AI关卡', 'ai_gate', 6, 'active', datetime('now'), datetime('now')),

  ('ai_task_type', '合同审查', 'contract_review', 1, 'active', datetime('now'), datetime('now')),
  ('ai_task_type', '风险评估', 'risk_assessment', 2, 'active', datetime('now'), datetime('now')),
  ('ai_task_type', '报销异常检测', 'reimbursement_check', 3, 'active', datetime('now'), datetime('now')),
  ('ai_task_type', '日志分析', 'log_analysis', 4, 'active', datetime('now'), datetime('now')),
  ('ai_task_type', '设备推荐', 'equipment_recommend', 5, 'active', datetime('now'), datetime('now')),
  ('ai_task_type', 'OCR提取', 'ocr_extract', 6, 'active', datetime('now'), datetime('now')),
  ('ai_task_type', '文件生成', 'file_generate', 7, 'active', datetime('now'), datetime('now')),
  ('ai_task_type', '审批AI关卡', 'approval_ai_gate', 8, 'active', datetime('now'), datetime('now')),

  ('approval_instance_status', '待处理', 'pending', 1, 'active', datetime('now'), datetime('now')),
  ('approval_instance_status', '进行中', 'in_progress', 2, 'active', datetime('now'), datetime('now')),
  ('approval_instance_status', '已通过', 'approved', 3, 'active', datetime('now'), datetime('now')),
  ('approval_instance_status', '已驳回', 'rejected', 4, 'active', datetime('now'), datetime('now')),
  ('approval_instance_status', '已取消', 'cancelled', 5, 'active', datetime('now'), datetime('now')),
  ('approval_instance_status', '已撤回', 'withdrawn', 6, 'active', datetime('now'), datetime('now'));

INSERT OR IGNORE INTO approval_template (template_code, template_name, biz_type, config_json, status, created_by, created_at, updated_at)
VALUES (
  'TPL-PAYMENT-DEFAULT',
  '默认付款审批模板',
  'payment_approval',
  '{"version":1,"start_key":"start","nodes":[{"key":"start","type":"start","name":"开始","next_key":"mgr_review"},{"key":"mgr_review","type":"sequential","name":"项目经理审核","assignee_rule":{"type":"role","value":"manager"},"next_key":"finance_review"},{"key":"finance_review","type":"sequential","name":"财务审核","assignee_rule":{"type":"role","value":"super_admin"},"next_key":"end"},{"key":"end","type":"end","name":"结束"}]}',
  'active',
  'system',
  datetime('now'),
  datetime('now')
);
