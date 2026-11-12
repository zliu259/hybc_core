-- 库房重做阶段 4A：设备资料库。
-- 文件本身在 R2 的 doc-library/ 前缀下；这里只存说明和归属。
-- 微盘镜像的字段和目录缓存表留给阶段 4B（ALTER TABLE ... ADD COLUMN）。

CREATE TABLE IF NOT EXISTS doc_file (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_key TEXT NOT NULL UNIQUE,
  file_size INTEGER NOT NULL CHECK (file_size > 0),
  content_type TEXT NOT NULL,
  doc_category TEXT NOT NULL
    CHECK (doc_category IN ('cert', 'report', 'params', 'manual', 'maintenance', 'other')),
  -- 归属：单台设备，或整个设备类别；都为空是通用资料
  device_id INTEGER REFERENCES device(id),
  device_category_id INTEGER REFERENCES device_category(id),
  valid_until TEXT,
  -- 替换了哪个旧文件；旧文件留着当历史版本
  supersedes_id INTEGER REFERENCES doc_file(id),
  uploaded_by_userid TEXT NOT NULL,
  deleted_at TEXT,
  deleted_by_userid TEXT,
  version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (device_id IS NULL OR device_category_id IS NULL)
);

CREATE INDEX IF NOT EXISTS idx_doc_file_device_id ON doc_file(device_id);
CREATE INDEX IF NOT EXISTS idx_doc_file_device_category_id ON doc_file(device_category_id);
CREATE INDEX IF NOT EXISTS idx_doc_file_supersedes_id ON doc_file(supersedes_id);
CREATE INDEX IF NOT EXISTS idx_doc_file_valid_until ON doc_file(valid_until);

-- 对外链接：拿到令牌的人不用登录就能下载这一个文件。
CREATE TABLE IF NOT EXISTS doc_share (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT NOT NULL UNIQUE,
  doc_file_id INTEGER NOT NULL REFERENCES doc_file(id),
  expires_at TEXT NOT NULL,
  created_by_userid TEXT NOT NULL,
  revoked_at TEXT,
  access_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_doc_share_doc_file_id ON doc_share(doc_file_id);
