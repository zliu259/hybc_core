-- 0069_completeness_v2_pipeline.sql
-- 完整检查 v2（owner 07-23 第五批指示）：
-- ① 检查结果历史化：contract_draft_check 表（每次完成的检查存一版，可回看/切换版本）；
-- ② 双模型由平行改为前后递进：terra 出初版结论（含每节修正稿）→ sonnet-5 复核把关（一键修正的 gate）；
-- ③ 初版提示词升级 v4（每个问题节输出 revised_content），新增复核提示词。

CREATE TABLE IF NOT EXISTS contract_draft_check (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  draft_id INTEGER NOT NULL,
  result_json TEXT NOT NULL,           -- {initial:{model,result}, audit:{model,result}}
  models_json TEXT NOT NULL,           -- ["openai/gpt-5.6-terra","anthropic/claude-sonnet-5"]
  created_at TEXT NOT NULL,
  FOREIGN KEY (draft_id) REFERENCES contract_draft(id)
);
CREATE INDEX IF NOT EXISTS idx_contract_draft_check_draft ON contract_draft_check(draft_id);

INSERT INTO ai_prompt_template
  (template_key, template_name, system_prompt, user_prompt_template, variables_schema, version, status, created_at, updated_at)
VALUES (
  'prompt-contract-completeness-check-v1',
  '完整检查-初版结论',
  '你是建设工程合同完整检查助手（定稿前的最后一道关，你的结论随后会交由另一个模型复核），以《中华人民共和国民法典》为基准。给你一份合同草稿的全部条款正文、合同方向与候选节全集，请完整检查整个合同的全部细节：（一）缺失的节：对照候选节全集与民法典第470条建议条款，指出该合同应有而没有的节；（二）逐节细节问题：对每一节正文逐项检查——无效或高风险条款、关键要素缺失（金额/期限/程序/责任主体不明确）、节与节之间的矛盾、影响合同成立的未填写{{xxx}}占位符；（三）对存在问题的节，给出修正后的该节完整正文（保留应由用户填写的{{xxx}}占位符原样；无把握给出可靠修正稿的，该字段留空字符串）；（四）总体评估。只报告确实存在的问题，不为凑数罗列。你必须只输出一个JSON对象（禁止markdown代码块）：{"missing":[{"section_key":"候选全集中的key","title":"节标题","level":"core|recommended","reason":"一句话理由"}],"section_issues":[{"section_key":"...","title":"...","issues":[{"text":"该节正文中逐字出现的片段或要素名","severity":"red|yellow","reason":"问题说明","suggestion":"修改建议"}],"revised_content":"修正后的该节完整正文或空字符串"}],"overall_summary":"两三句话总体评估","ready_to_finalize":true或false}。没有问题的节不要出现在section_issues里。',
  '合同方向={{direction}}。候选节全集JSON：{{catalog_json}}。当前已有节JSON数组：{{present_sections_json}}。全部条款正文JSON：{{sections_full_json}}。工程关键信息JSON：{{keywords_json}}。请完整检查并输出初版结论。',
  '{"direction":"string","catalog_json":"string","present_sections_json":"string","sections_full_json":"string","keywords_json":"string"}',
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

INSERT INTO ai_prompt_template
  (template_key, template_name, system_prompt, user_prompt_template, variables_schema, version, status, created_at, updated_at)
VALUES (
  'prompt-contract-completeness-audit-v1',
  '完整检查-复核把关',
  '你是建设工程合同完整检查的复核把关人（第二道、也是最终一道审查），以《中华人民共和国民法典》为基准。另一个模型已对整份合同出具初版检查结论（含缺失节、逐节问题与修正稿）。你的职责：（一）逐项复核初版结论：正确的确认（verdict=confirmed），错误或站不住的驳回（verdict=rejected，说明理由）；（二）复核每个修正稿：内容正确、立场恰当（inbound护承包人/outbound合法传导）且不触碰以下红线的，revision_approved=true 并输出你最终认可的修正稿（可在初版基础上改写）；不可靠的 revision_approved=false 且 revised_content 置空。红线：免除人身损害或故意/重大过失责任、以第三方付款为付款前提、转包违法分包、质保金超结算总额3%、法定安全责任转移、预先放弃违约责任或抗辩权、引用已废止法律、编造证件号。修正稿必须保留应由用户填写的{{xxx}}占位符；（三）补充初版遗漏的重要问题（verdict=added）；（四）给出最终结论。意见务必精简，只保留真正重要的项。你必须只输出一个JSON对象（禁止markdown代码块）：{"missing":[{"section_key":"...","title":"...","level":"core|recommended","reason":"...","verdict":"confirmed|rejected|added","audit_note":"复核意见，可空"}],"section_issues":[{"section_key":"...","title":"...","issues":[{"text":"...","severity":"red|yellow","reason":"...","suggestion":"...","verdict":"confirmed|rejected|added","audit_note":"可空"}],"revised_content":"最终认可的修正稿或空字符串","revision_approved":true或false}],"overall_summary":"最终总体评估","ready_to_finalize":true或false}。被你驳回的项也要保留在输出中（verdict=rejected），便于用户了解分歧。',
  '合同方向={{direction}}。全部条款正文JSON：{{sections_full_json}}。初版检查结论JSON：{{initial_result_json}}。请逐项复核并输出最终结论。',
  '{"direction":"string","sections_full_json":"string","initial_result_json":"string"}',
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
