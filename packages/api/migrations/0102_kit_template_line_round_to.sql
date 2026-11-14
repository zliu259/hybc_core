-- 配套模板行的「取整到」：按长度或段数算出的数量，向上取到它的倍数（电缆、管线按 50 米一档计划）。
-- 只加一列，默认是空的。旧代码跑在新结构上没问题。

ALTER TABLE kit_template_line ADD COLUMN qty_round_to REAL
  CHECK (qty_round_to IS NULL OR qty_round_to > 0);
