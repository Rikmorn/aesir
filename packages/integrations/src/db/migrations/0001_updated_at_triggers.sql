-- updated_at trigger function for integrations schema
CREATE OR REPLACE FUNCTION integrations.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
-- Drop triggers if they exist (for idempotency)
DROP TRIGGER IF EXISTS update_credentials_updated_at ON integrations.credentials;
--> statement-breakpoint
DROP TRIGGER IF EXISTS update_sync_cursors_updated_at ON integrations.sync_cursors;
--> statement-breakpoint
-- Create triggers
CREATE TRIGGER update_credentials_updated_at
  BEFORE UPDATE ON integrations.credentials
  FOR EACH ROW
  EXECUTE FUNCTION integrations.update_updated_at_column();
--> statement-breakpoint
CREATE TRIGGER update_sync_cursors_updated_at
  BEFORE UPDATE ON integrations.sync_cursors
  FOR EACH ROW
  EXECUTE FUNCTION integrations.update_updated_at_column();
