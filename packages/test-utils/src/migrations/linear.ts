/**
 * Linear Schema Migration SQL
 *
 * SQL to create the linear.* schema for integration tests.
 * This mirrors the production schema from @aesir/integration-linear.
 */

export const linearMigrationSql = `
-- Create linear schema
CREATE SCHEMA IF NOT EXISTS linear;

-- Credentials table
CREATE TABLE IF NOT EXISTS linear.credentials (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  encrypted_access_token TEXT NOT NULL,
  encrypted_refresh_token TEXT,
  token_type TEXT DEFAULT 'Bearer',
  scope TEXT,
  expires_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMP WITH TIME ZONE
);

-- Unique constraint on workspace (only one active credential per workspace)
-- Note: Drizzle schema uses unique() without WHERE, but we add partial index for deleted_at
CREATE UNIQUE INDEX IF NOT EXISTS linear_credentials_workspace_unique
  ON linear.credentials (workspace_id)
  WHERE deleted_at IS NULL;

-- Webhook deliveries for idempotency
CREATE TABLE IF NOT EXISTS linear.webhook_deliveries (
  id TEXT PRIMARY KEY,
  delivery_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  payload_hash TEXT,
  processed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- MCP tool permissions
CREATE TABLE IF NOT EXISTS linear.mcp_tool_permissions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  allowed BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE(agent_id, tool_name)
);

-- Updated_at trigger function
CREATE OR REPLACE FUNCTION linear.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to credentials
DROP TRIGGER IF EXISTS update_linear_credentials_updated_at ON linear.credentials;
CREATE TRIGGER update_linear_credentials_updated_at
  BEFORE UPDATE ON linear.credentials
  FOR EACH ROW
  EXECUTE FUNCTION linear.update_updated_at();

-- Apply trigger to mcp_tool_permissions
DROP TRIGGER IF EXISTS update_linear_mcp_permissions_updated_at ON linear.mcp_tool_permissions;
CREATE TRIGGER update_linear_mcp_permissions_updated_at
  BEFORE UPDATE ON linear.mcp_tool_permissions
  FOR EACH ROW
  EXECUTE FUNCTION linear.update_updated_at();
`;
