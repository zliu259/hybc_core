-- 0060_agent_pending_action_detail.sql
-- 确认卡片 / 确认页所依据的「动作详情」JSON：动词、目标、业务上下文、以及【智能体填写的意见】。
--
-- 为什么单独一列而不是塞进 summary：意见是调用方（可能已被提示注入操纵）可控的文本，
-- 而 summary 读起来像系统文案。混在一起，攻击者写的字就能冒充系统的话。
-- 单独成列还让确认页能把它按「不可信输入」单独渲染并标注来源。
--
-- 可空：历史行没有这一列；读侧（toPublicView）对 NULL / 损坏 JSON 一律降级为 null，不抛。
ALTER TABLE agent_pending_action ADD COLUMN action_detail TEXT;
