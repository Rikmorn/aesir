-- updated_at trigger function for platform schema
CREATE OR REPLACE FUNCTION platform.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
-- Drop triggers if they exist (for idempotency)
DROP TRIGGER IF EXISTS update_workspaces_updated_at ON platform.workspaces;
--> statement-breakpoint
DROP TRIGGER IF EXISTS update_configurations_updated_at ON platform.configurations;
--> statement-breakpoint
-- Create triggers
CREATE TRIGGER update_workspaces_updated_at
  BEFORE UPDATE ON platform.workspaces
  FOR EACH ROW
  EXECUTE FUNCTION platform.update_updated_at_column();
--> statement-breakpoint
CREATE TRIGGER update_configurations_updated_at
  BEFORE UPDATE ON platform.configurations
  FOR EACH ROW
  EXECUTE FUNCTION platform.update_updated_at_column();
