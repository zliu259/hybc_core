-- 0089_contract_amount_change_attachments.sql
-- 合同金额变更申请支持附件（选填），审批人在审批详情页可查看/下载。
-- 存 JSON 数组 [{file_key, file_name, file_size}]，无附件为 NULL；file_key 仅允许 contract/ 前缀（API 层校验）。

ALTER TABLE contract_amount_change ADD COLUMN attachments_json TEXT;
