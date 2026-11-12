-- 库房重做阶段 5：盘点。
-- 发起时把行建好；录实盘数时记下那一刻的账面数；完成时按差额出一张 adjust 库房单。
-- 旧表 stocktake_task、stocktake_line 不在这里动，等删旧表的迁移。

CREATE TABLE IF NOT EXISTS stocktake (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stocktake_no TEXT NOT NULL UNIQUE,
  scope TEXT NOT NULL CHECK (scope IN ('material', 'device', 'all')),
  status TEXT NOT NULL DEFAULT 'counting' CHECK (status IN ('counting', 'done', 'cancelled')),
  remark TEXT,
  cancel_reason TEXT,
  created_by_userid TEXT NOT NULL,
  completed_by_userid TEXT,
  completed_at TEXT,
  cancelled_by_userid TEXT,
  cancelled_at TEXT,
  -- 每次改这次盘点或它的行都加一；完成时核对，防止和别人的录入撞上
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 同一时间只能有一个进行中的盘点
CREATE UNIQUE INDEX IF NOT EXISTS idx_stocktake_single_counting
  ON stocktake(status) WHERE status = 'counting';

CREATE TABLE IF NOT EXISTS stocktake_material_line (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stocktake_id INTEGER NOT NULL REFERENCES stocktake(id),
  material_id INTEGER NOT NULL REFERENCES material(id),
  counted_qty REAL CHECK (counted_qty IS NULL OR counted_qty >= 0),
  -- 录入实盘数那一刻的账面数；差额按它算
  book_qty REAL,
  note TEXT,
  counted_by_userid TEXT,
  counted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (stocktake_id, material_id),
  CHECK ((counted_qty IS NULL) = (book_qty IS NULL))
);

CREATE TABLE IF NOT EXISTS stocktake_device_line (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stocktake_id INTEGER NOT NULL REFERENCES stocktake(id),
  device_id INTEGER NOT NULL REFERENCES device(id),
  -- 1：发起时账上在库；0：盘的时候扫到的、账上不在库的
  expected INTEGER NOT NULL CHECK (expected IN (0, 1)),
  -- 空：还没看；1：找到；0：没找到
  found INTEGER CHECK (found IS NULL OR found IN (0, 1)),
  note TEXT,
  scanned_by_userid TEXT,
  scanned_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (stocktake_id, device_id)
);

CREATE INDEX IF NOT EXISTS idx_wh_doc_stocktake_id ON wh_doc(stocktake_id);
