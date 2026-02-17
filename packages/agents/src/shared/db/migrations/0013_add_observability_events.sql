-- Phase 77: Dashboard Observability
-- Add agent.stale_recovered and agent.retry_scheduled event types.
-- Update the CHECK constraint on agent_events.type to include all 17 event types.
-- Drop the old constraint (from 0004) if it exists, then recreate with full list.

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
    'signal.received', 'signal.orphaned',
    'mcp.error', 'mcp.rate_limited', 'mcp.retries_exhausted',
    'notification.failed',
    'agent.stale_recovered', 'agent.retry_scheduled'
  ));
