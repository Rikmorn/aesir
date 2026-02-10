-- Phase 70: Task Delegation - Add depth column to tasks table
-- Tracks delegation chain depth for MAX_DELEGATION_DEPTH enforcement

ALTER TABLE agents.tasks ADD COLUMN depth INTEGER NOT NULL DEFAULT 0;

--> statement-breakpoint

CREATE INDEX idx_tasks_depth ON agents.tasks(depth);
