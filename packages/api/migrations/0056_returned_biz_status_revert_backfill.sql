-- 修复「审批已退回但业务单状态未回退」的存量数据
--
-- 背景：returnToInitiator 会把业务单状态回退为 'draft'（operations.ts），
-- 但 0054 把历史遗留 'pending' 实例批量转为 'returned' 时只改了审批实例，
-- 未同步业务表，导致业务单卡在 'pending_approval'：发起人无法编辑、
-- 前端也不出现编辑入口（线上示例：payment_request 108）。
--
-- 此处把「当前审批实例处于待重提状态（returned/pending/withdrawn）、
-- 业务单仍停留在 pending_approval」的行回退为 'draft'。
-- 仅触碰 pending_approval —— 已 approved/paid/executed 等终态行不受影响。
-- 幂等，可安全重复执行。

UPDATE payment_request
SET status = 'draft',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE status = 'pending_approval'
  AND approval_instance_id IN (
    SELECT id FROM approval_instance WHERE status IN ('returned', 'pending', 'withdrawn')
  );

UPDATE contract
SET status = 'draft',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE status = 'pending_approval'
  AND approval_instance_id IN (
    SELECT id FROM approval_instance WHERE status IN ('returned', 'pending', 'withdrawn')
  );

UPDATE invoice_request
SET status = 'draft',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE status = 'pending_approval'
  AND approval_instance_id IN (
    SELECT id FROM approval_instance WHERE status IN ('returned', 'pending', 'withdrawn')
  );

UPDATE stock_order
SET status = 'draft',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE status = 'pending_approval'
  AND approval_instance_id IN (
    SELECT id FROM approval_instance WHERE status IN ('returned', 'pending', 'withdrawn')
  );

UPDATE reimbursement_batch
SET status = 'draft',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE status = 'pending_approval'
  AND approval_instance_id IN (
    SELECT id FROM approval_instance WHERE status IN ('returned', 'pending', 'withdrawn')
  );

UPDATE warehouse_asset_work_order
SET status = 'draft',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE status = 'pending_approval'
  AND approval_instance_id IN (
    SELECT id FROM approval_instance WHERE status IN ('returned', 'pending', 'withdrawn')
  );
