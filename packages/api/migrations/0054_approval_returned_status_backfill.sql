-- 修复「退回发起人」后审批实例状态口径不一致
--
-- 背景：returnToInitiator 历史上把 approval_instance.status 写成 'pending'，
-- 但发起人「我发起的 → 被退回（待处理）」监管桶按 status = 'returned' 判定，
-- 导致被退回的审批既进不了该桶、也无催办/待办提示，表现为「退回后没有响应」。
--
-- 写侧已改为写入 'returned'。此处把历史遗留、仍停留在 'pending' 的实例回填为
-- 'returned'，使 SP-20260629-0002 等已被退回的流程重新出现在发起人的监管桶中。
-- 说明：approval_instance.status = 'pending' 在系统中仅由 returnToInitiator 产生，
-- 因此该回填是安全且无歧义的。
UPDATE approval_instance
SET status = 'returned',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE status = 'pending';
