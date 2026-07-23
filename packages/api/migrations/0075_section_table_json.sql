-- 0075_section_table_json.sql
-- 清单表格 MVP：设备清单/材料清单结构化落点。
-- 给 contract_draft_section 增加 table_json（nullable，仅 equipment_schedule/goods_spec 使用）。
-- 形状：{"preset":"equipment_wet|equipment_dry|goods","rows":[{列key:值}]}。
-- 列 schema 与合计/大写不入此列：列由 preset 在前端派生，含税金额=数量×单价前端计算，
-- 合同大写金额仍由后端 amount-cn 权威生成。定稿 docx 在正文 {{__table__}} 哨兵处（或节末）渲染真表格。
ALTER TABLE contract_draft_section ADD COLUMN table_json TEXT;
