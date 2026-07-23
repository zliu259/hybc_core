-- 0071_completeness_audit_routing.sql
-- 完整检查拆两阶段异步任务（修复单任务串行两次大调用超时卡死）：
-- 新增 contract_completeness_audit 任务类型的路由规则，指向复核提示词、走 cf_ai。
-- 初版 contract_completeness_check 的路由规则已存在（0064 起），无需改动。

UPDATE ai_routing_rule
   SET provider_id = (SELECT id FROM ai_provider_config WHERE provider_key='cf_ai' LIMIT 1),
       prompt_template_id = (SELECT id FROM ai_prompt_template WHERE template_key='prompt-contract-completeness-audit-v1' LIMIT 1),
       priority = 1, status = 'active', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE rule_name = 'CFAI_CONTRACT_COMPLETENESS_AUDIT_DEFAULT';

INSERT INTO ai_routing_rule
  (rule_name, biz_type, task_type, condition_json, provider_id, prompt_template_id, priority, status, created_at, updated_at)
SELECT 'CFAI_CONTRACT_COMPLETENESS_AUDIT_DEFAULT', 'contract_draft', 'contract_completeness_audit', NULL, p.id, t.id, 1, 'active',
       strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM ai_provider_config p JOIN ai_prompt_template t ON t.template_key='prompt-contract-completeness-audit-v1'
WHERE p.provider_key='cf_ai'
  AND NOT EXISTS (SELECT 1 FROM ai_routing_rule WHERE rule_name='CFAI_CONTRACT_COMPLETENESS_AUDIT_DEFAULT');
