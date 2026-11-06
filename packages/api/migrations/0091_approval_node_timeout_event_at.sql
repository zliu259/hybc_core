-- 审批节点超时事件去重：记录该节点这次进入后已写过 APPROVAL_TIMEOUT 的时间。
-- 早于 started_at 表示节点被退回后重新进入，再次超时可以再记一次。
ALTER TABLE approval_node_instance ADD COLUMN timeout_event_at TEXT;

-- 回填：迁移时已超时的节点，旧逻辑已经为它们写过事件，不再补记。
UPDATE approval_node_instance
SET timeout_event_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE status = 'in_progress'
  AND started_at IS NOT NULL
  AND (julianday('now') - julianday(started_at)) * 24 > COALESCE(timeout_hours, 24);
