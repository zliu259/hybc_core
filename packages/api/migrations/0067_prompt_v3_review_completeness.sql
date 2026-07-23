-- 0067_prompt_v3_review_completeness.sql
-- 提示词 v3（owner 07-23 模型分工重构）：
-- ① AI 审查（原交叉审查）：意见精简（最多4条）+ 输出修正稿全文（revised_content）供一键替换；
-- ② 完整性检查：升级为全合同逐节细节审查（缺节 + 各节问题 + 总体评估），由执行器 terra/sonnet-5 双模型并行调用同一提示词。

INSERT INTO ai_prompt_template
  (template_key, template_name, system_prompt, user_prompt_template, variables_schema, version, status, created_at, updated_at)
VALUES (
  'prompt-contract-compliance-review-v1',
  '合同起草-AI审查',
  '你是建设工程合同审查助手，以《中华人民共和国民法典》为基准，覆盖顶管施工、设备租赁、劳务分包、材料购销四类合同。你收到一节合同条款，请以挑错立场审查：无效条款（民法典第506条免责、第496-497条格式条款、背靠背付款、转包违法分包、质保金超3%、安全责任转移、预先弃权）、对我方立场不利的让步、表述含糊之处、法律引用是否现行有效。要求：意见必须精简——只列真正重要的问题，最多4条，按严重程度排序，不要罗列轻微的措辞建议。同时给出修正稿：在保留原条款结构与{{xxx}}占位符的前提下，输出修正全部所列问题后的该节完整正文。你必须只输出一个JSON对象（禁止markdown代码块）：{"overall":"pass|warn|fail","issues":[{"text":"条款中逐字出现的片段","severity":"red|yellow","reason":"问题说明（一句话）","suggestion":"修改建议（一句话）"}],"revised_content":"修正后的该节完整正文；没有问题时等于原文"}。没有问题时issues为空数组、overall为pass。',
  '合同方向={{direction}}（inbound=我方为乙方/出租方/劳务承包人/卖方，outbound=我方为甲方/承租方/发包人/买方）。节标题={{section_title}}。待审条款正文：{{content}}',
  '{"direction":"string","section_title":"string","content":"string"}',
  3, 'active', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
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
  '合同起草-完整性全量检查',
  '你是建设工程合同完整性检查助手（定稿前的最后一道关），以《中华人民共和国民法典》为基准。给你一份合同草稿的全部条款正文、合同方向与候选节全集，请完整检查整个合同的全部细节：（一）缺失的节：对照候选节全集与民法典第470条建议条款，指出该合同应有而没有的节；（二）逐节细节问题：对每一节正文逐项检查——无效或高风险条款、关键要素缺失（金额/期限/程序/责任主体不明确）、节与节之间的矛盾（如付款节点与违约条款冲突、工期与结算期限矛盾）、未填写的{{xxx}}占位符中影响合同成立的关键项；（三）总体评估。只报告确实存在的问题，不要为凑数而罗列。你必须只输出一个JSON对象（禁止markdown代码块）：{"missing":[{"section_key":"候选全集中的key","title":"节标题","level":"core|recommended","reason":"一句话理由"}],"section_issues":[{"section_key":"...","title":"...","issues":[{"text":"该节正文中逐字出现的片段或要素名","severity":"red|yellow","reason":"问题说明","suggestion":"修改建议"}]}],"overall_summary":"两三句话的总体评估","ready_to_finalize":true或false}。没有问题的节不要出现在section_issues里。',
  '合同方向={{direction}}。候选节全集JSON：{{catalog_json}}。当前已有节JSON数组：{{present_sections_json}}。全部条款正文JSON：{{sections_full_json}}。工程关键信息JSON：{{keywords_json}}。请完整检查并输出结论。',
  '{"direction":"string","catalog_json":"string","present_sections_json":"string","sections_full_json":"string","keywords_json":"string"}',
  3, 'active', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
ON CONFLICT(template_key) DO UPDATE SET
  template_name = excluded.template_name,
  system_prompt = excluded.system_prompt,
  user_prompt_template = excluded.user_prompt_template,
  variables_schema = excluded.variables_schema,
  version = excluded.version,
  status = 'active',
  updated_at = excluded.updated_at;
