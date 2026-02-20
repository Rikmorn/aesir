-- Phase 81: Parallel Delegation
-- Create task_groups table for grouping parallel delegated tasks under completion policies.
-- Add group_id FK to tasks for group membership.

-- Create task_groups table
CREATE TABLE agents.task_groups (
  id TEXT PRIMARY KEY,
  delegator_conversation_id TEXT NOT NULL REFERENCES agents.conversations(id),
  policy JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  timeout_duration TEXT,
  timeout_job_id TEXT,
  token_budget INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_task_groups_delegator ON agents.task_groups(delegator_conversation_id);
CREATE INDEX idx_task_groups_status ON agents.task_groups(status);

-- Add group_id FK to tasks
ALTER TABLE agents.tasks ADD COLUMN group_id TEXT REFERENCES agents.task_groups(id);
CREATE INDEX idx_tasks_group ON agents.tasks(group_id);

-- Add pending_cancellation to conversations for cleanup-turn pattern
ALTER TABLE agents.conversations ADD COLUMN pending_cancellation BOOLEAN NOT NULL DEFAULT FALSE;
