-- 旧财务数据补迁前置：legacy_data_id 唯一约束（partial index，NULL 行不受限）
-- 0025 只建了普通索引，导入幂等仅靠 WHERE NOT EXISTS 谓词；补 UNIQUE 给重放/并发加约束级兜底
CREATE UNIQUE INDEX IF NOT EXISTS ux_payment_request_legacy_data_id ON payment_request(legacy_data_id) WHERE legacy_data_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_contract_legacy_data_id ON contract(legacy_data_id) WHERE legacy_data_id IS NOT NULL;
