-- 退回发起人后清除 current_node_key，修复「看起来仍停在退回节点」
--
-- 背景：returnToInitiator 只更新了实例状态，却没有清空 current_node_key，
-- 导致实例仍指向退回时所在的审批节点（如 SP-20260629-0002 指向「总经理审批」）。
-- 前端各处「当前节点」展示与详情时间线高亮均按 current_node_key 判定，于是看起来
-- 这条审批还卡在总经理节点、没有退回发起人。
--
-- 写侧已改为退回时把 current_node_key 置空。此处把历史已退回（status='returned'）
-- 的实例 current_node_key 一并清空——退回后本就不处于任何审批节点。
-- 说明：仅 returnToInitiator 会产生 status='returned'，重新提交后会切回 'in_progress'
-- 并重设 current_node_key，因此该回填安全且不影响后续流程。
UPDATE approval_instance
SET current_node_key = NULL,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE status = 'returned'
  AND current_node_key IS NOT NULL;
