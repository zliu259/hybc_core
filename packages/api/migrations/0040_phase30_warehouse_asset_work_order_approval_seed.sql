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
  'TPL-WAREHOUSE-ASSET-WORK-ORDER',
  '库房资产工单审批模板',
  'warehouse_asset_work_order',
  '{"version":1,"start_key":"warehouse_manager_review","nodes":[{"key":"warehouse_manager_review","type":"sequential","name":"库房负责人审批","assignee_userids":["manager"],"next_key":"equipment_manager_review"},{"key":"equipment_manager_review","type":"sequential","name":"设备负责人审批","assignee_userids":["site_manager"],"next_key":"notify_cc"},{"key":"notify_cc","type":"cc","name":"抄送归档","assignee_userids":["manager"],"next_key":null}]}',
  'active',
  'system',
  datetime('now'),
  datetime('now')
);
