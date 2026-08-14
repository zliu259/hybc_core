-- 0085_remark_english_log_cleanup.sql
-- 备注字段英文 log 治理（owner 2026-08-14）：系统代码往用户可见备注里写的
-- 英文占位文本统一汉化。写入侧已同步改中文（payment.ts/contract.ts 的
-- [SUPER_ADMIN_EDIT] 标记、fleet.ts 油卡流水备注、miniapp/web 的 edit_note
-- 机器文案），本迁移刷存量数据。REPLACE 幂等，重复执行无副作用。

-- 超管修改标记：[SUPER_ADMIN_EDIT <时间>] <userid>: <说明> → [超管修改 …]
UPDATE payment_request
SET remark = REPLACE(remark, '[SUPER_ADMIN_EDIT ', '[超管修改 ')
WHERE remark LIKE '%[SUPER_ADMIN_EDIT %';

UPDATE contract
SET remark = REPLACE(remark, '[SUPER_ADMIN_EDIT ', '[超管修改 ')
WHERE remark LIKE '%[SUPER_ADMIN_EDIT %';

-- 备注行里的机器 edit_note 英文文案（小程序/审批页保存支付信息时写入）
UPDATE payment_request
SET remark = REPLACE(remark, 'miniapp approval payout selection update', '小程序审批页更新支付信息')
WHERE remark LIKE '%miniapp approval payout selection update%';

UPDATE payment_request
SET remark = REPLACE(remark, 'approval workbench payout selection update', '审批页更新支付信息')
WHERE remark LIKE '%approval workbench payout selection update%';

-- 油卡建卡流水备注
UPDATE fuel_card_balance_log
SET remark = '新建油卡'
WHERE remark = 'create fuel card';

-- 转签原因英文兜底（小程序未填意见时写入）
UPDATE approval_transfer
SET reason = '小程序转签'
WHERE reason = 'miniapp transfer';
