-- 0088_system_config.sql
-- 通用系统级键值配置。首个使用方：AI 关卡兜底审核人（approval.ai_gate.fallback_reviewer_userid）。
-- 背景：2026-09-13 SP-20260913-0007 被 AI 退回后没有人工兜底出口，见
-- docs/superpowers/specs/2026-09-13-ai-gate-human-escalation-design.md。

CREATE TABLE IF NOT EXISTS system_config (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  config_key TEXT NOT NULL UNIQUE,
  config_value TEXT NOT NULL,
  updated_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_system_config_key ON system_config(config_key);
