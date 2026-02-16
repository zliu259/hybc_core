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
  'TPL-CONTRACT-AMOUNT-CHANGE',
  '合同金额变更审批模板',
  'contract_amount_change',
  '{"version":1,"start_key":"dept_approve","nodes":[{"key":"dept_approve","type":"sequential","name":"部门负责人审批","assignee_userids":["manager"],"next_key":"finance_review"},{"key":"finance_review","type":"sequential","name":"财务审批","assignee_userids":["finance_manager"],"conditions":[{"field":"amount","operator":"gt","value":500000,"next_key":"gm_approve"}],"default_next_key":"notify_cc"},{"key":"gm_approve","type":"sequential","name":"总经理审批","assignee_userids":["general_manager"],"next_key":"notify_cc"},{"key":"notify_cc","type":"cc","name":"抄送归档","assignee_userids":["site_manager"],"next_key":null}]}',
  'active',
  'system',
  datetime('now'),
  datetime('now')
);
