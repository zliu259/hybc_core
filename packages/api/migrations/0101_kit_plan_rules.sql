-- 配套清单按项目参数生成（第一期）：模板行上的计算规则、模板的管径、清单的生成参数。
-- 只加列和补数据。旧代码跑在新结构上没问题。

ALTER TABLE kit_template ADD COLUMN diameter_mm INTEGER;

ALTER TABLE kit_template_line ADD COLUMN qty_basis TEXT NOT NULL DEFAULT 'fixed'
  CHECK (qty_basis IN ('fixed', 'per_total_metre', 'per_longest_metre', 'per_section'));
ALTER TABLE kit_template_line ADD COLUMN qty_factor REAL
  CHECK (qty_factor IS NULL OR qty_factor >= 0);
ALTER TABLE kit_template_line ADD COLUMN qty_extra REAL
  CHECK (qty_extra IS NULL OR qty_extra >= 0);
ALTER TABLE kit_template_line ADD COLUMN qty_per_set INTEGER NOT NULL DEFAULT 0
  CHECK (qty_per_set IN (0, 1));
ALTER TABLE kit_template_line ADD COLUMN spec_by_diameter INTEGER NOT NULL DEFAULT 0
  CHECK (spec_by_diameter IN (0, 1));
ALTER TABLE kit_template_line ADD COLUMN role TEXT
  CHECK (role IS NULL OR role IN ('main_machine', 'power', 'lodging'));

ALTER TABLE project_kit ADD COLUMN plan_json TEXT;

-- 现有四个模板的管径。已经填过的不动。
UPDATE kit_template SET diameter_mm = 1200 WHERE name = '泥水平衡 DN1200' AND diameter_mm IS NULL;
UPDATE kit_template SET diameter_mm = 600 WHERE name = '泥水平衡 DN600' AND diameter_mm IS NULL;
UPDATE kit_template SET diameter_mm = 2400 WHERE name = '土压平衡 DN2400' AND diameter_mm IS NULL;
UPDATE kit_template SET diameter_mm = 1750 WHERE name = '土压平衡 DN1750 两套' AND diameter_mm IS NULL;

-- 标记只在这里按名字认一次，之后都看行上的 role。
UPDATE kit_template_line SET role = 'main_machine'
 WHERE role IS NULL AND line_kind = 'device'
   AND device_category_id IN (SELECT id FROM device_category WHERE name = '顶管机');
UPDATE kit_template_line SET role = 'power'
 WHERE role IS NULL AND line_kind = 'device'
   AND device_category_id IN (SELECT id FROM device_category WHERE name = '发电机');
UPDATE kit_template_line SET role = 'lodging'
 WHERE role IS NULL AND section = '生活设施';
