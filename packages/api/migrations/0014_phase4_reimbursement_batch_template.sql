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
  'TPL-REIMBURSEMENT-BATCH',
  '报销批次集中审批模板',
  'reimbursement_batch',
  '{"version":1,"start_key":"dept_review","nodes":[{"key":"dept_review","type":"sequential","name":"部门负责人审批","assignee_userids":["site_manager"],"next_key":"finance_review"},{"key":"finance_review","type":"sequential","name":"财务复核","assignee_userids":["finance_manager"],"conditions":[{"field":"amount","operator":"gt","value":20000,"next_key":"gm_review"}],"default_next_key":"archive_cc"},{"key":"gm_review","type":"sequential","name":"总经理审批","assignee_userids":["general_manager"],"next_key":"archive_cc"},{"key":"archive_cc","type":"cc","name":"抄送归档","assignee_userids":["manager"],"next_key":null}]}',
  'active',
  'system',
  datetime('now'),
  datetime('now')
);
