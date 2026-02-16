INSERT OR IGNORE INTO approval_template (
  template_code,
  template_name,
  biz_type,
  config_json,
  status,
  created_by,
  created_at,
  updated_at
) VALUES (
  'TPL-OUTBOUND-CONTRACT',
  '对外付款合同审批模板',
  'outbound_contract',
  '{"version":1,"start_key":"submit_lead","nodes":[{"key":"submit_lead","type":"sequential","name":"经办负责人审批","assignee_userids":["manager"],"next_key":"finance_review"},{"key":"finance_review","type":"sequential","name":"财务复核","assignee_userids":["finance_manager"],"next_key":"legal_review"},{"key":"legal_review","type":"sequential","name":"法务审查","assignee_userids":["legal_manager"],"next_key":"gm_approve"},{"key":"gm_approve","type":"or_sign","name":"总经理审批","assignee_userids":["general_manager"],"next_key":"notify_cc"},{"key":"notify_cc","type":"cc","name":"抄送归档","assignee_userids":["finance_manager"],"next_key":null}]}',
  'active',
  'system',
  datetime('now'),
  datetime('now')
);

INSERT OR IGNORE INTO approval_template (
  template_code,
  template_name,
  biz_type,
  config_json,
  status,
  created_by,
  created_at,
  updated_at
) VALUES (
  'TPL-PAYMENT-REQUEST',
  '付款申请审批模板',
  'payment_request',
  '{"version":1,"start_key":"dept_approve","nodes":[{"key":"dept_approve","type":"sequential","name":"部门负责人审批","assignee_userids":["site_manager"],"next_key":"ai_gate_risk"},{"key":"ai_gate_risk","type":"ai_gate","name":"AI风险关卡","ai_slot_id":"payment_risk_assessment","next_key":"finance_review"},{"key":"finance_review","type":"sequential","name":"财务审批","assignee_userids":["finance_manager"],"conditions":[{"field":"amount","operator":"gt","value":500000,"next_key":"gm_approve"}],"default_next_key":"cashier_execute"},{"key":"gm_approve","type":"sequential","name":"总经理审批","assignee_userids":["general_manager"],"next_key":"cashier_execute"},{"key":"cashier_execute","type":"auto","name":"出纳执行","auto_action":"approve","next_key":"notify_cc"},{"key":"notify_cc","type":"cc","name":"抄送归档","assignee_userids":["site_manager"],"next_key":null}]}',
  'active',
  'system',
  datetime('now'),
  datetime('now')
);

INSERT OR IGNORE INTO approval_threshold (
  template_id,
  condition_field,
  operator,
  threshold_value,
  threshold_value_upper,
  target_branch,
  priority,
  status,
  created_at,
  updated_at
)
SELECT id, 'amount', 'lte', 100000, NULL, 'default', 1, 'active', datetime('now'), datetime('now')
FROM approval_template
WHERE template_code = 'TPL-PAYMENT-REQUEST';

INSERT OR IGNORE INTO approval_threshold (
  template_id,
  condition_field,
  operator,
  threshold_value,
  threshold_value_upper,
  target_branch,
  priority,
  status,
  created_at,
  updated_at
)
SELECT id, 'amount', 'between', 100000, 500000, 'mid_amount', 2, 'active', datetime('now'), datetime('now')
FROM approval_template
WHERE template_code = 'TPL-PAYMENT-REQUEST';

INSERT OR IGNORE INTO approval_threshold (
  template_id,
  condition_field,
  operator,
  threshold_value,
  threshold_value_upper,
  target_branch,
  priority,
  status,
  created_at,
  updated_at
)
SELECT id, 'amount', 'gt', 500000, NULL, 'high_amount', 3, 'active', datetime('now'), datetime('now')
FROM approval_template
WHERE template_code = 'TPL-PAYMENT-REQUEST';
