/**
 * Slack Schema Migration SQL
 *
 * SQL to create the slack.* schema for integration tests.
 * This mirrors the production schema from @aesir/integration-slack.
 */

export const slackMigrationSql = `
-- Create slack schema
CREATE SCHEMA IF NOT EXISTS slack;

-- Installations table (Slack uses "installations" not "credentials")
CREATE TABLE IF NOT EXISTS slack.installations (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  enterprise_id TEXT,
  user_id TEXT,
  is_enterprise_install BOOLEAN NOT NULL DEFAULT false,
  encrypted_bot_token TEXT NOT NULL,
  encrypted_user_token TEXT,
  bot_id TEXT,
  bot_user_id TEXT,
  bot_scopes TEXT,
  app_id TEXT,
  token_type TEXT NOT NULL DEFAULT 'bot',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMP WITH TIME ZONE,
  CONSTRAINT installations_team_enterprise_unique UNIQUE(team_id, enterprise_id)
);

-- Event deliveries for idempotency (Slack uses events, not webhooks)
CREATE TABLE IF NOT EXISTS slack.event_deliveries (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  team_id TEXT,
  processed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Indexes for event_deliveries
CREATE INDEX IF NOT EXISTS event_deliveries_event_id_idx
  ON slack.event_deliveries (event_id);
CREATE INDEX IF NOT EXISTS event_deliveries_created_at_idx
  ON slack.event_deliveries (created_at);

-- MCP tool permissions
CREATE TABLE IF NOT EXISTS slack.mcp_tool_permissions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  allowed BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Unique index for agent + tool
CREATE UNIQUE INDEX IF NOT EXISTS slack_mcp_perm_agent_tool_idx
  ON slack.mcp_tool_permissions (agent_id, tool_name);

-- Updated_at trigger function
CREATE OR REPLACE FUNCTION slack.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to installations
DROP TRIGGER IF EXISTS update_slack_installations_updated_at ON slack.installations;
CREATE TRIGGER update_slack_installations_updated_at
  BEFORE UPDATE ON slack.installations
  FOR EACH ROW
  EXECUTE FUNCTION slack.update_updated_at();

-- Apply trigger to mcp_tool_permissions
DROP TRIGGER IF EXISTS update_slack_mcp_permissions_updated_at ON slack.mcp_tool_permissions;
CREATE TRIGGER update_slack_mcp_permissions_updated_at
  BEFORE UPDATE ON slack.mcp_tool_permissions
  FOR EACH ROW
  EXECUTE FUNCTION slack.update_updated_at();
`;
