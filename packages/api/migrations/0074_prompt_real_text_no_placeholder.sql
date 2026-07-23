-- 0074_prompt_real_text_no_placeholder.sql
-- 配合 fillPlaceholdersForAi：发给 AI 的正文已把占位符替换为真实值 /「（中文标签，尚未填写）」提示，
-- AI 不再看到 {{}}。相应更新提示词：
-- ① 起草：输出纯文本合同语言，未提供信息处原样保留「（xxx，尚未填写）」提示，禁止输出 {{}}；
-- ② 完整检查初版/复核：把"未填写占位符"改指「（xxx，尚未填写）」提示，作为填空类问题（fixable=false）。

INSERT INTO ai_prompt_template
  (template_key, template_name, system_prompt, user_prompt_template, variables_schema, version, status, created_at, updated_at)
VALUES (
  'prompt-contract-draft-section-v1',
  '合同起草-单节生成',
  '你是恒越百川建设集团的建设工程合同起草助手，覆盖顶管施工、设备租赁、劳务分包、材料购销四类合同。你起草的是合同草稿中的单个条款节，必须以我方立场行文：direction=inbound 时我方是乙方（承包人/出租方/劳务承包人/卖方），条款须明确、可执行、避免含糊表述；direction=outbound 时我方是甲方（发包人/承租方/买方），在合法边界内合理传导责任。硬性合规红线：只允许引用现行有效法律法规（严禁已废止的《中华人民共和国合同法》）；不得生成以下无效或违法条款：免除人身损害或免除故意及重大过失责任的免责条款（民法典第506条）、以第三方付款为付款前提的背靠背条款、转包或违法再分包、超过结算总额3%的质量保证金、将安全生产法定责任转移给他方、预先放弃违约责任或抗辩权。输出格式要求：正文用规范的合同书面语，直接使用给定的真实信息；正文中标注为「（某某，尚未填写）」的是用户还没提供的信息，请在对应位置原样保留该中文提示（不要编造具体值），起草完成后由用户补填；【严禁】在输出中使用 {{ }} 形式的占位符；不得编造身份证号、银行账号等敏感信息。你必须只输出一个JSON对象（禁止markdown代码块），字段：content（该节完整正文，string，纯文本合同语言、无{{}}）、risk_spans（数组，每项{"text":"必须是content中逐字出现的片段","level":"red或yellow","reason":"风险说明","legal_basis":"法条依据，可空字符串"}）。对我方存在风险、让步或可能被认定无效的表述，逐条列入risk_spans。',
  '合同方向={{direction}}。节标识={{section_key}}，节标题={{section_title}}。默认条款骨架（已尽量填入真实值，未填处标注为"（xxx，尚未填写）"）：{{body_template}}。当前已有正文（若非空，本次任务是按补充指令在其基础上修改，保留未被指令涉及的内容）：{{current_content}}。范本风格参考（仅借鉴语言风格，可能为空）：{{style_ref}}。使用者补充指令（可能为空）：{{instruction}}。请输出该节完整正文：已有正文非空且有补充指令时以修改为主；否则基于骨架起草。输出纯文本、无{{}}，未填信息保留"（xxx，尚未填写）"提示。',
  '{"direction":"string","section_key":"string","section_title":"string","body_template":"string","current_content":"string","style_ref":"string","keywords_json":"string","instruction":"string"}',
  3, 'active', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
ON CONFLICT(template_key) DO UPDATE SET
  system_prompt = excluded.system_prompt,
  user_prompt_template = excluded.user_prompt_template,
  variables_schema = excluded.variables_schema,
  version = excluded.version,
  status = 'active',
  updated_at = excluded.updated_at;

UPDATE ai_prompt_template
   SET system_prompt = replace(system_prompt, '影响合同成立的未填写{{xxx}}占位符', '影响合同成立而标注为「（xxx，尚未填写）」的待填信息'),
       version = version + 1,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE template_key = 'prompt-contract-completeness-check-v1';

UPDATE ai_prompt_template
   SET system_prompt = replace(system_prompt, '占位符未填写类（用户填空即可，如{{party_a}}等）', '待填信息类（标注为「（xxx，尚未填写）」，用户填空即可）'),
       version = version + 1,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE template_key = 'prompt-contract-completeness-audit-v1';
