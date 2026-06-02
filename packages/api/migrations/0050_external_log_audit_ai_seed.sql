-- Ensure external log AI audit has a dedicated prompt and routing rule in D1.
-- Existing pending tasks resolve prompt templates at poll time, so this also
-- fixes queued external_log_audit tasks once a capable runner picks them up.

INSERT INTO ai_prompt_template
  (template_key, template_name, system_prompt, user_prompt_template,
   variables_schema, version, status, created_at, updated_at)
VALUES (
  'prompt-external-log-audit-v1',
  '外包日志AI审计默认提示词',
  '你是施工项目日志审计助手。你必须仅输出JSON对象，不要使用markdown代码块。字段固定为decision、risk_level、score、summary、issues。decision只能是auto_approve或needs_manual_review；risk_level只能是low、medium、high；score为0-100整数；issues为数组，每项包含severity和message。',
  '请审计外包人员提交的标段施工日志和项目日志。任务类型={{task_type}}，业务ID={{biz_id}}。输入JSON={{payload_json}}。重点检查：1) 标段施工日志与历史施工日志的连续性，累计下管数量不能倒退，进尺和下管数量应合理；2) 同项目同标段同日期同班次是否重复；3) 施工日志与项目日志在停工、风险、天气、土质、问题描述上是否矛盾；4) 必填字段是否完整；5) 日期是否符合项目施工周期；6) 文本是否明显无意义或模板化。只有无硬性错误且风险低时输出auto_approve，否则输出needs_manual_review并列明问题。',
  '{"payload_json":"string"}',
  1,
  'active',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
ON CONFLICT(template_key) DO UPDATE SET
  template_name = excluded.template_name,
  system_prompt = excluded.system_prompt,
  user_prompt_template = excluded.user_prompt_template,
  variables_schema = excluded.variables_schema,
  version = excluded.version,
  status = 'active',
  updated_at = excluded.updated_at;

UPDATE ai_routing_rule
   SET biz_type = 'external_log_submission',
       task_type = 'external_log_audit',
       provider_id = (
         SELECT id
           FROM ai_provider_config
          WHERE provider_key = 'openai'
            AND status = 'active'
          ORDER BY priority ASC, id ASC
          LIMIT 1
       ),
       prompt_template_id = (
         SELECT id
           FROM ai_prompt_template
          WHERE template_key = 'prompt-external-log-audit-v1'
          LIMIT 1
       ),
       priority = 1,
       status = 'active',
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE rule_name = 'OPENAI_EXTERNAL_LOG_AUDIT_DEFAULT';

INSERT INTO ai_routing_rule
  (rule_name, biz_type, task_type, condition_json, provider_id, prompt_template_id,
   priority, status, created_at, updated_at)
SELECT
  'OPENAI_EXTERNAL_LOG_AUDIT_DEFAULT',
  'external_log_submission',
  'external_log_audit',
  NULL,
  p.id,
  t.id,
  1,
  'active',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM ai_provider_config p
JOIN ai_prompt_template t ON t.template_key = 'prompt-external-log-audit-v1'
WHERE p.provider_key = 'openai'
  AND p.status = 'active'
  AND NOT EXISTS (
    SELECT 1
      FROM ai_routing_rule
     WHERE rule_name = 'OPENAI_EXTERNAL_LOG_AUDIT_DEFAULT'
  )
ORDER BY p.priority ASC, p.id ASC
LIMIT 1;
