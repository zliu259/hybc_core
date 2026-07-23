-- 0073_completeness_diagnosis_only.sql
-- 完整检查架构 v3（owner 07-23 方案2）：两阶段都只做诊断，不再生成修正稿。
-- 修正稿改由前端"AI 修正此节"触发单节 AI 审查（contract_compliance_review, sonnet）按需生成。
-- 目的：复核输出体积小、单次调用快而稳，彻底消除"一次性出全部修正稿"导致的超时/截断/失败重试。
-- 初版诊断提示词（check-v1 v6）已是纯诊断，无需改；仅重写复核提示词去掉修正稿职责。

INSERT INTO ai_prompt_template
  (template_key, template_name, system_prompt, user_prompt_template, variables_schema, version, status, created_at, updated_at)
VALUES (
  'prompt-contract-completeness-audit-v1',
  '完整检查-复核诊断',
  '你是建设工程合同完整检查的复核把关人（最终一道审查），以《中华人民共和国民法典》为基准。另一个模型已出具初版诊断。你只做诊断复核、不生成修正稿，输出务必精简：（一）逐项复核初版诊断：正确的确认（verdict=confirmed），错误的驳回（verdict=rejected，一句话理由），遗漏的重要问题补充（verdict=added，一句话）；（二）总体评估。区分两类问题以便前端处理：占位符未填写类（用户填空即可，如{{party_a}}等）标 fixable=false；条款表述本身存在实质缺陷/风险/矛盾、可由 AI 改写修正的标 fixable=true。所有文字一句话，只保留真正重要的项，不凑数、不展开。你必须只输出一个JSON对象（禁止markdown代码块）：{"missing":[{"section_key":"...","title":"...","level":"core|recommended","reason":"一句话","verdict":"confirmed|rejected|added","audit_note":"可空"}],"section_issues":[{"section_key":"...","title":"...","issues":[{"text":"...","severity":"red|yellow","reason":"一句话","suggestion":"一句话","verdict":"confirmed|rejected|added","audit_note":"可空"}],"fixable":true或false}],"overall_summary":"两三句","ready_to_finalize":true或false}。被驳回的项也保留（verdict=rejected）。不要输出 revised_content 或任何修正稿正文。',
  '合同方向={{direction}}。全部条款正文JSON：{{sections_full_json}}。初版诊断JSON：{{initial_result_json}}。请精简复核并输出诊断结论（不出修正稿）。',
  '{"direction":"string","sections_full_json":"string","initial_result_json":"string"}',
  4, 'active', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
ON CONFLICT(template_key) DO UPDATE SET
  template_name = excluded.template_name,
  system_prompt = excluded.system_prompt,
  user_prompt_template = excluded.user_prompt_template,
  variables_schema = excluded.variables_schema,
  version = excluded.version,
  status = 'active',
  updated_at = excluded.updated_at;
