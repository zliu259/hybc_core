-- 费用合理性审查提示词 v2：识别完才跑，能看到每张发票的识别结果，按附件给出提醒。
-- 去掉已无意义的「附件分类是否正确」和没有填充的 {{items}}、{{total_amount}}。
-- 文本与 packages/api/src/routes/admin.ts 的 defaultAiPromptTemplates 逐字相同（有测试守护）。

UPDATE ai_prompt_template SET
  system_prompt = '你是企业报销审计助手，结果展示给办公室核查人员。只依据输入数据判断，不编造。所有文字用中文业务用语，不照抄英文字段名。只输出一个JSON对象，不要markdown代码块。字段固定为risk_level、summary、anomalies、recommendation。',
  user_prompt_template = '请检查这张报销的费用是否合理。输入JSON={{payload_json}}
其中invoices是每个附件的识别结果，amount是申报金额，category和description是费用类别和说明。
重点看：发票内容和费用说明是否明显不相关、开票日期是否异常、同一销售方金额是否异常。金额合计和重复发票由系统另行核对，不要重复判断。发票号或金额为空只说明没读出来，不算异常。
输出JSON：{"risk_level":"low|medium|high","summary":"不超过60字","anomalies":[{"attachment_id":附件编号或null,"level":"low|medium|high","reason":"不超过40字"}],"recommendation":"不超过40字"}
没有问题时anomalies给空数组。',
  version = 2,
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE template_key = 'prompt-reimbursement-anomaly-v1'
  AND version < 2;
