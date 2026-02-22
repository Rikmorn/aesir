-- Phase 84: Schedule state tracking for cron-based agent execution
CREATE TABLE agents.schedule_state (
  agent_id TEXT NOT NULL,
  schedule_name TEXT NOT NULL,
  last_run_at TIMESTAMP WITH TIME ZONE,
  last_run_outcome TEXT,
  last_run_conversation_id TEXT,
  last_run_summary TEXT,
  run_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (agent_id, schedule_name)
);
