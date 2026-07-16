-- 0058_mcp_agent_grant.sql
-- MCP 智能体长期授权（6 个月），令牌仅存 SHA-256。
CREATE TABLE IF NOT EXISTS agent_grant (
  -- 不透明 UUID 主键（非自增整数）：id 会作为 grant_id 进入 JWT 并回传给管理端，避免泄漏授权数量/顺序
  id TEXT PRIMARY KEY,
  wecom_userid TEXT NOT NULL,
  device_name TEXT,
  client_info TEXT,
  agent_type TEXT,
  token_hash TEXT NOT NULL UNIQUE,
  token_prefix TEXT,
  role_snapshot TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT,
  revoked_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_agent_grant_wecom_userid ON agent_grant(wecom_userid);
CREATE INDEX IF NOT EXISTS idx_agent_grant_status ON agent_grant(status);
