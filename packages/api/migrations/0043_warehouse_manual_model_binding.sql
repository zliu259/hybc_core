ALTER TABLE warehouse_manual_binding ADD COLUMN asset_model TEXT;

CREATE INDEX IF NOT EXISTS idx_warehouse_manual_binding_model
  ON warehouse_manual_binding(asset_type_id, asset_model, work_order_type);
