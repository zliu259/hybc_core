CREATE TABLE IF NOT EXISTS fuel_card_user_binding (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fuel_card_id INTEGER NOT NULL,
  bind_userid TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (fuel_card_id) REFERENCES fuel_card(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_fuel_card_user_binding_unique
  ON fuel_card_user_binding(fuel_card_id, bind_userid);

CREATE INDEX IF NOT EXISTS idx_fuel_card_user_binding_userid
  ON fuel_card_user_binding(bind_userid);
