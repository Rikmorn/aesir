ALTER TABLE agents.tasks ADD COLUMN completion_result JSONB;--> statement-breakpoint
ALTER TABLE agents.conversations ADD COLUMN active_delegations JSONB DEFAULT '[]' NOT NULL;
