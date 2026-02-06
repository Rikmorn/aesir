-- Phase 57: Conversation Reopening
-- Add reopen_count column and agent.reopened event type

-- 1. Add reopen_count column to conversations table
ALTER TABLE agents.conversations
  ADD COLUMN IF NOT EXISTS reopen_count INTEGER NOT NULL DEFAULT 0;

-- 2. Update the CHECK constraint on agent_events.type to include agent.reopened
-- Drizzle text enums generate CHECK constraints. Drop and recreate.
-- Use a DO block to handle the case where the constraint name varies.
DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT conname INTO constraint_name
  FROM pg_constraint
  WHERE conrelid = 'agents.agent_events'::regclass
    AND contype = 'c'
    AND conname LIKE '%type%';

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE agents.agent_events DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

ALTER TABLE agents.agent_events
  ADD CONSTRAINT agent_events_type_check
  CHECK (type IN (
    'tool.called', 'tool.succeeded', 'tool.failed',
    'llm.response',
    'agent.started', 'agent.completed', 'agent.paused', 'agent.resumed', 'agent.reopened',
    'signal.received'
  ));
