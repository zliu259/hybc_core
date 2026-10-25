-- 0090_fuel_card_vehicle_binding_rebuild.sql
-- 油卡跟车走：油卡挂到车上，一张卡同一时刻只属于一辆车，转移/解绑留历史。
-- 旧表（0032）的 UNIQUE(fuel_card_id, vehicle_id) 会挡住"卡转出后再转回原车"，且没有操作人与解绑时间，故重建。
-- 生产旧表 2026-10-25 核实为 0 行；仍改名保留而不 DROP，万一有数据也不会丢。
-- 一卡一车由部分唯一索引保证（D1 无事务，见 services/fleet-card-binding.ts）。

DROP INDEX IF EXISTS idx_fuel_card_vehicle_binding_unique;
DROP INDEX IF EXISTS idx_fuel_card_vehicle_binding_vehicle_id;
ALTER TABLE fuel_card_vehicle_binding RENAME TO fuel_card_vehicle_binding_pre0090;

CREATE TABLE fuel_card_vehicle_binding (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fuel_card_id INTEGER NOT NULL,
  vehicle_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  bound_at TEXT NOT NULL,
  bound_by_userid TEXT NOT NULL,
  unbound_at TEXT,
  unbound_by_userid TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (fuel_card_id) REFERENCES fuel_card(id),
  FOREIGN KEY (vehicle_id) REFERENCES company_vehicle(id)
);

CREATE UNIQUE INDEX idx_fuel_card_vehicle_binding_active_card
  ON fuel_card_vehicle_binding(fuel_card_id)
  WHERE status = 'active';

CREATE INDEX idx_fuel_card_vehicle_binding_vehicle
  ON fuel_card_vehicle_binding(vehicle_id, status);
