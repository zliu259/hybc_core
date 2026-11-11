-- 库房重做阶段 2：项目配套清单。
-- 清单只存计划；已发、已退、报损、在场都从库房单（wh_doc_line）按项目汇总算出。

CREATE TABLE IF NOT EXISTS kit_template (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  machine_type TEXT,
  remark TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  version INTEGER NOT NULL DEFAULT 0,
  created_by_userid TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS kit_template_line (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id INTEGER NOT NULL,
  section TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  line_kind TEXT NOT NULL CHECK (line_kind IN ('device', 'material', 'text')),
  device_category_id INTEGER,
  name_text TEXT NOT NULL,
  spec_text TEXT,
  unit TEXT,
  default_qty REAL CHECK (default_qty IS NULL OR default_qty >= 0),
  note TEXT,
  created_at TEXT NOT NULL,
  CONSTRAINT kit_template_line_device_has_category
    CHECK (line_kind <> 'device' OR device_category_id IS NOT NULL),
  FOREIGN KEY (template_id) REFERENCES kit_template(id),
  FOREIGN KEY (device_category_id) REFERENCES device_category(id)
);
CREATE INDEX IF NOT EXISTS idx_kit_template_line_template_id ON kit_template_line(template_id);

CREATE TABLE IF NOT EXISTS project_kit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kit_no TEXT NOT NULL UNIQUE,
  project_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  template_id INTEGER,
  copied_from_kit_id INTEGER,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'submitted', 'confirmed', 'closed')),
  remark TEXT,
  created_by_userid TEXT NOT NULL,
  submitted_by_userid TEXT,
  submitted_at TEXT,
  confirmed_by_userid TEXT,
  confirmed_at TEXT,
  closed_by_userid TEXT,
  closed_at TEXT,
  close_reason TEXT,
  version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES project(id),
  FOREIGN KEY (template_id) REFERENCES kit_template(id),
  FOREIGN KEY (copied_from_kit_id) REFERENCES project_kit(id)
);
CREATE INDEX IF NOT EXISTS idx_project_kit_project_id ON project_kit(project_id);
CREATE INDEX IF NOT EXISTS idx_project_kit_status ON project_kit(status);

CREATE TABLE IF NOT EXISTS project_kit_line (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kit_id INTEGER NOT NULL,
  section TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  line_kind TEXT NOT NULL CHECK (line_kind IN ('device', 'material', 'text')),
  device_category_id INTEGER,
  material_id INTEGER,
  name_text TEXT NOT NULL,
  spec_text TEXT,
  unit TEXT,
  planned_qty REAL NOT NULL DEFAULT 0 CHECK (planned_qty >= 0),
  source TEXT NOT NULL DEFAULT 'warehouse'
    CHECK (source IN ('warehouse', 'site_purchase', 'rental', 'on_site')),
  note TEXT,
  created_at TEXT NOT NULL,
  CONSTRAINT project_kit_line_device_has_category
    CHECK (line_kind <> 'device' OR device_category_id IS NOT NULL),
  FOREIGN KEY (kit_id) REFERENCES project_kit(id),
  FOREIGN KEY (device_category_id) REFERENCES device_category(id),
  FOREIGN KEY (material_id) REFERENCES material(id)
);
CREATE INDEX IF NOT EXISTS idx_project_kit_line_kit_id ON project_kit_line(kit_id);
CREATE INDEX IF NOT EXISTS idx_project_kit_line_material_id ON project_kit_line(material_id);

-- wh_doc.project_kit_id 在 0095 已建列（按清单发货时带上）
CREATE INDEX IF NOT EXISTS idx_wh_doc_project_kit_id ON wh_doc(project_kit_id);
