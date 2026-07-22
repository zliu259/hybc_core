-- 0064_contract_draft_ai_seed.sql — cf_ai provider（Worker 内 env.AI 直调）+ 合同起草三件套提示词与路由
INSERT INTO ai_provider_config
  (provider_key, provider_name, api_endpoint, model_id, config_json, priority, max_concurrent, status, created_at, updated_at)
SELECT
  'cf_ai', 'Cloudflare AI (Unified Billing)', NULL, 'openai/gpt-5.6-terra',
  '{"models":["openai/gpt-5.6-terra","anthropic/claude-sonnet-5"],"disabled_models":["openai/gpt-5.6-sol"],"critic_cross":true}',
  90, 5, 'active',
  strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE NOT EXISTS (SELECT 1 FROM ai_provider_config WHERE provider_key = 'cf_ai');

INSERT INTO ai_prompt_template
  (template_key, template_name, system_prompt, user_prompt_template, variables_schema, version, status, created_at, updated_at)
VALUES (
  'prompt-contract-draft-section-v1',
  '合同起草-单节生成',
  '你是恒越百川建设集团的建设工程合同起草助手，专注顶管施工领域。你起草的是合同草稿中的单个条款节，必须以我方立场行文：direction=inbound 时我方是乙方（承包人），条款须明确、可执行、避免含糊表述，充分保护承包人的计价、付款、签证索赔与工期顺延权利；direction=outbound 时我方是甲方（发包人），在合法边界内合理传导责任、明确分包商义务。硬性合规红线：只允许引用现行有效的法律法规（严禁引用已废止的《中华人民共和国合同法》）；不得生成以下无效或违法条款：免除人身损害责任或免除故意及重大过失责任的免责条款（民法典第506条）、以第三方付款为付款前提的背靠背条款、转包或违法再分包安排、超过结算总额3%的质量保证金、将安全生产法定责任约定转移给他方的条款；不得编造身份证号、银行账号等具体个人敏感信息，一律使用{{xxx}}占位符；正文中已有的{{xxx}}占位符必须原样保留。你必须只输出一个JSON对象（禁止markdown代码块），字段：content（该节完整正文，string）、risk_spans（数组，每项{"text":"必须是content中逐字出现的片段","level":"red或yellow","reason":"风险说明","legal_basis":"法条依据，可空字符串"}）。对我方存在风险、让步或可能被认定无效的表述，逐条列入risk_spans。',
  '合同方向={{direction}}。节标识={{section_key}}，节标题={{section_title}}。默认条款骨架：{{body_template}}。范本风格参考（仅借鉴语言风格，不得照抄其中不合规内容；可能为空）：{{style_ref}}。工程关键信息JSON：{{keywords_json}}。使用者补充指令（可能为空）：{{instruction}}。请基于骨架起草该节完整正文：补充指令与骨架冲突时以补充指令为准，但不得突破系统合规红线。',
  '{"direction":"string","section_key":"string","section_title":"string","body_template":"string","style_ref":"string","keywords_json":"string","instruction":"string"}',
  1, 'active', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
)
ON CONFLICT(template_key) DO UPDATE SET
  template_name = excluded.template_name,
  system_prompt = excluded.system_prompt,
  user_prompt_template = excluded.user_prompt_template,
  variables_schema = excluded.variables_schema,
  version = excluded.version,
  status = 'active',
  updated_at = excluded.updated_at;

INSERT INTO ai_prompt_template
  (template_key, template_name, system_prompt, user_prompt_template, variables_schema, version, status, created_at, updated_at)
VALUES (
  'prompt-contract-compliance-review-v1',
  '合同起草-合规交叉审查',
  '你是建设工程合同合规审查助手，以《中华人民共和国民法典》为基准。你收到一节由另一个模型起草的合同条款，请以挑错立场独立审查：（1）无效条款：民法典第506条免责条款、第496-497条格式条款问题、以第三方付款为前提的背靠背条款、转包或违法分包、质保金超过结算总额3%、安全生产法定责任转移；（2）对我方立场不利的让步或陷阱；（3）表述含糊可能引发争议之处；（4）法律引用是否现行有效。你必须只输出一个JSON对象（禁止markdown代码块）：{"overall":"pass|warn|fail","issues":[{"text":"条款中逐字出现的片段","severity":"red|yellow","reason":"问题说明","legal_basis":"法条依据，可空","suggestion":"修改建议"}]}。没有问题时issues为空数组、overall为pass。',
  '合同方向={{direction}}（inbound=我方为乙方承包人，outbound=我方为甲方发包人）。节标题={{section_title}}。待审条款正文：{{content}}',
  '{"direction":"string","section_title":"string","content":"string"}',
  1, 'active', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
)
ON CONFLICT(template_key) DO UPDATE SET
  template_name = excluded.template_name,
  system_prompt = excluded.system_prompt,
  user_prompt_template = excluded.user_prompt_template,
  variables_schema = excluded.variables_schema,
  version = excluded.version,
  status = 'active',
  updated_at = excluded.updated_at;

