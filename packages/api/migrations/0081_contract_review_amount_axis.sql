-- 0081_contract_review_amount_axis.sql
-- 合同审查提示词 v4：把 amount_assessment.reasonableness 的语义方向写死。
-- 背景：0080 只给了字段名与取值域 low|medium|high，没说方向。模型按字面理解
-- 输出「合理程度」（生产 CT-20260805-0001：reasonableness=low 同时列了 4 条
-- risk_points，指金额依据不足），而展示端一度按风险轴渲染成绿色安全色——
-- 对金额提了四条异议的合同被画成「低风险」，是会误导审批人的反向结论。
-- 展示端已按「合理程度」修正（low=红/high=绿），这里把方向在提示词里说清楚，
-- 避免模型在不同上下文里翻转轴向。仅替换该句，其余内容不变。

UPDATE ai_prompt_template SET
  user_prompt_template = replace(
    user_prompt_template,
    '"amount_assessment":{"reasonableness":"low|medium|high","basis":"判断依据","risk_points":["可为空数组"]}',
    '"amount_assessment":{"reasonableness":"low|medium|high（金额合理程度，方向不得反转：high=金额依据充分且合理，medium=部分存疑，low=依据不足或明显不合理）","basis":"判断依据","risk_points":["可为空数组"]}'
  ),
  version = 4,
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE template_key = 'prompt-contract-review-v1'
  AND version = 3
  AND user_prompt_template NOT LIKE '%方向不得反转%';
