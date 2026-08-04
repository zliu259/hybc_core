-- 0077_contract_precheck.sql
-- 实用工具·合同预审：员工上传对方提供的合同（前端提取文本），Worker 内经 CF AI
-- Gateway（cf_ai provider，与合同生成同链路）做多维合规审计，合并
-- contract-draft-rules 确定性红线规则；无「明显错误」（AI critical / 规则 red）
-- 且用户确认与对方完成签署后，才可转入合同台账进入我方审批流。
-- 状态机：draft → reviewing → passed|reviewed|review_failed →（复审循环）→ signed → transferred

CREATE TABLE IF NOT EXISTS contract_precheck (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  precheck_no TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  direction TEXT NOT NULL DEFAULT 'inbound',      -- 我方立场：inbound 我方乙方/收款 | outbound 我方甲方/付款
  counterparty TEXT,
  created_by_userid TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',           -- draft|reviewing|passed|reviewed|review_failed|signed|transferred|deleted
  current_round INTEGER NOT NULL DEFAULT 0,
  file_key TEXT,                                   -- 最新上传原件 R2 key（contract-precheck/ 前缀）
  file_name TEXT,
  file_size INTEGER,
  contract_text TEXT,                              -- 最新提取送审文本（前端 mammoth/pdfjs 提取）
  review_task_id INTEGER,                          -- 最新审计任务指针（轮询/超时回收以此为准）
  review_result_json TEXT,                         -- 最新一轮结果 {summary, overall, issues, rule_findings, model}
  adopted_json TEXT,                               -- 已采纳修改建议 [{issue_index, adopted_at}]
  signed_confirmed_at TEXT,
  signed_comment TEXT,
  contract_id INTEGER,                             -- 转入的合同
  transferred_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_contract_precheck_created_by ON contract_precheck(created_by_userid);
CREATE INDEX IF NOT EXISTS idx_contract_precheck_status ON contract_precheck(status);
CREATE INDEX IF NOT EXISTS idx_contract_precheck_review_task ON contract_precheck(review_task_id);

CREATE TABLE IF NOT EXISTS contract_precheck_round (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  precheck_id INTEGER NOT NULL,
  round INTEGER NOT NULL,
  file_key TEXT,
  file_name TEXT,
  task_id INTEGER,
  status TEXT NOT NULL DEFAULT 'reviewing',        -- reviewing|done|error
  result_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_contract_precheck_round_precheck ON contract_precheck_round(precheck_id);
CREATE INDEX IF NOT EXISTS idx_contract_precheck_round_task ON contract_precheck_round(task_id);

-- ─── 提示词模板（cf_ai provider 已由 0064 播种，此处只建模板与路由） ───

INSERT INTO ai_prompt_template
  (template_key, template_name, system_prompt, user_prompt_template, variables_schema, version, status, created_at, updated_at)
VALUES (
  'prompt-contract-precheck-v1',
  '合同预审多维审计',
  '你是恒越百川建设集团的合同预审AI，审计对象是对方提供的合同文本，结果用于员工在签署前发现问题并向对方提出修改意见。只基于给定合同文本判断，quote必须是合同文本中逐字出现的片段，禁止编造；结论优先、表述精简：summary不超过80字，problem不超过50字，suggestion是修改后的条款文本、不超过120字；风险分级由你按标准判定但不允许输出任何分数字段；只输出一个JSON对象，不要markdown代码块，不要输出JSON以外的任何文字。硬性红线（命中即critical）：引用已废止《合同法》、民法典第506条无效免责（人身损害/故意重大过失）、第496-497条格式条款不合理免责或预先弃权、背靠背付款及其变体（法释〔2024〕11号对中小企业无效）、《建筑法》第28-29条转包/违法再分包、质保金超结算总额3%、法定安全责任约定转移、第525-527条预先放弃履行抗辩权。',
  '【我方立场】{{direction_label}}
【合同标题】{{title}}　【对方主体】{{counterparty}}
逐维度审计（dimension使用英文标识，每个维度至少检查一遍，有问题才输出issue）：
1) subject_signing 主体与签署要件：对方主体信息完整性、签署人权限、签章要求；
2) clause_completeness 条款完整性：对照民法典第470条，金额/工期/验收/结算/违约责任/争议解决等关键条款是否缺失或空白；
3) amount_payment 金额与支付：金额大小写一致、付款节点与比例合计、发票税率约定、结算方式是否明确；
4) liability_balance 权责对等：违约金是否单向或畸高（民法典第585条）、扣款权是否无程序约束、结算是否终局锁死追索；
5) invalid_terms 无效条款红线：见系统提示词硬性红线清单；
6) stance_risk 我方立场风险：结合我方立场识别单方不利安排（inbound重点：计价/付款/签证索赔/工期顺延权利被削弱；outbound重点：责任传导缺失、分包义务不明）。
输出JSON：{"summary":"不超过80字，先总体结论后最关键问题","overall":"pass|minor|major|critical","issues":[{"dimension":"英文标识","severity":"critical|major|minor","quote":"合同文本中逐字出现的片段，不超过60字，条款缺失类可为空字符串","problem":"不超过50字","suggestion":"修改后的条款文本，不超过120字"}]}
规则：issues最多12条按严重度排序；critical仅用于命中硬性红线、关键条款缺失或金额矛盾等明显错误；拿不准降级为minor并在problem中说明；全文无问题时issues为空数组且overall=pass。
【合同文本】
{{contract_text}}',
  '{"direction_label":"string","title":"string","counterparty":"string","contract_text":"string"}',
  1, 'active', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
ON CONFLICT(template_key) DO UPDATE SET
  template_name = excluded.template_name,
  system_prompt = excluded.system_prompt,
  user_prompt_template = excluded.user_prompt_template,
  variables_schema = excluded.variables_schema,
  version = excluded.version,
  status = 'active',
  updated_at = excluded.updated_at;

UPDATE ai_routing_rule SET
  provider_id = (SELECT id FROM ai_provider_config WHERE provider_key = 'cf_ai' LIMIT 1),
  prompt_template_id = (SELECT id FROM ai_prompt_template WHERE template_key = 'prompt-contract-precheck-v1' LIMIT 1),
  priority = 1, status = 'active',
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE rule_name = 'CFAI_CONTRACT_PRECHECK_DEFAULT';

INSERT INTO ai_routing_rule
  (rule_name, biz_type, task_type, condition_json, provider_id, prompt_template_id, priority, status, created_at, updated_at)
SELECT 'CFAI_CONTRACT_PRECHECK_DEFAULT', 'contract_precheck', 'contract_precheck_review', NULL,
       p.id, t.id, 1, 'active',
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM ai_provider_config p
JOIN ai_prompt_template t ON t.template_key = 'prompt-contract-precheck-v1'
WHERE p.provider_key = 'cf_ai'
  AND NOT EXISTS (SELECT 1 FROM ai_routing_rule WHERE rule_name = 'CFAI_CONTRACT_PRECHECK_DEFAULT');