INSERT INTO ai_prompt_template
  (template_key, template_name, system_prompt, user_prompt_template, variables_schema, version, status, created_at, updated_at)
VALUES (
  'prompt-contract-completeness-check-v1',
  '合同起草-完整性遗漏提示',
  '你是建设工程合同完整性检查助手。给你一份顶管施工合同草稿当前包含的节列表、合同方向与工程参数，请对照候选节全集与民法典第470条建议条款，指出缺失且建议补充的节。只做提示，不强制。你必须只输出一个JSON对象（禁止markdown代码块）：{"missing":[{"section_key":"候选全集中的key","title":"节标题","level":"core|recommended","reason":"为什么该合同需要这一节"}]}。已存在的节、候选全集之外的节、与该合同方向无关的节都不要列出；没有缺失时missing为空数组。',
  '合同方向={{direction}}。候选节全集JSON：{{catalog_json}}。当前已有节JSON数组：{{present_sections_json}}。工程关键信息JSON：{{keywords_json}}。请列出缺失且建议补充的节及理由。',
  '{"direction":"string","catalog_json":"string","present_sections_json":"string","keywords_json":"string"}',
  1, 'active', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
)
ON CONFLICT(template_key) DO UPDATE SET
  template_name = excluded.template_name,
  system_prompt = excluded.system_prompt,
  user_prompt_template = excluded.user_prompt_template,
  variables_schema = excluded.variables_schema,
  version = excluded.version,
  status = 'active',
  updated_at = excluded.updated_at;

-- 路由规则：三个 task_type → cf_ai + 对应模板（幂等：先 UPDATE 再 NOT EXISTS INSERT，照 0050 模式）
UPDATE ai_routing_rule
   SET provider_id = (SELECT id FROM ai_provider_config WHERE provider_key='cf_ai' LIMIT 1),
       prompt_template_id = (SELECT id FROM ai_prompt_template WHERE template_key='prompt-contract-draft-section-v1' LIMIT 1),
       priority = 1, status = 'active', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE rule_name = 'CFAI_CONTRACT_DRAFT_SECTION_DEFAULT';
INSERT INTO ai_routing_rule
  (rule_name, biz_type, task_type, condition_json, provider_id, prompt_template_id, priority, status, created_at, updated_at)
SELECT 'CFAI_CONTRACT_DRAFT_SECTION_DEFAULT', 'contract_draft', 'contract_draft_section', NULL, p.id, t.id, 1, 'active',
       strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM ai_provider_config p JOIN ai_prompt_template t ON t.template_key='prompt-contract-draft-section-v1'
WHERE p.provider_key='cf_ai'
  AND NOT EXISTS (SELECT 1 FROM ai_routing_rule WHERE rule_name='CFAI_CONTRACT_DRAFT_SECTION_DEFAULT');

UPDATE ai_routing_rule
   SET provider_id = (SELECT id FROM ai_provider_config WHERE provider_key='cf_ai' LIMIT 1),
       prompt_template_id = (SELECT id FROM ai_prompt_template WHERE template_key='prompt-contract-compliance-review-v1' LIMIT 1),
       priority = 1, status = 'active', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE rule_name = 'CFAI_CONTRACT_COMPLIANCE_REVIEW_DEFAULT';
INSERT INTO ai_routing_rule
  (rule_name, biz_type, task_type, condition_json, provider_id, prompt_template_id, priority, status, created_at, updated_at)
SELECT 'CFAI_CONTRACT_COMPLIANCE_REVIEW_DEFAULT', 'contract_draft', 'contract_compliance_review', NULL, p.id, t.id, 1, 'active',
       strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM ai_provider_config p JOIN ai_prompt_template t ON t.template_key='prompt-contract-compliance-review-v1'
WHERE p.provider_key='cf_ai'
  AND NOT EXISTS (SELECT 1 FROM ai_routing_rule WHERE rule_name='CFAI_CONTRACT_COMPLIANCE_REVIEW_DEFAULT');

UPDATE ai_routing_rule
   SET provider_id = (SELECT id FROM ai_provider_config WHERE provider_key='cf_ai' LIMIT 1),
       prompt_template_id = (SELECT id FROM ai_prompt_template WHERE template_key='prompt-contract-completeness-check-v1' LIMIT 1),
       priority = 1, status = 'active', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE rule_name = 'CFAI_CONTRACT_COMPLETENESS_CHECK_DEFAULT';
INSERT INTO ai_routing_rule
  (rule_name, biz_type, task_type, condition_json, provider_id, prompt_template_id, priority, status, created_at, updated_at)
SELECT 'CFAI_CONTRACT_COMPLETENESS_CHECK_DEFAULT', 'contract_draft', 'contract_completeness_check', NULL, p.id, t.id, 1, 'active',
       strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM ai_provider_config p JOIN ai_prompt_template t ON t.template_key='prompt-contract-completeness-check-v1'
WHERE p.provider_key='cf_ai'
  AND NOT EXISTS (SELECT 1 FROM ai_routing_rule WHERE rule_name='CFAI_CONTRACT_COMPLETENESS_CHECK_DEFAULT');
