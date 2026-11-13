-- 库房重做阶段 4B：设备资料镜像到微盘。
-- 系统（R2）是源头，微盘是单向镜像。这里只记每份资料镜像到哪了，以及在微盘里建过哪些目录。

ALTER TABLE doc_file ADD COLUMN mirror_status TEXT NOT NULL DEFAULT 'pending'
  CHECK (mirror_status IN ('pending', 'syncing', 'synced', 'failed', 'skipped'));
ALTER TABLE doc_file ADD COLUMN mirror_error TEXT;
ALTER TABLE doc_file ADD COLUMN mirror_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE doc_file ADD COLUMN mirror_started_at TEXT;
ALTER TABLE doc_file ADD COLUMN mirrored_at TEXT;
-- 这份资料在微盘里的文件、名字、所在目录（wedrive_folder.folder_key）；不在微盘里时都为空
ALTER TABLE doc_file ADD COLUMN wedrive_fileid TEXT;
ALTER TABLE doc_file ADD COLUMN wedrive_name TEXT;
ALTER TABLE doc_file ADD COLUMN wedrive_folder_key TEXT;

CREATE INDEX IF NOT EXISTS idx_doc_file_mirror_status ON doc_file(mirror_status);

-- 在微盘里建过的目录。按「哪个类别、哪台设备」记，不按路径记：改名、换类别时改的是同一行。
-- folder_key：general、uncategorized、category:<id>、category-general:<id>、device:<id>
CREATE TABLE IF NOT EXISTS wedrive_folder (
  folder_key TEXT PRIMARY KEY,
  fileid TEXT NOT NULL,
  name TEXT NOT NULL,
  -- 上一级目录的 folder_key；直接在空间根下的为空
  parent_key TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
