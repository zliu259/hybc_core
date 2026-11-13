-- 设备类别的编号开头：这个类别下新建的设备不填编号时，按「开头-流水号」自动编号（顶管机 DG-034、顶铁 DT-37）。
-- 没设开头的类别照旧用 SB-0001 这样的编号。两个类别不能用同一个开头。

ALTER TABLE device_category ADD COLUMN code_prefix TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_device_category_code_prefix
  ON device_category(code_prefix) WHERE code_prefix IS NOT NULL;

-- 2026-11-13 已经按类别重新编过号的五个类别（生产上 82 台设备）。按名字补，已经有开头的不动。
UPDATE device_category SET code_prefix = 'DG' WHERE name = '顶管机' AND code_prefix IS NULL;
UPDATE device_category SET code_prefix = 'YB' WHERE name = '油泵站' AND code_prefix IS NULL;
UPDATE device_category SET code_prefix = 'FD' WHERE name = '发电机' AND code_prefix IS NULL;
UPDATE device_category SET code_prefix = 'FL' WHERE name = '泥水分离器' AND code_prefix IS NULL;
UPDATE device_category SET code_prefix = 'DT' WHERE name = '顶铁' AND code_prefix IS NULL;
