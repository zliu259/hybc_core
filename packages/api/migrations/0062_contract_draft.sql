-- 0062_contract_draft.sql
-- AI 合同起草：草稿主表 / 节表 / 条款库 / 版本快照。
-- direction: inbound=我方为乙方(对甲方收款合同), outbound=我方为甲方(对分包商付款合同)。

CREATE TABLE IF NOT EXISTS contract_draft (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  direction TEXT NOT NULL,                -- inbound | outbound
  project_id INTEGER,
  entity_id INTEGER,                      -- 我方签约主体 entity.id
  counterparty_name TEXT NOT NULL DEFAULT '',
  counterparty_credit_code TEXT,
  counterparty_legal_person TEXT,
  counterparty_address TEXT,
  counterparty_contact TEXT,
  counterparty_phone TEXT,
  counterparty_bank_name TEXT,
  counterparty_bank_account TEXT,
  keywords_json TEXT NOT NULL DEFAULT '{}',   -- 占位符键值 {project_name, amount, sign_date, ...}
  status TEXT NOT NULL DEFAULT 'drafting',    -- drafting | finalized(M2) | converted(M2) | deleted
  completeness_status TEXT,                    -- NULL | generating | done | error
  completeness_task_id INTEGER,
  completeness_result_json TEXT,
  ignored_hints_json TEXT NOT NULL DEFAULT '[]', -- 用户忽略的遗漏提示 section_key 数组（留痕）
  converted_contract_id INTEGER,
  created_by_userid TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_contract_draft_created_by ON contract_draft(created_by_userid);
CREATE INDEX IF NOT EXISTS idx_contract_draft_status ON contract_draft(status);

CREATE TABLE IF NOT EXISTS contract_draft_section (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  draft_id INTEGER NOT NULL,
  section_key TEXT NOT NULL,
  title TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'default_template', -- default_template | ai_generated | manual
  instruction TEXT,                                -- 个性化指令（≤500 字，API 层校验）
  content TEXT NOT NULL DEFAULT '',
  risk_annotations_json TEXT,                      -- [{text,level,reason,legal_basis,source}]
  ai_task_id INTEGER,
  ai_status TEXT,                                  -- NULL | generating | done | error
  review_task_id INTEGER,
  review_status TEXT,                              -- NULL | generating | done | error
  review_result_json TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',           -- active | deleted
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (draft_id) REFERENCES contract_draft(id)
);
CREATE INDEX IF NOT EXISTS idx_contract_draft_section_draft ON contract_draft_section(draft_id);
CREATE INDEX IF NOT EXISTS idx_contract_draft_section_ai_task ON contract_draft_section(ai_task_id);
CREATE INDEX IF NOT EXISTS idx_contract_draft_section_review_task ON contract_draft_section(review_task_id);

CREATE TABLE IF NOT EXISTS contract_clause_template (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  section_key TEXT NOT NULL,
  direction TEXT NOT NULL,                 -- inbound | outbound | both
  required_level TEXT NOT NULL,            -- core | recommended | optional
  title TEXT NOT NULL,
  body_template TEXT NOT NULL,             -- 含 {{占位符}} 的骨架文案（已脱敏）
  style_ref TEXT,                          -- 范本风格参考段（已脱敏），可空
  risk_notes TEXT,                         -- 给使用者/AI 的立场与风险注记
  sort_order INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(section_key, direction)
);
CREATE INDEX IF NOT EXISTS idx_contract_clause_template_direction ON contract_clause_template(direction);

CREATE TABLE IF NOT EXISTS contract_draft_revision (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  draft_id INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,             -- {draft, sections} 全量快照
  trigger_action TEXT NOT NULL,            -- regenerate | manual_edit | finalize
  created_by_userid TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (draft_id) REFERENCES contract_draft(id)
);
CREATE INDEX IF NOT EXISTS idx_contract_draft_revision_draft ON contract_draft_revision(draft_id);
