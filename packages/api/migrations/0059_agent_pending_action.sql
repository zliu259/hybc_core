-- 0059_agent_pending_action.sql
-- MCP 智能体高危写操作的「待本人微信确认」暂存；确认后由服务端重放原请求执行。
CREATE TABLE IF NOT EXISTS agent_pending_action (
  -- 不透明 UUID：会出现在卡片链接与 MCP 轮询里，避免泄漏数量/顺序
  id TEXT PRIMARY KEY,
  grant_id TEXT NOT NULL,
  wecom_userid TEXT NOT NULL,
  action_kind TEXT NOT NULL,
  request_snapshot TEXT NOT NULL,
  risk_reason TEXT,
  summary TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  result_snapshot TEXT,
  confirm_token_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  confirmed_at TEXT,
  executed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_agent_pending_action_wecom_userid_status ON agent_pending_action(wecom_userid, status);
CREATE INDEX IF NOT EXISTS idx_agent_pending_action_grant_id ON agent_pending_action(grant_id);
CREATE INDEX IF NOT EXISTS idx_agent_pending_action_confirm_token_hash ON agent_pending_action(confirm_token_hash);
