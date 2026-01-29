/**
 * GitHub Schema Migration SQL
 *
 * SQL to create the github.* schema for integration tests.
 * This mirrors the production schema from @aesir/integration-github.
 */

export const githubMigrationSql = `
-- Create github schema
CREATE SCHEMA IF NOT EXISTS github;

-- Credentials table
CREATE TABLE IF NOT EXISTS github.credentials (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  installation_id TEXT,
  encrypted_access_token TEXT NOT NULL,
  encrypted_refresh_token TEXT,
  token_type TEXT DEFAULT 'Bearer',
  scope TEXT,
  expires_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMP WITH TIME ZONE,
  CONSTRAINT credentials_owner_unique UNIQUE(owner)
);

-- Webhook deliveries for idempotency
CREATE TABLE IF NOT EXISTS github.webhook_deliveries (
  id TEXT PRIMARY KEY,
  delivery_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  payload_hash TEXT,
  processed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- MCP tool permissions
CREATE TABLE IF NOT EXISTS github.mcp_tool_permissions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  allowed BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Unique index for agent + tool
CREATE UNIQUE INDEX IF NOT EXISTS github_mcp_perm_agent_tool_idx
  ON github.mcp_tool_permissions (agent_id, tool_name);

-- Updated_at trigger function
CREATE OR REPLACE FUNCTION github.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to credentials
DROP TRIGGER IF EXISTS update_github_credentials_updated_at ON github.credentials;
CREATE TRIGGER update_github_credentials_updated_at
  BEFORE UPDATE ON github.credentials
  FOR EACH ROW
  EXECUTE FUNCTION github.update_updated_at();

-- Apply trigger to mcp_tool_permissions
DROP TRIGGER IF EXISTS update_github_mcp_permissions_updated_at ON github.mcp_tool_permissions;
CREATE TRIGGER update_github_mcp_permissions_updated_at
  BEFORE UPDATE ON github.mcp_tool_permissions
  FOR EACH ROW
  EXECUTE FUNCTION github.update_updated_at();
`;
