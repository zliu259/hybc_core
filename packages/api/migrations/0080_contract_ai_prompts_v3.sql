-- 0080_contract_ai_prompts_v3.sql
-- 合同域 AI 提示词 v3（owner 2026-08-05 反馈，实锤案例 CT-20260805-0001 得分 100）：
-- 1) 我方主体必须以 payload 的 our_entity/our_entities（实体表实时调取）为准——
--    v2 未提供实体名单，模型假定我方=「恒越百川」，把我方下属实体北京鑫丰畅
--    误判成主体不符（+50 误报）。
-- 2) 单价/按实结算合同（台班等）本就没有总价：附件未载明总价不得判 fail/high，
--    录入 total_amount 按预估或上限理解。
-- 3) 对我方不利但可谈判的常规商业安排（费用承担、管辖、送达等）与琐碎瑕疵
--    不计分：gate 侧最多 warn，合同审查侧列 low（0 分）；配合计分侧
--    warn/medium 合计封顶 40，警示项不再堆叠进 fail 档。
-- 4) remark 是经办人备注，与附件不一致不得作为 fail 依据。
-- 文本与 packages/api/src/routes/admin.ts defaultAiPromptTemplates、
-- task-runner/runner/prompts.py 保持同契约，改动需三处同步。
-- 新增 gate 维度 subject_match（签约主体），标签需同步
-- postprocess.py / risk-score.ts / web ai-review.ts 的 DIMENSION_LABELS。

UPDATE ai_prompt_template SET
  user_prompt_template = '请对审批关卡做出判定。节点={{node_key}}，审批实例={{instance_id}}。业务数据JSON（其中biz_type字段为真实业务类型，请按其选择检查维度）：{{payload_json}}
按业务类型逐项检查（dimension使用英文标识）：
【payment_request 对外付款】1) duplicate_payment 对比recent_payments中金额/时间相近记录识别重复支付；2) overpayment 本次amount加contract.paid_amount是否超过contract.total_amount；3) frequency_anomaly 近期付款是否异常密集；4) counterparty_consistency 付款事由与contract.counterparty是否一致；5) material_consistency 附件与申请内容是否一致。
【outbound_contract/inbound_contract 合同】我方签约主体以payload中our_entity（本合同我方主体）与our_entities（集团实体名单）为准，禁止假定「恒越百川」字样；direction=outbound我方为付款方，inbound我方为收款方；remark是经办人备注，与附件不一致最多warn，不得作为fail依据。1) clause_completeness 付款节点/验收标准/违约责任/争议解决是否齐备；2) amount_terms 固定总价合同核对付款比例与总额自洽；单价/按实结算合同（正文含台班、单价、按实结算、暂估等字样）附件未载明总价属正常，录入total_amount按预估或上限理解，不得据此判fail，仅当附件金额与录入金额明确矛盾时fail；3) counterparty_info 相对方信息是否完整；4) subject_match 附件中我方签约主体与our_entity/our_entities是否相符，不符才fail；5) performance_risk 仅在权利义务明显颠倒或可能造成重大损失时fail，对我方不利但可谈判的常规商业安排（费用承担、管辖、送达等）最多warn，无关紧要瑕疵不列。
【reimbursement_batch 报销批次】1) item_precheck 汇总reimbursement_item_reviews中预审与AI结论，存在未通过或高风险项为fail；2) duplicate_invoice 发票号是否重复；3) amount_reasonableness 金额与类别是否匹配。本关卡目标是汇总单项结论并判断合理性，不重新做票据真实性核验，不因缺少可读附件正文单独判fail或reject。
【其他业务】1) data_consistency 字段间是否矛盾；2) completeness 关键信息是否缺失；3) compliance 是否明显违规。
输出JSON：{"decision":"pass|warn|reject","risk_level":"low|medium|high","summary":"不超过60字，先结论后关键理由","findings":[{"dimension":"...","status":"pass|warn|fail","detail":"不超过40字","evidence":"引用具体字段或数值"}],"suggestions":["最多3条，可为空数组"]}
规则：每个适用维度必须输出一条finding，即使status=pass；reject必须有fail级finding且证据确凿（reject会直接终止审批流程，必须慎用）；数据不足以下结论时用warn并在findings中说明缺少什么，不要臆测。',
  version = 3,
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE template_key = 'prompt-approval-ai-gate-v1'
  AND version < 3;

UPDATE ai_prompt_template SET
  user_prompt_template = '请审查以下合同，识别条款风险、金额合理性与履约风险。输入JSON={{payload_json}}
我方立场：our_entity为本合同我方签约主体，our_entities为集团实体名单，我方主体核对以此为准，禁止假定「恒越百川」字样；direction=outbound我方为付款方，inbound我方为收款方；对我方有利的安排不是风险，不要列出；remark是经办人备注，与附件不一致按low提示。
risk_level分级（分数由系统确定性计算：high=50/medium=20/low=0，medium合计封顶40）：high仅限硬伤——附件我方签约主体与实体名单不符、固定总价合同金额与附件明确矛盾、违法或无效条款、双方权利义务明显颠倒、付款义务与验收交付完全脱钩且可能造成重大损失；medium为需人工重点确认的实质风险（计价口径不明、验收标准缺失等）；low为对我方不利但可谈判的常规商业安排（费用承担、管辖、送达地址等）及文字瑕疵，仅提示不计分。
单价/按实结算合同（正文含台班、单价、按实结算等字样）：附件未载明总价属正常，录入total_amount按预估或上限理解，不得因无总价判high。
审查重点：付款节点与验收条件对应关系、违约责任对等性、金额/税率/发票类型一致性、签约主体核对。
输出JSON：{"summary":"不超过60字，先整体结论后最关键风险","clause_analysis":[{"clause":"条款名","risk_level":"low|medium|high","issue":"不超过50字","suggestion":"不超过50字"}],"amount_assessment":{"reasonableness":"low|medium|high","basis":"判断依据","risk_points":["可为空数组"]},"recommendations":["最多3条，可为空数组"]}
规则：clause_analysis只列存在问题或需要关注的条款，全部无问题时给空数组；issue必须引用具体条款内容。',
  version = 3,
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE template_key = 'prompt-contract-review-v1'
  AND version < 3;
